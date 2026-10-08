(function initLehrfahrerLocalBusRoutingStorage(global) {
  'use strict';

  const STORAGE_DIRECTORY = 'lehrfahrer-local-routing';
  const GRAPH_FILES = ['routing-graph-0.json', 'routing-graph-1.json'];
  const MANIFEST_FILES = ['routing-index-0.json', 'routing-index-1.json'];
  const MIGRATION_FILE = 'routing-legacy-migration.json';
  const MAX_GRAPH_SIZE_BYTES = 50 * 1024 * 1024;
  const writeQueues = new WeakMap();

  function regionDirectoryName(regionId) {
    if (typeof regionId !== 'string' || !regionId.trim()) fail('Ungültige Routinggraph-Region.');
    return `region-${encodeURIComponent(regionId)}`;
  }

  function fail(message) {
    throw new Error(message);
  }

  function validateBoundingBox(box) {
    if (!box || ![
      box.minLat, box.minLon, box.maxLat, box.maxLon
    ].every(value => Number.isFinite(Number(value)))) {
      fail('Routinggraph enthält keine gültige BoundingBox.');
    }
    if (!(Number(box.minLat) >= -90 && Number(box.minLat) < Number(box.maxLat) &&
        Number(box.maxLat) <= 90 && Number(box.minLon) >= -180 &&
        Number(box.minLon) < Number(box.maxLon) && Number(box.maxLon) <= 180)) {
      fail('Routinggraph enthält eine unplausible BoundingBox.');
    }
  }

  function validateGraph(graph, expectedFormatVersion = 1) {
    if (!graph || Number(graph.formatVersion) !== Number(expectedFormatVersion)) {
      fail(`Nicht unterstützte Routinggraph-Formatversion: ${graph?.formatVersion ?? 'fehlt'}.`);
    }
    if (typeof graph.regionId !== 'string' || !graph.regionId.trim() ||
        graph.graphVersion === undefined || graph.graphVersion === null || String(graph.graphVersion) === '' ||
        typeof graph.createdAt !== 'string' || !graph.createdAt.trim() ||
        typeof graph.source !== 'string' || !graph.source.trim()) {
      fail('Routinggraph-Metadaten sind unvollständig.');
    }
    validateBoundingBox(graph.boundingBox);
    if (!Array.isArray(graph.nodes) || !graph.nodes.length || !Array.isArray(graph.edges) ||
        !graph.edges.length || !Array.isArray(graph.turnRestrictions)) {
      fail('Routinggraph benötigt Nodes, Edges und Turn-Restrictions.');
    }
    if (graph.nodeCount !== graph.nodes.length || graph.edgeCount !== graph.edges.length ||
        graph.restrictionCount !== graph.turnRestrictions.length) {
      fail('Routinggraph-Zähler stimmen nicht mit dem Inhalt überein.');
    }

    const nodes = new Map();
    graph.nodes.forEach(node => {
      const id = node?.id === undefined || node?.id === null ? '' : String(node.id);
      const lat = Number(node?.lat);
      const lon = Number(node?.lon);
      if (!id || nodes.has(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        fail('Routinggraph enthält eine doppelte oder ungültige Node.');
      }
      if (lat < Number(graph.boundingBox.minLat) || lat > Number(graph.boundingBox.maxLat) ||
          lon < Number(graph.boundingBox.minLon) || lon > Number(graph.boundingBox.maxLon)) {
        fail('Routinggraph-Node liegt außerhalb seiner BoundingBox.');
      }
      nodes.set(id, node);
    });

    const edges = new Map();
    graph.edges.forEach(edge => {
      const id = edge?.id === undefined || edge?.id === null ? '' : String(edge.id);
      const from = edge?.from === undefined || edge?.from === null ? '' : String(edge.from);
      const to = edge?.to === undefined || edge?.to === null ? '' : String(edge.to);
      const length = Number(edge?.lengthMeters);
      if (!id || edges.has(id) || !nodes.has(from) || !nodes.has(to) ||
          !Number.isFinite(length) || length <= 0 || edge.oneway !== true) {
        fail('Routinggraph enthält eine doppelte oder ungültige Edge.');
      }
      for (const key of ['maxheight', 'maxweight', 'maxwidth', 'maxlength', 'speedKph', 'lanes']) {
        const value = edge[key];
        if (value !== null && value !== undefined && !Number.isFinite(Number(value))) {
          fail(`Routinggraph-Edge ${id} enthält einen ungültigen Wert für ${key}.`);
        }
      }
      edges.set(id, edge);
    });

    graph.turnRestrictions.forEach(restriction => {
      const fromEdge = edges.get(String(restriction?.fromEdgeId));
      const toEdge = edges.get(String(restriction?.toEdgeId));
      const viaNodeId = String(restriction?.viaNodeId);
      if (!fromEdge || !toEdge || !nodes.has(viaNodeId) ||
          String(fromEdge.to) !== viaNodeId || String(toEdge.from) !== viaNodeId ||
          !['no_turn', 'only_turn'].includes(restriction.type)) {
        fail('Routinggraph enthält eine ungültige Turn-Restriction.');
      }
    });

    if (graph.priority !== undefined && !Number.isFinite(graph.priority)) {
      fail('Routinggraph enthält eine ungültige Priorität.');
    }
    return {
      formatVersion: Number(graph.formatVersion),
      regionId: graph.regionId,
      graphVersion: String(graph.graphVersion),
      createdAt: graph.createdAt,
      source: graph.source,
      boundingBox: {
        minLat: Number(graph.boundingBox.minLat),
        minLon: Number(graph.boundingBox.minLon),
        maxLat: Number(graph.boundingBox.maxLat),
        maxLon: Number(graph.boundingBox.maxLon)
      },
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      restrictionCount: graph.turnRestrictions.length,
      ...(graph.priority === undefined ? {} : { priority: graph.priority })
    };
  }

  function isPointWithinBoundingBox(point, box) {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= Number(box?.minLat) && lat <= Number(box?.maxLat) &&
      lon >= Number(box?.minLon) && lon <= Number(box?.maxLon);
  }

  function isNotFound(error) {
    return error?.name === 'NotFoundError';
  }

  async function readManifest(directory, slot, regionId, expectedFormatVersion = 1) {
    let contents;
    try {
      const handle = await directory.getFileHandle(MANIFEST_FILES[slot], { create: false });
      const file = await handle.getFile();
      contents = await file.text();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    try {
      const value = JSON.parse(contents);
      if (value.slot !== slot || value.graphFile !== GRAPH_FILES[slot] ||
          !Number.isSafeInteger(value.generation) || value.generation < 1 ||
          !Number.isSafeInteger(value.fileSizeBytes) || value.fileSizeBytes < 1 ||
          value.fileSizeBytes > MAX_GRAPH_SIZE_BYTES) {
        fail('Ungültiges Routinggraph-Manifest.');
      }
      if (regionId !== undefined) {
        const metadata = value.metadata;
        if (Number(metadata?.formatVersion) !== Number(expectedFormatVersion) &&
            Number.isSafeInteger(metadata?.formatVersion)) return null;
        if (value.schemaVersion !== 1 || value.regionId !== regionId ||
            metadata?.regionId !== regionId ||
            Number(metadata.formatVersion) !== Number(expectedFormatVersion) ||
            value.graphVersion !== metadata.graphVersion ||
            typeof value.graphVersion !== 'string' || !value.graphVersion ||
            value.sizeBytes !== value.fileSizeBytes || value.sha256 !== value.checksum ||
            (value.sha256 !== null && !/^[0-9a-f]{64}$/.test(value.sha256)) ||
            (value.priority !== undefined && !Number.isFinite(value.priority))) fail('Ungültige Routinggraph-Katalogmetadaten.');
        validateBoundingBox(value.boundingBox);
        if (JSON.stringify(value.boundingBox) !== JSON.stringify(metadata.boundingBox)) fail('Routinggraph-BoundingBox stimmt nicht mit dem Manifest überein.');
      }
      return { ...value, slot };
    } catch (error) {
      global.console?.warn?.('Ungültiges Routinggraph-Manifest:', regionId ?? 'Legacy', slot, error);
      return null;
    }
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(bytes) {
    const subtle = global.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') return null;
    return bytesToHex(await subtle.digest('SHA-256', bytes));
  }

  async function writeFile(directory, name, bytes) {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch { /* Keep the original write error. */ }
      throw error;
    }
  }

  function createOPFSGraphStore(storage = global.navigator?.storage) {
    async function openDirectory(create) {
      if (!storage || typeof storage.getDirectory !== 'function') {
        throw new Error('OPFS wird von diesem Browser nicht unterstützt.');
      }
      const root = await storage.getDirectory();
      return root.getDirectoryHandle(STORAGE_DIRECTORY, { create });
    }

    async function manifestsFor(directory, expectedFormatVersion, regionId) {
      return (await Promise.all([0, 1].map(slot =>
        readManifest(directory, slot, regionId, expectedFormatVersion))))
        .filter(Boolean).sort((a, b) => b.generation - a.generation);
    }

    function catalogEntry(manifest) {
      return {
        ...manifest.metadata,
        priority: manifest.metadata.priority ?? 0,
        schemaVersion: manifest.schemaVersion || 1,
        generation: manifest.generation,
        fileSizeBytes: manifest.fileSizeBytes,
        sizeBytes: manifest.fileSizeBytes,
        checksum: manifest.checksum || null,
        sha256: manifest.checksum || null,
        slot: manifest.slot,
        graphFile: manifest.graphFile,
        directoryName: regionDirectoryName(manifest.metadata.regionId)
      };
    }

    // Metadata-only startup: migration is explicit and graph bytes are validated on load.
    async function listGraphs(expectedFormatVersion = 1) {
      let directory;
      try {
        directory = await openDirectory(false);
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }
      const entries = [];
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== 'directory' || !name.startsWith('region-')) continue;
        let regionId;
        try {
          regionId = decodeURIComponent(name.slice('region-'.length));
          if (regionDirectoryName(regionId) !== name) continue;
        } catch { continue; }
        const manifests = await manifestsFor(handle, expectedFormatVersion, regionId);
        if (manifests.length) entries.push(catalogEntry(manifests[0]));
      }
      return entries.sort((a, b) => (b.priority || 0) - (a.priority || 0) ||
        (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
    }

    async function loadFromDirectory(directory, expectedFormatVersion, regionId) {
      const startTime = global.performance?.now?.() ?? Date.now();
      const manifests = await manifestsFor(directory, expectedFormatVersion, regionId);
      if (!manifests.length) {
        if (regionId === undefined) {
          for (const name of MANIFEST_FILES) {
            try {
              await directory.getFileHandle(name, { create: false });
              return { status: 'invalid', error: 'Kein gültiges Legacy-Routinggraph-Manifest gespeichert.' };
            } catch (error) {
              if (!isNotFound(error)) throw error;
            }
          }
        }
        return { status: 'not-installed' };
      }

      let lastError = null;
      for (const manifest of manifests) {
        try {
          const readStart = global.performance?.now?.() ?? Date.now();
          const graphHandle = await directory.getFileHandle(manifest.graphFile, { create: false });
          const file = await graphHandle.getFile();
          if (file.size !== manifest.fileSizeBytes || file.size > MAX_GRAPH_SIZE_BYTES) {
            fail('Gespeicherte Routinggraph-Größe stimmt nicht mit dem Manifest überein.');
          }
          const bytes = await file.arrayBuffer();
          const readMs = (global.performance?.now?.() ?? Date.now()) - readStart;
          if (manifest.checksum) {
            const actualChecksum = await sha256(bytes);
            if (actualChecksum && actualChecksum !== manifest.checksum) {
              fail('Prüfsumme des gespeicherten Routinggraphen stimmt nicht.');
            }
          }
          const parseStart = global.performance?.now?.() ?? Date.now();
          const graph = JSON.parse(new TextDecoder().decode(bytes));
          const parseMs = (global.performance?.now?.() ?? Date.now()) - parseStart;
          const validationStart = global.performance?.now?.() ?? Date.now();
          const metadata = validateGraph(graph, expectedFormatVersion);
          const validationMs = (global.performance?.now?.() ?? Date.now()) - validationStart;
          if (metadata.regionId !== manifest.metadata?.regionId ||
              metadata.graphVersion !== String(manifest.metadata?.graphVersion) ||
              metadata.nodeCount !== manifest.metadata?.nodeCount ||
              metadata.edgeCount !== manifest.metadata?.edgeCount ||
              metadata.restrictionCount !== manifest.metadata?.restrictionCount) {
            fail('Gespeicherte Routinggraph-Metadaten stimmen nicht mit dem Manifest überein.');
          }
          if (regionId !== undefined &&
              (metadata.regionId !== regionId ||
               JSON.stringify(metadata.boundingBox) !== JSON.stringify(manifest.boundingBox) ||
               metadata.priority !== manifest.priority)) {
            fail('Gespeicherte Routinggraph-Region stimmt nicht mit dem Manifest überein.');
          }
          return {
            status: 'ready',
            graph,
            metadata: { ...catalogEntry(manifest), ...metadata },
            metrics: {
              readMs: Number(readMs.toFixed(1)),
              parseMs: Number(parseMs.toFixed(1)),
              validationMs: Number(validationMs.toFixed(1)),
              generation: manifest.generation,
              totalMs: Number(((global.performance?.now?.() ?? Date.now()) - startTime).toFixed(1))
            },
            slot: manifest.slot
          };
        } catch (error) {
          lastError = error;
        }
      }
      return { status: 'invalid', error: lastError?.message || 'Kein gültiger Routinggraph gespeichert.' };
    }

    async function loadGraph(expectedFormatVersion = 1, regionId) {
      try {
        if (regionId === undefined) {
          const migration = await migrateLegacyGraph(expectedFormatVersion);
          const entries = await listGraphs(expectedFormatVersion);
          if (!entries.length) {
            return migration.status === 'invalid' ? migration : { status: 'not-installed' };
          }
          if (entries.length > 1) {
            return { status: 'selection-required', regions: entries };
          }
          regionId = entries[0].regionId;
        }
        const directory = await openDirectory(false);
        const regionDirectory = await directory.getDirectoryHandle(regionDirectoryName(regionId), { create: false });
        return await loadFromDirectory(regionDirectory, expectedFormatVersion, regionId);
      } catch (error) {
        if (isNotFound(error)) return { status: 'not-installed' };
        return { status: 'unavailable', error: error?.message || 'OPFS nicht verfügbar.' };
      }
    }

    async function persistGraph(metadata, encoded, checksum, expectedFormatVersion, migrationOnly) {
      const root = await openDirectory(true);
      const directory = await root.getDirectoryHandle(regionDirectoryName(metadata.regionId), { create: true });
      const current = await loadFromDirectory(directory, expectedFormatVersion, metadata.regionId);
      if (migrationOnly && current.status === 'ready') {
        return { status: 'already-migrated', metadata: current.metadata };
      }
      const previousManifests = await manifestsFor(directory, expectedFormatVersion, metadata.regionId);
      const generation = Math.max(0, ...previousManifests.map(manifest => manifest.generation)) + 1;
      if (!Number.isSafeInteger(generation)) fail('Routinggraph-Generation ist zu groß.');
      const slot = current.status === 'ready' ? 1 - current.slot :
        (previousManifests.length ? 1 - previousManifests[0].slot : 0);
      const graphFile = GRAPH_FILES[slot];

      const writeStartedAt = global.performance?.now?.() ?? Date.now();
      await writeFile(directory, graphFile, encoded);
      const savedHandle = await directory.getFileHandle(graphFile, { create: false });
      const savedFile = await savedHandle.getFile();
      if (savedFile.size !== encoded.byteLength ||
          (checksum && await sha256(await savedFile.arrayBuffer()) !== checksum)) {
        fail('Routinggraph konnte nicht vollständig gespeichert werden.');
      }
      const manifest = {
        schemaVersion: 1,
        regionId: metadata.regionId,
        graphVersion: metadata.graphVersion,
        boundingBox: metadata.boundingBox,
        sizeBytes: savedFile.size,
        sha256: checksum,
        ...(metadata.priority === undefined ? {} : { priority: metadata.priority }),
        slot,
        generation,
        graphFile,
        fileSizeBytes: savedFile.size,
        checksum,
        metadata
      };
      // Closing the manifest commits the inactive slot; the active slot is never modified.
      await writeFile(directory, MANIFEST_FILES[slot], new TextEncoder().encode(JSON.stringify(manifest)));
      return {
        status: 'saved',
        metadata: catalogEntry(manifest),
        metrics: {
          writeBytes: savedFile.size,
          writeMs: Number(((global.performance?.now?.() ?? Date.now()) - writeStartedAt).toFixed(1)),
          generation,
          slot
        }
      };
    }

    async function prepareAndSaveGraph(graph, expectedFormatVersion, migrationOnly = false) {
      const metadata = validateGraph(graph, expectedFormatVersion);
      regionDirectoryName(metadata.regionId);
      const serialized = JSON.stringify(graph);
      const encoded = new TextEncoder().encode(serialized);
      if (!encoded.byteLength || encoded.byteLength > MAX_GRAPH_SIZE_BYTES) {
        fail('Routinggraph überschreitet die erlaubte Dateigröße.');
      }
      const checksum = await sha256(encoded.buffer);
      if (!storage || typeof storage.getDirectory !== 'function') {
        throw new Error('OPFS wird von diesem Browser nicht unterstützt.');
      }
      let queues = writeQueues.get(storage);
      if (!queues) {
        queues = new Map();
        writeQueues.set(storage, queues);
      }
      const previous = queues.get(metadata.regionId) || Promise.resolve();
      const operation = previous.catch(() => {}).then(() => {
        const persist = () => persistGraph(metadata, encoded, checksum, expectedFormatVersion, migrationOnly);
        const locks = global.navigator?.locks;
        return typeof locks?.request === 'function'
          ? locks.request(`${STORAGE_DIRECTORY}:${regionDirectoryName(metadata.regionId)}`, { mode: 'exclusive' }, persist)
          : persist();
      });
      queues.set(metadata.regionId, operation);
      try {
        return await operation;
      } finally {
        if (queues.get(metadata.regionId) === operation) queues.delete(metadata.regionId);
      }
    }

    async function saveGraph(graph, expectedFormatVersion = 1) {
      return prepareAndSaveGraph(graph, expectedFormatVersion);
    }

    async function migrateLegacyGraph(expectedFormatVersion = 1) {
      try {
        const directory = await openDirectory(false);
        let markerContents;
        try {
          const markerHandle = await directory.getFileHandle(MIGRATION_FILE, { create: false });
          markerContents = await (await markerHandle.getFile()).text();
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
        if (markerContents !== undefined) {
          let marker;
          try {
            marker = JSON.parse(markerContents);
            if (marker.schemaVersion !== 1 || typeof marker.regionId !== 'string' ||
                !Number.isSafeInteger(marker.formatVersion)) fail('Ungültiger Legacy-Migrationsmarker.');
            regionDirectoryName(marker.regionId);
          } catch (error) {
            marker = null;
            global.console?.warn?.('Ungültiger Legacy-Migrationsmarker:', error);
          }
          if (marker?.schemaVersion === 1 && marker.formatVersion === Number(expectedFormatVersion)) {
            try {
              const region = await directory.getDirectoryHandle(regionDirectoryName(marker.regionId), { create: false });
              const manifests = await manifestsFor(region, expectedFormatVersion, marker.regionId);
              if (manifests.length) {
                return { status: 'already-migrated', regionId: marker.regionId, metadata: catalogEntry(manifests[0]) };
              }
            } catch (error) {
              if (!isNotFound(error)) throw error;
            }
          }
        }
        const legacy = await loadFromDirectory(directory, expectedFormatVersion);
        if (legacy.status !== 'ready') return legacy;
        const markMigrated = () => writeFile(directory, MIGRATION_FILE, new TextEncoder().encode(JSON.stringify({
          schemaVersion: 1, formatVersion: Number(expectedFormatVersion), regionId: legacy.graph.regionId
        })));
        const existing = await loadGraph(expectedFormatVersion, legacy.graph.regionId);
        if (existing.status === 'ready') {
          await markMigrated();
          return { status: 'already-migrated', regionId: legacy.graph.regionId, metadata: existing.metadata };
        }
        if (existing.status === 'unavailable') return existing;
        const saved = await prepareAndSaveGraph(legacy.graph, expectedFormatVersion, true);
        const verified = await loadGraph(expectedFormatVersion, legacy.graph.regionId);
        if (verified.status !== 'ready') return { status: 'invalid', error: verified.error || 'Migration konnte nicht geprüft werden.' };
        await markMigrated();
        // Keep the legacy files as a recovery source, including after successful migration.
        return {
          status: saved.status === 'already-migrated' ? 'already-migrated' : 'migrated',
          regionId: legacy.graph.regionId,
          metadata: verified.metadata
        };
      } catch (error) {
        if (isNotFound(error)) return { status: 'not-installed' };
        return { status: 'unavailable', error: error?.message || 'Migration fehlgeschlagen.' };
      }
    }

    return Object.freeze({ listGraphs, loadGraph, saveGraph, migrateLegacyGraph });
  }

  global.LehrfahrerLocalBusRoutingStorage = Object.freeze({
    MAX_GRAPH_SIZE_BYTES,
    validateGraph,
    isPointWithinBoundingBox,
    createOPFSGraphStore
  });
})(globalThis);
