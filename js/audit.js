'use strict';
(() => {
  const platformView = document.body.dataset.auditScope === 'platform';
  const endpoint = platformView ? 'api/platform_audit_read.php' : 'api/audit_read.php';
  const contexts = {TENANT:'Firmenbereich',PLATFORM:'Plattformbereich',PREAUTH:'Anmeldeprüfung',SYSTEM:'Systemvorgang'};
  const form = document.getElementById('auditFilters');
  const body = document.getElementById('auditEvents');
  const status = document.getElementById('auditStatus');
  const next = document.getElementById('auditNext');
  const first = document.getElementById('auditFirst');
  let nextBefore = null;
  let activeFilters = new URLSearchParams();
  let requestNumber = 0;
  const results = { SUCCESS: 'Erfolgreich', DENIED: 'Abgewiesen', FAILED: 'Fehlgeschlagen' };
  const actions = {
    AUTH_LOGIN: 'Angemeldet', AUTH_LOGOUT: 'Abgemeldet', AUTH_SESSION_REVOKE: 'Anmeldung beendet',
    AUTH_MFA: 'Zusätzliche Anmeldeprüfung', AUTH_MFA_PENDING: 'Zusätzliche Anmeldeprüfung angefordert',
    AUTH_CONTEXT_CHANGE: 'Anmeldebereich gewechselt', AUTH_PASSKEY_REGISTER: 'Passkey eingerichtet',
    AUTH_PASSKEY_RENAME: 'Passkey umbenannt', AUTH_PASSKEY_REVOKE: 'Passkey entfernt', AUTH_PASSKEY_MANAGE: 'Passkeys verwaltet',
    ACCOUNT_CREATE: 'Benutzerkonto angelegt', ACCOUNT_CHANGE: 'Benutzerkonto geändert', ACCOUNT_DEACTIVATE: 'Benutzerkonto deaktiviert',
    MEMBERSHIP_CHANGE: 'Firmenzuordnung geändert', TENANT_ROLE_CHANGE: 'Firmenrolle geändert', TENANT_ROLE_ASSIGN: 'Firmenrolle zugewiesen',
    PLATFORM_ROLE_CHANGE: 'Plattformrolle geändert', SYSOP_CHANGE: 'Systemadministrator geändert', PASSKEY_CHANGE: 'Passkey geändert',
    ROUTE_SAVE: 'Route gespeichert', ROUTE_DELETE: 'Route gelöscht', ROUTE_CREATE: 'Route angelegt', ROUTE_CHANGE: 'Route geändert',
    ROUTE_REVIEW: 'Route geprüft', ROUTE_AUTO_DOWNGRADE: 'Routenstatus automatisch zurückgestuft',
    ROUTE_ARTIFACT_REPAIR: 'Routendateien repariert', GTFS_WORK_START: 'Fahrplanbearbeitung begonnen',
    ROUTE_STATUS_CHANGE: 'Routenstatus geändert', ROUTE_RELEASE: 'Route freigegeben', ROUTE_RELEASE_REVOKE: 'Routenfreigabe zurückgenommen',
    DRIVER_CREATE: 'Person angelegt', DRIVER_CHANGE: 'Person geändert', DRIVER_STATUS_CHANGE: 'Person aktiviert / deaktiviert', DRIVER_DELETE: 'Person gelöscht',
    TRAINING_CREATE: 'Einweisung angelegt', TRAINING_CHANGE: 'Einweisung geändert', TRAINING_STATUS_CHANGE: 'Einweisungsstatus geändert',
    TRAINING_ROUTE_COMPLETE: 'Linie einer Einweisung abgeschlossen', PACKAGE_DELETE: 'Einweisungspaket gelöscht',
    PACKAGE_CREATE: 'Einweisungspaket erstellt', PACKAGE_CHANGE: 'Einweisungspaket geändert', PACKAGE_DOWNLOAD: 'Paketdownload bereitgestellt',
    SETTING_CHANGE: 'Betriebseinstellung geändert', SECURITY_DENIAL: 'Zugriff abgewiesen', SYSTEM_CHANGE: 'Systemeinstellung geändert'
  };
  const types = { SESSION: 'Anmeldung', PASSKEY: 'Passkey', ACCOUNT: 'Benutzerkonto', MEMBERSHIP: 'Firmenzuordnung',
    ROUTE: 'Route', DRIVER: 'Person', TRAINING: 'Einweisung', PACKAGE: 'Einweisungspaket', SETTING: 'Betriebseinstellung', SYSTEM: 'System' };
  const reasons = { INVALID_CREDENTIALS: 'Anmeldedaten ungültig', MFA_REJECTED: 'Zusätzliche Anmeldeprüfung abgewiesen',
    EXPIRED: 'Gültigkeit abgelaufen', FORBIDDEN: 'Berechtigung fehlt', CSRF_REJECTED: 'Sicherheitsprüfung abgewiesen',
    NOT_FOUND: 'Eintrag nicht gefunden', INVALID_INPUT: 'Eingabe ungültig', CONFLICT: 'Widersprüchlicher Bearbeitungsstand',
    STORAGE_FAILURE: 'Speicherfehler', INTERNAL_FAILURE: 'Interner Fehler', ACCOUNT_DISABLED: 'Benutzerkonto deaktiviert',
    ACCOUNT_LOCKED: 'Benutzerkonto gesperrt', CHALLENGE_REPLAY: 'Anmeldeprüfung bereits verwendet' };
  function cell(row, text) {
    const td = document.createElement('td'); td.textContent = text || '—'; row.append(td); return td;
  }
  function readableTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Zeitangabe nicht verfügbar' : new Intl.DateTimeFormat('de-DE', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(date) + ' UTC';
  }
  const actionSearch = document.getElementById('auditActionSearch');
  const actionHint = document.getElementById('auditActionHint');
  let availableActions = [];
  const actionLabel = action => actions[action] || 'Weiteres Ereignis (' + action + ')';
  const searchText = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE').replace(/ß/g, 'ss');
  function updateActionOptions() {
    const select = form.elements.action;
    const selected = select.value;
    const term = searchText(actionSearch.value.trim());
    const matches = availableActions.filter(action => searchText(actionLabel(action) + ' ' + action).includes(term));
    const shown = availableActions.filter(action => matches.includes(action) || action === selected);
    select.replaceChildren(new Option('Alle Ereignisarten', ''));
    for (const action of shown) select.add(new Option(actionLabel(action), action));
    select.value = selected;
    const retained = selected && !matches.includes(selected);
    actionHint.textContent = term
      ? `${matches.length} passende Ereignisarten. ${retained ? 'Die bisherige Auswahl bleibt zusätzlich sichtbar. ' : ''}Ereignisart auswählen und anwenden.`
      : 'Alphabetisch sortiert. Suchbegriff eingeben, dann eine Ereignisart auswählen.';
  }
  actionSearch.addEventListener('input', updateActionOptions);
  form.elements.action.addEventListener('change', updateActionOptions);
  async function load(before = null) {
    const request = ++requestNumber;
    body.replaceChildren();
    next.disabled = first.disabled = true;
    status.textContent = 'Auditprotokoll wird geladen …';
    const params = new URLSearchParams(activeFilters);
    if (before) params.set('before', before);
    try {
      const response = await fetch(`${endpoint}?${params}`, { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (request !== requestNumber) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Auditprotokoll konnte nicht geladen werden.');
      if (platformView && data.accessContext !== 'PLATFORM') throw new Error('Plattformkontext konnte nicht bestätigt werden.');
      availableActions = [...data.actions].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), 'de-DE'));
      updateActionOptions();
      for (const event of data.events) {
        const row = document.createElement('tr');
        cell(row, readableTime(event.occurred_at));
        if (platformView) cell(row,contexts[event.context_type] || 'Unbekannter Kontext');
        const activity = cell(row, actions[event.action] || 'Weiteres Ereignis');
        if (event.action === 'PACKAGE_DOWNLOAD') {
          const note = document.createElement('small');
          note.textContent = 'Der Server hat den Download erlaubt und die Datei bereitgestellt. Ob sie beim Empfänger angekommen ist, wird nicht bestätigt.';
          activity.append(note);
        }
        cell(row, results[event.result] || 'Unbekanntes Ergebnis');
        cell(row, types[event.object_type] || 'Allgemeiner Vorgang');
        const detailCell = cell(row, ''); detailCell.textContent = '';
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'Technische Details'; details.append(summary);
        const list = document.createElement('dl');
        for (const [label, value] of [['Ereigniscode', event.action], ['Benutzerkonto-Kennung', event.account_id],
          ['Firmenzuordnungs-Kennung', event.membership_id], ['Eintragskennung', event.object_id],
          ['Firmenkennung', platformView ? event.company_id : null], ['Protokollkennung', event.event_id], ['Grund', reasons[event.reason_code] || event.reason_code]]) {
          if (!value) continue;
          const term = document.createElement('dt'); term.textContent = label;
          const description = document.createElement('dd'); description.textContent = value;
          list.append(term, description);
        }
        details.append(list);
        if (platformView) {
          const note = document.createElement('small');
          note.textContent = 'Identitäts- und Objektkennungen sind in der Plattformansicht ausgeblendet.';
          details.append(note);
        }
        detailCell.append(details);
        body.append(row);
      }
      nextBefore = data.nextBefore;
      next.disabled = !nextBefore;
      status.textContent = data.events.length ? `${data.events.length} Einträge auf dieser Seite.` : 'Keine passenden Ereignisse vorhanden.';
    } catch (error) {
      if (request !== requestNumber) return;
      nextBefore = null;
      status.textContent = error.message;
    } finally {
      if (request === requestNumber) first.disabled = false;
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    activeFilters = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (value) activeFilters.set(key, value);
    load();
  });
  first.addEventListener('click', () => load());
  next.addEventListener('click', () => { if (nextBefore) load(nextBefore); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  load();
})();
