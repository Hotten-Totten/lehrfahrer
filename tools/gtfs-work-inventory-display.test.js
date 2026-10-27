const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inventorySource = fs.readFileSync(path.join(root, 'api/_gtfs_work_inventory.php'), 'utf8');
const start = source.indexOf('function gtfsWorkStatusLabel(status) {');
const end = source.indexOf('async function loadGtfsVersionInfo(', start);
assert.ok(start >= 0 && end > start);

function entry(id, stops, extra = {}) {
  return { routeId: 'route-16', variantId: id, line: '16', startStop: stops[0],
    endStop: stops[stops.length - 1], stopNames: stops, stopCount: stops.length,
    status: 'UNGEPRUEFT', timetableStatus: 'UNVERAENDERT', ...extra };
}

function node() {
  const classes = new Set();
  return { children: [], dataset: {}, textContent: '', disabled: false,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    querySelectorAll() { return []; } };
}

function setup(inventory) {
  const ids = ['gtfsWorkModal', 'gtfsWorkCompleteness', 'gtfsWorkList', 'gtfsWorkReport',
    'gtfsWorkCloseBtn', 'gtfsWorkPrepareAllBtn'];
  const elements = Object.fromEntries(ids.map(id => [id, node()]));
  const calls = [];
  const context = { document: { getElementById: id => elements[id], createElement: node },
    gtfsChangeElement(_tag, _className, text) { const result = node(); result.textContent = text; return result; },
    postGtfsImport: async request => { calls.push(request); return request.action === 'workStatus' ? { inventory } : { line: {} }; },
    loadLineFromData() {}, buildStreetRouteFromStops: async () => {}, confirm() { throw new Error('No bulk prepare'); } };
  const api = vm.runInNewContext(`${source.slice(start, end)}; ({ gtfsWorkDisplayRows, renderGtfsWorkInventory })`, context);
  return { ...api, elements, calls };
}

test('Führungen zeigen beide echten Endpunkte und gruppieren je Linie und Fahrtrichtung', () => {
  const entries = [
    entry('c', ['A', 'C', 'D']), entry('a', ['A', 'B', 'D']),
    entry('reverse', ['D', 'C', 'A']), entry('b', ['A', 'B', 'C', 'D']),
    entry('other-line', ['A', 'B', 'D'], { line: '17', routeId: 'route-17' })
  ];
  const { gtfsWorkDisplayRows, renderGtfsWorkInventory, elements } = setup({ entries, completeness: {} });
  const first = gtfsWorkDisplayRows(entries).map(row => [row.entry.variantId, row.number]);
  const second = gtfsWorkDisplayRows([...entries].reverse()).map(row => [row.entry.variantId, row.number]);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [['a', 1], ['c', 2], ['b', 3], ['reverse', 1], ['other-line', 1]]);
  renderGtfsWorkInventory({ entries, completeness: {} });
  const rows = elements.gtfsWorkList.children;
  assert.deepEqual(rows.map(row => row.children[1].textContent),
    ['A → D', 'A → D', 'A → D', 'D → A', 'A → D']);
  assert.deepEqual(rows.map(row => row.children[2].textContent),
    ['Führung 1', 'Führung 2', 'Führung 3', 'Führung 1', 'Führung 1']);
  assert.equal(rows.some(row => row.children.some(child => child.textContent === 'reverse')), false);
});

test('technische ID bleibt für Status und workOpen erhalten; entfallene Führung bleibt deaktiviert', async () => {
  const entries = [entry('internal-original', ['A', 'B', 'D']),
    entry('retired', [], { startStop: ' ', endStop: ' ', destination: 'Altes Ziel',
      timetableStatus: 'ENTFALLEN', status: 'GEPRUEFT' })];
  const inventory = { entries, completeness: {} };
  const { renderGtfsWorkInventory, elements, calls } = setup(inventory);
  renderGtfsWorkInventory(inventory);
  const rows = elements.gtfsWorkList.children;
  assert.match(html, /<span>Start → Ziel<\/span><span>Führung<\/span><span>Stops<\/span><span>Arbeitsstatus<\/span>/);
  assert.match(inventorySource, /'startStop' => strval\(\$variant\['startStop'\]\)/);
  assert.match(inventorySource, /'stopNames' => \$variant\['stopNames'\]/);
  const active = rows.find(row => row.children[1].textContent === 'A → D');
  active.children[4].value = 'IN_BEARBEITUNG';
  await active.children[4].onchange();
  assert.equal(calls[0].variantId, 'internal-original');
  await active.children[5].onclick();
  assert.equal(calls[1].variantId, 'internal-original');
  const retired = rows.find(row => row.dataset.timetableStatus === 'ENTFALLEN');
  assert.equal(retired.children[4].disabled, true);
  assert.equal(retired.children[5].disabled, true);
  assert.equal(retired.children[1].textContent, 'Start unbekannt → Altes Ziel');
  assert.equal(retired.children[2].textContent, 'Führung 1');
});
