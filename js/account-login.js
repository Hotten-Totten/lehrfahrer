(() => {
  'use strict';

  const allowedTargets = new Set(['/', '/index.php', '/index.html', '/app/', '/app/index.html', '/hilfe/', '/academy/', '/platform-audit.html']);
  const requestedTarget = new URLSearchParams(window.location.search).get('next') || '/';
  const target = allowedTargets.has(requestedTarget) ? requestedTarget : '/';
  const manageMode = new URLSearchParams(window.location.search).get('mode') === 'manage';
  const form = document.getElementById('accountLoginForm');
  const loginInput = document.getElementById('accountLogin');
  const passwordInput = document.getElementById('accountPassword');
  const loginButton = document.getElementById('accountLoginButton');
  const membershipSection = document.getElementById('membershipSection');
  const mfaSection = document.getElementById('mfaSection');
  const mfaDescription = document.getElementById('mfaDescription');
  const mfaButton = document.getElementById('mfaButton');
  const membershipChoices = document.getElementById('membershipChoices');
  const accountSection = document.getElementById('accountSection');
  const activeCompany = document.getElementById('activeCompany');
  const accountDetails = document.getElementById('accountDetails');
  const passkeysSection = document.getElementById('passkeysSection');
  const passkeyManageButton = document.getElementById('passkeyManageButton');
  const passkeyList = document.getElementById('passkeyList');
  const passkeyHint = document.getElementById('passkeyHint');
  const newPasskeyName = document.getElementById('newPasskeyName');
  const addPasskeyButton = document.getElementById('addPasskeyButton');
  const continueTarget = document.getElementById('continueTarget');
  const switchCompany = document.getElementById('switchCompany');
  const message = document.getElementById('message');
  let csrfToken = '';
  let busy = false;
  let mfaPurpose = '';

  continueTarget.href = target;
  continueTarget.textContent = target.startsWith('/app/') ? 'Zur Fahrer-App'
    : (target === '/' || target.startsWith('/index.') ? 'Zum Editor' : 'Weiter');

  function show(section) {
    form.hidden = section !== 'login';
    membershipSection.hidden = section !== 'memberships';
    mfaSection.hidden = section !== 'mfa';
    accountSection.hidden = section !== 'account';
    passkeysSection.hidden = section !== 'passkeys';
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

  async function mfaRequest(action, payload = {}) {
    const response = await fetch(`api/auth/account_mfa.php?action=${action}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(payload)
    });
    return { response, body: await response.json().catch(() => ({})) };
  }

  function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(bytes, char => char.charCodeAt(0));
  }

  function encodeBase64Url(value) {
    const bytes = new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function showMfa(purpose) {
    mfaPurpose = purpose;
    mfaDescription.textContent = purpose === 'ENROLL'
      ? 'Für das Systemkonto ist ein Passkey erforderlich.'
      : 'Bitte bestätigen Sie die Anmeldung mit Ihrem Passkey.';
    mfaButton.textContent = purpose === 'ENROLL' ? 'Passkey einrichten' : 'Mit Passkey bestätigen';
    notice('');
    show('mfa');
  }

  async function passkeyRequest(action, method = 'GET', payload = null) {
    const options = { method, credentials: 'same-origin', cache: 'no-store' };
    if (method === 'POST') {
      options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
      options.body = JSON.stringify(payload || {});
    }
    const response = await fetch(`api/auth/account_passkeys.php?action=${action}`, options);
    return { response, body: await response.json().catch(() => ({})) };
  }

  function passkeyDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('de-DE') : 'Noch nicht verwendet';
  }

  async function loadPasskeys() {
    const { response, body } = await passkeyRequest('list');
    if (response.status === 401 || response.status === 403) { sessionExpired(); return; }
    if (!response.ok || !body.ok || !Array.isArray(body.passkeys)) {
      notice('Passkeys können derzeit nicht geladen werden.');
      return;
    }
    passkeyList.replaceChildren();
    const keys = body.passkeys;
    passkeyHint.textContent = keys.length <= 1
      ? 'Der letzte aktive Passkey kann nicht entfernt werden.' : '';
    for (const key of keys) {
      if (typeof key.id !== 'string' || typeof key.name !== 'string') continue;
      const card = document.createElement('div');
      card.className = 'passkey-card';
      const title = document.createElement('strong');
      title.textContent = key.name;
      const details = document.createElement('small');
      details.textContent = `Erstellt: ${passkeyDate(key.createdAt)} · Zuletzt verwendet: ${passkeyDate(key.lastUsedAt)} · ${key.status || 'Aktiv'}`;
      const actions = document.createElement('div');
      actions.className = 'passkey-actions';
      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'secondary';
      renameButton.textContent = 'Ändern';
      renameButton.addEventListener('click', () => {
        actions.replaceChildren();
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.maxLength = 120;
        nameInput.value = key.name;
        nameInput.setAttribute('aria-label', 'Passkey-Name');
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = 'Name speichern';
        saveButton.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          try {
            const result = await passkeyRequest('rename', 'POST', { id: key.id, name: nameInput.value });
            if (!result.response.ok || !result.body.ok) { notice('Name konnte nicht geändert werden.'); return; }
            await loadPasskeys();
            notice('Passkey-Name gespeichert.');
          } catch (_error) { notice('Name konnte nicht geändert werden.'); }
          finally { busy = false; }
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary';
        cancel.textContent = 'Abbrechen';
        cancel.addEventListener('click', () => { actions.replaceChildren(renameButton, removeButton); });
        actions.replaceChildren(nameInput, saveButton, cancel);
        nameInput.focus();
      });
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'secondary';
      removeButton.textContent = 'Entfernen';
      removeButton.disabled = keys.length <= 1;
      removeButton.addEventListener('click', () => {
        actions.replaceChildren();
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.textContent = 'Entfernen bestätigen';
        confirm.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          try {
            const result = await passkeyRequest('revoke', 'POST', { id: key.id });
            if (!result.response.ok || !result.body.ok) { notice('Passkey konnte nicht entfernt werden.'); return; }
            await loadPasskeys();
            notice('Passkey entfernt.');
          } catch (_error) { notice('Passkey konnte nicht entfernt werden.'); }
          finally { busy = false; }
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary';
        cancel.textContent = 'Abbrechen';
        cancel.addEventListener('click', () => { actions.replaceChildren(renameButton, removeButton); });
        actions.replaceChildren(confirm, cancel);
      });
      actions.append(renameButton, removeButton);
      card.append(title, details, actions);
      passkeyList.append(card);
    }
    show('passkeys');
    notice('');
  }

  async function addPasskey() {
    if (busy || !csrfToken) return;
    if (!window.PublicKeyCredential || !navigator.credentials) {
      notice('Dieser Browser unterstützt Passkeys nicht.');
      return;
    }
    const name = newPasskeyName.value.trim();
    if (!name) { notice('Bitte einen Namen für den Passkey eingeben.'); return; }
    busy = true;
    addPasskeyButton.disabled = true;
    try {
      const begun = await passkeyRequest('begin', 'POST', { name });
      if (!begun.response.ok || !begun.body.ok) { notice('Passkey konnte nicht gestartet werden.'); return; }
      const options = begun.body.options?.publicKey;
      if (!options || typeof options.challenge !== 'string') throw new Error('Invalid options');
      options.challenge = decodeBase64Url(options.challenge);
      options.user.id = decodeBase64Url(options.user.id);
      options.excludeCredentials = (options.excludeCredentials || []).map(item => ({
        ...item, id: decodeBase64Url(item.id)
      }));
      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential) throw new Error('No credential');
      const finished = await passkeyRequest('finish', 'POST', {
        id: encodeBase64Url(credential.rawId),
        clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
        attestationObject: encodeBase64Url(credential.response.attestationObject)
      });
      if (!finished.response.ok || !finished.body.ok) { notice('Passkey konnte nicht gespeichert werden.'); return; }
      newPasskeyName.value = '';
      await loadPasskeys();
      notice('Passkey hinzugefügt.');
    } catch (error) {
      notice(error?.name === 'NotAllowedError'
        ? 'Passkey-Vorgang abgebrochen. Sie können es erneut versuchen.'
        : 'Passkey konnte nicht hinzugefügt werden.');
    } finally {
      busy = false;
      addPasskeyButton.disabled = false;
    }
  }

  async function completeMfa() {
    if (busy || !csrfToken || !['ENROLL', 'AUTH'].includes(mfaPurpose)) return;
    if (!window.PublicKeyCredential || !navigator.credentials) {
      notice('Dieser Browser unterstützt Passkeys nicht.');
      return;
    }
    busy = true;
    mfaButton.disabled = true;
    notice('');
    try {
      const begun = await mfaRequest('begin');
      if (!begun.response.ok || !begun.body.ok || begun.body.purpose !== mfaPurpose) {
        notice('Sicherheitsprüfung konnte nicht gestartet werden. Bitte erneut anmelden.');
        return;
      }
      const options = begun.body.options?.publicKey;
      if (!options || typeof options.challenge !== 'string') throw new Error('Invalid options');
      options.challenge = decodeBase64Url(options.challenge);
      let credential;
      if (mfaPurpose === 'ENROLL') {
        options.user.id = decodeBase64Url(options.user.id);
        options.excludeCredentials = (options.excludeCredentials || []).map(item => ({
          ...item, id: decodeBase64Url(item.id)
        }));
        credential = await navigator.credentials.create({ publicKey: options });
      } else {
        options.allowCredentials = (options.allowCredentials || []).map(item => ({
          ...item, id: decodeBase64Url(item.id)
        }));
        credential = await navigator.credentials.get({ publicKey: options });
      }
      if (!credential) throw new Error('No credential');
      const response = credential.response;
      const payload = { id: encodeBase64Url(credential.rawId),
        clientDataJSON: encodeBase64Url(response.clientDataJSON) };
      if (mfaPurpose === 'ENROLL') payload.attestationObject = encodeBase64Url(response.attestationObject);
      else {
        payload.authenticatorData = encodeBase64Url(response.authenticatorData);
        payload.signature = encodeBase64Url(response.signature);
        payload.userHandle = response.userHandle ? encodeBase64Url(response.userHandle) : null;
      }
      const finished = await mfaRequest('finish', payload);
      if (!finished.response.ok || !finished.body.ok) {
        notice('Passkey-Bestätigung fehlgeschlagen. Bitte erneut versuchen.');
        return;
      }
      if (finished.body.enrolled === true) {
        csrfToken = '';
        mfaPurpose = '';
        show('login');
        notice('Passkey eingerichtet. Bitte melden Sie sich jetzt mit Passwort und Passkey neu an.');
      } else {
        mfaPurpose = '';
        await handleSession(finished.body);
      }
    } catch (error) {
      notice(error?.name === 'NotAllowedError'
        ? 'Passkey-Vorgang abgebrochen. Sie können es erneut versuchen.'
        : 'Sicherheitsprüfung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      busy = false;
      mfaButton.disabled = false;
    }
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
    accountDetails.replaceChildren();
    const platformAuditLink = document.getElementById('platformAuditLink');
    if (platformAuditLink) platformAuditLink.hidden = true;
    activeCompany.textContent = '';
    window.LehrfahrerTenantCache.clearForLogout().catch(() => {});
    show('login');
    notice('Sitzung abgelaufen. Bitte erneut anmelden.');
  }

  async function handleSession(body) {
    const platformAuditLink = document.getElementById('platformAuditLink');
    if (platformAuditLink) platformAuditLink.hidden = !(Array.isArray(body.platformCapabilities) && body.platformCapabilities.includes('platform.audit.read'));
    csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : '';
    if (body.context === 'TENANT') {
      continueTarget.hidden = false;
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
      activeCompany.textContent = body.companyName || current?.name || 'Aktive Gesellschaft';
      accountDetails.replaceChildren();
      const row = (label, value) => {
        if (!value) return;
        const item = document.createElement('div');
        item.textContent = `${label}: ${value}`;
        accountDetails.append(item);
      };
      row('Benutzer', body.displayName);
      row('Benutzernummer', body.userNumber);
      row('Gesellschaft', body.companyName || current?.name);
      row('Rolle', Array.isArray(body.tenantRoles) ? body.tenantRoles.join(' / ') : '');
      row('Plattformrolle', Array.isArray(body.platformRoles) ? body.platformRoles.join(' / ') : '');
      switchCompany.hidden = (memberships.body.memberships || []).length < 2;
      passkeyManageButton.hidden = !Array.isArray(body.platformRoles) || !body.platformRoles.includes('SYSOP');
      show('account');
      notice('');
      return;
    }
    if (body.context === 'PLATFORM') {
      await window.LehrfahrerTenantCache.clearForLogout();
      accountDetails.replaceChildren();
      activeCompany.textContent = 'Plattformkonto ohne aktive Firmenauswahl';
      continueTarget.hidden = true;
      switchCompany.hidden = true;
      passkeyManageButton.hidden = !Array.isArray(body.platformRoles) || !body.platformRoles.includes('SYSOP');
      show('account');
      notice('');
      return;
    }
    if (body.context === 'SELECTION_PENDING' || body.context === 'NO_MEMBERSHIP') {
      await window.LehrfahrerTenantCache.clearForLogout();
      accountDetails.replaceChildren();
      activeCompany.textContent = '';
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
      accountDetails.replaceChildren();
      activeCompany.textContent = '';
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
        login: loginInput.value, password: passwordInput.value,
        ...(document.getElementById('enrollmentCode')?.value
          ? { enrollmentCode: document.getElementById('enrollmentCode').value } : {})
      });
      passwordInput.value = '';
      const enrollmentInput = document.getElementById('enrollmentCode');
      if (enrollmentInput) enrollmentInput.value = '';
      if (!response.ok || !body.ok) {
        notice('Anmeldung nicht möglich. Bitte Loginname und Passwort prüfen.');
        return;
      }
      if (body.mfaPending === true && ['ENROLL', 'AUTH'].includes(body.purpose)) {
        csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : '';
        showMfa(body.purpose);
        return;
      }
      await handleSession(body);
    } catch (_error) {
      passwordInput.value = '';
      const enrollmentInput = document.getElementById('enrollmentCode');
      if (enrollmentInput) enrollmentInput.value = '';
      notice('Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.');
    } finally {
      busy = false;
      loginButton.disabled = false;
    }
  });

  document.getElementById('membershipLogout').addEventListener('click', logout);
  mfaButton.addEventListener('click', completeMfa);
  document.getElementById('mfaCancel').addEventListener('click', () => {
    csrfToken = '';
    mfaPurpose = '';
    show('login');
    notice('Sicherheitsprüfung abgebrochen. Bitte erneut anmelden.');
  });
  document.getElementById('accountLogout').addEventListener('click', logout);
  passkeyManageButton.addEventListener('click', () => loadPasskeys().catch(() => {
    notice('Passkeys können derzeit nicht geladen werden.');
  }));
  addPasskeyButton.addEventListener('click', addPasskey);
  document.getElementById('passkeysBack').addEventListener('click', () => { show('account'); notice(''); });
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
