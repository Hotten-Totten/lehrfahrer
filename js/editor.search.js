// =========================
// SEARCH / CATALOG
// Datei: editor.search.js
// =========================

// ---------- Sichtbarkeit ----------

// Vereinheitlicht Typwerte für robuste Vergleiche.
function normalizeStopType(type) {
  return String(type || "").toLowerCase().trim();
}

// Filtert auf die im Editor sichtbaren Katalog-Haltestellentypen.
function isCatalogStopVisible(catalogStop) {
  const type = normalizeStopType(catalogStop?.type);

  return [
    "bus",
    "tram",
    "bus_tram",
    "mixed"
  ].includes(type);
}

// Liefert das passende Icon (normal oder hervorgehoben).
function getCatalogIconForStop(catalogStop, highlighted = false) {
  const type = normalizeStopType(catalogStop?.type);
  const iconStop = {
    sourceType: "catalog",
    type,
    direction: catalogStop?.direction || "",
    directionHint: catalogStop?.directionHint || "",
    towards: catalogStop?.towards || "",
    destination: catalogStop?.destination || "",
    local_ref: catalogStop?.local_ref || ""
  };
  const size = highlighted ? 24 : 20;

  if (type === "bus") {
    return createTransitStopIcon(iconStop, size);
  }

  if (type === "tram") {
    return createTransitStopIcon(iconStop, size);
  }

  if (type === "bus_tram" || type === "mixed") {
    return createTransitStopIcon(iconStop, size);
  }

  if (highlighted) {
    return ICONS.catalogHighlight || ICONS.catalog;
  }

  return ICONS.catalog;
}
// ---------- Marker Handling ----------

let catalogUpdateTimer = null;

// Erstellt einen Katalog-Marker inklusive Popup/Tooltip und Klickverhalten.
function createCatalogMarker(catalogStop) {
  const marker = L.marker([catalogStop.lat, catalogStop.lon], {
    icon: getCatalogIconForStop(catalogStop, false),
    title: catalogStop.name || "Haltestelle"
  });

  marker.bindPopup(
    "<b>" + (catalogStop.name || "Unbenannte Haltestelle") + "</b><br>" +
    "ID: " + (catalogStop.id || "-") + "<br>" +
    "Typ: " + (catalogStop.type || "unbekannt") + "<br>" +
    "<small>Klick im Modus 'Haltestelle', um sie zur Linie hinzuzufügen.</small>"
  );

  marker.bindTooltip(
    catalogStop.name || "Haltestelle",
    {
      permanent: true,
      direction: "top",
      offset: [0, -10],
      opacity: 0.9,
      className: "catalog-stop-tooltip"
    }
  );

  marker.on("click", function () {
    if (mode !== "catalogStop" && mode !== "freeStop") {
      setStatus("Zum Übernehmen bitte den Modus 'Haltestelle' aktivieren.");
      return;
    }

    addCatalogStopToLine(catalogStop);
  });

  return marker;
}

// Initialer Markeraufbau (delegiert an die Sichtbarkeitslogik).
function createCatalogMarkers() {
  updateCatalogMarkerVisibilityNow();
}

function clearVisibleCatalogMarkers() {
  state.visibleCatalogMarkers.forEach(marker => {
    if (!marker) return;

    if (catalogCluster) {
      catalogCluster.removeLayer(marker);
    } else if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  state.visibleCatalogMarkers.clear();
}

// ---------- Sichtbare Marker ----------

// Aktualisiert Marker entsprechend Zoom und Kartenausschnitt.
function updateCatalogMarkerVisibilityNow() {
  const currentZoom = map.getZoom();

  if (currentZoom < CATALOG_MIN_ZOOM) {
    clearVisibleCatalogMarkers();
    return;
  }

  const bounds = map.getBounds();
  const visibleIds = new Set();

  for (const catalogStop of stopCatalog) {
    if (!isCatalogStopVisible(catalogStop)) continue;
    if (typeof catalogStop.lat !== "number" || typeof catalogStop.lon !== "number") continue;

    const latlng = L.latLng(catalogStop.lat, catalogStop.lon);

    if (!bounds.contains(latlng)) continue;

    visibleIds.add(catalogStop.id);

    if (!state.visibleCatalogMarkers.has(catalogStop.id)) {
      const marker = createCatalogMarker(catalogStop);
      state.visibleCatalogMarkers.set(catalogStop.id, marker);

      if (catalogCluster) {
        catalogCluster.addLayer(marker);
      } else {
        marker.addTo(map);
      }
    }
  }

  const toRemove = [];

  state.visibleCatalogMarkers.forEach((marker, stopId) => {
    if (!visibleIds.has(stopId)) {
      toRemove.push(stopId);
    }
  });

  toRemove.forEach(stopId => {
    const marker = state.visibleCatalogMarkers.get(stopId);
    if (!marker) return;

    if (catalogCluster) {
      catalogCluster.removeLayer(marker);
    } else if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }

    state.visibleCatalogMarkers.delete(stopId);
  });
}

// Entprellt Marker-Updates bei schnellen Kartenbewegungen.
function scheduleCatalogMarkerVisibilityUpdate() {
  if (catalogUpdateTimer) {
    clearTimeout(catalogUpdateTimer);
  }

  catalogUpdateTimer = setTimeout(() => {
    updateCatalogMarkerVisibilityNow();
    catalogUpdateTimer = null;
  }, 120);
}

// Öffentliche Update-Funktion für Event-Handler.
function updateCatalogMarkerVisibility() {
  scheduleCatalogMarkerVisibilityUpdate();
}

// ---------- Suche ----------

// Normalisiert Suchtext (Kleinbuchstaben, Akzente/Zeichen bereinigt).
function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

  // Leert die Trefferliste und blendet sie aus.
function clearSearchResults() {
  searchResults.innerHTML = "";
  searchResults.classList.add("hidden");
}

// Hebt einen sichtbaren Marker temporär visuell hervor.
function highlightCatalogMarker(catalogStop) {
  if (
    state.highlightedCatalogMarkerId &&
    state.visibleCatalogMarkers.has(state.highlightedCatalogMarkerId)
  ) {
    const oldMarker = state.visibleCatalogMarkers.get(state.highlightedCatalogMarkerId);
    const oldStop = stopCatalog.find(stop => stop.id === state.highlightedCatalogMarkerId);

    if (oldMarker) {
      oldMarker.setIcon(getCatalogIconForStop(oldStop || {}, false));
    }
  }

  const marker = state.visibleCatalogMarkers.get(catalogStop.id);
  if (!marker) return;

  marker.setIcon(getCatalogIconForStop(catalogStop, true));
  state.highlightedCatalogMarkerId = catalogStop.id;

  setTimeout(() => {
    if (
      state.highlightedCatalogMarkerId === catalogStop.id &&
      state.visibleCatalogMarkers.has(catalogStop.id)
    ) {
      const currentMarker = state.visibleCatalogMarkers.get(catalogStop.id);
      if (currentMarker) {
        currentMarker.setIcon(getCatalogIconForStop(catalogStop, false));
      }
      state.highlightedCatalogMarkerId = null;
    }
  }, 4000);
}

// Springt zur Haltestelle auf der Karte und öffnet Popup wenn verfügbar.
function jumpToCatalogStop(catalogStop) {
  map.setView([catalogStop.lat, catalogStop.lon], 18);

  setTimeout(() => {
    updateCatalogMarkerVisibilityNow();
    highlightCatalogMarker(catalogStop);

    const marker = state.visibleCatalogMarkers.get(catalogStop.id);
    if (marker) {
      marker.openPopup();
    }
  }, 150);
}

// Rendert Suchtrefferliste inkl. Click-Handling.
function renderSearchResults(results) {
  searchResults.innerHTML = "";

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "search-result-item";
    empty.textContent = "Keine Treffer.";
    searchResults.appendChild(empty);
    searchResults.classList.remove("hidden");
    return;
  }

  results.forEach(stop => {
    const item = document.createElement("div");
    item.className = "search-result-item";

    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = stop.name || "Unbenannte Haltestelle";

    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    meta.textContent =
      `Typ: ${stop.type || "unbekannt"} | ${Number(stop.lat).toFixed(5)}, ${Number(stop.lon).toFixed(5)}`;

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener("click", function () {
      jumpToCatalogStop(stop);

      if (mode === "catalogStop" || mode === "freeStop") {
        const addedStop = addCatalogStopToLine(stop);
        if (addedStop) {
          selectStop(addedStop);
        }
        setStatus(`Haltestelle übernommen: ${stop.name}`);
      } else {
        setStatus(`Karte zu Haltestelle gesprungen: ${stop.name}`);
      }

      stopSearchInput.value = stop.name || "";
      clearSearchResults();
    });

    searchResults.appendChild(item);
  });

  searchResults.classList.remove("hidden");
}

// Führt eine Suche im Katalog aus und sortiert Treffer priorisiert.
function performSearch(query) {
  const q = normalizeSearchText(query);

  if (!q) {
    clearSearchResults();
    return;
  }

  const results = stopCatalog
    .filter(stop => {
      if (!isCatalogStopVisible(stop)) return false;
      if (!stop.name) return false;

      const name = normalizeSearchText(stop.name);
      return name.includes(q);
    })
    .sort((a, b) => {
      const aName = normalizeSearchText(a.name);
      const bName = normalizeSearchText(b.name);

      const aStarts = aName.startsWith(q) ? 0 : 1;
      const bStarts = bName.startsWith(q) ? 0 : 1;

      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name, "de");
    })
    .slice(0, 20);

  renderSearchResults(results);
}