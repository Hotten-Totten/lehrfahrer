// =========================
// EVENTS
// =========================

function notifyMapLibreEditorSelectionChanged() {
  const adapter = window.EditorMapAdapter;
  if (adapter && typeof adapter.syncEditorSelection === "function") {
    adapter.syncEditorSelection();
  }
}

function notifyMapLibreEditorSelectionGeometryChanged(featureType, objects) {
  const candidates = Array.isArray(objects) ? objects : [objects];
  const selected = state.selected;
  const selectedType = featureType === "stop"
    ? "stop"
    : (featureType === "routePoint" ? "route" : null);
  const selectedIds = featureType === "stop"
    ? state.selectedStopIds
    : (featureType === "routePoint" ? state.selectedRoutePointIds : null);
  const helperTypes = new Set(["detourReplacementStop", "detourManualRoutePoint"]);
  const isSelected = candidates.some(object => {
    if (!object || object.id == null) return false;
    const id = String(object.id);
    if (
      selected &&
      selected.ref &&
      selected.ref.id != null &&
      String(selected.ref.id) === id &&
      (selectedType ? selected.type === selectedType : helperTypes.has(selected.type))
    ) {
      return true;
    }
    return selectedIds instanceof Set && Array.from(selectedIds).some(selectedId => String(selectedId) === id);
  });

  if (isSelected) notifyMapLibreEditorSelectionChanged();
  return isSelected;
}

function getEditorSelectionSyncSignature() {
  const selected = state.selected;
  const normalizeIds = value => value instanceof Set
    ? Array.from(value, id => String(id)).sort()
    : [];
  return JSON.stringify({
    type: selected ? selected.type : null,
    id: selected && selected.ref && selected.ref.id != null ? String(selected.ref.id) : null,
    stopIds: normalizeIds(state.selectedStopIds),
    routePointIds: normalizeIds(state.selectedRoutePointIds)
  });
}

function withMapLibreSelectionSync(selectionFunction) {
  return function mapLibreSelectionSynchronized(...args) {
    const before = getEditorSelectionSyncSignature();
    const result = selectionFunction.apply(this, args);
    if (getEditorSelectionSyncSignature() !== before) {
      notifyMapLibreEditorSelectionChanged();
    }
    return result;
  };
}

selectStop = withMapLibreSelectionSync(selectStop);
selectRoutePoint = withMapLibreSelectionSync(selectRoutePoint);
selectSpecialTrack = withMapLibreSelectionSync(selectSpecialTrack);
setDetourHelperSelectionState = withMapLibreSelectionSync(setDetourHelperSelectionState);
clearDetourHelperSelectionState = withMapLibreSelectionSync(clearDetourHelperSelectionState);
toggleRoutePointMultiSelection = withMapLibreSelectionSync(toggleRoutePointMultiSelection);
clearRouteMultiSelection = withMapLibreSelectionSync(clearRouteMultiSelection);
clearRouteSelectionIfDeleted = withMapLibreSelectionSync(clearRouteSelectionIfDeleted);
clearEditorSelectionStateOnly = withMapLibreSelectionSync(clearEditorSelectionStateOnly);
finishBoxSelection = withMapLibreSelectionSync(finishBoxSelection);
clearSelection = withMapLibreSelectionSync(clearSelection);

function notifyMapLibreEditorGeometryChanged() {
  const adapter = window.EditorMapAdapter;
  if (adapter && typeof adapter.syncEditorTestLayers === "function") {
    adapter.syncEditorTestLayers();
  }
}

function withMapLibreGeometrySync(renderFunction) {
  return function mapLibreGeometrySynchronized(...args) {
    const result = renderFunction.apply(this, args);
    if (result && typeof result.then === "function") {
      return result.finally(notifyMapLibreEditorGeometryChanged);
    }
    notifyMapLibreEditorGeometryChanged();
    return result;
  };
}

refreshRouteLine = withMapLibreGeometrySync(refreshRouteLine);
renderStopOrderList = withMapLibreGeometrySync(renderStopOrderList);
refreshDetourDraftPreview = withMapLibreGeometrySync(refreshDetourDraftPreview);
cancelDetourDraft = withMapLibreGeometrySync(cancelDetourDraft);
renderDetourPlannedRoutePreview = withMapLibreGeometrySync(renderDetourPlannedRoutePreview);
removeDetourPlannedRoutePreviewLine = withMapLibreGeometrySync(removeDetourPlannedRoutePreviewLine);
refreshDetourRemovedRoutePreview = withMapLibreGeometrySync(refreshDetourRemovedRoutePreview);
clearDetourRemovedRoutePreview = withMapLibreGeometrySync(clearDetourRemovedRoutePreview);
finishSpecialTrack = withMapLibreGeometrySync(finishSpecialTrack);
addSpecialTrackPoint = withMapLibreGeometrySync(addSpecialTrackPoint);
extendSelectedSpecialTrack = withMapLibreGeometrySync(extendSelectedSpecialTrack);
removeLastPointFromSelectedSpecialTrack = withMapLibreGeometrySync(removeLastPointFromSelectedSpecialTrack);
startSpecialTrackBetweenSelectedStops = withMapLibreGeometrySync(startSpecialTrackBetweenSelectedStops);

// ---------- Buttons / Modals ----------

if (exportAutosaveBtn) exportAutosaveBtn.addEventListener("click", exportAutosaveFile);
//if (helpBtn) helpBtn.addEventListener("click", openHelpModal);
if (helpBtn) {helpBtn.addEventListener("click", openHelpModal);}
document.querySelectorAll("[data-help-document]").forEach(helpDocumentButton => {
  helpDocumentButton.addEventListener("click", function () {
    openHelpDocument(helpDocumentButton.dataset.helpDocument);
  });
});
if (helpCloseBtn) helpCloseBtn.addEventListener("click", closeHelpModal);

if (helpModal) {
  helpModal.addEventListener("click", e => {
    if (e.target === helpModal) closeHelpModal();
  });
}

if (lineBrowserCloseBtn) lineBrowserCloseBtn.addEventListener("click", closeLineBrowser);

if (lineBrowserModal) {
  lineBrowserModal.addEventListener("click", e => {
    if (e.target === lineBrowserModal) closeLineBrowser();
  });
}

if (debugToggleBtn) debugToggleBtn.addEventListener("click", toggleDebugPanel);
if (debugClearBtn) debugClearBtn.addEventListener("click", clearDebugPanel);
if (debugClearCacheBtn) debugClearCacheBtn.addEventListener("click", clearLehrfahrerCacheAndReload);

const quickNewBtn = document.getElementById("quickNewBtn");
if (quickNewBtn) {
  quickNewBtn.addEventListener("click", createNewLine);
}

if (undoBtn) undoBtn.addEventListener("click", undoHistory);
if (redoBtn) redoBtn.addEventListener("click", redoHistory);

// ---------- Modus ----------

if (modeFreeStopBtn) modeFreeStopBtn.addEventListener("click", () => setPlacementMode("freeStop", "Modus: Haltestellen setzen"));
if (modeRouteBtn) modeRouteBtn.addEventListener("click", switchToManualRouteMode);
if (modeSelectBtn) modeSelectBtn.addEventListener("click", () => setMode("select", "Modus: Auswählen"));
if (routingModeSelect) {
  routingModeSelect.addEventListener("change", () => {
    state.routingMode = normalizeEditorRoutingMode(routingModeSelect.value);
    updateStats();
    setStatus(`Routingmodus: ${routingModeText ? routingModeText.textContent : state.routingMode}`);
  });
}
if (preserveManualChainsInput) {
  preserveManualChainsInput.addEventListener("change", () => {
    state.preserveManualChains = preserveManualChainsInput.checked;
    updateStats();
    setStatus(`Fahrwegpunkte exakt halten: ${state.preserveManualChains ? "An" : "Aus"}`);
  });
}
if (lineDescriptionInput) {
  lineDescriptionInput.addEventListener("input", syncLineDescriptionFromInput);
  lineDescriptionInput.addEventListener("change", syncLineDescriptionFromInput);
}
if (validFromInput) {
  validFromInput.addEventListener("input", syncLineValidityFromInputs);
  validFromInput.addEventListener("change", syncLineValidityFromInputs);
}
if (validUntilInput) {
  validUntilInput.addEventListener("input", syncLineValidityFromInputs);
  validUntilInput.addEventListener("change", syncLineValidityFromInputs);
}
if (variantNameInput) {
  variantNameInput.addEventListener("input", syncVariantNameFromInput);
  variantNameInput.addEventListener("change", syncVariantNameFromInput);
}
if (variantCategoryInput) {
  variantCategoryInput.addEventListener("change", syncVariantCategoryFromInput);
}
if (startTrackBetweenStopsBtn) {
  startTrackBetweenStopsBtn.addEventListener("click", function () {
    setMode("specialTrack", "Modus: Sondertrasse zeichnen");
    startSpecialTrackBetweenSelectedStops();
  });
}
if (finishSpecialTrackBtn) {
  finishSpecialTrackBtn.addEventListener("click", async function () {
    if (!state.currentSpecialTrack) {
      setStatus("Keine aktive Sondertrasse vorhanden.", "warn");
      return;
    }
    if (!state.currentSpecialTrack.points || state.currentSpecialTrack.points.length < 2) {
      setStatus("Die Sondertrasse braucht mindestens 2 Punkte.", "warn");
      return;
    }
    finishSpecialTrack();
    await buildStreetRouteFromStops();
  });
}

if (startDetourWizardBtn) {
  startDetourWizardBtn.addEventListener("click", startDetourWizard);
}

if (acceptDetourRangeBtn) {
  acceptDetourRangeBtn.addEventListener("click", acceptDetourWizardAction);
}

if (detourRoutingModeSelect) {
  detourRoutingModeSelect.addEventListener("change", function () {
    setDetourWizardRoutingMode(detourRoutingModeSelect.value);
  });
}

if (detourManualInputModeSelect) {
  detourManualInputModeSelect.addEventListener("change", function () {
    setDetourWizardManualInputMode(detourManualInputModeSelect.value);
  });
}

if (cancelDetourWizardBtn) {
  cancelDetourWizardBtn.addEventListener("click", cancelDetourWizard);
}

// ---------- Routing ----------

if (buildStreetRouteBtn) {
  buildStreetRouteBtn.addEventListener("click", async () => {
    await buildStreetRouteFromStops();
  });
}

if (cancelRoutingBtn) {
  cancelRoutingBtn.addEventListener("click", () => {
    if (routingAbortController) routingAbortController.abort();
  });
}

if (rerouteSegmentBtn) {
  rerouteSegmentBtn.addEventListener("click", async () => {
    await rerouteSelectedSegment();
  });
}

if (startDetourDraftBtn) {
  startDetourDraftBtn.addEventListener("click", startDetourDraftFromSelectedRoutePoints);
}

if (finishDetourDraftBtn) {
  finishDetourDraftBtn.addEventListener("click", async () => {
    await finishDetourDraft();
  });
}

if (cancelDetourDraftBtn) {
  cancelDetourDraftBtn.addEventListener("click", cancelDetourDraft);
}

if (snapStopToRouteBtn) snapStopToRouteBtn.addEventListener("click", snapSelectedStopToRoute);
if (smoothRouteBtn) smoothRouteBtn.addEventListener("click", smoothRouteInteractive);
if (simplifyRouteBtn) simplifyRouteBtn.addEventListener("click", simplifyCurrentRoute);

if (autoMinutesBtn) {
  autoMinutesBtn.addEventListener("click", () => {
    const recalcAll = confirm(
      "Sollen alle Minuten neu berechnet werden?\n\nOK = alles überschreiben\nAbbrechen = manuelle Minuten beibehalten"
    );
    autoAssignStopMinutes(recalcAll);
  });
}

const quickAutoMinutesBtn = document.getElementById("quickAutoMinutesBtn");
if (quickAutoMinutesBtn) {
  quickAutoMinutesBtn.addEventListener("click", () => {
    const recalcAll = confirm(
      "Sollen alle Minuten neu berechnet werden?\n\nOK = alles überschreiben\nAbbrechen = manuelle Minuten beibehalten"
    );
    autoAssignStopMinutes(recalcAll);
  });
}

// ---------- Anzeige ----------

if (showOriginalRouteBtn) {
  showOriginalRouteBtn.addEventListener("click", () => {
    state.previewMode = "original";
    refreshRouteLine();
    setStatus("Originalroute angezeigt.");
  });
}

if (showSimplifiedRouteBtn) {
  showSimplifiedRouteBtn.addEventListener("click", () => {
    if (!state.simplifiedRoutePoints.length) {
      setStatus("Noch keine vereinfachte Route vorhanden.");
      return;
    }

    state.previewMode = "simplified";
    refreshRouteLine();
    setStatus("Vereinfachte Route angezeigt.");
  });
}

// ---------- Daten ----------

clearBtn.addEventListener("click", () => {
  if (!confirm("Wirklich alle Linien-Daten löschen?")) return;

  if (!historyRestoreRunning) pushHistorySnapshot("Alles gelöscht");

  clearEditorData();
  setStatus("Alle Linien-Daten gelöscht.");
});

saveLineBtn.addEventListener("click", saveLineToServer);
loadLineBtn.addEventListener("click", openLineBrowser);
exportBtn.addEventListener("click", exportJson);
exportGpxBtn.addEventListener("click", exportLineAsGpx);

createCityBtn.addEventListener("click", createCityOnServer);

loadAutosaveBtn.addEventListener("click", loadAutosave);

clearAutosaveBtn.addEventListener("click", () => {
  if (!confirm("Wirklich den gespeicherten Autosave löschen?")) return;
  clearAutosave();
});

// ---------- Stop Editor ----------

saveStopBtn.addEventListener("click", () => {
  if (!state.selected || state.selected.type !== "stop") return;

  const stop = state.selected.ref;

  if (!historyRestoreRunning) pushHistorySnapshot("Stop bearbeitet");

  stop.name = stopNameInput.value.trim() || stop.name;
  stop.note = stopNoteInput.value.trim();
  stop.isGhostPoint = !!stopGhostInput.checked;
  stop.isGhost = !!stopGhostInput.checked;

  if (stop.marker) {
    const isSelectedStop = state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id;
    stop.marker.setIcon(getLineStopIcon(stop, !!isSelectedStop));
  }

  stopSourceInput.value = stop.isGhostPoint
    ? "Ghostpunkt"
    : (stop.sourceType === "catalog" ? "Katalog-Haltestelle" : "Freie Haltestelle");

  updateStopMarkerTooltip(stop);
  renderStopOrderList();

  setStatus("Haltestelle gespeichert.");
});

deleteStopBtn.addEventListener("click", deleteSelectedStop);
deleteRoutePointBtn.addEventListener("click", deleteSelectedRoutePoint);

lineColorInput.addEventListener("input", refreshRouteLine);

// ---------- Suche ----------

stopSearchInput.addEventListener("input", () => performSearch(stopSearchInput.value));
stopSearchInput.addEventListener("focus", () => performSearch(stopSearchInput.value));

document.addEventListener("click", e => {
  const searchBox = document.querySelector(".search-group");
  if (searchBox && !searchBox.contains(e.target)) clearSearchResults();
});

// ---------- Tastatur ----------

document.addEventListener("keydown", e => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === "z") return undoHistory();
  if (ctrl && (e.key === "y" || (e.shiftKey && e.key === "Z"))) return redoHistory();

  if (e.key === "Escape") {
    clearRouteMultiSelection();
    applyRoutePointIcons();
    setStatus("Auswahl gelöscht.");
  }

  if (e.key === "Delete") {
    if (state.selected?.type === "specialTrack") {
      removeLastPointFromSelectedSpecialTrack();
      return;
    }
    deleteSelectedRoutePoint();
  }
});

// ---------- Kartenbewegung / Katalogmarker ----------

let lastCatalogZoom = map.getZoom();

map.on("zoomend", function () {
  const currentZoom = map.getZoom();

  if (currentZoom !== lastCatalogZoom) {
    lastCatalogZoom = currentZoom;
    updateCatalogMarkerVisibility();
  }
});

map.on("moveend", function () {
  if (map.getZoom() >= CATALOG_MIN_ZOOM) {
    updateCatalogMarkerVisibility();
  }
});

// ---------- Map ----------

function handleEditorPointPlacement(latlng, options = {}) {
  if (!latlng) return false;
  const mode = state.routeMode;

  if (mode === "detourBuildReplacement" || (state.detourWizard && state.detourWizard.phase === "buildReplacement")) {
    if (
      state.detourWizard &&
      (state.detourWizard.routingMode === "manual" || state.detourWizard.routingMode === "guidedStreet") &&
      state.detourWizard.manualInputMode !== "passThroughStop"
    ) {
      addDetourManualRoutePoint(latlng);
      return true;
    }
    addDetourReplacementFreeStop(latlng);
    return true;
  }

  if (mode === "specialTrack") {
    addSpecialTrackPoint(latlng);
    return true;
  }
  if (mode === "specialTrackExtend") {
    extendSelectedSpecialTrack(latlng);
    return true;
  }
  if (mode === "detourDraft") {
    addDetourDraftPoint(latlng);
    return true;
  }
  if (["detourSelectStops", "select"].includes(mode)) {
    return false;
  }

  const placementMode = state.placementMode === "route" ? "route" : "freeStop";
  if (placementMode === "freeStop") {
    createFreeStop(latlng.lat, latlng.lng);
    return true;
  }
  if (placementMode === "route") {
    if (options.insertOnRouteSegment) insertRoutePointOnSegment(latlng);
    else createManualRoutePoint(latlng.lat, latlng.lng);
    return true;
  }
  return false;
}

function deleteSelectedEditorPointObject() {
  const selected = state.selected;
  if (!selected || !selected.ref) return false;
  if (selected.type === "stop") {
    deleteSelectedStop();
    return true;
  }
  if (selected.type === "route") {
    deleteSelectedRoutePoint();
    return true;
  }
  if (selected.type === "detourReplacementStop") {
    removeDetourReplacementStop(selected.ref.id);
    return true;
  }
  if (selected.type === "detourManualRoutePoint") {
    removeDetourManualRoutePoint(selected.ref.id);
    return true;
  }
  if (selected.type === "specialTrack") {
    removeLastPointFromSelectedSpecialTrack();
    return true;
  }
  return false;
}

map.on("click", function (e) {
  if (state.routeMode === "detourSelectStops") {
    setStatus("Umleitungsbereich wählen: Bitte Haltestellen in der Liste auswählen.");
    return;
  }

  if (state.routeMode === "select") {
    clearSelection();
    setStatus("Auswahl aufgehoben.");
    return;
  }
  handleEditorPointPlacement(e.latlng);
});
// ---------- Menü ----------

document.querySelectorAll("[data-click-target]").forEach(menuItem => {
  menuItem.addEventListener("click", e => {
    e.preventDefault();

    const targetId = menuItem.dataset.clickTarget;
    if (!targetId) return;

    const targetEl = document.getElementById(targetId);

    if (!targetEl) {
      console.warn("[EDITOR] Menü-Ziel nicht gefunden:", targetId);
      setStatus(`Menü-Ziel nicht gefunden: ${targetId}`, "warn");
      return;
    }

    targetEl.click();
  });
});
