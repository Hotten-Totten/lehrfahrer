// =========================
// UI / STATUS / BUTTONS
// =========================
// UI-Updatefunktionen für Statuszeile, Statistiken und Button-Zustände.

// Setzt den Status-Text und spiegelt ihn optional im Debug-Log.
function setStatus(text, level = "info") {
  statusbar.textContent = text;

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
    route: "Route zeichnen",
    manual: "Route zeichnen (manuell)",
    select: "Auswählen",
    specialTrack: "Sondertrasse zeichnen",
    specialTrackExtend: "Sondertrasse erweitern"
  };

  currentModeText.textContent = modeLabels[currentMode] || currentMode || "-";

  if (typeof updateLineMetricsUI === "function") {
    updateLineMetricsUI();
  }
}

// Markiert Modus-Buttons passend zum aktuellen Bearbeitungsmodus.
function updateModeButtons() {
  const currentMode = state.routeMode;
  modeFreeStopBtn.classList.toggle("active", currentMode === "freeStop" || currentMode === "catalogStop");
  modeRouteBtn.classList.toggle("active", currentMode === "route" || currentMode === "manual");
  if (modeSelectBtn) modeSelectBtn.classList.toggle("active", currentMode === "select");

  const inSpecialTrack = currentMode === "specialTrack" || currentMode === "specialTrackExtend";
  if (startTrackBetweenStopsBtn) startTrackBetweenStopsBtn.style.display = inSpecialTrack ? "none" : "";
  if (finishSpecialTrackBtn) {
    finishSpecialTrackBtn.style.display = inSpecialTrack ? "block" : "none";
    finishSpecialTrackBtn.classList.toggle("active", inSpecialTrack);
  }

  updateStats();
}

// Wechselt den Editor-Modus inklusive optionaler Statusmeldung.
function setMode(newMode, statusText = "") {
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
function renderStopOrderList() {
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
}
