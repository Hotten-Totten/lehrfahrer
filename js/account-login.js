(() => {
  'use strict';

  const allowedTargets = new Set(['/', '/index.php', '/index.html', '/app/', '/app/index.html', '/hilfe/', '/academy/']);
  const requestedTarget = new URLSearchParams(window.location.search).get('next') || '/';
  const target = allowedTargets.has(requestedTarget) ? requestedTarget : '/';
  const manageMode = new URLSearchParams(window.location.search).get('mode') === 'manage';
  const form = document.getElementById('accountLoginForm');
  const loginInput = document.getElementById('accountLogin');
  const passwordInput = document.getElementById('accountPassword');
  const loginButton = document.getElementById('accountLoginButton');
  const membershipSection = document.getElementById('membershipSection');
  const membershipChoices = document.getElementById('membershipChoices');
  const accountSection = document.getElementById('accountSection');
  const activeCompany = document.getElementById('activeCompany');
  const continueTarget = document.getElementById('continueTarget');
  const switchCompany = document.getElementById('switchCompany');
  const message = document.getElementById('message');
  let csrfToken = '';
  let busy = false;

  continueTarget.href = target;
  continueTarget.textContent = target.startsWith('/app/') ? 'Zur Fahrer-App'
    : (target === '/' || target.startsWith('/index.') ? 'Zum Editor' : 'Weiter');

  function show(section) {
    form.hidden = section !== 'login';
    membershipSection.hidden = section !== 'memberships';
    accountSection.hidden = section !== 'account';
    if (section === 'login') loginInput.focus();
  }

  function notice(text) {
    message.textContent = text;
  }

  async function request(action, method = 'GET', payload = null) {
    const options = { method, credentials: 'same-origin', cache: 'no-store' };
    if (method === 'POST') {
      options.headers = { 'Content-Type': 'application/json' };
      if (action !== 'login') options.headers['X-CSRF-Token'] = csrfToken;
      options.body = JSON.stringify(payload || {});
    }
    const response = await fetch(`api/auth/account_test.php?action=${action}`, options);
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  async function expiredAfterRejection(response) {
    if (response.status === 401) { sessionExpired(); return true; }
    if (response.status !== 403) return false;
    try {
      const current = await request('me');
      if (current.response.status === 401) { sessionExpired(); return true; }
    } catch (_error) { /* Der nächste Aufruf prüft die Sitzung erneut. */ }
    return false;
  }

  async function renderMemberships(action) {
    const { response, body } = await request('memberships');
    if (await expiredAfterRejection(response)) return;
    if (!response.ok || !body.ok || !Array.isArray(body.memberships)) {
      notice('Gesellschaftsauswahl ist derzeit nicht möglich.');
      return;
    }
    membershipChoices.replaceChildren();
    const choices = (action === 'switch'
      ? body.memberships.filter(item => item.id !== body.currentMembershipId)
      : body.memberships).filter(item => typeof item.id === 'string' && typeof item.name === 'string');
    for (const item of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.name;
      button.addEventListener('click', () => chooseMembership(action, item.id));
      membershipChoices.append(button);
    }
    if (!choices.length) notice(action === 'switch'
      ? 'Keine weitere Gesellschaft verfügbar.'
      : 'Für dieses Benutzerkonto ist derzeit keine Gesellschaft freigeschaltet.');
    else notice('');
    document.getElementById('membershipTitle').textContent = action === 'switch'
      ? 'Gesellschaft wechseln' : 'Gesellschaft auswählen';
    show('memberships');
  }

  function sessionExpired() {
    csrfToken = '';
    membershipChoices.replaceChildren();
    window.LehrfahrerTenantCache.clearForLogout().catch(() => {});
    show('login');
    notice('Sitzung abgelaufen. Bitte erneut anmelden.');
  }

  async function handleSession(body) {
    csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : '';
    if (body.context === 'TENANT') {
      await window.LehrfahrerTenantCache.applyValidatedContext(body, 'account');
      if (!manageMode) {
        window.location.replace(target);
        return;
      }
      const memberships = await request('memberships');
      if (await expiredAfterRejection(memberships.response)) return;
      if (!memberships.response.ok || !memberships.body.ok) {
        notice('Kontoinformationen sind derzeit nicht verfügbar.');
        return;
      }
      const current = (memberships.body.memberships || []).find(
        item => item.id === memberships.body.currentMembershipId);
      activeCompany.textContent = current?.name || 'Aktive Gesellschaft';
      switchCompany.hidden = (memberships.body.memberships || []).length < 2;
      show('account');
      notice('');
      return;
    }
    if (body.context === 'SELECTION_PENDING' || body.context === 'NO_MEMBERSHIP') {
      await window.LehrfahrerTenantCache.clearForLogout();
      await renderMemberships('select');
      return;
    }
    sessionExpired();
  }

  async function chooseMembership(action, membershipId) {
    if (busy || !csrfToken) return;
    busy = true;
    try {
      const { response, body } = await request(action, 'POST', { membershipId });
      if (await expiredAfterRejection(response)) return;
      if (!response.ok || !body.ok || body.context !== 'TENANT' || !body.contextChanged) {
        notice('Gesellschaft konnte nicht ausgewählt werden.');
        return;
      }
      csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : '';
      await window.LehrfahrerTenantCache.applyValidatedContext(body, 'account');
      window.location.replace(target);
    } catch (_error) {
      notice('Gesellschaft konnte nicht ausgewählt werden.');
    } finally {
      busy = false;
    }
  }

  async function logout() {
    if (busy || !csrfToken) return;
    busy = true;
    try {
      const { response, body } = await request('logout', 'POST');
      if (await expiredAfterRejection(response)) return;
      if (!response.ok || !body.ok) {
        notice('Abmelden ist derzeit nicht möglich.');
        return;
      }
      csrfToken = '';
      await window.LehrfahrerTenantCache.clearForLogout();
      window.location.replace('account-login.php');
    } catch (_error) {
      notice('Abmelden ist derzeit nicht möglich.');
    } finally {
      busy = false;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    loginButton.disabled = true;
    notice('');
    try {
      const { response, body } = await request('login', 'POST', {
        login: loginInput.value, password: passwordInput.value
      });
      passwordInput.value = '';
      if (!response.ok || !body.ok) {
        notice('Anmeldung nicht möglich. Bitte Loginname und Passwort prüfen.');
        return;
      }
      await handleSession(body);
    } catch (_error) {
      passwordInput.value = '';
      notice('Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.');
    } finally {
      busy = false;
      loginButton.disabled = false;
    }
  });

  document.getElementById('membershipLogout').addEventListener('click', logout);
  document.getElementById('accountLogout').addEventListener('click', logout);
  switchCompany.addEventListener('click', () => renderMemberships('switch').catch(() => {
    notice('Gesellschaftsauswahl ist derzeit nicht möglich.');
  }));

  request('me').then(({ response, body }) => {
    if (response.ok && body.ok) return handleSession(body);
    show('login');
  }).catch(() => {
    show('login');
    notice('Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.');
  });
  fetch('api/auth/runtime.php', { cache: 'no-store', credentials: 'same-origin' })
    .then(response => response.json()).then(body => {
      if (!body.ok) return;
      const info = body.runtime || {};
      document.getElementById('environment').textContent = info.environmentLabel || 'STAGING';
      document.getElementById('runtime').textContent = [info.version, info.commit, info.buildId].filter(Boolean).join(' · ');
    }).catch(() => {});
})();
