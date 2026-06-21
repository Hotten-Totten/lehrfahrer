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

async function buildStreetRouteCoordsViaAnchors(anchors, options = {}) {
  const {
    routingModeLabel = "street",
    onSegmentDebug = null,
    onSegmentWarning = null
  } = options || {};
  const routingAnchors = Array.isArray(anchors) ? anchors : [];
  const combinedCoords = [];

  for (let index = 0; index < routingAnchors.length - 1; index++) {
    const fromAnchor = routingAnchors[index];
    const toAnchor = routingAnchors[index + 1];
    const directMeters = distanceMetersBetween(fromAnchor, toAnchor);
    const segmentCoords = (await fetchStreetSegment(fromAnchor, toAnchor))
      .map(coord => Array.isArray(coord)
        ? [Number(coord[0]), Number(coord[1])]
        : [Number(coord.lon), Number(coord.lat)])
      .filter(coord => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));

    if (segmentCoords.length < 2) {
      throw new Error(`Kein Routing-Segment zwischen ${fromAnchor.name} und ${toAnchor.name}.`);
    }

    let routedMeters = 0;
    for (let coordIndex = 1; coordIndex < segmentCoords.length; coordIndex++) {
      routedMeters += distanceMetersBetween(
        { lat: segmentCoords[coordIndex - 1][1], lon: segmentCoords[coordIndex - 1][0] },
        { lat: segmentCoords[coordIndex][1], lon: segmentCoords[coordIndex][0] }
      );
    }

    const segmentInfo = {
      index,
      fromName: fromAnchor.name || "",
      toName: toAnchor.name || "",
      fromId: fromAnchor.id || null,
      toId: toAnchor.id || null,
      fromCatalogId: fromAnchor.catalogId || null,
      toCatalogId: toAnchor.catalogId || null,
      directMeters: Math.round(directMeters),
      routedMeters: Math.round(routedMeters),
      ratio: directMeters > 0 ? Number((routedMeters / directMeters).toFixed(2)) : null,
      routePointCount: segmentCoords.length,
      routingMode: routingModeLabel
    };

    if (typeof onSegmentDebug === "function") {
      onSegmentDebug(segmentInfo);
    }
    if (typeof onSegmentWarning === "function") {
      onSegmentWarning(segmentInfo);
    }

    combinedCoords.push(...(index === 0 ? segmentCoords : segmentCoords.slice(1)));
  }

  return combinedCoords;
}

async function buildEditorStreetRouteItemsViaAnchors(anchors, options = {}) {
  const routingAnchors = Array.isArray(anchors) ? anchors : [];
  const routeItems = [];

  for (let index = 0; index < routingAnchors.length - 1; index++) {
    const fromAnchor = routingAnchors[index];
    const toAnchor = routingAnchors[index + 1];
    const segmentCoords = await buildStreetRouteCoordsViaAnchors(
      [fromAnchor, toAnchor],
      {
        ...options,
        onSegmentDebug: segmentInfo => {
          if (typeof options.onSegmentDebug === "function") {
            options.onSegmentDebug({ ...segmentInfo, index });
          }
        },
        onSegmentWarning: segmentInfo => {
          if (typeof options.onSegmentWarning === "function") {
            options.onSegmentWarning({ ...segmentInfo, index });
          }
        }
      }
    );

    segmentCoords.forEach((coord, coordIndex) => {
      if (routeItems.length && coordIndex === 0) return;
      const isFromManualAnchor = coordIndex === 0 && fromAnchor.kind === "manual";
      const isToManualAnchor = coordIndex === segmentCoords.length - 1 && toAnchor.kind === "manual";
      const manualAnchor = isFromManualAnchor ? fromAnchor : (isToManualAnchor ? toAnchor : null);
      routeItems.push({
        coord: manualAnchor ? [manualAnchor.lon, manualAnchor.lat] : coord,
        sourceType: manualAnchor ? "manual" : "street"
      });
    });
  }

  return routeItems;
}

// Berechnet eine Teilstrecke der Route neu
// Benutzer wählt zwei Routenpunkte aus, dazwischen wird neu geroutet
function escapeRerouteDialogHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function findStopsProbablyInRouteSegment(startIndex, endIndex) {
  if (!Array.isArray(state.stops) || !Array.isArray(state.routePoints) || state.routePoints.length === 0) {
    return [];
  }

  return state.stops
    .map(stop => {
      const routeIndex = findNearestRoutePointIndexFrom(0, stop);
      if (routeIndex < startIndex || routeIndex > endIndex) return null;

      const routePoint = state.routePoints[routeIndex];
      const distanceMeters = routePoint ? distanceMetersBetween(stop, routePoint) : null;
      return { stop, routeIndex, distanceMeters };
    })
    .filter(Boolean);
}

function buildRerouteSegmentConfirmMessage(startIndex, endIndex, affectedStops) {
  const replacedRoutePointCount = Math.max(0, endIndex - startIndex - 1);
  const warningText = "Haltestellen werden nicht gel\u00f6scht, aber k\u00f6nnen nach der Umleitung neben der Route liegen.";
  const stopsHtml = affectedStops.length
    ? `<ul style="margin:8px 0 0 18px;padding:0;">${affectedStops.map(({ stop, routeIndex, distanceMeters }) => {
        const distanceText = Number.isFinite(distanceMeters) ? `, ca. ${Math.round(distanceMeters)} m entfernt` : "";
        return `<li>${escapeRerouteDialogHtml(stop.name || stop.id || "Haltestelle")} (Route-Index ${routeIndex}${distanceText})</li>`;
      }).join("")}</ul>`
    : `<p style="margin:8px 0 0 0;">Keine Haltestellen im Abschnitt erkannt.</p>`;

  return `
    <p style="margin:0 0 8px 0;">Der ausgew\u00e4hlte Abschnitt wird nach Best\u00e4tigung neu geroutet.</p>
    <dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 10px 0;">
      <dt>Startpunkt-Index</dt><dd style="margin:0;">${startIndex}</dd>
      <dt>Endpunkt-Index</dt><dd style="margin:0;">${endIndex}</dd>
      <dt>RoutePoints ersetzt</dt><dd style="margin:0;">${replacedRoutePointCount}</dd>
    </dl>
    <div>
      <strong>Vermutlich betroffene Haltestellen</strong>
      ${stopsHtml}
    </div>
    <p style="margin:12px 0 0 0;"><strong>Warnung:</strong> ${warningText}</p>
  `;
}

function findDetourDraftSegment() {
  const draft = state.detourDraft;
  if (!draft) return null;

  const indexA = state.routePoints.findIndex(p => p.id === draft.startRoutePointId);
  const indexB = state.routePoints.findIndex(p => p.id === draft.endRoutePointId);
  if (indexA === -1 || indexB === -1) return null;

  const startIndex = Math.min(indexA, indexB);
  const endIndex = Math.max(indexA, indexB);
  return {
    startIndex,
    endIndex,
    startPoint: state.routePoints[startIndex],
    endPoint: state.routePoints[endIndex]
  };
}

function removeDetourDraftPreview() {
  if (state.detourDraft && state.detourDraft.polyline && map.hasLayer(state.detourDraft.polyline)) {
    map.removeLayer(state.detourDraft.polyline);
  }
}

function startDetourDraftFromSelectedRoutePoints() {
  if (state.routeMode === "detourDraft" && state.detourDraft) {
    setStatus("Umleitung wird bereits gezeichnet.", "warn");
    return;
  }

  if (state.routeMode === "specialTrack" || state.routeMode === "specialTrackExtend") {
    setStatus("Bitte die Sondertrasse zuerst abschlie\u00dfen oder abbrechen.", "warn");
    return;
  }

  if (state.selectedRoutePointIds.size !== 2) {
    setStatus("Bitte genau zwei Routenpunkte als Schnittpunkte ausw\u00e4hlen.", "warn");
    return;
  }

  const ids = Array.from(state.selectedRoutePointIds);
  const indexA = state.routePoints.findIndex(p => p.id === ids[0]);
  const indexB = state.routePoints.findIndex(p => p.id === ids[1]);

  if (indexA === -1 || indexB === -1) {
    setStatus("Schnittpunkte nicht gefunden.", "error");
    return;
  }

  const startIndex = Math.min(indexA, indexB);
  const endIndex = Math.max(indexA, indexB);
  const startPoint = state.routePoints[startIndex];
  const endPoint = state.routePoints[endIndex];

  removeDetourDraftPreview();
  state.detourDraft = {
    startRoutePointId: startPoint.id,
    endRoutePointId: endPoint.id,
    points: [],
    polyline: null
  };
  state.routeMode = "detourDraft";

  refreshDetourDraftPreview();
  updateModeButtons();
  setStatus(`Umleitung zeichnen: Schnittpunkte ${startIndex} bis ${endIndex}. Zwischenpunkte auf der Karte setzen.`);
}

function addDetourDraftPoint(latlng) {
  if (!state.detourDraft) {
    setStatus("Keine aktive Umleitung vorhanden.", "warn");
    return;
  }

  state.detourDraft.points.push([latlng.lat, latlng.lng]);
  refreshDetourDraftPreview();
  setStatus(`Umleitungspunkt hinzugef\u00fcgt (${state.detourDraft.points.length}).`);
}

function refreshDetourDraftPreview() {
  const draft = state.detourDraft;
  if (!draft) return;

  const segment = findDetourDraftSegment();
  if (!segment) {
    removeDetourDraftPreview();
    setStatus("Schnittpunkte der Umleitung nicht mehr gefunden.", "error");
    return;
  }

  removeDetourDraftPreview();
  const previewPoints = [
    [segment.startPoint.lat, segment.startPoint.lon],
    ...draft.points,
    [segment.endPoint.lat, segment.endPoint.lon]
  ];

  draft.polyline = L.polyline(previewPoints, {
    color: "#f59e0b",
    weight: 5,
    dashArray: "8,6"
  }).addTo(map);
}

function buildDetourDraftConfirmMessage(startIndex, endIndex, insertedCount, affectedStops) {
  const replacedRoutePointCount = Math.max(0, endIndex - startIndex - 1);
  const warningText = "Haltestellen werden nicht gel\u00f6scht oder verschoben, k\u00f6nnen nach der Umleitung aber neben der Route liegen.";
  const stopsHtml = affectedStops.length
    ? `<ul style="margin:8px 0 0 18px;padding:0;">${affectedStops.map(({ stop, routeIndex, distanceMeters }) => {
        const distanceText = Number.isFinite(distanceMeters) ? `, ca. ${Math.round(distanceMeters)} m entfernt` : "";
        return `<li>${escapeRerouteDialogHtml(stop.name || stop.id || "Haltestelle")} (Route-Index ${routeIndex}${distanceText})</li>`;
      }).join("")}</ul>`
    : `<p style="margin:8px 0 0 0;">Keine Haltestellen im Abschnitt erkannt.</p>`;

  return `
    <p style="margin:0 0 8px 0;">Der Abschnitt zwischen den Schnittpunkten wird durch die gezeichnete Umleitung ersetzt.</p>
    <dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 10px 0;">
      <dt>Startpunkt-Index</dt><dd style="margin:0;">${startIndex}</dd>
      <dt>Endpunkt-Index</dt><dd style="margin:0;">${endIndex}</dd>
      <dt>RoutePoints ersetzt</dt><dd style="margin:0;">${replacedRoutePointCount}</dd>
      <dt>Umleitungspunkte eingef\u00fcgt</dt><dd style="margin:0;">${insertedCount}</dd>
    </dl>
    <div>
      <strong>Vermutlich betroffene Haltestellen</strong>
      ${stopsHtml}
    </div>
    <p style="margin:12px 0 0 0;"><strong>Warnung:</strong> ${warningText}</p>
  `;
}

async function finishDetourDraft() {
  const draft = state.detourDraft;
  if (!draft) {
    setStatus("Keine aktive Umleitung vorhanden.", "warn");
    return;
  }

  const segment = findDetourDraftSegment();
  if (!segment) {
    setStatus("Schnittpunkte der Umleitung nicht mehr gefunden.", "error");
    return;
  }

  const insertedCount = draft.points.length;
  const affectedStops = findStopsProbablyInRouteSegment(segment.startIndex, segment.endIndex);
  const confirmed = await showConfirmDialog({
    title: "Umleitung \u00fcbernehmen",
    message: buildDetourDraftConfirmMessage(segment.startIndex, segment.endIndex, insertedCount, affectedStops),
    okText: "Umleitung \u00fcbernehmen",
    cancelText: "Abbrechen"
  });

  if (!confirmed) {
    setStatus("Umleitung bleibt im Entwurf. Keine \u00c4nderung an der Route.");
    return;
  }

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Umleitung eingef\u00fcgt");
  }

  const removed = state.routePoints.splice(segment.startIndex + 1, segment.endIndex - segment.startIndex - 1);
  removed.forEach(point => {
    if (point.marker && map.hasLayer(point.marker)) {
      map.removeLayer(point.marker);
    }
  });

  let insertIndex = segment.startIndex + 1;
  draft.points.forEach(([lat, lon]) => {
    createRoutePointObject(lat, lon, true, "manual");
    const createdPoint = state.routePoints.pop();
    state.routePoints.splice(insertIndex, 0, createdPoint);
    insertIndex++;
  });

  removeDetourDraftPreview();
  state.detourDraft = null;
  state.routeMode = "freeStop";

  refreshRouteLine();
  clearRouteMultiSelection();
  applyRoutePointIcons();
  updateStats();
  updateModeButtons();

  setStatus(`Umleitung eingef\u00fcgt: ${insertedCount} Zwischenpunkte, ${removed.length} RoutePoints ersetzt.`);
}

function cancelDetourDraft() {
  if (!state.detourDraft) {
    setStatus("Keine aktive Umleitung vorhanden.", "warn");
    return;
  }

  removeDetourDraftPreview();
  state.detourDraft = null;
  state.routeMode = "freeStop";
  updateModeButtons();
  setStatus("Umleitung abgebrochen. Route unver\u00e4ndert.");
}

async function rerouteSelectedSegment() {
  if (state.selectedRoutePointIds.size !== 2) {
    setStatus("Bitte genau zwei Routenpunkte auswählen.");
    return;
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
  const affectedStops = findStopsProbablyInRouteSegment(startIndex, endIndex);
  const confirmed = await showConfirmDialog({
    title: "Abschnitt pr\u00fcfen & neu routen",
    message: buildRerouteSegmentConfirmMessage(startIndex, endIndex, affectedStops),
    okText: "Neu routen",
    cancelText: "Abbrechen"
  });

  if (!confirmed) {
    setStatus("Teilstrecke neu berechnen abgebrochen.");
    return;
  }

  try {
    setStatus("Teilstrecke wird neu berechnet...");
    debug("Teilstrecke wird neu berechnet", {
      startIndex,
      endIndex,
      selectedPoints: Array.from(state.selectedRoutePointIds),
      affectedStops: affectedStops.map(({ stop, routeIndex, distanceMeters }) => ({
        id: stop.id,
        name: stop.name,
        routeIndex,
        distanceMeters
      }))
    });

    const anchors = state.routePoints
      .slice(startIndex, endIndex + 1)
      .map((point, offset, points) => ({ point, offset, isBoundary: offset === 0 || offset === points.length - 1 }))
      .filter(item => item.isBoundary || item.point.sourceType === "manual")
      .map(item => ({
        lat: item.point.lat,
        lon: item.point.lon,
        name: item.point.sourceType === "manual" ? "Pflichtpunkt" : "Abschnittsgrenze",
        id: item.point.id,
        kind: item.point.sourceType === "manual" ? "manual" : "routeBoundary"
      }));
    const routeItems = await buildEditorStreetRouteItemsViaAnchors(anchors, {
      routingModeLabel: anchors.some(anchor => anchor.kind === "manual") ? "guidedStreet" : "street",
      onSegmentDebug: segmentInfo => debug("Editor Teilrouting-Segment", segmentInfo)
    });

    if (!historyRestoreRunning) {
      pushHistorySnapshot("Teilstrecke neu berechnet");
    }

    const removed = state.routePoints.splice(startIndex + 1, endIndex - startIndex - 1);
    removed.forEach(p => {
      if (p.marker) map.removeLayer(p.marker);
    });

    let insertIndex = startIndex + 1;

    routeItems.slice(1, -1).forEach(item => {
      createRoutePointObject(item.coord[1], item.coord[0], true, item.sourceType);
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

function findStopByAnchor(anchor) {
  if (!anchor || anchor.kind !== "stop") return null;
  return state.stops.find(stop => stop.id === anchor.refId) || null;
}

function buildRoutingStepsFromAnchors(anchors) {
  const steps = [];

  for (let i = 0; i < anchors.length - 1; i++) {
    const from = anchors[i];
    const to = anchors[i + 1];

    if (!from || !to) continue;

    const fromLabel = from.kind === "manual" ? "Pflichtpunkt" : (findStopByAnchor(from)?.name || "Haltestelle");
    const toLabel = to.kind === "manual" ? "Pflichtpunkt" : (findStopByAnchor(to)?.name || "Haltestelle");

    const fromStop = findStopByAnchor(from);
    const toStop = findStopByAnchor(to);

    const match = fromStop && toStop ? findMatchingSpecialTrack(fromStop, toStop) : null;
    if (match) {
      const rawPoints = match.reversed
        ? match.track.points.slice().reverse()
        : match.track.points.slice();

      steps.push({
        type: "track",
        points: [
          [fromStop.lon, fromStop.lat],
          ...rawPoints.map(p => [p[1], p[0]]),
          [toStop.lon, toStop.lat]
        ],
        label: `${fromStop.name} => ${toStop.name}`,
        trackId: match.track.id
      });
      continue;
    }

    steps.push({
      type: "street",
      from: {
        lat: from.lat,
        lon: from.lon,
        name: fromLabel,
        id: from.refId || null,
        kind: from.kind || null
      },
      to: {
        lat: to.lat,
        lon: to.lon,
        name: toLabel,
        id: to.refId || null,
        kind: to.kind || null
      },
      label: `${fromLabel} → ${toLabel}`
    });
  }

  return steps;
}

// Routet nur die zwei Abschnitte um einen neu in der Mitte eingefügten Stop.
// Gibt true zurück wenn erfolgreich, false wenn Fallback auf Vollrouting nötig.
async function rerouteInsertedStop(insertedStopIndex, options = {}) {
  const useManualAnchors = !!options.useManualAnchors;
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

  let nearestNewStopRouteIndex = fromIdx;
  let nearestNewStopDistance = Infinity;
  for (let index = fromIdx; index <= toIdx; index++) {
    const distance = distanceMetersBetween(state.routePoints[index], newStop);
    if (distance < nearestNewStopDistance) {
      nearestNewStopDistance = distance;
      nearestNewStopRouteIndex = index;
    }
  }

  const anchorEntries = [
    {
      order: fromIdx,
      anchor: { lat: prevStop.lat, lon: prevStop.lon, name: prevStop.name, id: prevStop.id, kind: "stop" }
    },
    {
      order: Math.min(toIdx - 0.5, Math.max(fromIdx + 0.5, nearestNewStopRouteIndex + 0.25)),
      anchor: { lat: newStop.lat, lon: newStop.lon, name: newStop.name, id: newStop.id, kind: "stop" }
    },
    {
      order: toIdx,
      anchor: { lat: nextStop.lat, lon: nextStop.lon, name: nextStop.name, id: nextStop.id, kind: "stop" }
    }
  ];

  state.routePoints.slice(fromIdx + 1, toIdx).forEach((point, offset) => {
    if (!useManualAnchors || point.sourceType !== "manual") return;
    anchorEntries.push({
      order: fromIdx + offset + 1,
      anchor: { lat: point.lat, lon: point.lon, name: "Pflichtpunkt", id: point.id, kind: "manual" }
    });
  });

  anchorEntries.sort((a, b) => a.order - b.order);
  const anchors = anchorEntries.map(entry => entry.anchor);
  const routeItems = await buildEditorStreetRouteItemsViaAnchors(anchors, {
    routingModeLabel: useManualAnchors ? "guidedStreet" : "street",
    onSegmentDebug: segmentInfo => debug("Editor Zwischenstopp-Routing-Segment", segmentInfo)
  });

  // Alte Routenpunkte zwischen fromIdx und toIdx (exklusiv) entfernen
  const removed = state.routePoints.splice(fromIdx + 1, toIdx - fromIdx - 1);
  removed.forEach(p => {
    if (p.marker) map.removeLayer(p.marker);
  });

  // Innere Punkte einfügen (ohne ersten und letzten, die sind bereits vorhanden)
  let insertAt = fromIdx + 1;
  for (const item of routeItems.slice(1, -1)) {
    createRoutePointObject(item.coord[1], item.coord[0], true, item.sourceType);
    const created = state.routePoints.pop();
    state.routePoints.splice(insertAt, 0, created);
    insertAt++;
  }

  return true;
}

function buildManualRouteFromStopsAndAnchors() {
  const hasExistingRoute = Array.isArray(state.routePoints) && state.routePoints.length > 0;
  const anchors = hasExistingRoute
    ? buildRoutingAnchorsFromCurrentRoute()
    : state.stops.map(stop => ({
        lat: stop.lat,
        lon: stop.lon,
        name: stop.name,
        id: stop.id,
        kind: "stop"
      }));

  if (anchors.length < 2) {
    setStatus("Punktführung benötigt mindestens zwei Anker.", "warn");
    return;
  }

  const coords = interpolateManualRouteCoords(anchors, 20);
  const manualCoordKeys = new Set(
    anchors
      .filter(anchor => anchor.kind === "manual")
      .map(anchor => `${Number(anchor.lon).toFixed(7)}:${Number(anchor.lat).toFixed(7)}`)
  );

  if (!historyRestoreRunning) {
    pushHistorySnapshot("Punktführung erzeugt");
  }

  removeAllRoutePointMarkers();
  coords.forEach(coord => {
    const coordKey = `${Number(coord[0]).toFixed(7)}:${Number(coord[1]).toFixed(7)}`;
    createRoutePointObject(
      coord[1],
      coord[0],
      true,
      manualCoordKeys.has(coordKey) ? "manual" : "street"
    );
  });

  state.routeMode = "manual";
  state.simplifiedRoutePoints = [];
  state.previewMode = "original";
  state.lastRoutedStopCount = state.stops.length;
  state.lastRoutedStopIds = state.stops.map(stop => stop.id);
  refreshRouteLine();
  applyRoutePointIcons();
  updateModeButtons();
  updateStats();
  updateRouteStats();
  setStatus("Punktführung erfolgreich erzeugt.");
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

  const selectedRoutingMode = normalizeEditorRoutingMode(state.routingMode);
  if (selectedRoutingMode === "manual") {
    buildManualRouteFromStopsAndAnchors();
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
        const ok = await rerouteInsertedStop(insertedIdx, {
          useManualAnchors: selectedRoutingMode === "guidedStreet"
        });
        if (ok) {
          state.routeMode = "street";
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

  const existingRoutingAnchors = !appendMode && hasExistingRoute
    ? buildRoutingAnchorsFromCurrentRoute()
    : [];
  const useManualAnchors =
    selectedRoutingMode === "guidedStreet" &&
    existingRoutingAnchors.some(anchor => anchor.kind === "manual");

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

    const allCoords = [];
    const steps = useManualAnchors
      ? buildRoutingStepsFromAnchors(existingRoutingAnchors)
      : buildForcedRoutingSteps(stopsToBuild);

    if (useManualAnchors) {
      setStatus("Manuelle Pflichtpunkte erkannt: Straßenrouting wird abschnittsweise über die Pflichtpunkte berechnet.");
    }

    debug("Erzwungene Routing-Schritte", steps);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === "track") {
        setStatus(`Sondertrasse verwende Abschnitt ${i + 1}/${steps.length}: ${step.label}`);

        step.points.forEach((coord, idx) => {
          if (allCoords.length && idx === 0) return;
          allCoords.push({
            coord,
            sourceType: "street"
          });
        });

        continue;
      }

      setStatus(`Straßenroute berechne Abschnitt ${i + 1}/${steps.length}: ${step.label}`);

      let segmentItems;
      try {
        segmentItems = await buildEditorStreetRouteItemsViaAnchors(
          [step.from, step.to],
          {
            routingModeLabel: useManualAnchors ? "guidedStreet" : "street",
            onSegmentDebug: segmentInfo => debug("Editor Routing-Segment", segmentInfo)
          }
        );
      } catch (segErr) {
        if (segErr.name === "AbortError") throw segErr; // Nutzer-Abbruch durchreichen
        if (useManualAnchors) throw segErr;
        // Gerade Linie als Fallback, Rest der Route wird trotzdem berechnet
        debug(`Abschnitt ${i + 1} fehlgeschlagen, nutze gerade Linie als Fallback`, segErr.message);
        setStatus(`⚠ Abschnitt ${i + 1}/${steps.length} nicht routbar – gerade Linie eingesetzt.`, "warn");
        segmentItems = [
          { coord: [step.from.lon, step.from.lat], sourceType: "street" },
          { coord: [step.to.lon, step.to.lat], sourceType: "street" }
        ];
      }

      segmentItems.forEach((item, idx) => {
        if (allCoords.length && idx === 0) return;
        allCoords.push(item);
      });
    }

    const coordsToCreate =
      appendMode && allCoords.length > 1
        ? allCoords.slice(1)
        : allCoords;

    if (!historyRestoreRunning) {
      pushHistorySnapshot("Straßenroute erzeugt");
    }

    if (!appendMode) {
      removeAllRoutePointMarkers();
      state.simplifiedRoutePoints = [];
    }

    coordsToCreate.forEach(item => {
      const lon = item.coord[0];
      const lat = item.coord[1];
      createRoutePointObject(lat, lon, true, item.sourceType || "street");
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
