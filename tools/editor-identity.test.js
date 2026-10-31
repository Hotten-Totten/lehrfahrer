const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js/editor.identity.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'editor.css'), 'utf8');
const mainScript = fs.readFileSync(path.join(root, 'js/editor.main.js'), 'utf8');

function element() {
  const classes = new Set();
  let ownText = '';
  return {
    children: [], hidden: true, className: '', title: '',
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    get textContent() { return ownText + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { ownText = String(value); this.children = []; },
    replaceChildren() { ownText = ''; this.children = []; },
    append(child) { this.children.push(child); }
  };
}

async function fixture(accountResponse, legacyResponse = { status: 401 }) {
  const status = element();
  status.textContent = 'Sitzung: aktiv';
  const details = element();
  const calls = [];
  const document = {
    getElementById(id) { return id === 'apiTokenStatus' ? status : id === 'accountContextDetails' ? details : null; },
    createElement: element
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const answer = url.includes('account_test') ? accountResponse : legacyResponse;
    return { status: answer.status, ok: answer.status === 200,
      json: async () => answer.body };
  };
  vm.runInNewContext(script, { document, fetch });
  await new Promise(resolve => setImmediate(resolve));
  return { status, details, calls };
}

const account = (companyName, tenantRoles, userNumber = '00101', platformRoles = []) => ({
  status: 200, body: { ok: true, context: 'TENANT', displayName: 'Frank Fudeus',
    companyName, tenantRoles, userNumber, platformRoles }
});

test('Account zeigt Gesellschaft, Tenantrolle und globale Nummer ohne leeren Plattformtrenner', async () => {
  const h = await fixture(account('Cottbusverkehr', ['ADMIN']));
  assert.equal(h.status.textContent, 'Cottbusverkehr · ADMIN · 00101');
  assert.doesNotMatch(h.status.textContent, /\|/);
  assert.deepEqual(h.details.children.map(child => child.textContent), [
    'Benutzer: Frank Fudeus', 'Benutzernummer: 00101',
    'Gesellschaft: Cottbusverkehr', 'Rolle: ADMIN'
  ]);
  assert.ok(h.calls.every(call => call.options.credentials === 'same-origin' && call.options.cache === 'no-store'));
});

test('A→B erhält Nummer, ersetzt Gesellschaft und Rolle; mehrere Rollen bleiben sichtbar', async () => {
  const a = await fixture(account('Firma A', ['ADMIN']));
  const b = await fixture(account('Firma B', ['LEHRFAHRER', 'FAHRER']));
  assert.equal(a.status.textContent, 'Firma A · ADMIN · 00101');
  assert.equal(b.status.textContent, 'Firma B · LEHRFAHRER / FAHRER · 00101');
  assert.doesNotMatch(b.status.textContent, /Firma A|ADMIN/);
});

test('00001 allein ist kein SYSOP; nur gelieferte Plattformrolle erscheint getrennt', async () => {
  const ordinary = await fixture(account('A', ['ADMIN'], '00001'));
  const official = await fixture(account('A', ['ADMIN'], '00001', ['SYSOP']));
  assert.equal(ordinary.status.textContent, 'A · ADMIN · 00001');
  assert.equal(official.status.textContent, 'A · ADMIN | SYSOP · 00001');
  assert.equal(official.details.children.at(-1).textContent, 'Plattformrolle: SYSOP');
});

test('Browserwerte beeinflussen Anzeige nicht; HTML wird nur als Text angehängt', async () => {
  const h = await fixture(account('<img src=x onerror=alert(1)>', ['ADMIN']));
  assert.match(h.status.textContent, /<img src=x/);
  assert.equal(h.status.children.some(child => child.innerHTML), false);
  assert.doesNotMatch(script, /localStorage|sessionStorage|innerHTML/);
});

test('Pending und Logout zeigen keinen alten Tenantkontext', async () => {
  const pending = await fixture({ status: 200, body: { ok: true, context: 'SELECTION_PENDING' } });
  const loggedOut = await fixture({ status: 401 }, { status: 401 });
  assert.equal(pending.status.textContent, 'Sitzung: nicht aktiv');
  assert.equal(loggedOut.status.textContent, 'Sitzung: nicht aktiv');
  assert.equal(pending.details.hidden, true);
  assert.equal(loggedOut.details.hidden, true);
});

test('Legacy-Session bleibt ohne erfundene Accountnummer kompatibel', async () => {
  const h = await fixture({ status: 401 }, { status: 200,
    body: { ok: true, company: { name: 'Altgesellschaft' }, user: { roles: ['FAHRER'] } } });
  assert.equal(h.status.textContent, 'Altgesellschaft · FAHRER');
  assert.equal(h.details.hidden, true);
});

test('Editor-Cache-Key und schmale Darstellung vorhanden', () => {
  const hash = crypto.createHash('sha256').update(script.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  const mainHash = crypto.createHash('sha256').update(mainScript.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  const cssHash = crypto.createHash('sha256').update(css.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  assert.ok(page.includes(`js/editor.identity.js?v=${hash}`));
  assert.ok(page.includes(`js/editor.main.js?v=${mainHash}`));
  assert.ok(page.includes(`editor.css?v=${cssHash}`));
  assert.match(page, /id="accountContextDetails"/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.identity-tenant-role,\s*\.identity-platform-separator/);
  assert.match(css, /\.identity-status \{ max-width: 46vw; \}/);
  assert.match(mainScript, /classList\.contains\('identity-status'\).*classList\.contains\('identity-unavailable'\)/);
});
