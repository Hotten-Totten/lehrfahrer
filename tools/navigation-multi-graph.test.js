const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');

function graph(regionId, minLon, maxLon, graphVersion = '1') {
  return {
    formatVersion: 1, regionId, graphVersion,
    createdAt: '2026-10-07T12:00:00Z', source: 'OSM',
    boundingBox: { minLat: 51.7, maxLat: 51.8, minLon, maxLon },
    nodes: [
      { id: 1, lat: 51.75, lon: minLon + 0.01 },
      { id: 2, lat: 51.75, lon: maxLon - 0.01 }
    ],
    edges: [{
      id: 'edge', from: 1, to: 2, oneway: true, lengthMeters: 100,
      roadClass: 'primary', access: 'yes', motorVehicle: 'yes', bus: 'yes'
    }],
    turnRestrictions: [], nodeCount: 2, edgeCount: 1, restrictionCount: 0
  };
}

function setup(graphs = [graph('A', 14.1, 14.3), graph('B', 14.2, 14.4), graph('C', 14.4, 14.6)]) {
  const messages = [];
  const loads = [];
  const regions = graphs.map(value => ({
    regionId: value.regionId, graphVersion: value.graphVersion,
    boundingBox: value.boundingBox, checksum: `${value.regionId}-${value.graphVersion}`,
    fileSizeBytes: 1000
  }));
  const sandbox = {
    console: { info() {}, warn() {} }, performance, TextEncoder, TextDecoder,
    document: { getElementById: () => null },
    showToast: message => messages.push(message),
    renderUpcomingStops() {},
    routingGraphInstallStatus: { textContent: '', dataset: {} },
    importRoutingGraphBtn: { disabled: false },
    navActive: true, navActiveBusReroute: null, navPendingBusRerouteRequest: null,
    currentRoute: { data: { routePoints: [[51.75, 14.15], [51.75, 14.25]] } },
    navLastRawGpsPos: { lat: 51.75, lon: 14.15 },
    navCumDists: [0, 100], navProgressIdx: 0, navStopDists: [],
    buildNavCumDists: points => points.map((_, index) => index * 100),
    detectNavTurns: () => [],
    requestPersistentStorage: async () => true,
    refreshStoragePersistenceStatus: async () => ({ persisted: true })
  };
  vm.createContext(sandbox);
  vm.runInContext(appSource.slice(
    appSource.indexOf('function normalizeOperationalCoordinate'),
    appSource.indexOf('function getRouteEndpoint')
  ), sandbox);
  for (const filename of ['local-bus-routing-storage.js', 'local-bus-router.js']) {
    vm.runInContext(fs.readFileSync(path.join(projectRoot, 'app/js', filename), 'utf8'), sandbox);
  }
  vm.runInContext(appSource.slice(
    appSource.indexOf('function decodeBusReroutePolyline6'),
    appSource.indexOf('function createNavOffRoutePanel')
  ), sandbox);
  const store = {
    migrateLegacyGraph: async () => ({ status: 'not-installed' }),
    listGraphs: async () => regions,
    async loadGraph(_version, regionId) {
      loads.push(regionId);
      return {
        status: 'ready', graph: graphs.find(value => value.regionId === regionId),
        metadata: regions.find(value => value.regionId === regionId)
      };
    }
  };
  sandbox.store = store;
  sandbox.regions = regions;
  vm.runInContext('localBusRoutingStore = store; localBusRoutingCatalog = regions', sandbox);
  return { sandbox, loads, messages, regions, graphs };
}

const point = lon => ({ lat: 51.75, lon });

test('Neustart listet nur Metadaten und erzeugt keinen Router', async () => {
  const { sandbox, loads } = setup();
  const result = await sandbox.initializePersistentLocalBusRoutingGraph();
  assert.equal(result.status, 'ready');
  assert.equal(result.regions.length, 3);
  assert.deepEqual(loads, []);
  assert.equal(vm.runInContext('localBusRouterImplementation', sandbox), null);
  for (const region of ['A', 'B', 'C']) assert.match(sandbox.routingGraphInstallStatus.textContent, new RegExp(`${region} · Version 1`));
});

test('zweiter Neustart zeigt weiterhin alle Regionen und laedt keinen Default-Graph', async () => {
  const { sandbox, loads } = setup([
    graph('cottbus', 14.25, 14.42),
    graph('cottbus-kolkwitz', 14.14, 14.50)
  ]);

  for (let restart = 0; restart < 2; restart += 1) {
    vm.runInContext(`
      localBusRoutingCatalog = [];
      localBusRoutingStore = store;
      localBusRoutingCatalogInitialization = null;
      localBusRouterImplementation = null;
    `, sandbox);
    const result = await sandbox.initializePersistentLocalBusRoutingGraph();
    assert.deepEqual(Array.from(result.regions, entry => entry.regionId), ['cottbus', 'cottbus-kolkwitz']);
    assert.equal(vm.runInContext('localBusRouterImplementation', sandbox), null);
    assert.match(sandbox.routingGraphInstallStatus.textContent, /cottbus · Version 1/);
    assert.match(sandbox.routingGraphInstallStatus.textContent, /cottbus-kolkwitz · Version 1/);
  }

  assert.deepEqual(loads, []);
});

test('Anfragen laden nur den Graph fuer Start und Ziel: A dann B', async () => {
  const { sandbox, loads } = setup();
  sandbox.navActive = false;
  const provider = sandbox.createRegionalBusRoutingProvider();
  const a = await provider.routeBusPath({ from: point(14.11), to: point(14.29), constraints: {} });
  assert.equal(a.ok, true);
  assert.deepEqual(loads, ['A']);
  assert.equal(a.routingContext.regionId, 'A');
  const b = await provider.routeBusPath({ from: point(14.21), to: point(14.39), constraints: {} });
  assert.equal(b.ok, true);
  assert.deepEqual(loads, ['A', 'B']);
  assert.equal(b.routingContext.regionId, 'B');
});

test('Ueberlappung bevorzugt geladenen Graph, dann Gebiet, Prioritaet und regionId', () => {
  const { sandbox, regions } = setup();
  const start = point(14.23);
  const target = point(14.27);
  const equal = regions.slice(0, 2).map(region => ({ ...region, boundingBox: regions[0].boundingBox }));
  assert.equal(sandbox.selectLocalBusRoutingRegion(equal.slice().reverse(), start, target).regionId, 'A');
  equal[1].priority = 10;
  assert.equal(sandbox.selectLocalBusRoutingRegion(equal, start, target).regionId, 'B');
  const smaller = { ...equal[0], regionId: 'small', boundingBox: { ...equal[0].boundingBox, minLon: 14.22, maxLon: 14.28 } };
  assert.equal(sandbox.selectLocalBusRoutingRegion([...equal, smaller], start, target).regionId, 'small');
  const loaded = { graph: { regionId: 'B', graphVersion: '1' }, routingGraphChecksum: equal[1].checksum };
  assert.equal(sandbox.selectLocalBusRoutingRegion([...equal, smaller], start, target, loaded).regionId, 'B');
  loaded.graph.graphVersion = 'obsolete';
  assert.equal(sandbox.selectLocalBusRoutingRegion([...equal, smaller], start, target, loaded).regionId, 'small');
});

test('Start nur in A, Ziel nur in B oder unbekannt: keine zusammengesetzte Route', async () => {
  const { sandbox, loads } = setup();
  const provider = sandbox.createRegionalBusRoutingProvider();
  const result = await provider.routeBusPath({ from: point(14.15), to: point(14.35), constraints: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OUTSIDE_ROUTING_REGION');
  assert.equal(result.geometry.length, 0);
  assert.deepEqual(loads, []);
  assert.match(sandbox.getBusRerouteStatusMessage({ status: 'outside-routing-region' }), /außerhalb der installierten Routingregion/);
});

test('ohne passende Region entsteht kein halber Preview- oder Active-Zustand', async () => {
  const { sandbox, loads, messages } = setup();
  const originalPending = { preserved: true };
  sandbox.navPendingBusRerouteRequest = originalPending;
  sandbox.buildBusReroutePreparation = () => ({
    currentPosition: point(14.15),
    routingCandidates: [{ coordinate: point(14.35) }]
  });
  assert.equal(await sandbox.prepareBusReroutePreviewRequest(), null);
  assert.equal(sandbox.navPendingBusRerouteRequest, originalPending);
  assert.equal(sandbox.navActiveBusReroute, null);
  assert.deepEqual(loads, []);
  assert.match(messages[0], /außerhalb der installierten Routingregion/);
});

test('Rueckfuehrung behaelt konkrete Routerinstanz und Version bei anderem geladenen Graph', async () => {
  const { sandbox, graphs, regions } = setup();
  const provider = sandbox.createRegionalBusRoutingProvider();
  const a = await provider.routeBusPath({ from: point(14.11), to: point(14.29), constraints: {} });
  const selected = { ...a, routeGeometry: a.geometry, candidate: { routeIndex: 1 } };
  const state = sandbox.buildBusRerouteNavigationState({
    originalRoute: {}, preview: { selectedCandidate: selected }
  });
  const bRouter = sandbox.LehrfahrerLocalBusRouting.createRouter(graphs[1]);
  bRouter.routingGraphChecksum = regions[1].checksum;
  sandbox.registerLocalBusRouter(bRouter);
  assert.equal(state.regionId, 'A');
  assert.equal(state.graphVersion, '1');
  assert.equal(state.routingContext.router, a.routingContext.router);
  let renderedGraph;
  sandbox.showBusReroute = (_geometry, _pos, _active, usedGraph) => { renderedGraph = usedGraph; };
  sandbox.navPendingBusRerouteRequest = {
    routingStatus: 'ready', originalRoute: {}, preview: { selectedCandidate: selected }
  };
  assert.equal(sandbox.startPreparedBusReroute(), true);
  assert.equal(sandbox.navActiveBusReroute.routingContext.router, a.routingContext.router);
  assert.equal(renderedGraph.regionId, 'A');
});

test('parallel angefragte Kandidaten behalten ihren eigenen Graphkontext', async () => {
  const { sandbox, loads } = setup();
  sandbox.navActive = false;
  const provider = sandbox.createRegionalBusRoutingProvider();
  const [a, b] = await Promise.all([
    provider.routeBusPath({ from: point(14.21), to: point(14.11), constraints: {} }),
    provider.routeBusPath({ from: point(14.21), to: point(14.39), constraints: {} })
  ]);
  assert.deepEqual(loads, ['A', 'B']);
  assert.equal(a.routingContext.router.graph.regionId, 'A');
  assert.equal(b.routingContext.router.graph.regionId, 'B');
});

test('Regionsupdate waehrend Anfrage wird explizit abgelehnt, nicht still umgeschaltet', async () => {
  const { sandbox } = setup();
  sandbox.store.loadGraph = async () => ({
    status: 'ready', metadata: { graphVersion: '2', checksum: 'new' }, graph: graph('A', 14.1, 14.3, '2')
  });
  const provider = sandbox.createRegionalBusRoutingProvider();
  await assert.rejects(provider.routeBusPath({
    from: point(14.11), to: point(14.29), constraints: {}
  }), /nicht mehr unverändert verfügbar/);
});

test('vollstaendige Preview waehlt B, bindet den Router und verwendet ihn bei Folgeanfragen wieder', async () => {
  const { sandbox, loads } = setup();
  sandbox.currentRoute.data.routePoints = [[51.75, 14.21], [51.75, 14.39]];
  sandbox.navLastRawGpsPos = point(14.21);
  sandbox.buildBusReroutePreparation = () => ({
    currentPosition: sandbox.navLastRawGpsPos,
    routingCandidates: [{
      id: 'return-B', coordinate: point(14.39), skippedStopCount: 0,
      routeProgressM: 100, routeIndex: 1
    }]
  });
  let shownGraph;
  sandbox.showBusReroute = (_geometry, _pos, _active, selectedGraph) => { shownGraph = selectedGraph; };
  const request = await sandbox.prepareBusReroutePreviewRequest();
  assert.equal(request.routingStatus, 'ready');
  assert.equal(request.preview.selectedCandidate.routingContext.regionId, 'B');
  assert.equal(request.preview.selectedCandidate.routingContext.graphVersion, '1');
  assert.equal(shownGraph.regionId, 'B');
  assert.equal(sandbox.getInstalledLocalBusRoutingGraph().regionId, 'B');
  assert.deepEqual(loads, ['B']);
  await sandbox.prepareBusReroutePreviewRequest();
  assert.deepEqual(loads, ['B']);
});

test('kaputter Legacy-Altbestand sperrt andere installierte Regionen nicht', async () => {
  const { sandbox, loads } = setup();
  sandbox.store.migrateLegacyGraph = async () => ({ status: 'invalid', error: 'Altbestand defekt' });
  const result = await sandbox.initializePersistentLocalBusRoutingGraph();
  assert.equal(result.status, 'ready');
  assert.equal(result.regions.length, 3);
  assert.match(sandbox.routingGraphInstallStatus.textContent, /Altbestand defekt/);
  assert.deepEqual(loads, []);
});

test('Import einer neuen Version wechselt eine laufende Rueckfuehrung nicht aus', async () => {
  const { sandbox, regions } = setup();
  const provider = sandbox.createRegionalBusRoutingProvider();
  const a = await provider.routeBusPath({ from: point(14.11), to: point(14.29), constraints: {} });
  const state = sandbox.buildBusRerouteNavigationState({
    originalRoute: {}, preview: { selectedCandidate: { ...a, routeGeometry: a.geometry } }
  });
  sandbox.navActiveBusReroute = state;
  sandbox.registerLocalBusRouter(a.routingContext.router);
  const update = graph('A', 14.1, 14.3, '2');
  const contents = JSON.stringify(update);
  sandbox.routingGraphFileInput = {
    files: [{ size: Buffer.byteLength(contents), text: async () => contents }],
    value: 'graph.json'
  };
  sandbox.store.saveGraph = async () => {
    regions[0] = { ...regions[0], graphVersion: '2', checksum: 'A-2' };
    return { metadata: regions[0], metrics: { writeMs: 1 } };
  };
  await sandbox.onRoutingGraphFileSelected();
  assert.equal(sandbox.navActiveBusReroute, state);
  assert.equal(state.graphVersion, '1');
  assert.equal(state.routingContext.router, a.routingContext.router);
  assert.equal(sandbox.getInstalledLocalBusRoutingGraph().graphVersion, '1');
  assert.match(sandbox.routingGraphInstallStatus.textContent, /A · Version 2/);
  assert.match(sandbox.routingGraphInstallStatus.textContent, /B · Version 1/);
  assert.match(sandbox.routingGraphInstallStatus.textContent, /C · Version 1/);
});

test('vollstaendige Linie einschliesslich mittlerer Abschnitte und BBox-Rand wird geprueft', () => {
  const { sandbox, regions } = setup();
  const box = regions[0].boundingBox;
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, [[51.75, 14.11], [51.75, 14.29]]), true);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, [[51.75, 14.11], [51.75, 14.35], [51.75, 14.29]]), false);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, [[51.7, 14.1], { lat: 51.8, lon: 14.3 }]), true);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, [[51.75, 14.3000001]]), false);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, [[51.8000001, 14.2]]), false);
});

test('optionaler Sicherheitsabstand erweitert die erforderliche Abdeckung in Metern', () => {
  const { sandbox, regions } = setup();
  const box = regions[0].boundingBox;
  const line = [[51.75, 14.1001], [51.75, 14.2]];
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, line), true);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, line, 1), true);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, line, 10), false);
  assert.equal(sandbox.isRoutingRegionCoveringLine(box, [[51.7, 14.2]], 1), false);
  assert.throws(() => sandbox.isRoutingRegionCoveringLine(box, line, -1), /Sicherheitsabstand/);
  assert.throws(() => sandbox.isRoutingRegionCoveringLine(box, line, NaN), /Sicherheitsabstand/);
  assert.throws(() => sandbox.isRoutingRegionCoveringLine(box, []), /Liniengeometrie/);
  assert.throws(() => sandbox.isRoutingRegionCoveringLine(box, [[NaN, 14.2]]), /Koordinate/);
});

test('vollstaendige Linienabdeckung gewinnt auch gegen bereits geladenes kleines Gebiet', async () => {
  const { sandbox, regions, graphs, loads } = setup([graph('small', 14.2, 14.3), graph('full', 14.1, 14.4)]);
  graphs[1].nodes[0].lon = 14.23;
  graphs[1].nodes[1].lon = 14.27;
  sandbox.currentRoute.data.routePoints = [[51.75, 14.23], [51.75, 14.35], [51.75, 14.27]];
  const router = sandbox.LehrfahrerLocalBusRouting.createRouter(graphs[0]);
  router.routingGraphChecksum = regions[0].checksum;
  sandbox.registerLocalBusRouter(router);
  assert.equal(sandbox.selectLocalBusRoutingRegion(
    regions, point(14.23), point(14.27), router, sandbox.currentRoute.data.routePoints
  ).regionId, 'full');
  const result = await sandbox.createRegionalBusRoutingProvider().routeBusPath({
    from: point(14.23), to: point(14.27), constraints: {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.routingContext.regionId, 'full');
  assert.deepEqual(loads, ['full']);
});

test('fehlende Vollabdeckung wird vor Vorbereitung erkannt und laesst Zustaende unveraendert', async () => {
  const { sandbox, loads, messages } = setup();
  sandbox.currentRoute.data.routePoints = [[51.75, 14.15], [51.75, 14.5], [51.75, 14.25]];
  const pending = { preserved: true };
  sandbox.navPendingBusRerouteRequest = pending;
  sandbox.buildBusReroutePreparation = () => { throw new Error('Darf nicht vorbereitet werden'); };
  assert.equal(await sandbox.prepareBusReroutePreviewRequest(), null);
  assert.equal(sandbox.navPendingBusRerouteRequest, pending);
  assert.equal(sandbox.navActiveBusReroute, null);
  assert.match(messages[0], /vollständige aktive Linie/);
  const result = await sandbox.createRegionalBusRoutingProvider().routeBusPath({
    from: point(14.15), to: point(14.25), constraints: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OUTSIDE_ROUTING_REGION');
  assert.deepEqual(loads, []);
});

test('Provider behaelt die gesamte Liniengeometrie als unveraenderlichen Anfragekontext', async () => {
  const { sandbox, loads } = setup();
  const provider = sandbox.createRegionalBusRoutingProvider();
  sandbox.currentRoute.data.routePoints[0][1] = 14.5;
  const result = await provider.routeBusPath({ from: point(14.11), to: point(14.29), constraints: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(loads, ['A']);
});

function setupRealKolkwitzPreparation() {
  const regionalGraph = graph('cottbus-kolkwitz', 14.14476, 14.49261);
  regionalGraph.boundingBox.minLat = 51.65615;
  regionalGraph.boundingBox.maxLat = 51.87029;
  regionalGraph.nodes[0].lon = 14.32;
  regionalGraph.nodes[1].lon = 14.33;
  const fixture = setup([regionalGraph]);
  const { sandbox } = fixture;
  for (const [start, end] of [
    ['function navGetLatLon', 'function bearingDeg'],
    ['function buildNavCumDists', 'function buildNavStopDists'],
    ['function interpolateBusReroutePosition', 'function decodeBusReroutePolyline6']
  ]) {
    vm.runInContext(appSource.slice(appSource.indexOf(start), appSource.indexOf(end)), sandbox);
  }
  sandbox.currentRoute.data.routePoints = [[51.75, 14.32], [51.75, 14.33]];
  sandbox.navCumDists = sandbox.buildNavCumDists(sandbox.currentRoute.data.routePoints);
  sandbox.navLastRawGpsPos = point(14.32);
  return fixture;
}

test('echte Vorbereitung ohne currentPosition waehlt cottbus-kolkwitz mit Raw-GPS-Start', async () => {
  const { sandbox, loads } = setupRealKolkwitzPreparation();
  const preparation = sandbox.buildBusReroutePreparation({
    currentPosition: sandbox.navLastRawGpsPos,
    routePoints: sandbox.currentRoute.data.routePoints,
    routeCumDists: sandbox.navCumDists,
    routeProgressIndex: sandbox.navProgressIdx,
    routeStops: sandbox.navStopDists
  });
  assert.equal(Object.hasOwn(preparation, 'currentPosition'), false);
  assert.ok(preparation.routingCandidates.length > 0);
  const request = await sandbox.prepareBusReroutePreviewRequest();
  assert.ok(request);
  assert.equal(request.currentPosition.lat, 51.75);
  assert.equal(request.currentPosition.lon, 14.32);
  assert.equal(request.routingStatus, 'ready');
  assert.equal(request.preview.selectedCandidate.routingContext.regionId, 'cottbus-kolkwitz');
  assert.deepEqual(loads, ['cottbus-kolkwitz']);
});

test('echte Vorbereitung lehnt Raw-GPS-Start ausserhalb trotz passender Linie und Ziele ab', async () => {
  const { sandbox, loads, messages } = setupRealKolkwitzPreparation();
  sandbox.navLastRawGpsPos = point(14.6);
  const pending = { preserved: true };
  sandbox.navPendingBusRerouteRequest = pending;
  assert.equal(await sandbox.prepareBusReroutePreviewRequest(), null);
  assert.equal(sandbox.navPendingBusRerouteRequest, pending);
  assert.equal(sandbox.navActiveBusReroute, null);
  assert.deepEqual(loads, []);
  assert.match(messages[0], /außerhalb der installierten Routingregion/);
});

test('schnelle Mehrfachanforderung teilt genau eine Reroute-Berechnung', async () => {
  const { sandbox } = setupRealKolkwitzPreparation();
  let releaseInitialization;
  let initializationCalls = 0;
  sandbox.initializePersistentLocalBusRoutingGraph = () => {
    initializationCalls += 1;
    return new Promise(resolve => { releaseInitialization = resolve; });
  };

  const first = sandbox.prepareBusReroutePreviewRequest();
  const second = sandbox.prepareBusReroutePreviewRequest();
  assert.strictEqual(second, first);
  assert.equal(initializationCalls, 1);
  sandbox.navActive = false;
  releaseInitialization({ status: 'ready' });
  assert.equal(await first, null);
});
