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

async function saveGpxToServer(filename, gpx, city, lineFolder, categoryFolder) {
  const response = await fetch(`${API_BASE}/save_gpx.php`, {
    method: "POST",
    headers: withApiAuthHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      filename,
      gpx,
      city,
      lineFolder: lineFolder || "",
      categoryFolder: categoryFolder || ""
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

function setEditorVersionBadge(versionText) {
  const badge = document.getElementById("editorVersionBadge");
  const normalized = String(versionText || "").trim() || "unbekannt";
  if (badge) {
    badge.textContent = `Version: ${normalized}`;
    badge.title = `Aktuelle Editor-Version (${normalized})`;
  }
  if (document.body) {
    document.body.dataset.editorVersion = normalized;
  }
}

function compareVersionNumbers(a, b) {
  const parse = value => String(value || "")
    .replace(/^v/i, "")
    .split(".")
    .map(part => parseInt(part, 10))
    .filter(Number.isFinite);

  const va = parse(a);
  const vb = parse(b);
  const maxLen = Math.max(va.length, vb.length);

  for (let i = 0; i < maxLen; i++) {
    const na = va[i] || 0;
    const nb = vb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function loadEditorVersionBadge() {
  const fallback = document.body?.dataset?.editorVersion || "unbekannt";
  setEditorVersionBadge(fallback);

  try {
    const response = await fetch("VERSION", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const text = await response.text();
    const version = String(text || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);

    if (version && compareVersionNumbers(version, fallback) >= 0) {
      setEditorVersionBadge(version);
    }
  } catch (_err) {
    // Fallback bleibt aktiv, wenn VERSION lokal nicht geladen werden kann.
  }
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

function showConfirmDialog({
  title = "Bestätigung",
  message = "Bist du sicher?",
  okText = "OK",
  cancelText = "Abbrechen"
}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "save-confirm-box";
    box.innerHTML = `
      <div class="save-confirm-header">
        <h3>${title}</h3>
      </div>
      <div class="save-confirm-body">
        <div class="save-confirm-row" style="display:block;border-bottom:none;padding-bottom:6px;line-height:1.5;">
          ${message}
        </div>
      </div>
      <div class="save-confirm-actions">
        <button type="button" class="save-confirm-btn-cancel" id="inlineConfirmCancelBtn">${cancelText}</button>
        <button type="button" class="save-confirm-btn-ok" id="inlineConfirmOkBtn">${okText}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const okBtn = box.querySelector("#inlineConfirmOkBtn");
    const cancelBtn = box.querySelector("#inlineConfirmCancelBtn");

    function cleanup(result) {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(result);
    }

    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) {
      if (e.target === overlay) cleanup(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter") cleanup(true);
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
    document.addEventListener("keydown", onKeyDown);
    okBtn.focus();
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
    const apiErrorText = result && result.error ? String(result.error) : text;
    const serverTokenMissing = apiErrorText.includes("LEHRFAHRER_API_TOKEN fehlt");

    if (response.status === 403) {
      showInfoPopup({
        title: "Schreibzugriff gesperrt, Token überprüfen",
        message: "Der gespeicherte API-Token fehlt oder passt nicht zum Server.",
        level: "error"
      });

      if (serverTokenMissing) {
        setStatus("Server-Token fehlt: LEHRFAHRER_API_TOKEN ist nicht konfiguriert.", "error");
        showInfoPopup({
          title: "Server-Token fehlt",
          message: "Der Server hat keinen LEHRFAHRER_API_TOKEN gefunden. Bitte api/_secret.php auf dem Server prüfen.",
          level: "error"
        });
        return;
      }

      setStatus("Schreibzugriff gesperrt: Token fehlt oder ist ungültig.", "error");
      return;
    }

    if (response.status === 400 && result && result.ok === false) {
      setStatus("Schreibzugriff ok: Authentifizierung erfolgreich.", "success");
      showInfoPopup({
        title: "Schreibzugriff ok",
        message: "Der API-Token wurde akzeptiert. Schreibzugriffe sind authentifiziert.",
        level: "success"
      });
      return;
    }

    if (response.ok) {
      setStatus("API-Test erfolgreich.", "success");
      showInfoPopup({
        title: "Schreibzugriff ok",
        message: "Der API-Token wurde akzeptiert.",
        level: "success"
      });
      return;
    }

    setStatus("API-Test fehlgeschlagen (HTTP " + response.status + ").", "error");
    showInfoPopup({
      title: "API-Test fehlgeschlagen",
      message: "HTTP " + response.status + (apiErrorText ? ": " + apiErrorText : ""),
      level: "error"
    });
  } catch (err) {
    setStatus("API-Test fehlgeschlagen: " + err.message, "error");
    showInfoPopup({
      title: "API nicht erreichbar",
      message: "Der API-Test konnte nicht ausgeführt werden: " + err.message,
      level: "error"
    });
  }
}

async function loadCitiesFromServer(selectCity = "", { throwOnError = false } = {}) {
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
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Keine Orte vorhanden";
      citySelect.appendChild(option);
      citySelect.value = "";
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
    if (throwOnError) throw error;
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

  await loadCityDispatchPhoneSetting();
  updateCityManagementButtons();
}

function updateCityManagementButtons() {
  const hasCity = !!String(citySelect?.value || "").trim();
  if (renameCityBtn) renameCityBtn.disabled = !hasCity;
  if (deleteCityBtn) deleteCityBtn.disabled = !hasCity;
}

function cityOperationHasUnsavedEditorData() {
  const operational = getOperationalRouteFields();
  const validity = getLineValidity();
  return !!(
    state.stops.length ||
    state.routePoints.length ||
    String(lineNameInput?.value || "").trim() ||
    String(routeNameInput?.value || "").trim() ||
    String(directionNameInput?.value || "").trim() ||
    (getVariantName("", "") && getVariantName("", "") !== "Standard") ||
    getVariantCategory() !== "Standard" ||
    getLineDescription() ||
    validity.validFrom ||
    validity.validUntil ||
    operational.routeType !== "line" ||
    operational.operationalName ||
    operational.fromLabel ||
    operational.toLabel ||
    operational.relatedRouteIds.length ||
    operational.remark
  );
}

async function confirmCityOperationWithEditorData(actionLabel) {
  if (!cityOperationHasUnsavedEditorData()) return true;
  return showConfirmDialog({
    title: "Editorinhalt beachten",
    message: `Im Editor befinden sich geladene oder möglicherweise ungespeicherte Daten.<br><br>${actionLabel} trotzdem fortsetzen?`,
    okText: "Trotzdem fortsetzen",
    cancelText: "Abbrechen"
  });
}

async function requestCityManagement(payload) {
  const response = await fetch(`${API_BASE}/manage_city.php`, {
    method: "POST",
    headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  let result = null;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch (_error) {
    // Der HTTP-Status und ein kurzer Servertext bleiben auch bei HTML/PHP-Fehlern sichtbar.
  }
  if (!response.ok || !result || !result.ok) {
    const serverMessage = result && result.error
      ? String(result.error)
      : String(responseText || "Leere Serverantwort.").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(`HTTP ${response.status}: ${serverMessage || "Ortsverwaltung fehlgeschlagen."}`);
  }
  return result;
}

function showCityManagementError(actionLabel, error) {
  const message = error?.message || `${actionLabel} ist fehlgeschlagen.`;
  setStatus(message, "error");
  showInfoPopup({
    title: `${actionLabel} fehlgeschlagen`,
    message,
    level: "error"
  });
}

async function renameSelectedCity() {
  const city = String(citySelect?.value || "").trim();
  if (!city) {
    setStatus("Bitte zuerst einen Ort auswählen.", "warn");
    return;
  }
  if (!await confirmCityOperationWithEditorData("Ort umbenennen")) return;
  const enteredName = await askTextInput({
    title: "Ort umbenennen",
    message: `Neuen Namen für ${prettifyCityName(city)} eingeben:`,
    defaultValue: prettifyCityName(city),
    placeholder: "Neuer Ortsname"
  });
  if (enteredName === null) return;
  const newName = String(enteredName || "").trim();
  if (!newName) {
    setStatus("Der neue Ortsname darf nicht leer sein.", "warn");
    return;
  }
  try {
    renameCityBtn.disabled = true;
    deleteCityBtn.disabled = true;
    const result = await requestCityManagement({ action: "rename", oldName: city, newName });
    await loadCitiesFromServer(result.city, { throwOnError: true });
    const availableCities = Array.from(citySelect.options, option => option.value);
    if (citySelect.value !== result.city || availableCities.includes(city)) {
      throw new Error("HTTP 200: Die aktualisierte Ortsliste konnte nicht eindeutig übernommen werden.");
    }
    setStatus(`Ort umbenannt: ${prettifyCityName(city)} → ${prettifyCityName(result.city)}`, "success");
  } catch (error) {
    showCityManagementError("Ort umbenennen", error);
  } finally {
    updateCityManagementButtons();
  }
}

function buildCityDeleteMessage(city, analysis) {
  const hasData = Number(analysis.totalRouteCount || 0) > 0 || analysis.hasDispatchPhone || Number(analysis.additionalSettingCount || 0) > 0;
  if (!hasData) return `Ort „${escapeInfoPopupHtml(prettifyCityName(city))}“ wirklich löschen?<br><br>Der Ort enthält keine gespeicherten Routen.`;
  const lines = [
    `<strong>Ort „${escapeInfoPopupHtml(prettifyCityName(city))}“ wirklich löschen?</strong>`,
    "<br>Enthalten:",
    `- ${Number(analysis.normalLineCount || 0)} normale Linien`,
    `- ${Number(analysis.normalRouteCount || 0)} Routen/Varianten`,
    `- ${Number(analysis.operationalRouteCount || 0)} Betriebsfahrten`,
    analysis.hasDispatchPhone ? "- Leitstellennummer vorhanden" : "- keine Leitstellennummer"
  ];
  if (Number(analysis.additionalSettingCount || 0) > 0) lines.push(`- ${Number(analysis.additionalSettingCount)} weitere Einstellungen`);
  lines.push("<br><strong>Diese Daten werden ebenfalls gelöscht.</strong>");
  return lines.join("<br>");
}

function clearEditorAfterCityDeletion() {
  clearEditorData();
  lineNameInput.value = "";
  routeNameInput.value = "";
  directionNameInput.value = "";
  setVariantName("Standard");
  setVariantCategory("Standard");
  setLineDescription("");
  setOperationalRouteFields({ routeType: "line" });
  setLineValidity("", "");
  updateStats();
  renderStopOrderList();
}

async function deleteSelectedCity() {
  const city = String(citySelect?.value || "").trim();
  if (!city) {
    setStatus("Bitte zuerst einen Ort auswählen.", "warn");
    return;
  }
  if (!await confirmCityOperationWithEditorData("Ort löschen")) return;
  try {
    renameCityBtn.disabled = true;
    deleteCityBtn.disabled = true;
    const inspected = await requestCityManagement({ action: "analyze", city });
    const confirmed = await showConfirmDialog({
      title: "Ort löschen",
      message: buildCityDeleteMessage(city, inspected.analysis || {}),
      okText: "Ort und Daten löschen",
      cancelText: "Abbrechen"
    });
    if (!confirmed) return;
    const result = await requestCityManagement({ action: "delete", city, confirmed: true });
    clearEditorAfterCityDeletion();
    await loadCitiesFromServer(result.nextCity || "", { throwOnError: true });
    if (Array.from(citySelect.options, option => option.value).includes(city)) {
      throw new Error("HTTP 200: Der gelöschte Ort ist weiterhin in der Ortsliste vorhanden.");
    }
    setStatus(result.warning || `Ort gelöscht: ${prettifyCityName(city)}`, result.warning ? "warn" : "success");
  } catch (error) {
    showCityManagementError("Ort löschen", error);
  } finally {
    updateCityManagementButtons();
  }
}

async function loadCityDispatchPhoneSetting() {
  if (!cityDispatchPhoneInput || !saveCityDispatchPhoneBtn) return;

  const city = String(citySelect?.value || "").trim();
  cityDispatchPhoneInput.value = "";
  cityDispatchPhoneInput.disabled = !city;
  saveCityDispatchPhoneBtn.disabled = !city;
  if (cityDispatchPhoneStatus) cityDispatchPhoneStatus.textContent = city ? "Wird geladen …" : "Bitte zuerst einen Ort wählen.";
  if (!city) return;

  try {
    const response = await fetch(`${API_BASE}/city_settings.php?city=${encodeURIComponent(city)}`, {
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Leitstellennummer konnte nicht geladen werden.");
    }
    cityDispatchPhoneInput.value = String(result.dispatchPhone || "");
    if (cityDispatchPhoneStatus) cityDispatchPhoneStatus.textContent = result.dispatchPhone ? "Für diesen Ort hinterlegt." : "Für diesen Ort ist keine Nummer hinterlegt.";
  } catch (error) {
    if (cityDispatchPhoneStatus) cityDispatchPhoneStatus.textContent = error.message || "Leitstellennummer konnte nicht geladen werden.";
  }
}

async function saveCityDispatchPhoneSetting() {
  const city = String(citySelect?.value || "").trim();
  if (!city || !cityDispatchPhoneInput || !saveCityDispatchPhoneBtn) return;

  saveCityDispatchPhoneBtn.disabled = true;
  if (cityDispatchPhoneStatus) cityDispatchPhoneStatus.textContent = "Wird gespeichert …";
  try {
    const response = await fetch(`${API_BASE}/city_settings.php`, {
      method: "POST",
      headers: withApiAuthHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        city,
        dispatchPhone: cityDispatchPhoneInput.value
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Leitstellennummer konnte nicht gespeichert werden.");
    }
    cityDispatchPhoneInput.value = String(result.dispatchPhone || "");
    if (cityDispatchPhoneStatus) cityDispatchPhoneStatus.textContent = result.dispatchPhone ? "Gespeichert." : "Keine Nummer hinterlegt.";
    setStatus(`Leitstellennummer für ${prettifyCityName(city)} gespeichert.`);
  } catch (error) {
    if (cityDispatchPhoneStatus) cityDispatchPhoneStatus.textContent = error.message || "Speichern fehlgeschlagen.";
    setStatus(error.message || "Leitstellennummer konnte nicht gespeichert werden.");
  } finally {
    saveCityDispatchPhoneBtn.disabled = false;
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

function startInputMaskWatchdog() {
  if (window.__lehrfahrerInputMaskWatchdogActive) {
    return;
  }
  window.__lehrfahrerInputMaskWatchdogActive = true;

  setInterval(() => {
    const topbar = document.getElementById("topbar");
    const menubar = document.getElementById("menubar");

    if (menubar && (menubar.classList.contains("hidden") || menubar.style.display === "none")) {
      menubar.classList.remove("hidden");
      menubar.style.display = "";
      menubar.style.visibility = "visible";
      menubar.style.pointerEvents = "auto";
      menubar.style.opacity = "1";
    }

    if (topbar && (topbar.classList.contains("hidden") || topbar.style.display === "none")) {
      topbar.classList.remove("hidden");
      topbar.style.display = "flex";
      topbar.style.visibility = "visible";
      topbar.style.pointerEvents = "auto";
      topbar.style.opacity = "1";
      topbar.style.maxHeight = "none";
    }

    if (topbar) {
      const groups = topbar.querySelectorAll(".top-group");
      groups.forEach(group => {
        if (group.classList.contains("hidden") || group.style.display === "none") {
          group.classList.remove("hidden");
          group.style.display = "flex";
          group.style.visibility = "visible";
          group.style.opacity = "1";
        }
      });
    }
  }, 1000);
}

function forceScrollToEditorTop() {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  } catch {
    window.scrollTo(0, 0);
  }

  if (document.documentElement) {
    document.documentElement.scrollTop = 0;
  }
  if (document.body) {
    document.body.scrollTop = 0;
  }

  const menubar = document.getElementById("menubar");
  if (menubar) {
    menubar.scrollIntoView({ behavior: "auto", block: "start" });
  }
}

function updateEditorChromeLayoutMetrics() {
  const menubar = document.getElementById("menubar");
  const topbar = document.getElementById("topbar");
  if (!menubar || !topbar) {
    return;
  }

  const menubarHeight = Math.ceil(menubar.getBoundingClientRect().height || 0);
  const topbarHeight = Math.ceil(topbar.getBoundingClientRect().height || 0);

  if (menubarHeight > 0) {
    document.documentElement.style.setProperty("--menubar-height", `${menubarHeight}px`);
  }

  const chromeHeight = menubarHeight + topbarHeight;
  if (chromeHeight > 0) {
    document.documentElement.style.setProperty("--editor-chrome-height", `${chromeHeight}px`);
  }
}

async function createNewLine() {
  updateEditorChromeLayoutMetrics();
  forceScrollToEditorTop();

  const ok = await showConfirmDialog({
    title: "Neue Linie erstellen",
    message: "Wirklich eine neue Linie erstellen?<br><br>Ungespeicherte Änderungen gehen dabei verloren.",
    okText: "Neue Linie",
    cancelText: "Abbrechen"
  });

  if (!ok) return;

  forceScrollToEditorTop();

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Neue Linie erstellt");
  }

  clearEditorData();

  lineNameInput.value = "";
  routeNameInput.value = "";
  setVariantName("Standard");
  setVariantCategory("Standard");
  directionNameInput.value = "";
  setLineDescription("");
  setOperationalRouteFields({ routeType: "line" });
  lineColorInput.value = "#d32f2f";

  if (typeof stopSearchInput !== "undefined" && stopSearchInput) {
    stopSearchInput.value = "";
  }

  if (typeof clearSearchResults === "function") {
    clearSearchResults();
  }

  state.previewMode = "original";
  state.routeMode = "auto";
  state.placementMode = "freeStop";
  state.routingMode = "guidedStreet";
  state.preserveManualChains = true;
  state.description = "";
  state.variantName = "Standard";
  state.variantCategory = "Standard";
  setLineValidity("", "");

  clearSelection();
  clearRouteMultiSelection();

  const adapter = window.EditorMapAdapter;
  if (!adapter || !adapter.setEditorViewport(51.7600, 14.3300, 13)) {
    map.setView([51.7600, 14.3300], 13);
  }

  updateModeButtons();
  updatePreviewButtons();
  updateStats();
  renderStopOrderList();
  updateHistoryButtons();

  setMode("freeStop", "Neue Linie erstellt. Modus: Haltestelle");
  showLineInputFieldsForNewLine();
  updateEditorChromeLayoutMetrics();
}

function showLineInputFieldsForNewLine() {
  function forceShowInputMask() {
    const topbar = document.getElementById("topbar");
    const menubar = document.getElementById("menubar");

    if (menubar) {
      menubar.classList.remove("hidden");
      menubar.style.display = "";
      menubar.style.visibility = "visible";
      menubar.style.pointerEvents = "auto";
      menubar.style.opacity = "1";
    }

    if (topbar) {
      topbar.classList.remove("hidden");
      topbar.style.display = "flex";
      topbar.style.visibility = "visible";
      topbar.style.pointerEvents = "auto";
      topbar.style.opacity = "1";
      topbar.style.maxHeight = "none";

      // Stellt sicher, dass einzelne Feldgruppen nicht in einem versteckten Zustand haengen bleiben.
      const groups = topbar.querySelectorAll(".top-group");
      groups.forEach(group => {
        group.classList.remove("hidden");
        group.style.display = "flex";
        group.style.visibility = "visible";
      });
    }

    return topbar;
  }

  const topbar = forceShowInputMask();
  forceScrollToEditorTop();

  if (topbar) {
    topbar.classList.add("topbar-attention");
    topbar.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => topbar.classList.remove("topbar-attention"), 1400);
  }

  requestAnimationFrame(() => {
    forceShowInputMask();
    if (lineNameInput) {
      lineNameInput.focus();
      lineNameInput.select();
    }
  });

  setTimeout(forceShowInputMask, 80);
  setTimeout(forceShowInputMask, 260);
  setTimeout(forceShowInputMask, 900);
  setTimeout(forceShowInputMask, 1800);
  setTimeout(forceShowInputMask, 3200);
  setTimeout(forceScrollToEditorTop, 80);
  setTimeout(forceScrollToEditorTop, 260);
  setTimeout(forceScrollToEditorTop, 900);

  setStatus("Eingabemenü geöffnet: Bitte oben Linie/Route/Richtung eingeben.");
}

// =========================
// START
// =========================

initDebugPanel();
updateApiTokenStatusUI();
loadEditorVersionBadge();
startInputMaskWatchdog();
updateEditorChromeLayoutMetrics();

window.addEventListener("resize", updateEditorChromeLayoutMetrics);
setTimeout(updateEditorChromeLayoutMetrics, 80);
setTimeout(updateEditorChromeLayoutMetrics, 260);
setTimeout(updateEditorChromeLayoutMetrics, 900);

createCatalogMarkers();
updateCatalogMarkerVisibilityNow();

updateModeButtons();
updatePreviewButtons();
updateStats();
renderStopOrderList();
updateHistoryButtons();
loadCitiesFromServer();

if (citySelect) citySelect.addEventListener("change", () => {
  loadCityDispatchPhoneSetting();
  updateCityManagementButtons();
});
if (saveCityDispatchPhoneBtn) saveCityDispatchPhoneBtn.addEventListener("click", saveCityDispatchPhoneSetting);
if (renameCityBtn) renameCityBtn.addEventListener("click", renameSelectedCity);
if (deleteCityBtn) deleteCityBtn.addEventListener("click", deleteSelectedCity);

startAutosaveLoop();
setStatus("Editor bereit.");
