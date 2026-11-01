const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/editor.main.js'), 'utf8');
const start = source.indexOf('async function exportLineAsGpx()');
const end = source.indexOf('function prettifyCityName(', start);
assert.ok(start >= 0 && end > start);

test('eigenstaendiger GPX-Export laedt lokal herunter und sendet keinen Schreibrequest', async () => {
  const calls = { clicks: 0, fetches: 0, status: '' };
  const anchor = { click() { calls.clicks++; }, remove() {} };
  const context = {
    buildGpxString: () => '<gpx/>', buildLineFileBase: () => 'Route_01',
    document: { getElementById: () => ({ value: 'Linie 1' }),
      createElement: () => anchor, body: { appendChild() {} } },
    Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout() {}, setStatus(value) { calls.status = value; },
    fetch() { calls.fetches++; throw new Error('Serverzugriff unerlaubt'); }, console
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await context.exportLineAsGpx();
  assert.equal(calls.clicks, 1);
  assert.equal(anchor.download, 'Route_01.gpx');
  assert.equal(calls.fetches, 0);
  assert.match(calls.status, /GPX heruntergeladen/);
});
