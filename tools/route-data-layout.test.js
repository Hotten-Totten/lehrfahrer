const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'editor.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js/editor.main.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/editor.ui.js'), 'utf8');
const start = main.indexOf('function updateRouteDataSummary()');
const end = main.indexOf('async function createNewLine()', start);
assert.ok(start >= 0 && end > start);
const source = main.slice(start, end) + '\nglobalThis.summary = updateRouteDataSummary; globalThis.expand = setRouteDataExpanded;';

function setup() {
  const names = new Set(['hidden']);
  const fields = { classList: { toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); } } };
  const toggle = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const summary = { textContent: '', title: '' };
  const action = { textContent: '' };
  const nodes = { routeDataFields: fields, routeDataToggleBtn: toggle, routeDataSummary: summary, routeDataToggleAction: action };
  let metrics = 0;
  let resizes = 0;
  const context = {
    document: { getElementById(id) { return nodes[id]; } },
    window: { EditorMapAdapter: { resizeEditorMap() { resizes++; } } },
    requestAnimationFrame(callback) { callback(); },
    updateEditorChromeLayoutMetrics() { metrics++; },
    prettifyCityName(city) { return city.charAt(0).toUpperCase() + city.slice(1); },
    citySelect: { value: 'cottbus' },
    lineNameInput: { value: '16' },
    routeNameInput: { value: '01' },
    variantCategoryInput: { value: 'Standard' },
    directionNameInput: { value: 'alte Richtung' },
    state: { stops: [{ name: 'Stadthalle Puschkinpromenade' }, { name: 'Hilfspunkt', isGhostPoint: true }, { name: 'Uhlandstraße' }] }
  };
  vm.runInNewContext(source, context);
  return { context, fields, toggle, summary, action, get collapsed() { return names.has('hidden'); }, get metrics() { return metrics; }, get resizes() { return resizes; } };
}

test('Routendaten starten eingeklappt; bestehende Feld-IDs bleiben im Panel', () => {
  assert.match(html, /id="routeDataToggleBtn"[^>]*aria-expanded="false"[^>]*aria-controls="routeDataFields"/);
  const panel = html.slice(html.indexOf('id="routeDataFields"'), html.indexOf('<div id="layout"'));
  assert.match(panel, /^id="routeDataFields" class="route-data-fields hidden"/);
  for (const id of ['citySelect', 'variantCategory', 'lineName', 'routeName', 'operationalRouteType', 'operationalName', 'operationalFromLabel', 'operationalToLabel', 'operationalRelatedRouteIds', 'variantName', 'directionName', 'stopSearchInput', 'validFrom', 'validUntil', 'lineDescription', 'operationalRemark']) {
    assert.match(panel, new RegExp(`id="${id}"`), `${id} bleibt erhalten`);
  }
  assert.match(css, /\.hidden\s*\{\s*display:\s*none\s*!important/);
});

test('kompakte Zusammenfassung verwendet vorhandene Werte und echte Endhaltestellen', () => {
  const app = setup();
  app.context.summary();
  assert.equal(app.summary.textContent, 'Cottbus · Linie 16 · Route 01 · Standard · Stadthalle Puschkinpromenade → Uhlandstraße');
  app.context.citySelect.value = '';
  app.context.lineNameInput.value = '';
  app.context.routeNameInput.value = '';
  app.context.state.stops = [];
  app.context.directionNameInput.value = '';
  app.context.summary();
  assert.equal(app.summary.textContent, 'Routendaten');
});

test('Auf- und Einklappen aktualisiert Status, Layoutmetriken und Karte', () => {
  const app = setup();
  app.context.expand(true);
  assert.equal(app.collapsed, false);
  assert.equal(app.toggle.attributes['aria-expanded'], 'true');
  assert.equal(app.action.textContent, 'Routendaten schließen');
  app.context.expand(false);
  assert.equal(app.collapsed, true);
  assert.equal(app.toggle.attributes['aria-expanded'], 'false');
  assert.equal(app.action.textContent, 'Routendaten bearbeiten');
  assert.equal(app.metrics, 4);
  assert.equal(app.resizes, 2);
});

test('neue Route öffnet Eingaben; Laden schließt sie; Datenänderungen aktualisieren Zusammenfassung', () => {
  assert.match(main, /setMode\("freeStop", "Neue Linie erstellt\. Modus: Haltestelle"\);\s*setRouteDataExpanded\(true\);/);
  assert.match(api, /loadLineFromData\(lineData\);\s*if \(typeof setRouteDataExpanded === "function"\) setRouteDataExpanded\(false\);/);
  assert.match(main, /\["input", "change"\][\s\S]*?addEventListener\(eventName, updateRouteDataSummary\)/);
  assert.match(ui, /function updateStats\(\)[\s\S]*?updateRouteDataSummary\(\)/);
  assert.match(css, /#topbar\s*\{[^}]*flex-direction:\s*column;[^}]*padding:\s*0;/);
  assert.match(css, /\.route-data-toggle\s*\{[^}]*min-height:\s*38px;/);
});
