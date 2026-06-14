// =========================
// EVENTS
// =========================

// ---------- Buttons / Modals ----------

if (exportAutosaveBtn) exportAutosaveBtn.addEventListener("click", exportAutosaveFile);
//if (helpBtn) helpBtn.addEventListener("click", openHelpModal);
if (helpBtn) {helpBtn.addEventListener("click", openHelpModal);}
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

if (modeFreeStopBtn) modeFreeStopBtn.addEventListener("click", () => setMode("freeStop", "Modus: Haltestelle"));
if (modeRouteBtn) modeRouteBtn.addEventListener("click", switchToManualRouteMode);
if (modeSelectBtn) modeSelectBtn.addEventListener("click", () => setMode("select", "Modus: Auswählen"));
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
  acceptDetourRangeBtn.addEventListener("click", acceptDetourStopRange);
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

map.on("click", function (e) {
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;
  const mode = state.routeMode;

  // =========================
  // SONDERTRASSE
  // =========================
  if (mode === "specialTrack") {
    addSpecialTrackPoint(e.latlng);
    return;
  }

  // =========================
  // TRASSE ERWEITERN
  // =========================
  if (mode === "specialTrackExtend") {
    extendSelectedSpecialTrack(e.latlng);
    return;
  }

  if (mode === "detourDraft") {
    addDetourDraftPoint(e.latlng);
    return;
  }

  if (mode === "detourBuildReplacement" || (state.detourWizard && state.detourWizard.phase === "buildReplacement")) {
    addDetourReplacementFreeStop(e.latlng);
    return;
  }

  if (mode === "detourSelectStops") {
    setStatus("Umleitungsbereich wählen: Bitte Haltestellen in der Liste auswählen.");
    return;
  }

  // =========================
  // NORMALE MODI
  // =========================
  if (mode === "freeStop") {
    createFreeStop(lat, lon);
    return;
  }

  if (mode === "route" || mode === "manual") {
  createManualRoutePoint(lat, lon);
  return;
}

  if (mode === "select") {
    clearSelection();
    setStatus("Auswahl aufgehoben.");
    return;
  }
});
// ---------- Menü ----------

document.querySelectorAll(".menu-item[data-click-target]").forEach(menuItem => {
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
