(function initLehrfahrerLocalBusRouting(global) {
  'use strict';

  const FORMAT_VERSION = 1;
  const DEFAULT_SNAP_RADIUS_M = 160;
  const DEFAULT_GRID_SIZE_DEG = 0.002;
  const MAX_SNAP_CANDIDATES = 8;
  const METERS_PER_DEGREE = 111320;
  const FORBIDDEN_ACCESS = new Set(['no', 'private', 'prohibited', 'closed']);
  const BUS_ALLOWED = new Set(['yes', 'designated', 'permissive']);
  const BUS_ONLY_CLASSES = new Set(['track', 'path', 'pedestrian', 'cycleway', 'footway', 'steps']);
  const ROAD_PENALTIES = Object.freeze({
    motorway: 1.0,
    trunk: 1.0,
    primary: 1.0,
    secondary: 1.03,
    tertiary: 1.08,
    unclassified: 1.18,
    residential: 1.55,
    living_street: 2.5,
    service: 3.0,
    service_other: 3.0,
    track: 8.0,
    path: 12.0,
    pedestrian: 12.0,
    cycleway: 12.0,
    footway: 12.0,
    unknown: 2.2
  });
  const DEFAULT_SPEED_KPH = Object.freeze({
    motorway: 80,
    trunk: 70,
    primary: 55,
    secondary: 50,
    tertiary: 45,
    unclassified: 35,
    residential: 28,
    living_street: 12,
    service: 15,
    service_other: 15,
    track: 10,
    path: 8,
    pedestrian: 8,
    cycleway: 8,
    footway: 6,
    unknown: 20
  });

  function toRadians(value) {
    return value * Math.PI / 180;
  }

  function haversineM(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRadians(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearingDeg(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLon = toRadians(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function turnDeltaDeg(incoming, outgoing) {
    return ((outgoing - incoming + 540) % 360) - 180;
  }

  function projectPointToSegment(point, from, to) {
    const cosLat = Math.cos(toRadians(point.lat));
    const ax = (from.lon - point.lon) * METERS_PER_DEGREE * cosLat;
    const ay = (from.lat - point.lat) * METERS_PER_DEGREE;
    const bx = (to.lon - point.lon) * METERS_PER_DEGREE * cosLat;
    const by = (to.lat - point.lat) * METERS_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const ratio = denominator > 0
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator))
      : 0;
    const x = ax + dx * ratio;
    const y = ay + dy * ratio;
    return {
      ratio,
      distanceM: Math.sqrt(x * x + y * y),
      point: {
        lat: from.lat + (to.lat - from.lat) * ratio,
        lon: from.lon + (to.lon - from.lon) * ratio
      }
    };
  }

  class MinHeap {
    constructor() {
      this.items = [];
    }

    push(item) {
      this.items.push(item);
      let index = this.items.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.items[parent].priority <= item.priority) break;
        this.items[index] = this.items[parent];
        index = parent;
      }
      this.items[index] = item;
    }

    pop() {
      if (!this.items.length) return null;
      const root = this.items[0];
      const last = this.items.pop();
      if (!this.items.length) return root;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        const child = right < this.items.length && this.items[right].priority < this.items[left].priority
          ? right
          : left;
        if (this.items[child].priority >= last.priority) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
      return root;
    }

    get length() {
      return this.items.length;
    }
  }

  function normalizeTag(value) {
    return value === null || value === undefined || value === ''
      ? 'unknown'
      : String(value).toLowerCase();
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeEdge(rawEdge, nodesById, index) {
    const from = String(rawEdge.from);
    const to = String(rawEdge.to);
    const fromNode = nodesById.get(from);
    const toNode = nodesById.get(to);
    if (!fromNode || !toNode) throw new Error(`Kante ${rawEdge.id || index}: unbekannter Knoten.`);
    const suppliedLength = finiteOrNull(rawEdge.lengthMeters);
    const roadClass = normalizeTag(rawEdge.roadClass);
    return {
      id: String(rawEdge.id ?? `edge-${index}`),
      from,
      to,
      lengthM: suppliedLength && suppliedLength > 0 ? suppliedLength : haversineM(fromNode, toNode),
      roadClass,
      use: normalizeTag(rawEdge.use ?? roadClass),
      oneway: rawEdge.oneway ?? false,
      access: normalizeTag(rawEdge.access),
      motorVehicle: normalizeTag(rawEdge.motorVehicle),
      bus: normalizeTag(rawEdge.bus),
      maxHeightM: finiteOrNull(rawEdge.maxheight ?? rawEdge.maxHeightM),
      maxWeightT: finiteOrNull(rawEdge.maxweight ?? rawEdge.maxWeightT),
      maxWidthM: finiteOrNull(rawEdge.maxwidth ?? rawEdge.maxWidthM),
      surface: normalizeTag(rawEdge.surface),
      speedKph: finiteOrNull(rawEdge.speedKph),
      name: rawEdge.name || null,
      ref: rawEdge.ref || null,
      geometry: Array.isArray(rawEdge.geometry) ? rawEdge.geometry : null
    };
  }

  function dimensionConstraint(constraints, names) {
    for (const name of names) {
      const value = finiteOrNull(constraints?.[name]);
      if (value !== null && value > 0) return value;
    }
    return null;
  }

  function edgeEligibility(edge, constraints) {
    if (FORBIDDEN_ACCESS.has(edge.access) ||
        FORBIDDEN_ACCESS.has(edge.motorVehicle) ||
        FORBIDDEN_ACCESS.has(edge.bus)) {
      return { allowed: false, reason: 'access-forbidden' };
    }
    if (edge.surface === 'impassable') return { allowed: false, reason: 'surface-impassable' };
    if (BUS_ONLY_CLASSES.has(edge.roadClass) || BUS_ONLY_CLASSES.has(edge.use)) {
      if (!BUS_ALLOWED.has(edge.bus)) return { allowed: false, reason: 'bus-unsuitable-way' };
    }

    const vehicleHeightM = dimensionConstraint(constraints, ['vehicleHeightM', 'heightM', 'height', 'maxHeightM']);
    const vehicleWeightT = dimensionConstraint(constraints, ['vehicleWeightT', 'weightT', 'weight', 'maxWeightT']);
    const vehicleWidthM = dimensionConstraint(constraints, ['vehicleWidthM', 'widthM', 'width', 'maxWidthM']);
    if (vehicleHeightM !== null && edge.maxHeightM !== null && vehicleHeightM > edge.maxHeightM) {
      return { allowed: false, reason: 'maxheight-exceeded' };
    }
    if (vehicleWeightT !== null && edge.maxWeightT !== null && vehicleWeightT > edge.maxWeightT) {
      return { allowed: false, reason: 'maxweight-exceeded' };
    }
    if (vehicleWidthM !== null && edge.maxWidthM !== null && vehicleWidthM > edge.maxWidthM) {
      return { allowed: false, reason: 'maxwidth-exceeded' };
    }
    return { allowed: true, reason: null };
  }

  function roadPenalty(edge) {
    return ROAD_PENALTIES[edge.roadClass] ?? ROAD_PENALTIES[edge.use] ?? ROAD_PENALTIES.unknown;
  }

  function edgeSpeedKph(edge) {
    const fallback = DEFAULT_SPEED_KPH[edge.roadClass] ?? DEFAULT_SPEED_KPH[edge.use] ?? DEFAULT_SPEED_KPH.unknown;
    return Math.max(5, Math.min(100, edge.speedKph || fallback));
  }

  function traversalCost(edge, lengthM = edge.lengthM) {
    return lengthM / (edgeSpeedKph(edge) / 3.6) * roadPenalty(edge);
  }

  function localFailure(code, message, source) {
    return {
      ok: false,
      geometry: [],
      geometryFormat: 'lat-lon',
      distanceM: null,
      durationSec: null,
      roadClasses: [],
      roadEdges: [],
      roadMetadataStatus: 'unavailable',
      maneuvers: [],
      restrictions: {
        access: 'unknown',
        motorVehicle: 'unknown',
        bus: 'unknown',
        maxHeightM: null,
        maxWeightT: null,
        maxWidthM: null
      },
      warnings: [],
      source,
      error: { code, message }
    };
  }

  function buildLocalRoadClassProfile(roadEdges) {
    const classDistanceM = {};
    const useDistanceM = {};
    let totalM = 0;
    roadEdges.forEach(edge => {
      const lengthM = Math.max(0, Number(edge.lengthM) || 0);
      totalM += lengthM;
      classDistanceM[edge.roadClass] = (classDistanceM[edge.roadClass] || 0) + lengthM;
      useDistanceM[edge.use] = (useDistanceM[edge.use] || 0) + lengthM;
    });
    return {
      totalClassifiedM: Math.round(totalM),
      classDistanceM,
      useDistanceM
    };
  }

  class LocalBusRoutingEngine {
    constructor(graph, options = {}) {
      if (!graph || Number(graph.formatVersion) !== FORMAT_VERSION) {
        throw new Error(`Nicht unterstützte LocalBusRouter-Graphversion: ${graph?.formatVersion}`);
      }
      if (!graph.regionId || !graph.graphVersion || !graph.boundingBox) {
        throw new Error('Routinggraph benötigt regionId, graphVersion und boundingBox.');
      }
      if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
        throw new Error('Routinggraph benötigt nodes und edges.');
      }

      this.graph = graph;
      this.snapRadiusM = Number(options.snapRadiusM) || DEFAULT_SNAP_RADIUS_M;
      this.gridSizeDeg = Number(options.gridSizeDeg) || DEFAULT_GRID_SIZE_DEG;
      this.nodesById = new Map();
      graph.nodes.forEach(node => {
        const id = String(node.id);
        const lat = Number(node.lat);
        const lon = Number(node.lon);
        if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          throw new Error('Ungültiger Routinggraph-Knoten.');
        }
        this.nodesById.set(id, { id, lat, lon });
      });

      this.edges = graph.edges.map((edge, index) => normalizeEdge(edge, this.nodesById, index));
      this.edgesById = new Map(this.edges.map(edge => [edge.id, edge]));
      this.adjacency = new Map();
      this.incoming = new Map();
      this.nodeGrid = new Map();
      this.edgeGrid = new Map();
      this.turnRestrictions = Array.isArray(graph.turnRestrictions) ? graph.turnRestrictions : [];
      this._buildIndexes();
      this.source = {
        id: 'local-bus-router',
        type: 'offline-local',
        onlineRequired: false,
        regionId: graph.regionId,
        graphVersion: graph.graphVersion
      };
    }

    isAvailable() {
      return this.nodesById.size > 0 && this.edges.length > 0;
    }

    _gridKey(lat, lon) {
      return `${Math.floor(lat / this.gridSizeDeg)}:${Math.floor(lon / this.gridSizeDeg)}`;
    }

    _addGridItem(index, key, value) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(value);
    }

    _addArc(edge, from, to, reverse) {
      const arc = { edge, from, to, reverse };
      if (!this.adjacency.has(from)) this.adjacency.set(from, []);
      if (!this.incoming.has(to)) this.incoming.set(to, []);
      this.adjacency.get(from).push(arc);
      this.incoming.get(to).push(arc);
    }

    _buildIndexes() {
      this.nodesById.forEach(node => {
        this._addGridItem(this.nodeGrid, this._gridKey(node.lat, node.lon), node.id);
      });
      this.edges.forEach(edge => {
        const from = this.nodesById.get(edge.from);
        const to = this.nodesById.get(edge.to);
        const reverseOnly = edge.oneway === -1 || edge.oneway === 'reverse';
        const forwardOnly = edge.oneway === true || edge.oneway === 1 || edge.oneway === 'forward' || edge.oneway === 'yes';
        if (!reverseOnly) this._addArc(edge, edge.from, edge.to, false);
        if (!forwardOnly) this._addArc(edge, edge.to, edge.from, true);

        const minLatCell = Math.floor(Math.min(from.lat, to.lat) / this.gridSizeDeg);
        const maxLatCell = Math.floor(Math.max(from.lat, to.lat) / this.gridSizeDeg);
        const minLonCell = Math.floor(Math.min(from.lon, to.lon) / this.gridSizeDeg);
        const maxLonCell = Math.floor(Math.max(from.lon, to.lon) / this.gridSizeDeg);
        for (let latCell = minLatCell; latCell <= maxLatCell; latCell++) {
          for (let lonCell = minLonCell; lonCell <= maxLonCell; lonCell++) {
            this._addGridItem(this.edgeGrid, `${latCell}:${lonCell}`, edge.id);
          }
        }
      });
    }

    _nearbyIds(index, point, radiusM) {
      const latCells = Math.ceil(radiusM / (METERS_PER_DEGREE * this.gridSizeDeg)) + 1;
      const lonScale = Math.max(0.2, Math.cos(toRadians(point.lat)));
      const lonCells = Math.ceil(radiusM / (METERS_PER_DEGREE * lonScale * this.gridSizeDeg)) + 1;
      const centerLat = Math.floor(point.lat / this.gridSizeDeg);
      const centerLon = Math.floor(point.lon / this.gridSizeDeg);
      const ids = new Set();
      for (let latOffset = -latCells; latOffset <= latCells; latOffset++) {
        for (let lonOffset = -lonCells; lonOffset <= lonCells; lonOffset++) {
          const cell = index.get(`${centerLat + latOffset}:${centerLon + lonOffset}`);
          if (cell) cell.forEach(id => ids.add(id));
        }
      }
      return ids;
    }

    _eligibleArcs(arcs, constraints) {
      return (arcs || []).filter(arc => edgeEligibility(arc.edge, constraints).allowed);
    }

    _snapCandidates(point, role, constraints) {
      const candidates = new Map();
      const addCandidate = candidate => {
        const existing = candidates.get(candidate.nodeId);
        if (!existing || candidate.connectorCost < existing.connectorCost) {
          candidates.set(candidate.nodeId, candidate);
        }
      };

      this._nearbyIds(this.nodeGrid, point, this.snapRadiusM).forEach(nodeId => {
        const node = this.nodesById.get(nodeId);
        const distanceM = haversineM(point, node);
        if (distanceM > Math.min(30, this.snapRadiusM)) return;
        const usable = role === 'start'
          ? this._eligibleArcs(this.adjacency.get(nodeId), constraints).length > 0
          : this._eligibleArcs(this.incoming.get(nodeId), constraints).length > 0;
        if (!usable) return;
        addCandidate({
          nodeId,
          snapDistanceM: distanceM,
          connectorDistanceM: distanceM,
          connectorDurationSec: distanceM / (15 / 3.6),
          connectorCost: distanceM / (15 / 3.6),
          geometry: role === 'start'
            ? [[point.lat, point.lon], [node.lat, node.lon]]
            : [[node.lat, node.lon], [point.lat, point.lon]],
          roadEdges: []
        });
      });

      this._nearbyIds(this.edgeGrid, point, this.snapRadiusM).forEach(edgeId => {
        const edge = this.edgesById.get(edgeId);
        if (!edgeEligibility(edge, constraints).allowed) return;
        const fromNode = this.nodesById.get(edge.from);
        const toNode = this.nodesById.get(edge.to);
        const projection = projectPointToSegment(point, fromNode, toNode);
        if (projection.distanceM > this.snapRadiusM) return;
        const arcs = [];
        (this.adjacency.get(edge.from) || []).forEach(arc => {
          if (arc.edge.id === edge.id) arcs.push(arc);
        });
        (this.adjacency.get(edge.to) || []).forEach(arc => {
          if (arc.edge.id === edge.id) arcs.push(arc);
        });
        arcs.forEach(arc => {
          const forwardRatio = arc.reverse ? 1 - projection.ratio : projection.ratio;
          const partialRatio = role === 'start' ? 1 - forwardRatio : forwardRatio;
          const nodeId = role === 'start' ? arc.to : arc.from;
          const node = this.nodesById.get(nodeId);
          const partialLengthM = edge.lengthM * partialRatio;
          const connectorDistanceM = projection.distanceM + partialLengthM;
          const edgePart = this._roadEdgeResult(edge, partialLengthM);
          addCandidate({
            nodeId,
            snapDistanceM: projection.distanceM,
            connectorDistanceM,
            connectorDurationSec: projection.distanceM / (15 / 3.6) + partialLengthM / (edgeSpeedKph(edge) / 3.6),
            connectorCost: projection.distanceM / (15 / 3.6) + traversalCost(edge, partialLengthM),
            geometry: role === 'start'
              ? [[point.lat, point.lon], [projection.point.lat, projection.point.lon], [node.lat, node.lon]]
              : [[node.lat, node.lon], [projection.point.lat, projection.point.lon], [point.lat, point.lon]],
            roadEdges: partialLengthM > 0.5 ? [edgePart] : []
          });
        });
      });

      return [...candidates.values()]
        .sort((a, b) => a.connectorCost - b.connectorCost || a.snapDistanceM - b.snapDistanceM)
        .slice(0, MAX_SNAP_CANDIDATES);
    }

    _turnAllowed(previousArc, nextArc, viaNodeId) {
      if (!previousArc) return true;
      if (previousArc.edge.id === nextArc.edge.id && previousArc.from === nextArc.to) return false;
      for (const restriction of this.turnRestrictions) {
        if (String(restriction.fromEdgeId) !== previousArc.edge.id ||
            String(restriction.viaNodeId) !== String(viaNodeId)) continue;
        const toEdgeId = String(restriction.toEdgeId);
        if (restriction.type === 'only_turn' && nextArc.edge.id !== toEdgeId) return false;
        if (restriction.type !== 'only_turn' && nextArc.edge.id === toEdgeId) return false;
      }
      return true;
    }

    _turnCost(previousArc, nextArc) {
      if (!previousArc) return 0;
      const previousFrom = this.nodesById.get(previousArc.from);
      const via = this.nodesById.get(previousArc.to);
      const nextTo = this.nodesById.get(nextArc.to);
      const delta = Math.abs(turnDeltaDeg(bearingDeg(previousFrom, via), bearingDeg(via, nextTo)));
      if (delta >= 150) return 90;
      if (delta >= 105) return 25;
      if (delta >= 60) return 6;
      return 0;
    }

    _aStar(startNodeId, targetNodeId, constraints) {
      if (startNodeId === targetNodeId) return { arcs: [], cost: 0 };
      const targetNode = this.nodesById.get(targetNodeId);
      const queue = new MinHeap();
      const startKey = `${startNodeId}|`;
      const bestCost = new Map([[startKey, 0]]);
      const cameFrom = new Map();
      const stateData = new Map([[startKey, { nodeId: startNodeId, previousArc: null }]]);
      queue.push({ key: startKey, priority: haversineM(this.nodesById.get(startNodeId), targetNode) / (100 / 3.6) });

      let goalKey = null;
      while (queue.length) {
        const current = queue.pop();
        const state = stateData.get(current.key);
        const currentCost = bestCost.get(current.key);
        if (!state || currentCost === undefined) continue;
        if (state.nodeId === targetNodeId) {
          goalKey = current.key;
          break;
        }

        const outgoing = this._eligibleArcs(this.adjacency.get(state.nodeId), constraints);
        outgoing.forEach(arc => {
          if (!this._turnAllowed(state.previousArc, arc, state.nodeId)) return;
          const nextCost = currentCost + traversalCost(arc.edge) + this._turnCost(state.previousArc, arc);
          const nextKey = `${arc.to}|${arc.edge.id}:${arc.reverse ? 'r' : 'f'}`;
          if (nextCost >= (bestCost.get(nextKey) ?? Infinity)) return;
          bestCost.set(nextKey, nextCost);
          stateData.set(nextKey, { nodeId: arc.to, previousArc: arc });
          cameFrom.set(nextKey, { previousKey: current.key, arc });
          const heuristic = haversineM(this.nodesById.get(arc.to), targetNode) / (100 / 3.6);
          queue.push({ key: nextKey, priority: nextCost + heuristic });
        });
      }
      if (!goalKey) return null;

      const arcs = [];
      let key = goalKey;
      while (cameFrom.has(key)) {
        const step = cameFrom.get(key);
        arcs.push(step.arc);
        key = step.previousKey;
      }
      arcs.reverse();
      return { arcs, cost: bestCost.get(goalKey) };
    }

    _roadEdgeResult(edge, lengthM = edge.lengthM) {
      return {
        id: edge.id,
        lengthM,
        roadClass: edge.roadClass,
        use: edge.use,
        surface: edge.surface,
        traversability: 'both',
        truckRoute: edge.bus === 'designated',
        access: edge.access,
        motorVehicle: edge.motorVehicle,
        bus: edge.bus,
        maxHeightM: edge.maxHeightM,
        maxWeightT: edge.maxWeightT,
        maxWidthM: edge.maxWidthM,
        name: edge.name,
        ref: edge.ref
      };
    }

    _arcGeometry(arc) {
      const edge = arc.edge;
      if (Array.isArray(edge.geometry) && edge.geometry.length >= 2) {
        const geometry = edge.geometry.map(point => Array.isArray(point)
          ? [Number(point[0]), Number(point[1])]
          : [Number(point.lat), Number(point.lon)]);
        return arc.reverse ? geometry.reverse() : geometry;
      }
      const from = this.nodesById.get(arc.from);
      const to = this.nodesById.get(arc.to);
      return [[from.lat, from.lon], [to.lat, to.lon]];
    }

    _appendGeometry(target, points) {
      points.forEach(point => {
        const previous = target[target.length - 1];
        if (!previous || Math.abs(previous[0] - point[0]) > 1e-9 || Math.abs(previous[1] - point[1]) > 1e-9) {
          target.push(point);
        }
      });
    }

    _maneuvers(arcs) {
      const maneuvers = [{ type: 1, instruction: 'Lokale Busroute starten.' }];
      for (let index = 1; index < arcs.length; index++) {
        const before = arcs[index - 1];
        const after = arcs[index];
        const beforeFrom = this.nodesById.get(before.from);
        const via = this.nodesById.get(before.to);
        const afterTo = this.nodesById.get(after.to);
        const delta = turnDeltaDeg(bearingDeg(beforeFrom, via), bearingDeg(via, afterTo));
        const absolute = Math.abs(delta);
        let type = 8;
        if (absolute >= 105) type = delta > 0 ? 11 : 14;
        else if (absolute >= 35) type = delta > 0 ? 10 : 15;
        else if (absolute >= 12) type = delta > 0 ? 9 : 16;
        maneuvers.push({ type, instruction: after.edge.name || after.edge.ref || after.edge.roadClass });
      }
      maneuvers.push({ type: 4, instruction: 'Rückkehrpunkt erreicht.' });
      return maneuvers;
    }

    _knownRouteLimit(roadEdges, field) {
      if (!roadEdges.length || roadEdges.some(edge => !Number.isFinite(edge[field]))) return null;
      return Math.min(...roadEdges.map(edge => edge[field]));
    }

    async routeBusPath({ from, to, constraints = {} }) {
      const start = { lat: Number(from?.lat), lon: Number(from?.lon) };
      const target = { lat: Number(to?.lat), lon: Number(to?.lon) };
      if (![start.lat, start.lon, target.lat, target.lon].every(Number.isFinite)) {
        return localFailure('INVALID_REQUEST', 'Start oder Ziel ist ungültig.', this.source);
      }

      const startCandidates = this._snapCandidates(start, 'start', constraints);
      const targetCandidates = this._snapCandidates(target, 'target', constraints);
      if (!startCandidates.length) {
        return localFailure('START_NOT_SNAPPABLE', 'Keine busgeeignete Straße nahe dem Startpunkt.', this.source);
      }
      if (!targetCandidates.length) {
        return localFailure('TARGET_NOT_SNAPPABLE', 'Keine busgeeignete Straße nahe dem Zielpunkt.', this.source);
      }

      let best = null;
      startCandidates.forEach(startCandidate => {
        targetCandidates.forEach(targetCandidate => {
          const path = this._aStar(startCandidate.nodeId, targetCandidate.nodeId, constraints);
          if (!path) return;
          const cost = startCandidate.connectorCost + path.cost + targetCandidate.connectorCost;
          if (!best || cost < best.cost) best = { startCandidate, targetCandidate, path, cost };
        });
      });
      if (!best) return localFailure('NO_ROUTE', 'Kein zulässiger lokaler Busweg gefunden.', this.source);

      const geometry = [];
      this._appendGeometry(geometry, best.startCandidate.geometry);
      best.path.arcs.forEach(arc => this._appendGeometry(geometry, this._arcGeometry(arc)));
      this._appendGeometry(geometry, best.targetCandidate.geometry);

      const roadEdges = [
        ...best.startCandidate.roadEdges,
        ...best.path.arcs.map(arc => this._roadEdgeResult(arc.edge)),
        ...best.targetCandidate.roadEdges
      ];
      const distanceM = best.startCandidate.connectorDistanceM +
        best.path.arcs.reduce((sum, arc) => sum + arc.edge.lengthM, 0) +
        best.targetCandidate.connectorDistanceM;
      const durationSec = best.startCandidate.connectorDurationSec +
        best.path.arcs.reduce((sum, arc) => sum + arc.edge.lengthM / (edgeSpeedKph(arc.edge) / 3.6), 0) +
        best.targetCandidate.connectorDurationSec;
      const warnings = [];
      if (roadEdges.some(edge => ['unknown', null].includes(edge.access) ||
          ['unknown', null].includes(edge.motorVehicle) || ['unknown', null].includes(edge.bus))) {
        warnings.push('Mindestens eine Kante besitzt unbekannte Bus-/Zugriffsattribute.');
      }
      if (roadEdges.some(edge => edge.maxHeightM === null || edge.maxWeightT === null || edge.maxWidthM === null)) {
        warnings.push('Fahrzeugmaßbegrenzungen sind auf mindestens einer Kante unbekannt.');
      }

      return {
        ok: true,
        geometry,
        geometryFormat: 'lat-lon',
        distanceM: Math.round(distanceM),
        durationSec: Math.round(durationSec),
        roadClasses: [...new Set(roadEdges.map(edge => edge.roadClass).filter(Boolean))],
        roadEdges,
        roadClassProfile: buildLocalRoadClassProfile(roadEdges),
        roadMetadataStatus: roadEdges.length ? 'available' : 'unavailable',
        maneuvers: this._maneuvers(best.path.arcs),
        restrictions: {
          access: 'local-graph-evaluated',
          motorVehicle: 'local-graph-evaluated',
          bus: 'local-graph-evaluated',
          maxHeightM: this._knownRouteLimit(roadEdges, 'maxHeightM'),
          maxWeightT: this._knownRouteLimit(roadEdges, 'maxWeightT'),
          maxWidthM: this._knownRouteLimit(roadEdges, 'maxWidthM'),
          hasTimeRestrictions: false
        },
        warnings,
        source: this.source,
        localPath: {
          edgeIds: best.path.arcs.map(arc => arc.edge.id),
          startSnapDistanceM: Math.round(best.startCandidate.snapDistanceM),
          targetSnapDistanceM: Math.round(best.targetCandidate.snapDistanceM)
        }
      };
    }
  }

  function createRouter(graph, options) {
    return new LocalBusRoutingEngine(graph, options);
  }

  global.LehrfahrerLocalBusRouting = Object.freeze({
    FORMAT_VERSION,
    createRouter,
    LocalBusRoutingEngine
  });
})(globalThis);
