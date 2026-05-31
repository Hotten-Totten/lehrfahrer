// =========================
// ROUTE GEOMETRY HELPERS
// =========================

function removeMarkerSafe(marker) {
  if (marker && map.hasLayer(marker)) {
    map.removeLayer(marker);
  }
}

function approxDistanceMeters(a, b) {
  const latFactor = 111320;
  const lonFactor = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);

  const dx = (b.lon - a.lon) * lonFactor;
  const dy = (b.lat - a.lat) * latFactor;

  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistanceMeters(p, a, b) {
  const latFactor = 111320;
  const lonFactor = 111320 * Math.cos(((a.lat + b.lat + p.lat) / 3) * Math.PI / 180);

  const ax = a.lon * lonFactor;
  const ay = a.lat * latFactor;
  const bx = b.lon * lonFactor;
  const by = b.lat * latFactor;
  const px = p.lon * lonFactor;
  const py = p.lat * latFactor;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLen2 = abx * abx + aby * aby;
  if (abLen2 === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let t = (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * abx;
  const projY = ay + t * aby;

  const dx = px - projX;
  const dy = py - projY;

  return Math.sqrt(dx * dx + dy * dy);
}

function getPerpendicularDistance(point, lineStart, lineEnd) {
  const x = point.lon;
  const y = point.lat;

  const x1 = lineStart.lon;
  const y1 = lineStart.lat;

  const x2 = lineEnd.lon;
  const y2 = lineEnd.lat;

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx;
  let yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;

  return Math.sqrt(dx * dx + dy * dy);
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let index = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = getPerpendicularDistance(points[i], start, end);

    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }

  if (maxDistance > tolerance) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [start, end];
}

function findClosestSegment(latlng) {
  if (state.routePoints.length < 2) return null;

  let closest = null;
  let minDist = Infinity;

  const p = map.latLngToContainerPoint(latlng);

  for (let i = 0; i < state.routePoints.length - 1; i++) {
    const a = map.latLngToContainerPoint([
      state.routePoints[i].lat,
      state.routePoints[i].lon
    ]);

    const b = map.latLngToContainerPoint([
      state.routePoints[i + 1].lat,
      state.routePoints[i + 1].lon
    ]);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;

    if (length2 === 0) continue;

    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
    t = Math.max(0, Math.min(1, t));

    const projX = a.x + t * dx;
    const projY = a.y + t * dy;

    const dist = Math.hypot(p.x - projX, p.y - projY);

    if (dist < minDist) {
      minDist = dist;
      closest = {
        index: i,
        latlng: map.containerPointToLatLng([projX, projY])
      };
    }
  }

  return closest;
}

function isPointNearStop(routePoint, stop, thresholdMeters = 18) {
  return approxDistanceMeters(
    { lat: routePoint.lat, lon: routePoint.lon },
    { lat: stop.lat, lon: stop.lon }
  ) <= thresholdMeters;
}

function buildRoutingAnchorsFromCurrentRoute() {
  if (!state.routePoints.length) {
    return state.stops.map(stop => ({
      lat: stop.lat,
      lon: stop.lon,
      kind: "stop",
      refId: stop.id
    }));
  }

  const anchors = [];
  const usedStopIds = new Set();

  state.routePoints.forEach(point => {
    const matchedStop = state.stops.find(stop =>
      !usedStopIds.has(stop.id) && isPointNearStop(point, stop)
    );

    if (matchedStop) {
      anchors.push({
        lat: matchedStop.lat,
        lon: matchedStop.lon,
        kind: "stop",
        refId: matchedStop.id
      });
      usedStopIds.add(matchedStop.id);
      return;
    }

    if (point.sourceType === "manual") {
      anchors.push({
        lat: point.lat,
        lon: point.lon,
        kind: "manual",
        refId: point.id
      });
    }
  });

  state.stops.forEach(stop => {
    if (!usedStopIds.has(stop.id)) {
      anchors.push({
        lat: stop.lat,
        lon: stop.lon,
        kind: "stop",
        refId: stop.id
      });
    }
  });

  const deduped = [];
  anchors.forEach(anchor => {
    const prev = deduped[deduped.length - 1];
    if (!prev) {
      deduped.push(anchor);
      return;
    }

    const dist = approxDistanceMeters(
      { lat: prev.lat, lon: prev.lon },
      { lat: anchor.lat, lon: anchor.lon }
    );

    if (dist < 3) return;
    deduped.push(anchor);
  });

  return deduped;
}

// =========================
// ROUTE RENDER
// =========================

function refreshRouteLine() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  if (simplifiedPreviewLine) {
    map.removeLayer(simplifiedPreviewLine);
    simplifiedPreviewLine = null;
  }

  if (state.routePoints.length >= 2) {
    const originalCoords = state.routePoints.map(point => [point.lat, point.lon]);

    routeLine = L.polyline(originalCoords, {
      color: lineColorInput.value,
      weight: state.previewMode === "original" ? 5 : 3,
      opacity: state.previewMode === "original" ? 1 : 0.35
    }).addTo(map);
  }

  if (state.previewMode === "simplified" && state.simplifiedRoutePoints.length >= 2) {
    const simplifiedCoords = state.simplifiedRoutePoints.map(point => [point.lat, point.lon]);

    simplifiedPreviewLine = L.polyline(simplifiedCoords, {
      color: lineColorInput.value,
      weight: 6,
      opacity: 1
    }).addTo(map);
  }

  if (typeof updatePreviewButtons === "function") {
  updatePreviewButtons();
}
  updateStats();
  updateRouteStats();
}

// =========================
// ROUTE POINTS
// =========================

function removeAllRoutePointMarkers() {
  state.routePoints.forEach(point => {
    if (point.marker && map.hasLayer(point.marker)) {
      removeMarkerSafe(point.marker);
    }
  });

  state.routePoints = [];
  clearRouteMultiSelection();

  if (
    state.selected &&
    state.selected.type === "route"
  ) {
    state.selected = null;
  }
}

function createRoutePointObject(lat, lon, silent = false, sourceType = "manual") {
  const point = {
    id: "route_" + routePointIdCounter++,
    lat,
    lon,
    sourceType,
    marker: null
  };

  // Auto-Punkte bekommen bewusst KEINEN Marker
  if (sourceType === "auto") {
    state.routePoints.push(point);
    return point;
  }

  const safeRouteIcon = ICONS.route || createDivIcon("#f97316", "#7c2d12", 12);

  const marker = L.marker([point.lat, point.lon], {
    draggable: true,
    icon: safeRouteIcon
  }).addTo(map);

  marker.on("mousedown", function (e) {
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
    }
    beginRoutePointInteraction();
  });

  marker.on("click", function (e) {
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
      L.DomEvent.preventDefault(e.originalEvent);
    }

    beginRoutePointInteraction();

    const ctrlPressed = e.originalEvent && (e.originalEvent.ctrlKey || e.originalEvent.metaKey);

    if (ctrlPressed) {
      toggleRoutePointMultiSelection(point);
      return;
    }

    selectRoutePoint(point);
  });

  marker.on("dragstart", function (e) {
    beginRoutePointInteraction();

    const draggedId = point.id;

    if (state.selectedRoutePointIds.has(draggedId) && state.selectedRoutePointIds.size > 1) {
      const startPos = e.target.getLatLng();
      const selectedPoints = state.routePoints.filter(
        p => p.marker && state.selectedRoutePointIds.has(p.id)
      );

      state.groupDragContext = {
        draggedId,
        startLat: startPos.lat,
        startLng: startPos.lng,
        points: selectedPoints.map(p => ({
          id: p.id,
          point: p,
          lat: p.lat,
          lon: p.lon
        }))
      };
    } else {
      state.groupDragContext = null;
    }
  });

  marker.on("drag", function (e) {
    if (!state.groupDragContext) return;
    if (state.groupDragContext.draggedId !== point.id) return;

    const currentPos = e.target.getLatLng();
    const deltaLat = currentPos.lat - state.groupDragContext.startLat;
    const deltaLng = currentPos.lng - state.groupDragContext.startLng;

    state.groupDragContext.points.forEach(entry => {
      if (entry.id === point.id) return;

      const newLat = entry.lat + deltaLat;
      const newLng = entry.lon + deltaLng;

      entry.point.lat = newLat;
      entry.point.lon = newLng;

      if (entry.point.marker) {
        entry.point.marker.setLatLng([newLat, newLng]);
      }
    });

    refreshRouteLine();
  });

  marker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    point.lat = newPos.lat;
    point.lon = newPos.lng;

    if (state.groupDragContext && state.groupDragContext.draggedId === point.id) {
      const deltaLat = newPos.lat - state.groupDragContext.startLat;
      const deltaLng = newPos.lng - state.groupDragContext.startLng;

      state.groupDragContext.points.forEach(entry => {
        if (entry.id === point.id) return;

        entry.point.lat = entry.lat + deltaLat;
        entry.point.lon = entry.lon + deltaLng;
      });

      state.groupDragContext = null;

      if (
        state.selected &&
        state.selected.type === "route" &&
        state.selected.ref.id === point.id
      ) {
        routeLatInput.value = point.lat.toFixed(6);
        routeLonInput.value = point.lon.toFixed(6);
      }

      refreshRouteLine();
      endRoutePointInteraction();
      setStatus(`${state.selectedRoutePointIds.size} Routenpunkte gemeinsam verschoben.`);
      return;
    }

    if (state.selected && state.selected.type === "route" && state.selected.ref.id === point.id) {
      routeLatInput.value = point.lat.toFixed(6);
      routeLonInput.value = point.lon.toFixed(6);
    }

    refreshRouteLine();
    endRoutePointInteraction();

    if (!silent) {
      setStatus(`Routenpunkt verschoben: ${point.id}`);
    }
  });

  point.marker = marker;
  state.routePoints.push(point);
  return point;
}

function createManualRoutePoint(lat, lon) {
  if (!historyRestoreRunning) {
  pushHistorySnapshot("Manueller Routenpunkt");
  }
  switchToManualRouteMode();

  const point = createRoutePointObject(lat, lon, false, "manual");

  debug("Manueller Routenpunkt hinzugefügt", point.id, { lat, lon });

  refreshRouteLine();
  updateStats();
  selectRoutePoint(point);
  setStatus("Routenpunkt hinzugefügt.");
  updateStats();
  updateRouteStats();
}

function insertRoutePointOnSegment(latlng) {
  if (state.routePoints.length < 2) {
  if (!historyRestoreRunning) {
  pushHistorySnapshot("Routenpunkt auf Segment eingefügt");
  }
    setStatus("Zum Einfügen auf die Linie werden mindestens 2 Routenpunkte benötigt.", "warn");
    return;
  }

  const seg = findClosestSegment(latlng);

  if (!seg) {
    warn("Kein Segment gefunden");
    setStatus("Kein passendes Liniensegment gefunden.", "warn");
    return;
  }

  createRoutePointObject(seg.latlng.lat, seg.latlng.lng, true, "manual");

  const createdPoint = state.routePoints.pop();
  state.routePoints.splice(seg.index + 1, 0, createdPoint);

  refreshRouteLine();
  updateStats();
  selectRoutePoint(createdPoint);

  debug("Routenpunkt auf Segment eingefügt", {
    index: seg.index,
    lat: seg.latlng.lat,
    lon: seg.latlng.lng
  });

  setStatus("Routenpunkt auf Route eingefügt");
}

function deleteSelectedRoutePoint() {
  if (!historyRestoreRunning) {
  pushHistorySnapshot("Routenpunkt gelöscht");
  }
  if (state.selectedRoutePointIds && state.selectedRoutePointIds.size > 0) {
    const idsToDelete = new Set(state.selectedRoutePointIds);

    state.routePoints.forEach(point => {
  if (idsToDelete.has(point.id) && point.marker && map.hasLayer(point.marker)) {
    removeMarkerSafe(point.marker);
  }
});

    state.routePoints = state.routePoints.filter(point => !idsToDelete.has(point.id));

    if (
      state.selected &&
      state.selected.type === "route" &&
      idsToDelete.has(state.selected.ref.id)
    ) {
      state.selected = null;
    }

    clearRouteMultiSelection();
    updateStats();
    clearSelectionStyles();
    refreshRouteLine();

    noSelection.classList.remove("hidden");
    routeEditor.classList.add("hidden");
    stopEditor.classList.add("hidden");

    debug("Mehrere Routenpunkte gelöscht", {
      count: idsToDelete.size
    });

    setStatus(`${idsToDelete.size} Routenpunkt(e) gelöscht.`);
    return;
  }

  if (!state.selected || state.selected.type !== "route") return;

  const point = state.selected.ref;
  removeMarkerSafe(point.marker);

  state.routePoints = state.routePoints.filter(item => item.id !== point.id);
  state.selectedRoutePointIds.delete(point.id);

  clearSelection();
  updateStats();
  applyRoutePointIcons();
  refreshRouteLine();

  debug("Einzelner Routenpunkt gelöscht", point.id);
  setStatus("Routenpunkt gelöscht.");
}

// =========================
// ROUTE MODES / BUILD
// =========================

function rebuildAutoRouteFromStops() {
  removeAllRoutePointMarkers();

  if (state.stops.length < 2) {
    refreshRouteLine();
    updateStats();
    return;
  }

  state.stops.forEach(stop => {
    createRoutePointObject(stop.lat, stop.lon, true, "auto");
  });

  refreshRouteLine();
  updateStats();
}

function rebuildCurrentRouteFromStops() {
  if (state.routeMode === "street") {
    setStatus("Haltestellen-Reihenfolge geändert – bitte Straßenroute neu erzeugen.");
    return;
  }

  rebuildAutoRouteFromStops();
}

function maybeAutoBuildRoute() {
  if (state.routeMode !== "auto") return;

  if (state.stops.length >= 2) {
    rebuildAutoRouteFromStops();
    setStatus("Automatische Grundroute aus Haltestellen erstellt.");
  }
}

function switchToManualRouteMode() {
  if (state.routeMode === "manual") {
    setMode("route", "Manueller Routenmodus aktiv – zusätzliche Punkte können gesetzt werden.");
    return;
  }

  state.routeMode = "manual";
  updateStats();
  setMode("route", "Manueller Routenmodus aktiv – zusätzliche Punkte können gesetzt werden.");
}

// =========================
// CLEANUP / SMOOTH
// =========================

function cleanupRoutePoints(options = {}) {
  const minSpacingMeters = options.minSpacingMeters ?? 8;
  const straightenToleranceMeters = options.straightenToleranceMeters ?? 6;
  const keepEnds = options.keepEnds ?? true;

  if (state.routePoints.length < 3) {
    refreshRouteLine();
    updateStats();
    return 0;
  }

  const originalPoints = [...state.routePoints];
  const kept = [];
  let removedCount = 0;

  for (let i = 0; i < originalPoints.length; i++) {
    const point = originalPoints[i];
    const isFirst = i === 0;
    const isLast = i === originalPoints.length - 1;

    if (keepEnds && (isFirst || isLast)) {
      kept.push(point);
      continue;
    }

    const prev = kept[kept.length - 1];
    const next = originalPoints[i + 1];

    if (prev && approxDistanceMeters(prev, point) < minSpacingMeters) {
      removeMarkerSafe(point.marker);
      state.selectedRoutePointIds.delete(point.id);

      if (
        state.selected &&
        state.selected.type === "route" &&
        state.selected.ref.id === point.id
      ) {
        state.selected = null;
      }

      removedCount++;
      continue;
    }

    if (prev && next) {
      const deviation = pointToSegmentDistanceMeters(point, prev, next);

      if (deviation <= straightenToleranceMeters) {
        removeMarkerSafe(point.marker);
        state.selectedRoutePointIds.delete(point.id);

        if (
          state.selected &&
          state.selected.type === "route" &&
          state.selected.ref.id === point.id
        ) {
          state.selected = null;
        }

        removedCount++;
        continue;
      }
    }

    kept.push(point);
  }

  state.routePoints = kept;

  refreshRouteLine();
  updateStats();
  applyRoutePointIcons();

  if (!state.selected) {
    routeEditor.classList.add("hidden");
    noSelection.classList.remove("hidden");
  }

  return removedCount;
}

function autoCleanRouteAfterManualEdit() {
  const removed = cleanupRoutePoints({
    minSpacingMeters: 12,
    straightenToleranceMeters: 8,
    keepEnds: true
  });

  if (removed > 0) {
    setStatus(`Route automatisch begradigt (${removed} Punkt(e) entfernt).`);
  } else {
    refreshRouteLine();
    setStatus("Route aktualisiert.");
  }
}

function smoothRoute(options = {}) {
  const minSpacingMeters = options.minSpacingMeters ?? 4;
  const straightenToleranceMeters = options.straightenToleranceMeters ?? 2.5;
  const maxJoinDistanceMeters = options.maxJoinDistanceMeters ?? 20;
  const iterations = options.iterations ?? 1;
  const keepEnds = options.keepEnds ?? true;

  if (state.routePoints.length < 3) {
    setStatus("Zu wenige Routenpunkte zum Glätten.");
    return 0;
  }

  const previousMode = mode;
  const previousRouteMode = state.routeMode;

  let totalRemoved = 0;

  for (let round = 0; round < iterations; round++) {
    if (state.routePoints.length < 3) break;

    const original = [...state.routePoints];
    const kept = [];
    const idsToDelete = new Set();

    for (let i = 0; i < original.length; i++) {
      const point = original[i];
      const isFirst = i === 0;
      const isLast = i === original.length - 1;

      if (keepEnds && (isFirst || isLast)) {
        kept.push(point);
        continue;
      }

      const prev = kept[kept.length - 1];
      const next = original[i + 1];

      if (!prev || !next) {
        kept.push(point);
        continue;
      }

      const distPrevPoint = approxDistanceMeters(prev, point);
      const distPointNext = approxDistanceMeters(point, next);
      const distPrevNext = approxDistanceMeters(prev, next);
      const deviation = pointToSegmentDistanceMeters(point, prev, next);

      let removePoint = false;

      if (distPrevPoint < minSpacingMeters || distPointNext < minSpacingMeters) {
        removePoint = true;
      } else if (
        deviation <= straightenToleranceMeters &&
        distPrevNext <= maxJoinDistanceMeters
      ) {
        removePoint = true;
      }

      if (removePoint) {
        idsToDelete.add(point.id);
        continue;
      }

      kept.push(point);
    }

    if (!idsToDelete.size) {
      break;
    }

    original.forEach(point => {
      if (idsToDelete.has(point.id)) {
        removeMarkerSafe(point.marker);
      }
    });

    clearRouteSelectionIfDeleted(idsToDelete);
    state.routePoints = kept;
    totalRemoved += idsToDelete.size;
  }

  mode = previousMode;
  state.routeMode = previousRouteMode;

  refreshRouteLine();
  updateModeButtons();
  updateStats();
  applyRoutePointIcons();

  if (!state.selected || state.selected.type !== "route") {
    routeEditor.classList.add("hidden");
    noSelection.classList.remove("hidden");
  }

  return totalRemoved;
}

function smoothRouteWeak() {
  const removed = smoothRoute({
    minSpacingMeters: 3,
    straightenToleranceMeters: 1.8,
    maxJoinDistanceMeters: 12,
    iterations: 1,
    keepEnds: true
  });

  setStatus(
    removed > 0
      ? `Route weich geglättet (${removed} Punkt(e) entfernt).`
      : "Route weich geglättet – keine Punkte entfernt."
  );
}

function smoothRouteMedium() {
  const removed = smoothRoute({
    minSpacingMeters: 4,
    straightenToleranceMeters: 2.5,
    maxJoinDistanceMeters: 18,
    iterations: 1,
    keepEnds: true
  });

  setStatus(
    removed > 0
      ? `Route mittel geglättet (${removed} Punkt(e) entfernt).`
      : "Route mittel geglättet – keine Punkte entfernt."
  );
}

function smoothRouteStrong() {
  const removed = smoothRoute({
    minSpacingMeters: 6,
    straightenToleranceMeters: 4,
    maxJoinDistanceMeters: 26,
    iterations: 2,
    keepEnds: true
  });

  setStatus(
    removed > 0
      ? `Route stark geglättet (${removed} Punkt(e) entfernt).`
      : "Route stark geglättet – keine Punkte entfernt."
  );
}

function smoothRouteInteractive() {
  if (state.routePoints.length < 3) {
    if (!historyRestoreRunning) {
    pushHistorySnapshot("Route vereinfacht");
  }  
    setStatus("Zu wenige Routenpunkte zum Glätten.");
    return;
  }

  const input = prompt(
    "Route glätten:\n1 = weich\n2 = mittel\n3 = stark",
    "2"
  );

  if (input === null) {
    setStatus("Glätten abgebrochen.");
    return;
  }

  const value = String(input).trim();

  if (value === "1") {
    smoothRouteWeak();
    return;
  }

  if (value === "3") {
    smoothRouteStrong();
    return;
  }

  smoothRouteMedium();
}

// =========================
// SIMPLIFY
// =========================

function simplifyCurrentRoute() {
  if (state.routePoints.length < 3) {
      if (!historyRestoreRunning) {
    pushHistorySnapshot("Route vereinfacht");
  }
    setStatus("Zu wenige Routenpunkte zum Vereinfachen.");
    return;
  }

  const originalCount = state.routePoints.length;

  const input = prompt(
    "Vereinfachung wählen:\n1 = leicht\n2 = mittel\n3 = stark",
    "1"
  );

  if (input === null) {
    setStatus("Vereinfachen abgebrochen.");
    return;
  }

  let tolerance = 0.00003;

  if (String(input).trim() === "2") {
    tolerance = 0.00006;
  } else if (String(input).trim() === "3") {
    tolerance = 0.0001;
  }

  const simplified = douglasPeucker(
    state.routePoints.map(point => ({
      lat: point.lat,
      lon: point.lon
    })),
    tolerance
  );

  state.simplifiedRoutePoints = simplified;
  state.previewMode = "simplified";

  refreshRouteLine();
  updateStats();

  setStatus(
    `Vereinfachte Vorschau erstellt: ${originalCount} → ${state.simplifiedRoutePoints.length} Punkte. Originalroute bleibt erhalten.`
  );
}
function calculateRouteLengthMeters() {
  if (!state.routePoints || state.routePoints.length < 2) {
    return 0;
  }

  let total = 0;

  for (let i = 0; i < state.routePoints.length - 1; i++) {
    const a = state.routePoints[i];
    const b = state.routePoints[i + 1];

    total += approxDistanceMeters(a, b);
  }

  return total;
}

function finishSpecialTrack() {
  if (!historyRestoreRunning) {
    pushHistorySnapshot("Sondertrasse gespeichert");
  }

  const track = state.currentSpecialTrack;

  if (!track || !Array.isArray(track.points) || track.points.length < 2) {
    setStatus("Sondertrasse braucht mindestens 2 Punkte.", "warn");
    return;
  }

  const savedTrack = {
    id: track.id,
    fromStopId: track.fromStopId || null,
    fromStopName: track.fromStopName || null,
    toStopId: track.toStopId || null,
    toStopName: track.toStopName || null,
    points: track.points.map(p => [p[0], p[1]]),
    polyline: track.polyline
  };

  state.specialTracks.push(savedTrack);
  state.currentSpecialTrack = null;

  setMode("freeStop", `Sondertrasse gespeichert: ${savedTrack.fromStopName} → ${savedTrack.toStopName}`);
}

function addSpecialTrackPoint(latlng) {
  if (!historyRestoreRunning) {
    pushHistorySnapshot("Sondertrasse Punkt");
  }

  if (!state.currentSpecialTrack || !Array.isArray(state.currentSpecialTrack.points)) {
    setStatus("Keine aktive Sondertrasse vorbereitet.", "warn");
    return;
  }

  const track = state.currentSpecialTrack;

  track.points.push([latlng.lat, latlng.lng]);

  if (track.polyline && map.hasLayer(track.polyline)) {
    map.removeLayer(track.polyline);
  }

  track.polyline = L.polyline(track.points, {
    color: "#aa00ff",
    weight: 4,
    dashArray: "6,6"
  }).addTo(map);

  setStatus("Sondertrasse Punkt hinzugefügt");
}
  function startExtendSelectedSpecialTrack() {
  if (!state.selected || state.selected.type !== "specialTrack") {
    setStatus("Bitte zuerst eine Sondertrasse auswählen.", "warn");
    return;
  }

  mode = "specialTrackExtend";
  updateModeButtons();
  setStatus("Modus: Sondertrasse verlängern – Klick fügt hinten Punkte an.");
}

function extendSelectedSpecialTrack(latlng) {
  if (!state.selected || state.selected.type !== "specialTrack") {
    setStatus("Keine Sondertrasse ausgewählt.", "warn");
    return;
  }

  const track = state.selected.ref;

  if (!track || !Array.isArray(track.points)) {
    setStatus("Ungültige Sondertrasse.", "error");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Sondertrasse verlängert");
  }

  track.points.push([latlng.lat, latlng.lng]);

  if (track.polyline && map.hasLayer(track.polyline)) {
    map.removeLayer(track.polyline);
  }

  track.polyline = L.polyline(track.points, {
    color: "#ff00ff",
    weight: 6,
    dashArray: "6,6"
  }).addTo(map);

  track.polyline.on("click", function () {
    selectSpecialTrack(track);
  });

  debug("Sondertrasse verlängert", {
    trackId: track.id,
    points: track.points.length
  });

  setStatus("Sondertrasse verlängert.");
}

function removeLastPointFromSelectedSpecialTrack() {
  if (!state.selected || state.selected.type !== "specialTrack") {
    setStatus("Bitte zuerst eine Sondertrasse auswählen.", "warn");
    return;
  }

  const track = state.selected.ref;

  if (!track || !Array.isArray(track.points) || track.points.length === 0) {
    setStatus("Sondertrasse hat keine Punkte.", "warn");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Letzten Sondertrassenpunkt gelöscht");
  }

  track.points.pop();

  if (track.polyline && map.hasLayer(track.polyline)) {
    map.removeLayer(track.polyline);
  }

  if (track.points.length < 2) {
    state.specialTracks = state.specialTracks.filter(t => t.id !== track.id);
    clearSelection();
    setStatus("Sondertrasse gelöscht, weil zu kurz.");
    return;
  }

  track.polyline = L.polyline(track.points, {
    color: "#ff00ff",
    weight: 6,
    dashArray: "6,6"
  }).addTo(map);

  track.polyline.on("click", function () {
    selectSpecialTrack(track);
  });

  setStatus("Letzter Sondertrassenpunkt gelöscht.");
}

function startSpecialTrackBetweenSelectedStops() {
  const selectedStops = state.stops.filter(stop => state.selectedStopIds.has(stop.id));

  const fromStop = selectedStops[0] || null;
  const toStop = selectedStops[1] || null;

  state.currentSpecialTrack = {
    id: "track_" + Date.now(),
    fromStopId: fromStop?.id || null,
    fromStopName: fromStop?.name || null,
    toStopId: toStop?.id || null,
    toStopName: toStop?.name || null,
    startedAtStopId: null,
    points: [],
    polyline: null
  };

  state.routeMode = "specialTrack";
  updateModeButtons();

  debug("Sondertrasse zwischen 2 Stops gestartet", {
    trackId: state.currentSpecialTrack.id,
    fromStopId: fromStop.id,
    fromStopName: fromStop.name,
    toStopId: toStop.id,
    toStopName: toStop.name
  });

  const label = (fromStop && toStop)
    ? `${fromStop.name} ↔ ${toStop.name}`
    : "freie Sondertrasse";
  setStatus(`Sondertrasse vorbereitet: ${label}. Jetzt Punkte setzen und danach "Trasse fertig" klicken.`);
}