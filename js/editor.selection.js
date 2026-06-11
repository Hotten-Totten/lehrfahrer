// =========================
// SELECTION HELPERS
// =========================

function suppressMapClickShort() {
  state.suppressNextMapClick = true;
  setTimeout(() => {
    state.suppressNextMapClick = false;
  }, 120);
}

function beginRoutePointInteraction() {
  state.routePointInteractionActive = true;
  suppressMapClickShort();
}

function endRoutePointInteraction() {
  suppressMapClickShort();
  setTimeout(() => {
    state.routePointInteractionActive = false;
  }, 120);
}

function clearRouteMultiSelection() {
  state.selectedRoutePointIds.clear();
  state.groupDragContext = null;
}

function clearRouteSelectionIfDeleted(idsToDelete) {
  if (
    state.selected &&
    state.selected.type === "route" &&
    idsToDelete.has(state.selected.ref.id)
  ) {
    state.selected = null;
  }

  idsToDelete.forEach(id => {
    state.selectedRoutePointIds.delete(id);
  });
}

// =========================
// BOX SELECTION
// =========================

function getSelectionBounds(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y)
  };
}

function showSelectionBox(start, end) {
  const bounds = getSelectionBounds(start, end);

  selectionBox.style.left = bounds.left + "px";
  selectionBox.style.top = bounds.top + "px";
  selectionBox.style.width = Math.max(1, bounds.right - bounds.left) + "px";
  selectionBox.style.height = Math.max(1, bounds.bottom - bounds.top) + "px";
  selectionBox.classList.remove("hidden");
}

function hideSelectionBox() {
  selectionBox.classList.add("hidden");
}

function beginBoxSelection(pointerEvent) {
  const rect = mapWrapElement.getBoundingClientRect();

  const start = {
    x: pointerEvent.clientX - rect.left,
    y: pointerEvent.clientY - rect.top
  };

  state.boxSelection.active = true;
  state.boxSelection.start = start;
  state.boxSelection.end = start;

  map.dragging.disable();
  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";

  showSelectionBox(start, start);
}

function updateBoxSelection(pointerEvent) {
  if (!state.boxSelection.active) return;

  const rect = mapWrapElement.getBoundingClientRect();

  const end = {
    x: pointerEvent.clientX - rect.left,
    y: pointerEvent.clientY - rect.top
  };

  state.boxSelection.end = end;
  showSelectionBox(state.boxSelection.start, end);
}

function finishBoxSelection() {
  if (!state.boxSelection.active) return;

  const start = state.boxSelection.start;
  const end = state.boxSelection.end;

  state.boxSelection.active = false;
  hideSelectionBox();

  map.dragging.enable();
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";

  if (!start || !end) return;

  const bounds = getSelectionBounds(start, end);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;

  if (width < 6 || height < 6) {
    setStatus("Rahmen zu klein für Mehrfachauswahl.");
    state.boxSelection.start = null;
    state.boxSelection.end = null;
    return;
  }

  clearRouteMultiSelection();

  state.routePoints.forEach(point => {
    const p = map.latLngToContainerPoint([point.lat, point.lon]);

    const inside =
      p.x >= bounds.left &&
      p.x <= bounds.right &&
      p.y >= bounds.top &&
      p.y <= bounds.bottom;

    if (inside) {
      state.selectedRoutePointIds.add(point.id);
    }
  });

  applyRoutePointIcons();

  const count = state.selectedRoutePointIds.size;

  debug("Box-Auswahl abgeschlossen", {
    selectedCount: count,
    bounds
  });

  if (count > 0) {
    setStatus(`${count} Routenpunkte per Rahmen ausgewählt.`);
  } else {
    setStatus("Keine Routenpunkte im Rahmen gefunden.");
  }

  state.boxSelection.start = null;
  state.boxSelection.end = null;
}

function cancelBoxSelection() {
  state.boxSelection.active = false;
  state.boxSelection.start = null;
  state.boxSelection.end = null;

  map.dragging.enable();
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";

  hideSelectionBox();
}

// =========================
// ICON / STYLE HELPERS
// =========================

function applyRoutePointIcons() {
  state.routePoints.forEach(point => {
    if (!point.marker) return;

    const isManual = point.sourceType === "manual";

    const normalIcon = isManual
      ? (ICONS.routeManual || ICONS.route)
      : ICONS.route;

    const selectedIcon = isManual
      ? (ICONS.routeManualSelected || ICONS.routeSelected || ICONS.route)
      : (ICONS.routeSelected || ICONS.route);

    const multiIcon = isManual
      ? (ICONS.routeManualMulti || ICONS.routeMulti || ICONS.route)
      : (ICONS.routeMulti || ICONS.route);

    if (
      state.selected &&
      state.selected.type === "route" &&
      state.selected.ref.id === point.id
    ) {
      point.marker.setIcon(selectedIcon);
      return;
    }

    if (state.selectedRoutePointIds.has(point.id)) {
      point.marker.setIcon(multiIcon);
      return;
    }

    point.marker.setIcon(normalIcon);
  });
}

function clearSelectionStyles() {
  state.stops.forEach(stop => {
    if (stop.marker) {
      stop.marker.setIcon(getLineStopIcon(stop, false));
    }
  });

  applyRoutePointIcons();
}

// =========================
// SELECTION MAIN
// =========================

function clearSelection() {
  state.selected = null;
  clearSelectionStyles();
  stopEditor.classList.add("hidden");
  routeEditor.classList.add("hidden");
  noSelection.classList.remove("hidden");
}

function selectStop(stop) {
  state.selected = {
    type: "stop",
    ref: stop
  };

  clearSelectionStyles();
  stop.marker.setIcon(getLineStopIcon(stop, true));

  noSelection.classList.add("hidden");
  routeEditor.classList.add("hidden");
  stopEditor.classList.remove("hidden");

  stopNameInput.value = stop.name;
  stopMinuteInput.value = Number(stop.minuteFromStart || 0);
  stopNoteInput.value = stop.note;
  stopGhostInput.checked = !!stop.isGhostPoint;
  stopLatInput.value = stop.lat.toFixed(6);
  stopLonInput.value = stop.lon.toFixed(6);
  stopSourceInput.value = stop.isGhostPoint
    ? "Ghostpunkt"
    : (stop.sourceType === "catalog"
      ? "Katalog-Haltestelle"
      : "Freie Haltestelle");

  renderStopOrderList();
  setStatus(`Haltestelle ausgewählt: ${stop.name}`);
}

function selectRoutePoint(point) {
  state.selected = {
    type: "route",
    ref: point
  };

  clearSelectionStyles();

  if (point.marker) {
  const selectedIcon = point.sourceType === "manual"
    ? (ICONS.routeManualSelected || ICONS.routeSelected || ICONS.route)
    : (ICONS.routeSelected || ICONS.route);

  point.marker.setIcon(selectedIcon);
}

  noSelection.classList.add("hidden");
  stopEditor.classList.add("hidden");
  routeEditor.classList.remove("hidden");

  const typeLabels = {
    manual: "Manueller Pflichtpunkt",
    auto: "Auto / Luftlinie",
    street: "Straßenroute"
  };

  routeTypeInput.value = typeLabels[point.sourceType] || point.sourceType || "unbekannt";
  routeLatInput.value = point.lat.toFixed(6);
  routeLonInput.value = point.lon.toFixed(6);

  renderStopOrderList();
  setStatus(`Routenpunkt ausgewählt: ${point.id}`);
}

function toggleRoutePointMultiSelection(point) {
  if (state.selectedRoutePointIds.has(point.id)) {
    state.selectedRoutePointIds.delete(point.id);
  } else {
    state.selectedRoutePointIds.add(point.id);
  }

  applyRoutePointIcons();

  const count = state.selectedRoutePointIds.size;
  setStatus(
    count > 0
      ? `${count} Routenpunkte in Mehrfachauswahl.`
      : "Mehrfachauswahl leer."
  );
}