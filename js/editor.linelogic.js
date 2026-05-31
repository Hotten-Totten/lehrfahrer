// =========================
// LINE LOGIC
// =========================

const LINE_ESTIMATE_KMH = 20; // grober Planwert für Stadtverkehr
const LINE_DWELL_MINUTES = 0.5; // Haltezeit pro Halt

// Näherungsdistanz zwischen zwei Geo-Punkten in Metern.
function distanceMetersBetween(a, b) {
  const latFactor = 111320;
  const lonFactor = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);

  const dx = (b.lon - a.lon) * lonFactor;
  const dy = (b.lat - a.lat) * latFactor;

  return Math.sqrt(dx * dx + dy * dy);
}

// Summiert die komplette Länge der aktuell gezeichneten Route.
function getTotalRouteLengthMeters() {
  if (!state.routePoints || state.routePoints.length < 2) {
    return 0;
  }

  let total = 0;

  for (let i = 0; i < state.routePoints.length - 1; i++) {
    total += distanceMetersBetween(state.routePoints[i], state.routePoints[i + 1]);
  }

  return total;
}

// Leitet eine grobe Fahrzeit aus Route-Länge und Standardgeschwindigkeit ab.
function getEstimatedDriveMinutes() {
  const meters = getTotalRouteLengthMeters();
  if (meters <= 0) return 0;

  const km = meters / 1000;
  const minutes = (km / LINE_ESTIMATE_KMH) * 60;

  return Math.round(minutes);
}

// Erstellt eine kumulative Distanzliste entlang der Route.
function buildRouteCumulativeDistances() {
  const cumulative = [];

  if (!state.routePoints.length) {
    return cumulative;
  }

  let total = 0;
  cumulative.push(0);

  for (let i = 1; i < state.routePoints.length; i++) {
    total += distanceMetersBetween(state.routePoints[i - 1], state.routePoints[i]);
    cumulative.push(total);
  }

  return cumulative;
}

// Sucht den nächstgelegenen Routenpunkt ab einem Startindex.
function findNearestRoutePointIndexFrom(startIndex, stop) {
  if (!state.routePoints.length) return -1;

  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let i = startIndex; i < state.routePoints.length; i++) {
    const point = state.routePoints[i];
    const dist = distanceMetersBetween(
      { lat: stop.lat, lon: stop.lon },
      { lat: point.lat, lon: point.lon }
    );

    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// Vergibt Minutenwerte automatisch, optional auch für manuell gepflegte Stops.
function autoAssignStopMinutes(forceAll = false) {
  if (!state.stops.length) {
    setStatus("Keine Haltestellen vorhanden.", "warn");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Minuten automatisch berechnet");
  }

  // Fallback: wenn keine richtige Route da ist, über Haltestellen direkt schätzen
  if (!state.routePoints || state.routePoints.length < 2) {
    let totalMeters = 0;

    state.stops.forEach((stop, index) => {
      if (index === 0) {
        if (forceAll || stop.minuteMode !== "manual") {
          stop.minuteFromStart = 0;
          stop.minuteMode = "auto";
        }
        return;
      }

      totalMeters += distanceMetersBetween(state.stops[index - 1], stop);

      const rawDriveMinute = Math.round((totalMeters / 1000 / LINE_ESTIMATE_KMH) * 60);
      const prevMinute = Number(state.stops[index - 1].minuteFromStart || 0);

      // Mindestfortschritt + Haltezeit
      const finalMinute = Math.max(
        rawDriveMinute + (index * LINE_DWELL_MINUTES),
        prevMinute + 1
      );

      if (forceAll || stop.minuteMode !== "manual") {
        stop.minuteFromStart = finalMinute;
        stop.minuteMode = "auto";
      }
    });

    renderStopOrderList();

    if (state.selected && state.selected.type === "stop") {
      stopMinuteInput.value = state.selected.ref.minuteFromStart;
    }

    updateLineMetricsUI();
    setStatus(
      forceAll
        ? "Alle Minuten grob aus Haltestellenabständen berechnet."
        : "Auto-Minuten berechnet, manuelle Minuten beibehalten."
    );
    return;
  }

  const cumulative = buildRouteCumulativeDistances();
  let searchStartIndex = 0;

  state.stops.forEach((stop, index) => {
    if (index === 0) {
      if (forceAll || stop.minuteMode !== "manual") {
        stop.minuteFromStart = 0;
        stop.minuteMode = "auto";
      }
      return;
    }

    const routeIndex = findNearestRoutePointIndexFrom(searchStartIndex, stop);
    const prevMinute = Number(state.stops[index - 1].minuteFromStart || 0);

    if (routeIndex === -1) {
      if (forceAll || stop.minuteMode !== "manual") {
        stop.minuteFromStart = prevMinute + 1 + LINE_DWELL_MINUTES;
        stop.minuteMode = "auto";
      }
      return;
    }

    searchStartIndex = routeIndex;

    const metersFromStart = cumulative[routeIndex] || 0;
    const rawDriveMinute = Math.round((metersFromStart / 1000 / LINE_ESTIMATE_KMH) * 60);

    const finalMinute = Math.max(
      rawDriveMinute + (index * LINE_DWELL_MINUTES),
      prevMinute + 1
    );

    if (forceAll || stop.minuteMode !== "manual") {
      stop.minuteFromStart = finalMinute;
      stop.minuteMode = "auto";
    }
  });

  renderStopOrderList();

  if (state.selected && state.selected.type === "stop") {
    stopMinuteInput.value = state.selected.ref.minuteFromStart;
  }

  updateLineMetricsUI();
  setStatus(
    forceAll
      ? "Alle Minuten automatisch aus Linienverlauf berechnet."
      : "Auto-Minuten berechnet, manuelle Minuten beibehalten."
  );
}
// =========================
// UI UPDATE
// =========================

// Schreibt Linienlänge und Fahrzeit in die UI-Anzeige.
function updateLineMetricsUI() {
  if (!routeLengthKm || !estimatedDriveMinutes) return;

  const totalKm = getTotalRouteLengthMeters() / 1000;
  routeLengthKm.textContent = totalKm.toFixed(2);
  estimatedDriveMinutes.textContent = getEstimatedDriveMinutes();
}

// Verschiebt Folge-Haltestellen zeitlich um ein Delta (z. B. nach manueller Änderung).
function shiftFollowingStopMinutes(startIndex, deltaMinutes) {
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
    return;
  }

  for (let i = startIndex + 1; i < state.stops.length; i++) {
    const prevStop = state.stops[i - 1];
    const stop = state.stops[i];

    const shiftedMinute = Number(stop.minuteFromStart || 0) + deltaMinutes;
    const minAllowedMinute = Number(prevStop.minuteFromStart || 0) + 1;

    stop.minuteFromStart = Math.max(shiftedMinute, minAllowedMinute);
  }
}