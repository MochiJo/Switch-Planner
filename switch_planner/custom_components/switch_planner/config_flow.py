"""Config- und Options-Flow für Switch Planner."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import CONF_HOME_ZONE, CONF_TRACKED_ENTITIES, DEFAULT_HOME_ZONE, DOMAIN


class SwitchPlannerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Einrichtungs-Flow. Es wird nur eine Instanz benötigt."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="Switch Planner", data={})

        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> SwitchPlannerOptionsFlow:
        # Kein Argument mehr übergeben: config_entry wird von der
        # Basisklasse automatisch bereitgestellt (siehe Hinweis in
        # SwitchPlannerOptionsFlow).
        return SwitchPlannerOptionsFlow()


class SwitchPlannerOptionsFlow(config_entries.OptionsFlow):
    """Optionen: welche Personen/Geräte-Tracker als 'jemand zuhause'
    gelten und welche Zone als 'zuhause' gilt.

    Hinweis: config_entry wird seit neueren Home-Assistant-Versionen
    automatisch von der Basisklasse bereitgestellt und darf hier NICHT
    mehr manuell im __init__ zugewiesen werden (das führt sonst zu einem
    500-Fehler beim Öffnen der Konfiguration, da config_entry inzwischen
    eine schreibgeschützte Property ist).
    """

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = self.config_entry.options
        # Rückwärtskompatibilität: ältere Versionen speicherten nur eine
        # einzelne Entität unter dem alten Schlüssel "tracked_entity".
        default_tracked = current.get(CONF_TRACKED_ENTITIES)
        if not default_tracked and current.get("tracked_entity"):
            default_tracked = [current["tracked_entity"]]

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_TRACKED_ENTITIES,
                    default=default_tracked or [],
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain=["person", "device_tracker"], multiple=True
                    )
                ),
                vol.Optional(
                    CONF_HOME_ZONE,
                    default=current.get(CONF_HOME_ZONE, DEFAULT_HOME_ZONE),
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain="zone")
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
