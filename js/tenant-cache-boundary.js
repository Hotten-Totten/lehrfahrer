(() => {
  'use strict';

  const KEY = 'lehrfahrer_verified_local_context_v2';
  const TENANT_KEYS = [
    'linieneditor_autosave_v1', 'lehrfahrer_last_save_target',
    'lehrfahrer_gtfs_index_agency_filter', 'lehrfahrer_gtfs_import_agency_filter',
    'lehrfahrer-lines-catalog-version', 'lehrfahrer-dismissed-lines-update',
    'lehrfahrer-active-drive', 'lehrfahrer_vbb_access_id', 'lehrfahrer_api_token'
  ];
  const DB_NAME = 'lehrfahrer-offline';
  let applying = Promise.resolve();
  let pendingVerification = 0;

  function readContext() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || 'null');
      return value?.version === 2 && ['account', 'legacy'].includes(value.mode)
        && typeof value.principal === 'string' && value.principal
        && typeof value.company === 'string' && value.company
        && typeof value.membership === 'string' ? value : null;
    } catch { return null; }
  }

  function removeTenantKeys() {
    for (const key of TENANT_KEYS) localStorage.removeItem(key);
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith('lf-tenant-v2:')) localStorage.removeItem(key);
    }
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('lf_startup_download_done_') || key === 'lf_storage_persist_attempted') {
        sessionStorage.removeItem(key);
      }
    }
  }

  async function removeBrowserCaches() {
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Lokaler Linienspeicher ist noch in einem anderen Tab geöffnet.'));
      });
    }
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        if (name.startsWith('lehrfahrer-api-') && !await caches.delete(name)) {
          throw new Error('Lokaler API-Cache konnte nicht entfernt werden.');
        }
      }
    }
  }

  async function purgeTenantData() {
    // Invalidation is synchronous and reaches other tabs before async deletion.
    localStorage.removeItem(KEY);
    removeTenantKeys();
    await removeBrowserCaches();
  }

  function normalizeContext(body, mode) {
    if (mode === 'account' && body?.ok === true && body?.context === 'TENANT'
      && typeof body.accountId === 'string' && body.accountId
      && typeof body.companyId === 'string' && body.companyId
      && typeof body.membershipId === 'string' && body.membershipId) {
      return { version: 2, mode, principal: body.accountId,
        company: body.companyId, membership: body.membershipId };
    }
    if (mode === 'legacy' && body?.ok === true && typeof body?.user?.id === 'string'
      && typeof body?.company?.id === 'string') {
      return { version: 2, mode, principal: body.user.id,
        company: body.company.id, membership: '' };
    }
    return null;
  }

  function applyValidatedContext(body, mode) {
    const next = normalizeContext(body, mode);
    if (!next) return Promise.reject(new Error('Bestätigter Mandantenkontext fehlt.'));
    applying = applying.catch(() => {}).then(async () => {
      const current = readContext();
      if (!current || current.mode !== next.mode || current.principal !== next.principal
        || current.company !== next.company || current.membership !== next.membership) {
        await purgeTenantData();
      }
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
    return applying;
  }

  function clearForLogout() {
    applying = applying.catch(() => {}).then(purgeTenantData);
    return applying;
  }

  function tenantStorageKey(name) {
    if (pendingVerification) throw new Error('Mandantenkontext wird noch geprueft.');
    const context = readContext();
    if (!context || !name) throw new Error('Mandantenkontext ist nicht bestätigt.');
    return `lf-tenant-v2:${encodeURIComponent(JSON.stringify([
      context.mode, context.principal, context.company, context.membership
    ]))}:${name}`;
  }

  async function fetchSession(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const checkUrl = `${url}${url.includes('?') ? '&' : '?'}lf-context-check=${Date.now()}-${Math.random()}`;
      let response;
      try {
        response = await fetch(checkUrl, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      } catch (error) {
        if (error instanceof TypeError || error?.name === 'AbortError') {
          const transportError = new Error('Server nicht erreichbar.');
          transportError.offlineTransport = true;
          throw transportError;
        }
        throw error;
      }
      return { status: response.status, body: response.ok ? await response.json() : null };
    } finally { clearTimeout(timer); }
  }

  async function ensureContext() {
    pendingVerification++;
    try { return await resolveContext(); }
    finally { pendingVerification--; }
  }

  async function resolveContext() {
    const starting = localStorage.getItem(KEY);
    let accountRejected = false;
    try {
      const account = await fetchSession('/api/auth/account_test.php?action=me');
      if (account.status === 200 && account.body?.ok) {
        if (localStorage.getItem(KEY) !== starting) return ensureContext();
        return { context: await applyValidatedContext(account.body, 'account'), offline: false };
      }
      if (account.status !== 401) throw new Error('Account-Kontext konnte nicht geprüft werden.');
      accountRejected = true;
      const legacy = await fetchSession('/api/auth/me.php');
      if (legacy.status === 200 && legacy.body?.ok) {
        if (localStorage.getItem(KEY) !== starting) return ensureContext();
        return { context: await applyValidatedContext(legacy.body, 'legacy'), offline: false };
      }
      if (legacy.status === 401) {
        await clearForLogout();
        return null;
      }
      throw new Error('Mandantenkontext konnte nicht geprüft werden.');
    } catch (error) {
      // Only a transport failure permits the last server-confirmed offline context.
      if (error?.offlineTransport === true) {
        const saved = readContext();
        if (accountRejected && saved?.mode === 'account') {
          await clearForLogout();
          return null;
        }
        if (saved) return { context: saved, offline: true };
        await clearForLogout();
        return null;
      }
      await clearForLogout();
      throw error;
    }
  }

  // Old unbound local route data is never trusted after this deployment.
  if (!readContext()) removeTenantKeys();
  window.addEventListener('storage', event => {
    if (event.key === KEY && event.oldValue !== event.newValue) window.location.reload();
  });
  window.LehrfahrerTenantCache = Object.freeze({
    applyValidatedContext, clearForLogout, ensureContext, readContext, tenantStorageKey
  });
})();
