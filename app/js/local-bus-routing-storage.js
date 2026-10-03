(function initLehrfahrerLocalBusRoutingStorage(global) {
  'use strict';

  const STORAGE_DIRECTORY = 'lehrfahrer-local-routing';
  const GRAPH_FILES = ['routing-graph-0.json', 'routing-graph-1.json'];
  const MANIFEST_FILES = ['routing-index-0.json', 'routing-index-1.json'];
  const MAX_GRAPH_SIZE_BYTES = 50 * 1024 * 1024;

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

    return {
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
      restrictionCount: graph.turnRestrictions.length
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

  async function readManifest(directory, slot) {
    try {
      const handle = await directory.getFileHandle(MANIFEST_FILES[slot], { create: false });
      const file = await handle.getFile();
      const value = JSON.parse(await file.text());
      if (value.slot !== slot || value.graphFile !== GRAPH_FILES[slot] ||
          !Number.isSafeInteger(value.generation) || value.generation < 1 ||
          !Number.isSafeInteger(value.fileSizeBytes) || value.fileSizeBytes < 1) {
        return null;
      }
      return { ...value, slot };
    } catch (error) {
      if (isNotFound(error)) return null;
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

    async function loadGraph(expectedFormatVersion = 1) {
      const startTime = global.performance?.now?.() ?? Date.now();
      let directory;
      try {
        directory = await openDirectory(false);
      } catch (error) {
        if (isNotFound(error)) return { status: 'not-installed' };
        return { status: 'unavailable', error: error?.message || 'OPFS nicht verfügbar.' };
      }

      const manifests = (await Promise.all([0, 1].map(slot => readManifest(directory, slot))))
        .filter(Boolean)
        .sort((a, b) => b.generation - a.generation);
      if (!manifests.length) return { status: 'not-installed' };

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
          return {
            status: 'ready',
            graph,
            metadata: { ...metadata, fileSizeBytes: file.size, checksum: manifest.checksum || null },
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

    async function saveGraph(graph, expectedFormatVersion = 1) {
      const metadata = validateGraph(graph, expectedFormatVersion);
      const serialized = JSON.stringify(graph);
      const encoded = new TextEncoder().encode(serialized);
      if (!encoded.byteLength || encoded.byteLength > MAX_GRAPH_SIZE_BYTES) {
        fail('Routinggraph überschreitet die erlaubte Dateigröße.');
      }
      const checksum = await sha256(encoded.buffer);
      const directory = await openDirectory(true);
      const current = await loadGraph(expectedFormatVersion);
      const previousManifests = (await Promise.all([0, 1].map(slot => readManifest(directory, slot))))
        .filter(Boolean);
      const generation = Math.max(0, ...previousManifests.map(manifest => manifest.generation)) + 1;
      const slot = current.status === 'ready' ? 1 - current.slot : (previousManifests.length ? 1 - previousManifests[0].slot : 0);
      const graphFile = GRAPH_FILES[slot];

      const writeStartedAt = global.performance?.now?.() ?? Date.now();
      await writeFile(directory, graphFile, encoded);
      const savedHandle = await directory.getFileHandle(graphFile, { create: false });
      const savedFile = await savedHandle.getFile();
      if (savedFile.size !== encoded.byteLength) fail('Routinggraph konnte nicht vollständig gespeichert werden.');
      const manifest = {
        slot,
        generation,
        graphFile,
        fileSizeBytes: savedFile.size,
        checksum,
        metadata
      };
      await writeFile(directory, MANIFEST_FILES[slot], new TextEncoder().encode(JSON.stringify(manifest)));
      return {
        status: 'saved',
        metadata: { ...metadata, fileSizeBytes: savedFile.size, checksum },
        metrics: {
          writeBytes: savedFile.size,
          writeMs: Number(((global.performance?.now?.() ?? Date.now()) - writeStartedAt).toFixed(1)),
          generation,
          slot
        }
      };
    }

    return Object.freeze({ loadGraph, saveGraph });
  }

  global.LehrfahrerLocalBusRoutingStorage = Object.freeze({
    MAX_GRAPH_SIZE_BYTES,
    validateGraph,
    isPointWithinBoundingBox,
    createOPFSGraphStore
  });
})(globalThis);
