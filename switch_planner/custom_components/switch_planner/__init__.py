"""Switch Planner – Zeit- und Geolokalisierungssteuerung für Schalter."""
from __future__ import annotations

import logging
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_HOME_ZONE,
    CONF_TRACKED_ENTITY,
    CONF_TRACKED_ENTITIES,
    DEFAULT_HOME_ZONE,
    DOMAIN,
    LOCAL_HELPER_DOMAINS,
    PANEL_JS,
    PANEL_URL,
    PROTOCOL_MAP,
    STATIC_URL_BASE,
    STORAGE_KEY,
    STORAGE_VERSION,
    SWITCHABLE_DOMAINS,
    WS_ADD,
    WS_AVAILABLE,
    WS_DEVICE_SET_GROUP,
    WS_GET_OPTIONS,
    WS_GROUP_CREATE,
    WS_GROUP_DELETE,
    WS_GROUP_RENAME,
    WS_GROUP_SAVE,
    WS_LIST,
    WS_REMOVE,
    WS_SAVE,
)


def _migrate_storage(raw: dict) -> dict:
    """Bringt gespeicherte Daten in die aktuelle Form {devices, groups}.

    Ältere Versionen speicherten ein flaches Dict entity_id -> config
    ohne Gruppen. Das wird hier automatisch übernommen.
    """
    if "devices" in raw or "groups" in raw:
        raw.setdefault("devices", {})
        raw.setdefault("groups", {})
        return raw
    return {"devices": raw, "groups": {}}


def _new_group_id() -> str:
    import uuid

    return uuid.uuid4().hex[:10]


def _domain_of(entity_id: str) -> str:
    return entity_id.split(".")[0]


async def _async_call_turn_off(hass: HomeAssistant, entity_id: str) -> None:
    await hass.services.async_call(
        _domain_of(entity_id), "turn_off", {"entity_id": entity_id}, blocking=False
    )


_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema({}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """YAML-Setup wird nicht unterstützt, nur Config-Entries."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    raw = await store.async_load() or {}
    data = _migrate_storage(raw)

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "store": store,
        "data": data,
        "unsub_interval": None,
        "unsub_geo": None,
    }

    # WebSocket-Befehle nur einmal global registrieren
    if not hass.data[DOMAIN].get("ws_registered"):
        websocket_api.async_register_command(hass, ws_list_switches)
        websocket_api.async_register_command(hass, ws_save_switch)
        websocket_api.async_register_command(hass, ws_get_options)
        websocket_api.async_register_command(hass, ws_available_switches)
        websocket_api.async_register_command(hass, ws_add_switch)
        websocket_api.async_register_command(hass, ws_remove_switch)
        websocket_api.async_register_command(hass, ws_group_create)
        websocket_api.async_register_command(hass, ws_group_rename)
        websocket_api.async_register_command(hass, ws_group_delete)
        websocket_api.async_register_command(hass, ws_group_save)
        websocket_api.async_register_command(hass, ws_device_set_group)
        hass.data[DOMAIN]["ws_registered"] = True

    await _async_register_static_and_panel(hass)

    # Jede Minute: Zeitpläne und Geolokalisierung durchsetzen
    unsub_interval = async_track_time_interval(
        hass, _make_schedule_enforcer(hass, entry), _timedelta_minute()
    )
    hass.data[DOMAIN][entry.entry_id]["unsub_interval"] = unsub_interval

    await _async_setup_geo_tracking(hass, entry)
    # Direkt beim Start einmal prüfen, statt auf die erste volle Minute
    # zu warten (z.B. nach einem Neustart von Home Assistant).
    hass.async_create_task(_async_enforce_all(hass, entry))
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if data:
        if data.get("unsub_interval"):
            data["unsub_interval"]()
        if data.get("unsub_geo"):
            data["unsub_geo"]()
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await _async_setup_geo_tracking(hass, entry)


def _get_tracked_entities(entry: ConfigEntry) -> list[str]:
    """Liest die überwachten Personen/Tracker, inkl. Rückwärtskompatibilität
    zum alten, einzelnen "tracked_entity"-Optionsfeld."""
    entities = entry.options.get(CONF_TRACKED_ENTITIES)
    if entities:
        return list(entities)
    legacy = entry.options.get(CONF_TRACKED_ENTITY)
    return [legacy] if legacy else []


async def _async_setup_geo_tracking(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Richtet die Überwachung der ausgewählten Personen/Tracker neu ein."""
    entry_data = hass.data[DOMAIN][entry.entry_id]
    if entry_data.get("unsub_geo"):
        entry_data["unsub_geo"]()
        entry_data["unsub_geo"] = None

    tracked_entities = _get_tracked_entities(entry)
    if not tracked_entities:
        return

    unsub_geo = async_track_state_change_event(
        hass, tracked_entities, _make_geo_handler(hass, entry)
    )
    entry_data["unsub_geo"] = unsub_geo


def _make_geo_handler(hass: HomeAssistant, entry: ConfigEntry):
    @callback
    def _handle_geo_change(event: Event) -> None:
        # Bei jeder Änderung einer überwachten Person/eines Trackers den
        # Gesamtstatus ("ist noch jemand zuhause?") neu bewerten.
        hass.async_create_task(_async_enforce_all(hass, entry))

    return _handle_geo_change


def _effective_schedules(device_cfg: dict, groups: dict) -> list:
    """Liefert die tatsächlich wirksamen Zeitfenster: die der Gruppe, falls
    das Gerät einer Gruppe zugeordnet ist, sonst die eigenen."""
    group_id = device_cfg.get("group_id")
    if group_id and group_id in groups:
        return groups[group_id].get("schedules", [])
    return device_cfg.get("schedules", [])


def _effective_geo_auto_off(device_cfg: dict, groups: dict) -> bool:
    group_id = device_cfg.get("group_id")
    if group_id and group_id in groups:
        return bool(groups[group_id].get("geo_auto_off", False))
    return bool(device_cfg.get("geo_auto_off", False))


def _anyone_home(hass: HomeAssistant, entry: ConfigEntry) -> bool | None:
    """True/False, ob mindestens einer der überwachten Personen/Tracker
    aktuell in der 'zuhause'-Zone ist. None, falls die Funktion nicht
    konfiguriert ist (keine Personen ausgewählt)."""
    tracked_entities = _get_tracked_entities(entry)
    if not tracked_entities:
        return None

    home_zone = entry.options.get(CONF_HOME_ZONE, DEFAULT_HOME_ZONE)
    home_state = home_zone.split(".")[-1] if "." in home_zone else "home"

    for entity_id in tracked_entities:
        state = hass.states.get(entity_id)
        if state and state.state == home_state:
            return True
    return False


def _desired_device_state(
    schedules: list[dict], geo_enabled: bool, anyone_home: bool | None
) -> bool | None:
    """Ermittelt den EINEN gewünschten Zustand (True=an, False=aus,
    None=keine Automatik) unter Berücksichtigung von Zeitfenster UND
    Geo-Automatik gemeinsam – damit sich beide Mechanismen nicht
    gegenseitig widersprechen bzw. bekämpfen.

    Priorität: Ist die Geo-Automatik aktiv und niemand zuhause, wird IMMER
    ausgeschaltet – unabhängig davon, ob gerade ein Zeitfenster aktiv
    wäre. Ist jemand zuhause (oder Geo nicht konfiguriert), entscheidet
    weiterhin das Zeitfenster, falls eines gesetzt ist.
    """
    has_schedule = bool(schedules)

    if geo_enabled and anyone_home is not None:
        if not anyone_home:
            return False  # höchste Priorität: niemand zuhause -> aus
        if has_schedule:
            return _is_within_any_schedule(schedules)
        return True  # jemand zuhause, kein Zeitfenster -> an

    if has_schedule:
        return _is_within_any_schedule(schedules)

    return None  # keine Automatik konfiguriert


async def _async_enforce_all(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Wertet für jedes verwaltete Gerät Zeitfenster UND Geo-Automatik
    gemeinsam aus und schaltet es bei Bedarf ein oder aus."""
    anyone_home = _anyone_home(hass, entry)

    data = hass.data[DOMAIN][entry.entry_id]["data"]
    devices = data["devices"]
    groups = data["groups"]

    for entity_id, cfg in devices.items():
        schedules = _effective_schedules(cfg, groups)
        geo_enabled = _effective_geo_auto_off(cfg, groups)

        desired = _desired_device_state(schedules, geo_enabled, anyone_home)
        if desired is None:
            continue

        state = hass.states.get(entity_id)
        if not state or state.state in ("unavailable", "unknown"):
            continue

        if desired and state.state == "off":
            _LOGGER.info(
                "Switch Planner: %s wird eingeschaltet (Zeitfenster/Geo-Automatik)",
                entity_id,
            )
            await _async_call_turn_on(hass, entity_id)
        elif not desired and state.state == "on":
            _LOGGER.info(
                "Switch Planner: %s wird ausgeschaltet (Zeitfenster/Geo-Automatik)",
                entity_id,
            )
            await _async_call_turn_off(hass, entity_id)


def _timedelta_minute():
    from datetime import timedelta

    return timedelta(minutes=1)


def _make_schedule_enforcer(hass: HomeAssistant, entry: ConfigEntry):
    @callback
    def _enforce(now: datetime) -> None:
        hass.async_create_task(_async_enforce_all(hass, entry))

    return _enforce


async def _async_call_turn_on(hass: HomeAssistant, entity_id: str) -> None:
    await hass.services.async_call(
        _domain_of(entity_id), "turn_on", {"entity_id": entity_id}, blocking=False
    )


def _is_within_any_schedule(schedules: list[dict]) -> bool:
    now_local = dt_util.now()  # in der von Home Assistant konfigurierten Zeitzone
    today = now_local.date()
    now_time = now_local.time()

    for schedule in schedules:
        try:
            start = dt_time.fromisoformat(schedule["start"])
            end = dt_time.fromisoformat(schedule["end"])
        except (KeyError, ValueError):
            continue

        if start <= end:
            # Normales Zeitfenster innerhalb eines Tages
            if (
                start <= now_time <= end
                and _weekday_matches(schedule, today.weekday())
                and _date_within_range(schedule, today)
            ):
                return True
        else:
            # Zeitfenster geht über Mitternacht (z.B. 22:00 - 06:00).
            # Der "Abend"-Teil gehört zum heutigen Wochentag/Datum, der
            # "früh morgens"-Teil noch zum gestrigen (das Fenster wurde
            # gestern Abend gestartet).
            if (
                now_time >= start
                and _weekday_matches(schedule, today.weekday())
                and _date_within_range(schedule, today)
            ):
                return True
            if now_time <= end:
                yesterday = today - timedelta(days=1)
                if _weekday_matches(
                    schedule, yesterday.weekday()
                ) and _date_within_range(schedule, yesterday):
                    return True
    return False


def _weekday_matches(schedule: dict, weekday: int) -> bool:
    """Prüft die optionale Wochentagsauswahl (Montag=0 .. Sonntag=6).

    Ist keine Auswahl getroffen (leer/None), gilt das Zeitfenster wie
    bisher an jedem Wochentag.
    """
    weekdays = schedule.get("weekdays") or []
    if not weekdays:
        return True
    try:
        return weekday in {int(d) for d in weekdays}
    except (TypeError, ValueError):
        return True


def _date_within_range(schedule: dict, today) -> bool:
    """Prüft die optionale, jahresunabhängige Datumsspanne eines
    Zeitfensters (nur Monat/Tag, kein Jahr).

    Ist keine Datumsspanne aktiviert oder unvollständig gesetzt, gilt das
    Zeitfenster unabhängig vom Datum (wie bisher, an jedem Tag). Ist sie
    gesetzt, muss "today" innerhalb von (start_month, start_day)..
    (end_month, end_day) liegen. Eine Spanne, die über den Jahreswechsel
    geht (z.B. 01.12. - 31.01.), wird korrekt als jährlich wiederkehrend
    behandelt.
    """
    if not schedule.get("date_range_enabled"):
        return True

    start_month = schedule.get("date_start_month")
    start_day = schedule.get("date_start_day")
    end_month = schedule.get("date_end_month")
    end_day = schedule.get("date_end_day")

    if not all([start_month, start_day, end_month, end_day]):
        return True

    try:
        start_md = (int(start_month), int(start_day))
        end_md = (int(end_month), int(end_day))
        today_md = (today.month, today.day)
    except (TypeError, ValueError):
        return True

    if start_md <= end_md:
        return start_md <= today_md <= end_md

    # Spanne geht über den Jahreswechsel (z.B. 01.12. - 31.01.)
    return today_md >= start_md or today_md <= end_md


async def _async_register_static_and_panel(hass: HomeAssistant) -> None:
    if hass.data[DOMAIN].get("panel_registered"):
        return

    www_path = Path(__file__).parent / "www"
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL_BASE, str(www_path), False)]
        )
    except ImportError:
        # Ältere Home Assistant Version ohne StaticPathConfig
        hass.http.register_static_path(STATIC_URL_BASE, str(www_path), False)

    # Cache-Buster: Versionskennung aus dem Dateiinhalt der JS-Datei
    # berechnen, damit Browser nach jedem Update automatisch die neue
    # Version laden statt eine gecachte alte Fassung zu behalten.
    cache_bust = await hass.async_add_executor_job(_panel_js_hash, www_path / PANEL_JS)

    await async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name="switch-planner-panel",
        sidebar_title="Switch Planner",
        sidebar_icon="mdi:toggle-switch-outline",
        module_url=f"{STATIC_URL_BASE}/{PANEL_JS}?v={cache_bust}",
        embed_iframe=False,
        require_admin=True,
        config={},
    )
    hass.data[DOMAIN]["panel_registered"] = True


def _panel_js_hash(path: Path) -> str:
    """Kurzer Hash des Datei-Inhalts als Cache-Buster (blockierender I/O,
    daher über async_add_executor_job aufgerufen)."""
    import hashlib

    try:
        return hashlib.sha1(path.read_bytes()).hexdigest()[:10]
    except OSError:
        return "0"



def _get_display_name(hass: HomeAssistant, entity_id: str) -> str:
    """Liefert den Gerätenamen (nicht den Entitätennamen), falls die
    Entität einem Gerät zugeordnet ist – sonst den Fallback über den
    Entitätenzustand bzw. die entity_id."""
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)

    if entry and entry.device_id:
        dev_reg = dr.async_get(hass)
        device = dev_reg.async_get(entry.device_id)
        if device:
            device_name = device.name_by_user or device.name
            if device_name:
                return device_name

    state = hass.states.get(entity_id)
    if state:
        return state.attributes.get("friendly_name", entity_id)
    return entity_id


def _get_protocol(hass: HomeAssistant, entity_id: str) -> str:
    if _domain_of(entity_id) in LOCAL_HELPER_DOMAINS:
        return "Lokal (Helper)"

    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)

    entry = ent_reg.async_get(entity_id)
    if not entry:
        return "Unbekannt"

    config_entry_id = None
    if entry.device_id:
        device = dev_reg.async_get(entry.device_id)
        if device and device.config_entries:
            config_entry_id = next(iter(device.config_entries))
    if not config_entry_id:
        config_entry_id = entry.config_entry_id

    if not config_entry_id:
        return "Unbekannt"

    config_entry = hass.config_entries.async_get_entry(config_entry_id)
    if not config_entry:
        return "Unbekannt"

    return PROTOCOL_MAP.get(config_entry.domain, config_entry.domain)


def _entry_for_hass(hass: HomeAssistant) -> ConfigEntry | None:
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


@websocket_api.websocket_command({vol.Required("type"): WS_LIST})
@websocket_api.async_response
async def ws_list_switches(hass: HomeAssistant, connection, msg) -> None:
    """Gibt die manuell hinzugefügten Geräte sowie alle Gruppen zurück."""
    entry = _entry_for_hass(hass)
    data = hass.data[DOMAIN][entry.entry_id]["data"] if entry else {"devices": {}, "groups": {}}
    devices = data["devices"]
    groups = data["groups"]

    result = []
    for entity_id, cfg in devices.items():
        group_id = cfg.get("group_id")
        if group_id and group_id in groups:
            # Gruppierte Geräte erscheinen NICHT in der Haupttabelle,
            # sondern ausschließlich in der Tabelle ihrer Gruppe – so
            # bleibt die Übersicht klar.
            continue
        state = hass.states.get(entity_id)
        domain = _domain_of(entity_id)
        result.append(
            {
                "entity_id": entity_id,
                "name": _get_display_name(hass, entity_id),
                "domain": domain,
                "protocol": _get_protocol(hass, entity_id),
                "state": state.state if state else "unavailable",
                "schedules": cfg.get("schedules", []),
                "geo_auto_off": cfg.get("geo_auto_off", False),
                "group_id": group_id,
                "group_name": None,
            }
        )
    result.sort(key=lambda item: item["name"].lower())

    group_result = []
    for group_id, gcfg in groups.items():
        members = []
        for eid, dcfg in devices.items():
            if dcfg.get("group_id") != group_id:
                continue
            m_state = hass.states.get(eid)
            members.append(
                {
                    "entity_id": eid,
                    "name": _get_display_name(hass, eid),
                    "domain": _domain_of(eid),
                    "protocol": _get_protocol(hass, eid),
                    "state": m_state.state if m_state else "unavailable",
                }
            )
        members.sort(key=lambda item: item["name"].lower())
        group_result.append(
            {
                "group_id": group_id,
                "name": gcfg.get("name", "Gruppe"),
                "schedules": gcfg.get("schedules", []),
                "geo_auto_off": gcfg.get("geo_auto_off", False),
                "members": members,
            }
        )
    group_result.sort(key=lambda item: item["name"].lower())

    connection.send_result(msg["id"], {"switches": result, "groups": group_result})


@websocket_api.websocket_command({vol.Required("type"): WS_AVAILABLE})
@websocket_api.async_response
async def ws_available_switches(hass: HomeAssistant, connection, msg) -> None:
    """Gibt alle schaltbaren Geräte zurück, die noch NICHT hinzugefügt wurden."""
    entry = _entry_for_hass(hass)
    devices = hass.data[DOMAIN][entry.entry_id]["data"]["devices"] if entry else {}

    result = []
    for domain in SWITCHABLE_DOMAINS:
        for state in hass.states.async_all(domain):
            if state.entity_id in devices:
                continue
            result.append(
                {
                    "entity_id": state.entity_id,
                    "name": _get_display_name(hass, state.entity_id),
                    "domain": domain,
                    "protocol": _get_protocol(hass, state.entity_id),
                }
            )

    result.sort(key=lambda item: item["name"].lower())
    connection.send_result(msg["id"], {"switches": result})


@websocket_api.websocket_command(
    {vol.Required("type"): WS_ADD, vol.Required("entity_id"): str}
)
@websocket_api.async_response
async def ws_add_switch(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    devices = entry_data["data"]["devices"]
    entity_id = msg["entity_id"]

    if entity_id not in devices:
        devices[entity_id] = {"schedules": [], "geo_auto_off": False, "group_id": None}
        await entry_data["store"].async_save(entry_data["data"])

    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {vol.Required("type"): WS_REMOVE, vol.Required("entity_id"): str}
)
@websocket_api.async_response
async def ws_remove_switch(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    devices = entry_data["data"]["devices"]
    entity_id = msg["entity_id"]

    if entity_id in devices:
        del devices[entity_id]
        await entry_data["store"].async_save(entry_data["data"])

    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_SAVE,
        vol.Required("entity_id"): str,
        vol.Optional("schedules"): list,
        vol.Optional("geo_auto_off"): bool,
    }
)
@websocket_api.async_response
async def ws_save_switch(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    devices = entry_data["data"]["devices"]
    entity_id = msg["entity_id"]

    current = devices.get(entity_id, {})
    if "schedules" in msg:
        current["schedules"] = msg["schedules"]
    if "geo_auto_off" in msg:
        current["geo_auto_off"] = msg["geo_auto_off"]
    devices[entity_id] = current

    await entry_data["store"].async_save(entry_data["data"])
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {vol.Required("type"): WS_GROUP_CREATE, vol.Required("name"): str}
)
@websocket_api.async_response
async def ws_group_create(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    groups = entry_data["data"]["groups"]
    group_id = _new_group_id()
    groups[group_id] = {
        "name": msg["name"].strip() or "Gruppe",
        "schedules": [],
        "geo_auto_off": False,
    }
    await entry_data["store"].async_save(entry_data["data"])
    connection.send_result(msg["id"], {"ok": True, "group_id": group_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_GROUP_RENAME,
        vol.Required("group_id"): str,
        vol.Required("name"): str,
    }
)
@websocket_api.async_response
async def ws_group_rename(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    groups = entry_data["data"]["groups"]
    group_id = msg["group_id"]
    if group_id in groups:
        groups[group_id]["name"] = msg["name"].strip() or "Gruppe"
        await entry_data["store"].async_save(entry_data["data"])

    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {vol.Required("type"): WS_GROUP_DELETE, vol.Required("group_id"): str}
)
@websocket_api.async_response
async def ws_group_delete(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    data = entry_data["data"]
    group_id = msg["group_id"]

    if group_id in data["groups"]:
        del data["groups"][group_id]
        # Mitglieder werden wieder zu eigenständigen Geräten (ohne
        # Zeitplan), statt gelöscht zu werden.
        for cfg in data["devices"].values():
            if cfg.get("group_id") == group_id:
                cfg["group_id"] = None
        await entry_data["store"].async_save(data)

    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_GROUP_SAVE,
        vol.Required("group_id"): str,
        vol.Optional("schedules"): list,
        vol.Optional("geo_auto_off"): bool,
    }
)
@websocket_api.async_response
async def ws_group_save(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    groups = entry_data["data"]["groups"]
    group_id = msg["group_id"]
    if group_id not in groups:
        connection.send_error(msg["id"], "not_found", "Gruppe nicht gefunden")
        return

    if "schedules" in msg:
        groups[group_id]["schedules"] = msg["schedules"]
    if "geo_auto_off" in msg:
        groups[group_id]["geo_auto_off"] = msg["geo_auto_off"]

    await entry_data["store"].async_save(entry_data["data"])
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_DEVICE_SET_GROUP,
        vol.Required("entity_id"): str,
        vol.Optional("group_id"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def ws_device_set_group(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    if not entry:
        connection.send_error(msg["id"], "no_entry", "Integration nicht eingerichtet")
        return

    entry_data = hass.data[DOMAIN][entry.entry_id]
    devices = entry_data["data"]["devices"]
    entity_id = msg["entity_id"]
    group_id = msg.get("group_id") or None

    if entity_id in devices:
        devices[entity_id]["group_id"] = group_id
        await entry_data["store"].async_save(entry_data["data"])

    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): WS_GET_OPTIONS})
@websocket_api.async_response
async def ws_get_options(hass: HomeAssistant, connection, msg) -> None:
    entry = _entry_for_hass(hass)
    connection.send_result(
        msg["id"],
        {
            "tracked_entities": _get_tracked_entities(entry) if entry else [],
            "home_zone": entry.options.get(CONF_HOME_ZONE, DEFAULT_HOME_ZONE)
            if entry
            else DEFAULT_HOME_ZONE,
        },
    )
