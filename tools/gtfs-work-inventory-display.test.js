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
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    querySelectorAll() { return []; } };
}

function setup(inventory, confirmation = true, statusError = false, statusRequest = null) {
  const ids = ['gtfsWorkModal', 'gtfsWorkCompleteness', 'gtfsWorkList', 'gtfsWorkReport',
    'gtfsWorkCloseBtn', 'gtfsWorkPrepareAllBtn', 'gtfsWorkArchiveBtn'];
  const elements = Object.fromEntries(ids.map(id => [id, node()]));
  const calls = [];
  const confirmCalls = [];
  const context = { document: { getElementById: id => elements[id], createElement: node },
    gtfsChangeElement(_tag, _className, text) { const result = node(); result.textContent = text; return result; },
    postGtfsImport: async request => {
      calls.push(request);
      if (request.action === 'workArchive') {
        const target = inventory.entries.find(item => item.routeId === request.routeId && item.variantId === request.variantId);
        target.archived = request.archived === '1';
        return { inventory };
      }
      if (request.action === 'workRevoke') {
        const target = inventory.entries.find(item => item.routeId === request.routeId && item.variantId === request.variantId);
        target.status = 'IN_BEARBEITUNG';
        return { inventory };
      }
      if (request.action === 'workStatus' && statusError) throw new Error('Uebergang abgelehnt');
      if (request.action === 'workStatus' && statusRequest) return statusRequest;
      return request.action === 'workStatus' ? { inventory } : { line: {} };
    },
    showConfirmDialog: async options => { confirmCalls.push(options); return confirmation; },
    loadLineFromData() {}, buildStreetRouteFromStops: async () => {}, confirm() { throw new Error('No bulk prepare'); } };
  const api = vm.runInNewContext(`${source.slice(start, end)}; ({ gtfsWorkDisplayRows, renderGtfsWorkInventory })`, context);
  return { ...api, elements, calls, confirmCalls };
}

test('Statusauswahl bietet nur die nächste Stufe an und behält den Status bei Server-Ablehnung', async () => {
  const entries = ['UNGEPRUEFT', 'IN_BEARBEITUNG', 'GEPRUEFT', 'FREIGEGEBEN']
    .map((status, index) => entry(`status-${index}`, ['A', 'B'], { status }));
  const inventory = { entries, completeness: {} };
  const { renderGtfsWorkInventory, elements } = setup(inventory, true, true);
  renderGtfsWorkInventory(inventory);
  const selectors = elements.gtfsWorkList.children.map(row => row.children[4]);
  assert.deepEqual(selectors.map(select => select.children.map(option => option.value)), [
    ['UNGEPRUEFT', 'IN_BEARBEITUNG'], ['IN_BEARBEITUNG', 'GEPRUEFT'],
    ['GEPRUEFT', 'FREIGEGEBEN'], ['FREIGEGEBEN']
  ]);
  assert.equal(selectors[3].disabled, true);
  selectors[1].value = 'GEPRUEFT';
  await selectors[1].onchange();
  assert.equal(selectors[1].value, 'IN_BEARBEITUNG');
  assert.equal(selectors[1].disabled, false);
  assert.equal(entries[1].status, 'IN_BEARBEITUNG');
  assert.match(elements.gtfsWorkReport.textContent, /Uebergang abgelehnt/);
});

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

test('technische ID bleibt für Status und workOpen erhalten; historische Einträge bleiben nur intern', async () => {
  const entries = [entry('internal-original', ['A', 'B', 'D']),
    entry('retired', [], { startStop: ' ', endStop: ' ', destination: 'Altes Ziel',
      timetableStatus: 'ENTFALLEN', status: 'IN_BEARBEITUNG', draftPrepared: true, savedRoute: 'Route 03' }),
    entry('retired-saved', ['A', 'C'], { timetableStatus: 'ENTFALLEN', savedRoute: 'Route 04' })];
  const inventory = { entries, completeness: { capturedLineCount: 77, expectedLineCount: 77,
    capturedVariantCount: 757, expectedVariantCount: 757 } };
  const before = JSON.stringify(inventory);
  const { renderGtfsWorkInventory, elements, calls } = setup(inventory);
  renderGtfsWorkInventory(inventory);
  const rows = elements.gtfsWorkList.children;
  assert.equal(rows.length, 1);
  assert.equal(elements.gtfsWorkCompleteness.textContent, '77/77 Linien erfasst · 757/757 Varianten erfasst');
  assert.match(html, /<span>Start → Ziel<\/span><span>Führung<\/span><span>Stops<\/span><span>Arbeitsstatus<\/span>/);
  assert.match(inventorySource, /'startStop' => strval\(\$variant\['startStop'\]\)/);
  assert.match(inventorySource, /'stopNames' => \$variant\['stopNames'\]/);
  const active = rows.find(row => row.children[1].textContent === 'A → D');
  active.children[4].value = 'IN_BEARBEITUNG';
  await active.children[4].onchange();
  assert.equal(calls[0].variantId, 'internal-original');
  await active.children[5].children[0].onclick();
  assert.equal(calls[1].variantId, 'internal-original');
  assert.equal(elements.gtfsWorkList.children.some(row => row.dataset.timetableStatus === 'ENTFALLEN'), false);
  assert.equal(JSON.stringify(inventory), before);
  assert.equal(entries[1].draftPrepared, true);
  assert.equal(entries[1].savedRoute, 'Route 03');
  assert.equal(entries[2].savedRoute, 'Route 04');
});

test('Arbeitsstatus unterscheidet dauerhafte Sperre und laufenden Request', async () => {
  const inventory = { entries: [entry('active', ['A', 'B'], { status: 'IN_BEARBEITUNG' }),
    entry('terminal', ['A', 'B'], { status: 'FREIGEGEBEN' })], completeness: {} };
  let finishRequest;
  const statusRequest = new Promise(resolve => { finishRequest = resolve; });
  const { renderGtfsWorkInventory, elements } = setup(inventory, true, false, statusRequest);
  renderGtfsWorkInventory(inventory);
  const active = elements.gtfsWorkList.children[0].children[4];
  const terminal = elements.gtfsWorkList.children[1].children[4];
  assert.equal(terminal.disabled, true);
  assert.equal(terminal.classList.contains('gtfs-work-status-pending'), false);
  const request = active.onchange();
  assert.equal(active.disabled, true);
  assert.equal(active.classList.contains('gtfs-work-status-pending'), true);
  finishRequest({ inventory });
  await request;
  assert.equal(active.classList.contains('gtfs-work-status-pending'), false);
  assert.equal(elements.gtfsWorkList.children[1].children[4].disabled, true);
  assert.equal(elements.gtfsWorkList.children[1].children[4].classList.contains('gtfs-work-status-pending'), false);
});

test('alle 757 CURRENT-Führungen aus 77 Linien bleiben trotz historischer Einträge sichtbar', () => {
  const entries = Array.from({ length: 757 }, (_, index) => entry(`current-${index}`, ['Start', 'Ziel'],
    { line: String(index % 77 + 1), routeId: `route-${index % 77 + 1}` }));
  entries.push(entry('historic', ['Alt', 'Ziel'], { timetableStatus: 'ENTFALLEN', draftPrepared: true }));
  const inventory = { entries, completeness: { capturedLineCount: 77, expectedLineCount: 77,
    capturedVariantCount: 757, expectedVariantCount: 757 } };
  const { renderGtfsWorkInventory, elements } = setup(inventory);
  renderGtfsWorkInventory(inventory);
  assert.equal(elements.gtfsWorkList.children.length, 757);
  assert.equal(new Set(elements.gtfsWorkList.children.map(row => row.children[0].textContent)).size, 77);
  assert.equal(elements.gtfsWorkCompleteness.textContent, '77/77 Linien erfasst · 757/757 Varianten erfasst');
  assert.equal(entries.length, 758);
});

test('Archivieren und Wiederherstellen ändern nur die Sichtbarkeit, nicht die CURRENT-Zählung', async () => {
  const current = entry('current', ['A', 'B']);
  const historical = entry('old', ['A', 'C'], { timetableStatus: 'ENTFALLEN', archived: true });
  const inventory = { entries: [current, historical], completeness: { capturedLineCount: 77,
    expectedLineCount: 77, capturedVariantCount: 757, expectedVariantCount: 757 } };
  const { renderGtfsWorkInventory, elements, calls, confirmCalls } = setup(inventory);
  renderGtfsWorkInventory(inventory);
  assert.equal(elements.gtfsWorkList.children.length, 1);
  await elements.gtfsWorkList.children[0].children[5].children[1].onclick();
  assert.equal(current.archived, true);
  assert.equal(elements.gtfsWorkList.children.length, 0);
  assert.equal(confirmCalls.length, 0);
  assert.equal(calls[0].routeId, 'route-16');
  assert.equal(calls[0].variantId, 'current');
  assert.equal(calls[0].archived, '1');
  assert.equal(calls[0].confirmed, '0');
  await elements.gtfsWorkArchiveBtn.onclick();
  assert.equal(elements.gtfsWorkList.children.length, 1);
  assert.equal(elements.gtfsWorkList.children[0].children[5].children[0].textContent, 'Wiederherstellen');
  await elements.gtfsWorkList.children[0].children[5].children[0].onclick();
  assert.equal(current.archived, false);
  assert.equal(elements.gtfsWorkList.children.length, 0);
  await elements.gtfsWorkArchiveBtn.onclick();
  assert.equal(elements.gtfsWorkList.children.length, 1);
  assert.equal(elements.gtfsWorkCompleteness.textContent, '77/77 Linien erfasst · 757/757 Varianten erfasst');
  assert.equal(historical.archived, true);
  assert.match(html, /id="gtfsWorkArchiveBtn"/);
});

test('bearbeitete oder freigegebene Führung verlangt Bestätigung und behält ihre Fachdaten', async () => {
  const current = entry('edited', ['A', 'B'], { status: 'FREIGEGEBEN', draftPrepared: true,
    savedRoute: 'Route 01', meta: { note: 'unverändert' } });
  const inventory = { entries: [current], completeness: {} };
  const before = JSON.stringify(current);
  const cancelled = setup(inventory, false);
  cancelled.renderGtfsWorkInventory(inventory);
  await cancelled.elements.gtfsWorkList.children[0].children[5].children.find(button => button.textContent === 'Archivieren').onclick();
  assert.equal(cancelled.confirmCalls.length, 1);
  assert.equal(cancelled.calls.length, 0);
  assert.equal(JSON.stringify(current), before);
  const accepted = setup(inventory);
  accepted.renderGtfsWorkInventory(inventory);
  await accepted.elements.gtfsWorkList.children[0].children[5].children.find(button => button.textContent === 'Archivieren').onclick();
  assert.equal(accepted.confirmCalls.length, 1);
  assert.equal(accepted.calls[0].confirmed, '1');
  assert.equal(current.status, 'FREIGEGEBEN');
  assert.equal(current.draftPrepared, true);
  assert.equal(current.savedRoute, 'Route 01');
  assert.deepEqual(current.meta, { note: 'unverändert' });
});

test('Freigabe zurücknehmen verlangt Bestätigung und sendet nur die exakte Führung', async () => {
  const current = entry('released', ['A', 'B'], { status: 'FREIGEGEBEN' });
  const inventory = { entries: [current], completeness: {} };
  const cancelled = setup(inventory, false);
  cancelled.renderGtfsWorkInventory(inventory);
  const cancelButton = cancelled.elements.gtfsWorkList.children[0].children[5].children
    .find(button => button.textContent === 'Freigabe zurücknehmen');
  await cancelButton.onclick();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(current.status, 'FREIGEGEBEN');
  const accepted = setup(inventory);
  accepted.renderGtfsWorkInventory(inventory);
  const button = accepted.elements.gtfsWorkList.children[0].children[5].children
    .find(item => item.textContent === 'Freigabe zurücknehmen');
  await button.onclick();
  assert.equal(accepted.calls[0].action, 'workRevoke');
  assert.equal(accepted.calls[0].routeId, current.routeId);
  assert.equal(accepted.calls[0].variantId, current.variantId);
  assert.equal(current.status, 'IN_BEARBEITUNG');
});
