const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
const editorStateSource = fs.readFileSync(path.resolve(__dirname, '../js/editor.state.js'), 'utf8');
const editorApiSource = fs.readFileSync(path.resolve(__dirname, '../js/editor.api.js'), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  ${appSource.slice(appSource.indexOf('function buildLineStorageId'), appSource.indexOf('function buildAppRelativeAssetUrl'))}
  ${appSource.slice(appSource.indexOf('const OPERATIONAL_ROUTE_TYPES'), appSource.indexOf('function lineStorageIdCandidates'))}
  this.operationalApi = {
    normalizeOperationalRouteType,
    findOperationalRouteToStart,
    findOperationalRouteFromEnd,
    findOperationalTransfer,
    buildOperationalJourneyPlan,
    buildGeneratedOperationalRoute
  };
`, sandbox);
const api = sandbox.operationalApi;

const target = {
  id: 'cottbus/Linie_16/Standard/Route_01',
  city: 'cottbus',
  fileBase: 'Route_01',
  lineFolder: 'Linie_16',
  categoryFolder: 'Standard',
  routeType: 'line',
  lineName: 'Linie 16',
  routePoints: [[51.75, 14.33], [51.76, 14.34]]
};

test('Altbestand ohne routeType und explizite Linienfahrt bleiben line', () => {
  assert.equal(api.normalizeOperationalRouteType(undefined), 'line');
  assert.equal(api.normalizeOperationalRouteType('line'), 'line');
  assert.equal(api.normalizeOperationalRouteType('3'), 'line');
});

test('alle drei Betriebsfahrttypen bleiben stabil', () => {
  assert.deepEqual(['pullout', 'pullin', 'transfer'].map(api.normalizeOperationalRouteType), ['pullout', 'pullin', 'transfer']);
});

test('Editor schreibt Betriebsmetadaten in Alt- und neues Linienformat', () => {
  assert.ok(editorApiSource.includes('...operational,'));
  assert.equal((editorApiSource.match(/\.\.\.operational,/g) || []).length, 2);
  assert.ok(editorApiSource.includes('setOperationalRouteFields(data)'));
});

test('Editor-Normalisierung restauriert pullout, pullin und transfer ohne Haltestellenbezug', () => {
  const editorSandbox = {};
  vm.createContext(editorSandbox);
  vm.runInContext(`${editorStateSource.slice(editorStateSource.indexOf('const OPERATIONAL_ROUTE_TYPES'), editorStateSource.indexOf('const state ='))}\nthis.read = readOperationalRouteFields;`, editorSandbox);
  for (const routeType of ['pullout', 'pullin', 'transfer']) {
    const restored = editorSandbox.read({ routeType, relatedRouteIds: ['route-1'] });
    assert.equal(restored.routeType, routeType);
    assert.deepEqual(Array.from(restored.relatedRouteIds), ['route-1']);
  }
});

test('exakte relatedRouteIds-Zuordnung hat Vorrang', () => {
  const exact = { id: 'depot-exact', routeType: 'pullout', relatedRouteIds: [target.id] };
  const other = { id: 'depot-other', routeType: 'pullout', relatedRouteIds: ['andere-route'] };
  const result = api.findOperationalRouteToStart({ targetRoute: target, operationalRoutes: [other, exact] });
  assert.equal(result.status, 'fixed-route');
  assert.equal(result.route.id, 'depot-exact');
  assert.equal(result.matchReason, 'related-route-id');
});

test('falsch zugeordnete Betriebsfahrt wird nicht gewaehlt', () => {
  const result = api.findOperationalRouteToStart({
    targetRoute: target,
    operationalRoutes: [{ id: 'wrong', routeType: 'pullout', relatedRouteIds: ['fremd'] }]
  });
  assert.equal(result.route, null);
  assert.equal(result.status, 'generated-fallback-required');
});

test('Linie und Startregion bilden nur gemeinsam den sekundären Treffer', () => {
  const regional = { id: 'regional', routeType: 'pullout', lineName: 'Linie 16', routePoints: [[51.74, 14.32], [51.7502, 14.3302]] };
  const wrongLine = { id: 'wrong-line', routeType: 'pullout', lineName: 'Linie 17', routePoints: [[51.74, 14.32], [51.75, 14.33]] };
  const result = api.findOperationalRouteToStart({ targetRoute: target, operationalRoutes: [wrongLine, regional] });
  assert.equal(result.route.id, 'regional');
  assert.equal(result.matchReason, 'line-and-start-region');
});

test('zugeordnete Umsetzfahrt kann ebenfalls zum Linienstart zuführen', () => {
  const transfer = { id: 'transfer-to-start', routeType: 'transfer', relatedRouteIds: [target.id] };
  const result = api.findOperationalRouteToStart({ targetRoute: target, operationalRoutes: [transfer] });
  assert.equal(result.route.id, 'transfer-to-start');
});

test('fehlende feste Aussetzfahrt liefert nur den strukturierten Fallback-Zustand', () => {
  const result = api.findOperationalRouteToStart({ targetRoute: target, operationalRoutes: [], currentPosition: [51.7, 14.2] });
  assert.equal(result.generatedFallbackRequired, true);
  assert.equal(result.request.destination.lat, 51.75);
});

test('feste Route bleibt vor generiertem Fallback priorisiert', () => {
  const exact = { id: 'fixed', routeType: 'pullout', relatedRouteIds: [target.id] };
  const result = api.findOperationalRouteToStart({ targetRoute: target, operationalRoutes: [exact] });
  assert.equal(result.generatedFallbackRequired, false);
  assert.equal(result.route.id, 'fixed');
});

test('Journey-Plan ist segmentiert und schaltet nicht automatisch um', () => {
  const plan = api.buildOperationalJourneyPlan({
    pullout: { routeType: 'pullout' },
    lineRoute: target,
    pullin: { routeType: 'pullin' }
  });
  assert.deepEqual(Array.from(plan.segments, segment => segment.routeType), ['pullout', 'line', 'pullin']);
  assert.equal(plan.automaticTransition, false);
});

test('Einrück- und Überführungsfahrt nutzen dieselbe exakte Zuordnungsarchitektur', () => {
  const pullin = { id: 'pullin-fixed', routeType: 'pullin', relatedRouteIds: [target.id] };
  const transfer = { id: 'transfer-fixed', routeType: 'transfer', relatedRouteIds: [target.id] };
  assert.equal(api.findOperationalRouteFromEnd({ targetRoute: target, operationalRoutes: [pullin] }).route.id, 'pullin-fixed');
  assert.equal(api.findOperationalTransfer({ targetRoute: target, operationalRoutes: [transfer] }).route.id, 'transfer-fixed');
});

test('Generator bleibt eine inaktive Schnittstelle ohne Routenerzeugung', () => {
  const result = api.buildGeneratedOperationalRoute({ currentPosition: [51.7, 14.2], destination: [51.75, 14.33] });
  assert.equal(result.status, 'interface-only');
  assert.equal(result.generated, false);
});

test('normale Auswahlliste filtert Betriebsfahrten und behandelt Altbestand als Linie', () => {
  assert.ok(appSource.includes("normalizeOperationalRouteType(line.routeType) === 'line'"));
});
