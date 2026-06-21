// =========================
// UI / STATUS / BUTTONS
// =========================
// UI-Updatefunktionen für Statuszeile, Statistiken und Button-Zustände.

// Setzt den Status-Text und spiegelt ihn optional im Debug-Log.
function setStatus(text, level = "info") {
  statusbar.textContent = text;
  statusbar.classList.remove("status-detour-select", "status-detour-build");

  const detourPhase = state.detourWizard && state.detourWizard.phase;
  if (detourPhase === "selectStops") {
    statusbar.classList.add("status-detour-select");
  } else if (detourPhase === "buildReplacement") {
    statusbar.classList.add("status-detour-build");
  }

  if (level === "warn") {
    warn(text);
  } else if (level === "error") {
    error(text);
  } else {
    debug(text);
  }
}

function escapeInfoPopupHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function showInfoPopup({ title = "Hinweis", message = "", level = "info" } = {}) {
  const levels = {
    success: { color: "#15803d", icon: "&#10003;" },
    warning: { color: "#b45309", icon: "!" },
    error: { color: "#b91c1c", icon: "!" },
    info: { color: "#2563eb", icon: "i" }
  };
  const config = levels[level] || levels.info;

  const previous = document.getElementById("infoPopupOverlay");
  if (previous) previous.remove();

  const overlay = document.createElement("div");
  overlay.id = "infoPopupOverlay";
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "save-confirm-box";
  box.innerHTML = `
    <div class="save-confirm-header">
      <h3 style="display:flex;align-items:center;gap:10px;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${config.color};color:#fff;font-size:14px;font-weight:700;line-height:1;">${config.icon}</span>
        <span>${escapeInfoPopupHtml(title)}</span>
      </h3>
    </div>
    <div class="save-confirm-body">
      <div class="save-confirm-row" style="display:block;border-bottom:none;padding-bottom:6px;line-height:1.5;">
        ${escapeInfoPopupHtml(message)}
      </div>
    </div>
    <div class="save-confirm-actions">
      <button type="button" class="save-confirm-btn-ok" id="infoPopupOkBtn">OK</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const okBtn = box.querySelector("#infoPopupOkBtn");

  function cleanup() {
    okBtn.removeEventListener("click", onOk);
    overlay.removeEventListener("click", onOverlay);
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  }

  function onOk() { cleanup(); }
  function onOverlay(e) {
    if (e.target === overlay) cleanup();
  }
  function onKeyDown(e) {
    if (e.key === "Escape" || e.key === "Enter") cleanup();
  }

  okBtn.addEventListener("click", onOk);
  overlay.addEventListener("click", onOverlay);
  document.addEventListener("keydown", onKeyDown);
  okBtn.focus();
}

// Zeigt einen kurzen Toast nach dem Speichern an.
// info = { fileBase, city, stopCount, routePointCount, gpxSaved, pdfSaved, savedAt }
let _saveToastTimer = null;
function showSaveToast(info) {
  let toast = document.getElementById("saveToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "saveToast";
    document.body.appendChild(toast);
  }

  const time = info.savedAt
    ? new Date(info.savedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  const badges = ['<span class="toast-badge">JSON</span>'];
  if (info.gpxSaved) badges.push('<span class="toast-badge">GPX</span>');
  if (info.pdfSaved) badges.push('<span class="toast-badge">PDF</span>');

  toast.innerHTML =
    '<div class="toast-title">&#10003; Gespeichert</div>' +
    '<div class="toast-row"><span class="toast-label">Datei:</span> ' + (info.fileBase || "–") + '</div>' +
    '<div class="toast-row"><span class="toast-label">Ort:</span> ' + (info.city || "–") + '</div>' +
    '<div class="toast-row"><span class="toast-label">Haltestellen:</span> ' + (info.stopCount ?? "–") + ' &nbsp;|&nbsp; <span class="toast-label">Punkte:</span> ' + (info.routePointCount ?? "–") + '</div>' +
    '<div class="toast-row" style="margin-top:4px">' + badges.join('') + (time ? '<span style="opacity:.65;font-size:11px;margin-left:4px">' + time + '</span>' : '') + '</div>';

  // Animation
  toast.classList.remove("visible");
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));

  if (_saveToastTimer) clearTimeout(_saveToastTimer);
  _saveToastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 5000);
}

// Aktualisiert Distanz- und Zeitwerte in der Vorschau.
function updateRouteStats() {
  const meters = calculateRouteLengthMeters();
  const km = meters / 1000;

  const avgSpeed = 20; // später einstellbar
  const timeMinutes = km / avgSpeed * 60;

  if (routeLengthText) {
    routeLengthText.textContent = km.toFixed(2) + " km";
  }

  if (avgSpeedText) {
    avgSpeedText.textContent = avgSpeed + " km/h";
  }

  if (totalTimeText) {
    totalTimeText.textContent = Math.round(timeMinutes) + " min";
  }
}

// Aktualisiert Zähler und lesbaren Modus-Text.
function updateStats() {
  stopCount.textContent = state.stops.length;
  routePointCount.textContent = state.routePoints.length;
  catalogCount.textContent = stopCatalog.length;

  const currentMode = state.routeMode;

  const modeLabels = {
    catalogStop: "Haltestelle",
    freeStop: "Haltestelle",
    route: "Fahrwegpunkte setzen",
    manual: "Fahrwegpunkte setzen",
    select: "Auswählen",
    specialTrack: "Sondertrasse zeichnen",
    specialTrackExtend: "Sondertrasse erweitern",
    detourDraft: "Umleitung zeichnen",
    detourSelectStops: "Umleitung: Bereich wählen"
  };
  modeLabels.detourBuildReplacement = "Umleitung: Ersatz bauen";

  const placementMode = state.placementMode === "route" ? "route" : "freeStop";
  const showWorkflowMode = [
    "select",
    "specialTrack",
    "specialTrackExtend",
    "detourDraft",
    "detourSelectStops",
    "detourBuildReplacement"
  ].includes(currentMode);
  currentModeText.textContent = showWorkflowMode
    ? (modeLabels[currentMode] || currentMode || "-")
    : modeLabels[placementMode];

  const routingMode = normalizeEditorRoutingMode(state.routingMode);
  const routingModeLabels = {
    street: "Straßenrouting",
    guidedStreet: "Straßenrouting über Fahrwegpunkte",
    manual: "Punktführung (Expertenmodus)"
  };
  if (routingModeText) routingModeText.textContent = routingModeLabels[routingMode];
  if (routingModeSelect) routingModeSelect.value = routingMode;
  const preserveManualChains = !!state.preserveManualChains;
  const showPreserveManualChains = routingMode === "guidedStreet" && !(
    state.detourWizard && state.detourWizard.phase === "buildReplacement"
  );
  if (preserveManualChainsWrap) {
    preserveManualChainsWrap.style.display = showPreserveManualChains ? "inline-flex" : "none";
  }
  if (preserveManualChainsInput) preserveManualChainsInput.checked = preserveManualChains;
  if (preserveManualChainsPreviewRow) {
    preserveManualChainsPreviewRow.style.display = routingMode === "guidedStreet" ? "" : "none";
  }
  if (preserveManualChainsText) preserveManualChainsText.textContent = preserveManualChains ? "An" : "Aus";
  if (buildStreetRouteBtn) {
    buildStreetRouteBtn.textContent = routingMode === "guidedStreet"
      ? "Route über Fahrwegpunkte"
      : (routingMode === "manual" ? "Punktführung (Expertenmodus)" : "Straßenroute erzeugen");
  }

  if (typeof updateLineMetricsUI === "function") {
    updateLineMetricsUI();
  }
}

// Markiert Modus-Buttons passend zum aktuellen Bearbeitungsmodus.
function updateModeButtons() {
  const currentMode = state.routeMode;
  const placementMode = state.placementMode === "route" ? "route" : "freeStop";
  const stopPlacementActive = placementMode === "freeStop";
  const routePlacementActive = placementMode === "route";
  modeFreeStopBtn.classList.toggle("active", stopPlacementActive);
  modeRouteBtn.classList.toggle("active", routePlacementActive);
  modeFreeStopBtn.setAttribute("aria-pressed", String(stopPlacementActive));
  modeRouteBtn.setAttribute("aria-pressed", String(routePlacementActive));
  if (modeSelectBtn) modeSelectBtn.classList.toggle("active", currentMode === "select");

  const inSpecialTrack = currentMode === "specialTrack" || currentMode === "specialTrackExtend";
  const inDetourDraft = currentMode === "detourDraft";
  const detourPhase = state.detourWizard && state.detourWizard.phase;
  const inDetourSelect = detourPhase === "selectStops";
  const inDetourBuild = detourPhase === "buildReplacement";
  const inDetourWizard = inDetourSelect || inDetourBuild;
  if (startTrackBetweenStopsBtn) startTrackBetweenStopsBtn.style.display = (inSpecialTrack || inDetourDraft || inDetourWizard) ? "none" : "";
  if (finishSpecialTrackBtn) {
    finishSpecialTrackBtn.style.display = inSpecialTrack ? "block" : "none";
    finishSpecialTrackBtn.classList.toggle("active", inSpecialTrack);
  }
  if (startDetourWizardBtn) {
    startDetourWizardBtn.style.display = (inSpecialTrack || inDetourDraft || inDetourWizard) ? "none" : "";
    startDetourWizardBtn.classList.toggle("active", inDetourWizard);
    startDetourWizardBtn.classList.toggle("detour-phase-select", inDetourSelect);
    startDetourWizardBtn.classList.toggle("detour-phase-build", inDetourBuild);
  }
  if (acceptDetourRangeBtn) {
    acceptDetourRangeBtn.style.display = inDetourWizard ? "block" : "none";
    acceptDetourRangeBtn.textContent = inDetourBuild ? "Umleitung uebernehmen" : "Bereich uebernehmen";
    acceptDetourRangeBtn.title = inDetourBuild
      ? "Temporaere Ersatzhaltestellen und Durchfahrpunkte final uebernehmen und den RoutePoint-Abschnitt neu berechnen."
      : "Ausgewaehlten zusammenhaengenden Haltestellenbereich fuer die Umleitung uebernehmen. Route und Haltestellen bleiben unveraendert.";
    acceptDetourRangeBtn.setAttribute("aria-label", inDetourBuild
      ? "Umleitung uebernehmen: Temporaere Ersatzhaltestellen und Durchfahrpunkte final uebernehmen und den RoutePoint-Abschnitt neu berechnen."
      : "Bereich uebernehmen: Ausgewaehlten zusammenhaengenden Haltestellenbereich fuer die Umleitung uebernehmen. Route und Haltestellen bleiben unveraendert.");
    acceptDetourRangeBtn.classList.toggle("active", inDetourWizard);
    acceptDetourRangeBtn.classList.toggle("detour-phase-select", inDetourSelect);
    acceptDetourRangeBtn.classList.toggle("detour-phase-build", inDetourBuild);
  }
  if (detourRoutingModeWrap) {
    detourRoutingModeWrap.style.display = inDetourBuild ? "inline-flex" : "none";
  }
  if (routingModeWrap) {
    routingModeWrap.style.display = inDetourBuild ? "none" : "inline-flex";
  }
  if (preserveManualChainsWrap && inDetourBuild) {
    preserveManualChainsWrap.style.display = "none";
  }
  if (detourRoutingModeSelect && state.detourWizard) {
    detourRoutingModeSelect.value = state.detourWizard.routingMode === "guidedStreet"
      ? "guidedStreet"
      : (state.detourWizard.routingMode === "manual" ? "manual" : "street");
  }
  if (detourManualInputModeWrap) {
    const showManualInputMode = inDetourBuild && state.detourWizard &&
      (state.detourWizard.routingMode === "manual" || state.detourWizard.routingMode === "guidedStreet");
    detourManualInputModeWrap.style.display = showManualInputMode ? "inline-flex" : "none";
  }
  if (detourManualInputModeSelect && state.detourWizard) {
    detourManualInputModeSelect.value = state.detourWizard.manualInputMode === "passThroughStop" ? "passThroughStop" : "guidePoint";
  }
  if (cancelDetourWizardBtn) {
    cancelDetourWizardBtn.style.display = inDetourWizard ? "block" : "none";
    cancelDetourWizardBtn.classList.toggle("detour-phase-select", inDetourSelect);
    cancelDetourWizardBtn.classList.toggle("detour-phase-build", inDetourBuild);
  }
  if (startDetourDraftBtn) startDetourDraftBtn.style.display = (inSpecialTrack || inDetourDraft || inDetourWizard) ? "none" : "";
  if (finishDetourDraftBtn) {
    finishDetourDraftBtn.style.display = inDetourDraft ? "block" : "none";
    finishDetourDraftBtn.classList.toggle("active", inDetourDraft);
  }
  if (cancelDetourDraftBtn) {
    cancelDetourDraftBtn.style.display = inDetourDraft ? "block" : "none";
    cancelDetourDraftBtn.classList.toggle("active", inDetourDraft);
  }

  updateStats();
}

// Wechselt den Editor-Modus inklusive optionaler Statusmeldung.
function setPlacementMode(newMode, statusText = "") {
  state.placementMode = newMode === "route" ? "route" : "freeStop";
  setMode(state.placementMode, statusText);
}

function setMode(newMode, statusText = "") {
  if (state.routeMode === "detourDraft" && newMode !== "detourDraft" && state.detourDraft && typeof cancelDetourDraft === "function") {
    cancelDetourDraft();
  }
  const isDetourWizardMode = newMode === "detourSelectStops" || newMode === "detourBuildReplacement";
  if (state.detourWizard && state.detourWizard.phase === "buildReplacement" && !isDetourWizardMode) {
    state.routeMode = "detourBuildReplacement";
    updateModeButtons();
    if (
      (state.detourWizard.routingMode === "manual" || state.detourWizard.routingMode === "guidedStreet") &&
      state.detourWizard.manualInputMode !== "passThroughStop"
    ) {
      setStatus("Umleitungs-Wizard bleibt aktiv: Kartenklick setzt Fahrwegpunkt.");
    } else {
      setStatus("Umleitungs-Wizard bleibt aktiv: Kartenklick setzt einen Durchfahrpunkt.");
    }
    return;
  }

  if (state.detourWizard && state.detourWizard.phase && !isDetourWizardMode && typeof cancelDetourWizard === "function") {
    cancelDetourWizard();
  }

  state.routeMode = newMode;

  updateModeButtons();

  if (statusText) {
    setStatus(statusText);
  }
}

// Schaltet die Buttons für Original-/vereinfachte Vorschau um.
function updatePreviewButtons() {
  showOriginalRouteBtn.classList.toggle("preview-active", state.previewMode === "original");
  showSimplifiedRouteBtn.classList.toggle("preview-active", state.previewMode === "simplified");
}

// Baut die Haltestellenreihenfolge in der Seitenleiste neu auf.
function renderStopOrderListInactiveDuplicate() {
  stopOrderList.innerHTML = "";

  if (!state.stops.length) {
    const empty = document.createElement("div");
    empty.textContent = "Noch keine Haltestellen in der Linie.";
    empty.style.color = "#666";
    empty.style.fontSize = "14px";
    stopOrderList.appendChild(empty);
    return;
  }

  state.stops.forEach((stop, index) => {
    const item = document.createElement("div");
    item.className = "stop-order-item";

    if (state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id) {
      item.classList.add("active");
    }

    if (typeof isDetourCutStop === "function" && isDetourCutStop(stop)) {
      item.classList.add("detour-cut-stop");
    }

    const main = document.createElement("div");
    main.className = "stop-order-main";

    const idx = document.createElement("div");
    idx.className = "stop-order-index";
    idx.textContent = `Position ${index + 1}`;

    const name = document.createElement("div");
    name.className = "stop-order-name";
    name.textContent = stop.name;
    name.title = "Doppelklick zum Umbenennen";

    name.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.value = stop.name;
      input.className = "stop-name-edit";
      name.replaceWith(input);
      input.focus();
      input.select();

      function commit() {
        const newName = input.value.trim();
        if (newName && newName !== stop.name) {
          if (!historyRestoreRunning) pushHistorySnapshot("Haltestelle umbenannt");
          stop.name = newName;
          if (stop.marker) {
            stop.marker.unbindTooltip();
            stop.marker.bindTooltip(newName, { permanent: true, direction: "top", offset: [0, -10] });
          }
        }
        renderStopOrderList();
      }

      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { input.blur(); }
        if (ev.key === "Escape") { input.value = stop.name; input.blur(); }
      });
    });

    const minute = document.createElement("div");
    minute.className = "stop-order-index";
    const modeSuffix = stop.minuteMode === "manual" ? " (manuell)" : "";
    minute.textContent = `ab Minute ${Number(stop.minuteFromStart || 0)}${modeSuffix}`;

    main.appendChild(idx);
    main.appendChild(name);
    main.appendChild(minute);

    main.addEventListener("click", function () {
      selectStop(stop);
      map.setView([stop.lat, stop.lon], 17);
    });

    const actions = document.createElement("div");
    actions.className = "stop-order-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      moveStopUp(index);
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = index === state.stops.length - 1;
    downBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      moveStopDown(index);
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);

    item.appendChild(main);
    item.appendChild(actions);

    stopOrderList.appendChild(item);
  });

  renderDetourReplacementStops();
}

function renderDetourReplacementStopsInactiveDuplicate() {
  if (!state.detourWizard || state.detourWizard.phase !== "buildReplacement") return;

  const replacementStops = Array.isArray(state.detourWizard.replacementStops)
    ? state.detourWizard.replacementStops
    : [];

  const section = document.createElement("div");
  section.className = "detour-replacement-section";

  const title = document.createElement("div");
  title.className = "detour-replacement-title";
  title.textContent = "Temporaere Durchfahrpunkte / Ersatzhaltestellen";
  section.appendChild(title);

  if (!replacementStops.length) {
    const empty = document.createElement("div");
    empty.className = "detour-replacement-empty";
    empty.textContent = "Noch keine Ersatzhaltestellen oder Durchfahrpunkte gesetzt.";
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

    const idx = document.createElement("div");
    idx.className = "stop-order-index";
    idx.textContent = `Ersatz ${index + 1}`;

    const name = document.createElement("div");
    name.className = "stop-order-name";
    name.textContent = stop.name;

    const source = document.createElement("div");
    source.className = "stop-order-index";
    source.textContent = stop.isGhostPoint
      ? "Ghostpunkt"
      : (stop.sourceType === "catalog" ? "Katalog-Ersatz" : "Freier Ersatz");

    main.appendChild(idx);
    main.appendChild(name);
    main.appendChild(source);

    main.addEventListener("click", function () {
      state.selected = { type: "detourReplacementStop", ref: stop };
      if (stop.marker) {
        map.setView([stop.lat, stop.lon], 17);
      }
      renderStopOrderList();
      setStatus(`${stop.isGhostPoint ? "Durchfahrpunkt" : "Ersatzhaltestelle"} ausgewaehlt: ${stop.name}`);
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
