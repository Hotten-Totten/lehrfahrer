// =========================
// STOP HELPERS
// =========================

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
  if (state.selectedStopIds.has(stop.id)) {
    state.selectedStopIds.delete(stop.id);
  } else {
    state.selectedStopIds.add(stop.id);
  }

  if (state.selectedStopIds.size > 2) {
    const ids = Array.from(state.selectedStopIds);
    state.selectedStopIds = new Set(ids.slice(ids.length - 2));
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

  if (selectedStops.length === 2) {
    setStatus(`2 Haltestellen ausgewählt: ${selectedStops[0].name} → ${selectedStops[1].name}`);
  } else {
    setStatus(`Haltestelle ausgewählt: ${stop.name} – neue Haltestellen werden darunter eingefügt.`);
  }
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

    const main = document.createElement("div");
    const ghostSuffix = stop.isGhostPoint ? " [Ghost]" : "";
    main.textContent = `${index + 1}. ${stop.name}${ghostSuffix}`;

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