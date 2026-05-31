// =========================
// DEBUG
// =========================
// Zentrale Debug-Helfer für Konsole und Debug-Panel.

// Formatiert beliebige Werte als lesbaren Text für die Debug-Ausgabe.
function formatDebugPart(part) {
  if (typeof part === "string") return part;

  try {
    return JSON.stringify(part);
  } catch (err) {
    return String(part);
  }
}

// Hängt eine neue Zeile im Debug-Panel an und begrenzt die Anzahl.
function appendDebugLine(level, parts) {
  if (!debugPanelReady || !debugPanelBody) return;

  const line = document.createElement("div");
  line.className = `debug-line ${level}`;

  const time = new Date().toLocaleTimeString("de-DE");
  const text = parts.map(formatDebugPart).join(" ");

  line.textContent = `[${time}] ${text}`;
  debugPanelBody.appendChild(line);

  while (debugPanelBody.children.length > DEBUG_MAX_LINES) {
    debugPanelBody.removeChild(debugPanelBody.firstChild);
  }

  debugPanelBody.scrollTop = debugPanelBody.scrollHeight;
}

// Info-Logging (aktiv nur wenn DEBUG=true).
function debug(...msg) {
  if (!DEBUG) return;
  console.log("[EDITOR]", ...msg);
  appendDebugLine("info", msg);
}

// Warn-Logging.
function warn(...msg) {
  console.warn("[EDITOR]", ...msg);
  appendDebugLine("warn", msg);
}

// Fehler-Logging.
function error(...msg) {
  console.error("[EDITOR]", ...msg);
  appendDebugLine("error", msg);
}

// Initialisiert das Debug-Panel beim Start.
function initDebugPanel() {
  debugPanelReady = true;
  debug("Editor Script geladen");
}

// Blendet das Debug-Panel ein/aus.
function toggleDebugPanel() {
  debugPanel.classList.toggle("hidden");
  debugToggleBtn.textContent = debugPanel.classList.contains("hidden")
    ? "Debug"
    : "Debug an";
}

  // Leert den sichtbaren Verlauf im Debug-Panel.
function clearDebugPanel() {
  debugPanelBody.innerHTML = "";
  debug("Debug-Panel geleert");
}