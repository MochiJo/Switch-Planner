// Switch Planner – eigenes HA-Sidebar-Panel
// Kein Build-Tooling nötig, reines Web-Component (Custom Element).

const DOMAIN_LABELS = {
  switch: "Steckdose/Schalter",
  light: "Licht",
  fan: "Lüfter",
  siren: "Sirene",
  input_boolean: "Helfer",
};

// Montag=0 .. Sonntag=6, passend zu Pythons date.weekday()
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function daysInMonth(month) {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(month || 1) - 1];
}

const NEW_GROUP_VALUE = "__new__";

class SwitchPlannerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._switches = [];
    this._groups = [];
    this._loaded = false;
    this._addDialogOpen = false;
    this._availableSwitches = [];
    this._addDialogFilter = "";
    this._loadError = null;
    this._narrow = false;
  }

  set hass(hass) {
    const firstRun = !this._hass;
    this._hass = hass;
    if (firstRun && !this._loaded) {
      this._loaded = true;
      this._loadData();
    }
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    const changed = this._narrow !== value;
    this._narrow = value;
    if (changed) this._render();
  }

  get narrow() {
    return this._narrow;
  }

  // panel_custom setzt außerdem "panel" und "route" – wir brauchen sie
  // nicht, definieren aber harmlose No-Op-Setter, damit nichts fehlschlägt.
  set panel(value) {
    this._panel = value;
  }

  get panel() {
    return this._panel;
  }

  set route(value) {
    this._route = value;
  }

  get route() {
    return this._route;
  }

  _toggleSidebar() {
    this.dispatchEvent(
      new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })
    );
  }

  async _loadData() {
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: "switch_planner/list",
      });
      this._switches = res.switches || [];
      this._groups = res.groups || [];
      this._loadError = null;
    } catch (err) {
      this._loadError =
        (err && (err.message || err.code)) ||
        "Unbekannter Fehler beim Laden der Geräteliste.";
      console.error("Switch Planner: Fehler beim Laden", err);
    }
    this._render();
  }

  async _loadAvailable() {
    const res = await this._hass.connection.sendMessagePromise({
      type: "switch_planner/available",
    });
    return res.switches;
  }

  async _addEntity(entityId) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/add",
      entity_id: entityId,
    });
    await this._loadData();
  }

  async _removeEntity(entityId) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/remove",
      entity_id: entityId,
    });
    await this._loadData();
  }

  async _saveEntity(entityId, patch) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/save",
      entity_id: entityId,
      ...patch,
    });
  }

  async _saveGroup(groupId, patch) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/group_save",
      group_id: groupId,
      ...patch,
    });
  }

  async _createGroup(name) {
    const res = await this._hass.connection.sendMessagePromise({
      type: "switch_planner/group_create",
      name,
    });
    return res.group_id;
  }

  async _renameGroup(groupId, name) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/group_rename",
      group_id: groupId,
      name,
    });
    await this._loadData();
  }

  async _deleteGroup(groupId) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/group_delete",
      group_id: groupId,
    });
    await this._loadData();
  }

  async _setDeviceGroup(entityId, groupId) {
    await this._hass.connection.sendMessagePromise({
      type: "switch_planner/device_set_group",
      entity_id: entityId,
      group_id: groupId,
    });
    await this._loadData();
  }

  async _toggleSwitch(entityId, turnOn) {
    const domain = entityId.split(".")[0];
    await this._hass.callService(domain, turnOn ? "turn_on" : "turn_off", {
      entity_id: entityId,
    });
    setTimeout(() => this._loadData(), 400);
  }

  // ---- Lokale State-Helfer (für Owner = Gerät ODER Gruppe) ----

  _findOwner(ownerType, ownerId) {
    if (ownerType === "group") {
      return this._groups.find((g) => g.group_id === ownerId);
    }
    return this._switches.find((s) => s.entity_id === ownerId);
  }

  _mutateOwner(ownerType, ownerId, mutator) {
    const owner = this._findOwner(ownerType, ownerId);
    if (!owner) return;
    mutator(owner);
    this._render();
  }

  _saveOwnerSchedules(ownerType, ownerId) {
    const owner = this._findOwner(ownerType, ownerId);
    if (!owner) return;
    if (ownerType === "group") {
      this._saveGroup(ownerId, { schedules: owner.schedules });
    } else {
      this._saveEntity(ownerId, { schedules: owner.schedules });
    }
  }

  _toggleGeo(ownerType, ownerId, checked) {
    this._mutateOwner(ownerType, ownerId, (owner) => {
      owner.geo_auto_off = checked;
    });
    if (ownerType === "group") {
      this._saveGroup(ownerId, { geo_auto_off: checked });
    } else {
      this._saveEntity(ownerId, { geo_auto_off: checked });
    }
  }

  _addSchedule(ownerType, ownerId) {
    this._mutateOwner(ownerType, ownerId, (owner) => {
      owner.schedules = owner.schedules || [];
      owner.schedules.push({
        start: "08:00",
        end: "20:00",
        weekdays: [],
        date_range_enabled: false,
        date_start_month: 1,
        date_start_day: 1,
        date_end_month: 12,
        date_end_day: 31,
      });
    });
    this._saveOwnerSchedules(ownerType, ownerId);
  }

  _removeSchedule(ownerType, ownerId, index) {
    this._mutateOwner(ownerType, ownerId, (owner) => {
      owner.schedules.splice(index, 1);
    });
    this._saveOwnerSchedules(ownerType, ownerId);
  }

  _updateScheduleField(ownerType, ownerId, index, field, value) {
    this._mutateOwner(ownerType, ownerId, (owner) => {
      owner.schedules[index][field] = value;
    });
  }

  _toggleScheduleWeekday(ownerType, ownerId, index, dayNum) {
    this._mutateOwner(ownerType, ownerId, (owner) => {
      const sched = owner.schedules[index];
      sched.weekdays = sched.weekdays || [];
      const pos = sched.weekdays.indexOf(dayNum);
      if (pos >= 0) {
        sched.weekdays.splice(pos, 1);
      } else {
        sched.weekdays.push(dayNum);
      }
    });
    this._saveOwnerSchedules(ownerType, ownerId);
  }

  _toggleScheduleDateRange(ownerType, ownerId, index, enabled) {
    this._mutateOwner(ownerType, ownerId, (owner) => {
      const sched = owner.schedules[index];
      sched.date_range_enabled = enabled;
      if (enabled && !sched.date_start_month) {
        sched.date_start_month = 1;
        sched.date_start_day = 1;
        sched.date_end_month = 12;
        sched.date_end_day = 31;
      }
    });
    this._saveOwnerSchedules(ownerType, ownerId);
  }

  async _openAddDialog() {
    this._availableSwitches = await this._loadAvailable();
    this._addDialogFilter = "";
    this._addDialogOpen = true;
    this._render();
  }

  _closeAddDialog() {
    this._addDialogOpen = false;
    this._render();
  }

  async _handleGroupSelectChange(entityId, value) {
    if (value === NEW_GROUP_VALUE) {
      const name = window.prompt("Name der neuen Gruppe:", "");
      if (!name || !name.trim()) {
        this._render(); // Select zurücksetzen
        return;
      }
      const groupId = await this._createGroup(name.trim());
      await this._setDeviceGroup(entityId, groupId);
    } else {
      await this._setDeviceGroup(entityId, value || null);
    }
  }

  // ---- Rendering ----

  _render() {
    if (!this.shadowRoot) return;

    const deviceRows = this._switches.map((sw) => this._renderRow(sw)).join("");
    const groupCards = this._groups.map((g) => this._renderGroupSection(g)).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 16px;
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          color: var(--primary-text-color, #212121);
          background: var(--primary-background-color, #fafafa);
          min-height: 100vh;
          box-sizing: border-box;
        }
        h1 {
          font-size: 1.4rem;
          font-weight: 400;
          margin: 0;
        }
        h2 {
          font-size: 1.1rem;
          font-weight: 400;
          margin: 32px 0 12px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          background: var(--card-background-color, #fff);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,0.12));
        }
        th, td {
          text-align: left;
          padding: 10px 12px;
          border-bottom: 1px solid var(--divider-color, #e0e0e0);
          vertical-align: top;
        }
        th {
          background: var(--secondary-background-color, #f0f0f0);
          font-weight: 500;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .entity-name { font-weight: 500; }
        .entity-id { font-size: 0.75rem; color: var(--secondary-text-color, #757575); }
        .protocol-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          background: var(--state-icon-color, #03a9f4);
          color: white;
          font-size: 0.75rem;
        }
        .group-select {
          padding: 3px 4px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          font-size: 0.8rem;
          max-width: 140px;
        }
        .grouped-note {
          font-size: 0.78rem;
          color: var(--secondary-text-color, #757575);
          font-style: italic;
        }
        .schedule-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        }
        input[type="time"] {
          padding: 3px 4px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          font-size: 0.8rem;
        }
        .schedule-weekdays {
          display: flex;
          gap: 4px;
          margin: 0 0 6px 0;
          padding-left: 2px;
        }
        .weekday-btn {
          border: 1px solid var(--divider-color, #ccc);
          background: transparent;
          color: var(--secondary-text-color, #757575);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 0.72rem;
          cursor: pointer;
        }
        .weekday-btn.active {
          background: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
          color: white;
        }
        .schedule-daterange {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: -2px 0 8px 0;
          padding-left: 2px;
        }
        .daterange-label {
          font-size: 0.75rem;
          color: var(--secondary-text-color, #757575);
        }
        .daterange-sep {
          font-size: 0.8rem;
          color: var(--secondary-text-color, #757575);
        }
        input.date-num {
          width: 42px;
          padding: 3px 2px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          font-size: 0.8rem;
          text-align: center;
        }
        button.icon-btn {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--secondary-text-color, #757575);
          font-size: 1rem;
          line-height: 1;
          padding: 2px 6px;
        }
        button.icon-btn:hover { color: var(--error-color, #db4437); }
        button.icon-btn.active {
          color: var(--primary-color, #03a9f4);
        }
        .add-schedule {
          font-size: 0.8rem;
          background: none;
          border: 1px dashed var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
          border-radius: 4px;
          padding: 3px 8px;
          cursor: pointer;
        }
        .toggle {
          position: relative;
          display: inline-block;
          width: 40px;
          height: 22px;
        }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .slider {
          position: absolute; cursor: pointer;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: #ccc;
          transition: .2s;
          border-radius: 22px;
        }
        .slider:before {
          position: absolute; content: "";
          height: 16px; width: 16px;
          left: 3px; bottom: 3px;
          background-color: white;
          transition: .2s;
          border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--primary-color, #03a9f4); }
        input:checked + .slider:before { transform: translateX(18px); }
        .empty {
          padding: 24px !important;
          text-align: center;
          color: var(--secondary-text-color, #757575);
        }
        .header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          gap: 8px;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .menu-btn {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--primary-text-color, #212121);
          font-size: 1.4rem;
          line-height: 1;
          padding: 6px 8px;
          border-radius: 50%;
          flex: none;
        }
        .menu-btn:hover {
          background: var(--secondary-background-color, #f0f0f0);
        }
        .header-row h1 {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .add-btn {
          background: var(--primary-color, #03a9f4);
          color: white;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .remove-btn {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--secondary-text-color, #757575);
          font-size: 1.1rem;
        }
        .remove-btn:hover { color: var(--error-color, #db4437); }
        .table-wrap {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        table { min-width: 820px; }
        .dialog-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .dialog-box {
          background: var(--card-background-color, #fff);
          border-radius: 8px;
          width: min(480px, 92vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .dialog-header {
          padding: 16px 16px 8px 16px;
        }
        .dialog-header h2 {
          margin: 0 0 8px 0;
          font-size: 1.1rem;
          font-weight: 500;
        }
        .dialog-search {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          font-size: 0.9rem;
        }
        .dialog-list {
          overflow-y: auto;
          padding: 0 8px 8px 8px;
        }
        .dialog-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 8px;
          border-radius: 4px;
          cursor: pointer;
        }
        .dialog-item:hover { background: var(--secondary-background-color, #f0f0f0); }
        .dialog-item-name { font-weight: 500; font-size: 0.9rem; }
        .dialog-item-id { font-size: 0.75rem; color: var(--secondary-text-color, #757575); }
        .dialog-footer {
          padding: 8px 16px 16px 16px;
          text-align: right;
        }
        .dialog-close {
          background: none;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          padding: 6px 14px;
          cursor: pointer;
        }
        .dialog-empty {
          padding: 16px;
          text-align: center;
          color: var(--secondary-text-color, #757575);
          font-size: 0.85rem;
        }
        .load-error {
          background: var(--error-color, #db4437);
          color: white;
          padding: 10px 14px;
          border-radius: 4px;
          margin-bottom: 12px;
          font-size: 0.85rem;
        }
        .group-card {
          background: var(--card-background-color, #fff);
          border-radius: 8px;
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,0.12));
          padding: 14px 16px;
          margin-bottom: 14px;
        }
        .group-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .group-name {
          font-weight: 500;
          font-size: 1rem;
          cursor: pointer;
        }
        .group-name:hover { text-decoration: underline; }
        .group-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .group-delete-btn {
          border: none;
          background: transparent;
          color: var(--secondary-text-color, #757575);
          cursor: pointer;
          font-size: 0.95rem;
        }
        .group-delete-btn:hover { color: var(--error-color, #db4437); }
        .group-members {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }
        .member-chip {
          background: var(--secondary-background-color, #f0f0f0);
          border-radius: 12px;
          padding: 3px 10px;
          font-size: 0.78rem;
        }
        .group-empty-members {
          font-size: 0.8rem;
          color: var(--secondary-text-color, #757575);
          margin-bottom: 10px;
        }
        .group-geo-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 10px;
        }
        .group-geo-label {
          font-size: 0.85rem;
        }
        .no-groups {
          font-size: 0.85rem;
          color: var(--secondary-text-color, #757575);
        }
      </style>
      <div class="header-row">
        <div class="header-left">
          <button class="menu-btn" id="menu-toggle" title="Menü öffnen" aria-label="Menü öffnen">☰</button>
          <h1>Switch Planner</h1>
        </div>
        <button class="add-btn" id="open-add-dialog">+ Hinzufügen</button>
      </div>
      ${
        this._loadError
          ? `<div class="load-error">Fehler beim Laden: ${this._loadError}. Prüfe, ob die Integration korrekt geladen wurde (Home Assistant ggf. neu starten) und sieh in der Browser-Konsole nach weiteren Details.</div>`
          : ""
      }
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gerät</th>
              <th>Typ</th>
              <th>Protokoll</th>
              <th>Status</th>
              <th>Gruppe</th>
              <th>Aktiv-Zeitfenster</th>
              <th>Geo Auto-Off</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              this._switches.length === 0
                ? `<tr><td colspan="8" class="empty">Noch keine Geräte hinzugefügt. Nutze "+ Hinzufügen", um Geräte auszuwählen.</td></tr>`
                : deviceRows
            }
          </tbody>
        </table>
      </div>

      <h2>Gruppen</h2>
      ${
        this._groups.length === 0
          ? `<div class="no-groups">Noch keine Gruppen angelegt. Wähle in der Tabelle bei einem Gerät unter "Gruppe" die Option "+ Neue Gruppe…", um mehrere Geräte mit demselben Zeitplan zu steuern.</div>`
          : groupCards
      }

      ${this._addDialogOpen ? this._renderAddDialog() : ""}
    `;

    this._attachListeners();
  }

  _renderScheduleEditor(schedules, ownerType, ownerId) {
    const rows = (schedules || [])
      .map((s, i) => {
        const dateRangeOn = !!s.date_range_enabled;
        const weekdays = s.weekdays || [];
        const weekdayBtns = WEEKDAY_LABELS.map((label, dayNum) => {
          const active = weekdays.includes(dayNum);
          return `<button type="button" class="weekday-btn ${active ? "active" : ""}" data-owner-type="${ownerType}" data-owner="${ownerId}" data-index="${i}" data-day="${dayNum}">${label}</button>`;
        }).join("");
        return `
        <div class="schedule-row" data-owner-type="${ownerType}" data-owner="${ownerId}" data-index="${i}">
          <input type="time" class="sched-start" value="${s.start}" />
          <span>–</span>
          <input type="time" class="sched-end" value="${s.end}" />
          <button class="icon-btn sched-daterange-toggle ${dateRangeOn ? "active" : ""}" data-owner-type="${ownerType}" data-owner="${ownerId}" data-index="${i}" title="Optionale Datumsspanne (ohne Jahr)">📅</button>
          <button class="icon-btn sched-remove" data-owner-type="${ownerType}" data-owner="${ownerId}" data-index="${i}" title="Entfernen">✕</button>
        </div>
        <div class="schedule-weekdays">${weekdayBtns}</div>
        <div class="schedule-daterange" data-owner-type="${ownerType}" data-owner="${ownerId}" data-index="${i}" style="display:${dateRangeOn ? "flex" : "none"}">
          <span class="daterange-label">gültig vom</span>
          <input type="number" class="date-num sched-date-start-day" min="1" max="31" value="${s.date_start_day || 1}" />
          <span class="daterange-sep">.</span>
          <input type="number" class="date-num sched-date-start-month" min="1" max="12" value="${s.date_start_month || 1}" />
          <span class="daterange-sep">.</span>
          <span class="daterange-label">bis</span>
          <input type="number" class="date-num sched-date-end-day" min="1" max="31" value="${s.date_end_day || 31}" />
          <span class="daterange-sep">.</span>
          <input type="number" class="date-num sched-date-end-month" min="1" max="12" value="${s.date_end_month || 12}" />
        </div>`;
      })
      .join("");

    return `${rows}<button class="add-schedule" data-owner-type="${ownerType}" data-owner="${ownerId}">+ Zeitfenster</button>`;
  }

  _renderGroupSelectOptions(selectedGroupId) {
    return [
      `<option value="" ${!selectedGroupId ? "selected" : ""}>Keine Gruppe</option>`,
      ...this._groups.map(
        (g) =>
          `<option value="${g.group_id}" ${selectedGroupId === g.group_id ? "selected" : ""}>${g.name}</option>`
      ),
      `<option value="${NEW_GROUP_VALUE}">+ Neue Gruppe…</option>`,
    ].join("");
  }

  _renderRow(sw) {
    const groupOptions = this._renderGroupSelectOptions(sw.group_id);
    const scheduleCell = this._renderScheduleEditor(sw.schedules, "device", sw.entity_id);
    const geoCell = `<label class="toggle">
          <input type="checkbox" class="geo-toggle" data-entity="${sw.entity_id}" ${sw.geo_auto_off ? "checked" : ""} />
          <span class="slider"></span>
        </label>`;

    return `
      <tr>
        <td>
          <div class="entity-name">${sw.name}</div>
          <div class="entity-id">${sw.entity_id}</div>
        </td>
        <td>${DOMAIN_LABELS[sw.domain] || sw.domain}</td>
        <td><span class="protocol-badge">${sw.protocol}</span></td>
        <td>
          <label class="toggle">
            <input type="checkbox" class="state-toggle" data-entity="${sw.entity_id}" ${sw.state === "on" ? "checked" : ""} />
            <span class="slider"></span>
          </label>
        </td>
        <td>
          <select class="group-select" data-entity="${sw.entity_id}">${groupOptions}</select>
        </td>
        <td>${scheduleCell}</td>
        <td>${geoCell}</td>
        <td>
          <button class="remove-btn" data-entity="${sw.entity_id}" title="Entfernen">🗑</button>
        </td>
      </tr>
    `;
  }

  _renderGroupSection(g) {
    const memberCount = g.members ? g.members.length : 0;
    const scheduleHtml = this._renderScheduleEditor(g.schedules, "group", g.group_id);
    const geoHtml = `<label class="toggle">
          <input type="checkbox" class="group-geo-toggle" data-group="${g.group_id}" ${g.geo_auto_off ? "checked" : ""} />
          <span class="slider"></span>
        </label>`;

    let bodyRows;
    if (memberCount === 0) {
      bodyRows = `
        <tr>
          <td colspan="5" class="empty">Noch keine Geräte in dieser Gruppe – weise sie über die Spalte "Gruppe" (in dieser oder der Geräte-Tabelle) zu.</td>
          <td>${scheduleHtml}</td>
          <td>${geoHtml}</td>
          <td></td>
        </tr>`;
    } else {
      bodyRows = g.members
        .map((m, idx) => {
          const groupOptions = this._renderGroupSelectOptions(g.group_id);
          const sharedCells =
            idx === 0
              ? `<td rowspan="${memberCount}">${scheduleHtml}</td><td rowspan="${memberCount}">${geoHtml}</td>`
              : "";
          return `
        <tr>
          <td>
            <div class="entity-name">${m.name}</div>
            <div class="entity-id">${m.entity_id}</div>
          </td>
          <td>${DOMAIN_LABELS[m.domain] || m.domain}</td>
          <td><span class="protocol-badge">${m.protocol}</span></td>
          <td>
            <label class="toggle">
              <input type="checkbox" class="state-toggle" data-entity="${m.entity_id}" ${m.state === "on" ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </td>
          <td>
            <select class="group-select" data-entity="${m.entity_id}">${groupOptions}</select>
          </td>
          ${sharedCells}
          <td>
            <button class="remove-btn" data-entity="${m.entity_id}" title="Entfernen">🗑</button>
          </td>
        </tr>`;
        })
        .join("");
    }

    return `
      <div class="group-card">
        <div class="group-card-header">
          <span class="group-name" data-group="${g.group_id}" title="Klicken zum Umbenennen">${g.name}</span>
          <div class="group-actions">
            <button class="group-delete-btn" data-group="${g.group_id}" title="Gruppe löschen">🗑 Gruppe löschen</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Gerät</th>
                <th>Typ</th>
                <th>Protokoll</th>
                <th>Status</th>
                <th>Gruppe</th>
                <th>Aktiv-Zeitfenster</th>
                <th>Geo Auto-Off</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderAddDialog() {
    const filter = (this._addDialogFilter || "").toLowerCase();
    const items = (this._availableSwitches || []).filter(
      (sw) =>
        sw.name.toLowerCase().includes(filter) ||
        sw.entity_id.toLowerCase().includes(filter)
    );

    const itemsHtml =
      items.length === 0
        ? `<div class="dialog-empty">Keine passenden Geräte gefunden.</div>`
        : items
            .map(
              (sw) => `
          <div class="dialog-item" data-entity="${sw.entity_id}">
            <div>
              <div class="dialog-item-name">${sw.name}</div>
              <div class="dialog-item-id">${sw.entity_id} · ${DOMAIN_LABELS[sw.domain] || sw.domain} · ${sw.protocol}</div>
            </div>
            <span>+</span>
          </div>`
            )
            .join("");

    return `
      <div class="dialog-overlay" id="dialog-overlay">
        <div class="dialog-box">
          <div class="dialog-header">
            <h2>Gerät hinzufügen</h2>
            <input type="text" class="dialog-search" id="dialog-search" placeholder="Suchen…" value="${this._addDialogFilter || ""}" />
          </div>
          <div class="dialog-list">${itemsHtml}</div>
          <div class="dialog-footer">
            <button class="dialog-close" id="dialog-close">Schließen</button>
          </div>
        </div>
      </div>
    `;
  }

  _attachListeners() {
    const root = this.shadowRoot;

    const menuBtn = root.getElementById("menu-toggle");
    if (menuBtn) {
      menuBtn.addEventListener("click", () => this._toggleSidebar());
    }

    const addBtn = root.getElementById("open-add-dialog");
    if (addBtn) {
      addBtn.addEventListener("click", () => this._openAddDialog());
    }

    root.querySelectorAll(".remove-btn").forEach((el) => {
      el.addEventListener("click", (e) => {
        const entityId = e.target.dataset.entity;
        if (confirm(`"${entityId}" aus Switch Planner entfernen?`)) {
          this._removeEntity(entityId);
        }
      });
    });

    if (this._addDialogOpen) {
      const overlay = root.getElementById("dialog-overlay");
      const closeBtn = root.getElementById("dialog-close");
      const searchEl = root.getElementById("dialog-search");

      if (overlay) {
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) this._closeAddDialog();
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener("click", () => this._closeAddDialog());
      }
      if (searchEl) {
        searchEl.focus();
        searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
        searchEl.addEventListener("input", (e) => {
          this._addDialogFilter = e.target.value;
          this._render();
        });
      }
      root.querySelectorAll(".dialog-item").forEach((el) => {
        el.addEventListener("click", () => {
          this._addEntity(el.dataset.entity);
          this._closeAddDialog();
        });
      });
    }

    root.querySelectorAll(".state-toggle").forEach((el) => {
      el.addEventListener("change", (e) => {
        this._toggleSwitch(e.target.dataset.entity, e.target.checked);
      });
    });

    root.querySelectorAll(".geo-toggle").forEach((el) => {
      el.addEventListener("change", (e) => {
        this._toggleGeo("device", e.target.dataset.entity, e.target.checked);
      });
    });

    root.querySelectorAll(".group-geo-toggle").forEach((el) => {
      el.addEventListener("change", (e) => {
        this._toggleGeo("group", e.target.dataset.group, e.target.checked);
      });
    });

    root.querySelectorAll(".group-select").forEach((el) => {
      el.addEventListener("change", (e) => {
        this._handleGroupSelectChange(e.target.dataset.entity, e.target.value);
      });
    });

    root.querySelectorAll(".group-name").forEach((el) => {
      el.addEventListener("click", (e) => {
        const groupId = e.target.dataset.group;
        const group = this._groups.find((g) => g.group_id === groupId);
        const newName = window.prompt("Neuer Gruppenname:", group ? group.name : "");
        if (newName && newName.trim()) {
          this._renameGroup(groupId, newName.trim());
        }
      });
    });

    root.querySelectorAll(".group-delete-btn").forEach((el) => {
      el.addEventListener("click", (e) => {
        const groupId = e.target.dataset.group;
        if (
          confirm(
            "Gruppe wirklich löschen? Die Geräte bleiben erhalten, verlieren aber den gemeinsamen Zeitplan."
          )
        ) {
          this._deleteGroup(groupId);
        }
      });
    });

    root.querySelectorAll(".add-schedule").forEach((el) => {
      el.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        this._addSchedule(btn.dataset.ownerType, btn.dataset.owner);
      });
    });

    root.querySelectorAll(".sched-daterange-toggle").forEach((el) => {
      el.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const ownerType = btn.dataset.ownerType;
        const ownerId = btn.dataset.owner;
        const index = parseInt(btn.dataset.index, 10);
        const owner = this._findOwner(ownerType, ownerId);
        const currentlyOn = !!(owner && owner.schedules[index].date_range_enabled);
        this._toggleScheduleDateRange(ownerType, ownerId, index, !currentlyOn);
      });
    });

    root.querySelectorAll(".weekday-btn").forEach((el) => {
      el.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const ownerType = btn.dataset.ownerType;
        const ownerId = btn.dataset.owner;
        const index = parseInt(btn.dataset.index, 10);
        const dayNum = parseInt(btn.dataset.day, 10);
        this._toggleScheduleWeekday(ownerType, ownerId, index, dayNum);
      });
    });

    root.querySelectorAll(".schedule-row").forEach((rowEl) => {
      const ownerType = rowEl.dataset.ownerType;
      const ownerId = rowEl.dataset.owner;
      const index = parseInt(rowEl.dataset.index, 10);

      const startEl = rowEl.querySelector(".sched-start");
      const endEl = rowEl.querySelector(".sched-end");
      const removeEl = rowEl.querySelector(".sched-remove");

      startEl.addEventListener("change", (e) => {
        this._updateScheduleField(ownerType, ownerId, index, "start", e.target.value);
        this._saveOwnerSchedules(ownerType, ownerId);
      });
      endEl.addEventListener("change", (e) => {
        this._updateScheduleField(ownerType, ownerId, index, "end", e.target.value);
        this._saveOwnerSchedules(ownerType, ownerId);
      });
      removeEl.addEventListener("click", () => {
        this._removeSchedule(ownerType, ownerId, index);
      });
    });

    root.querySelectorAll(".schedule-daterange").forEach((rangeEl) => {
      const ownerType = rangeEl.dataset.ownerType;
      const ownerId = rangeEl.dataset.owner;
      const index = parseInt(rangeEl.dataset.index, 10);

      const startDayEl = rangeEl.querySelector(".sched-date-start-day");
      const startMonthEl = rangeEl.querySelector(".sched-date-start-month");
      const endDayEl = rangeEl.querySelector(".sched-date-end-day");
      const endMonthEl = rangeEl.querySelector(".sched-date-end-month");

      startMonthEl.addEventListener("change", (e) => {
        const month = Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1));
        this._mutateOwner(ownerType, ownerId, (owner) => {
          const sched = owner.schedules[index];
          sched.date_start_month = month;
          sched.date_start_day = Math.min(sched.date_start_day || 1, daysInMonth(month));
        });
        this._saveOwnerSchedules(ownerType, ownerId);
      });
      startDayEl.addEventListener("change", (e) => {
        const month = parseInt(startMonthEl.value, 10) || 1;
        const day = Math.min(daysInMonth(month), Math.max(1, parseInt(e.target.value, 10) || 1));
        this._updateScheduleField(ownerType, ownerId, index, "date_start_day", day);
        this._saveOwnerSchedules(ownerType, ownerId);
      });
      endMonthEl.addEventListener("change", (e) => {
        const month = Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1));
        this._mutateOwner(ownerType, ownerId, (owner) => {
          const sched = owner.schedules[index];
          sched.date_end_month = month;
          sched.date_end_day = Math.min(sched.date_end_day || 1, daysInMonth(month));
        });
        this._saveOwnerSchedules(ownerType, ownerId);
      });
      endDayEl.addEventListener("change", (e) => {
        const month = parseInt(endMonthEl.value, 10) || 1;
        const day = Math.min(daysInMonth(month), Math.max(1, parseInt(e.target.value, 10) || 1));
        this._updateScheduleField(ownerType, ownerId, index, "date_end_day", day);
        this._saveOwnerSchedules(ownerType, ownerId);
      });
    });
  }
}

customElements.define("switch-planner-panel", SwitchPlannerPanel);
