// =========================
// STOP HELPERS
// =========================

let detourReplacementStopIdCounter = 1;

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
  clearDetourReplacementStops();

  state.detourWizard = {
    phase: null,
    cutStopIds: [],
    cutStartIndex: null,
    cutEndIndex: null,
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
      replacementStops: []
    };
  }

  if (!Array.isArray(state.detourWizard.replacementStops)) {
    state.detourWizard.replacementStops = [];
  }

  return state.detourWizard.replacementStops;
}

function getDetourReplacementStopIcon(stop, selected = false) {
  if (stop && stop.isGhostPoint) {
    return createStopBadgeIcon(selected ? "#475569" : "#64748b", selected ? "#0f172a" : "#334155", selected ? 22 : 18, "G");
  }

  return createStopBadgeIcon(selected ? "#7c3aed" : "#8b5cf6", selected ? "#4c1d95" : "#6d28d9", selected ? 22 : 18, "E");
}

function createDetourReplacementStop({ name, lat, lon, sourceType, catalogId = null, transitType = null, directionHint = null, isGhostPoint = false }) {
  if (!isDetourWizardBuildPhase()) {
    setStatus("Ersatzpunkte koennen erst nach der Bereichsauswahl gesetzt werden.", "warn");
    return null;
  }

  const replacementStops = ensureDetourReplacementStops();
  const stop = {
    id: "detour_replacement_" + detourReplacementStopIdCounter++,
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
    setStatus(`Ersatzpunkt ausgewaehlt: ${stop.name}`);
  });

  marker.on("dragend", function () {
    const pos = marker.getLatLng();
    stop.lat = pos.lat;
    stop.lon = pos.lng;
    renderStopOrderList();
    setStatus(`Ersatzpunkt verschoben: ${stop.name}`);
  });

  stop.marker = marker;
  replacementStops.push(stop);
  state.selected = { type: "detourReplacementStop", ref: stop };

  renderStopOrderList();
  updateModeButtons();
  setStatus(`Ersatzpunkt hinzugefuegt: ${stop.name}`);

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
    name: catalogStop.name || "Katalog-Ersatzpunkt",
    lat: catalogStop.lat,
    lon: catalogStop.lon,
    sourceType: "catalog",
    catalogId: catalogStop.id || null,
    transitType: catalogStop.type || null,
    directionHint: catalogStop.directionHint || catalogStop.direction || ""
  });
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

  renderStopOrderList();
  setStatus("Ersatzpunkt entfernt.");
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

async function buildDetourReplacementRouteCoords(anchors) {
  const combined = [];

  for (let i = 0; i < anchors.length - 1; i++) {
    const fromStop = anchors[i];
    const toStop = anchors[i + 1];
    const segmentCoords = normalizeRoutingSegmentCoords(await fetchStreetSegment(fromStop, toStop));

    if (segmentCoords.length < 2) {
      throw new Error(`Kein Routing-Segment zwischen ${fromStop.name} und ${toStop.name}.`);
    }

    combined.push(...(i === 0 ? segmentCoords : segmentCoords.slice(1)));
  }

  return combined;
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
    return { ok: false, message: "Bitte mindestens einen Ersatzpunkt setzen." };
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

  const anchors = [context.beforeStop, ...context.tempReplacementStops, context.afterStop];

  let routedCoords;
  try {
    setStatus("Umleitung wird berechnet...");
    routedCoords = await buildDetourReplacementRouteCoords(anchors);
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

  const replacementStops = context.tempReplacementStops.map(cloneDetourReplacementAsLineStop);
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
  innerCoords.forEach(coord => {
    createRoutePointObject(coord[1], coord[0], true, "street");
    const createdPoint = state.routePoints.pop();
    state.routePoints.splice(insertIndex, 0, createdPoint);
    insertIndex++;
  });

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
  setStatus("Umleitung uebernommen");
}

async function acceptDetourWizardAction() {
  if (isDetourWizardBuildPhase()) {
    await finishDetourWizardReplacement();
    return;
  }

  acceptDetourStopRange();
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
  setStatus("Umleitungsbereich wählen: Haltestellen in der Liste auswählen.");
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

function addStopToLine({ name, lat, lon, sourceType, catalogId = null, transitType = null, directionHint = null, isGhostPoint = false }) {
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

    if (isSelectedInList || isCurrentSelection) {
      item.classList.add("active");
    }
    if (isDetourCutStop(stop)) {
      item.classList.add("detour-cut-stop");
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
    const ghostSuffix = stop.isGhostPoint ? " [Ghost]" : "";
    name.textContent = `${stop.name}${ghostSuffix}`;

    main.appendChild(indexValue);
    main.appendChild(ghostToggle);
    main.appendChild(name);

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
}

function renderDetourReplacementStops() {
  if (!state.detourWizard || state.detourWizard.phase !== "buildReplacement") return;

  const replacementStops = Array.isArray(state.detourWizard.replacementStops)
    ? state.detourWizard.replacementStops
    : [];

  const section = document.createElement("div");
  section.className = "detour-replacement-section";

  const title = document.createElement("div");
  title.className = "detour-replacement-title";
  title.textContent = "Temporaere Ersatzpunkte";
  section.appendChild(title);

  if (!replacementStops.length) {
    const empty = document.createElement("div");
    empty.className = "detour-replacement-empty";
    empty.textContent = "Noch keine Ersatzpunkte gesetzt.";
    section.appendChild(empty);
    stopOrderList.appendChild(section);
    return;
  }

  replacementStops.forEach((stop, index) => {
    const isSelected = state.selected && state.selected.type === "detourReplacementStop" && state.selected.ref.id === stop.id;

    if (stop.marker && typeof getDetourReplacementStopIcon === "function") {
      stop.marker.setIcon(getDetourReplacementStopIcon(stop, isSelected));
    }

    const item = document.createElement("div");
    item.className = "detour-replacement-stop";
    if (isSelected) item.classList.add("active");
    if (stop.isGhostPoint) item.classList.add("detour-replacement-ghost");

    const main = document.createElement("div");
    main.className = "detour-replacement-main";

    const indexValue = document.createElement("span");
    indexValue.className = "stop-order-row-index";
    indexValue.textContent = `E${index + 1}.`;

    const name = document.createElement("span");
    name.className = "stop-order-row-name";
    name.textContent = stop.name;

    const source = document.createElement("span");
    source.className = "stop-order-row-index";
    source.textContent = stop.isGhostPoint
      ? "Durchfahrpunkt [Ghost]"
      : (stop.sourceType === "catalog" ? "Katalog" : "frei");

    main.appendChild(indexValue);
    main.appendChild(name);
    main.appendChild(source);

    main.addEventListener("click", function () {
      state.selected = { type: "detourReplacementStop", ref: stop };
      if (stop.marker) {
        map.setView([stop.lat, stop.lon], 17);
      }
      renderStopOrderList();
      setStatus(`Ersatzpunkt ausgewaehlt: ${stop.name}`);
    });

    const actions = document.createElement("div");
    actions.className = "stop-order-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Entfernen";
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeDetourReplacementStop(stop.id);
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
