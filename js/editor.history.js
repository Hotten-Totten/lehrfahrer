// =========================
// HISTORY / UNDO / REDO
// =========================
// Snapshot-basiertes Undo/Redo für den kompletten Editor-Zustand.

const HISTORY_LIMIT = 50;
let historyRestoreRunning = false;

// Erstellt einen serialisierbaren Snapshot des aktuellen Editor-Zustands.
function buildHistorySnapshot() {
  return {
    lineName: lineNameInput.value.trim(),
    routeName: routeNameInput.value.trim(),
    variantName: getVariantName(routeNameInput.value.trim(), directionNameInput.value.trim()),
    variantCategory: getVariantCategory(),
    directionName: directionNameInput.value.trim(),
    description: getLineDescription(),
    color: lineColorInput.value,
    routeMode: state.routeMode,
    placementMode: normalizeEditorPlacementMode(state.placementMode, state.routeMode),
    routingMode: normalizeEditorRoutingMode(state.routingMode),
    preserveManualChains: !!state.preserveManualChains,
    previewMode: state.previewMode,

    stops: state.stops.map(stop => ({
      id: stop.id,
      catalogId: stop.catalogId,
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      minuteFromStart: stop.minuteFromStart,
      note: stop.note,
      sourceType: stop.sourceType,
      isGhostPoint: !!stop.isGhostPoint,
      isDetourReplacement: !!stop.isDetourReplacement,
      detourId: stop.detourId || null,
      detourRole: stop.detourRole || null,
      detourOriginalStopIds: Array.isArray(stop.detourOriginalStopIds) ? [...stop.detourOriginalStopIds] : [],
      detourOriginalStopNames: Array.isArray(stop.detourOriginalStopNames) ? [...stop.detourOriginalStopNames] : [],
      transitType: stop.transitType || null,
      directionHint: stop.directionHint || null
    })),

    routePoints: state.routePoints.map(point => ({
      id: point.id,
      lat: point.lat,
      lon: point.lon,
      sourceType: point.sourceType || "manual"
    })),

    simplifiedRoutePoints: state.simplifiedRoutePoints.map(point => ({
      lat: point.lat,
      lon: point.lon
    })),

    specialTracks: (state.specialTracks || []).map(track => ({
  id: track.id,
  fromStopId: track.fromStopId || null,
  fromStopName: track.fromStopName || null,
  toStopId: track.toStopId || null,
  toStopName: track.toStopName || null,
  points: Array.isArray(track.points)
    ? track.points.map(p => [p[0], p[1]])
    : []
})),

    currentSpecialTrack: state.currentSpecialTrack
      ? {
          id: state.currentSpecialTrack.id,
          points: Array.isArray(state.currentSpecialTrack.points)
            ? state.currentSpecialTrack.points.map(p => [p[0], p[1]])
            : []
        }
      : null,

    stopIdCounter,
    routePointIdCounter
  };
}

// Stellt einen Snapshot wieder her und rendert UI/Karte neu.
function applyHistorySnapshot(snapshot) {
  historyRestoreRunning = true;

  try {
    clearEditorData();

    lineNameInput.value      = String(snapshot.lineName  || "").replace(/^Linie\s+/i,  "").trim();
    routeNameInput.value     = String(snapshot.routeName  || "").replace(/^Route\s+/i,  "").trim();
    directionNameInput.value = snapshot.directionName || "";
    setVariantName(snapshot.variantName || "", snapshot.routeName || "", snapshot.directionName || "");
    setVariantCategory(snapshot.variantCategory || "Standard");
    setLineDescription(snapshot.description || "");
    lineColorInput.value = snapshot.color || "#d32f2f";

    state.routeMode = snapshot.routeMode || "auto";
    state.placementMode = normalizeEditorPlacementMode(snapshot.placementMode, state.routeMode);
    state.routingMode = normalizeEditorRoutingMode(snapshot.routingMode);
    state.preserveManualChains = snapshot.preserveManualChains === undefined
      ? true
      : !!snapshot.preserveManualChains;
    state.previewMode = snapshot.previewMode || "original";

    (snapshot.stops || []).forEach(stopData => {
      const stop = addStopToLine({
        name: stopData.name,
        lat: stopData.lat,
        lon: stopData.lon,
        sourceType: stopData.sourceType || "free",
        catalogId: stopData.catalogId || null,
        transitType: stopData.transitType || stopData.type || null,
        directionHint: stopData.directionHint || stopData.direction || null,
        isGhostPoint: !!(stopData.isGhostPoint || stopData.isGhost),
        isDetourReplacement: !!stopData.isDetourReplacement,
        detourId: stopData.detourId || null,
        detourRole: stopData.detourRole || null,
        detourOriginalStopIds: Array.isArray(stopData.detourOriginalStopIds) ? stopData.detourOriginalStopIds : [],
        detourOriginalStopNames: Array.isArray(stopData.detourOriginalStopNames) ? stopData.detourOriginalStopNames : []
      });

      stop.id = stopData.id || stop.id;
      stop.minuteFromStart = Number(stopData.minuteFromStart || 0);
      stop.note = stopData.note || "";
      stop.isGhostPoint = !!(stopData.isGhostPoint || stopData.isGhost);
      stop.isDetourReplacement = !!stopData.isDetourReplacement;
      stop.detourId = stopData.detourId || null;
      stop.detourRole = stopData.detourRole || null;
      stop.detourOriginalStopIds = Array.isArray(stopData.detourOriginalStopIds) ? [...stopData.detourOriginalStopIds] : [];
      stop.detourOriginalStopNames = Array.isArray(stopData.detourOriginalStopNames) ? [...stopData.detourOriginalStopNames] : [];
      updateStopMarkerTooltip(stop);
    });

    removeAllRoutePointMarkers();

    (snapshot.routePoints || []).forEach(pointData => {
      const point = createRoutePointObject(
        pointData.lat,
        pointData.lon,
        true,
        pointData.sourceType || "manual"
      );

      point.id = pointData.id || point.id;
    });

    state.simplifiedRoutePoints = (snapshot.simplifiedRoutePoints || []).map(point => ({
      lat: point.lat,
      lon: point.lon
    }));

    state.specialTracks = [];

    (snapshot.specialTracks || []).forEach(trackData => {
      const points = Array.isArray(trackData.points)
        ? trackData.points.map(p => [p[0], p[1]])
        : [];

      const polyline = points.length
        ? L.polyline(points, {
            color: "#aa00ff",
            weight: 4,
            dashArray: "6,6"
          }).addTo(map)
        : null;

      state.specialTracks.push({
  id: trackData.id,
  fromStopId: trackData.fromStopId || null,
  fromStopName: trackData.fromStopName || null,
  toStopId: trackData.toStopId || null,
  toStopName: trackData.toStopName || null,
  points,
  polyline
});
    });

    if (snapshot.currentSpecialTrack && Array.isArray(snapshot.currentSpecialTrack.points)) {
      const currentPoints = snapshot.currentSpecialTrack.points.map(p => [p[0], p[1]]);

      state.currentSpecialTrack = {
        id: snapshot.currentSpecialTrack.id,
        points: currentPoints,
        polyline: currentPoints.length
          ? L.polyline(currentPoints, {
              color: "#aa00ff",
              weight: 4,
              dashArray: "6,6"
            }).addTo(map)
          : null
      };
    } else {
      state.currentSpecialTrack = null;
    }

    stopIdCounter = snapshot.stopIdCounter || stopIdCounter;
    routePointIdCounter = snapshot.routePointIdCounter || routePointIdCounter;

    refreshRouteLine();
    updateModeButtons();
    updatePreviewButtons();
    updateStats();
    renderStopOrderList();
    clearSelection();
    updateHistoryButtons();
  } finally {
    historyRestoreRunning = false;
  }
}

// Speichert einen neuen Undo-Snapshot (Redo wird dabei zurückgesetzt).
function pushHistorySnapshot(label = "") {
  if (historyRestoreRunning) return;

  const snapshot = buildHistorySnapshot();
  state.historyUndo.push(snapshot);

  if (state.historyUndo.length > HISTORY_LIMIT) {
    state.historyUndo.shift();
  }

  state.historyRedo = [];
  updateHistoryButtons();

  if (DEBUG && label) {
    debug("History Snapshot gespeichert:", label);
  }
}

// Führt den letzten Undo-Schritt aus.
function undoHistory() {
  if (!state.historyUndo.length) {
    setStatus("Nichts zum Rückgängigmachen.", "warn");
    return;
  }

  const current = buildHistorySnapshot();
  const snapshot = state.historyUndo.pop();

  state.historyRedo.push(current);
  applyHistorySnapshot(snapshot);

  setStatus("Letzte Änderung rückgängig gemacht.");
}

// Führt den letzten Redo-Schritt aus.
function redoHistory() {
  if (!state.historyRedo.length) {
    setStatus("Nichts zum Wiederherstellen.", "warn");
    return;
  }

  const current = buildHistorySnapshot();
  const snapshot = state.historyRedo.pop();

  state.historyUndo.push(current);
  applyHistorySnapshot(snapshot);

  setStatus("Änderung wiederhergestellt.");
}

// Aktiviert/Deaktiviert Undo- und Redo-Buttons je nach Stack-Status.
function updateHistoryButtons() {
  if (undoBtn) {
    undoBtn.disabled = state.historyUndo.length === 0;
  }

  if (redoBtn) {
    redoBtn.disabled = state.historyRedo.length === 0;
  }
}
