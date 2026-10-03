const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');
const storageSource = fs.readFileSync(path.join(projectRoot, 'app/js/local-bus-routing-storage.js'), 'utf8');
const routerSource = fs.readFileSync(path.join(projectRoot, 'app/js/local-bus-router.js'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');
const sandbox = { TextEncoder, TextDecoder, performance, crypto: webcrypto };
vm.createContext(sandbox);
vm.runInContext(storageSource, sandbox);
vm.runInContext(routerSource, sandbox);
const storageApi = sandbox.LehrfahrerLocalBusRoutingStorage;
const routingApi = sandbox.LehrfahrerLocalBusRouting;

function createGraph(overrides = {}) {
  const graph = {
    formatVersion: 1,
    regionId: 'storage-test',
    graphVersion: '1',
    createdAt: '2026-10-03T12:00:00Z',
    source: 'OSM',
    boundingBox: { minLat: 51.7, minLon: 14.2, maxLat: 51.8, maxLon: 14.4 },
    nodes: [
      { id: 1, lat: 51.75, lon: 14.3 },
      { id: 2, lat: 51.75, lon: 14.31 }
    ],
    edges: [{
      id: 'edge-1', from: 1, to: 2, lengthMeters: 70, roadClass: 'residential',
      use: 'residential', oneway: true, access: 'unknown', motorVehicle: 'unknown',
      bus: 'unknown', surface: 'asphalt', maxheight: null, maxweight: null,
      maxwidth: null, maxlength: null
    }],
    turnRestrictions: [],
    nodeCount: 2,
    edgeCount: 1,
    restrictionCount: 0,
    ...overrides
  };
  graph.nodeCount = graph.nodes.length;
  graph.edgeCount = graph.edges.length;
  graph.restrictionCount = graph.turnRestrictions.length;
  return graph;
}

class MemoryFile {
  constructor(bytes) {
    this.bytes = Uint8Array.from(bytes);
    this.size = this.bytes.byteLength;
  }

  async arrayBuffer() {
    return this.bytes.slice().buffer;
  }

  async text() {
    return new TextDecoder().decode(this.bytes);
  }
}

class MemoryDirectory {
  constructor(storage) {
    this.storage = storage;
  }

  async getDirectoryHandle(name, options = {}) {
    if (!this.storage.directories.has(name)) {
      if (!options.create) throw Object.assign(new Error('Missing directory'), { name: 'NotFoundError' });
      this.storage.directories.set(name, new MemoryDirectory(this.storage));
    }
    return this.storage.directories.get(name);
  }

  async getFileHandle(name, options = {}) {
    if (!this.storage.files.has(name)) {
      if (!options.create) throw Object.assign(new Error('Missing file'), { name: 'NotFoundError' });
      this.storage.files.set(name, new MemoryFile([]));
    }
    return {
      getFile: async () => this.storage.files.get(name),
      createWritable: async () => {
        let pending = null;
        return {
          write: async value => {
            if (this.storage.failWrites.has(name)) {
              this.storage.failWrites.delete(name);
              throw new Error(`Simulated write failure: ${name}`);
            }
            pending = value instanceof Uint8Array ? value : new Uint8Array(value);
          },
          close: async () => {
            if (!pending) throw new Error('No bytes written');
            this.storage.files.set(name, new MemoryFile(pending));
          },
          abort: async () => {}
        };
      }
    };
  }
}

function createStorage() {
  const storage = {
    files: new Map(),
    directories: new Map(),
    failWrites: new Set()
  };
  storage.getDirectory = async () => new MemoryDirectory(storage);
  return storage;
}

test('Graph wird persistent gespeichert und nach Store-Neustart geladen', async () => {
  const storage = createStorage();
  const firstStore = storageApi.createOPFSGraphStore(storage);
  const saved = await firstStore.saveGraph(createGraph(), routingApi.FORMAT_VERSION);
  const restartedStore = storageApi.createOPFSGraphStore(storage);
  const loaded = await restartedStore.loadGraph(routingApi.FORMAT_VERSION);

  assert.equal(saved.status, 'saved');
  assert.equal(saved.metadata.fileSizeBytes > 0, true);
  assert.match(saved.metadata.checksum, /^[0-9a-f]{64}$/);
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.graph.regionId, 'storage-test');
  assert.equal(loaded.metrics.generation, 1);
});

test('fehlerhafter Import überschreibt den zuvor gültigen Graphen nicht', async () => {
  const storage = createStorage();
  const store = storageApi.createOPFSGraphStore(storage);
  await store.saveGraph(createGraph(), routingApi.FORMAT_VERSION);

  const invalid = createGraph();
  invalid.edgeCount = 99;
  await assert.rejects(store.saveGraph(invalid, routingApi.FORMAT_VERSION), /Zähler/);
  assert.equal((await store.loadGraph(routingApi.FORMAT_VERSION)).graph.graphVersion, '1');
});

test('OPFS-Schreibfehler beim Ersatz lässt den alten aktiven Slot lesbar', async () => {
  const storage = createStorage();
  const store = storageApi.createOPFSGraphStore(storage);
  await store.saveGraph(createGraph(), routingApi.FORMAT_VERSION);
  storage.failWrites.add('routing-graph-1.json');

  await assert.rejects(
    store.saveGraph(createGraph({ graphVersion: '2' }), routingApi.FORMAT_VERSION),
    /Simulated write failure/
  );
  const loaded = await store.loadGraph(routingApi.FORMAT_VERSION);
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.graph.graphVersion, '1');
});

test('defekter jüngster Graph fällt auf den vorherigen validen Graphen zurück', async () => {
  const storage = createStorage();
  const store = storageApi.createOPFSGraphStore(storage);
  await store.saveGraph(createGraph(), routingApi.FORMAT_VERSION);
  await store.saveGraph(createGraph({ graphVersion: '2' }), routingApi.FORMAT_VERSION);
  storage.files.set('routing-graph-1.json', new MemoryFile(new TextEncoder().encode('{broken')));

  const loaded = await store.loadGraph(routingApi.FORMAT_VERSION);
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.graph.graphVersion, '1');
});

test('fehlender Graph und nicht unterstützte Formatversion werden sauber behandelt', async () => {
  const emptyStore = storageApi.createOPFSGraphStore(createStorage());
  assert.equal((await emptyStore.loadGraph()).status, 'not-installed');
  assert.throws(() => storageApi.validateGraph(createGraph({ formatVersion: 2 }), 1), /Formatversion/);
  const invalid = createGraph();
  invalid.nodeCount = 7;
  assert.throws(() => storageApi.validateGraph(invalid, 1), /Zähler/);
});

test('Graphvalidierung weist fehlende Nodes und ungültige Restriktionsreferenzen zurück', () => {
  const danglingNode = createGraph();
  danglingNode.edges[0].to = 'missing-node';
  assert.throws(() => storageApi.validateGraph(danglingNode, 1), /Edge/);

  const undirected = createGraph();
  undirected.edges[0].oneway = false;
  assert.throws(() => storageApi.validateGraph(undirected, 1), /Edge/);

  const invalidTurn = createGraph({
    turnRestrictions: [{ fromEdgeId: 'edge-1', viaNodeId: 2, toEdgeId: 'missing-edge', type: 'no_turn' }]
  });
  assert.throws(() => storageApi.validateGraph(invalidTurn, 1), /Turn-Restriction/);
});

test('BBox-Zuordnung akzeptiert Randpunkte und lehnt Positionen außerhalb ab', () => {
  const box = createGraph().boundingBox;
  assert.equal(storageApi.isPointWithinBoundingBox({ lat: 51.75, lon: 14.3 }, box), true);
  assert.equal(storageApi.isPointWithinBoundingBox({ lat: 51.8, lon: 14.4 }, box), true);
  assert.equal(storageApi.isPointWithinBoundingBox({ lat: 51.8001, lon: 14.4 }, box), false);
  assert.equal(storageApi.isPointWithinBoundingBox({ lat: NaN, lon: 14.3 }, box), false);
});

test('geladener Graph initialisiert den LocalBusRouter und routet', async () => {
  const storage = createStorage();
  const store = storageApi.createOPFSGraphStore(storage);
  const graph = createGraph();
  await store.saveGraph(graph, routingApi.FORMAT_VERSION);
  const loaded = await store.loadGraph(routingApi.FORMAT_VERSION);
  const router = routingApi.createRouter(loaded.graph, { snapRadiusM: 10 });
  const result = await router.routeBusPath({
    from: { lat: graph.nodes[0].lat, lon: graph.nodes[0].lon },
    to: { lat: graph.nodes[1].lat, lon: graph.nodes[1].lon },
    constraints: {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.localPath.edgeIds), ['edge-1']);
});

test('Routinggraph bleibt ein eigener App-Shell-/OPFS-Pfad neben PMTiles', async () => {
  const appHtml = fs.readFileSync(path.join(projectRoot, 'app/index.html'), 'utf8');
  const appShell = fs.readFileSync(path.join(projectRoot, 'app/sw.js'), 'utf8');
  const mapSource = fs.readFileSync(path.join(projectRoot, 'app/js/map.js'), 'utf8');
  assert.match(appHtml, /maplibre-gl@/);
  assert.match(appHtml, /pmtiles@/);
  assert.match(appHtml, /js\/local-bus-routing-storage\.js/);
  assert.match(appShell, /\.\/js\/local-bus-routing-storage\.js/);
  assert.doesNotMatch(mapSource, /LehrfahrerLocalBusRoutingStorage/);

  const storage = createStorage();
  storage.files.set('region.pmtiles', new MemoryFile(new Uint8Array([1, 2, 3])));
  const tileBytesBefore = storage.files.get('region.pmtiles').size;
  await storageApi.createOPFSGraphStore(storage).saveGraph(createGraph(), routingApi.FORMAT_VERSION);
  assert.equal(storage.files.get('region.pmtiles').size, tileBytesBefore);
  assert.equal((await storageApi.createOPFSGraphStore(storage).loadGraph()).status, 'ready');

  const mapOnlyStorage = createStorage();
  mapOnlyStorage.files.set('region.pmtiles', new MemoryFile(new Uint8Array([4, 5, 6])));
  assert.equal((await storageApi.createOPFSGraphStore(mapOnlyStorage).loadGraph()).status, 'not-installed');
  assert.equal(mapOnlyStorage.files.get('region.pmtiles').size, 3);
});

test('App-Dateiimport registriert erst nach Persistenz und behält den Graph bei fehlerhaftem Folgeimport', async () => {
  const storage = createStorage();
  const context = {
    TextEncoder,
    TextDecoder,
    performance,
    crypto: webcrypto,
    navigator: { storage },
    console: { warn() {} },
    importFile: null
  };
  vm.createContext(context);
  vm.runInContext(storageSource, context);
  vm.runInContext(routerSource, context);
  const integrationSource = appSource.slice(
    appSource.indexOf('async function installLocalBusRoutingGraph'),
    appSource.indexOf('function uninstallLocalBusRoutingGraph')
  );
  vm.runInContext(`
    const LOCAL_BUS_ROUTING_GRAPH_SPEC = { schemaVersion: 1 };
    let localBusRouterImplementation = null;
    const routingGraphInstallStatus = { textContent: '', dataset: {} };
    const importRoutingGraphBtn = { disabled: false };
    const routingGraphFileInput = { files: [], value: '' };
    function registerLocalBusRouter(value) {
      localBusRouterImplementation = value;
      return !!value;
    }
    function loadLocalBusRouterModule() {
      return Promise.resolve(globalThis.LehrfahrerLocalBusRouting);
    }
    async function requestPersistentStorage() { return true; }
    async function refreshStoragePersistenceStatus() { return { persisted: true }; }
    function showToast() {}
    ${integrationSource}
  `, context);

  const validGraph = createGraph();
  const validJson = JSON.stringify(validGraph);
  context.importFile = { size: Buffer.byteLength(validJson), text: async () => validJson };
  vm.runInContext('routingGraphFileInput.files = [importFile]', context);
  await vm.runInContext('onRoutingGraphFileSelected()', context);
  assert.equal(vm.runInContext('localBusRouterImplementation.isAvailable()', context), true);
  assert.equal((await storageApi.createOPFSGraphStore(storage).loadGraph(1)).graph.regionId, 'storage-test');

  vm.runInContext('registerLocalBusRouter(null)', context);
  const restored = await vm.runInContext('initializePersistentLocalBusRoutingGraph()', context);
  assert.equal(restored.status, 'ready');
  assert.equal(vm.runInContext('localBusRouterImplementation.isAvailable()', context), true);

  const invalidGraph = { ...validGraph, graphVersion: '2', edgeCount: 99 };
  const invalidJson = JSON.stringify(invalidGraph);
  context.importFile = { size: Buffer.byteLength(invalidJson), text: async () => invalidJson };
  vm.runInContext('routingGraphFileInput.files = [importFile]', context);
  await vm.runInContext('onRoutingGraphFileSelected()', context);

  assert.match(vm.runInContext('routingGraphInstallStatus.textContent', context), /Import fehlgeschlagen/);
  assert.equal(vm.runInContext('localBusRouterImplementation.isAvailable()', context), true);
  assert.equal((await storageApi.createOPFSGraphStore(storage).loadGraph(1)).graph.graphVersion, '1');
});
