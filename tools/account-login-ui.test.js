const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'account-login.php'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js', 'account-login.js'), 'utf8');

function harness(search = '', responses = {}) {
  const elements = new Map();
  const requests = [];
  const redirects = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, value: '', textContent: '', href: '', disabled: false,
      children: [], listeners: {}, focus() { this.focused = true; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); }
    });
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    createElement: () => ({ type: '', textContent: '', listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; } })
  };
  const fetch = async (url, options = {}) => {
    const action = new URL(url, 'https://staging.lehrfahrer.de/').searchParams.get('action') || 'runtime';
    requests.push({ action, url, options });
    const next = responses[action];
    const reply = typeof next === 'function' ? next(requests) : next;
    const result = reply || (action === 'runtime'
      ? { status: 200, body: { ok: true, runtime: { environmentLabel: 'STAGING' } } }
      : { status: 401, body: { ok: false } });
    return { ok: result.status >= 200 && result.status < 300,
      status: result.status, json: async () => result.body };
  };
  const window = { location: { search, replace: url => redirects.push(url) } };
  vm.runInNewContext(script, { document, window, fetch, URLSearchParams, URL });
  return { element, requests, redirects, settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test('Staging-Seite hat semantisches Login ohne Gesellschaft und mit Legacy-Rückweg', () => {
  assert.match(page, /lehrfahrer_environment\(\) !== 'staging'/);
  assert.match(page, /<form id="accountLoginForm"/);
  assert.match(page, /name="username" autocomplete="username"/);
  assert.match(page, /name="password" type="password" autocomplete="current-password"/);
  assert.doesNotMatch(page, /id="company"|name="company"|company_slug|company_id/);
  assert.match(page, /href="login.html"/);
  assert.match(page, /:focus-visible/);
  assert.match(page, /width: min\(420px, calc\(100% - 32px\)\)/);
  const hash = crypto.createHash('sha256').update(script.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  assert.ok(page.includes(`js/account-login.js?v=${hash}`));
});

test('Single-Membership-Login leitet zum erlaubten Ziel; Passwort wird geleert', async () => {
  const h = harness('?next=%2F', {
    login: { status: 200, body: { ok: true, context: 'TENANT', csrfToken: 'csrf' } }
  });
  await h.settle();
  assert.equal(h.element('accountLoginForm').hidden, false);
  h.element('accountLogin').value = 'user';
  h.element('accountPassword').value = 'secret';
  await h.element('accountLoginForm').listeners.submit({ preventDefault() {} });
  assert.deepEqual(h.redirects, ['/']);
  assert.equal(h.element('accountPassword').value, '');
  const sent = h.requests.find(request => request.action === 'login');
  assert.deepEqual(JSON.parse(sent.options.body), { login: 'user', password: 'secret' });
  assert.equal(sent.options.credentials, 'same-origin');
  assert.ok(h.requests.every(request => !request.url.includes('secret') && !request.url.includes('csrf')));
});

test('Externe und unerlaubte Return-Ziele werden auf den Editor begrenzt', async () => {
  for (const unsafe of ['https://evil.example/', '//evil.example/', '/%2e%2e/app/', '/unknown']) {
    const h = harness(`?next=${encodeURIComponent(unsafe)}`, {
      me: { status: 200, body: { ok: true, context: 'TENANT', csrfToken: 'csrf' } }
    });
    await h.settle();
    assert.deepEqual(h.redirects, ['/']);
  }
  const allowed = harness('?next=%2Fapp%2F', {
    me: { status: 200, body: { ok: true, context: 'TENANT', csrfToken: 'csrf' } }
  });
  await allowed.settle();
  assert.deepEqual(allowed.redirects, ['/app/']);
});

test('Falsches und unbekanntes Login erhalten dieselbe neutrale Meldung', async () => {
  for (const status of [400, 401]) {
    const h = harness('', { login: { status, body: { ok: false } } });
    await h.settle();
    h.element('accountPassword').value = 'wrong';
    await h.element('accountLoginForm').listeners.submit({ preventDefault() {} });
    assert.equal(h.element('message').textContent,
      'Anmeldung nicht möglich. Bitte Loginname und Passwort prüfen.');
    assert.equal(h.element('accountPassword').value, '');
    assert.deepEqual(h.redirects, []);
  }
});

test('Pending zeigt nur gelieferte Gesellschaften; Auswahl nutzt CSRF und rotierten Kontext', async () => {
  const h = harness('?next=%2F', {
    me: { status: 200, body: { ok: true, context: 'SELECTION_PENDING', csrfToken: 'old-csrf' } },
    memberships: { status: 200, body: { ok: true,
      memberships: [{ id: 'own', name: 'Cottbusverkehr GmbH' }] } },
    select: { status: 200, body: { ok: true, context: 'TENANT', contextChanged: true, csrfToken: 'new-csrf' } }
  });
  await h.settle(); await h.settle();
  assert.equal(h.element('membershipSection').hidden, false);
  assert.equal(h.element('membershipChoices').children.length, 1);
  assert.equal(h.element('membershipChoices').children[0].textContent, 'Cottbusverkehr GmbH');
  await h.element('membershipChoices').children[0].listeners.click();
  const sent = h.requests.find(request => request.action === 'select');
  assert.deepEqual(JSON.parse(sent.options.body), { membershipId: 'own' });
  assert.equal(sent.options.headers['X-CSRF-Token'], 'old-csrf');
  assert.deepEqual(h.redirects, ['/']);
});

test('Keine Membership zeigt Hinweis und erlaubt Logout ohne Tenant-Redirect', async () => {
  const h = harness('', {
    me: { status: 200, body: { ok: true, context: 'NO_MEMBERSHIP', csrfToken: 'csrf' } },
    memberships: { status: 200, body: { ok: true, memberships: [] } }
  });
  await h.settle(); await h.settle();
  assert.match(h.element('message').textContent, /keine Gesellschaft freigeschaltet/);
  assert.equal(h.element('membershipSection').hidden, false);
  assert.deepEqual(h.redirects, []);
});

test('Manage-Modus zeigt Wechsel nur bei mehreren Memberships und Logout widerruft Session', async () => {
  const h = harness('?mode=manage&next=%2F', {
    me: { status: 200, body: { ok: true, context: 'TENANT', csrfToken: 'csrf' } },
    memberships: { status: 200, body: { ok: true, currentMembershipId: 'one',
      memberships: [{ id: 'one', name: 'Cottbusverkehr GmbH' }, { id: 'two', name: 'Andere' }] } },
    logout: { status: 200, body: { ok: true } }
  });
  await h.settle(); await h.settle();
  assert.equal(h.element('accountSection').hidden, false);
  assert.equal(h.element('activeCompany').textContent, 'Cottbusverkehr GmbH');
  assert.equal(h.element('switchCompany').hidden, false);
  await h.element('accountLogout').listeners.click();
  assert.equal(h.requests.find(request => request.action === 'logout').options.headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(h.redirects, ['account-login.php']);
});

test('Gesellschaftswechsel zeigt nur andere erlaubte Membership und nutzt P2.2-Sessionrotation', async () => {
  const h = harness('?mode=manage&next=%2F', {
    me: { status: 200, body: { ok: true, context: 'TENANT', csrfToken: 'csrf' } },
    memberships: { status: 200, body: { ok: true, currentMembershipId: 'one',
      memberships: [{ id: 'one', name: 'Aktuell' }, { id: 'two', name: 'Andere' }] } },
    switch: { status: 200, body: { ok: true, context: 'TENANT', contextChanged: true, csrfToken: 'rotated' } }
  });
  await h.settle(); await h.settle();
  await h.element('switchCompany').listeners.click();
  await h.settle();
  assert.deepEqual(h.element('membershipChoices').children.map(item => item.textContent), ['Andere']);
  await h.element('membershipChoices').children[0].listeners.click();
  const sent = h.requests.find(request => request.action === 'switch');
  assert.equal(sent.options.headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(JSON.parse(sent.options.body), { membershipId: 'two' });
  assert.deepEqual(h.redirects, ['/']);
});

test('Server lehnt manipulierte Membership ab; UI übernimmt keinen Zielkontext', async () => {
  const h = harness('', {
    me: { status: 200, body: { ok: true, context: 'SELECTION_PENDING', csrfToken: 'csrf' } },
    memberships: { status: 200, body: { ok: true, memberships: [{ id: 'own', name: 'Eigen' }] } },
    select: { status: 403, body: { ok: false } }
  });
  await h.settle(); await h.settle();
  await h.element('membershipChoices').children[0].listeners.click();
  assert.deepEqual(h.redirects, []);
  assert.match(h.element('message').textContent, /konnte nicht ausgewählt/);
});

test('Während einer Aktion abgelaufene Account-Session führt zurück zum Login', async () => {
  let count = 0;
  const h = harness('', {
    me: () => (++count === 1
      ? { status: 200, body: { ok: true, context: 'SELECTION_PENDING', csrfToken: 'csrf' } }
      : { status: 401, body: { ok: false } }),
    memberships: { status: 200, body: { ok: true, memberships: [{ id: 'own', name: 'Eigen' }] } },
    select: { status: 403, body: { ok: false } }
  });
  await h.settle(); await h.settle();
  await h.element('membershipChoices').children[0].listeners.click();
  assert.equal(h.element('accountLoginForm').hidden, false);
  assert.match(h.element('message').textContent, /Sitzung abgelaufen/);
});

test('Abgelaufene Session zeigt Login statt Weiterleitung oder Offline-Meldung', async () => {
  const h = harness('?next=%2F', { me: { status: 401, body: { ok: false } } });
  await h.settle();
  assert.equal(h.element('accountLoginForm').hidden, false);
  assert.deepEqual(h.redirects, []);
  assert.doesNotMatch(script, /Offline|localStorage|sessionStorage|console\.log|console\.debug/);
});

test('Editor-Staging-Redirect und Account-Menü bleiben vom Legacy-Pfad getrennt', () => {
  const gate = fs.readFileSync(path.join(root, 'index.php'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(gate, /lehrfahrer_environment\(\) === 'staging'/);
  assert.match(gate, /account-login\.php\?next=%2F/);
  assert.match(gate, /: 'login\.html'/);
  assert.match(gate, /\$auth\['auth_source'\] === 'ACCOUNT'/);
  assert.match(editor, /id="accountMenuRoot" style="display:none"/);
});
