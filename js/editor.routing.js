// =========================
// OSRM ROUTING
// =========================
// Dieses Modul verwaltet die Routenberechnung mit OSRM (Open Source Routing Machine)
// Ermöglicht das automatische Erstellen von Routen zwischen Haltestellen

let streetRoutingRunning = false;
let routingAbortController = null;

// Dekodiert einen Valhalla Polyline6-String zu [lon, lat]-Koordinaten
function decodePolyline6(str) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

// Erstellt einen fetch mit Timeout (ms); bricht auch bei Nutzer-Abbruch ab
function fetchWithTimeout(url, options, ms = 15000) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), ms);
  const signals = [timeoutController.signal];
  if (routingAbortController) signals.push(routingAbortController.signal);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  return fetch(url, { ...options, signal })
    .finally(() => clearTimeout(timer));
}

// Ruft eine Route von Valhalla (bus-Profil) zwischen zwei Punkten ab
async function fetchStreetSegmentBus(fromStop, toStop) {
  const body = {
    locations: [
      { lon: fromStop.lon, lat: fromStop.lat, type: "break" },
      { lon: toStop.lon, lat: toStop.lat, type: "break" }
    ],
    costing: "bus",
    directions_options: { units: "km" }
  };
  let response;
  try {
    response = await fetchWithTimeout(`${VALHALLA_BASE_URL}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, 15000);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Valhalla: Zeitüberschreitung (>15 s)");
    throw new Error(`Valhalla nicht erreichbar: ${err.message}`);
  }
  if (!response.ok) {
    let detail = "";
    try { const e = await response.json(); detail = e.error_code ? ` (Code ${e.error_code})` : ""; } catch {}
    throw new Error(`Valhalla HTTP ${response.status}${detail}`);
  }
  const data = await response.json();
  if (!data.trip || !data.trip.legs || !data.trip.legs.length) throw new Error("Valhalla: Keine Route in Antwort.");
  return decodePolyline6(data.trip.legs[0].shape);
}

// Ruft eine Route zwischen zwei Punkten ab.
// Versucht zuerst Valhalla (bus-Profil), fällt auf OSRM (driving) zurück.
async function fetchStreetSegment(fromStop, toStop) {
  try {
    return await fetchStreetSegmentBus(fromStop, toStop);
  } catch (valhallaErr) {
    debug("Valhalla fehlgeschlagen, nutze OSRM als Fallback", valhallaErr.message);
    setStatus(`⚠ ${valhallaErr.message} – versuche OSRM-Fallback …`, "warn");

    const coords = `${fromStop.lon},${fromStop.lat};${toStop.lon},${toStop.lat}`;
    const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    let response;
    try {
      response = await fetchWithTimeout(url, {}, 15000);
    } catch (err) {
      if (err.name === "AbortError") throw new Error(`Valhalla: ${valhallaErr.message} | OSRM: Zeitüberschreitung (>15 s)`);
      throw new Error(`Valhalla: ${valhallaErr.message} | OSRM nicht erreichbar: ${err.message}`);
    }
    if (!response.ok) throw new Error(`Valhalla: ${valhallaErr.message} | OSRM HTTP ${response.status}`);
    const data = await response.json();
    if (!data.routes || !data.routes.length) throw new Error(`Valhalla: ${valhallaErr.message} | OSRM: Keine Route gefunden`);
    return data.routes[0].geometry.coordinates;
  }
}

// Berechnet eine Teilstrecke der Route neu
// Benutzer wählt zwei Routenpunkte aus, dazwischen wird neu geroutet
async function rerouteSelectedSegment() {
  if (state.selectedRoutePointIds.size !== 2) {
    setStatus("Bitte genau zwei Routenpunkte auswählen.");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Teilstrecke neu berechnet");
  }

  const ids = Array.from(state.selectedRoutePointIds);

  const indexA = state.routePoints.findIndex(p => p.id === ids[0]);
  const indexB = state.routePoints.findIndex(p => p.id === ids[1]);

  if (indexA === -1 || indexB === -1) {
    setStatus("Routenpunkte nicht gefunden.");
    return;
  }

  const startIndex = Math.min(indexA, indexB);
  const endIndex = Math.max(indexA, indexB);

  const startPoint = state.routePoints[startIndex];
  const endPoint = state.routePoints[endIndex];

  try {
    setStatus("Teilstrecke wird neu berechnet...");
    debug("Teilstrecke wird neu berechnet", {
      startIndex,
      endIndex,
      selectedPoints: Array.from(state.selectedRoutePointIds)
    });

    const segment = await fetchStreetSegment(
      { lat: startPoint.lat, lon: startPoint.lon },
      { lat: endPoint.lat, lon: endPoint.lon }
    );

    const newPoints = segment.map(coord => ({
      lat: coord[1],
      lon: coord[0]
    }));

    const removed = state.routePoints.splice(startIndex + 1, endIndex - startIndex - 1);
    removed.forEach(p => map.removeLayer(p.marker));

    let insertIndex = startIndex + 1;

    newPoints.slice(1, -1).forEach(coord => {
      createRoutePointObject(coord.lat, coord.lon, true, "street");
      const createdPoint = state.routePoints.pop();
      state.routePoints.splice(insertIndex, 0, createdPoint);
      insertIndex++;
    });

    refreshRouteLine();
    clearRouteMultiSelection();
    applyRoutePointIcons();

    debug("Teilstrecke erfolgreich neu berechnet", {
      startIndex,
      endIndex,
      totalRoutePoints: state.routePoints.length
    });

    setStatus("Teilstrecke erfolgreich neu berechnet.");
  } catch (err) {
    error("Fehler beim Teilrouting", err);
    setStatus(`Fehler beim Teilrouting: ${err.message}`, "error");
  }
}

// Sucht eine passende Sondertrasse zwischen zwei Haltestellen
// Wird für das Routing verwendet, um benutzerdefinierte Strecken zu berücksichtigen
function findMatchingSpecialTrack(fromStop, toStop) {
  const tracks = Array.isArray(state.specialTracks) ? state.specialTracks : [];

  const fromId = String(fromStop.id || "").trim();
  const toId = String(toStop.id || "").trim();
  const fromName = String(fromStop.name || "").trim();
  const toName = String(toStop.name || "").trim();

  for (const track of tracks) {
    if (!track || !Array.isArray(track.points) || track.points.length < 2) {
      continue;
    }

    const trackFromId = String(track.fromStopId || "").trim();
    const trackToId = String(track.toStopId || "").trim();
    const trackFromName = String(track.fromStopName || "").trim();
    const trackToName = String(track.toStopName || "").trim();

    const forwardById = trackFromId === fromId && trackToId === toId;
    const reverseById = trackFromId === toId && trackToId === fromId;

    const forwardByName = trackFromName === fromName && trackToName === toName;
    const reverseByName = trackFromName === toName && trackToName === fromName;

    const isForward = forwardById || forwardByName;
    const isReverse = reverseById || reverseByName;

    debug("Vergleiche Sondertrasse", {
      fromId,
      toId,
      trackFromId,
      trackToId,
      fromName,
      toName,
      trackFromName,
      trackToName,
      isForward,
      isReverse,
      points: track.points.length
    });

    if (isForward) {
      return {
        track,
        reversed: false
      };
    }

    if (isReverse) {
      return {
        track,
        reversed: true
      };
    }
  }

  return null;
}

// Erstellt Routing-Schritte für alle Stops
// Berücksichtigt Sondertrassen und OSRM-Routen
function buildForcedRoutingSteps(stopsToBuild) {
  const steps = [];

  for (let i = 0; i < stopsToBuild.length - 1; i++) {
    const fromStop = stopsToBuild[i];
    const toStop = stopsToBuild[i + 1];

    debug("Prüfe Sondertrassen für Abschnitt", {
      fromStop: fromStop.name,
      toStop: toStop.name,
      fromStopId: fromStop.id,
      toStopId: toStop.id,
      specialTracks: state.specialTracks
    });

    const match = findMatchingSpecialTrack(fromStop, toStop);

    debug("MatchingTrack gefunden?", {
      fromStop: fromStop.name,
      toStop: toStop.name,
      found: !!match,
      trackId: match ? match.track.id : null,
      reversed: match ? match.reversed : null
    });

    if (!match) {
      steps.push({
        type: "street",
        from: {
          lat: fromStop.lat,
          lon: fromStop.lon,
          name: fromStop.name
        },
        to: {
          lat: toStop.lat,
          lon: toStop.lon,
          name: toStop.name
        },
        label: `${fromStop.name} → ${toStop.name}`
      });
      continue;
    }

    const matchingTrack = match.track;
    const rawPoints = match.reversed
      ? matchingTrack.points.slice().reverse()
      : matchingTrack.points.slice();

    debug("Sondertrasse als Pflichtsegment", {
      fromStop: fromStop.name,
      toStop: toStop.name,
      trackId: matchingTrack.id,
      reversed: match.reversed,
      points: rawPoints.length
    });

    steps.push({
      type: "track",
      points: [
        [fromStop.lon, fromStop.lat],
        ...rawPoints.map(p => [p[1], p[0]]),
        [toStop.lon, toStop.lat]
      ],
      label: `${fromStop.name} => ${toStop.name}`,
      trackId: matchingTrack.id
    });
  }

  return steps;
}

// Routet nur die zwei Abschnitte um einen neu in der Mitte eingefügten Stop.
// Gibt true zurück wenn erfolgreich, false wenn Fallback auf Vollrouting nötig.
async function rerouteInsertedStop(insertedStopIndex) {
  const prevStop = state.stops[insertedStopIndex - 1];
  const newStop  = state.stops[insertedStopIndex];
  const nextStop = state.stops[insertedStopIndex + 1];

  // Nächsten Routenpunkt zu prevStop finden (Suchstart: 0)
  const fromIdx = findNearestRoutePointIndexFrom(0, prevStop);
  if (fromIdx === -1) return false;

  // Nächsten Routenpunkt zu nextStop finden (Suchstart: fromIdx)
  const toIdx = findNearestRoutePointIndexFrom(fromIdx, nextStop);
  if (toIdx === -1 || toIdx <= fromIdx) return false;

  setStatus(`Zwischenstop einsetzen: ${prevStop.name} → ${newStop.name} → ${nextStop.name} …`);

  // Beide Abschnitte parallel abrufen
  const [seg1, seg2] = await Promise.all([
    fetchStreetSegment({ lat: prevStop.lat, lon: prevStop.lon }, { lat: newStop.lat, lon: newStop.lon }),
    fetchStreetSegment({ lat: newStop.lat, lon: newStop.lon }, { lat: nextStop.lat, lon: nextStop.lon })
  ]);

  // Alte Routenpunkte zwischen fromIdx und toIdx (exklusiv) entfernen
  const removed = state.routePoints.splice(fromIdx + 1, toIdx - fromIdx - 1);
  removed.forEach(p => map.removeLayer(p.marker));

  // Neue Punkte aus beiden Segmenten zusammenführen (ohne doppelten Mittelpunkt)
  const newCoords = [...seg1, ...seg2.slice(1)];

  // Innere Punkte einfügen (ohne ersten und letzten, die sind bereits vorhanden)
  let insertAt = fromIdx + 1;
  for (const coord of newCoords.slice(1, -1)) {
    createRoutePointObject(coord[1], coord[0], true, "street");
    const created = state.routePoints.pop();
    state.routePoints.splice(insertAt, 0, created);
    insertAt++;
  }

  return true;
}

// Erstellt eine vollständige Straßenroute zwischen allen Haltestellen
// Verwendet OSRM für das Routing und berücksichtigt Sondertrassen
async function buildStreetRouteFromStops() {
  if (streetRoutingRunning) {
    setStatus("Straßenrouting läuft bereits.", "warn");
    return;
  }

  if (state.stops.length < 2) {
    setStatus("Für Straßenrouting werden mindestens 2 Haltestellen benötigt.");
    return;
  }

  const hasExistingRoute = Array.isArray(state.routePoints) && state.routePoints.length > 0;
  const lastRoutedStopCount =
    typeof state.lastRoutedStopCount === "number" ? state.lastRoutedStopCount : 0;
  const lastRoutedStopIds = Array.isArray(state.lastRoutedStopIds) ? state.lastRoutedStopIds : null;

  // ── Zwischenstop-Erkennung ──────────────────────────────────────────────────
  // Genau ein Stop mehr als beim letzten Routing und alle alten IDs noch vorhanden?
  if (
    hasExistingRoute &&
    lastRoutedStopIds &&
    state.stops.length === lastRoutedStopIds.length + 1
  ) {
    // Finde den ersten Index, an dem die ID nicht mehr übereinstimmt → neuer Stop
    let insertedIdx = -1;
    for (let i = 0; i < state.stops.length; i++) {
      if (lastRoutedStopIds[i] !== state.stops[i].id) {
        insertedIdx = i;
        break;
      }
    }
    // Letzter Stop → kein Mitteneinfügen, appendMode greift unten
    const isMiddleInsertion = insertedIdx > 0 && insertedIdx < state.stops.length - 1;

    if (isMiddleInsertion) {
      if (!historyRestoreRunning) pushHistorySnapshot("Straßenroute erzeugt");
      streetRoutingRunning = true;
      routingAbortController = new AbortController();
      buildStreetRouteBtn.disabled = true;
      cancelRoutingBtn.style.display = "";
      try {
        const ok = await rerouteInsertedStop(insertedIdx);
        if (ok) {
          state.lastRoutedStopIds = state.stops.map(s => s.id);
          state.lastRoutedStopCount = state.stops.length;
          state.simplifiedRoutePoints = [];
          refreshRouteLine();
          updateStats();
          updateRouteStats();
          setStatus(`Zwischenstop "${state.stops[insertedIdx].name}" eingesetzt.`);
          return;
        }
        // Fallback: ok === false → unten normal weitermachen
      } catch (err) {
        if (err.name === "AbortError") {
          setStatus("Routing abgebrochen.", "warn");
          return;
        }
        error("Fehler beim Zwischenstop-Routing", err);
        setStatus(`Fehler beim Zwischenstop-Routing: ${err.message} – berechne komplett neu …`, "warn");
      } finally {
        streetRoutingRunning = false;
        routingAbortController = null;
        buildStreetRouteBtn.disabled = false;
        cancelRoutingBtn.style.display = "none";
      }
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  let startIndex = 0;
  let appendMode = false;

  // Nur hinten fortsetzen, wenn bereits eine Route existiert
  // und neue Haltestellen hinten dazugekommen sind
  if (hasExistingRoute && lastRoutedStopCount >= 2 && state.stops.length > lastRoutedStopCount) {
    startIndex = lastRoutedStopCount - 1;
    appendMode = true;
  }

  const stopsToBuild = state.stops.slice(startIndex);

  if (stopsToBuild.length < 2) {
    setStatus("Keine neuen Abschnitte zum Berechnen vorhanden.", "warn");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Straßenroute erzeugt");
  }

  streetRoutingRunning = true;
  routingAbortController = new AbortController();

  try {
    buildStreetRouteBtn.disabled = true;
    cancelRoutingBtn.style.display = "";
    clearRouteMultiSelection();

    if (appendMode) {
      setStatus(`Route wird ab "${stopsToBuild[0].name}" fortgesetzt ...`);
    } else {
      setStatus("Straßenroute wird berechnet ...");
    }

    // Nur bei kompletter Neuberechnung alles löschen
    if (!appendMode) {
      removeAllRoutePointMarkers();
      state.routePoints = [];
      state.simplifiedRoutePoints = [];
    }

    const allCoords = [];
    const steps = buildForcedRoutingSteps(stopsToBuild);

    debug("Erzwungene Routing-Schritte", steps);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === "track") {
        setStatus(`Sondertrasse verwende Abschnitt ${i + 1}/${steps.length}: ${step.label}`);

        step.points.forEach((coord, idx) => {
          if (allCoords.length && idx === 0) return;
          allCoords.push(coord);
        });

        continue;
      }

      setStatus(`Straßenroute berechne Abschnitt ${i + 1}/${steps.length}: ${step.label}`);

      let segment;
      try {
        segment = await fetchStreetSegment(
          { lat: step.from.lat, lon: step.from.lon },
          { lat: step.to.lat, lon: step.to.lon }
        );
      } catch (segErr) {
        if (segErr.name === "AbortError") throw segErr; // Nutzer-Abbruch durchreichen
        // Gerade Linie als Fallback, Rest der Route wird trotzdem berechnet
        debug(`Abschnitt ${i + 1} fehlgeschlagen, nutze gerade Linie als Fallback`, segErr.message);
        setStatus(`⚠ Abschnitt ${i + 1}/${steps.length} nicht routbar – gerade Linie eingesetzt.`, "warn");
        segment = [
          [step.from.lon, step.from.lat],
          [step.to.lon, step.to.lat]
        ];
      }

      segment.forEach((coord, idx) => {
        if (allCoords.length && idx === 0) return;
        allCoords.push(coord);
      });
    }

    const coordsToCreate =
      appendMode && allCoords.length > 1
        ? allCoords.slice(1)
        : allCoords;

    coordsToCreate.forEach(coord => {
      const lon = coord[0];
      const lat = coord[1];
      createRoutePointObject(lat, lon, true, "street");
    });

    state.routeMode = "street";
    state.simplifiedRoutePoints = [];
    state.previewMode = "original";
    state.lastRoutedStopCount = state.stops.length;
    state.lastRoutedStopIds = state.stops.map(s => s.id);

    debug("Hybrid-Route berechnet", {
      stops: stopsToBuild.length,
      specialTracks: state.specialTracks.length,
      routePoints: state.routePoints.length,
      appendMode
    });

    refreshRouteLine();
    updateStats();
    updateRouteStats();

    if (appendMode) {
      setStatus(`Route ab "${stopsToBuild[0].name}" erfolgreich fortgesetzt.`);
    } else {
      setStatus("Hybrid-Route erfolgreich erzeugt.");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      setStatus("Routing abgebrochen.", "warn");
    } else {
      error("Fehler beim Straßenrouting", err);
      setStatus(`Fehler beim Straßenrouting: ${err.message}`, "error");
    }
  } finally {
    streetRoutingRunning = false;
    routingAbortController = null;
    buildStreetRouteBtn.disabled = false;
    cancelRoutingBtn.style.display = "none";
  }
}