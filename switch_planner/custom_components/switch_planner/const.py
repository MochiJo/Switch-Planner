"""Konstanten für die Switch Planner Integration."""

DOMAIN = "switch_planner"

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.entities"

CONF_TRACKED_ENTITY = "tracked_entity"  # veraltet, nur für Migration
CONF_TRACKED_ENTITIES = "tracked_entities"
CONF_HOME_ZONE = "home_zone"

DEFAULT_HOME_ZONE = "zone.home"

PANEL_URL = "switch-planner"
STATIC_URL_BASE = "/switch_planner_files"
PANEL_JS = "switch-planner-panel.js"

WS_LIST = f"{DOMAIN}/list"
WS_SAVE = f"{DOMAIN}/save"
WS_GET_OPTIONS = f"{DOMAIN}/get_options"
WS_AVAILABLE = f"{DOMAIN}/available"
WS_ADD = f"{DOMAIN}/add"
WS_REMOVE = f"{DOMAIN}/remove"
WS_GROUP_CREATE = f"{DOMAIN}/group_create"
WS_GROUP_RENAME = f"{DOMAIN}/group_rename"
WS_GROUP_DELETE = f"{DOMAIN}/group_delete"
WS_GROUP_SAVE = f"{DOMAIN}/group_save"
WS_DEVICE_SET_GROUP = f"{DOMAIN}/device_set_group"

# Alle Domains, die ein einfaches Ein/Aus kennen und damit als
# "schaltbares Gerät" gelten. Bewusst weggelassen: climate, cover,
# media_player, lock – die haben kein reines On/Off-Modell bzw. eigene
# Sicherheits-/Bedienlogik, die eine automatische Zeit-/Geo-Abschaltung
# riskant machen würde.
SWITCHABLE_DOMAINS = [
    "switch",
    "light",
    "fan",
    "siren",
    "input_boolean",
]
# Hinweis: "valve" bewusst NICHT enthalten – dessen Zustände sind
# open/closed/opening/closing statt on/off und die Services heißen
# open_valve/close_valve, das passt nicht zum turn_on/turn_off-Modell
# der übrigen Domains.

# Mapping: Domain des zugehörigen Config-Entries -> menschenlesbares
# Verbindungsprotokoll. Wird nur als Fallback/Anzeigehilfe genutzt, die
# Liste kann jederzeit erweitert werden.
PROTOCOL_MAP = {
    "zha": "Zigbee (ZHA)",
    "deconz": "Zigbee (deCONZ)",
    "zwave_js": "Z-Wave",
    "zwave_me": "Z-Wave",
    "mqtt": "MQTT",
    "tasmota": "MQTT (Tasmota)",
    "esphome": "WLAN (ESPHome)",
    "shelly": "WLAN (Shelly)",
    "hue": "Zigbee (Hue Bridge)",
    "tuya": "Cloud (Tuya)",
    "tplink": "WLAN (TP-Link/Kasa)",
    "smartthings": "Cloud (SmartThings)",
    "homekit_controller": "HomeKit",
    "insteon": "Insteon",
    "template": "Template",
    "demo": "Demo",
    "homematicip_cloud": "Homematic IP (Cloud)",
    "homematic": "Homematic (BidCos)",
    "fritzbox": "WLAN (AVM FRITZ!)",
    "fritzbox_callmonitor": "WLAN (AVM FRITZ!)",
    "broadlink": "WLAN (Broadlink)",
    "sonoff": "WLAN (eWeLink)",
    "wemo": "WLAN (WeMo)",
    "switchbot": "Bluetooth (SwitchBot)",
    "bluetooth_le_tracker": "Bluetooth",
    "matter": "Matter",
}

# Domains ohne physisches Gerät dahinter (Helper) – haben kein
# Verbindungsprotokoll im eigentlichen Sinn.
LOCAL_HELPER_DOMAINS = {"input_boolean"}
