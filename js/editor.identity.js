(() => {
  'use strict';

  const status = document.getElementById('apiTokenStatus');
  const details = document.getElementById('accountContextDetails');
  if (!status) return;

  function labels(values) {
    return Array.isArray(values) ? values.filter(value => typeof value === 'string' && value.trim()) : [];
  }

  function renderIdentity(data) {
    if (!data || !data.company) { renderUnavailable(); return; }
    const tenantRoles = labels(data.tenantRoles);
    const platformRoles = labels(data.platformRoles);
    status.replaceChildren();
    status.classList.add('identity-status');
    status.classList.remove('identity-unavailable', 'token-status-off');
    status.classList.add('token-status-on');
    const add = (value, className) => {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = value;
      status.append(span);
    };
    add(data.company, 'identity-company');
    if (tenantRoles.length) {
      add(' · ', 'identity-role-separator');
      add(tenantRoles.join(' / '), 'identity-tenant-role');
    }
    if (platformRoles.length) {
      add(' | ', 'identity-platform-separator');
      add(platformRoles.join(' / '), 'identity-platform-role');
    }
    if (data.number) {
      add(' · ', 'identity-number-separator');
      add(data.number, 'identity-number');
    }
    status.title = status.textContent;
    if (details && data.account) {
      details.replaceChildren();
      const row = (name, value) => {
        if (!value) return;
        const item = document.createElement('div');
        item.textContent = `${name}: ${value}`;
        details.append(item);
      };
      row('Benutzer', data.name);
      row('Benutzernummer', data.number);
      row('Gesellschaft', data.company);
      row('Rolle', tenantRoles.join(' / '));
      row('Plattformrolle', platformRoles.join(' / '));
      details.hidden = false;
    }
  }

  function renderUnavailable() {
    status.replaceChildren();
    status.classList.remove('identity-status', 'token-status-on');
    status.classList.add('identity-unavailable', 'token-status-off');
    status.textContent = 'Sitzung: nicht aktiv';
    status.title = 'Kein bestätigter Benutzerkontext';
    if (details) { details.replaceChildren(); details.hidden = true; }
  }

  async function getSession(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    return { status: response.status, body: response.ok ? await response.json() : null };
  }

  async function refreshIdentity() {
    const account = await getSession('api/auth/account_test.php?action=me');
    if (account.status === 200 && account.body?.ok) {
      const body = account.body;
      if (body.context !== 'TENANT') { renderUnavailable(); return; }
      renderIdentity({ account: true, name: body.displayName,
        company: body.companyName, tenantRoles: body.tenantRoles,
        platformRoles: body.platformRoles, number: body.userNumber });
      return;
    }
    if (account.status !== 401 && account.status !== 404) { renderUnavailable(); return; }
    const legacy = await getSession('api/auth/me.php');
    if (legacy.status !== 200 || !legacy.body?.ok) { renderUnavailable(); return; }
    renderIdentity({ account: false, company: legacy.body.company?.name,
      tenantRoles: legacy.body.user?.roles, platformRoles: [], number: null });
  }

  refreshIdentity().catch(renderUnavailable);
})();
