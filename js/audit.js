'use strict';
(() => {
  const form = document.getElementById('auditFilters');
  const body = document.getElementById('auditEvents');
  const status = document.getElementById('auditStatus');
  const next = document.getElementById('auditNext');
  const first = document.getElementById('auditFirst');
  let nextBefore = null;
  let activeFilters = new URLSearchParams();
  let requestNumber = 0;
  const results = { SUCCESS: 'Erfolgreich', DENIED: 'Abgewiesen', FAILED: 'Fehlgeschlagen' };
  async function load(before = null) {
    const request = ++requestNumber;
    body.replaceChildren();
    next.disabled = first.disabled = true;
    status.textContent = 'Auditprotokoll wird geladen …';
    const params = new URLSearchParams(activeFilters);
    if (before) params.set('before', before);
    try {
      const response = await fetch(`api/audit_read.php?${params}`, { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (request !== requestNumber) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Auditprotokoll konnte nicht geladen werden.');
      const select = form.elements.action;
      if (select.options.length === 1) {
        for (const action of data.actions) select.add(new Option(action, action));
      }
      for (const event of data.events) {
        const row = document.createElement('tr');
        for (const value of [event.occurred_at, event.action,
          [results[event.result] || event.result, event.reason_code].filter(Boolean).join(' · '),
          [event.account_id, event.membership_id].filter(Boolean).join(' / '),
          [event.object_type, event.object_id].filter(Boolean).join(' / '), event.event_id]) {
          const cell = document.createElement('td');
          cell.textContent = value || '—';
          row.append(cell);
        }
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
