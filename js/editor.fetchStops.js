// =============================================
// editor.fetchStops.js
// Haltestellen-Katalog über PHP/Server aktualisieren
// (Funktioniert nur auf dem echten Webserver mit PHP)
// =============================================

(function () {
  // --- DOM-Referenzen ---
  const modal        = document.getElementById("fetchStopsModal");
  const openBtn      = document.getElementById("openFetchStopsModalBtn");
  const closeBtn     = document.getElementById("fetchStopsCloseBtn");
  const cityInput    = document.getElementById("fetchStopsCity");
  const geoBtn       = document.getElementById("fetchStopsGeoBtn");
  const latInput     = document.getElementById("fetchStopsLat");
  const lonInput     = document.getElementById("fetchStopsLon");
  const radiusSelect = document.getElementById("fetchStopsRadius");
  const saveCheckbox = document.getElementById("fetchStopsSave");
  const snapRoadCheckbox = document.getElementById("fetchStopsSnapRoad");
  const snapMaxDistanceSelect = document.getElementById("fetchStopsSnapMaxM");
  const startBtn     = document.getElementById("fetchStopsStartBtn");
  const statusDiv    = document.getElementById("fetchStopsStatus");

  if (!modal || !openBtn) return;

  // Sicherheitsnetz: stopCatalog muss immer ein Array sein
  if (typeof stopCatalog === "undefined") {
    window.stopCatalog = [];
  }

  function getModeValue() {
    const el = document.querySelector('input[name="fetchStopsMode"]:checked');
    return el ? el.value : "add";
  }

  // --- Modal öffnen / schließen ---
  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    cityInput.focus();
  });

  closeBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
    setStatus("", "");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
      setStatus("", "");
    }
  });

  // --- Hilfsfunktionen ---
  function setStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = "fetch-stops-status" + (type ? " " + type : "");
  }

  function setBusy(busy) {
    startBtn.disabled = busy;
    geoBtn.disabled   = busy;
    startBtn.textContent = busy ? "Wird geladen..." : "Katalog laden";
  }

  async function snapStopToRoad(stop, maxDistanceMeters) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const url =
        "https://router.project-osrm.org/nearest/v1/driving/" +
        encodeURIComponent(stop.lon + "," + stop.lat) +
        "?number=1";

      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal
      });

      if (!res.ok) return null;
      const json = await res.json();
      if (!json || json.code !== "Ok" || !Array.isArray(json.waypoints) || !json.waypoints.length) {
        return null;
      }

      const waypoint = json.waypoints[0];
      const distance = Number(waypoint.distance || 0);
      const location = waypoint.location;

      if (!Array.isArray(location) || location.length < 2) return null;
      if (!Number.isFinite(distance) || distance > maxDistanceMeters) return null;

      return {
        lat: Number(location[1]),
        lon: Number(location[0]),
        distance
      };
    } catch (_err) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function snapStopsToRoad(stops, maxDistanceMeters, progressCb) {
    const output = stops.map(s => ({ ...s }));
    const concurrency = 8;
    let cursor = 0;
    let done = 0;
    let snapped = 0;

    async function worker() {
      while (cursor < output.length) {
        const idx = cursor++;
        const stop = output[idx];
        const snap = await snapStopToRoad(stop, maxDistanceMeters);
        if (snap) {
          stop.originalLat = stop.lat;
          stop.originalLon = stop.lon;
          stop.lat = Number(snap.lat.toFixed(6));
          stop.lon = Number(snap.lon.toFixed(6));
          stop.snappedToRoad = true;
          stop.snapDistanceM = Number(snap.distance.toFixed(1));
          snapped++;
        }
        done++;
        if (typeof progressCb === "function") progressCb(done, output.length, snapped);
      }
    }

    const workers = [];
    const limit = Math.max(1, Math.min(concurrency, output.length));
    for (let i = 0; i < limit; i++) workers.push(worker());
    await Promise.all(workers);

    return { stops: output, snapped };
  }

  // Haversine-Distanz in Metern (identisch zur Python-Logik)
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function normalizedDirection(stop) {
    if (!stop || typeof stop !== "object") return "";
    const raw = [stop.direction, stop.dir, stop.towards, stop.destination]
      .find(v => typeof v === "string" && v.trim().length > 0) || "";
    return raw.trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Begrenzt nahe Duplikate pro Name+Richtung auf maximal 1 Eintrag.
  function dedupeNearbyPerDirection(stops, radiusM) {
    const result = [];
    const byKey = new Map();
    let removed = 0;

    for (const item of stops) {
      const stop = { ...item };
      const nameKey = String(stop.name || "").trim().toLowerCase();
      const dirKey = normalizedDirection(stop);

      if (!nameKey || !dirKey) {
        result.push(stop);
        continue;
      }

      const key = nameKey + "::" + dirKey;
      const candidateIdx = byKey.get(key) || [];
      let merged = false;

      for (const idx of candidateIdx) {
        const ex = result[idx];
        const d = haversineMeters(ex.lat, ex.lon, stop.lat, stop.lon);
        if (d <= radiusM) {
          const n = Number(ex.sourceCount || 1);
          const m = Number(stop.sourceCount || 1);
          ex.lat = (ex.lat * n + stop.lat * m) / (n + m);
          ex.lon = (ex.lon * n + stop.lon * m) / (n + m);
          ex.sourceCount = n + m;
          if (!ex.direction && stop.direction) ex.direction = stop.direction;
          removed++;
          merged = true;
          break;
        }
      }

      if (!merged) {
        result.push(stop);
        const list = byKey.get(key) || [];
        list.push(result.length - 1);
        byKey.set(key, list);
      }
    }

    return { stops: result, removed };
  }

  // Fallback fuer OSM-Daten ohne Richtungs-Tag:
  // Pro Name/Cluster bleiben nur Nord- und Suedpunkt erhalten.
  function reduceUnnamedDirectionToNorthSouth(stops, clusterRadiusM, minNorthSouthSpanM) {
    const output = [];
    const byName = new Map();
    let removed = 0;

    for (const s of stops) {
      const copy = { ...s };
      const nameKey = String(copy.name || "").trim().toLowerCase();
      const dirKey = normalizedDirection(copy);

      if (!nameKey || dirKey) {
        output.push(copy);
        continue;
      }

      const list = byName.get(nameKey) || [];
      list.push(copy);
      byName.set(nameKey, list);
    }

    for (const sameNameStops of byName.values()) {
      const clusters = [];

      for (const s of sameNameStops) {
        let assigned = false;
        for (const cluster of clusters) {
          const nearAny = cluster.some(c => haversineMeters(c.lat, c.lon, s.lat, s.lon) <= clusterRadiusM);
          if (nearAny) {
            cluster.push(s);
            assigned = true;
            break;
          }
        }
        if (!assigned) clusters.push([s]);
      }

      for (const cluster of clusters) {
        if (cluster.length <= 2) {
          output.push(...cluster);
          continue;
        }

        const sorted = cluster.slice().sort((a, b) => b.lat - a.lat);
        const north = sorted[0];
        const south = sorted[sorted.length - 1];
        const spanM = haversineMeters(north.lat, north.lon, south.lat, south.lon);

        if (spanM < minNorthSouthSpanM) {
          output.push(north);
          removed += cluster.length - 1;
        } else {
          output.push(north, south);
          removed += cluster.length - 2;
        }
      }
    }

    return { stops: output, removed };
  }

  // Neue Haltestellen in bestehenden Katalog mergen (8m-Radius, gleicher Name)
  function mergeIntoExisting(existing, incoming, mergeRadiusM) {
    mergeRadiusM = mergeRadiusM || 8;
    const result = existing.slice();
    let added = 0, merged = 0;
    for (const ns of incoming) {
      let found = false;
      for (const ex of result) {
        const exDir = normalizedDirection(ex);
        const nsDir = normalizedDirection(ns);
        const dirsCompatible = (exDir && nsDir) ? exDir === nsDir : true;

        if (dirsCompatible && ex.name === ns.name && haversineMeters(ex.lat, ex.lon, ns.lat, ns.lon) <= mergeRadiusM) {
          const n = ex.sourceCount || 1;
          ex.lat = (ex.lat * n + ns.lat) / (n + 1);
          ex.lon = (ex.lon * n + ns.lon) / (n + 1);
          ex.sourceCount = n + 1;
          if (!ex.direction && ns.direction) ex.direction = ns.direction;
          found = true;
          merged++;
          break;
        }
      }
      if (!found) {
        result.push(Object.assign({}, ns, { id: "hst_dyn_" + result.length }));
        added++;
      }
    }
    return { result, added, merged };
  }

  // --- Geocoding: Nominatim ---
  geoBtn.addEventListener("click", async () => {
    const city = cityInput.value.trim();
    if (!city) { setStatus("Bitte Ortsnamen eingeben.", "error"); return; }
    setStatus("Suche Koordinaten...", "");
    geoBtn.disabled = true;
    try {
      const res = await fetch(
        "https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(city) + "&format=json&limit=1",
        { headers: { "Accept-Language": "de" } }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.length) { setStatus("Ort nicht gefunden.", "error"); return; }
      latInput.value = parseFloat(data[0].lat).toFixed(4);
      lonInput.value = parseFloat(data[0].lon).toFixed(4);
      setStatus("Koordinaten fuer \"" + data[0].display_name.split(",")[0] + "\" gefunden.", "success");
    } catch (err) {
      setStatus("Geocoding fehlgeschlagen: " + err.message, "error");
    } finally {
      geoBtn.disabled = false;
    }
  });

  cityInput.addEventListener("keydown", (e) => { if (e.key === "Enter") geoBtn.click(); });

  // --- Katalog laden (ueber PHP-Backend) ---
  startBtn.addEventListener("click", async () => {
    const lat    = parseFloat(latInput.value);
    const lon    = parseFloat(lonInput.value);
    const radius = parseInt(radiusSelect.value, 10);
    const mode   = getModeValue();
    const snapToRoad = !!(snapRoadCheckbox && snapRoadCheckbox.checked);
    const snapMaxM = Math.max(5, Math.min(60, parseInt(snapMaxDistanceSelect?.value || "20", 10) || 20));

    if (isNaN(lat) || isNaN(lon)) {
      setStatus("Bitte Koordinaten eingeben oder per Suche ermitteln.", "error");
      return;
    }

    setBusy(true);
    const modeLabel = mode === "add"
      ? "Füge Haltestellen hinzu (Radius " + radius + " km)…"
      : "Ersetze Katalog (Radius " + radius + " km)…";
    setStatus(modeLabel + " Das kann 30–120 Sekunden dauern, bitte warten.", "");

    const body = new FormData();
    body.append("lat",    lat);
    body.append("lon",    lon);
    body.append("radius", radius);
    // Beim Merge zuerst nicht speichern – erst nach dem clientseitigen Merge speichern
    body.append("save",   (saveCheckbox.checked && mode === "replace") ? "1" : "0");

    try {
      const res = await fetch(API_BASE + "/fetch_stops.php", {
        method: "POST",
        headers: withApiAuthHeaders(),
        body
      });

      if (!res.ok) {
        const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
        if (isLocal) {
          setStatus("Lokal nicht verfuegbar - bitte auf dem Webserver ausfuehren.", "error");
        } else if (res.status === 404) {
          setStatus("api/fetch_stops.php nicht gefunden - bitte Datei auf den Server hochladen.", "error");
        } else {
          let msg = "Serverfehler (HTTP " + res.status + ")";
          try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
          setStatus("Fehler: " + msg, "error");
        }
        return;
      }

      const json = await res.json();
      if (json.error) {
        setStatus("Fehler: " + json.error, "error");
        return;
      }

      let finalCount, statusNote;
      let incomingStops = Array.isArray(json.stops) ? json.stops.slice() : [];

      const directionDedupe = dedupeNearbyPerDirection(incomingStops, 45);
      incomingStops = directionDedupe.stops;
      if (directionDedupe.removed > 0) {
        statusNote = (statusNote ? statusNote + " · " : "") +
          directionDedupe.removed + " Richtungs-Duplikate entfernt";
      }

      const northSouthFallback = reduceUnnamedDirectionToNorthSouth(incomingStops, 180, 15);
      incomingStops = northSouthFallback.stops;
      if (northSouthFallback.removed > 0) {
        statusNote = (statusNote ? statusNote + " · " : "") +
          northSouthFallback.removed + " ohne Richtung auf Nord/Sued reduziert";
      }

      if (snapToRoad && incomingStops.length) {
        setStatus(
          "Ausrichtung auf Fahrbahnmitte läuft: 0/" + incomingStops.length + " ...",
          ""
        );

        const snapResult = await snapStopsToRoad(incomingStops, snapMaxM, (done, total, snapped) => {
          setStatus(
            "Ausrichtung auf Fahrbahnmitte: " + done + "/" + total + " · " + snapped + " angepasst",
            ""
          );
        });

        incomingStops = snapResult.stops;
        statusNote = (statusNote ? statusNote + " · " : "") + snapResult.snapped + " auf Fahrbahn ausgerichtet";
      }

      if (mode === "add") {
        // Merge: neue Haltestellen in bestehenden Katalog integrieren
        const existing = stopCatalog.slice();
        const { result, added, merged } = mergeIntoExisting(existing, incomingStops);
        stopCatalog.length = 0;
        for (const s of result) stopCatalog.push(s);
        finalCount = result.length;
        const mergeNote = added + " neu hinzugefügt, " + merged + " zusammengeführt";
        statusNote = statusNote ? mergeNote + " · " + statusNote : mergeNote;

        // Bei Merge + Speichern: gesamten gemergten Katalog separat an Server senden
        if (saveCheckbox.checked && finalCount > 0) {
          try {
            const saveBody = new FormData();
            saveBody.append("catalog", JSON.stringify(stopCatalog));
            const saveRes = await fetch(API_BASE + "/save_catalog.php", {
              method: "POST",
              headers: withApiAuthHeaders(),
              body: saveBody
            });
            if (!saveRes.ok) throw new Error("HTTP " + saveRes.status);
            statusNote += " · als haltestellen.js gespeichert";
          } catch (saveErr) {
            statusNote += " · Speichern fehlgeschlagen: " + saveErr.message;
          }
        }
      } else {
        // Ersetzen (altes Verhalten)
        stopCatalog.length = 0;
        for (const s of incomingStops) stopCatalog.push(s);
        finalCount = json.count;
        const replaceNote = json.saveError
          ? "Speichern fehlgeschlagen: " + json.saveError
          : saveCheckbox.checked ? "als haltestellen.js gespeichert" : "";
        statusNote = statusNote
          ? [replaceNote, statusNote].filter(Boolean).join(" · ")
          : replaceNote;
      }

      // Karte aktualisieren
      if (typeof clearVisibleCatalogMarkers === "function") clearVisibleCatalogMarkers();
      if (typeof scheduleCatalogMarkerVisibilityUpdate === "function") scheduleCatalogMarkerVisibilityUpdate();
      if (typeof updateUI === "function") updateUI();

      const rawInfo = (json.rawCount !== undefined && json.rawCount !== json.count)
        ? " (" + json.rawCount + " OSM-Einträge)" : "";
      setStatus(
        "OK: " + finalCount + " Haltestellen im Katalog" + rawInfo +
        (statusNote ? " · " + statusNote : "") + ".",
        "success"
      );

    } catch (err) {
      setStatus("Netzwerkfehler: " + err.message, "error");
    } finally {
      setBusy(false);
    }
  });

})();

