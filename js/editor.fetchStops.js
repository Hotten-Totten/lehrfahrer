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

  // Neue Haltestellen in bestehenden Katalog mergen (8m-Radius, gleicher Name)
  function mergeIntoExisting(existing, incoming, mergeRadiusM) {
    mergeRadiusM = mergeRadiusM || 8;
    const result = existing.slice();
    let added = 0, merged = 0;
    for (const ns of incoming) {
      let found = false;
      for (const ex of result) {
        if (ex.name === ns.name && haversineMeters(ex.lat, ex.lon, ns.lat, ns.lon) <= mergeRadiusM) {
          const n = ex.sourceCount || 1;
          ex.lat = (ex.lat * n + ns.lat) / (n + 1);
          ex.lon = (ex.lon * n + ns.lon) / (n + 1);
          ex.sourceCount = n + 1;
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

      if (mode === "add") {
        // Merge: neue Haltestellen in bestehenden Katalog integrieren
        const existing = stopCatalog.slice();
        const { result, added, merged } = mergeIntoExisting(existing, json.stops);
        stopCatalog.length = 0;
        for (const s of result) stopCatalog.push(s);
        finalCount = result.length;
        statusNote = added + " neu hinzugefügt, " + merged + " zusammengeführt";

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
        for (const s of json.stops) stopCatalog.push(s);
        finalCount = json.count;
        statusNote = json.saveError
          ? "Speichern fehlgeschlagen: " + json.saveError
          : saveCheckbox.checked ? "als haltestellen.js gespeichert" : "";
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

