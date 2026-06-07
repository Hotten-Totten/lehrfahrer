// =========================
// GPX EXPORT
// Datei: /js/editor.main.js
// =========================

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeFilename(value) {
  return String(value || "linie")
    .trim()    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
}

function getGpxTrackPoints() {
  if (Array.isArray(state.simplifiedRoutePoints) && state.simplifiedRoutePoints.length > 1) {
    return state.simplifiedRoutePoints
      .filter(p => typeof p.lat === "number" && typeof p.lon === "number")
      .map(p => ({ lat: p.lat, lon: p.lon }));
  }

  if (Array.isArray(state.routePoints) && state.routePoints.length > 1) {
    return state.routePoints
      .filter(p => typeof p.lat === "number" && typeof p.lon === "number")
      .map(p => ({ lat: p.lat, lon: p.lon }));
  }

  if (Array.isArray(state.stops) && state.stops.length > 1) {
    return state.stops
      .filter(p => typeof p.lat === "number" && typeof p.lon === "number")
      .map(p => ({ lat: p.lat, lon: p.lon }));
  }

  return [];
}

function getGpxWaypoints() {
  if (!Array.isArray(state.stops) || !state.stops.length) return [];

  return state.stops
    .filter(stop => typeof stop.lat === "number" && typeof stop.lon === "number")
    .map((stop, index) => {
      const stopName = stop.name || `Haltestelle ${index + 1}`;

      const minute =
        stop.minuteFromStart ??
        stop.minute ??
        stop.minutesFromStart ??
        0;

      const minuteText = `SollMinute: ${minute}`;
      const infoText = stop.note ? ` | Info: ${stop.note}` : "";

      return {
  lat: stop.lat,
  lon: stop.lon,
  name: stopName,
  cmt: `SollMinute:${minute};Stop:${index + 1}`,
  desc: `Stopp ${index + 1} | SollMinute: ${minute}${infoText}`
};
    });
}

function buildGpxString() {
  const lineName = document.getElementById("lineName")?.value?.trim() || "Linie";
  const routeName = document.getElementById("routeName")?.value?.trim() || "";
  const directionName = document.getElementById("directionName")?.value?.trim() || "";
  const lineColor = document.getElementById("lineColor")?.value?.trim() || "#d32f2f";

  const titleParts = [lineName, routeName, directionName].filter(Boolean);
  const fullName = titleParts.length ? titleParts.join(" - ") : "Linie";

  const trackPoints = getGpxTrackPoints();
  const waypoints = getGpxWaypoints();

  if (trackPoints.length < 2) {
    throw new Error("Für den GPX-Export brauchst du mindestens 2 Routenpunkte.");
  }

const waypointXml = waypoints.map(wpt => `
  <wpt lat="${wpt.lat}" lon="${wpt.lon}">
    <name>${escapeXml(wpt.name)}</name>
    <cmt>${escapeXml(wpt.cmt || "")}</cmt>
    <desc>${escapeXml(wpt.desc || "")}</desc>
  </wpt>`).join("");

  const trackXml = trackPoints.map(pt => `
      <trkpt lat="${pt.lat}" lon="${pt.lon}"></trkpt>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lehrfahrer Linieneditor" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(fullName)}</name>
    <desc>${escapeXml(`Export aus dem Lehrfahrer Linieneditor | Farbe: ${lineColor}`)}</desc>
  </metadata>${waypointXml}
  <trk>
    <name>${escapeXml(fullName)}</name>
    <desc>${escapeXml("Route für Maps.me Offline-Nutzung")}</desc>
    <trkseg>${trackXml}
    </trkseg>
  </trk>
</gpx>`;
}

async function saveGpxToServer(filename, gpx, city, lineFolder) {
  const response = await fetch(`${API_BASE}/save_gpx.php`, {
    method: "POST",
    headers: withApiAuthHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      filename,
      gpx,
      city,
      lineFolder: lineFolder || ""
    })
  });

  const rawText = await response.text();

  let result;
  try {
    result = JSON.parse(rawText);
  } catch (err) {
    throw new Error("Server liefert kein gültiges JSON zurück: " + rawText);
  }

  if (!response.ok || !result.ok) {
    throw new Error(result.error || "GPX konnte nicht auf dem Server gespeichert werden.");
  }

  return result;
}

async function exportLineAsGpx() {
  try {
    const gpx = buildGpxString();

    const lineName = document.getElementById("lineName")?.value?.trim() || "Linie";
    const routeName = document.getElementById("routeName")?.value?.trim() || "";
    const directionName = document.getElementById("directionName")?.value?.trim() || "";
    const city = citySelect?.value?.trim() || "cottbus";

    const fileBase = (typeof buildLineFileBase === "function")
    ? buildLineFileBase()
    : sanitizeFilename([lineName, routeName, directionName].filter(Boolean).join("_") || "Linie");

    const fileName = `${fileBase}.gpx`;

    // Lokal herunterladen
    const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Zusätzlich auf Server speichern
    const serverResult = await saveGpxToServer(fileName, gpx, city);

    if (typeof setStatus === "function") {
      setStatus(`GPX exportiert und auf Server gespeichert: ${serverResult.filename}`);
    }
  } catch (error) {
    console.error("GPX-Export fehlgeschlagen:", error);

    if (typeof setStatus === "function") {
      setStatus(error.message || "GPX-Export fehlgeschlagen.");
    } else {
      alert(error.message || "GPX-Export fehlgeschlagen.");
    }
  }
}

// =========================
// CITY MANAGEMENT
// Datei: /js/editor.main.js
// =========================

function prettifyCityName(slug) {
  return String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function maskToken(token) {
  const t = String(token || "");
  if (t.length <= 6) return "***";
  return t.slice(0, 3) + "..." + t.slice(-3);
}

function askTextInput({ title, message, defaultValue = "", placeholder = "" }) {
  try {
    const native = prompt(
      (title ? title + "\n" : "") + (message || ""),
      defaultValue || ""
    );
    return Promise.resolve(native);
  } catch (_err) {
    return askTextInputModal({ title, message, defaultValue, placeholder });
  }
}

function askTextInputModal({ title, message, defaultValue = "", placeholder = "" }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "save-confirm-box";
    box.innerHTML = `
      <div class="save-confirm-header">
        <h3>${title || "Eingabe"}</h3>
      </div>
      <div class="save-confirm-body">
        <div class="save-confirm-row" style="display:block;border-bottom:none;padding-bottom:10px;">
          <div style="font-size:13px;color:#475569;margin-bottom:8px;">${message || ""}</div>
          <input id="promptFallbackInput" class="prompt-fallback-input" type="text" placeholder="${placeholder || ""}" />
        </div>
      </div>
      <div class="save-confirm-actions">
        <button type="button" class="save-confirm-btn-cancel" id="promptFallbackCancelBtn">Abbrechen</button>
        <button type="button" class="save-confirm-btn-ok" id="promptFallbackOkBtn">OK</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector("#promptFallbackInput");
    const okBtn = box.querySelector("#promptFallbackOkBtn");
    const cancelBtn = box.querySelector("#promptFallbackCancelBtn");

    input.value = defaultValue || "";
    input.focus();
    input.select();

    function cleanup(result) {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      input.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(result);
    }

    function onOk() { cleanup(input.value); }
    function onCancel() { cleanup(null); }
    function onOverlay(e) { if (e.target === overlay) cleanup(null); }
    function onKeyDown(e) {
      if (e.key === "Enter") cleanup(input.value);
      if (e.key === "Escape") cleanup(null);
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
    input.addEventListener("keydown", onKeyDown);
  });
}

function updateApiTokenStatusUI() {
  const el = document.getElementById("apiTokenStatus");
  if (!el) return;

  const token = getApiToken();
  const active = !!token;

  el.classList.toggle("token-status-on", active);
  el.classList.toggle("token-status-off", !active);
  el.textContent = active ? "API-Token: an" : "API-Token: aus";
  el.title = active
    ? `API-Token aktiv (${maskToken(token)})`
    : "Kein API-Token gespeichert";
}

async function setApiTokenViaPrompt() {
  const current = getApiToken();
  const input = await askTextInput({
    title: "API-Token setzen",
    message: "API-Token eingeben. Der Token wird nur lokal im Browser gespeichert.",
    defaultValue: current || "",
    placeholder: "z. B. mein-sicherer-token"
  });

  if (input === null) return;

  const token = String(input).trim();
  if (!token) {
    setStatus("Kein Token eingegeben. Aktion abgebrochen.", "warn");
    return;
  }

  const ok = setApiToken(token);
  if (!ok) {
    setStatus("API-Token konnte nicht gespeichert werden.", "error");
    return;
  }

  updateApiTokenStatusUI();
  setStatus(`API-Token gespeichert: ${maskToken(token)}`, "success");
}

function clearApiTokenViaPrompt() {
  if (!hasApiToken()) {
    setStatus("Kein API-Token gespeichert.", "warn");
    return;
  }

  const ok = confirm("Gespeicherten API-Token lokal löschen?");
  if (!ok) return;

  const deleted = clearApiToken();
  if (!deleted) {
    setStatus("API-Token konnte nicht gelöscht werden.", "error");
    return;
  }

  updateApiTokenStatusUI();
  setStatus("API-Token lokal gelöscht.", "success");
}

async function testApiWriteAuth() {
  try {
    const response = await fetch(`${API_BASE}/create_city.php`, {
      method: "POST",
      headers: withApiAuthHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({ city: "" })
    });

    const text = await response.text();
    let result = null;
    try { result = JSON.parse(text); } catch (_err) {}

    if (response.status === 403) {
      setStatus("Schreibzugriff gesperrt: Token fehlt oder ist ungültig.", "error");
      return;
    }

    if (response.status === 400 && result && result.ok === false) {
      setStatus("Schreibzugriff ok: Authentifizierung erfolgreich.", "success");
      return;
    }

    if (response.ok) {
      setStatus("API-Test erfolgreich.", "success");
      return;
    }

    setStatus("API-Test fehlgeschlagen (HTTP " + response.status + ").", "error");
  } catch (err) {
    setStatus("API-Test fehlgeschlagen: " + err.message, "error");
  }
}

async function loadCitiesFromServer(selectCity = "") {
  try {
    const response = await fetch(`${API_BASE}/list_cities.php?includeEmpty=1`, {
      cache: "no-store"
    });

    // Prüfe ob die Antwort erfolgreich ist
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Keine JSON-Antwort");
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || "Orte konnten nicht geladen werden.");
    }

    citySelect.innerHTML = "";

    const cities = Array.isArray(result.cities) ? result.cities : [];

    if (!cities.length) {
      throw new Error("Keine Orte gefunden");
    }

    cities.forEach(city => {
      const option = document.createElement("option");
      option.value = city;
      option.textContent = prettifyCityName(city);
      citySelect.appendChild(option);
    });

    if (selectCity && cities.includes(selectCity)) {
      citySelect.value = selectCity;
    }
  } catch (error) {
    console.warn("API nicht verfügbar, verwende Fallback:", error.message);
    
    // Fallback für lokalen Betrieb: Standard-Stadt verwenden
    citySelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "cottbus";
    option.textContent = "Cottbus";
    citySelect.appendChild(option);
    
    if (selectCity) {
      citySelect.value = selectCity;
    }
  }
}

async function createCityViaPrompt() {
  const name = await askTextInput({
    title: "Neuen Ort anlegen",
    message: "Ortsname eingeben (z. B. Senftenberg):",
    placeholder: "Senftenberg"
  });
  if (!name || !name.trim()) return;
  newCityInput.value = name.trim();
  await createCityOnServer();
}

async function createCityOnServer() {
  try {
    const cityName = newCityInput.value.trim();

    if (!cityName) {
      setStatus("Bitte einen neuen Ort eingeben.");
      return;
    }

    const response = await fetch(`${API_BASE}/create_city.php`, {
      method: "POST",
      headers: withApiAuthHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        city: cityName
      })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Ort konnte nicht angelegt werden.");
    }

    await loadCitiesFromServer(result.city);
    newCityInput.value = "";

    setStatus(`Ort angelegt: ${prettifyCityName(result.city)}`);
  } catch (error) {
    console.error("Ort anlegen fehlgeschlagen:", error);
    setStatus(error.message || "Ort konnte nicht angelegt werden.");
  }
}

function createNewLine() {
  const ok = confirm("Wirklich eine neue Linie erstellen?\n\nUngespeicherte Änderungen gehen dabei verloren.");

  if (!ok) return;

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Neue Linie erstellt");
  }

  clearEditorData();

  lineNameInput.value = "";
  routeNameInput.value = "";
  directionNameInput.value = "";
  lineColorInput.value = "#d32f2f";

  if (typeof stopSearchInput !== "undefined" && stopSearchInput) {
    stopSearchInput.value = "";
  }

  if (typeof clearSearchResults === "function") {
    clearSearchResults();
  }

  state.previewMode = "original";
  state.routeMode = "auto";

  clearSelection();
  clearRouteMultiSelection();

  map.setView([51.7600, 14.3300], 13);

  updateModeButtons();
  updatePreviewButtons();
  updateStats();
  renderStopOrderList();
  updateHistoryButtons();

  setMode("freeStop", "Neue Linie erstellt. Modus: Haltestelle");
  showLineInputFieldsForNewLine();
}

function setLineInputMenuVisible(visible) {
  const topbar = document.getElementById("topbar");
  if (!topbar) return;

  // Altlast aus vorheriger Implementierung entfernen (verhindert "auf und sofort wieder zu").
  document.body.classList.remove("input-menu-hidden");

  if (visible) {
    topbar.classList.remove("hidden");
    topbar.style.display = "flex";
    topbar.style.visibility = "visible";
    topbar.style.pointerEvents = "auto";
    topbar.querySelectorAll(".top-group").forEach(group => {
      group.classList.remove("hidden");
      group.style.display = "flex";
    });
    return;
  }

  topbar.classList.remove("topbar-attention");
  topbar.style.visibility = "hidden";
  topbar.style.pointerEvents = "none";
  topbar.style.display = "none";
}

function showLineInputFieldsForNewLine() {
  const topbar = document.getElementById("topbar");
  const menubar = document.getElementById("menubar");
  if (menubar) {
    menubar.classList.remove("hidden");
    menubar.style.display = "";
  }
  setLineInputMenuVisible(true);

  try {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    window.scrollTo(0, 0);
  }

  if (topbar) {
    topbar.classList.add("topbar-attention");
    topbar.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => topbar.classList.remove("topbar-attention"), 1400);
  }

  requestAnimationFrame(() => {
    if (lineNameInput) {
      lineNameInput.focus();
      lineNameInput.select();
    }
  });

  setStatus("Eingabemenü geöffnet: Bitte oben Linie/Route/Richtung eingeben.");
}

// =========================
// START
// =========================

initDebugPanel();
updateApiTokenStatusUI();

createCatalogMarkers();
updateCatalogMarkerVisibilityNow();

updateModeButtons();
updatePreviewButtons();
updateStats();
renderStopOrderList();
updateHistoryButtons();
loadCitiesFromServer();

startAutosaveLoop();
setStatus("Editor bereit.");
setLineInputMenuVisible(false);