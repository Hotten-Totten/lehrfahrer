// =========================
// AUTOSAVE
// =========================
// Dieses Modul verwaltet das automatische Speichern im Browser (localStorage)
// Speichert den aktuellen Editor-Status regelmäßig, um Datenverlust zu vermeiden

// Erstellt das Datenset für den Autosave
// Enthält alle wichtigen Editor-Daten (Linienname, Stops, Routenpunkte, etc.)
function buildAutosaveData() {
  return {
    lineName: lineNameInput.value.trim(),
    routeName: routeNameInput.value.trim(),
    directionName: directionNameInput.value.trim(),
    color: lineColorInput.value,
    routeMode: state.detourWizard && state.detourWizard.phase ? "freeStop" : state.routeMode,
    previewMode: state.previewMode,

    stops: state.stops.map(stop => ({
      id: stop.id,
      catalogId: stop.catalogId,
      groupId: stop.groupId || null,
      platformCode: stop.platformCode || null,
      directionHint: stop.directionHint || null,
      side: stop.side || null,
      oppositeStopId: stop.oppositeStopId || null,
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      minuteFromStart: stop.minuteFromStart,
      minuteMode: stop.minuteMode || "auto",
      note: stop.note,
      sourceType: stop.sourceType,
      isGhostPoint: !!stop.isGhostPoint,
      isDetourReplacement: !!stop.isDetourReplacement,
      detourId: stop.detourId || null,
      detourRole: stop.detourRole || null,
      detourOriginalStopIds: Array.isArray(stop.detourOriginalStopIds) ? [...stop.detourOriginalStopIds] : [],
      detourOriginalStopNames: Array.isArray(stop.detourOriginalStopNames) ? [...stop.detourOriginalStopNames] : [],
      transitType: stop.transitType || null
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
          fromStopId: state.currentSpecialTrack.fromStopId || null,
          fromStopName: state.currentSpecialTrack.fromStopName || null,
          toStopId: state.currentSpecialTrack.toStopId || null,
          toStopName: state.currentSpecialTrack.toStopName || null,
          points: Array.isArray(state.currentSpecialTrack.points)
            ? state.currentSpecialTrack.points.map(p => [p[0], p[1]])
            : []
        }
      : null,

    savedAt: new Date().toISOString()
  };
}

// Speichert die aktuellen Daten im localStorage
// Wird automatisch im Intervall aufgerufen
function saveAutosave() {
  try {
    const data = buildAutosaveData();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));

    debug("Autosave gespeichert", {
      stops: data.stops.length,
      routePoints: data.routePoints.length,
      specialTracks: (data.specialTracks || []).length
    });
  } catch (err) {
    error("Autosave fehlgeschlagen", err);
  }
}

// Exportiert den Autosave als JSON-Datei zum Download
// Benutzer kann die Datei lokal speichern
function exportAutosaveFile() {
  const data = buildAutosaveData();
  const json = JSON.stringify(data, null, 2);

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "linie_autosave.json";

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);

  debug("Autosave-Datei exportiert");
}

// Löscht alle Editor-Daten (Stops, Routen, Marker) von der Karte
// Wird vor dem Laden einer neuen Linie oder beim Zurücksetzen aufgerufen
function clearEditorData() {
  // Alle Stop-Marker von der Karte entfernen
  if (Array.isArray(state.stops)) {
    state.stops.forEach(stop => {
      if (stop.marker) map.removeLayer(stop.marker);
    });
  }

  // Alle Sondertrassen-Polylines aus dem State entfernen
  if (Array.isArray(state.specialTracks)) {
    state.specialTracks.forEach(track => {
      if (track && track.polyline) map.removeLayer(track.polyline);
    });
  }

  // Aktive (noch nicht gespeicherte) Sondertrasse entfernen
  if (state.currentSpecialTrack && state.currentSpecialTrack.polyline) {
    map.removeLayer(state.currentSpecialTrack.polyline);
  }

  if (state.detourDraft && state.detourDraft.polyline) {
    map.removeLayer(state.detourDraft.polyline);
  }

  // Sicherheitsnetz: alle verbleibenden Polylines mit Sondertrassen-Farben von der Karte räumen
  map.eachLayer(function (layer) {
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      const opts = layer.options || {};
      if (opts.color === "#aa00ff" || opts.color === "#ff00ff") {
        map.removeLayer(layer);
      }
    }
  });

  if (typeof removeAllGuidePointMarkers === "function") {
    removeAllGuidePointMarkers();
  }

  if (typeof removeAllRoutePointMarkers === "function") {
    removeAllRoutePointMarkers();
  }

  state.stops = [];
  state.routePoints = [];
  state.simplifiedRoutePoints = [];
  state.specialTracks = [];
  state.currentSpecialTrack = null;
  state.detourDraft = null;
  if (typeof resetDetourWizardState === "function") {
    resetDetourWizardState();
  }
  state.selected = null;
  state.routeMode = "auto";
  state.previewMode = "original";

  if ("guidePoints" in state) {
    state.guidePoints = [];
  }

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  if (simplifiedPreviewLine) {
    map.removeLayer(simplifiedPreviewLine);
    simplifiedPreviewLine = null;
  }

  if (typeof clearSelection === "function") {
    clearSelection();
  }

  if (typeof clearRouteMultiSelection === "function") {
    clearRouteMultiSelection();
  }

  if (typeof updateStats === "function") {
    updateStats();
  }

  if (typeof renderStopOrderList === "function") {
    renderStopOrderList();
  }

  if (typeof refreshRouteLine === "function") {
    refreshRouteLine();
  }

  if (typeof updateModeButtons === "function") {
    updateModeButtons();
  }

  if (typeof updatePreviewButtons === "function") {
    updatePreviewButtons();
  }

  state.routeMode = "freeStop";
}

// Lädt die Autosave-Daten aus dem localStorage
// Stellt den vorherigen Editor-Status wieder her
function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);

    if (!raw) {
      setStatus("Kein Autosave vorhanden.", "warn");
      return;
    }

    if (!historyRestoreRunning) {
      pushHistorySnapshot("Autosave geladen");
    }

    const data = JSON.parse(raw);
    clearEditorData();

    lineNameInput.value      = String(data.lineName  || "").replace(/^Linie\s+/i,  "").trim();
    routeNameInput.value     = String(data.routeName  || "").replace(/^Route\s+/i,  "").trim();
    directionNameInput.value = data.directionName || "";
    lineColorInput.value = data.color || "#d32f2f";

    state.routeMode = data.routeMode || "auto";
    state.previewMode = data.previewMode || "original";

    let maxStopNum = 0;
    let maxRouteNum = 0;

    (data.stops || []).forEach(stopData => {
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

      stop.id = stopData.id;
      stop.groupId = stopData.groupId || stopData.catalogId || null;
      stop.platformCode = stopData.platformCode || null;
      stop.directionHint = stopData.directionHint || null;
      stop.side = stopData.side || null;
      stop.oppositeStopId = stopData.oppositeStopId || null;
      stop.minuteFromStart = Number(stopData.minuteFromStart || 0);
      stop.minuteMode = stopData.minuteMode || "auto";
      stop.note = stopData.note || "";
      stop.isGhostPoint = !!(stopData.isGhostPoint || stopData.isGhost);
      stop.isDetourReplacement = !!stopData.isDetourReplacement;
      stop.detourId = stopData.detourId || null;
      stop.detourRole = stopData.detourRole || null;
      stop.detourOriginalStopIds = Array.isArray(stopData.detourOriginalStopIds) ? [...stopData.detourOriginalStopIds] : [];
      stop.detourOriginalStopNames = Array.isArray(stopData.detourOriginalStopNames) ? [...stopData.detourOriginalStopNames] : [];
      updateStopMarkerTooltip(stop);

      const n = Number(String(stop.id).replace("stop_", ""));
      if (!Number.isNaN(n)) maxStopNum = Math.max(maxStopNum, n);
    });

    removeAllRoutePointMarkers();

    (data.routePoints || []).forEach(pointData => {
      const point = createRoutePointObject(
        pointData.lat,
        pointData.lon,
        true,
        pointData.sourceType || "manual"
      );

      point.id = pointData.id;

      const n = Number(String(point.id).replace("route_", ""));
      if (!Number.isNaN(n)) maxRouteNum = Math.max(maxRouteNum, n);
    });

    state.simplifiedRoutePoints = (data.simplifiedRoutePoints || []).map(point => ({
      lat: point.lat,
      lon: point.lon
    }));

    state.specialTracks = [];

    (data.specialTracks || []).forEach(trackData => {
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

      const track = {
        id: trackData.id,
        fromStopId: trackData.fromStopId || null,
        fromStopName: trackData.fromStopName || null,
        toStopId: trackData.toStopId || null,
        toStopName: trackData.toStopName || null,
        points,
        polyline
      };

      if (polyline) {
        polyline.on("click", function () {
          selectSpecialTrack(track);
        });
      }

      state.specialTracks.push(track);
    });

    if (data.currentSpecialTrack && Array.isArray(data.currentSpecialTrack.points)) {
      const currentPoints = data.currentSpecialTrack.points.map(p => [p[0], p[1]]);

      state.currentSpecialTrack = {
        id: data.currentSpecialTrack.id,
        fromStopId: data.currentSpecialTrack.fromStopId || null,
        fromStopName: data.currentSpecialTrack.fromStopName || null,
        toStopId: data.currentSpecialTrack.toStopId || null,
        toStopName: data.currentSpecialTrack.toStopName || null,
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

    stopIdCounter = Math.max(stopIdCounter, maxStopNum + 1);
    routePointIdCounter = Math.max(routePointIdCounter, maxRouteNum + 1);

    refreshRouteLine();
    updateModeButtons();
    updatePreviewButtons();
    updateStats();
    renderStopOrderList();
    clearSelection();

    debug("Autosave geladen", {
      stops: state.stops.length,
      routePoints: state.routePoints.length,
      specialTracks: state.specialTracks.length,
      savedAt: data.savedAt || null
    });

    setStatus("Autosave geladen.");
  } catch (err) {
    error("Autosave konnte nicht geladen werden", err);
    setStatus("Fehler beim Laden des Autosaves.", "error");
  }
}

// Löscht den Autosave aus dem localStorage
function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
  debug("Autosave gelöscht");
  setStatus("Autosave gelöscht.");
}

// Startet den automatischen Speicher-Intervall
// Speichert alle AUTOSAVE_INTERVAL_MS Millisekunden
function startAutosaveLoop() {
  setInterval(function () {
    saveAutosave();
  }, AUTOSAVE_INTERVAL_MS);
}
