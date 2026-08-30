# Switch Planner (Home Assistant Custom Integration)

**Version 0.2.3**

Eine eigene Integration für Home Assistant mit eigenem Sidebar-Panel:

1. **Manuell auswählbare Geräte** – die Tabelle zeigt standardmäßig nichts
   an; über den Button **"+ Hinzufügen"** öffnet sich ein Auswahldialog mit
   Suche über alle verfügbaren schaltbaren Geräte (Domains `switch`,
   `light`, `fan`, `siren`, `input_boolean`). Jede Zeile lässt sich über das
   Papierkorb-Symbol wieder entfernen. Bewusst **nicht** in der
   Verfügbarkeits-Liste enthalten: `climate`, `cover`, `lock`,
   `media_player`, `valve` – die haben kein reines On/Off-Modell bzw.
   eigene Sicherheitslogik. Erweiterbar in `const.py`
   (`SWITCHABLE_DOMAINS`).
2. **Verbindungsprotokoll** – zeigt, über welche Integration/welches Protokoll
   der Schalter angebunden ist (Zigbee, Z-Wave, MQTT, WLAN, Matter, …), anhand
   der Geräte-/Config-Entry-Zuordnung; unbekannte Integrationen werden mit
   ihrem Domain-Namen angezeigt (leicht erweiterbar in `const.py`, `PROTOCOL_MAP`)
3. **Toggle** zum direkten Ein-/Ausschalten jedes Schalters
4. **Aktiv-Zeitfenster** pro Schalter, beliebig viele (z. B. 08:00–20:00) –
   das Gerät wird **automatisch eingeschaltet**, sobald ein Zeitfenster
   beginnt, und **automatisch ausgeschaltet**, sobald es keins mehr trifft
   (Prüfung minütlich, auch über Mitternacht hinweg möglich). Die Uhrzeit
   gilt in der in Home Assistant konfigurierten Zeitzone
   (**Einstellungen → System → Allgemein**) – eine separate
   Zeitzonenauswahl je Zeitfenster gibt es bewusst nicht. Jedes Zeitfenster
   kann zusätzlich optional auf eine **Datumsspanne** (nur Monat/Tag,
   **ohne Jahr**, also jährlich wiederkehrend) eingeschränkt werden
   (📅-Button neben dem Zeitfenster) – z. B. "nur von Juni bis
   August" oder "nur von Dezember bis Januar" (Spannen über den
   Jahreswechsel werden korrekt behandelt). Ist keine Datumsspanne
   aktiviert, gilt das Zeitfenster wie bisher an jedem Tag im Jahr.
   Zusätzlich lassen sich unter jedem Zeitfenster einzelne **Wochentage**
   (Mo–So) auswählen, an denen es aktiv sein soll – ist keiner ausgewählt,
   gilt das Zeitfenster wie bisher an jedem Wochentag. Über Mitternacht
   gehende Zeitfenster (z. B. Fr 22:00–06:00) werden dabei korrekt dem
   Start-Wochentag zugeordnet, auch für den Teil nach Mitternacht.
5. **Geo-Automatik** – Checkbox pro Schalter (bzw. pro Gruppe): Wenn
   aktiviert, wird das Gerät **automatisch ausgeschaltet, sobald niemand
   der überwachten Personen/Tracker mehr in der "zuhause"-Zone ist**, und
   **automatisch eingeschaltet, sobald wieder jemand zuhause ist** – auch
   wenn zuvor schon jemand da war und nur eine weitere Person dazukommt
   oder geht, wird korrekt neu bewertet ("mindestens eine Person zuhause"
   reicht). In den Integrations-Optionen lassen sich beliebig viele
   Personen/Geräte-Tracker als Teilnehmer auswählen (leer = Funktion
   deaktiviert).
6. **Navigation im Panel**: Ein ☰-Menü-Button oben links öffnet die
   Home-Assistant-Sidebar/Navigation – wichtig vor allem in der
   Smartphone-App, wo sonst kein Weg aus dem Panel heraus sichtbar ist.
7. **Gruppen**: In der Geräte-Tabelle lässt sich jedes Gerät über die
   Spalte "Gruppe" einer Gruppe zuweisen (bestehende auswählen oder über
   "+ Neue Gruppe…" neu anlegen). Alle Geräte einer Gruppe teilen sich
   **einen** Zeitplan (Zeitfenster inkl. Wochentage/Datumsspanne) sowie
   eine gemeinsame Geo-Automatik-Einstellung. Sobald ein Gerät einer
   Gruppe zugeordnet ist, verschwindet es aus der Geräte-Tabelle und
   erscheint stattdessen **ausschließlich** in der Tabelle seiner Gruppe
   (Übersichtlichkeit) – sein zuvor gesetzter individueller Zeitplan
   bleibt dabei im Hintergrund gespeichert, falls es später wieder aus
   der Gruppe entfernt wird. Die Gruppen-Tabelle ist **genauso
   aufgebaut wie die Geräte-Tabelle** (gleiche Spalten); Zeitfenster und
   Geo-Automatik werden dort einmal pro Gruppe angezeigt/bearbeitet
   (gilt für alle Zeilen). Der Gruppenname lässt sich per Klick auf den
   Titel umbenennen; beim Löschen einer Gruppe bleiben die Geräte
   erhalten, verlieren aber den gemeinsamen Zeitplan (werden wieder
   eigenständig und erscheinen wieder in der Geräte-Tabelle).
8. **Gerätename statt Entitätenname**: Überall wird, wenn vorhanden, der
   Name des zugehörigen Geräts (aus der Geräte-Registrierung, z. B.
   "Zwischenstecker Küche") angezeigt statt des oft kryptischeren
   Entitätennamens. Nur bei Entitäten ohne zugehöriges Gerät (z. B.
   `input_boolean`-Helfer) wird auf den Entitätennamen zurückgegriffen.

## Installation

1. Ordner `custom_components/switch_planner` in dein Home-Assistant-Konfig-
   verzeichnis kopieren, sodass am Ende
   `<config>/custom_components/switch_planner/__init__.py` existiert.
2. Home Assistant neu starten.
3. **Einstellungen → Geräte & Dienste → Integration hinzufügen** → nach
   "Switch Planner" suchen → hinzufügen.
4. Optional: In den Integrations-Optionen (**Konfigurieren**) beliebig
   viele Personen/Geräte-Tracker auswählen, deren Anwesenheit die
   Geo-Automatik steuert, sowie die "zuhause"-Zone festlegen (Standard:
   `zone.home`). Ohne Auswahl bleibt die Geo-Automatik inaktiv.
5. In der Sidebar erscheint der neue Punkt **"Switch Planner"** mit der
   Tabelle.

## Hinweise

- **Zusammenspiel Zeitfenster + Geo-Automatik:** Beide Mechanismen werden
  gemeinsam ausgewertet, damit sie sich nicht gegenseitig widersprechen.
  Priorität: Ist die Geo-Automatik aktiv und **niemand** zuhause, wird ein
  Gerät **immer** ausgeschaltet – auch wenn gerade ein Zeitfenster aktiv
  wäre. Ist (wieder) jemand zuhause, entscheidet zusätzlich weiterhin das
  Zeitfenster (falls eines gesetzt ist): nur innerhalb des Zeitfensters
  UND bei Anwesenheit wird eingeschaltet. Ohne gesetztes Zeitfenster
  schaltet die Geo-Automatik allein anhand der Anwesenheit.
- **Achtung, geändertes Verhalten:** Sobald mindestens ein Zeitfenster für
  ein Gerät gesetzt ist, wird es nicht mehr nur ausgeschaltet, sondern
  aktiv **ein- und ausgeschaltet** – das Gerät folgt also vollautomatisch
  dem Zeitfenster, auch ohne manuelles Zutun. Geräte ganz ohne Zeitfenster
  bleiben unangetastet und lassen sich weiterhin frei manuell schalten.
- Nur manuell hinzugefügte Geräte werden verwaltet/überwacht (Zeitplan-
  Durchsetzung, Geo-Automatik). Ein entferntes Gerät verliert dabei auch
  seine gespeicherten Zeitpläne/Einstellungen.
- Die Speicherstruktur wurde um Gruppen erweitert
  (`{"devices": {...}, "groups": {...}}`). Ältere Installationen (flaches
  `entity_id -> config`-Format) werden beim ersten Start automatisch
  migriert – keine manuelle Aktion nötig.
- Die Geo-Automatik-Option wurde von einer einzelnen Person/Tracker auf
  eine Mehrfachauswahl umgestellt (Optionsfeld `tracked_entities` statt
  `tracked_entity`). Bereits gesetzte alte Einzel-Optionen werden beim
  Öffnen der Integrations-Optionen automatisch übernommen.
- Ein/Aus-Befehle (Toggle, Zeitplan-Durchsetzung, Geo-Automatik) rufen
  automatisch den Service der jeweiligen Entitäts-Domain auf
  (`light.turn_off`, `fan.turn_off`, `input_boolean.turn_off`, …), nicht
  hart `switch.turn_off`.
- `input_boolean` hat kein physisches Gerät/Protokoll dahinter und wird
  daher als "Lokal (Helper)" angezeigt.
- Die Zeitfenster-Prüfung läuft serverseitig jede Minute (`async_track_time_interval`).
  Das reicht für die meisten Anwendungsfälle; für sekundengenaue Schaltungen
  müsste das Intervall verkürzt werden.
- Die Konfiguration (Zeitpläne, Geo-Flag) wird über den Home-Assistant-
  `Store`-Mechanismus persistiert (`.storage/switch_planner.entities`), bleibt
  also über Neustarts erhalten.
- Für die Rechteanforderung `require_admin=True` muss der aufrufende Benutzer
  Admin-Rechte haben, damit das Panel sichtbar ist.

## Als ZIP für HACS (Custom Repository)

Das mitgelieferte ZIP kann direkt in `custom_components/` entpackt werden.
Für eine "echte" HACS-Distribution über ein eigenes GitHub-Repository müsste
zusätzlich noch `hacs.json` im Wurzelverzeichnis des Repos angelegt werden –
das ist hier bewusst weggelassen, da es kein lokaler Installationsschritt ist.
