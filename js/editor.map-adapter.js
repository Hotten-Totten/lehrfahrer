// MapLibre-Grundlage fuer die schrittweise Editor-Migration.
// Der Schalter bleibt aus; Leaflet bleibt der aktive Renderer.
(function exposeEditorMapAdapter(global) {
  "use strict";

  const MAPLIBRE_MIGRATION_DEFAULT = false;
  const MAPLIBRE_MIGRATION_ENABLED = MAPLIBRE_MIGRATION_DEFAULT
    || (global.location && new URLSearchParams(global.location.search).get("maplibreTest") === "1");
  const TEST_CONTAINER_ID = "mapLibreTestMap";
  const TEST_LABEL_ID = "mapLibreTestLabel";
  const LEAFLET_TEST_LABEL_ID = "leafletTestLabel";
  const TEST_CLOSE_BUTTON_ID = "mapLibreTestCloseBtn";
  const LEAFLET_TO_MAPLIBRE_ZOOM_OFFSET = -1;
  const DEFAULT_CENTER = [14.33, 51.76];
  const DEFAULT_ZOOM = 13;
  const LINE_DEFINITIONS = Object.freeze({
    route: Object.freeze({
      sourceId: "editor-route-source",
      layerId: "editor-route-line",
      paint: Object.freeze({
        "line-color": "#2563eb",
        "line-width": 5,
        "line-opacity": 1
      })
    }),
    preview: Object.freeze({
      sourceId: "editor-preview-source",
      layerId: "editor-preview-line",
      paint: Object.freeze({
        "line-color": "#2563eb",
        "line-width": 6,
        "line-opacity": 1
      })
    })
  });
  const STOP_SOURCE_ID = "editor-stops-source";
  const STOP_LAYER_ID = "editor-stops-circle";
  const ROUTE_POINT_SOURCE_ID = "editor-route-points-source";
  const ROUTE_POINT_LAYER_ID = "editor-route-points-circle";
  let managedMap = null;
  let managedContainer = null;
  let managedOverrides = null;
  let lineMirrorTimer = null;
  let leafletViewportMap = null;
  let leafletViewportHandler = null;
  let viewportSyncFrame = null;
  let testCloseButtonBound = false;
  const mirroredLineSignatures = {
    route: null,
    preview: null
  };
  let mirroredStopsSignature = null;
  let desiredStopsData = { type: "FeatureCollection", features: [] };
  let mirroredRoutePointsSignature = null;
  let desiredRoutePointsData = { type: "FeatureCollection", features: [] };

  function toMapLibreLngLat(pointOrLat, optionalLon) {
    if (Number.isFinite(pointOrLat) && Number.isFinite(optionalLon)) {
      return [optionalLon, pointOrLat];
    }
    if (Array.isArray(pointOrLat) && pointOrLat.length >= 2) {
      return [pointOrLat[1], pointOrLat[0]];
    }
    if (pointOrLat && Number.isFinite(pointOrLat.lat)) {
      const lon = Number.isFinite(pointOrLat.lon) ? pointOrLat.lon : pointOrLat.lng;
      if (Number.isFinite(lon)) return [lon, pointOrLat.lat];
    }
    return null;
  }

  function toEditorLatLon(lngLat) {
    if (Array.isArray(lngLat) && lngLat.length >= 2) {
      return [lngLat[1], lngLat[0]];
    }
    if (lngLat && Number.isFinite(lngLat.lat)) {
      const lon = Number.isFinite(lngLat.lng) ? lngLat.lng : lngLat.lon;
      if (Number.isFinite(lon)) return [lngLat.lat, lon];
    }
    return null;
  }

  function createOpenFreeMapStyle() {
    return {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        ofm: {
          type: "vector",
          url: "https://tiles.openfreemap.org/planet"
        }
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#edf1f7" } },
        {
          id: "water", type: "fill", source: "ofm", "source-layer": "water",
          paint: { "fill-color": "#cfe0ff" }
        },
        {
          id: "landuse-green", type: "fill", source: "ofm", "source-layer": "landuse",
          filter: ["in", "class", "grass", "park", "forest"],
          paint: { "fill-color": "#e4eddc", "fill-opacity": 0.9 }
        },
        {
          id: "road-minor", type: "line", source: "ofm", "source-layer": "transportation",
          filter: ["in", "class", "minor", "service", "track"],
          paint: {
            "line-color": "#b7becd",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.9, 16, 2]
          }
        },
        {
          id: "road-main", type: "line", source: "ofm", "source-layer": "transportation",
          filter: ["in", "class", "primary", "secondary", "tertiary", "trunk", "residential", "unclassified", "living_street"],
          paint: {
            "line-color": "#8b97b0",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 16, 4.8]
          }
        },
        {
          id: "road-motorway", type: "line", source: "ofm", "source-layer": "transportation",
          filter: ["==", "class", "motorway"],
          paint: {
            "line-color": "#6f7ad6",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 16, 6.4]
          }
        },
        {
          id: "building", type: "fill", source: "ofm", "source-layer": "building", minzoom: 14,
          paint: { "fill-color": "#e1e5ef", "fill-outline-color": "#c7cfde" }
        },
        {
          id: "road-name", type: "symbol", source: "ofm", "source-layer": "transportation_name",
          minzoom: 12,
          maxzoom: 20,
          filter: ["has", "name"],
          layout: {
            "symbol-placement": "line",
            "text-field": ["coalesce", ["get", "name:de"], ["get", "name"]],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 12, 8, 14, 11, 16, 14, 18, 16],
            "text-letter-spacing": 0.05,
            "text-max-angle": 30
          },
          paint: {
            "text-color": ["interpolate", ["linear"], ["zoom"], 12, "#1a2847", 14, "#1a2847", 16, "#333333"],
            "text-halo-color": "rgba(255,255,255,0.9)",
            "text-halo-width": ["interpolate", ["linear"], ["zoom"], 12, 1.4, 18, 1.2],
            "text-halo-blur": 0.4,
            "text-opacity": 1
          }
        }
      ]
    };
  }

  function createMapOptions(container, overrides) {
    return Object.assign({
      container,
      style: createOpenFreeMapStyle(),
      center: DEFAULT_CENTER.slice(),
      zoom: DEFAULT_ZOOM,
      maxZoom: 22,
      attributionControl: { compact: true }
    }, overrides || {});
  }

  function createMapLibreMap(container, overrides) {
    if (!global.maplibregl || typeof global.maplibregl.Map !== "function") {
      throw new Error("MapLibre GL ist nicht verfuegbar.");
    }
    return new global.maplibregl.Map(createMapOptions(container, overrides));
  }

  function isMigrationEnabled() {
    return MAPLIBRE_MIGRATION_ENABLED;
  }

  function initializeMapLibreMap(container, overrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED) return null;
    if (managedMap) return managedMap;
    managedContainer = container;
    managedOverrides = Object.assign({}, overrides || {});
    managedMap = createMapLibreMap(container, managedOverrides);
    return managedMap;
  }

  function destroyMapLibreMap() {
    if (managedMap && typeof managedMap.remove === "function") {
      managedMap.remove();
    }
    managedMap = null;
    managedContainer = null;
    managedOverrides = null;
  }

  function reloadMapLibreMap(overrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedContainer) return null;
    const container = managedContainer;
    const nextOverrides = Object.assign({}, managedOverrides || {}, overrides || {});
    if (managedMap && typeof managedMap.remove === "function") managedMap.remove();
    managedMap = createMapLibreMap(container, nextOverrides);
    managedOverrides = nextOverrides;
    mirroredLineSignatures.route = null;
    mirroredLineSignatures.preview = null;
    mirroredStopsSignature = null;
    mirroredRoutePointsSignature = null;
    return managedMap;
  }

  function resizeMapLibreMap() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || typeof managedMap.resize !== "function") {
      return false;
    }
    managedMap.resize();
    return true;
  }

  function getMapLibreMap() {
    return managedMap;
  }

  function getTestContainer() {
    return global.document ? global.document.getElementById(TEST_CONTAINER_ID) : null;
  }

  function getTestLabel() {
    return global.document ? global.document.getElementById(TEST_LABEL_ID) : null;
  }

  function getLeafletTestLabel() {
    return global.document ? global.document.getElementById(LEAFLET_TEST_LABEL_ID) : null;
  }

  function setLabelActive(label, active) {
    if (!label) return;
    label.classList.toggle("is-active", active);
    label.setAttribute("aria-hidden", active ? "false" : "true");
  }

  function setTestContainerActive(active) {
    const container = getTestContainer();
    if (!container) return null;
    container.classList.toggle("is-active", active);
    container.setAttribute("aria-hidden", active ? "false" : "true");
    if (container.parentElement) {
      container.parentElement.classList.toggle("maplibre-test-active", active);
    }
    const label = getTestLabel();
    setLabelActive(label, active);
    setLabelActive(getLeafletTestLabel(), active);
    return container;
  }

  function logTestViewMetrics() {
    if (!global.document) return;
    const leafletContainer = global.document.getElementById("map");
    const mapLibreContainer = getTestContainer();
    if (!leafletContainer || !mapLibreContainer) return;
    const leafletRect = leafletContainer.getBoundingClientRect();
    const mapLibreRect = mapLibreContainer.getBoundingClientRect();
    console.info("[Editor MapLibre Test] Containergrößen", {
      browserWidth: global.innerWidth,
      leaflet: { width: leafletRect.width, height: leafletRect.height },
      mapLibre: { width: mapLibreRect.width, height: mapLibreRect.height }
    });
  }

  function bindTestViewControls() {
    if (testCloseButtonBound || !global.document) return;
    const closeButton = global.document.getElementById(TEST_CLOSE_BUTTON_ID);
    if (!closeButton) return;
    closeButton.addEventListener("click", () => setDeveloperTestViewVisible(false));
    testCloseButtonBound = true;
  }

  function initializeTestMap(overrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED) return null;
    const container = setTestContainerActive(true);
    if (!container) throw new Error("MapLibre-Testcontainer wurde nicht gefunden.");
    try {
      const instance = initializeMapLibreMap(container, overrides);
      if (instance && typeof instance.on === "function") {
        instance.on("error", event => {
          console.error("[Editor MapLibre Test] MapLibre-/Style-Fehler", event.error || event);
        });
      }
      bindTestViewControls();
      global.requestAnimationFrame(() => {
        resizeMapLibreMap();
        logTestViewMetrics();
      });
      startEditorLineMirroring();
      startLeafletViewportSync();
      return instance;
    } catch (err) {
      console.error("[Editor MapLibre Test] Initialisierung fehlgeschlagen", err);
      setTestContainerActive(false);
      throw err;
    }
  }

  function destroyTestMap() {
    stopLeafletViewportSync();
    stopEditorLineMirroring();
    destroyMapLibreMap();
    setTestContainerActive(false);
  }

  function setDeveloperTestViewVisible(visible) {
    if (!MAPLIBRE_MIGRATION_ENABLED) return null;
    if (visible) {
      const instance = managedMap || initializeTestMap();
      setTestContainerActive(true);
      global.requestAnimationFrame(() => {
        resizeMapLibreMap();
        const leafletMap = getLeafletMap();
        if (leafletMap && typeof leafletMap.invalidateSize === "function") leafletMap.invalidateSize(false);
        scheduleLeafletViewportSync();
      });
      return instance;
    }
    destroyTestMap();
    const leafletMap = getLeafletMap();
    if (leafletMap && typeof leafletMap.invalidateSize === "function") {
      global.requestAnimationFrame(() => leafletMap.invalidateSize(false));
    }
    return null;
  }

  function toggleDeveloperTestView() {
    return setDeveloperTestViewVisible(!getMapLibreMap());
  }

  function createLineGeoJson(editorPoints) {
    const coordinates = Array.isArray(editorPoints)
      ? editorPoints.map(point => toMapLibreLngLat(point)).filter(Boolean)
      : [];
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates
      }
    };
  }

  function createLineLayerDefinition(kind, paintOverrides) {
    const definition = LINE_DEFINITIONS[kind];
    if (!definition) throw new Error(`Unbekannter Editor-Linientyp: ${kind}`);
    return {
      id: definition.layerId,
      type: "line",
      source: definition.sourceId,
      layout: {
        "line-cap": "round",
        "line-join": "round"
      },
      paint: Object.assign({}, definition.paint, paintOverrides || {})
    };
  }

  function setLineLayer(kind, editorPoints, paintOverrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const definition = LINE_DEFINITIONS[kind];
    if (!definition) throw new Error(`Unbekannter Editor-Linientyp: ${kind}`);
    const data = createLineGeoJson(editorPoints);

    const applyLine = () => {
      if (!managedMap) return;
      const source = managedMap.getSource(definition.sourceId);
      if (source && typeof source.setData === "function") {
        source.setData(data);
      } else {
        managedMap.addSource(definition.sourceId, { type: "geojson", data });
      }
      if (!managedMap.getLayer(definition.layerId)) {
        managedMap.addLayer(createLineLayerDefinition(kind, paintOverrides));
      } else if (paintOverrides && typeof managedMap.setPaintProperty === "function") {
        Object.entries(paintOverrides).forEach(([name, value]) => {
          managedMap.setPaintProperty(definition.layerId, name, value);
        });
      }
    };

    if (typeof managedMap.isStyleLoaded === "function" && !managedMap.isStyleLoaded()) {
      managedMap.once("load", applyLine);
    } else {
      applyLine();
    }
    return true;
  }

  function removeLineLayer(kind) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const definition = LINE_DEFINITIONS[kind];
    if (!definition) throw new Error(`Unbekannter Editor-Linientyp: ${kind}`);
    if (managedMap.getLayer(definition.layerId)) managedMap.removeLayer(definition.layerId);
    if (managedMap.getSource(definition.sourceId)) managedMap.removeSource(definition.sourceId);
    return true;
  }

  function clearLineLayer(kind) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const definition = LINE_DEFINITIONS[kind];
    if (!definition) throw new Error(`Unbekannter Editor-Linientyp: ${kind}`);
    const source = managedMap.getSource(definition.sourceId);
    if (source && typeof source.setData === "function") {
      source.setData({ type: "FeatureCollection", features: [] });
    }
    return true;
  }

  function getEditorState() {
    try {
      return typeof state !== "undefined" ? state : null;
    } catch (_err) {
      return null;
    }
  }

  function getEditorLineColor() {
    const input = global.document ? global.document.getElementById("lineColor") : null;
    return input && input.value ? input.value : "#2563eb";
  }

  function createLineSignature(points, suffix) {
    if (!Array.isArray(points) || points.length < 2) return `empty|${suffix}`;
    return points.map(point => {
      const lngLat = toMapLibreLngLat(point);
      return lngLat ? `${lngLat[0]},${lngLat[1]}` : "invalid";
    }).join(";") + `|${suffix}`;
  }

  function syncMirroredLine(kind, points, paint, signatureSuffix) {
    const signature = createLineSignature(points, signatureSuffix);
    if (mirroredLineSignatures[kind] === signature) return;
    mirroredLineSignatures[kind] = signature;
    if (Array.isArray(points) && points.length >= 2) {
      setLineLayer(kind, points, paint);
    } else {
      clearLineLayer(kind);
    }
  }

  function syncEditorLineLayers() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const editorState = getEditorState();
    if (!editorState) return false;

    const color = getEditorLineColor();
    const simplifiedPreviewActive = editorState.previewMode === "simplified";
    syncMirroredLine(
      "route",
      editorState.routePoints,
      {
        "line-color": color,
        "line-width": simplifiedPreviewActive ? 3 : 5,
        "line-opacity": simplifiedPreviewActive ? 0.35 : 1
      },
      `${color}|${editorState.previewMode}`
    );
    syncMirroredLine(
      "preview",
      simplifiedPreviewActive ? editorState.simplifiedRoutePoints : [],
      {
        "line-color": color,
        "line-width": 6,
        "line-opacity": 1
      },
      `${color}|${editorState.previewMode}`
    );
    return true;
  }

  function startEditorLineMirroring() {
    if (!MAPLIBRE_MIGRATION_ENABLED || lineMirrorTimer != null) return false;
    syncEditorTestLayers();
    lineMirrorTimer = global.setInterval(syncEditorTestLayers, 150);
    return true;
  }

  function stopEditorLineMirroring() {
    if (lineMirrorTimer != null) {
      global.clearInterval(lineMirrorTimer);
      lineMirrorTimer = null;
    }
    mirroredLineSignatures.route = null;
    mirroredLineSignatures.preview = null;
    mirroredStopsSignature = null;
    mirroredRoutePointsSignature = null;
  }

  function createStopsGeoJson(stops) {
    const features = Array.isArray(stops)
      ? stops.map(stop => {
          const coordinates = toMapLibreLngLat(stop);
          if (!coordinates) return null;
          return {
            type: "Feature",
            properties: {
              id: stop.id == null ? "" : String(stop.id),
              name: stop.name == null ? "" : String(stop.name)
            },
            geometry: { type: "Point", coordinates }
          };
        }).filter(Boolean)
      : [];
    return { type: "FeatureCollection", features };
  }

  function setStopsLayer(stops) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredStopsData = createStopsGeoJson(stops);
    const applyStops = () => {
      if (!managedMap) return;
      const source = managedMap.getSource(STOP_SOURCE_ID);
      if (source && typeof source.setData === "function") {
        source.setData(desiredStopsData);
      } else {
        managedMap.addSource(STOP_SOURCE_ID, { type: "geojson", data: desiredStopsData });
      }
      if (!managedMap.getLayer(STOP_LAYER_ID)) {
        managedMap.addLayer({
          id: STOP_LAYER_ID,
          type: "circle",
          source: STOP_SOURCE_ID,
          paint: {
            "circle-radius": 6,
            "circle-color": "#e30613",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff"
          }
        });
      }
    };
    if (typeof managedMap.isStyleLoaded === "function" && !managedMap.isStyleLoaded()) {
      managedMap.once("load", applyStops);
    } else {
      applyStops();
    }
    return true;
  }

  function clearStopsLayer() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredStopsData = { type: "FeatureCollection", features: [] };
    const source = managedMap.getSource(STOP_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(desiredStopsData);
    }
    return true;
  }

  function syncEditorStops() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const editorState = getEditorState();
    if (!editorState) return false;
    const stops = Array.isArray(editorState.stops) ? editorState.stops : [];
    const signature = JSON.stringify(stops.map(stop => [stop.id, stop.name, stop.lat, stop.lon]));
    if (mirroredStopsSignature === signature) return true;
    mirroredStopsSignature = signature;
    if (stops.length) setStopsLayer(stops);
    else clearStopsLayer();
    return true;
  }

  function createRoutePointsGeoJson(routePoints) {
    const features = Array.isArray(routePoints)
      ? routePoints.map((point, index) => {
          const coordinates = toMapLibreLngLat(point);
          if (!coordinates) return null;
          return {
            type: "Feature",
            properties: {
              id: point && point.id != null ? String(point.id) : String(index),
              sourceType: point && point.sourceType ? String(point.sourceType) : ""
            },
            geometry: { type: "Point", coordinates }
          };
        }).filter(Boolean)
      : [];
    return { type: "FeatureCollection", features };
  }

  function setRoutePointsLayer(routePoints) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredRoutePointsData = createRoutePointsGeoJson(routePoints);
    const applyRoutePoints = () => {
      if (!managedMap) return;
      const source = managedMap.getSource(ROUTE_POINT_SOURCE_ID);
      if (source && typeof source.setData === "function") {
        source.setData(desiredRoutePointsData);
      } else {
        managedMap.addSource(ROUTE_POINT_SOURCE_ID, {
          type: "geojson",
          data: desiredRoutePointsData
        });
      }
      if (!managedMap.getLayer(ROUTE_POINT_LAYER_ID)) {
        managedMap.addLayer({
          id: ROUTE_POINT_LAYER_ID,
          type: "circle",
          source: ROUTE_POINT_SOURCE_ID,
          minzoom: 11,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 2.5, 18, 4],
            "circle-color": "#ffffff",
            "circle-opacity": 0.9,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#1d4ed8"
          }
        });
      }
    };
    if (typeof managedMap.isStyleLoaded === "function" && !managedMap.isStyleLoaded()) {
      managedMap.once("load", applyRoutePoints);
    } else {
      applyRoutePoints();
    }
    return true;
  }

  function clearRoutePointsLayer() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredRoutePointsData = { type: "FeatureCollection", features: [] };
    const source = managedMap.getSource(ROUTE_POINT_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(desiredRoutePointsData);
    }
    return true;
  }

  function syncEditorRoutePoints() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const editorState = getEditorState();
    if (!editorState) return false;
    const routePoints = Array.isArray(editorState.routePoints) ? editorState.routePoints : [];
    const signature = JSON.stringify(routePoints.map((point, index) => [
      point && point.id != null ? point.id : index,
      point ? point.lat : null,
      point ? point.lon : null,
      point && point.sourceType ? point.sourceType : ""
    ]));
    if (mirroredRoutePointsSignature === signature) return true;
    mirroredRoutePointsSignature = signature;
    if (routePoints.length) setRoutePointsLayer(routePoints);
    else clearRoutePointsLayer();
    return true;
  }

  function syncEditorTestLayers() {
    syncEditorLineLayers();
    syncEditorStops();
    syncEditorRoutePoints();
  }

  function getLeafletMap() {
    try {
      return typeof map !== "undefined" ? map : null;
    } catch (_err) {
      return null;
    }
  }

  function leafletZoomToMapLibre(leafletZoom) {
    return Number.isFinite(leafletZoom)
      ? Math.max(0, leafletZoom + LEAFLET_TO_MAPLIBRE_ZOOM_OFFSET)
      : null;
  }

  function syncLeafletViewport() {
    viewportSyncFrame = null;
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || !leafletViewportMap) return false;
    const center = toMapLibreLngLat(leafletViewportMap.getCenter());
    const zoom = leafletZoomToMapLibre(leafletViewportMap.getZoom());
    if (!center || !Number.isFinite(zoom)) return false;
    managedMap.jumpTo({ center, zoom });
    return true;
  }

  function scheduleLeafletViewportSync() {
    if (viewportSyncFrame != null) return;
    viewportSyncFrame = global.requestAnimationFrame(syncLeafletViewport);
  }

  function startLeafletViewportSync() {
    if (!MAPLIBRE_MIGRATION_ENABLED || leafletViewportHandler) return false;
    const leafletMap = getLeafletMap();
    if (!leafletMap || typeof leafletMap.on !== "function") return false;
    leafletViewportMap = leafletMap;
    leafletViewportHandler = scheduleLeafletViewportSync;
    leafletViewportMap.on("move zoom", leafletViewportHandler);
    syncLeafletViewport();
    return true;
  }

  function stopLeafletViewportSync() {
    if (leafletViewportMap && leafletViewportHandler && typeof leafletViewportMap.off === "function") {
      leafletViewportMap.off("move zoom", leafletViewportHandler);
    }
    if (viewportSyncFrame != null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(viewportSyncFrame);
    }
    viewportSyncFrame = null;
    leafletViewportHandler = null;
    leafletViewportMap = null;
  }

  global.EditorMapAdapter = Object.freeze({
    activeEngine: "leaflet",
    preparedEngine: "maplibre",
    migrationEnabled: MAPLIBRE_MIGRATION_ENABLED,
    toMapLibreLngLat,
    toEditorLatLon,
    createOpenFreeMapStyle,
    createMapOptions,
    createMapLibreMap,
    isMigrationEnabled,
    initializeMapLibreMap,
    destroyMapLibreMap,
    reloadMapLibreMap,
    resizeMapLibreMap,
    getMapLibreMap,
    initializeTestMap,
    destroyTestMap,
    setDeveloperTestViewVisible,
    toggleDeveloperTestView,
    createLineGeoJson,
    createLineLayerDefinition,
    setLineLayer,
    removeLineLayer,
    clearLineLayer,
    createStopsGeoJson,
    setStopsLayer,
    clearStopsLayer,
    syncEditorStops,
    createRoutePointsGeoJson,
    setRoutePointsLayer,
    clearRoutePointsLayer,
    syncEditorRoutePoints,
    syncEditorLineLayers,
    startEditorLineMirroring,
    stopEditorLineMirroring,
    leafletZoomToMapLibre,
    syncLeafletViewport,
    startLeafletViewportSync,
    stopLeafletViewportSync
  });

  if (MAPLIBRE_MIGRATION_ENABLED && global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", () => initializeTestMap(), { once: true });
    } else {
      initializeTestMap();
    }
  }
})(window);
