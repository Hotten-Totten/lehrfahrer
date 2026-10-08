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
  constructor(bytes, onRead = () => {}) {
    this.bytes = Uint8Array.from(bytes);
    this.size = this.bytes.byteLength;
    this.onRead = onRead;
  }

  async arrayBuffer() {
    this.onRead();
    return this.bytes.slice().buffer;
  }

  async text() {
    this.onRead();
    return new TextDecoder().decode(this.bytes);
  }
}

class MemoryDirectory {
  constructor(storage, directoryPath = '') {
    this.storage = storage;
    this.path = directoryPath;
    this.kind = 'directory';
    this.files = directoryPath ? new Map() : storage.files;
    this.directories = directoryPath ? new Map() : storage.directories;
  }

  async getDirectoryHandle(name, options = {}) {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new TypeError('Invalid directory name');
    if (!this.directories.has(name)) {
      if (!options.create) throw Object.assign(new Error('Missing directory'), { name: 'NotFoundError' });
      this.directories.set(name, new MemoryDirectory(this.storage, `${this.path}/${name}`));
    }
    return this.directories.get(name);
  }

  async *entries() {
    yield* this.directories.entries();
    for (const name of this.files.keys()) yield [name, { kind: 'file' }];
  }

  async getFileHandle(name, options = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw Object.assign(new Error('Missing file'), { name: 'NotFoundError' });
      this.files.set(name, new MemoryFile([]));
    }
    return {
      kind: 'file',
      getFile: async () => this.files.get(name),
      createWritable: async () => {
        let pending = null;
        return {
          write: async value => {
            const fullName = `${this.path}/${name}`;
            if (this.storage.failWrites.has(name) || this.storage.failWrites.has(fullName)) {
              this.storage.failWrites.delete(name);
              this.storage.failWrites.delete(fullName);
              throw new Error(`Simulated write failure: ${name}`);
            }
            pending = value instanceof Uint8Array ? value : new Uint8Array(value);
          },
          close: async () => {
            if (!pending) throw new Error('No bytes written');
            const fullName = `${this.path}/${name}`;
            if (this.storage.failCloses.has(fullName)) {
              this.storage.failCloses.delete(fullName);
              throw new Error(`Simulated close failure: ${name}`);
            }
            this.files.set(name, new MemoryFile(pending, () => {
              this.storage.reads.push(fullName);
            }));
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
    failWrites: new Set(),
    failCloses: new Set(),
    reads: []
  };
  const root = new MemoryDirectory(storage);
  storage.getDirectory = async () => root;
  return storage;
}

async function getRegionDirectory(storage, regionId = 'storage-test') {
  const root = await storage.getDirectory();
  const directory = await root.getDirectoryHandle('lehrfahrer-local-routing');
  return directory.getDirectoryHandle(`region-${encodeURIComponent(regionId)}`);
}

async function seedLegacy(storage, graph = createGraph()) {
  const root = await storage.getDirectory();
  const directory = await root.getDirectoryHandle('lehrfahrer-local-routing', { create: true });
  const bytes = new TextEncoder().encode(JSON.stringify(graph));
  const checksum = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const metadata = { ...storageApi.validateGraph(graph) };
  delete metadata.formatVersion;
  directory.files.set('routing-graph-0.json', new MemoryFile(bytes));
  directory.files.set('routing-index-0.json', new MemoryFile(new TextEncoder().encode(JSON.stringify({
    slot: 0, generation: 4, graphFile: 'routing-graph-0.json',
    fileSizeBytes: bytes.length, checksum, metadata
  }))));
  return directory;
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
  (await getRegionDirectory(storage)).files.set('routing-graph-1.json', new MemoryFile(new TextEncoder().encode('{broken')));

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

  test('A/B/C koexistieren und ein B-Update ändert ausschließlich B', async () => {
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    for (const regionId of ['A', 'B', 'C']) await store.saveGraph(createGraph({ regionId }));
    const beforeA = (await getRegionDirectory(storage, 'A')).files.get('routing-graph-0.json');
    const beforeC = (await getRegionDirectory(storage, 'C')).files.get('routing-index-0.json');
    const updated = await store.saveGraph(createGraph({ regionId: 'B', graphVersion: '2', priority: 10 }));
    const restarted = storageApi.createOPFSGraphStore(storage);
    const catalog = await restarted.listGraphs();
    assert.deepEqual(Array.from(catalog, entry => entry.regionId), ['B', 'A', 'C']);
    assert.equal(updated.metadata.generation, 2);
    assert.equal(updated.metadata.slot, 1);
    assert.equal((await restarted.loadGraph(1, 'A')).graph.graphVersion, '1');
    assert.equal((await restarted.loadGraph(1, 'B')).graph.graphVersion, '2');
    assert.equal((await restarted.loadGraph(1, 'C')).graph.graphVersion, '1');
    assert.equal((await getRegionDirectory(storage, 'A')).files.get('routing-graph-0.json'), beforeA);
    assert.equal((await getRegionDirectory(storage, 'C')).files.get('routing-index-0.json'), beforeC);
    const implicitLoad = await restarted.loadGraph();
    assert.equal(implicitLoad.status, 'selection-required');
    assert.deepEqual(Array.from(implicitLoad.regions, entry => entry.regionId), ['B', 'A', 'C']);
    assert.equal((await restarted.loadGraph(1, 'missing')).status, 'not-installed');
  });

  test('ungültiger Import einer anderen Region verändert weder Katalog noch gültige Regionen', async () => {
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'A' }));
    const invalid = createGraph({ regionId: 'B' });
    invalid.edges[0].to = 'missing';
    await assert.rejects(store.saveGraph(invalid), /Edge/);
    await assert.rejects(store.saveGraph(createGraph({ regionId: 'C', priority: 'high' })), /Priorität/);
    assert.deepEqual(Array.from(await store.listGraphs(), entry => entry.regionId), ['A']);
    assert.equal((await store.loadGraph(1, 'A')).graph.graphVersion, '1');
    assert.equal((await store.loadGraph(1, 'B')).status, 'not-installed');
  });

  test('regionId wird kollisionsfrei als sicherer Unterordner kodiert', async () => {
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    const regions = ['../B/Ä\\?', '%2F', '/', '..', 'region-A'];
    for (const regionId of regions) await store.saveGraph(createGraph({ regionId }));
    assert.equal((await store.listGraphs()).length, regions.length);
    for (const regionId of regions) {
      const loaded = await store.loadGraph(1, regionId);
      assert.equal(loaded.graph.regionId, regionId);
      assert.equal(loaded.metadata.directoryName, `region-${encodeURIComponent(regionId)}`);
    }
  });

  test('Katalog-Neustart liest nur Metadaten und explizites Laden nur die angefragte Region', async () => {
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    for (const regionId of ['A', 'B', 'C']) await store.saveGraph(createGraph({ regionId }));
    storage.reads.length = 0;
    const restarted = storageApi.createOPFSGraphStore(storage);
    const catalog = await restarted.listGraphs();
    assert.equal(catalog.length, 3);
    assert.equal(storage.reads.some(name => /routing-graph-/.test(name)), false);
    for (const entry of catalog) {
      assert.equal(entry.schemaVersion, 1);
      assert.equal(entry.generation, 1);
      assert.equal(entry.graphVersion, '1');
      assert.equal(entry.sizeBytes, entry.fileSizeBytes);
      assert.equal(entry.sha256, entry.checksum);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual({ ...entry.boundingBox }, createGraph().boundingBox);
    }
    assert.equal((await restarted.listGraphs(2)).length, 0);
    storage.reads.length = 0;
    assert.equal((await restarted.loadGraph(1, 'B')).status, 'ready');
    assert.equal(storage.reads.every(name => name.includes('/region-B/')), true);
  });

  test('Graph- und Manifest-Schreib-/Closefehler rollen nur das B-Update zurück', async () => {
    for (const file of ['routing-graph-1.json', 'routing-index-1.json']) {
      for (const failure of ['failWrites', 'failCloses']) {
        const storage = createStorage();
        const store = storageApi.createOPFSGraphStore(storage);
        for (const regionId of ['A', 'B', 'C']) await store.saveGraph(createGraph({ regionId }));
        storage[failure].add(`/lehrfahrer-local-routing/region-B/${file}`);
        await assert.rejects(store.saveGraph(createGraph({ regionId: 'B', graphVersion: '2' })), /Simulated/);
        for (const regionId of ['A', 'B', 'C']) {
          assert.equal((await store.loadGraph(1, regionId)).graph.graphVersion, '1');
        }
        assert.equal((await store.listGraphs()).find(entry => entry.regionId === 'B').generation, 1);
        await store.saveGraph(createGraph({ regionId: 'B', graphVersion: '3' }));
        assert.equal((await store.loadGraph(1, 'B')).graph.graphVersion, '3');
      }
    }
  });

  test('parallel gespeicherte Updates derselben Region behalten zwei atomare Slots', async () => {
    const storage = createStorage();
    const first = storageApi.createOPFSGraphStore(storage);
    const second = storageApi.createOPFSGraphStore(storage);
    await first.saveGraph(createGraph({ regionId: 'B' }));
    const results = await Promise.all([
      first.saveGraph(createGraph({ regionId: 'B', graphVersion: '2' })),
      second.saveGraph(createGraph({ regionId: 'B', graphVersion: '3' }))
    ]);
    assert.deepEqual(results.map(value => value.metrics.generation), [2, 3]);
    assert.equal((await second.loadGraph(1, 'B')).graph.graphVersion, '3');
    const directory = await getRegionDirectory(storage, 'B');
    directory.files.set('routing-graph-0.json', new MemoryFile(new TextEncoder().encode('{broken')));
    assert.equal((await second.loadGraph(1, 'B')).graph.graphVersion, '2');
  });

  test('Legacy-Migration validiert, kopiert und bleibt ohne Überschreiben neuerer Graphen idempotent', async () => {
    const storage = createStorage();
    const legacyDirectory = await seedLegacy(storage);
    const legacyFile = legacyDirectory.files.get('routing-graph-0.json');
    const store = storageApi.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'other' }));
    assert.deepEqual(Array.from(await store.listGraphs(), entry => entry.regionId), ['other']);
    const migrated = await store.migrateLegacyGraph();
    assert.equal(migrated.status, 'migrated');
    assert.equal(migrated.regionId, 'storage-test');
    assert.equal((await store.loadGraph(1, 'storage-test')).graph.graphVersion, '1');
    assert.equal(legacyDirectory.files.get('routing-graph-0.json'), legacyFile);
    assert.equal((await store.migrateLegacyGraph()).status, 'already-migrated');
    await store.saveGraph(createGraph({ graphVersion: '2' }));
    const repeated = await storageApi.createOPFSGraphStore(storage).migrateLegacyGraph();
    assert.equal(repeated.status, 'already-migrated');
    assert.equal(repeated.metadata.graphVersion, '2');
    assert.equal(repeated.metadata.generation, 2);
    assert.equal((await store.loadGraph(1, 'other')).status, 'ready');
  });

  test('Legacy wird nach fehlgeschlagener Migration erhalten und ein erneuter Versuch gelingt', async () => {
    const storage = createStorage();
    const legacyDirectory = await seedLegacy(storage);
    const legacyFile = legacyDirectory.files.get('routing-graph-0.json');
    const store = storageApi.createOPFSGraphStore(storage);
    storage.failWrites.add('routing-index-0.json');
    assert.equal((await store.migrateLegacyGraph()).status, 'unavailable');
    assert.equal(legacyDirectory.files.get('routing-graph-0.json'), legacyFile);
    assert.equal((await store.listGraphs()).length, 0);
    assert.equal((await store.migrateLegacyGraph()).status, 'migrated');
    assert.equal((await store.loadGraph()).graph.regionId, 'storage-test');
  });

  test('ungültiger Legacy-Graph wird nicht migriert und beeinflusst andere Regionen nicht', async () => {
    const storage = createStorage();
    const directory = await seedLegacy(storage);
    directory.files.set('routing-graph-0.json', new MemoryFile(new TextEncoder().encode('{broken')));
    const store = storageApi.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'A' }));
    assert.equal((await store.migrateLegacyGraph()).status, 'invalid');
    assert.deepEqual(Array.from(await store.listGraphs(), entry => entry.regionId), ['A']);
    assert.equal((await store.loadGraph(1, 'A')).status, 'ready');
    assert.equal((await store.loadGraph()).graph.regionId, 'A');
    assert.equal((await storageApi.createOPFSGraphStore(createStorage()).migrateLegacyGraph()).status, 'not-installed');
  });

  test('Legacy-Kompatibilität lädt den Root-Graphen ohne expliziten Migrationsaufruf', async () => {
    const storage = createStorage();
    await seedLegacy(storage);
    const store = storageApi.createOPFSGraphStore(storage);
    assert.equal((await store.loadGraph(1, 'storage-test')).status, 'not-installed');
    assert.equal((await store.loadGraph()).graph.regionId, 'storage-test');
    assert.equal((await store.listGraphs()).length, 1);
  });

  test('gleichzeitige Legacy-Migrationen kopieren eine Region nur einmal', async () => {
    const storage = createStorage();
    await seedLegacy(storage);
    const first = storageApi.createOPFSGraphStore(storage);
    const second = storageApi.createOPFSGraphStore(storage);
    const results = await Promise.all([first.migrateLegacyGraph(), second.migrateLegacyGraph()]);
    assert.deepEqual(results.map(result => result.status).sort(), ['already-migrated', 'migrated']);
    assert.equal((await first.listGraphs())[0].generation, 1);
  });

  test('Migration hinterlegt einen dauerhaften Marker; jeder folgende Startup liest nur Metadaten', async () => {
    const storage = createStorage();
    const legacyDirectory = await seedLegacy(storage);
    const store = storageApi.createOPFSGraphStore(storage);
    assert.equal((await store.migrateLegacyGraph()).status, 'migrated');
    assert.equal(legacyDirectory.files.has('routing-legacy-migration.json'), true);
    const legacyFile = legacyDirectory.files.get('routing-graph-0.json');
    legacyFile.arrayBuffer = async () => { throw new Error('Legacy graph must not be read after migration'); };
    legacyFile.text = legacyFile.arrayBuffer;
    await store.saveGraph(createGraph({ graphVersion: '2' }));
    for (let restart = 0; restart < 2; restart += 1) {
      storage.reads.length = 0;
      const restarted = storageApi.createOPFSGraphStore(storage);
      const migration = await restarted.migrateLegacyGraph();
      const catalog = await restarted.listGraphs();
      assert.equal(migration.status, 'already-migrated');
      assert.equal(migration.metadata.graphVersion, '2');
      assert.equal(catalog[0].graphVersion, '2');
      assert.equal(storage.reads.some(name => /routing-graph-/.test(name)), false);
    }
  });

  test('fehlgeschlagener Migrationsmarker bleibt reparierbar und bewahrt den Legacy-Graph', async () => {
    const storage = createStorage();
    const legacyDirectory = await seedLegacy(storage);
    const store = storageApi.createOPFSGraphStore(storage);
    storage.failWrites.add('routing-legacy-migration.json');
    assert.equal((await store.migrateLegacyGraph()).status, 'unavailable');
    assert.equal(legacyDirectory.files.has('routing-graph-0.json'), true);
    assert.equal((await store.listGraphs()).length, 1);
    assert.equal((await store.migrateLegacyGraph()).status, 'already-migrated');
    assert.equal((await store.listGraphs())[0].generation, 1);
  });

  test('beschädigte Katalogmetadaten werden protokolliert, ohne gültige Regionen zu blockieren', async () => {
    const storage = createStorage();
    const warnings = [];
    const context = { TextEncoder, TextDecoder, performance, crypto: webcrypto,
      console: { warn(...args) { warnings.push(args); } } };
    vm.createContext(context);
    vm.runInContext(storageSource, context);
    const store = context.LehrfahrerLocalBusRoutingStorage.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'A' }));
    await store.saveGraph(createGraph({ regionId: 'B' }));
    const directory = await getRegionDirectory(storage, 'B');
    directory.files.set('routing-index-0.json', new MemoryFile(new TextEncoder().encode('{broken')));
    assert.deepEqual(Array.from(await store.listGraphs(), entry => entry.regionId), ['A']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Ungültiges Routinggraph-Manifest/);
    assert.equal(warnings[0][1], 'B');
    assert.equal((await store.loadGraph(1, 'A')).status, 'ready');
  });

  test('fremde oder beschädigte Metadaten werden nicht als Region katalogisiert', async () => {
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'A' }));
    await store.saveGraph(createGraph({ regionId: 'B' }));
    const directory = await getRegionDirectory(storage, 'B');
    const manifest = JSON.parse(await directory.files.get('routing-index-0.json').text());
    manifest.regionId = 'A';
    directory.files.set('routing-index-0.json', new MemoryFile(new TextEncoder().encode(JSON.stringify(manifest))));
    assert.deepEqual(Array.from(await store.listGraphs(), entry => entry.regionId), ['A']);
    assert.equal((await store.loadGraph(1, 'B')).status, 'not-installed');
    assert.equal((await store.loadGraph(1, 'A')).graph.regionId, 'A');
  });

  test('Metadaten-Fallback und Versions-/Checksum-Pins stimmen zwischen Liste und explizitem Laden überein', async () => {
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'B' }));
    const snapshot = (await store.listGraphs())[0];
    const first = await store.loadGraph(1, 'B');
    assert.equal(first.metadata.graphVersion, snapshot.graphVersion);
    assert.equal(first.metadata.checksum, snapshot.checksum);
    assert.equal(first.metadata.sha256, snapshot.checksum);
    await store.saveGraph(createGraph({ regionId: 'B', graphVersion: '2' }));
    const updated = await store.loadGraph(1, 'B');
    assert.notEqual(updated.metadata.graphVersion, snapshot.graphVersion);
    assert.notEqual(updated.metadata.checksum, snapshot.checksum);
    const directory = await getRegionDirectory(storage, 'B');
    directory.files.set('routing-index-1.json', new MemoryFile(new TextEncoder().encode('{broken')));
    storage.reads.length = 0;
    const fallback = (await store.listGraphs())[0];
    assert.equal(storage.reads.some(name => /routing-graph-/.test(name)), false);
    assert.equal(fallback.graphVersion, snapshot.graphVersion);
    assert.equal(fallback.checksum, snapshot.checksum);
    assert.equal(fallback.slot, snapshot.slot);
    assert.equal(fallback.generation, snapshot.generation);
    const loaded = await store.loadGraph(1, 'B');
    assert.equal(loaded.metadata.checksum, fallback.checksum);
    assert.equal(loaded.metadata.graphVersion, fallback.graphVersion);
  });

  test('Web Locks serialisieren regionale Updates auch über getrennte Modulinstanzen', async () => {
    const storage = createStorage();
    const pending = new Map();
    const names = [];
    const locks = {
      request(name, options, callback) {
        names.push(name);
        assert.equal(options.mode, 'exclusive');
        const operation = (pending.get(name) || Promise.resolve()).catch(() => {}).then(callback);
        pending.set(name, operation);
        return operation;
      }
    };
    const stores = [0, 1].map(() => {
      const context = { TextEncoder, TextDecoder, performance, crypto: webcrypto, navigator: { locks } };
      vm.createContext(context);
      vm.runInContext(storageSource, context);
      return context.LehrfahrerLocalBusRoutingStorage.createOPFSGraphStore(storage);
    });
    await stores[0].saveGraph(createGraph({ regionId: 'B' }));
    const results = await Promise.all([
      stores[0].saveGraph(createGraph({ regionId: 'B', graphVersion: '2' })),
      stores[1].saveGraph(createGraph({ regionId: 'B', graphVersion: '3' }))
    ]);
    assert.deepEqual(results.map(result => result.metrics.generation), [2, 3]);
    assert.equal(new Set(names).size, 1);
    assert.equal((await stores[0].loadGraph(1, 'B')).metadata.graphVersion, '3');
    assert.equal((await stores[0].listGraphs())[0].priority, 0);
  });

  test('Katalog-I/O-Fehler werden weitergereicht; Migration meldet unavailable oder invalid', async () => {
    const storage = createStorage();
    const directory = await seedLegacy(storage);
    const store = storageApi.createOPFSGraphStore(storage);
    directory.files.set('routing-index-0.json', new MemoryFile(new TextEncoder().encode('{broken')));
    const invalid = await store.migrateLegacyGraph();
    assert.equal(invalid.status, 'invalid');
    assert.match(invalid.error, /Manifest/);
    const deniedStorage = {
      getDirectory: async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); }
    };
    const denied = storageApi.createOPFSGraphStore(deniedStorage);
    await assert.rejects(denied.listGraphs(), /Permission denied/);
    const unavailable = await denied.migrateLegacyGraph();
    assert.equal(unavailable.status, 'unavailable');
    assert.match(unavailable.error, /Permission denied/);
    await store.saveGraph(createGraph({ regionId: 'A' }));
    const region = await getRegionDirectory(storage, 'A');
    region.files.get('routing-index-0.json').text = async () => { throw new Error('Metadata read failed'); };
    await assert.rejects(store.listGraphs(), /Metadata read failed/);
  });

  test('50-MiB-Limit bleibt pro Graph bestehen und ein übergroßer Import erzeugt keinen Ordner', async () => {
    assert.equal(storageApi.MAX_GRAPH_SIZE_BYTES, 50 * 1024 * 1024);
    const storage = createStorage();
    const store = storageApi.createOPFSGraphStore(storage);
    await store.saveGraph(createGraph({ regionId: 'A' }));
    await assert.rejects(store.saveGraph(createGraph({
      regionId: 'B', padding: 'x'.repeat(storageApi.MAX_GRAPH_SIZE_BYTES)
    })), /Dateigröße/);
    assert.deepEqual(Array.from(await store.listGraphs(), entry => entry.regionId), ['A']);
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

test('App-Dateiimport und Neustart laden nur den Katalog; fehlerhafter Folgeimport bewahrt die Region', async () => {
  const storage = createStorage();
  const warnings = [];
  const context = {
    TextEncoder,
    TextDecoder,
    performance,
    crypto: webcrypto,
    navigator: { storage },
    console: { warn(...args) { warnings.push(args); } },
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
    let localBusRoutingCatalog = [];
    let localBusRoutingStore = null;
    let localBusRoutingCatalogInitialization = null;
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
    function formatRoutingGraphBoundingBox(box) {
      return \`BBox lat \${box.minLat.toFixed(4)}..\${box.maxLat.toFixed(4)}, lon \${box.minLon.toFixed(4)}..\${box.maxLon.toFixed(4)}\`;
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
  assert.equal(vm.runInContext('localBusRouterImplementation', context), null);
  assert.deepEqual(Array.from(vm.runInContext('localBusRoutingCatalog', context), entry => entry.regionId), ['storage-test']);
  assert.match(vm.runInContext('routingGraphInstallStatus.textContent', context), /BBox lat 51\.7000\.\.51\.8000, lon 14\.2000\.\.14\.4000/);
  assert.equal((await storageApi.createOPFSGraphStore(storage).loadGraph(1)).graph.regionId, 'storage-test');

  vm.runInContext(`
    localBusRoutingCatalog = [];
    localBusRoutingStore = null;
    localBusRoutingCatalogInitialization = null;
  `, context);
  storage.reads.length = 0;
  const restored = await vm.runInContext('initializePersistentLocalBusRoutingGraph()', context);
  assert.equal(restored.status, 'ready');
  assert.deepEqual(Array.from(restored.regions, entry => entry.regionId), ['storage-test']);
  assert.equal(vm.runInContext('localBusRouterImplementation', context), null);
  assert.equal(storage.reads.some(name => /routing-graph-/.test(name)), false);
  assert.equal(await vm.runInContext('initializePersistentLocalBusRoutingGraph()', context), restored);

  const invalidGraph = { ...validGraph, graphVersion: '2', edgeCount: 99 };
  const invalidJson = JSON.stringify(invalidGraph);
  context.importFile = { size: Buffer.byteLength(invalidJson), text: async () => invalidJson };
  vm.runInContext('routingGraphFileInput.files = [importFile]', context);
  await vm.runInContext('onRoutingGraphFileSelected()', context);

  assert.match(vm.runInContext('routingGraphInstallStatus.textContent', context), /Import fehlgeschlagen/);
  assert.equal(vm.runInContext('localBusRouterImplementation', context), null);
  assert.equal(vm.runInContext('localBusRoutingCatalog[0].graphVersion', context), '1');
  assert.equal((await storageApi.createOPFSGraphStore(storage).loadGraph(1)).graph.graphVersion, '1');

  const legacyDirectory = await seedLegacy(storage);
  legacyDirectory.files.set('routing-graph-0.json', new MemoryFile(new TextEncoder().encode('{broken')));
  vm.runInContext(`
    localBusRoutingCatalog = [];
    localBusRoutingStore = null;
    localBusRoutingCatalogInitialization = null;
  `, context);
  const withBrokenLegacy = await vm.runInContext('initializePersistentLocalBusRoutingGraph()', context);
  assert.equal(withBrokenLegacy.status, 'ready');
  assert.deepEqual(Array.from(withBrokenLegacy.regions, entry => entry.regionId), ['storage-test']);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /Migration/);
  assert.equal(vm.runInContext('routingGraphInstallStatus.dataset.state', context), 'warning');

  const repairedJson = JSON.stringify(createGraph({ graphVersion: '2' }));
  context.importFile = { size: Buffer.byteLength(repairedJson), text: async () => repairedJson };
  vm.runInContext('routingGraphFileInput.files = [importFile]', context);
  await vm.runInContext('onRoutingGraphFileSelected()', context);
  assert.equal(vm.runInContext('localBusRoutingCatalog[0].graphVersion', context), '2');
  assert.equal(vm.runInContext('localBusRouterImplementation', context), null);
  assert.equal((await storageApi.createOPFSGraphStore(storage).loadGraph(1, 'storage-test')).graph.graphVersion, '2');

  legacyDirectory.directories.clear();
  vm.runInContext(`
    localBusRoutingCatalog = [];
    localBusRoutingStore = null;
    localBusRoutingCatalogInitialization = null;
  `, context);
  const onlyBrokenLegacy = await vm.runInContext('initializePersistentLocalBusRoutingGraph()', context);
  assert.equal(onlyBrokenLegacy.status, 'not-installed');
  assert.equal(onlyBrokenLegacy.regions.length, 0);
  assert.equal(warnings.length, 2);
  vm.runInContext('routingGraphFileInput.files = [importFile]', context);
  await vm.runInContext('onRoutingGraphFileSelected()', context);
  assert.equal(vm.runInContext('localBusRoutingCatalog[0].graphVersion', context), '2');
  assert.equal(vm.runInContext('localBusRouterImplementation', context), null);
});

test('zwei Regionen bleiben ueber zwei Store-Neustarts katalogisiert', async () => {
  const storage = createStorage();
  const store = storageApi.createOPFSGraphStore(storage);
  await store.saveGraph(createGraph({
    regionId: 'cottbus',
    boundingBox: { minLat: 51.72, minLon: 14.25, maxLat: 51.80, maxLon: 14.42 }
  }), routingApi.FORMAT_VERSION);
  await store.saveGraph(createGraph({
    regionId: 'cottbus-kolkwitz',
    boundingBox: { minLat: 51.65, minLon: 14.14, maxLat: 51.88, maxLon: 14.50 }
  }), routingApi.FORMAT_VERSION);

  for (let restart = 0; restart < 2; restart += 1) {
    const restarted = storageApi.createOPFSGraphStore(storage);
    const catalog = await restarted.listGraphs(routingApi.FORMAT_VERSION);
    assert.deepEqual(Array.from(catalog, entry => entry.regionId), ['cottbus', 'cottbus-kolkwitz']);
    const implicitLoad = await restarted.loadGraph(routingApi.FORMAT_VERSION);
    assert.equal(implicitLoad.status, 'selection-required');
    assert.deepEqual(Array.from(implicitLoad.regions, entry => entry.regionId), ['cottbus', 'cottbus-kolkwitz']);
  }

  const selected = await storageApi.createOPFSGraphStore(storage)
    .loadGraph(routingApi.FORMAT_VERSION, 'cottbus-kolkwitz');
  assert.equal(selected.graph.regionId, 'cottbus-kolkwitz');
});
