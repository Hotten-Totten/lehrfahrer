// =========================
// STOP HELPERS
// =========================

let detourReplacementStopIdCounter = 1;
let detourManualRoutePointIdCounter = 1;
let detourPlannedRoutePreviewLine = null;
let detourPlannedRoutePreviewTimer = null;
let detourPlannedRoutePreviewRequestId = 0;
let detourRemovedRoutePreviewLine = null;
let detourCutStopPreviewLayer = null;

function updateStopMarkerTooltip(stop) {
  if (!stop.marker) return;

  stop.marker.unbindTooltip();
  stop.marker.bindTooltip(stop.name, {
    permanent: true,
    direction: "top",
    offset: [0, -10]
  });
}

function findClosestPointOnRoute(lat, lon) {
  if (!state.routePoints || state.routePoints.length < 2) return null;

  const clickPoint = map.latLngToContainerPoint([lat, lon]);

  let best = null;
  let bestDistance = Infinity;

  for (let i = 0; i < state.routePoints.length - 1; i++) {
    const a = state.routePoints[i];
    const b = state.routePoints[i + 1];

    const aPt = map.latLngToContainerPoint([a.lat, a.lon]);
    const bPt = map.latLngToContainerPoint([b.lat, b.lon]);

    const dx = bPt.x - aPt.x;
    const dy = bPt.y - aPt.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;

    let t = ((clickPoint.x - aPt.x) * dx + (clickPoint.y - aPt.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const projX = aPt.x + t * dx;
    const projY = aPt.y + t * dy;

    const dist = Math.hypot(clickPoint.x - projX, clickPoint.y - projY);

    if (dist < bestDistance) {
      bestDistance = dist;
      const latlng = map.containerPointToLatLng([projX, projY]);

      best = {
        lat: latlng.lat,
        lon: latlng.lng,
        segmentIndex: i
      };
    }
  }

  return best;
}

// =========================
// SELECTION
// =========================

function selectStop(stop) {
  const inDetourStopSelection = state.detourWizard && state.detourWizard.phase === "selectStops";

  if (state.selectedStopIds.has(stop.id)) {
    state.selectedStopIds.delete(stop.id);
  } else {
    state.selectedStopIds.add(stop.id);
  }

  if (!inDetourStopSelection && state.selectedStopIds.size > 2) {
    const ids = Array.from(state.selectedStopIds);
    state.selectedStopIds = new Set(ids.slice(ids.length - 2));
  }

  if (inDetourStopSelection) {
    state.detourWizard.cutStopIds = [];
    state.detourWizard.cutStartIndex = null;
    state.detourWizard.cutEndIndex = null;
  }

  state.selected = { type: "stop", ref: stop };

  noSelection.classList.add("hidden");
  routeEditor.classList.add("hidden");
  stopEditor.classList.remove("hidden");

  stopNameInput.value = stop.name;
  stopMinuteInput.value = stop.minuteFromStart;
  stopNoteInput.value = stop.note;
  stopGhostInput.checked = !!stop.isGhostPoint;
  stopLatInput.value = stop.lat.toFixed(6);
  stopLonInput.value = stop.lon.toFixed(6);
  stopSourceInput.value = stop.isGhostPoint
    ? "Ghostpunkt"
    : (stop.sourceType === "catalog" ? "Katalog-Haltestelle" : "Freie Haltestelle");

  renderStopOrderList();

  const selectedStops = state.stops.filter(s => state.selectedStopIds.has(s.id));

  if (inDetourStopSelection) {
    const selectionLabel = selectedStops.length === 1 ? "1 Haltestelle" : `${selectedStops.length} Haltestellen`;
    setStatus(`Umleitungsbereich wählen: ${selectionLabel} ausgewählt. Danach "Bereich übernehmen" klicken.`);
  } else if (selectedStops.length === 2) {
    setStatus(`2 Haltestellen ausgewählt: ${selectedStops[0].name} → ${selectedStops[1].name}`);
  } else {
    setStatus(`Haltestelle ausgewählt: ${stop.name} – neue Haltestellen werden darunter eingefügt.`);
  }
}

function resetDetourWizardState() {
  clearDetourRemovedRoutePreview();
  clearDetourPlannedRoutePreview();
  clearDetourReplacementStops();
  clearDetourManualRoutePoints();

  state.detourWizard = {
    phase: null,
    cutStopIds: [],
    cutStartIndex: null,
    cutEndIndex: null,
    routingMode: "street",
    manualInputMode: "guidePoint",
    nextDetourItemOrder: 1,
    manualRoutePoints: [],
    replacementStops: []
  };
}

function isDetourWizardSelectPhase() {
  return !!(state.detourWizard && state.detourWizard.phase === "selectStops");
}

function isDetourWizardBuildPhase() {
  return !!(state.detourWizard && state.detourWizard.phase === "buildReplacement");
}

function isDetourCutStop(stop) {
  if (!state.detourWizard || !state.detourWizard.phase || !stop) return false;

  if (state.detourWizard.phase === "selectStops") {
    return state.selectedStopIds.has(stop.id);
  }

  if (state.detourWizard.phase === "buildReplacement") {
    return Array.isArray(state.detourWizard.cutStopIds) && state.detourWizard.cutStopIds.includes(stop.id);
  }

  return false;
}

function ensureDetourReplacementStops() {
  if (!state.detourWizard) {
    state.detourWizard = {
      phase: null,
      cutStopIds: [],
      cutStartIndex: null,
      cutEndIndex: null,
      routingMode: "street",
      manualInputMode: "guidePoint",
      nextDetourItemOrder: 1,
      manualRoutePoints: [],
      replacementStops: []
    };
  }

  if (!Array.isArray(state.detourWizard.replacementStops)) {
    state.detourWizard.replacementStops = [];
  }

  if (state.detourWizard.routingMode !== "manual" && state.detourWizard.routingMode !== "guidedStreet") {
    state.detourWizard.routingMode = "street";
  }

  return state.detourWizard.replacementStops;
}

function ensureDetourManualRoutePoints() {
  if (!state.detourWizard) {
    state.detourWizard = {
      phase: null,
      cutStopIds: [],
      cutStartIndex: null,
      cutEndIndex: null,
      routingMode: "street",
      manualInputMode: "guidePoint",
      nextDetourItemOrder: 1,
      manualRoutePoints: [],
      replacementStops: []
    };
  }

  if (!Array.isArray(state.detourWizard.manualRoutePoints)) {
    state.detourWizard.manualRoutePoints = [];
  }

  if (state.detourWizard.manualInputMode !== "passThroughStop") {
    state.detourWizard.manualInputMode = "guidePoint";
  }

  return state.detourWizard.manualRoutePoints;
}

function getNextDetourItemOrder() {
  if (!state.detourWizard || !Number.isInteger(state.detourWizard.nextDetourItemOrder)) {
    const existingItems = [
      ...(Array.isArray(state.detourWizard?.replacementStops) ? state.detourWizard.replacementStops : []),
      ...(Array.isArray(state.detourWizard?.manualRoutePoints) ? state.detourWizard.manualRoutePoints : [])
    ];
    const existingOrders = existingItems
      .map(item => Number(item.detourItemOrder))
      .filter(Number.isFinite);
    state.detourWizard.nextDetourItemOrder = existingOrders.length
      ? Math.max(...existingOrders) + 1
      : 1;
  }

  return state.detourWizard.nextDetourItemOrder++;
}

function getOrderedDetourItems() {
  if (!state.detourWizard) return [];

  const replacementStops = Array.isArray(state.detourWizard.replacementStops)
    ? state.detourWizard.replacementStops
    : [];
  const manualRoutePoints = Array.isArray(state.detourWizard.manualRoutePoints)
    ? state.detourWizard.manualRoutePoints
    : [];
  const combinedItems = [...replacementStops, ...manualRoutePoints];
  const assignedOrders = combinedItems
    .map(item => Number(item.detourItemOrder))
    .filter(Number.isFinite);
  let fallbackOrder = assignedOrders.length ? Math.max(...assignedOrders) + 1 : 1;

  const normalizedItems = combinedItems.map(item => {
      if (!item.kind) {
        item.kind = item.isGhostPoint
          ? "passThroughStop"
          : (manualRoutePoints.includes(item) ? "guidePoint" : "replacementStop");
      }
      if (!Number.isFinite(Number(item.detourItemOrder))) {
        item.detourItemOrder = fallbackOrder++;
      }
      return item;
    });
  const maxOrder = normalizedItems.reduce(
    (max, item) => Math.max(max, Number(item.detourItemOrder) || 0),
    0
  );
  if (!Number.isInteger(state.detourWizard.nextDetourItemOrder) || state.detourWizard.nextDetourItemOrder <= maxOrder) {
    state.detourWizard.nextDetourItemOrder = maxOrder + 1;
  }

  return normalizedItems.sort((a, b) => a.detourItemOrder - b.detourItemOrder);
}

function getDetourManualRoutePointIcon(point, selected = false) {
  return createStopBadgeIcon(selected ? "#0891b2" : "#06b6d4", selected ? "#164e63" : "#0e7490", selected ? 20 : 16, "F");
}

function getDetourReplacementStopIcon(stop, selected = false) {
  if (stop && stop.isGhostPoint) {
    return createStopBadgeIcon(selected ? "#475569" : "#64748b", selected ? "#0f172a" : "#334155", selected ? 22 : 18, "G");
  }

  return createStopBadgeIcon(selected ? "#7c3aed" : "#8b5cf6", selected ? "#4c1d95" : "#6d28d9", selected ? 22 : 18, "E");
}

function getDetourReplacementStopLabel(stop) {
  return stop && stop.isGhostPoint ? "Durchfahrpunkt" : "Ersatzhaltestelle";
}

function createDetourReplacementStop({ name, lat, lon, sourceType, catalogId = null, transitType = null, directionHint = null, isGhostPoint = false }) {
  if (!isDetourWizardBuildPhase()) {
    setStatus("Ersatzhaltestellen und Durchfahrpunkte koennen erst nach der Bereichsauswahl gesetzt werden.", "warn");
    return null;
  }

  const replacementStops = ensureDetourReplacementStops();
  const stop = {
    id: "detour_replacement_" + detourReplacementStopIdCounter++,
    detourItemOrder: getNextDetourItemOrder(),
    kind: isGhostPoint ? "passThroughStop" : "replacementStop",
    catalogId,
    name,
    lat,
    lon,
    minuteFromStart: 0,
    minuteMode: "auto",
    note: "",
    sourceType,
    isGhostPoint: !!isGhostPoint,
    transitType,
    directionHint,
    marker: null
  };

  const marker = L.marker([lat, lon], {
    draggable: true,
    icon: getDetourReplacementStopIcon(stop, false)
  }).addTo(map);

  marker.bindTooltip(stop.name, {
    permanent: true,
    direction: "top",
    offset: [0, -10],
    className: "detour-replacement-tooltip"
  });

  marker.on("click", function () {
    state.selected = { type: "detourReplacementStop", ref: stop };
    marker.setIcon(getDetourReplacementStopIcon(stop, true));
    renderStopOrderList();
    setStatus(`${getDetourReplacementStopLabel(stop)} ausgewaehlt: ${stop.name}`);
  });

  marker.on("dragend", function () {
    const pos = marker.getLatLng();
    stop.lat = pos.lat;
    stop.lon = pos.lng;
    scheduleDetourPlannedRoutePreview();
    renderStopOrderList();
    setStatus(`${getDetourReplacementStopLabel(stop)} verschoben: ${stop.name}`);
  });

  stop.marker = marker;
  replacementStops.push(stop);
  state.selected = { type: "detourReplacementStop", ref: stop };

  scheduleDetourPlannedRoutePreview();
  renderStopOrderList();
  updateModeButtons();
  setStatus(`${getDetourReplacementStopLabel(stop)} hinzugefuegt: ${stop.name}`);

  return stop;
}

function addDetourReplacementFreeStop(latlng) {
  const replacementStops = ensureDetourReplacementStops();
  const index = replacementStops.length + 1;

  return createDetourReplacementStop({
    name: `Durchfahrpunkt ${index}`,
    lat: latlng.lat,
    lon: latlng.lng,
    sourceType: "free",
    isGhostPoint: true
  });
}

function addDetourReplacementCatalogStop(catalogStop) {
  if (!catalogStop) return null;

  return createDetourReplacementStop({
    name: catalogStop.name || "Ersatzhaltestelle",
    lat: catalogStop.lat,
    lon: catalogStop.lon,
    sourceType: "catalog",
    catalogId: catalogStop.id || null,
    transitType: catalogStop.type || null,
    directionHint: catalogStop.directionHint || catalogStop.direction || ""
  });
}

function addDetourManualRoutePoint(latlng) {
  if (!isDetourWizardBuildPhase()) {
    setStatus("Fahrwegpunkte koennen erst nach der Bereichsauswahl gesetzt werden.", "warn");
    return null;
  }

  const manualRoutePoints = ensureDetourManualRoutePoints();
  const index = manualRoutePoints.length + 1;
  const point = {
    id: "detour_manual_route_" + detourManualRoutePointIdCounter++,
    detourItemOrder: getNextDetourItemOrder(),
    kind: "guidePoint",
    name: `Fahrwegpunkt ${index}`,
    lat: latlng.lat,
    lon: latlng.lng,
    sourceType: "manual",
    marker: null
  };

  const marker = L.marker([point.lat, point.lon], {
    draggable: true,
    icon: getDetourManualRoutePointIcon(point, false)
  }).addTo(map);

  marker.bindTooltip(point.name, {
    permanent: true,
    direction: "top",
    offset: [0, -10],
    className: "detour-manual-route-tooltip"
  });

  marker.on("click", function () {
    state.selected = { type: "detourManualRoutePoint", ref: point };
    marker.setIcon(getDetourManualRoutePointIcon(point, true));
    renderStopOrderList();
    setStatus(`Fahrwegpunkt ausgewaehlt: ${point.name}`);
  });

  marker.on("dragend", function () {
    const pos = marker.getLatLng();
    point.lat = pos.lat;
    point.lon = pos.lng;
    scheduleDetourPlannedRoutePreview();
    renderStopOrderList();
    setStatus(`Fahrwegpunkt verschoben: ${point.name}`);
  });

  point.marker = marker;
  manualRoutePoints.push(point);
  state.selected = { type: "detourManualRoutePoint", ref: point };

  scheduleDetourPlannedRoutePreview();
  renderStopOrderList();
  updateModeButtons();
  setStatus(`Fahrwegpunkt hinzugefuegt: ${point.name}`);

  return point;
}

function removeDetourReplacementStop(stopId) {
  const replacementStops = ensureDetourReplacementStops();
  const index = replacementStops.findIndex(stop => stop.id === stopId);
  if (index === -1) return;

  const [stop] = replacementStops.splice(index, 1);
  if (stop.marker) {
    map.removeLayer(stop.marker);
  }

  if (state.selected && state.selected.type === "detourReplacementStop" && state.selected.ref.id === stopId) {
    state.selected = null;
  }

  scheduleDetourPlannedRoutePreview();
  renderStopOrderList();
  setStatus(`${getDetourReplacementStopLabel(stop)} entfernt.`);
}

function removeDetourManualRoutePoint(pointId) {
  const manualRoutePoints = ensureDetourManualRoutePoints();
  const index = manualRoutePoints.findIndex(point => point.id === pointId);
  if (index === -1) return;

  const [point] = manualRoutePoints.splice(index, 1);
  if (point.marker) {
    map.removeLayer(point.marker);
  }

  if (state.selected && state.selected.type === "detourManualRoutePoint" && state.selected.ref.id === pointId) {
    state.selected = null;
  }

  scheduleDetourPlannedRoutePreview();
  renderStopOrderList();
  setStatus("Fahrwegpunkt entfernt.");
}

function clearDetourReplacementStops() {
  if (!state.detourWizard || !Array.isArray(state.detourWizard.replacementStops)) return;

  state.detourWizard.replacementStops.forEach(stop => {
    if (stop.marker) {
      map.removeLayer(stop.marker);
      stop.marker = null;
    }
  });

  state.detourWizard.replacementStops = [];

  if (state.selected && state.selected.type === "detourReplacementStop") {
    state.selected = null;
  }
}

function clearDetourManualRoutePoints() {
  if (!state.detourWizard || !Array.isArray(state.detourWizard.manualRoutePoints)) return;

  state.detourWizard.manualRoutePoints.forEach(point => {
    if (point.marker) {
      map.removeLayer(point.marker);
      point.marker = null;
    }
  });

  state.detourWizard.manualRoutePoints = [];

  if (state.selected && state.selected.type === "detourManualRoutePoint") {
    state.selected = null;
  }

  clearDetourPlannedRoutePreview();
}

function cloneDetourReplacementAsLineStop(tempStop) {
  return {
    id: "stop_" + stopIdCounter++,
    catalogId: tempStop.catalogId || null,
    groupId: tempStop.groupId || null,
    platformCode: tempStop.platformCode || null,
    directionHint: tempStop.directionHint || null,
    side: tempStop.side || null,
    oppositeStopId: tempStop.oppositeStopId || null,
    name: tempStop.name,
    lat: tempStop.lat,
    lon: tempStop.lon,
    minuteFromStart: Number(tempStop.minuteFromStart || 0),
    minuteMode: tempStop.minuteMode || "auto",
    note: tempStop.note || "",
    sourceType: tempStop.sourceType || "free",
    isGhostPoint: !!tempStop.isGhostPoint,
    isGhost: !!tempStop.isGhostPoint,
    transitType: tempStop.transitType || null,
    marker: null
  };
}

function applyDetourReplacementMetadata(stop, detourId, originalStops) {
  const originals = Array.isArray(originalStops) ? originalStops : [];

  stop.isDetourReplacement = true;
  stop.detourId = detourId;
  stop.detourRole = stop.isGhostPoint ? "passThrough" : "replacementStop";
  stop.detourOriginalStopIds = originals.map(originalStop => originalStop.id).filter(Boolean);
  stop.detourOriginalStopNames = originals.map(originalStop => originalStop.name).filter(Boolean);

  return stop;
}

function attachLineStopMarker(stop) {
  const marker = L.marker([stop.lat, stop.lon], {
    draggable: true,
    icon: getLineStopIcon(stop, false)
  }).addTo(map);

  marker.bindTooltip(stop.name, {
    permanent: true,
    direction: "top",
    offset: [0, -10]
  });

  marker.on("click", function () {
    selectStop(stop);
    renderStopOrderList();
  });

  marker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    stop.lat = newPos.lat;
    stop.lon = newPos.lng;

    if (state.routeMode === "auto") {
      rebuildAutoRouteFromStops();
    } else {
      refreshRouteLine();
      renderStopOrderList();
      setStatus(`Haltestelle verschoben: ${stop.name}`);
    }
  });

  stop.marker = marker;
  return marker;
}

function normalizeRoutingSegmentCoords(segmentCoords) {
  return (segmentCoords || [])
    .map(coord => {
      if (Array.isArray(coord)) {
        return [Number(coord[0]), Number(coord[1])];
      }

      return [Number(coord.lon), Number(coord.lat)];
    })
    .filter(coord => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
}

function getDetourRoutingAnchorDebugInfo(anchor, index) {
  return {
    index,
    name: anchor.name || "",
    id: anchor.id || null,
    catalogId: anchor.catalogId || null,
    sourceType: anchor.sourceType || null,
    isGhostPoint: !!anchor.isGhostPoint,
    lat: anchor.lat,
    lon: anchor.lon
  };
}

function debugDetourRoutingAnchors(anchors) {
  debug("Stop-Umleitung Routing-Anker", anchors.map(getDetourRoutingAnchorDebugInfo));
}

function warnSuspiciousDetourRoutingSegment(info) {
  const sameName = !!info.fromName && info.fromName === info.toName;
  const closeSameName = sameName && info.directMeters < 150;
  const shortButLongRoute = info.directMeters < 150 && info.routedMeters > 300;
  const mediumButLongRoute = info.directMeters < 300 && info.routedMeters > 500;
  const highRatio = info.ratio > 2.2;

  if (!closeSameName && !shortButLongRoute && !mediumButLongRoute && !highRatio) return;

  const reasons = [];
  if (shortButLongRoute) reasons.push("kurze Luftlinie, lange Route");
  if (mediumButLongRoute) reasons.push("mittlere Luftlinie, lange Route");
  if (highRatio) reasons.push("Routing-Verhaeltnis > 2.2");
  if (closeSameName) reasons.push("gleicher Name bei nahem Abstand");

  warn("Verdaechtiges Stop-Umleitungssegment", {
    ...info,
    reasons
  });
  setStatus("Umleitungsrouting wirkt unplausibel: bitte zusaetzlichen Durchfahrpunkt setzen oder Segment pruefen.", "warn");
}

function validateDetourRequiredPointsAgainstRoute(stops, detourRoutePoints) {
  const requiredStops = (Array.isArray(stops) ? stops : []).filter(stop =>
    stop && (stop.detourRole === "replacementStop" || stop.detourRole === "passThrough")
  );

  const results = requiredStops.map(stop => {
    const distanceMeters = getPointToRouteDistanceMeters(stop, detourRoutePoints);
    let severity = "ok";

    if (!Number.isFinite(distanceMeters) || distanceMeters > 80) {
      severity = "warning";
    } else if (distanceMeters > 30) {
      severity = "notice";
    }

    return {
      id: stop.id || null,
      name: stop.name || "Unbenannter Punkt",
      role: stop.detourRole,
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
      severity
    };
  });

  const notices = results.filter(result => result.severity === "notice");
  const warnings = results.filter(result => result.severity === "warning");

  debug("Umleitungs-Vorgabenpruefung", {
    checkedCount: results.length,
    noticeCount: notices.length,
    warningCount: warnings.length,
    routePointCount: Array.isArray(detourRoutePoints) ? detourRoutePoints.length : 0,
    results
  });

  return {
    results,
    notices,
    warnings,
    issues: [...notices, ...warnings]
  };
}

function normalizeManualRouteCoord(point) {
  if (Array.isArray(point)) {
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }

  if (!point) return null;

  const lon = Number(point.lon);
  const lat = Number(point.lat);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function areRouteCoordsEqual(a, b) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) < 0.0000001 && Math.abs(a[1] - b[1]) < 0.0000001;
}

function interpolateManualRouteCoords(points, stepMeters = 20) {
  const coords = (Array.isArray(points) ? points : [])
    .map(normalizeManualRouteCoord)
    .filter(Boolean);

  if (coords.length < 2) return coords;

  const result = [coords[0]];

  for (let i = 1; i < coords.length; i++) {
    const from = coords[i - 1];
    const to = coords[i];
    const distance = distanceMetersBetween(
      { lat: from[1], lon: from[0] },
      { lat: to[1], lon: to[0] }
    );

    if (!Number.isFinite(distance) || distance <= 0) {
      if (!areRouteCoordsEqual(result[result.length - 1], to)) {
        result.push(to);
      }
      continue;
    }

    const segmentCount = Math.max(1, Math.ceil(distance / stepMeters));
    for (let step = 1; step <= segmentCount; step++) {
      const t = step / segmentCount;
      const coord = [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t
      ];

      if (!areRouteCoordsEqual(result[result.length - 1], coord)) {
        result.push(coord);
      }
    }
  }

  return result;
}

function invalidateDetourPlannedRoutePreviewRequest() {
  detourPlannedRoutePreviewRequestId++;
  if (detourPlannedRoutePreviewTimer) {
    clearTimeout(detourPlannedRoutePreviewTimer);
    detourPlannedRoutePreviewTimer = null;
  }
}

function removeDetourPlannedRoutePreviewLine() {
  if (detourPlannedRoutePreviewLine && map.hasLayer(detourPlannedRoutePreviewLine)) {
    map.removeLayer(detourPlannedRoutePreviewLine);
  }
  detourPlannedRoutePreviewLine = null;
}

function clearDetourPlannedRoutePreview() {
  invalidateDetourPlannedRoutePreviewRequest();
  removeDetourPlannedRoutePreviewLine();
}

function clearDetourRemovedRoutePreview() {
  if (detourRemovedRoutePreviewLine && map.hasLayer(detourRemovedRoutePreviewLine)) {
    map.removeLayer(detourRemovedRoutePreviewLine);
  }
  detourRemovedRoutePreviewLine = null;

  if (detourCutStopPreviewLayer && map.hasLayer(detourCutStopPreviewLayer)) {
    map.removeLayer(detourCutStopPreviewLayer);
  }
  detourCutStopPreviewLayer = null;
}

function refreshDetourRemovedRoutePreview() {
  clearDetourRemovedRoutePreview();
  if (!state.detourWizard || state.detourWizard.phase !== "buildReplacement") return;

  const cutStartIndex = state.detourWizard.cutStartIndex;
  const cutEndIndex = state.detourWizard.cutEndIndex;
  if (!Number.isInteger(cutStartIndex) || !Number.isInteger(cutEndIndex)) return;

  detourCutStopPreviewLayer = L.layerGroup().addTo(map);
  state.stops.slice(cutStartIndex, cutEndIndex + 1).forEach(stop => {
    L.circleMarker([stop.lat, stop.lon], {
      radius: 13,
      color: "#b91c1c",
      weight: 3,
      opacity: 0.75,
      fillColor: "#6b7280",
      fillOpacity: 0.12,
      interactive: false
    }).addTo(detourCutStopPreviewLayer);
  });

  const beforeStop = state.stops[cutStartIndex - 1];
  const afterStop = state.stops[cutEndIndex + 1];
  if (!beforeStop || !afterStop) return;

  const beforeRouteIndex = findNearestRoutePointIndexFrom(0, beforeStop);
  const afterRouteIndex = beforeRouteIndex >= 0
    ? findNearestRoutePointIndexFrom(beforeRouteIndex, afterStop)
    : -1;
  if (beforeRouteIndex >= 0 && afterRouteIndex > beforeRouteIndex) {
    const cutRoutePoints = state.routePoints.slice(beforeRouteIndex, afterRouteIndex + 1);
    if (cutRoutePoints.length >= 2) {
      detourRemovedRoutePreviewLine = L.polyline(
        cutRoutePoints.map(point => [point.lat, point.lon]),
        {
          color: "#6b7280",
          weight: 8,
          opacity: 0.72,
          dashArray: "10 9",
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }
      ).addTo(map);
    }
  }

  if (detourPlannedRoutePreviewLine && map.hasLayer(detourPlannedRoutePreviewLine)) {
    detourPlannedRoutePreviewLine.bringToFront();
  }
}

function getDetourPlannedRouteAnchors() {
  if (!state.detourWizard || state.detourWizard.phase !== "buildReplacement") return null;

  const cutStartIndex = state.detourWizard.cutStartIndex;
  const cutEndIndex = state.detourWizard.cutEndIndex;
  if (!Number.isInteger(cutStartIndex) || !Number.isInteger(cutEndIndex)) return null;

  const beforeStop = state.stops[cutStartIndex - 1];
  const afterStop = state.stops[cutEndIndex + 1];
  if (!beforeStop || !afterStop) return null;

  const routingMode = state.detourWizard.routingMode || "street";
  const detourItems = routingMode === "street"
    ? (Array.isArray(state.detourWizard.replacementStops) ? state.detourWizard.replacementStops : [])
    : getOrderedDetourItems();
  if (!detourItems.length) return null;

  return [beforeStop, ...detourItems, afterStop];
}

function renderDetourPlannedRoutePreview(routeCoords) {
  const previewCoords = normalizeRoutingSegmentCoords(routeCoords)
    .map(coord => [coord[1], coord[0]]);

  if (previewCoords.length < 2) {
    removeDetourPlannedRoutePreviewLine();
    return;
  }

  if (!detourPlannedRoutePreviewLine) {
    detourPlannedRoutePreviewLine = L.polyline(previewCoords, {
      color: "#2563eb",
      weight: 6,
      opacity: 0.9,
      dashArray: "10 7",
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(map);
    detourPlannedRoutePreviewLine.bringToFront();
    return;
  }

  detourPlannedRoutePreviewLine.setLatLngs(previewCoords);
  detourPlannedRoutePreviewLine.bringToFront();
}

async function refreshDetourPlannedRoutePreviewAsync(requestId) {
  if (requestId !== detourPlannedRoutePreviewRequestId) return;

  const anchors = getDetourPlannedRouteAnchors();
  if (!anchors) {
    removeDetourPlannedRoutePreviewLine();
    return;
  }

  const routingMode = state.detourWizard.routingMode || "street";
  const orderedDetourItems = getOrderedDetourItems();

  try {
    const routeCoords = await buildDetourReplacementRouteCoords(
      anchors,
      routingMode,
      orderedDetourItems
    );
    if (
      requestId !== detourPlannedRoutePreviewRequestId ||
      !state.detourWizard ||
      state.detourWizard.phase !== "buildReplacement"
    ) {
      return;
    }
    renderDetourPlannedRoutePreview(routeCoords);
  } catch (err) {
    if (requestId !== detourPlannedRoutePreviewRequestId) return;
    removeDetourPlannedRoutePreviewLine();
    debug("Umleitungsvorschau fehlgeschlagen", err);
    setStatus(`Umleitungsvorschau konnte nicht berechnet werden: ${err.message}`, "warn");
  }
}

function scheduleDetourPlannedRoutePreview() {
  refreshDetourRemovedRoutePreview();
  invalidateDetourPlannedRoutePreviewRequest();
  const requestId = detourPlannedRoutePreviewRequestId;
  const anchors = getDetourPlannedRouteAnchors();

  if (!anchors) {
    removeDetourPlannedRoutePreviewLine();
    return;
  }

  const routingMode = state.detourWizard.routingMode || "street";
  if (routingMode === "manual") {
    renderDetourPlannedRoutePreview(interpolateManualRouteCoords(anchors, 20));
    return;
  }

  removeDetourPlannedRoutePreviewLine();
  detourPlannedRoutePreviewTimer = setTimeout(() => {
    detourPlannedRoutePreviewTimer = null;
    refreshDetourPlannedRoutePreviewAsync(requestId);
  }, 400);
}

async function buildDetourReplacementRouteCoords(anchors, routingMode = "street", orderedDetourItems = []) {
  if (routingMode === "manual") {
    if (!Array.isArray(orderedDetourItems) || !orderedDetourItems.length) {
      throw new Error("Punktfuehrung benoetigt mindestens einen Umleitungspunkt.");
    }

    const manualGeometryPoints = [
      anchors[0],
      ...orderedDetourItems,
      anchors[anchors.length - 1]
    ].filter(Boolean);
    const manualCoords = interpolateManualRouteCoords(manualGeometryPoints, 20);
    debug("Stop-Umleitung Punktfuehrung", {
      anchorCount: anchors.length,
      detourItemCount: orderedDetourItems.length,
      routePointCount: manualCoords.length
    });
    return manualCoords;
  }

  let routingAnchors = anchors;
  if (routingMode === "guidedStreet") {
    if (!Array.isArray(orderedDetourItems) || !orderedDetourItems.length) {
      throw new Error("Straßenrouting über Fahrwegpunkte benötigt mindestens einen Umleitungspunkt.");
    }

    routingAnchors = [
      anchors[0],
      ...orderedDetourItems,
      anchors[anchors.length - 1]
    ].filter(Boolean);
    debug("Stop-Umleitung guidedStreet", {
      anchorCount: routingAnchors.length,
      detourItemCount: orderedDetourItems.length
    });
  }

  debugDetourRoutingAnchors(routingAnchors);
  return buildStreetRouteCoordsViaAnchors(routingAnchors, {
    routingModeLabel: routingMode,
    onSegmentDebug: segmentInfo => debug("Stop-Umleitung Routing-Segment", segmentInfo),
    onSegmentWarning: warnSuspiciousDetourRoutingSegment
  });
}

function getDetourWizardFinalContext() {
  if (!isDetourWizardBuildPhase()) {
    return { ok: false, message: "Kein aktiver Umleitungsentwurf." };
  }

  const wizard = state.detourWizard;
  const cutStartIndex = wizard.cutStartIndex;
  const cutEndIndex = wizard.cutEndIndex;

  if (!Number.isInteger(cutStartIndex) || !Number.isInteger(cutEndIndex) || cutEndIndex < cutStartIndex) {
    return { ok: false, message: "Umleitungsbereich ist unvollstaendig." };
  }

  const beforeStop = state.stops[cutStartIndex - 1];
  const afterStop = state.stops[cutEndIndex + 1];

  if (!beforeStop || !afterStop) {
    return {
      ok: false,
      message: "V1 kann keine Umleitung am Linienanfang oder Linienende uebernehmen. Bitte einen inneren Haltestellenbereich waehlen."
    };
  }

  const tempReplacementStops = Array.isArray(wizard.replacementStops) ? wizard.replacementStops : [];
  if (!tempReplacementStops.length) {
    return { ok: false, message: "Bitte mindestens eine Ersatzhaltestelle oder einen Durchfahrpunkt setzen." };
  }

  const beforeRouteIndex = findNearestRoutePointIndexFrom(0, beforeStop);
  if (beforeRouteIndex < 0) {
    return { ok: false, message: `Keinen RoutePoint fuer Anschluss vor der Umleitung gefunden: ${beforeStop.name}` };
  }

  const afterRouteIndex = findNearestRoutePointIndexFrom(beforeRouteIndex, afterStop);
  if (afterRouteIndex < 0 || afterRouteIndex <= beforeRouteIndex) {
    return { ok: false, message: `Keinen gueltigen RoutePoint fuer Anschluss nach der Umleitung gefunden: ${afterStop.name}` };
  }

  return {
    ok: true,
    wizard,
    cutStartIndex,
    cutEndIndex,
    beforeStop,
    afterStop,
    beforeRouteIndex,
    afterRouteIndex,
    tempReplacementStops
  };
}

async function finishDetourWizardReplacement() {
  const context = getDetourWizardFinalContext();
  if (!context.ok) {
    setStatus(context.message, "warn");
    return;
  }

  invalidateDetourPlannedRoutePreviewRequest();

  const anchors = [context.beforeStop, ...context.tempReplacementStops, context.afterStop];
  const orderedDetourItems = getOrderedDetourItems();

  let routedCoords;
  try {
    setStatus("Umleitung wird berechnet...");
    routedCoords = await buildDetourReplacementRouteCoords(
      anchors,
      context.wizard.routingMode || "street",
      orderedDetourItems
    );
  } catch (err) {
    setStatus(`Umleitung konnte nicht berechnet werden: ${err.message}`, "error");
    return;
  }

  if (!Array.isArray(routedCoords) || routedCoords.length < 2) {
    setStatus("Umleitung konnte nicht berechnet werden: zu wenige RoutePoints.", "error");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Stop-Umleitung uebernommen");
  }

  const detourId = "detour_" + Date.now();
  const originalStops = state.stops.slice(context.cutStartIndex, context.cutEndIndex + 1);
  const replacementStops = orderedDetourItems
    .filter(item => item.kind === "replacementStop" || item.kind === "passThroughStop")
    .map(cloneDetourReplacementAsLineStop)
    .map(stop => applyDetourReplacementMetadata(stop, detourId, originalStops));
  replacementStops.forEach(attachLineStopMarker);

  state.stops.splice(
    context.cutStartIndex,
    context.cutEndIndex - context.cutStartIndex + 1,
    ...replacementStops
  );

  const removedRoutePoints = state.routePoints.splice(
    context.beforeRouteIndex + 1,
    context.afterRouteIndex - context.beforeRouteIndex - 1
  );

  removedRoutePoints.forEach(point => {
    if (point.marker && map.hasLayer(point.marker)) {
      map.removeLayer(point.marker);
    }
  });

  const innerCoords = routedCoords.slice(1, -1);
  let insertIndex = context.beforeRouteIndex + 1;
  const insertedRoutePointSourceType = context.wizard.routingMode === "manual" ? "manual" : "street";
  innerCoords.forEach(coord => {
    createRoutePointObject(coord[1], coord[0], true, insertedRoutePointSourceType);
    const createdPoint = state.routePoints.pop();
    state.routePoints.splice(insertIndex, 0, createdPoint);
    insertIndex++;
  });

  const detourRoutePoints = state.routePoints.slice(
    context.beforeRouteIndex,
    context.beforeRouteIndex + innerCoords.length + 2
  );
  const requiredPointValidation = validateDetourRequiredPointsAgainstRoute(
    replacementStops,
    detourRoutePoints
  );

  state.simplifiedRoutePoints = [];
  state.previewMode = "original";
  state.lastRoutedStopCount = state.stops.length;
  state.lastRoutedStopIds = state.stops.map(stop => stop.id);

  clearDetourReplacementStops();
  resetDetourWizardState();
  state.selectedStopIds.clear();
  state.selectedRoutePointIds.clear();
  state.selected = null;
  state.routeMode = "street";

  clearSelection();
  refreshRouteLine();
  applyRoutePointIcons();
  renderStopOrderList();
  updateStats();
  updateRouteStats();
  updateModeButtons();

  if (requiredPointValidation.issues.length) {
    const issueCount = requiredPointValidation.issues.length;
    const issueDetails = requiredPointValidation.issues.map(issue => {
      const pointType = issue.role === "passThrough" ? "Durchfahrpunkt" : "Ersatzhaltestelle";
      const distanceText = Number.isFinite(issue.distanceMeters)
        ? `${Math.round(issue.distanceMeters)} m`
        : "Abstand nicht berechenbar";
      return `${pointType} ${issue.name}: ${distanceText}`;
    });
    const summary = `Umleitung uebernommen, aber ${issueCount} Vorgabe${issueCount === 1 ? " liegt" : "n liegen"} nicht nah genug an der Route.`;
    const popupMessage = `${summary} ${issueDetails.join("; ")}`;

    setStatus(summary, requiredPointValidation.warnings.length ? "warn" : "info");
    showInfoPopup({
      title: "Umleitung pruefen",
      message: popupMessage,
      level: requiredPointValidation.warnings.length ? "warning" : "info"
    });
  } else {
    setStatus("Umleitung uebernommen");
  }
}

async function acceptDetourWizardAction() {
  if (isDetourWizardBuildPhase()) {
    await finishDetourWizardReplacement();
    return;
  }

  acceptDetourStopRange();
}

function setDetourWizardRoutingMode(routingMode) {
  if (!isDetourWizardBuildPhase()) return;

  state.detourWizard.routingMode = routingMode === "manual" || routingMode === "guidedStreet"
    ? routingMode
    : "street";
  state.detourWizard.manualInputMode = "guidePoint";

  scheduleDetourPlannedRoutePreview();

  if (detourRoutingModeSelect) {
    detourRoutingModeSelect.value = state.detourWizard.routingMode;
  }
  if (detourManualInputModeSelect) {
    detourManualInputModeSelect.value = state.detourWizard.manualInputMode;
  }

  if (state.detourWizard.routingMode === "manual") {
    setStatus("Punktfuehrung: Kartenklick setzt Fahrwegpunkt.");
  } else if (state.detourWizard.routingMode === "guidedStreet") {
    setStatus("Strassenrouting ueber Fahrwegpunkte: Kartenklick setzt Fahrwegpunkt.");
  } else {
    setStatus("Strassenrouting: Route wird zwischen Ersatzhaltestellen und Durchfahrpunkten berechnet.");
  }
  updateModeButtons();
}

function setDetourWizardManualInputMode(inputMode) {
  if (!isDetourWizardBuildPhase()) return;

  state.detourWizard.manualInputMode = inputMode === "passThroughStop" ? "passThroughStop" : "guidePoint";

  if (detourManualInputModeSelect) {
    detourManualInputModeSelect.value = state.detourWizard.manualInputMode;
  }

  const routingModeLabel = state.detourWizard.routingMode === "guidedStreet"
    ? "Strassenrouting ueber Fahrwegpunkte"
    : "Punktfuehrung";

  if (state.detourWizard.manualInputMode === "passThroughStop") {
    setStatus(`${routingModeLabel}: Kartenklick setzt Durchfahrpunkt [Ghost].`);
  } else {
    setStatus(`${routingModeLabel}: Kartenklick setzt Fahrwegpunkt.`);
  }
  scheduleDetourPlannedRoutePreview();
  updateModeButtons();
}

function getSelectedDetourStopRange() {
  const selectedEntries = state.stops
    .map((stop, index) => ({ stop, index }))
    .filter(entry => state.selectedStopIds.has(entry.stop.id));

  if (!selectedEntries.length) {
    return {
      ok: false,
      message: "Bitte mindestens eine Haltestelle für den Umleitungsbereich auswählen."
    };
  }

  const startIndex = selectedEntries[0].index;
  const endIndex = selectedEntries[selectedEntries.length - 1].index;
  const expectedCount = endIndex - startIndex + 1;

  if (selectedEntries.length !== expectedCount) {
    return {
      ok: false,
      message: "Die Auswahl ist nicht zusammenhängend. Bitte einen durchgehenden Haltestellenbereich auswählen."
    };
  }

  return {
    ok: true,
    startIndex,
    endIndex,
    stopIds: selectedEntries.map(entry => entry.stop.id),
    stops: selectedEntries.map(entry => entry.stop)
  };
}

function startDetourWizard() {
  if (state.routeMode === "detourDraft" && state.detourDraft) {
    setStatus("Bitte die routePoint-Umleitung zuerst übernehmen oder abbrechen.", "warn");
    return;
  }

  if (state.routeMode === "specialTrack" || state.routeMode === "specialTrackExtend") {
    setStatus("Bitte die Sondertrasse zuerst abschließen oder abbrechen.", "warn");
    return;
  }

  resetDetourWizardState();
  state.detourWizard.phase = "selectStops";
  state.selectedStopIds.clear();
  state.selected = null;
  state.routeMode = "detourSelectStops";

  clearSelection();
  renderStopOrderList();
  updateModeButtons();
  updateStats();
  setStatus("Umleitungsbereich waehlen: Stopbereich in der Haltestellenliste auswaehlen. Danach Bereich uebernehmen, Ersatzhaltestellen/Durchfahrpunkte/Fahrwegpunkte setzen und Routingart waehlen.");
}

function acceptDetourStopRange() {
  if (!isDetourWizardSelectPhase()) {
    setStatus("Kein aktiver Umleitungs-Wizard.", "warn");
    return;
  }

  const range = getSelectedDetourStopRange();
  if (!range.ok) {
    setStatus(range.message, "warn");
    return;
  }

  state.detourWizard.cutStopIds = range.stopIds;
  state.detourWizard.cutStartIndex = range.startIndex;
  state.detourWizard.cutEndIndex = range.endIndex;
  state.detourWizard.routingMode = "street";
  state.detourWizard.manualInputMode = "guidePoint";
  state.detourWizard.nextDetourItemOrder = 1;
  state.detourWizard.manualRoutePoints = [];
  state.detourWizard.replacementStops = [];
  state.detourWizard.phase = "buildReplacement";
  state.selectedStopIds.clear();
  state.selected = null;
  state.routeMode = "detourBuildReplacement";

  renderStopOrderList();
  updateModeButtons();
  updateStats();
  setStatus(`Ersatzhaltestellen setzen: ${range.stops[0].name} bis ${range.stops[range.stops.length - 1].name} bleibt markiert. Originalroute unveraendert.`);
}

function cancelDetourWizard() {
  if (!state.detourWizard || !state.detourWizard.phase) {
    setStatus("Kein aktiver Umleitungs-Wizard.", "warn");
    return;
  }

  resetDetourWizardState();
  state.selectedStopIds.clear();
  state.selected = null;
  state.routeMode = "freeStop";

  clearSelection();
  renderStopOrderList();
  updateModeButtons();
  updateStats();
  setStatus("Umleitung abgebrochen. Haltestellen und Route unverändert.");
}

// =========================
// STOPS MAIN
// =========================

function addStopToLine({
  name,
  lat,
  lon,
  sourceType,
  catalogId = null,
  transitType = null,
  directionHint = null,
  isGhostPoint = false,
  isDetourReplacement = false,
  detourId = null,
  detourRole = null,
  detourOriginalStopIds = [],
  detourOriginalStopNames = []
}) {
  if (!historyRestoreRunning) {
    pushHistorySnapshot("Stop hinzugefügt");
  }

  const stop = {
    id: "stop_" + stopIdCounter++,
    catalogId,
    name,
    lat,
    lon,
    minuteFromStart: 0,
    minuteMode: "auto",
    note: "",
    sourceType,
    isGhostPoint: !!isGhostPoint,
    isDetourReplacement: !!isDetourReplacement,
    detourId: detourId || null,
    detourRole: detourRole || null,
    detourOriginalStopIds: Array.isArray(detourOriginalStopIds) ? [...detourOriginalStopIds] : [],
    detourOriginalStopNames: Array.isArray(detourOriginalStopNames) ? [...detourOriginalStopNames] : [],
    transitType,
    directionHint,
    marker: null
  };

  const marker = L.marker([lat, lon], {
    draggable: true,
    icon: getLineStopIcon(stop, false)
  }).addTo(map);

  marker.bindTooltip(stop.name, {
    permanent: true,
    direction: "top",
    offset: [0, -10]
  });

  marker.on("click", function () {
  selectStop(stop);
  renderStopOrderList();
});

  marker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    stop.lat = newPos.lat;
    stop.lon = newPos.lng;

    if (state.routeMode === "auto") {
      rebuildAutoRouteFromStops();
    } else {
      setStatus("Haltestelle verschoben.");
    }

    renderStopOrderList();
    updateStats();
  });

  stop.marker = marker;

  let insertIndex = state.stops.length;
  if (state.selected && state.selected.type === "stop") {
    const selectedIndex = state.stops.findIndex(s => s.id === state.selected.ref.id);
    if (selectedIndex >= 0) {
      insertIndex = selectedIndex + 1;
    }
  }

  state.stops.splice(insertIndex, 0, stop);

  selectStop(stop);
  renderStopOrderList();
  updateStats();

  return stop;
}

function addCatalogStopToLine(catalogStop) {
  return addStopToLine({
    name: catalogStop.name,
    lat: catalogStop.lat,
    lon: catalogStop.lon,
    sourceType: "catalog",
    catalogId: catalogStop.id,
    transitType: catalogStop.type || null,
    directionHint: catalogStop.direction || null
  });
}

function createFreeStop(lat, lon) {
  addStopToLine({
    name: "Freie Haltestelle " + (state.stops.length + 1),
    lat,
    lon,
    sourceType: "free",
    // Freie Zwischenpunkte sind standardmäßig Ghostpunkte,
    // damit sie nicht als normale Haltestellen in der App auftauchen.
    isGhostPoint: true
  });
}

function setStopGhostState(stop, enabled) {
  stop.isGhostPoint = !!enabled;
  stop.isGhost = !!enabled;

  if (stop.marker) {
    const isSelectedStop = state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id;
    stop.marker.setIcon(getLineStopIcon(stop, !!isSelectedStop));
  }

  if (state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id) {
    stopGhostInput.checked = !!stop.isGhostPoint;
    stopSourceInput.value = stop.isGhostPoint
      ? "Ghostpunkt"
      : (stop.sourceType === "catalog" ? "Katalog-Haltestelle" : "Freie Haltestelle");
  }

  renderStopOrderList();
  updateStopMarkerTooltip(stop);
}

// =========================
// ORDER LIST
// =========================

let stopOrderDragIndex = -1;

function renderStopOrderList() {
  stopOrderList.innerHTML = "";

  state.stops.forEach((stop, index) => {
    const item = document.createElement("div");
    item.className = "stop-order-item";

    const isSelectedInList = state.selectedStopIds.has(stop.id);
    const isCurrentSelection = state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id;
    const isDetourCut = isDetourCutStop(stop);

    if (isSelectedInList || isCurrentSelection) {
      item.classList.add("active");
    }
    if (isDetourCut) {
      item.classList.add("detour-cut-stop");
    }
    if (stop.isDetourReplacement) {
      item.classList.add(stop.detourRole === "passThrough" || stop.isGhostPoint ? "detour-pass-through-stop" : "detour-replacement-line-stop");
    }

    const main = document.createElement("div");
    main.className = "stop-order-main";

    const indexValue = document.createElement("span");
    indexValue.className = "stop-order-row-index";
    indexValue.textContent = `${index + 1}.`;

    const ghostToggle = document.createElement("input");
    ghostToggle.type = "checkbox";
    ghostToggle.className = "stop-order-ghost-checkbox";
    ghostToggle.checked = !!stop.isGhostPoint;
    ghostToggle.title = "Ghostpunkt an/aus";
    ghostToggle.setAttribute("aria-label", `Ghostpunkt für ${stop.name} an/aus`);
    ghostToggle.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    ghostToggle.addEventListener("change", function (e) {
      e.stopPropagation();

      if (!historyRestoreRunning) {
        pushHistorySnapshot("Ghostpunkt umgeschaltet");
      }

      setStopGhostState(stop, ghostToggle.checked);
      setStatus(`Ghostpunkt ${ghostToggle.checked ? "aktiv" : "deaktiviert"}: ${stop.name}`);
    });

    const name = document.createElement("span");
    name.className = "stop-order-row-name";
    const badges = [];
    if (stop.isDetourReplacement) {
      badges.push(stop.detourRole === "passThrough" || stop.isGhostPoint ? "[Durchfahrt]" : "[Ersatz]");
    } else if (stop.isGhostPoint) {
      badges.push("[Ghost]");
    }
    name.textContent = `${stop.name}${badges.length ? " " + badges.join(" ") : ""}`;

    if (stop.isDetourReplacement && Array.isArray(stop.detourOriginalStopNames) && stop.detourOriginalStopNames.length) {
      name.title = `ersetzt: ${stop.detourOriginalStopNames.join(", ")}`;
    }

    main.appendChild(indexValue);
    main.appendChild(ghostToggle);
    main.appendChild(name);
    if (isDetourCut) {
      const cutStopBadge = document.createElement("span");
      cutStopBadge.className = "detour-cut-stop-badge";
      cutStopBadge.textContent = state.detourWizard && state.detourWizard.phase === "buildReplacement"
        ? "ENTFÄLLT"
        : "AUSGEWÄHLT";
      main.appendChild(cutStopBadge);
    }

    main.addEventListener("click", function () {
  selectStop(stop);
});

    item.addEventListener("dragover", function (e) {
      if (stopOrderDragIndex < 0) return;
      e.preventDefault();
      item.classList.add("drag-over");
    });

    item.addEventListener("dragleave", function () {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", function (e) {
      e.preventDefault();
      item.classList.remove("drag-over");

      const fromIndex = stopOrderDragIndex;
      const toIndex = index;

      stopOrderDragIndex = -1;

      if (fromIndex < 0 || fromIndex === toIndex) return;
      if (fromIndex >= state.stops.length || toIndex >= state.stops.length) return;

      const movedStop = state.stops[fromIndex];
      state.stops.splice(fromIndex, 1);

      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      state.stops.splice(insertIndex, 0, movedStop);

      renderStopOrderList();
      updateStats();
      setStatus(`Reihenfolge geändert: ${movedStop.name}`);
    });

    const actions = document.createElement("div");
    actions.className = "stop-order-actions";

    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "stop-drag-handle";
    dragHandle.textContent = "⋮⋮";
    dragHandle.title = "Per Ziehen verschieben";
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", function (e) {
      stopOrderDragIndex = index;
      item.classList.add("drag-source");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
      }
    });
    dragHandle.addEventListener("dragend", function () {
      stopOrderDragIndex = -1;
      item.classList.remove("drag-source");
      stopOrderList.querySelectorAll(".stop-order-item.drag-over").forEach(el => el.classList.remove("drag-over"));
      stopOrderList.querySelectorAll(".stop-order-item.drag-source").forEach(el => el.classList.remove("drag-source"));
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.onclick = () => {
      const stopToDelete = state.stops[index];

      if (stopToDelete.marker) map.removeLayer(stopToDelete.marker);

      state.stops.splice(index, 1);

      renderStopOrderList();
      updateStats();
      setStatus(`Gelöscht: ${stopToDelete.name}`);
    };

    actions.appendChild(dragHandle);
    actions.appendChild(delBtn);

    item.appendChild(main);
    item.appendChild(actions);
    stopOrderList.appendChild(item);
  });

  renderDetourReplacementStops();
  refreshDetourRemovedRoutePreview();
}

function renderDetourReplacementStops() {
  if (!state.detourWizard || state.detourWizard.phase !== "buildReplacement") return;

  const orderedItems = getOrderedDetourItems();
  const section = document.createElement("div");
  section.className = "detour-replacement-section";

  const title = document.createElement("div");
  title.className = "detour-replacement-title";
  title.textContent = "Temporaere Umleitungspunkte";
  section.appendChild(title);

  if (!orderedItems.length) {
    const empty = document.createElement("div");
    empty.className = "detour-replacement-empty";
    empty.textContent = "Noch keine Ersatzhaltestellen, Durchfahrpunkte oder Fahrwegpunkte gesetzt.";
    section.appendChild(empty);
    stopOrderList.appendChild(section);
    return;
  }

  orderedItems.forEach((detourItem, index) => {
    const isGuidePoint = detourItem.kind === "guidePoint";
    const selectionType = isGuidePoint ? "detourManualRoutePoint" : "detourReplacementStop";
    const isSelected = state.selected && state.selected.type === selectionType && state.selected.ref.id === detourItem.id;

    if (detourItem.marker) {
      detourItem.marker.setIcon(isGuidePoint
        ? getDetourManualRoutePointIcon(detourItem, isSelected)
        : getDetourReplacementStopIcon(detourItem, isSelected));
    }

    const item = document.createElement("div");
    item.className = isGuidePoint ? "detour-manual-route-point" : "detour-replacement-stop";
    if (isSelected) item.classList.add("active");
    if (detourItem.kind === "passThroughStop") item.classList.add("detour-replacement-ghost");

    const main = document.createElement("div");
    main.className = "detour-replacement-main";

    const indexValue = document.createElement("span");
    indexValue.className = "stop-order-row-index";
    indexValue.textContent = `${index + 1}.`;

    const name = document.createElement("span");
    name.className = "stop-order-row-name";
    name.textContent = detourItem.name;

    const source = document.createElement("span");
    source.className = "stop-order-row-index";
    source.textContent = detourItem.kind === "guidePoint"
      ? "Fahrwegpunkt"
      : (detourItem.kind === "passThroughStop" ? "Durchfahrpunkt [Ghost]" : "Ersatzhaltestelle");

    main.appendChild(indexValue);
    main.appendChild(name);
    main.appendChild(source);

    main.addEventListener("click", function () {
      state.selected = { type: selectionType, ref: detourItem };
      if (detourItem.marker) {
        map.setView([detourItem.lat, detourItem.lon], 17);
      }
      renderStopOrderList();
      const itemLabel = isGuidePoint ? "Fahrwegpunkt" : getDetourReplacementStopLabel(detourItem);
      setStatus(`${itemLabel} ausgewaehlt: ${detourItem.name}`);
    });

    const actions = document.createElement("div");
    actions.className = "stop-order-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Entfernen";
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isGuidePoint) {
        removeDetourManualRoutePoint(detourItem.id);
      } else {
        removeDetourReplacementStop(detourItem.id);
      }
    });

    actions.appendChild(deleteBtn);
    item.appendChild(main);
    item.appendChild(actions);
    section.appendChild(item);
  });

  stopOrderList.appendChild(section);
}

// =========================
// MOVE
// =========================

function moveStopUp(index) {
  if (index <= 0) return;

  const tmp = state.stops[index - 1];
  state.stops[index - 1] = state.stops[index];
  state.stops[index] = tmp;

  renderStopOrderList();
}

function moveStopDown(index) {
  if (index >= state.stops.length - 1) return;

  const tmp = state.stops[index + 1];
  state.stops[index + 1] = state.stops[index];
  state.stops[index] = tmp;

  renderStopOrderList();
}

// =========================
// DELETE / SNAP
// =========================

function deleteSelectedStop() {
  if (!state.selected || state.selected.type !== "stop") return;

  const stop = state.selected.ref;

  if (stop.marker) map.removeLayer(stop.marker);

  state.stops = state.stops.filter(s => s.id !== stop.id);

  clearSelection();
  renderStopOrderList();
  updateStats();
}

function snapSelectedStopToRoute() {
  if (!state.selected || state.selected.type !== "stop") return;

  const stop = state.selected.ref;
  const snap = findClosestPointOnRoute(stop.lat, stop.lon);

  if (!snap) return;

  stop.lat = snap.lat;
  stop.lon = snap.lon;
  stop.marker.setLatLng([stop.lat, stop.lon]);

  renderStopOrderList();
  setStatus(`Gesnappt: ${stop.name}`);
}

// =========================
// GHOST ASSISTANT
// =========================

function insertGhostStopAtIndex(insertIndex, lat, lon, name) {
  const stop = {
    id: "stop_" + stopIdCounter++,
    catalogId: null,
    name,
    lat,
    lon,
    minuteFromStart: 0,
    minuteMode: "auto",
    note: "",
    sourceType: "free",
    isGhostPoint: true,
    isGhost: true,
    transitType: null,
    directionHint: null,
    marker: null
  };

  const marker = L.marker([lat, lon], {
    draggable: true,
    icon: getLineStopIcon(stop, false)
  }).addTo(map);

  marker.bindTooltip(stop.name, {
    permanent: true,
    direction: "top",
    offset: [0, -10]
  });

  marker.on("click", function () {
    selectStop(stop);
    renderStopOrderList();
  });

  marker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    stop.lat = newPos.lat;
    stop.lon = newPos.lng;

    if (state.routeMode === "auto") {
      rebuildAutoRouteFromStops();
    } else {
      setStatus("Ghostpunkt verschoben.");
    }

    renderStopOrderList();
    updateStats();
  });

  stop.marker = marker;
  state.stops.splice(insertIndex, 0, stop);
  return stop;
}

function findNearestRouteIndexInRange(startIdx, endIdx, targetDistance, cumulative) {
  let bestIdx = startIdx;
  let bestGap = Infinity;

  for (let i = startIdx; i <= endIdx; i++) {
    const gap = Math.abs((cumulative[i] || 0) - targetDistance);
    if (gap < bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function suggestGhostPointsFromRoute() {
  if (!state.stops || state.stops.length < 2) {
    setStatus("Ghostpunkt-Assistent: mindestens 2 Haltestellen benötigt.", "warn");
    return;
  }

  if (!state.routePoints || state.routePoints.length < 3) {
    setStatus("Ghostpunkt-Assistent: zuerst eine Straßenroute erzeugen.", "warn");
    return;
  }

  const spacingRaw = prompt(
    "Abstand zwischen automatischen Ghostpunkten in Metern:\n\nEmpfehlung: 350 bis 550",
    "450"
  );
  if (spacingRaw === null) {
    setStatus("Ghostpunkt-Assistent abgebrochen.", "warn");
    return;
  }

  const spacingMeters = Math.max(150, Math.min(2000, Number(spacingRaw) || 450));
  const minStopDistanceMeters = 85;

  const stopRouteIndices = [];
  let searchStartIndex = 0;
  for (const stop of state.stops) {
    const idx = findNearestRoutePointIndexFrom(searchStartIndex, stop);
    if (idx < 0) {
      stopRouteIndices.push(searchStartIndex);
      continue;
    }
    stopRouteIndices.push(idx);
    searchStartIndex = Math.max(searchStartIndex, idx);
  }

  const planned = [];
  const usedRouteIndices = new Set();

  for (let i = 0; i < state.stops.length - 1; i++) {
    const fromIdx = stopRouteIndices[i];
    const toIdx = stopRouteIndices[i + 1];
    if (!Number.isInteger(fromIdx) || !Number.isInteger(toIdx)) continue;
    if (toIdx <= fromIdx + 1) continue;

    const cumulative = [];
    cumulative[fromIdx] = 0;
    let segmentLength = 0;

    for (let rp = fromIdx + 1; rp <= toIdx; rp++) {
      segmentLength += distanceMetersBetween(state.routePoints[rp - 1], state.routePoints[rp]);
      cumulative[rp] = segmentLength;
    }

    if (segmentLength < spacingMeters * 1.35) {
      continue;
    }

    const suggestionCount = Math.min(8, Math.floor(segmentLength / spacingMeters));
    if (suggestionCount <= 0) continue;

    for (let n = 1; n <= suggestionCount; n++) {
      const targetDist = (segmentLength * n) / (suggestionCount + 1);
      const routeIndex = findNearestRouteIndexInRange(fromIdx + 1, toIdx - 1, targetDist, cumulative);
      if (usedRouteIndices.has(routeIndex)) continue;

      const point = state.routePoints[routeIndex];
      if (!point) continue;

      const tooCloseToExistingStop = state.stops.some(stop =>
        distanceMetersBetween(stop, point) < minStopDistanceMeters
      );
      if (tooCloseToExistingStop) continue;

      usedRouteIndices.add(routeIndex);

      planned.push({
        insertAfterIndex: i,
        routeIndex,
        lat: point.lat,
        lon: point.lon,
        name: `Ghostpunkt ${i + 1}.${n}`
      });
    }
  }

  if (!planned.length) {
    setStatus("Ghostpunkt-Assistent: keine sinnvollen Punkte gefunden.", "warn");
    return;
  }

  const proceed = confirm(
    `Ghostpunkt-Assistent hat ${planned.length} Vorschläge gefunden.\n\nJetzt als Ghostpunkte einfügen?`
  );
  if (!proceed) {
    setStatus("Ghostpunkt-Assistent: Vorschläge nicht übernommen.", "warn");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Ghostpunkte automatisch gesetzt");
  }

  const sorted = planned
    .slice()
    .sort((a, b) => (b.insertAfterIndex - a.insertAfterIndex) || (b.routeIndex - a.routeIndex));

  sorted.forEach(item => {
    const insertIndex = item.insertAfterIndex + 1;
    insertGhostStopAtIndex(insertIndex, item.lat, item.lon, item.name);
  });

  if (typeof autoAssignStopMinutes === "function") {
    autoAssignStopMinutes(false);
  }

  renderStopOrderList();
  updateStats();
  updateLineMetricsUI();
  setStatus(`Ghostpunkt-Assistent: ${planned.length} Ghostpunkte eingefügt.`, "success");
}
