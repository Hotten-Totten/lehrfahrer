// MapLibre-Grundlage fuer die schrittweise Editor-Migration.
// Der Schalter bleibt aus; Leaflet bleibt der aktive Renderer.
(function exposeEditorMapAdapter(global) {
  "use strict";

  const MAPLIBRE_MIGRATION_DEFAULT = false;
  const MAPLIBRE_INTERACTION_DEFAULT = false;
  const MAPLIBRE_URL_PARAMS = global.location
    ? new URLSearchParams(global.location.search)
    : new URLSearchParams();
  const MAPLIBRE_MAIN_ENGINE_REQUESTED = MAPLIBRE_URL_PARAMS.get("mapEngine") === "maplibre";
  const ACTIVE_ENGINE = MAPLIBRE_MAIN_ENGINE_REQUESTED ? "maplibre" : "leaflet";
  const MAPLIBRE_MIGRATION_ENABLED = MAPLIBRE_MIGRATION_DEFAULT
    || MAPLIBRE_MAIN_ENGINE_REQUESTED
    || MAPLIBRE_URL_PARAMS.get("maplibreTest") === "1";
  const MAPLIBRE_INTERACTION_REQUESTED = MAPLIBRE_INTERACTION_DEFAULT
    || MAPLIBRE_URL_PARAMS.get("maplibreInteract") === "1";
  const MAPLIBRE_TEST_INTERACTION_ENABLED = MAPLIBRE_MAIN_ENGINE_REQUESTED
    || (MAPLIBRE_MIGRATION_ENABLED && MAPLIBRE_INTERACTION_REQUESTED);
  const MAPLIBRE_SIDE_BY_SIDE_ENABLED = !MAPLIBRE_MAIN_ENGINE_REQUESTED
    && MAPLIBRE_URL_PARAMS.get("maplibreTest") === "1";
  const VIEWPORT_DIFFERENCE_THRESHOLDS = Object.freeze({
    centerMeters: Object.freeze({ unobtrusiveMax: 5, noticeableMax: 20 }),
    zoom: Object.freeze({ unobtrusiveMax: 0.05, noticeableMax: 0.25 }),
    bearing: Object.freeze({ unobtrusiveMax: 2, noticeableMax: 10 }),
    pitch: Object.freeze({ unobtrusiveMax: 2, noticeableMax: 8 })
  });
  const VIEWPORT_DIFFERENCE_LEVEL_LABELS = Object.freeze({
    unobtrusive: "unauff\u00e4llig",
    noticeable: "auff\u00e4llig",
    significant: "deutlich abweichend",
    unknown: "nicht verf\u00fcgbar"
  });
  const VIEWPORT_STATUS_FLAP_MS = 2000;
  const VIEWPORT_STATUS_HISTORY_LIMIT = 10;
  const VIEWPORT_STATUS_LEVELS = Object.freeze(["unobtrusive", "noticeable", "significant"]);
  const VIEWPORT_STATUS_LEVEL_RANK = Object.freeze({ unobtrusive: 0, noticeable: 1, significant: 2 });
  const TEST_CONTAINER_ID = "mapLibreTestMap";
  const TEST_LABEL_ID = "mapLibreTestLabel";
  const LEAFLET_TEST_LABEL_ID = "leafletTestLabel";
  const TEST_CLOSE_BUTTON_ID = "mapLibreTestCloseBtn";
  const HIT_TEST_DIAGNOSTIC_ID = "mapLibreHitTestDiagnostic";
  const CLICK_DIAGNOSTIC_ID = "mapLibreClickDiagnostic";
  const INTERACTION_STATUS_ID = "mapLibreInteractionStatus";
  const VIEWPORT_DIAGNOSTIC_ID = "mapLibreViewportDiagnostic";
  const VIEWPORT_DIFF_DIAGNOSTIC_ID = "mapLibreViewportDiffDiagnostic";
  const VIEWPORT_SESSION_SUMMARY_ID = "mapLibreViewportSessionSummary";
  const VIEWPORT_SESSION_SUMMARY_RESTORE_ID = "mapLibreViewportSessionSummaryRestore";
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
    }),
    specialTracks: Object.freeze({
      sourceId: "editor-special-tracks-source",
      layerId: "editor-special-tracks-line",
      paint: Object.freeze({
        "line-color": ["coalesce", ["get", "color"], "#aa00ff"],
        "line-width": ["coalesce", ["get", "width"], 4],
        "line-opacity": ["coalesce", ["get", "opacity"], 1],
        "line-dasharray": [1.5, 1.5]
      })
    }),
    detourDraft: Object.freeze({
      sourceId: "editor-detour-draft-source",
      layerId: "editor-detour-draft-line",
      paint: Object.freeze({
        "line-color": "#f59e0b",
        "line-width": 5,
        "line-opacity": 1,
        "line-dasharray": [1.6, 1.2]
      })
    }),
    detourPlanned: Object.freeze({
      sourceId: "editor-detour-planned-source",
      layerId: "editor-detour-planned-line",
      paint: Object.freeze({
        "line-color": "#2563eb",
        "line-width": 6,
        "line-opacity": 0.9,
        "line-dasharray": [1.7, 1.2]
      })
    }),
    detourRemoved: Object.freeze({
      sourceId: "editor-detour-removed-source",
      layerId: "editor-detour-removed-line",
      paint: Object.freeze({
        "line-color": "#6b7280",
        "line-width": 8,
        "line-opacity": 0.72,
        "line-dasharray": [1.25, 1.125]
      })
    })
  });
  const LINE_FEATURE_IDS = Object.freeze({
    route: "mainRoute",
    preview: "routePreview"
  });
  const STOP_SOURCE_ID = "editor-stops-source";
  const STOP_LAYER_ID = "editor-stops-circle";
  const CATALOG_STOP_SOURCE_ID = "editor-catalog-stops-source";
  const CATALOG_STOP_LAYER_ID = "editor-catalog-stops-circle";
  const ROUTE_POINT_SOURCE_ID = "editor-route-points-source";
  const ROUTE_POINT_LAYER_ID = "editor-route-points-circle";
  const DETOUR_HELPER_SOURCE_ID = "editor-detour-helper-points-source";
  const DETOUR_HELPER_LAYER_ID = "editor-detour-helper-points-circle";
  const HOVER_SOURCE_ID = "editor-hover-highlight-source";
  const HOVER_LAYER_ID = "editor-hover-highlight-circle";
  const HOVER_LINE_LAYER_ID = "editor-hover-highlight-line";
  const TEST_SELECTION_SOURCE_ID = "editor-test-selection-source";
  const TEST_SELECTION_LAYER_ID = "editor-test-selection-circle";
  const TEST_SELECTION_LINE_LAYER_ID = "editor-test-selection-line";
  const EDITOR_SELECTION_SOURCE_ID = "editor-selection-source";
  const EDITOR_SELECTION_LAYER_ID = "editor-selection-circle";
  const EDITOR_SELECTION_LINE_LAYER_ID = "editor-selection-line";
  const EDITOR_OVERLAY_LAYER_ORDER = Object.freeze([
    LINE_DEFINITIONS.detourRemoved.layerId,
    LINE_DEFINITIONS.specialTracks.layerId,
    LINE_DEFINITIONS.route.layerId,
    LINE_DEFINITIONS.preview.layerId,
    LINE_DEFINITIONS.detourDraft.layerId,
    LINE_DEFINITIONS.detourPlanned.layerId,
    CATALOG_STOP_LAYER_ID,
    ROUTE_POINT_LAYER_ID,
    STOP_LAYER_ID,
    DETOUR_HELPER_LAYER_ID,
    EDITOR_SELECTION_LINE_LAYER_ID,
    EDITOR_SELECTION_LAYER_ID,
    TEST_SELECTION_LINE_LAYER_ID,
    HOVER_LINE_LAYER_ID,
    TEST_SELECTION_LAYER_ID,
    HOVER_LAYER_ID
  ]);
  const HIT_TEST_LAYER_DEFINITIONS = Object.freeze([
    Object.freeze({ layerId: DETOUR_HELPER_LAYER_ID, featureType: "detourHelperPoint", geometryKind: "point" }),
    Object.freeze({ layerId: STOP_LAYER_ID, featureType: "stop", geometryKind: "point" }),
    Object.freeze({ layerId: ROUTE_POINT_LAYER_ID, featureType: "routePoint", geometryKind: "point" }),
    Object.freeze({ layerId: CATALOG_STOP_LAYER_ID, featureType: "catalogStop", geometryKind: "point" }),
    Object.freeze({ layerId: LINE_DEFINITIONS.detourPlanned.layerId, featureType: "detourPlanned", geometryKind: "line" }),
    Object.freeze({ layerId: LINE_DEFINITIONS.detourDraft.layerId, featureType: "detourDraft", geometryKind: "line" }),
    Object.freeze({ layerId: LINE_DEFINITIONS.preview.layerId, featureType: "preview", geometryKind: "line" }),
    Object.freeze({ layerId: LINE_DEFINITIONS.route.layerId, featureType: "route", geometryKind: "line" }),
    Object.freeze({ layerId: LINE_DEFINITIONS.specialTracks.layerId, featureType: "specialTrack", geometryKind: "line" }),
    Object.freeze({ layerId: LINE_DEFINITIONS.detourRemoved.layerId, featureType: "detourRemoved", geometryKind: "line" })
  ]);
  let managedMap = null;
  let managedContainer = null;
  let managedOverrides = null;
  let managedStyleReady = false;
  let pendingMapLibreViewport = null;
  let editorMirroringActive = false;
  let viewportOwnerEngine = ACTIVE_ENGINE;
  let mapLibreOwnerViewportHandler = null;
  let mapLibreOwnerViewportEndHandler = null;
  let mapLibreOwnerViewportEndSignature = null;
  let mapLibreOwnerViewportMap = null;
  let mapLibreOwnerViewportFrame = null;
  let leafletViewportMap = null;
  let leafletViewportHandler = null;
  let viewportSyncFrame = null;
  let testCloseButtonBound = false;
  let hitTestDiagnosticMoveHandler = null;
  let hitTestDiagnosticClickHandler = null;
  let hitTestDiagnosticFrame = null;
  let pendingHitTestPoint = null;
  let mapLibreObjectDragMouseDownHandler = null;
  let mapLibreObjectDragMouseMoveHandler = null;
  let mapLibreObjectDragMouseUpHandler = null;
  let mapLibreObjectDragState = null;
  let suppressNextMapLibreClick = false;
  let mapLibreEditorInteractionFocused = false;
  let mapLibreEditorDeleteKeyHandler = null;
  let mapLibreViewportHandler = null;
  let mapLibreViewportFrame = null;
  let mapLibreViewportMap = null;
  let leafletViewportSyncApplying = false;
  let manualMapLibreViewportDirty = false;
  let viewportOverwriteNotice = false;
  let pendingViewportDiagnosticReason = "Start";
  let viewportDifferenceMap = null;
  let viewportDifferenceMapHandler = null;
  let viewportDifferenceFrame = null;
  let viewportDifferenceDurationTimer = null;
  let lastViewportSessionSummary = null;
  const viewportStatusStability = {
    currentLevel: null,
    sinceMs: null,
    changeCount: 0,
    lastChangeMs: null,
    lastDurationMs: null,
    shortChangeCount: 0,
    history: [],
    testStartedMs: null,
    highestLevel: null,
    accumulatedDurationsMs: {
      unobtrusive: 0,
      noticeable: 0,
      significant: 0
    }
  };
  const mirroredLineSignatures = {
    route: null,
    preview: null,
    specialTracks: null,
    detourDraft: null,
    detourPlanned: null,
    detourRemoved: null
  };
  const desiredSupplementalLineData = {
    specialTracks: { type: "FeatureCollection", features: [] },
    detourDraft: { type: "FeatureCollection", features: [] },
    detourPlanned: { type: "FeatureCollection", features: [] },
    detourRemoved: { type: "FeatureCollection", features: [] }
  };
  let mirroredStopsSignature = null;
  let desiredStopsData = { type: "FeatureCollection", features: [] };
  let mirroredCatalogStopsSignature = null;
  let desiredCatalogStopsData = { type: "FeatureCollection", features: [] };
  let mirroredRoutePointsSignature = null;
  let desiredRoutePointsData = { type: "FeatureCollection", features: [] };
  let mirroredDetourHelperSignature = null;
  let desiredDetourHelperData = { type: "FeatureCollection", features: [] };
  let mirroredHoverSignature = null;
  let desiredHoverData = { type: "FeatureCollection", features: [] };
  let mapLibreTestSelection = null;
  let mirroredTestSelectionSignature = null;
  let desiredTestSelectionData = { type: "FeatureCollection", features: [] };
  let mirroredEditorSelectionSignature = null;
  let desiredEditorSelectionData = { type: "FeatureCollection", features: [] };

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
    const options = Object.assign({
      container,
      style: createOpenFreeMapStyle(),
      center: DEFAULT_CENTER.slice(),
      zoom: DEFAULT_ZOOM,
      maxZoom: 22,
      attributionControl: { compact: true },
      interactive: MAPLIBRE_TEST_INTERACTION_ENABLED
    }, overrides || {});
    options.interactive = MAPLIBRE_TEST_INTERACTION_ENABLED;
    return options;
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
    const initialViewport = MAPLIBRE_MAIN_ENGINE_REQUESTED ? readLeafletViewport() : null;
    managedContainer = container;
    managedOverrides = Object.assign({}, overrides || {});
    managedMap = createMapLibreMap(container, managedOverrides);
    managedStyleReady = false;
    managedMap.once("load", () => {
      managedStyleReady = true;
      if (pendingMapLibreViewport) {
        applyViewportToMapLibre(pendingMapLibreViewport);
        pendingMapLibreViewport = null;
      } else if (initialViewport) applyViewportToMapLibre(initialViewport);
      else syncViewportFromOwner();
      syncEditorTestLayers();
    });
    return managedMap;
  }

  function destroyMapLibreMap() {
    stopMapLibreViewportDiagnostics();
    stopViewportDifferenceDiagnostics();
    stopMapLibreOwnerViewportSync();
    if (managedMap && typeof managedMap.remove === "function") {
      managedMap.remove();
    }
    managedMap = null;
    managedContainer = null;
    managedOverrides = null;
    managedStyleReady = false;
  }

  function reloadMapLibreMap(overrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedContainer) return null;
    const retainedViewport = getViewportOwnerContext();
    stopMapLibreViewportDiagnostics();
    stopViewportDifferenceDiagnostics();
    stopMapLibreOwnerViewportSync();
    const container = managedContainer;
    const nextOverrides = Object.assign({}, managedOverrides || {}, overrides || {});
    if (managedMap && typeof managedMap.remove === "function") managedMap.remove();
    managedMap = createMapLibreMap(container, nextOverrides);
    managedStyleReady = false;
    managedMap.once("load", () => {
      managedStyleReady = true;
      if (retainedViewport) applyViewportToMapLibre(retainedViewport);
      else syncViewportFromOwner();
      syncEditorTestLayers();
      resizeMapLibreMap();
      if (viewportOwnerEngine === "maplibre") startMapLibreOwnerViewportSync();
    });
    managedOverrides = nextOverrides;
    mirroredLineSignatures.route = null;
    mirroredLineSignatures.preview = null;
    mirroredLineSignatures.specialTracks = null;
    mirroredLineSignatures.detourDraft = null;
    mirroredLineSignatures.detourPlanned = null;
    mirroredLineSignatures.detourRemoved = null;
    mirroredStopsSignature = null;
    mirroredCatalogStopsSignature = null;
    mirroredRoutePointsSignature = null;
    mirroredDetourHelperSignature = null;
    mirroredHoverSignature = null;
    mirroredTestSelectionSignature = null;
    mirroredEditorSelectionSignature = null;
    applyMapLibreTestInteractionState();
    syncEditorSelection();
    startMapLibreViewportDiagnostics();
    startViewportDifferenceDiagnostics();
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

  function getOrCreateInteractionStatus() {
    if (!global.document) return null;
    let status = global.document.getElementById(INTERACTION_STATUS_ID);
    if (status) return status;
    const container = getTestContainer();
    if (!container || typeof global.document.createElement !== "function") return null;
    status = global.document.createElement("div");
    status.id = INTERACTION_STATUS_ID;
    status.className = "editor-maplibre-interaction-status";
    status.setAttribute("aria-hidden", "true");
    container.appendChild(status);
    return status;
  }

  function updateMapLibreInteractionStatus(visible) {
    const status = getOrCreateInteractionStatus();
    if (!status) return false;
    status.textContent = MAPLIBRE_TEST_INTERACTION_ENABLED
      ? "Interaktion: EIN (nur Test)"
      : "Interaktion: AUS";
    status.classList.toggle("is-enabled", MAPLIBRE_TEST_INTERACTION_ENABLED);
    status.classList.toggle("is-active", !!visible);
    status.setAttribute("aria-hidden", visible ? "false" : "true");
    return true;
  }

  function applyMapLibreTestInteractionState() {
    const container = getTestContainer();
    if (container) container.classList.toggle("is-interactive", MAPLIBRE_TEST_INTERACTION_ENABLED);
    if (!managedMap) return false;
    [
      "boxZoom",
      "scrollZoom",
      "dragPan",
      "dragRotate",
      "keyboard",
      "doubleClickZoom",
      "touchZoomRotate"
    ].forEach(name => {
      const handler = managedMap[name];
      if (!handler) return;
      const method = MAPLIBRE_TEST_INTERACTION_ENABLED ? "enable" : "disable";
      if (typeof handler[method] === "function") handler[method]();
    });
    updateMapLibreInteractionStatus(true);
    return MAPLIBRE_TEST_INTERACTION_ENABLED;
  }

  function getOrCreateViewportDiagnostic() {
    if (!global.document) return null;
    let diagnostic = global.document.getElementById(VIEWPORT_DIAGNOSTIC_ID);
    if (diagnostic) return diagnostic;
    const container = getTestContainer();
    if (!container || typeof global.document.createElement !== "function") return null;
    diagnostic = global.document.createElement("div");
    diagnostic.id = VIEWPORT_DIAGNOSTIC_ID;
    diagnostic.className = "editor-maplibre-viewport-diagnostic";
    diagnostic.setAttribute("aria-hidden", "true");
    container.appendChild(diagnostic);
    return diagnostic;
  }

  function readMapLibreViewport() {
    if (!managedMap) return null;
    const center = typeof managedMap.getCenter === "function" ? managedMap.getCenter() : null;
    const lon = center && Number.isFinite(Number(center.lng)) ? Number(center.lng) : null;
    const lat = center && Number.isFinite(Number(center.lat)) ? Number(center.lat) : null;
    const zoom = typeof managedMap.getZoom === "function" ? Number(managedMap.getZoom()) : null;
    const bearing = typeof managedMap.getBearing === "function" ? Number(managedMap.getBearing()) : null;
    const pitch = typeof managedMap.getPitch === "function" ? Number(managedMap.getPitch()) : null;
    return Object.freeze({
      lon,
      lat,
      zoom: Number.isFinite(zoom) ? zoom : null,
      bearing: Number.isFinite(bearing) ? bearing : null,
      pitch: Number.isFinite(pitch) ? pitch : null
    });
  }

  function formatMapLibreViewportDiagnostic(viewport, reason) {
    if (!viewport) return "Viewport · nicht verfuegbar";
    const center = Number.isFinite(viewport.lon) && Number.isFinite(viewport.lat)
      ? `${viewport.lon.toFixed(5)}, ${viewport.lat.toFixed(5)}`
      : "-";
    const value = (number, digits) => Number.isFinite(number) ? number.toFixed(digits) : "-";
    return `Viewport · Center: ${center} · Zoom: ${value(viewport.zoom, 2)} · Bearing: ${value(viewport.bearing, 1)}° · Pitch: ${value(viewport.pitch, 1)}°\nQuelle: ${reason || "Test"}`;
  }

  function updateMapLibreViewportDiagnostic(reason) {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED) return false;
    const diagnostic = getOrCreateViewportDiagnostic();
    if (!diagnostic) return false;
    diagnostic.textContent = formatMapLibreViewportDiagnostic(readMapLibreViewport(), reason);
    diagnostic.classList.add("is-active");
    diagnostic.setAttribute("aria-hidden", "false");
    return true;
  }

  function scheduleMapLibreViewportDiagnostic(reason) {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED || !managedMap) return false;
    if (reason) pendingViewportDiagnosticReason = reason;
    if (mapLibreViewportFrame != null) return true;
    mapLibreViewportFrame = global.requestAnimationFrame(() => {
      mapLibreViewportFrame = null;
      updateMapLibreViewportDiagnostic(pendingViewportDiagnosticReason);
    });
    return true;
  }

  function startMapLibreViewportDiagnostics() {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED || !managedMap || typeof managedMap.on !== "function") {
      return false;
    }
    const diagnostic = getOrCreateViewportDiagnostic();
    if (!diagnostic) return false;
    if (!mapLibreViewportHandler) {
      mapLibreViewportMap = managedMap;
      mapLibreViewportHandler = event => {
        if (!leafletViewportSyncApplying && event && event.originalEvent) {
          manualMapLibreViewportDirty = true;
          viewportOverwriteNotice = false;
          pendingViewportDiagnosticReason = "MapLibre manuell";
        }
        scheduleMapLibreViewportDiagnostic(pendingViewportDiagnosticReason);
      };
      ["move", "zoom", "rotate", "pitch"].forEach(eventName => {
        mapLibreViewportMap.on(eventName, mapLibreViewportHandler);
      });
    }
    scheduleMapLibreViewportDiagnostic("Start");
    return true;
  }

  function stopMapLibreViewportDiagnostics() {
    if (mapLibreViewportMap && mapLibreViewportHandler && typeof mapLibreViewportMap.off === "function") {
      ["move", "zoom", "rotate", "pitch"].forEach(eventName => {
        mapLibreViewportMap.off(eventName, mapLibreViewportHandler);
      });
    }
    if (mapLibreViewportFrame != null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(mapLibreViewportFrame);
    }
    mapLibreViewportMap = null;
    mapLibreViewportHandler = null;
    mapLibreViewportFrame = null;
    manualMapLibreViewportDirty = false;
    viewportOverwriteNotice = false;
    pendingViewportDiagnosticReason = "Start";
    const diagnostic = global.document
      ? global.document.getElementById(VIEWPORT_DIAGNOSTIC_ID)
      : null;
    if (diagnostic) {
      diagnostic.classList.remove("is-active");
      diagnostic.setAttribute("aria-hidden", "true");
    }
    return true;
  }

  function getOrCreateViewportDifferenceDiagnostic() {
    if (!global.document) return null;
    let diagnostic = global.document.getElementById(VIEWPORT_DIFF_DIAGNOSTIC_ID);
    if (diagnostic) return diagnostic;
    const container = getTestContainer();
    if (!container || typeof global.document.createElement !== "function") return null;
    diagnostic = global.document.createElement("div");
    diagnostic.id = VIEWPORT_DIFF_DIAGNOSTIC_ID;
    diagnostic.className = "editor-maplibre-viewport-diff-diagnostic";
    diagnostic.setAttribute("aria-hidden", "true");
    container.appendChild(diagnostic);
    return diagnostic;
  }

  function readLeafletViewport() {
    const leafletMap = getLeafletMap();
    if (!leafletMap) return null;
    const center = typeof leafletMap.getCenter === "function" ? leafletMap.getCenter() : null;
    const lngLat = toMapLibreLngLat(center);
    const leafletZoom = typeof leafletMap.getZoom === "function" ? Number(leafletMap.getZoom()) : null;
    const zoom = leafletZoomToMapLibre(leafletZoom);
    const bearingValue = typeof leafletMap.getBearing === "function" ? Number(leafletMap.getBearing()) : 0;
    const pitchValue = typeof leafletMap.getPitch === "function" ? Number(leafletMap.getPitch()) : 0;
    return Object.freeze({
      lon: lngLat ? lngLat[0] : null,
      lat: lngLat ? lngLat[1] : null,
      zoom: Number.isFinite(zoom) ? zoom : null,
      bearing: Number.isFinite(bearingValue) ? bearingValue : 0,
      pitch: Number.isFinite(pitchValue) ? pitchValue : 0
    });
  }

  function centerDistanceMeters(a, b) {
    if (!a || !b || ![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return null;
    const radians = value => value * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLon = radians(b.lon - a.lon);
    const latA = radians(a.lat);
    const latB = radians(b.lat);
    const haversine = Math.sin(dLat / 2) ** 2
      + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  }

  function shortestAngleDifferenceDegrees(value, reference) {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) return null;
    return ((value - reference + 540) % 360) - 180;
  }

  function calculateViewportDifferences(leafletViewport, mapLibreViewport) {
    if (!leafletViewport || !mapLibreViewport) return null;
    return Object.freeze({
      centerMeters: centerDistanceMeters(leafletViewport, mapLibreViewport),
      zoom: Number.isFinite(mapLibreViewport.zoom) && Number.isFinite(leafletViewport.zoom)
        ? mapLibreViewport.zoom - leafletViewport.zoom
        : null,
      bearing: shortestAngleDifferenceDegrees(mapLibreViewport.bearing, leafletViewport.bearing),
      pitch: Number.isFinite(mapLibreViewport.pitch) && Number.isFinite(leafletViewport.pitch)
        ? mapLibreViewport.pitch - leafletViewport.pitch
        : null
    });
  }

  function readViewportDifferences() {
    return calculateViewportDifferences(readLeafletViewport(), readMapLibreViewport());
  }

  function formatViewportDifferenceDiagnostic(differences) {
    if (!differences) return "Viewport-Diff · nicht verfuegbar";
    const signed = (value, digits) => Number.isFinite(value)
      ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`
      : "-";
    const center = Number.isFinite(differences.centerMeters)
      ? `${differences.centerMeters.toFixed(1)} m`
      : "-";
    return `Viewport-Diff · Center: ${center} · Zoom: ${signed(differences.zoom, 2)} · Bearing: ${signed(differences.bearing, 1)}° · Pitch: ${signed(differences.pitch, 1)}°`;
  }

  function classifyViewportDifference(type, value) {
    const thresholds = VIEWPORT_DIFFERENCE_THRESHOLDS[type];
    if (!thresholds || !Number.isFinite(value)) return "unknown";
    const magnitude = Math.abs(value);
    if (magnitude <= thresholds.unobtrusiveMax) return "unobtrusive";
    if (magnitude <= thresholds.noticeableMax) return "noticeable";
    return "significant";
  }

  function evaluateViewportDifferences(differences) {
    const source = differences || {};
    return Object.freeze({
      centerMeters: classifyViewportDifference("centerMeters", source.centerMeters),
      zoom: classifyViewportDifference("zoom", source.zoom),
      bearing: classifyViewportDifference("bearing", source.bearing),
      pitch: classifyViewportDifference("pitch", source.pitch)
    });
  }

  function getOverallViewportDifferenceLevel(levels) {
    const values = levels ? Object.values(levels) : [];
    if (values.includes("significant")) return "significant";
    if (values.includes("noticeable")) return "noticeable";
    if (values.includes("unobtrusive")) return "unobtrusive";
    return "unknown";
  }

  function resetViewportStatusStability() {
    viewportStatusStability.currentLevel = null;
    viewportStatusStability.sinceMs = null;
    viewportStatusStability.changeCount = 0;
    viewportStatusStability.lastChangeMs = null;
    viewportStatusStability.lastDurationMs = null;
    viewportStatusStability.shortChangeCount = 0;
    viewportStatusStability.history.length = 0;
    viewportStatusStability.testStartedMs = null;
    viewportStatusStability.highestLevel = null;
    VIEWPORT_STATUS_LEVELS.forEach(level => {
      viewportStatusStability.accumulatedDurationsMs[level] = 0;
    });
  }

  function updateViewportStatusStability(level, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (viewportStatusStability.currentLevel == null) {
      viewportStatusStability.currentLevel = level;
      viewportStatusStability.sinceMs = now;
      viewportStatusStability.testStartedMs = now;
    } else if (viewportStatusStability.currentLevel !== level) {
      const duration = Math.max(0, now - viewportStatusStability.sinceMs);
      const previousLevel = viewportStatusStability.currentLevel;
      if (VIEWPORT_STATUS_LEVELS.includes(previousLevel)) {
        viewportStatusStability.accumulatedDurationsMs[previousLevel] += duration;
      }
      viewportStatusStability.currentLevel = level;
      viewportStatusStability.sinceMs = now;
      viewportStatusStability.changeCount += 1;
      viewportStatusStability.lastChangeMs = now;
      viewportStatusStability.lastDurationMs = duration;
      if (duration < VIEWPORT_STATUS_FLAP_MS) viewportStatusStability.shortChangeCount += 1;
      viewportStatusStability.history.push(Object.freeze({
        atMs: now,
        previousLevel,
        newLevel: level,
        previousDurationMs: duration,
        isShort: duration < VIEWPORT_STATUS_FLAP_MS
      }));
      if (viewportStatusStability.history.length > VIEWPORT_STATUS_HISTORY_LIMIT) {
        viewportStatusStability.history.splice(
          0,
          viewportStatusStability.history.length - VIEWPORT_STATUS_HISTORY_LIMIT
        );
      }
    }
    if (VIEWPORT_STATUS_LEVELS.includes(level)
      && (!VIEWPORT_STATUS_LEVELS.includes(viewportStatusStability.highestLevel)
        || VIEWPORT_STATUS_LEVEL_RANK[level] > VIEWPORT_STATUS_LEVEL_RANK[viewportStatusStability.highestLevel])) {
      viewportStatusStability.highestLevel = level;
    }
    return Object.freeze({
      currentLevel: viewportStatusStability.currentLevel,
      durationMs: Math.max(0, now - viewportStatusStability.sinceMs),
      changeCount: viewportStatusStability.changeCount,
      lastChangeMs: viewportStatusStability.lastChangeMs,
      lastDurationMs: viewportStatusStability.lastDurationMs,
      shortChangeCount: viewportStatusStability.shortChangeCount,
      history: Object.freeze(viewportStatusStability.history.slice())
    });
  }

  function getViewportStatusHistory() {
    return Object.freeze(viewportStatusStability.history.slice());
  }

  function getViewportStatusResidency(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const durationsMs = {};
    VIEWPORT_STATUS_LEVELS.forEach(level => {
      durationsMs[level] = viewportStatusStability.accumulatedDurationsMs[level];
    });
    if (VIEWPORT_STATUS_LEVELS.includes(viewportStatusStability.currentLevel)
      && Number.isFinite(viewportStatusStability.sinceMs)) {
      durationsMs[viewportStatusStability.currentLevel] += Math.max(
        0,
        now - viewportStatusStability.sinceMs
      );
    }
    const totalDurationMs = Number.isFinite(viewportStatusStability.testStartedMs)
      ? Math.max(0, now - viewportStatusStability.testStartedMs)
      : 0;
    const percentages = {};
    VIEWPORT_STATUS_LEVELS.forEach(level => {
      percentages[level] = totalDurationMs > 0
        ? (durationsMs[level] / totalDurationMs) * 100
        : 0;
    });
    return Object.freeze({
      totalDurationMs,
      durationsMs: Object.freeze(durationsMs),
      percentages: Object.freeze(percentages)
    });
  }

  function formatViewportStatusStability(stability) {
    if (!stability) return "Statusdauer: - \u00b7 Wechsel: 0 \u00b7 Letzter Wechsel: - \u00b7 Kurzwechsel: 0";
    const duration = `${(stability.durationMs / 1000).toFixed(1)} s`;
    const lastChange = Number.isFinite(stability.lastChangeMs)
      ? new Date(stability.lastChangeMs).toLocaleTimeString()
      : "-";
    return `Statusdauer: ${duration} \u00b7 Wechsel: ${stability.changeCount} \u00b7 Letzter Wechsel: ${lastChange} \u00b7 Kurzwechsel: ${stability.shortChangeCount}`;
  }

  function formatViewportStatusHistoryEntry(entry) {
    if (!entry) return "-";
    const time = new Date(entry.atMs).toLocaleTimeString();
    const previous = VIEWPORT_DIFFERENCE_LEVEL_LABELS[entry.previousLevel] || entry.previousLevel;
    const next = VIEWPORT_DIFFERENCE_LEVEL_LABELS[entry.newLevel] || entry.newLevel;
    return `${time} \u00b7 ${previous} \u2192 ${next} \u00b7 ${(entry.previousDurationMs / 1000).toFixed(1)} s`;
  }

  function formatViewportStatusResidency(level, residency) {
    if (!residency || !VIEWPORT_STATUS_LEVELS.includes(level)) return "-";
    return `${VIEWPORT_DIFFERENCE_LEVEL_LABELS[level]}: ${(residency.durationsMs[level] / 1000).toFixed(1)} s (${residency.percentages[level].toFixed(1)} %)`;
  }

  function createViewportSessionSummary(nowMs) {
    if (!Number.isFinite(viewportStatusStability.testStartedMs)) return null;
    const endedAtMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    return Object.freeze({
      endedAtMs,
      totalDurationMs: getViewportStatusResidency(endedAtMs).totalDurationMs,
      changeCount: viewportStatusStability.changeCount,
      shortChangeCount: viewportStatusStability.shortChangeCount,
      residency: getViewportStatusResidency(endedAtMs),
      highestLevel: viewportStatusStability.highestLevel,
      lastLevel: viewportStatusStability.currentLevel
    });
  }

  function getOrCreateViewportSessionSummaryDiagnostic() {
    if (!global.document) return null;
    let diagnostic = global.document.getElementById(VIEWPORT_SESSION_SUMMARY_ID);
    if (diagnostic) return diagnostic;
    const mapWrap = global.document.getElementById("mapWrap");
    if (!mapWrap || typeof global.document.createElement !== "function") return null;
    diagnostic = global.document.createElement("div");
    diagnostic.id = VIEWPORT_SESSION_SUMMARY_ID;
    diagnostic.className = "editor-maplibre-session-summary";
    diagnostic.setAttribute("aria-hidden", "true");
    mapWrap.appendChild(diagnostic);
    return diagnostic;
  }

  function getOrCreateViewportSessionSummaryRestore() {
    if (!global.document) return null;
    let button = global.document.getElementById(VIEWPORT_SESSION_SUMMARY_RESTORE_ID);
    if (button) return button;
    const mapWrap = global.document.getElementById("mapWrap");
    if (!mapWrap || typeof global.document.createElement !== "function") return null;
    button = global.document.createElement("button");
    button.id = VIEWPORT_SESSION_SUMMARY_RESTORE_ID;
    button.type = "button";
    button.className = "editor-maplibre-session-summary-restore";
    button.textContent = "Testsitzung anzeigen";
    button.setAttribute("aria-hidden", "true");
    button.addEventListener("click", showViewportSessionSummary);
    mapWrap.appendChild(button);
    return button;
  }

  function renderViewportSessionSummary(diagnostic, summary) {
    if (!diagnostic || !summary || !global.document) return false;
    lastViewportSessionSummary = summary;
    const nodes = [];
    const heading = global.document.createElement("span");
    heading.className = "editor-maplibre-session-summary-heading";
    const headingText = global.document.createElement("strong");
    headingText.textContent = "MapLibre-Testsitzung";
    heading.appendChild(headingText);
    const closeButton = global.document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "editor-maplibre-session-summary-close";
    closeButton.textContent = "\u00d7";
    closeButton.title = "Diagnose-Zusammenfassung ausblenden";
    closeButton.setAttribute("aria-label", "Diagnose-Zusammenfassung ausblenden");
    closeButton.addEventListener("click", () => hideViewportSessionSummary(true));
    heading.appendChild(closeButton);
    nodes.push(heading);
    const overview = global.document.createElement("span");
    overview.textContent = `Dauer: ${(summary.totalDurationMs / 1000).toFixed(1)} s \u00b7 Wechsel: ${summary.changeCount} \u00b7 Kurzwechsel: ${summary.shortChangeCount}`;
    nodes.push(overview);
    const levels = global.document.createElement("span");
    levels.textContent = `H\u00f6chste Stufe: ${VIEWPORT_DIFFERENCE_LEVEL_LABELS[summary.highestLevel] || "-"} \u00b7 Letzter Status: ${VIEWPORT_DIFFERENCE_LEVEL_LABELS[summary.lastLevel] || "-"}`;
    nodes.push(levels);
    VIEWPORT_STATUS_LEVELS.forEach(level => {
      const item = global.document.createElement("span");
      item.textContent = formatViewportStatusResidency(level, summary.residency);
      item.setAttribute("data-level", level);
      item.setAttribute("data-duration-ms", String(summary.residency.durationsMs[level]));
      item.setAttribute("data-percentage", String(summary.residency.percentages[level]));
      nodes.push(item);
    });
    if (typeof diagnostic.replaceChildren === "function") diagnostic.replaceChildren(...nodes);
    else {
      diagnostic.textContent = "";
      nodes.forEach(node => diagnostic.appendChild(node));
    }
    diagnostic.classList.add("is-active");
    diagnostic.setAttribute("aria-hidden", "false");
    const restore = getOrCreateViewportSessionSummaryRestore();
    if (restore) {
      restore.classList.remove("is-active");
      restore.setAttribute("aria-hidden", "true");
    }
    return true;
  }

  function hideViewportSessionSummary(allowRestore) {
    const diagnostic = global.document
      ? global.document.getElementById(VIEWPORT_SESSION_SUMMARY_ID)
      : null;
    if (diagnostic) {
      diagnostic.classList.remove("is-active");
      diagnostic.setAttribute("aria-hidden", "true");
    }
    const restore = getOrCreateViewportSessionSummaryRestore();
    const canRestore = !!allowRestore && !!lastViewportSessionSummary;
    if (restore) {
      restore.classList.toggle("is-active", canRestore);
      restore.setAttribute("aria-hidden", canRestore ? "false" : "true");
    }
    return !!diagnostic;
  }

  function showViewportSessionSummary() {
    if (!lastViewportSessionSummary) return false;
    return renderViewportSessionSummary(
      getOrCreateViewportSessionSummaryDiagnostic(),
      lastViewportSessionSummary
    );
  }

  function renderViewportDifferenceDiagnostic(diagnostic, differences) {
    if (!diagnostic || !global.document || typeof global.document.createElement !== "function") return false;
    if (!differences) {
      diagnostic.textContent = formatViewportDifferenceDiagnostic(null);
      return true;
    }
    const levels = evaluateViewportDifferences(differences);
    const signed = (value, digits) => Number.isFinite(value)
      ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`
      : "-";
    const metrics = [
      ["centerMeters", "Center", Number.isFinite(differences.centerMeters) ? `${differences.centerMeters.toFixed(1)} m` : "-"],
      ["zoom", "Zoom", signed(differences.zoom, 2)],
      ["bearing", "Bearing", `${signed(differences.bearing, 1)}°`],
      ["pitch", "Pitch", `${signed(differences.pitch, 1)}°`]
    ];
    const nodes = [];
    const overallLevel = getOverallViewportDifferenceLevel(levels);
    const title = global.document.createElement("span");
    title.className = `viewport-diff-title is-${overallLevel}`;
    title.textContent = `Viewport-Diff · Gesamt: ${VIEWPORT_DIFFERENCE_LEVEL_LABELS[overallLevel]}`;
    title.setAttribute("data-level", overallLevel);
    nodes.push(title);
    const stability = updateViewportStatusStability(overallLevel);
    const stabilityNode = global.document.createElement("span");
    stabilityNode.className = `viewport-diff-stability${stability.lastDurationMs != null && stability.lastDurationMs < VIEWPORT_STATUS_FLAP_MS ? " is-flapping" : ""}`;
    stabilityNode.textContent = formatViewportStatusStability(stability);
    stabilityNode.setAttribute("data-change-count", String(stability.changeCount));
    stabilityNode.setAttribute("data-short-change-count", String(stability.shortChangeCount));
    nodes.push(stabilityNode);
    metrics.forEach(([type, label, value]) => {
      const level = levels[type];
      const metric = global.document.createElement("span");
      metric.className = `viewport-diff-metric is-${level}`;
      metric.textContent = `${label}: ${value}`;
      metric.title = `${label}: ${VIEWPORT_DIFFERENCE_LEVEL_LABELS[level]}`;
      metric.setAttribute("data-level", level);
      nodes.push(metric);
    });
    const residency = getViewportStatusResidency();
    const residencyNode = global.document.createElement("span");
    residencyNode.className = "viewport-diff-residency";
    const residencyTitle = global.document.createElement("span");
    residencyTitle.className = "viewport-diff-residency-title";
    residencyTitle.textContent = "Verweildauer";
    residencyNode.appendChild(residencyTitle);
    VIEWPORT_STATUS_LEVELS.forEach(level => {
      const item = global.document.createElement("span");
      item.className = `viewport-diff-residency-entry is-${level}${level === overallLevel ? " is-current" : ""}`;
      item.textContent = formatViewportStatusResidency(level, residency);
      item.setAttribute("data-level", level);
      item.setAttribute("data-duration-ms", String(residency.durationsMs[level]));
      item.setAttribute("data-percentage", String(residency.percentages[level]));
      residencyNode.appendChild(item);
    });
    nodes.push(residencyNode);
    const history = global.document.createElement("span");
    history.className = "viewport-diff-history";
    const historyTitle = global.document.createElement("span");
    historyTitle.className = "viewport-diff-history-title";
    historyTitle.textContent = "Wechselverlauf";
    history.appendChild(historyTitle);
    if (!stability.history.length) {
      const empty = global.document.createElement("span");
      empty.className = "viewport-diff-history-empty";
      empty.textContent = "Noch keine Wechsel";
      history.appendChild(empty);
    } else {
      stability.history.slice().reverse().forEach(entry => {
        const item = global.document.createElement("span");
        item.className = `viewport-diff-history-entry${entry.isShort ? " is-short" : ""}`;
        item.textContent = formatViewportStatusHistoryEntry(entry);
        item.setAttribute("data-previous-level", entry.previousLevel);
        item.setAttribute("data-new-level", entry.newLevel);
        item.setAttribute("data-duration-ms", String(entry.previousDurationMs));
        history.appendChild(item);
      });
    }
    nodes.push(history);
    if (typeof diagnostic.replaceChildren === "function") diagnostic.replaceChildren(...nodes);
    else {
      diagnostic.textContent = "";
      nodes.forEach(node => diagnostic.appendChild(node));
    }
    return true;
  }

  function updateViewportDifferenceDiagnostic() {
    if (!MAPLIBRE_MIGRATION_ENABLED) return false;
    const diagnostic = getOrCreateViewportDifferenceDiagnostic();
    if (!diagnostic) return false;
    renderViewportDifferenceDiagnostic(diagnostic, readViewportDifferences());
    diagnostic.classList.add("is-active");
    diagnostic.setAttribute("aria-hidden", "false");
    return true;
  }

  function scheduleViewportDifferenceDiagnostic() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    if (viewportDifferenceFrame != null) return true;
    viewportDifferenceFrame = global.requestAnimationFrame(() => {
      viewportDifferenceFrame = null;
      updateViewportDifferenceDiagnostic();
    });
    return true;
  }

  function startViewportDifferenceDiagnostics() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || typeof managedMap.on !== "function") return false;
    const diagnostic = getOrCreateViewportDifferenceDiagnostic();
    if (!diagnostic) return false;
    if (!viewportDifferenceMapHandler) {
      viewportDifferenceMap = managedMap;
      viewportDifferenceMapHandler = scheduleViewportDifferenceDiagnostic;
      ["move", "zoom", "rotate", "pitch"].forEach(eventName => {
        viewportDifferenceMap.on(eventName, viewportDifferenceMapHandler);
      });
    }
    if (viewportDifferenceDurationTimer == null && typeof global.setInterval === "function") {
      viewportDifferenceDurationTimer = global.setInterval(scheduleViewportDifferenceDiagnostic, 1000);
    }
    scheduleViewportDifferenceDiagnostic();
    return true;
  }

  function stopViewportDifferenceDiagnostics() {
    if (viewportDifferenceMap && viewportDifferenceMapHandler && typeof viewportDifferenceMap.off === "function") {
      ["move", "zoom", "rotate", "pitch"].forEach(eventName => {
        viewportDifferenceMap.off(eventName, viewportDifferenceMapHandler);
      });
    }
    if (viewportDifferenceFrame != null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(viewportDifferenceFrame);
    }
    if (viewportDifferenceDurationTimer != null && typeof global.clearInterval === "function") {
      global.clearInterval(viewportDifferenceDurationTimer);
    }
    viewportDifferenceMap = null;
    viewportDifferenceMapHandler = null;
    viewportDifferenceFrame = null;
    viewportDifferenceDurationTimer = null;
    resetViewportStatusStability();
    const diagnostic = global.document
      ? global.document.getElementById(VIEWPORT_DIFF_DIAGNOSTIC_ID)
      : null;
    if (diagnostic) {
      diagnostic.classList.remove("is-active");
      diagnostic.setAttribute("aria-hidden", "true");
    }
    return true;
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
      container.parentElement.classList.toggle("maplibre-test-active", active && MAPLIBRE_SIDE_BY_SIDE_ENABLED);
      container.parentElement.classList.toggle("maplibre-main-active", active && MAPLIBRE_MAIN_ENGINE_REQUESTED);
    }
    const label = getTestLabel();
    const labelText = label && label.querySelector("span");
    if (labelText) labelText.textContent = MAPLIBRE_MAIN_ENGINE_REQUESTED ? "MapLibre Hauptkarte (Test)" : "MapLibre Test";
    setLabelActive(label, active);
    setLabelActive(getLeafletTestLabel(), active && MAPLIBRE_SIDE_BY_SIDE_ENABLED);
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
    closeButton.hidden = MAPLIBRE_MAIN_ENGINE_REQUESTED;
    closeButton.addEventListener("click", () => setDeveloperTestViewVisible(false));
    testCloseButtonBound = true;
  }

  function initializeTestMap(overrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED) return null;
    hideViewportSessionSummary(false);
    lastViewportSessionSummary = null;
    const container = setTestContainerActive(true);
    if (!container) throw new Error("MapLibre-Testcontainer wurde nicht gefunden.");
    try {
      const instance = initializeMapLibreMap(container, overrides);
      applyMapLibreTestInteractionState();
      startMapLibreViewportDiagnostics();
      startViewportDifferenceDiagnostics();
      if (instance && typeof instance.on === "function") {
        instance.on("error", event => {
          console.error("[Editor MapLibre Test] MapLibre-/Style-Fehler", event.error || event);
        });
      }
      bindTestViewControls();
      startHitTestDiagnostics();
      startMapLibreObjectDragging();
      startMapLibreEditorDeleteHandling();
      global.requestAnimationFrame(() => {
        resizeMapLibreMap();
        logTestViewMetrics();
      });
      startEditorLineMirroring();
      if (viewportOwnerEngine === "maplibre") startMapLibreOwnerViewportSync();
      else startLeafletViewportSync();
      return instance;
    } catch (err) {
      console.error("[Editor MapLibre Test] Initialisierung fehlgeschlagen", err);
      stopHitTestDiagnostics();
      setTestContainerActive(false);
      throw err;
    }
  }

  function destroyTestMap() {
    if (MAPLIBRE_MAIN_ENGINE_REQUESTED) return null;
    const sessionSummary = createViewportSessionSummary();
    clearMapLibreTestSelection();
    stopMapLibreEditorDeleteHandling();
    stopMapLibreObjectDragging();
    stopHitTestDiagnostics();
    stopLeafletViewportSync();
    stopMapLibreOwnerViewportSync();
    stopEditorLineMirroring();
    destroyMapLibreMap();
    const container = getTestContainer();
    if (container) container.classList.remove("is-interactive");
    updateMapLibreInteractionStatus(false);
    setTestContainerActive(false);
    if (sessionSummary) {
      renderViewportSessionSummary(getOrCreateViewportSessionSummaryDiagnostic(), sessionSummary);
    }
  }

  function setDeveloperTestViewVisible(visible) {
    if (!MAPLIBRE_MIGRATION_ENABLED) return null;
    if (MAPLIBRE_MAIN_ENGINE_REQUESTED && !visible) return managedMap;
    if (visible) {
      const instance = managedMap || initializeTestMap();
      setTestContainerActive(true);
      applyMapLibreTestInteractionState();
      startMapLibreViewportDiagnostics();
      startViewportDifferenceDiagnostics();
      startHitTestDiagnostics();
      startMapLibreObjectDragging();
      startMapLibreEditorDeleteHandling();
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
    if (MAPLIBRE_MAIN_ENGINE_REQUESTED) return managedMap;
    return setDeveloperTestViewVisible(!getMapLibreMap());
  }

  function createLineGeoJson(editorPoints, featureId) {
    const coordinates = Array.isArray(editorPoints)
      ? editorPoints.map(point => toMapLibreLngLat(point)).filter(Boolean)
      : [];
    return {
      type: "Feature",
      properties: {
        id: featureId == null ? "line" : String(featureId)
      },
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

  function enforceEditorOverlayLayerOrder() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || typeof managedMap.moveLayer !== "function") {
      return false;
    }
    EDITOR_OVERLAY_LAYER_ORDER.forEach(layerId => {
      if (managedMap.getLayer(layerId)) managedMap.moveLayer(layerId);
    });
    return true;
  }

  function normalizeHitTestPoint(point) {
    if (Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      return { x: point[0], y: point[1] };
    }
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return { x: point.x, y: point.y };
    }
    return null;
  }

  function createHitTestGeometry(screenPoint, radius) {
    return radius > 0
      ? [
          [screenPoint.x - radius, screenPoint.y - radius],
          [screenPoint.x + radius, screenPoint.y + radius]
        ]
      : [screenPoint.x, screenPoint.y];
  }

  function cloneHitGeometry(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    if (geometry.type === "Point" && geometry.coordinates.length >= 2) {
      const coordinates = [Number(geometry.coordinates[0]), Number(geometry.coordinates[1])];
      return coordinates.every(Number.isFinite)
        ? Object.freeze({ type: "Point", coordinates: Object.freeze(coordinates) })
        : null;
    }
    if (geometry.type === "LineString") {
      const coordinates = geometry.coordinates
        .map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
        .filter(point => point && point.every(Number.isFinite))
        .map(point => Object.freeze(point));
      return coordinates.length >= 2
        ? Object.freeze({ type: "LineString", coordinates: Object.freeze(coordinates) })
        : null;
    }
    return null;
  }

  function hitTestEditorObject(point, options) {
    if (
      !MAPLIBRE_MIGRATION_ENABLED
      || !managedMap
      || typeof managedMap.queryRenderedFeatures !== "function"
    ) {
      return null;
    }
    const screenPoint = normalizeHitTestPoint(point);
    if (!screenPoint) return null;
    const availableDefinitions = HIT_TEST_LAYER_DEFINITIONS.filter(definition =>
      managedMap.getLayer(definition.layerId)
    );
    if (!availableDefinitions.length) return null;
    const pointDefinitions = availableDefinitions.filter(definition => definition.geometryKind === "point");
    const lineDefinitions = availableDefinitions.filter(definition => definition.geometryKind === "line");
    const requestedRadius = options && Number(options.radius);
    const requestedLineRadius = options && Number(options.lineRadius);
    const pointRadius = Number.isFinite(requestedRadius) ? Math.max(0, requestedRadius) : 4;
    const lineRadius = Number.isFinite(requestedLineRadius) ? Math.max(0, requestedLineRadius) : 7;
    const queryDefinitions = (definitions, radius) => {
      if (!definitions.length) return [];
      const results = managedMap.queryRenderedFeatures(createHitTestGeometry(screenPoint, radius), {
        layers: definitions.map(definition => definition.layerId)
      });
      return Array.isArray(results) ? results : [];
    };
    const features = [
      ...queryDefinitions(pointDefinitions, pointRadius),
      ...queryDefinitions(lineDefinitions, lineRadius)
    ];
    if (!Array.isArray(features) || !features.length) return null;

    const priorityByLayer = new Map(
      availableDefinitions.map((definition, index) => [definition.layerId, index])
    );
    const hit = features
      .filter(feature => feature && feature.layer && priorityByLayer.has(feature.layer.id))
      .sort((a, b) => priorityByLayer.get(a.layer.id) - priorityByLayer.get(b.layer.id))[0];
    if (!hit) return null;
    const definition = availableDefinitions.find(item => item.layerId === hit.layer.id);
    const properties = hit.properties || {};
    const geometry = cloneHitGeometry(hit.geometry);
    const coordinates = geometry && geometry.type === "Point" ? geometry.coordinates : null;
    return Object.freeze({
      layerId: hit.layer.id,
      layerType: hit.layer.type || "circle",
      featureType: definition.featureType,
      id: properties.id == null ? null : String(properties.id),
      helperKind: definition.featureType === "detourHelperPoint" && properties.kind != null
        ? String(properties.kind)
        : null,
      coordinates,
      geometry
    });
  }

  function createHoverHighlightGeoJson(hit) {
    const geometry = hit && hit.geometry
      ? hit.geometry
      : (hit && Array.isArray(hit.coordinates)
          ? { type: "Point", coordinates: hit.coordinates }
          : null);
    const clonedGeometry = cloneHitGeometry(geometry);
    if (!clonedGeometry) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {
          featureType: hit.featureType,
          id: hit.id
        },
        geometry: clonedGeometry
      }]
    };
  }

  function applyHoverHighlightLayer() {
    if (!managedMap) return;
    const source = managedMap.getSource(HOVER_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(desiredHoverData);
    } else {
      managedMap.addSource(HOVER_SOURCE_ID, { type: "geojson", data: desiredHoverData });
    }
    if (!managedMap.getLayer(HOVER_LAYER_ID)) {
      managedMap.addLayer({
        id: HOVER_LAYER_ID,
        type: "circle",
        source: HOVER_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["match", ["get", "featureType"],
            "routePoint", 9,
            13
          ],
          "circle-color": "rgba(255, 255, 255, 0.12)",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#fbbf24",
          "circle-blur": 0.08
        }
      });
    }
    if (!managedMap.getLayer(HOVER_LINE_LAYER_ID)) {
      managedMap.addLayer({
        id: HOVER_LINE_LAYER_ID,
        type: "line",
        source: HOVER_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#fbbf24",
          "line-width": 2,
          "line-gap-width": 7,
          "line-opacity": 0.9
        }
      });
    }
    enforceEditorOverlayLayerOrder();
  }

  function setEditorHoverHighlight(hit) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const data = createHoverHighlightGeoJson(hit);
    const signature = JSON.stringify(data);
    if (mirroredHoverSignature === signature) return true;
    mirroredHoverSignature = signature;
    desiredHoverData = data;
    if (!data.features.length && !managedMap.getSource(HOVER_SOURCE_ID)) return true;
    if (typeof managedMap.isStyleLoaded === "function" && !managedMap.isStyleLoaded()) {
      managedMap.once("load", applyHoverHighlightLayer);
    } else {
      applyHoverHighlightLayer();
    }
    return true;
  }

  function clearEditorHoverHighlight() {
    return setEditorHoverHighlight(null);
  }

  function createTestSelectionGeoJson(selection) {
    const object = selection && selection.object;
    const geometry = selection && selection.geometry
      ? cloneHitGeometry(selection.geometry)
      : (object && Number.isFinite(object.lat) && Number.isFinite(object.lon)
          ? { type: "Point", coordinates: [object.lon, object.lat] }
          : null);
    if (!geometry) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {
          featureType: selection.featureType,
          id: selection.id
        },
        geometry
      }]
    };
  }

  function getCurrentTestSelectionGeometry(selection, object) {
    if (!selection) return null;
    if (selection.featureType === "route" || selection.featureType === "preview") {
      const editorState = getEditorState();
      const points = selection.featureType === "route"
        ? editorState && editorState.routePoints
        : editorState && editorState.simplifiedRoutePoints;
      return cloneHitGeometry(createLineGeoJson(points).geometry) || cloneHitGeometry(selection.geometry);
    }
    const lineKindByType = {
      specialTrack: "specialTracks",
      detourDraft: "detourDraft",
      detourPlanned: "detourPlanned",
      detourRemoved: "detourRemoved"
    };
    const lineKind = lineKindByType[selection.featureType];
    if (lineKind) {
      const data = desiredSupplementalLineData[lineKind];
      const feature = data && Array.isArray(data.features)
        ? data.features.find(item => item && item.properties && String(item.properties.id) === String(selection.id))
        : null;
      return cloneHitGeometry(feature && feature.geometry) || cloneHitGeometry(selection.geometry);
    }
    return object && Number.isFinite(object.lat) && Number.isFinite(object.lon)
      ? cloneHitGeometry({ type: "Point", coordinates: [object.lon, object.lat] })
      : null;
  }

  function applyMapLibreTestSelectionLayer() {
    if (!managedMap) return;
    const source = managedMap.getSource(TEST_SELECTION_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(desiredTestSelectionData);
    } else {
      managedMap.addSource(TEST_SELECTION_SOURCE_ID, {
        type: "geojson",
        data: desiredTestSelectionData
      });
    }
    if (!managedMap.getLayer(TEST_SELECTION_LAYER_ID)) {
      managedMap.addLayer({
        id: TEST_SELECTION_LAYER_ID,
        type: "circle",
        source: TEST_SELECTION_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["match", ["get", "featureType"], "routePoint", 12, 16],
          "circle-color": "rgba(34, 211, 238, 0.08)",
          "circle-stroke-width": 4,
          "circle-stroke-color": "#22d3ee",
          "circle-blur": 0.05
        }
      });
    }
    if (!managedMap.getLayer(TEST_SELECTION_LINE_LAYER_ID)) {
      managedMap.addLayer({
        id: TEST_SELECTION_LINE_LAYER_ID,
        type: "line",
        source: TEST_SELECTION_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#22d3ee",
          "line-width": 3,
          "line-gap-width": 9,
          "line-opacity": 0.85
        }
      });
    }
    enforceEditorOverlayLayerOrder();
  }

  function syncMapLibreTestSelection() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    if (mapLibreTestSelection) {
      const object = resolveEditorObjectReadOnly(mapLibreTestSelection);
      if (!object) mapLibreTestSelection = null;
      else {
        mapLibreTestSelection = Object.freeze({
          featureType: mapLibreTestSelection.featureType,
          layerId: mapLibreTestSelection.layerId,
          id: mapLibreTestSelection.id,
          helperKind: mapLibreTestSelection.helperKind,
          object,
          geometry: getCurrentTestSelectionGeometry(mapLibreTestSelection, object)
        });
      }
    }
    const data = createTestSelectionGeoJson(mapLibreTestSelection);
    const signature = JSON.stringify(data);
    if (mirroredTestSelectionSignature === signature) return true;
    mirroredTestSelectionSignature = signature;
    desiredTestSelectionData = data;
    if (!data.features.length && !managedMap.getSource(TEST_SELECTION_SOURCE_ID)) return true;
    if (typeof managedMap.isStyleLoaded === "function" && !managedMap.isStyleLoaded()) {
      managedMap.once("load", applyMapLibreTestSelectionLayer);
    } else {
      applyMapLibreTestSelectionLayer();
    }
    return true;
  }

  function setMapLibreTestSelection(hit) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const object = resolveEditorObjectReadOnly(hit);
    mapLibreTestSelection = object
      ? Object.freeze({
          featureType: hit.featureType,
          layerId: hit.layerId,
          id: String(hit.id),
          helperKind: hit.helperKind || null,
          object,
          geometry: cloneHitGeometry(hit.geometry)
        })
      : null;
    return syncMapLibreTestSelection();
  }

  function clearMapLibreTestSelection() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) {
      mapLibreTestSelection = null;
      mirroredTestSelectionSignature = null;
      return false;
    }
    mapLibreTestSelection = null;
    return syncMapLibreTestSelection();
  }

  function getMapLibreTestSelection() {
    return mapLibreTestSelection;
  }

  function createEditorSelectionGeoJson(editorState) {
    if (!editorState) return { type: "FeatureCollection", features: [] };
    const features = [];
    const seen = new Set();
    const appendPoint = (featureType, object) => {
      const coordinates = toMapLibreLngLat(object);
      if (!coordinates || !object || object.id == null) return;
      const key = `${featureType}:${object.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      features.push({
        type: "Feature",
        properties: { featureType, id: String(object.id) },
        geometry: { type: "Point", coordinates }
      });
    };
    const appendLine = (featureType, object) => {
      if (!object || object.id == null || !Array.isArray(object.points)) return;
      const coordinates = object.points.map(point => toMapLibreLngLat(point)).filter(Boolean);
      if (coordinates.length < 2) return;
      const key = `${featureType}:${object.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      features.push({
        type: "Feature",
        properties: { featureType, id: String(object.id) },
        geometry: { type: "LineString", coordinates }
      });
    };
    const selectedStopIds = editorState.selectedStopIds instanceof Set
      ? editorState.selectedStopIds
      : new Set();
    (Array.isArray(editorState.stops) ? editorState.stops : []).forEach(stop => {
      if (selectedStopIds.has(stop.id)) appendPoint("stop", stop);
    });
    const selectedRoutePointIds = editorState.selectedRoutePointIds instanceof Set
      ? editorState.selectedRoutePointIds
      : new Set();
    (Array.isArray(editorState.routePoints) ? editorState.routePoints : []).forEach(point => {
      if (selectedRoutePointIds.has(point.id)) appendPoint("routePoint", point);
    });
    const selected = editorState.selected;
    if (selected && selected.ref) {
      if (selected.type === "stop") appendPoint("stop", selected.ref);
      else if (selected.type === "route") appendPoint("routePoint", selected.ref);
      else if (selected.type === "detourReplacementStop" || selected.type === "detourManualRoutePoint") {
        appendPoint("detourHelperPoint", selected.ref);
      }
      else if (selected.type === "specialTrack") appendLine("specialTrack", selected.ref);
    }
    return { type: "FeatureCollection", features };
  }

  function applyEditorSelectionLayer() {
    if (!managedMap) return;
    const source = managedMap.getSource(EDITOR_SELECTION_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(desiredEditorSelectionData);
    } else {
      managedMap.addSource(EDITOR_SELECTION_SOURCE_ID, {
        type: "geojson",
        data: desiredEditorSelectionData
      });
    }
    if (!managedMap.getLayer(EDITOR_SELECTION_LAYER_ID)) {
      managedMap.addLayer({
        id: EDITOR_SELECTION_LAYER_ID,
        type: "circle",
        source: EDITOR_SELECTION_SOURCE_ID,
        paint: {
          "circle-radius": ["match", ["get", "featureType"], "routePoint", 11, 15],
          "circle-color": "rgba(34, 197, 94, 0.08)",
          "circle-stroke-width": 5,
          "circle-stroke-color": "#22c55e",
          "circle-blur": 0.03
        }
      });
    }
    if (!managedMap.getLayer(EDITOR_SELECTION_LINE_LAYER_ID)) {
      managedMap.addLayer({
        id: EDITOR_SELECTION_LINE_LAYER_ID,
        type: "line",
        source: EDITOR_SELECTION_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#22c55e",
          "line-width": 3,
          "line-gap-width": 9,
          "line-opacity": 0.9
        }
      });
    }
    enforceEditorOverlayLayerOrder();
  }

  function syncEditorSelection() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const data = createEditorSelectionGeoJson(getEditorState());
    const signature = JSON.stringify(data);
    if (signature === mirroredEditorSelectionSignature) return true;
    mirroredEditorSelectionSignature = signature;
    desiredEditorSelectionData = data;
    if (!data.features.length && !managedMap.getSource(EDITOR_SELECTION_SOURCE_ID)) return true;
    if (typeof managedMap.isStyleLoaded === "function" && !managedMap.isStyleLoaded()) {
      managedMap.once("load", applyEditorSelectionLayer);
    } else {
      applyEditorSelectionLayer();
    }
    return true;
  }

  function formatHitTestDiagnostic(hit) {
    if (!hit) return "Hover · kein Treffer";
    return `Hover · Typ: ${hit.featureType} · Layer: ${hit.layerId} · ID: ${hit.id ?? "-"}`;
  }

  function resolveEditorObjectReadOnly(hit) {
    if (!hit || hit.id == null) return null;
    const editorState = getEditorState();
    if (!editorState) return null;
    const id = String(hit.id);
    let object = null;
    let diagnosticName = null;
    if (hit.featureType === "stop") {
      object = (Array.isArray(editorState.stops) ? editorState.stops : [])
        .find(item => item && String(item.id) === id) || null;
    } else if (hit.featureType === "catalogStop") {
      object = resolveCatalogStopReference(hit);
    } else if (hit.featureType === "routePoint") {
      object = (Array.isArray(editorState.routePoints) ? editorState.routePoints : [])
        .find(item => item && String(item.id) === id) || null;
    } else if (hit.featureType === "detourHelperPoint") {
      const wizard = editorState.detourWizard || {};
      const helperPoints = [
        ...(Array.isArray(wizard.replacementStops) ? wizard.replacementStops : []),
        ...(Array.isArray(wizard.manualRoutePoints) ? wizard.manualRoutePoints : [])
      ];
      object = helperPoints.find(item => item && String(item.id) === id) || null;
    } else if (hit.featureType === "specialTrack") {
      const tracks = Array.isArray(editorState.specialTracks) ? editorState.specialTracks.slice() : [];
      if (editorState.currentSpecialTrack) tracks.push(editorState.currentSpecialTrack);
      object = tracks.find(item => item && String(item.id) === id) || null;
      if (object) {
        diagnosticName = [object.fromStopName, object.toStopName].filter(Boolean).join(" → ") || "Spezialstrecke";
      }
    } else if (hit.featureType === "route" && id === LINE_FEATURE_IDS.route) {
      object = Array.isArray(editorState.routePoints) && editorState.routePoints.length >= 2
        ? editorState.routePoints
        : null;
      diagnosticName = "Haupt-Route";
    } else if (hit.featureType === "preview" && id === LINE_FEATURE_IDS.preview) {
      object = Array.isArray(editorState.simplifiedRoutePoints) && editorState.simplifiedRoutePoints.length >= 2
        ? editorState.simplifiedRoutePoints
        : null;
      diagnosticName = "Preview-/Routinglinie";
    } else if (["detourDraft", "detourPlanned", "detourRemoved"].includes(hit.featureType)) {
      const expectedId = hit.featureType;
      if (id === expectedId) object = getDetourPreviewPolyline(hit.featureType, editorState);
      diagnosticName = {
        detourDraft: "Umleitungsentwurf",
        detourPlanned: "Geplante Alternative",
        detourRemoved: "Entfallender Abschnitt"
      }[hit.featureType];
    }
    if (!object) return null;
    return Object.freeze({
      type: hit.featureType,
      id,
      name: diagnosticName || (object.name == null ? null : String(object.name)),
      lat: object.lat != null && Number.isFinite(Number(object.lat)) ? Number(object.lat) : null,
      lon: object.lon != null && Number.isFinite(Number(object.lon)) ? Number(object.lon) : null
    });
  }

  function formatResolvedEditorObject(object) {
    if (!object) return "Objekt · nicht gefunden";
    const name = object.name || "-";
    const position = Number.isFinite(object.lat) && Number.isFinite(object.lon)
      ? `${object.lat.toFixed(6)}, ${object.lon.toFixed(6)}`
      : "-";
    return `Objekt · Typ: ${object.type} · ID: ${object.id} · Name: ${name} · Position: ${position}`;
  }

  function formatClickDiagnostic(hit) {
    if (!hit) return "Klick · kein Treffer";
    const featureLine = `Klick · Typ: ${hit.featureType} · Layer: ${hit.layerId} · ID: ${hit.id ?? "-"}`;
    return `${featureLine}\n${formatResolvedEditorObject(resolveEditorObjectReadOnly(hit))}`;
  }

  function getOrCreateHitTestDiagnostic() {
    if (!global.document) return null;
    let diagnostic = global.document.getElementById(HIT_TEST_DIAGNOSTIC_ID);
    if (diagnostic) return diagnostic;
    const container = getTestContainer();
    if (!container || typeof global.document.createElement !== "function") return null;
    diagnostic = global.document.createElement("div");
    diagnostic.id = HIT_TEST_DIAGNOSTIC_ID;
    diagnostic.className = "editor-maplibre-hit-diagnostic";
    diagnostic.setAttribute("aria-hidden", "true");
    diagnostic.textContent = formatHitTestDiagnostic(null);
    container.appendChild(diagnostic);
    return diagnostic;
  }

  function updateHitTestDiagnostic(hit) {
    const diagnostic = getOrCreateHitTestDiagnostic();
    if (!diagnostic) return false;
    diagnostic.textContent = formatHitTestDiagnostic(hit);
    return true;
  }

  function getOrCreateClickDiagnostic() {
    if (!global.document) return null;
    let diagnostic = global.document.getElementById(CLICK_DIAGNOSTIC_ID);
    if (diagnostic) return diagnostic;
    const container = getTestContainer();
    if (!container || typeof global.document.createElement !== "function") return null;
    diagnostic = global.document.createElement("div");
    diagnostic.id = CLICK_DIAGNOSTIC_ID;
    diagnostic.className = "editor-maplibre-click-diagnostic";
    diagnostic.setAttribute("aria-hidden", "true");
    diagnostic.textContent = formatClickDiagnostic(null);
    container.appendChild(diagnostic);
    return diagnostic;
  }

  function updateClickDiagnostic(hit) {
    const diagnostic = getOrCreateClickDiagnostic();
    if (!diagnostic) return false;
    diagnostic.textContent = formatClickDiagnostic(hit);
    return true;
  }

  function resolveEditorSelectionReference(hit) {
    if (!hit || hit.id == null) return null;
    const editorState = getEditorState();
    if (!editorState) return null;
    const id = String(hit.id);
    if (hit.featureType === "stop") {
      return (Array.isArray(editorState.stops) ? editorState.stops : [])
        .find(item => item && String(item.id) === id) || null;
    }
    if (hit.featureType === "catalogStop") return resolveCatalogStopReference(hit);
    if (hit.featureType === "routePoint") {
      return (Array.isArray(editorState.routePoints) ? editorState.routePoints : [])
        .find(item => item && String(item.id) === id) || null;
    }
    if (hit.featureType === "detourHelperPoint") {
      const wizard = editorState.detourWizard || {};
      return [
        ...(Array.isArray(wizard.replacementStops) ? wizard.replacementStops : []),
        ...(Array.isArray(wizard.manualRoutePoints) ? wizard.manualRoutePoints : [])
      ].find(item => item && String(item.id) === id) || null;
    }
    if (hit.featureType === "specialTrack") {
      const tracks = Array.isArray(editorState.specialTracks) ? editorState.specialTracks.slice() : [];
      if (editorState.currentSpecialTrack) tracks.push(editorState.currentSpecialTrack);
      return tracks.find(item => item && String(item.id) === id) || null;
    }
    return null;
  }

  function applyMapLibreEditorSelection(hit, event) {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED) return false;
    const editorState = getEditorState();
    if (!editorState) return false;
    if (!hit) {
      if (editorState.routeMode !== "select" || typeof clearSelection !== "function") return false;
      clearSelection();
      if (typeof setStatus === "function") setStatus("Auswahl aufgehoben.");
      return true;
    }
    const object = resolveEditorSelectionReference(hit);
    if (!object) return false;
    if (hit.featureType === "stop" && typeof selectStop === "function") {
      selectStop(object);
      return true;
    }
    if (
      hit.featureType === "routePoint"
      && event
      && (event.ctrlKey || event.metaKey)
      && typeof toggleRoutePointMultiSelection === "function"
    ) {
      toggleRoutePointMultiSelection(object);
      return true;
    }
    if (hit.featureType === "routePoint" && typeof selectRoutePoint === "function") {
      selectRoutePoint(object);
      return true;
    }
    if (hit.featureType === "specialTrack" && typeof selectSpecialTrack === "function") {
      selectSpecialTrack(object);
      return true;
    }
    if (hit.featureType === "detourHelperPoint" && typeof selectDetourHelperPoint === "function") {
      selectDetourHelperPoint(object);
      return true;
    }
    return false;
  }

  function isMapLibreDraggablePointHit(hit) {
    return !!hit && ["stop", "routePoint", "detourHelperPoint"].includes(hit.featureType);
  }

  function createEditorObjectAtMapLibrePoint(hit, event) {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED || isMapLibreDraggablePointHit(hit)) return false;
    if (hit && hit.featureType === "catalogStop") {
      const editorState = getEditorState();
      const catalogStop = resolveCatalogStopReference(hit);
      const replacementModeActive = !!(
        editorState
        && editorState.detourWizard
        && editorState.detourWizard.phase === "buildReplacement"
      );
      const normalStopModeActive = !!(
        editorState
        && editorState.placementMode === "freeStop"
        && !["select", "route", "manual", "specialTrack", "specialTrackExtend", "detourDraft", "detourSelectStops", "detourBuildReplacement"]
          .includes(editorState.routeMode)
      );
      if (
        !catalogStop
        || !editorState
        || (!replacementModeActive && !normalStopModeActive)
        || typeof handleCatalogStopActivation !== "function"
      ) {
        return false;
      }
      const created = handleCatalogStopActivation(catalogStop);
      if (created) syncEditorTestLayers();
      return !!created;
    }
    if (hit && hit.featureType === "specialTrack") {
      const editorState = getEditorState();
      const legacyMode = (() => {
        try { return typeof mode !== "undefined" ? mode : null; } catch (_err) { return null; }
      })();
      const routeMode = editorState && editorState.routeMode;
      if (![routeMode, legacyMode].some(value => value === "specialTrack" || value === "specialTrackExtend")) {
        return false;
      }
    }
    if (typeof handleEditorPointPlacement !== "function") return false;
    const lngLat = mapLibrePointerLngLat(event);
    if (!lngLat) return false;
    const created = handleEditorPointPlacement(lngLat, {
      insertOnRouteSegment: !!hit && ["route", "preview"].includes(hit.featureType)
    });
    if (created) syncEditorTestLayers();
    return created;
  }

  function deleteMapLibreSelectedEditorObject() {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED || typeof deleteSelectedEditorPointObject !== "function") {
      return false;
    }
    const deleted = deleteSelectedEditorPointObject();
    if (deleted) syncEditorTestLayers();
    return deleted;
  }

  function startMapLibreEditorDeleteHandling() {
    if (!MAPLIBRE_TEST_INTERACTION_ENABLED || !global.document || mapLibreEditorDeleteKeyHandler) {
      return false;
    }
    mapLibreEditorDeleteKeyHandler = event => {
      if ((!MAPLIBRE_MAIN_ENGINE_REQUESTED && !mapLibreEditorInteractionFocused) || event.key !== "Delete") return;
      const activeElement = global.document.activeElement;
      if (activeElement && (
        activeElement.isContentEditable
        || ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName)
      )) return;
      if (!deleteMapLibreSelectedEditorObject()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    global.document.addEventListener("keydown", mapLibreEditorDeleteKeyHandler, true);
    return true;
  }

  function stopMapLibreEditorDeleteHandling() {
    if (global.document && mapLibreEditorDeleteKeyHandler) {
      global.document.removeEventListener("keydown", mapLibreEditorDeleteKeyHandler, true);
    }
    mapLibreEditorDeleteKeyHandler = null;
    mapLibreEditorInteractionFocused = false;
    return true;
  }

  function setMapLibreDragCursor(active) {
    const canvas = managedMap && typeof managedMap.getCanvas === "function"
      ? managedMap.getCanvas()
      : null;
    if (canvas) canvas.style.cursor = active ? "grabbing" : "";
  }

  function applyEditorSelectionDragPreview(hit, coordinates) {
    if (!managedMap || !hit || !Array.isArray(coordinates)) return false;
    const source = managedMap.getSource(EDITOR_SELECTION_SOURCE_ID);
    if (!source || typeof source.setData !== "function") return false;
    const data = createEditorSelectionGeoJson(getEditorState());
    const feature = data.features.find(item =>
      item.properties
      && item.properties.featureType === hit.featureType
      && String(item.properties.id) === String(hit.id)
    );
    if (feature && feature.geometry && feature.geometry.type === "Point") {
      feature.geometry.coordinates = coordinates.slice(0, 2);
    }
    source.setData(data);
    return true;
  }

  function syncDraggedEditorObjectLayers(featureType) {
    if (featureType === "stop") return syncEditorStops();
    if (featureType === "routePoint") return syncEditorRoutePoints();
    if (featureType === "detourHelperPoint") return syncEditorDetourHelperPoints();
    return false;
  }

  function mapLibrePointerLngLat(event) {
    const container = getTestContainer();
    if (!managedMap || !container || typeof managedMap.unproject !== "function") return null;
    const rect = container.getBoundingClientRect();
    const lngLat = managedMap.unproject([event.clientX - rect.left, event.clientY - rect.top]);
    return lngLat && Number.isFinite(lngLat.lat) && Number.isFinite(lngLat.lng)
      ? lngLat
      : null;
  }

  function finishMapLibreObjectDrag(event) {
    const drag = mapLibreObjectDragState;
    if (!drag) return false;
    const lngLat = mapLibrePointerLngLat(event) || drag.lastLngLat;
    mapLibreObjectDragState = null;
    if (drag.moved && lngLat) {
      if (drag.hit.featureType === "stop" && typeof moveLineStopTo === "function") {
        moveLineStopTo(drag.object, lngLat);
      } else if (drag.hit.featureType === "routePoint" && typeof finishRoutePointMove === "function") {
        finishRoutePointMove(drag.object, lngLat);
      } else if (drag.hit.featureType === "detourHelperPoint" && typeof moveDetourHelperPointTo === "function") {
        moveDetourHelperPointTo(drag.object, lngLat);
      }
      syncDraggedEditorObjectLayers(drag.hit.featureType);
    }
    if (drag.dragPanWasEnabled && managedMap && managedMap.dragPan) managedMap.dragPan.enable();
    suppressNextMapLibreClick = drag.moved;
    if (suppressNextMapLibreClick && typeof global.setTimeout === "function") {
      global.setTimeout(() => { suppressNextMapLibreClick = false; }, 0);
    }
    setMapLibreDragCursor(false);
    clearEditorHoverHighlight();
    return true;
  }

  function startMapLibreObjectDragging() {
    if (
      !MAPLIBRE_TEST_INTERACTION_ENABLED
      || !MAPLIBRE_MIGRATION_ENABLED
      || !managedMap
      || !global.document
    ) {
      return false;
    }
    const container = getTestContainer();
    if (!container || mapLibreObjectDragMouseDownHandler) return !!container;

    mapLibreObjectDragMouseDownHandler = event => {
      if (event.button !== 0 || mapLibreObjectDragState) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target && typeof target.closest === "function" && target.closest(`#${TEST_LABEL_ID}`)) return;
      const rect = container.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      mapLibreEditorInteractionFocused = inside;
      if (!inside) return;
      const hit = hitTestEditorObject([event.clientX - rect.left, event.clientY - rect.top]);
      if (!isMapLibreDraggablePointHit(hit)) return;
      const object = resolveEditorSelectionReference(hit);
      if (!object) return;

      applyMapLibreEditorSelection(hit, event);
      const startLngLat = mapLibrePointerLngLat(event);
      const dragPanWasEnabled = !!(
        managedMap.dragPan
        && typeof managedMap.dragPan.isEnabled === "function"
        && managedMap.dragPan.isEnabled()
      );
      if (dragPanWasEnabled) managedMap.dragPan.disable();
      mapLibreObjectDragState = {
        hit,
        object,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastLngLat: startLngLat,
        moved: false,
        dragPanWasEnabled
      };
      if (hitTestDiagnosticFrame != null && typeof global.cancelAnimationFrame === "function") {
        global.cancelAnimationFrame(hitTestDiagnosticFrame);
        hitTestDiagnosticFrame = null;
        pendingHitTestPoint = null;
      }
      clearEditorHoverHighlight();
      setMapLibreDragCursor(true);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    mapLibreObjectDragMouseMoveHandler = event => {
      const drag = mapLibreObjectDragState;
      if (!drag) return;
      const lngLat = mapLibrePointerLngLat(event);
      if (!lngLat) return;
      drag.lastLngLat = lngLat;
      const moved = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY
      ) >= 3;
      if (!drag.moved && !moved) return;
      if (!drag.moved) {
        drag.moved = true;
        if (drag.hit.featureType === "routePoint" && typeof beginRoutePointMove === "function") {
          beginRoutePointMove(drag.object, { lat: drag.object.lat, lng: drag.object.lon });
        }
      }
      if (drag.hit.featureType === "routePoint" && typeof previewRoutePointMove === "function") {
        previewRoutePointMove(drag.object, lngLat);
      }
      applyEditorSelectionDragPreview(drag.hit, [lngLat.lng, lngLat.lat]);
      clearEditorHoverHighlight();
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    mapLibreObjectDragMouseUpHandler = event => {
      if (!mapLibreObjectDragState) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishMapLibreObjectDrag(event);
    };

    global.document.addEventListener("mousedown", mapLibreObjectDragMouseDownHandler, true);
    global.document.addEventListener("mousemove", mapLibreObjectDragMouseMoveHandler, true);
    global.document.addEventListener("mouseup", mapLibreObjectDragMouseUpHandler, true);
    return true;
  }

  function stopMapLibreObjectDragging() {
    if (global.document && mapLibreObjectDragMouseDownHandler) {
      global.document.removeEventListener("mousedown", mapLibreObjectDragMouseDownHandler, true);
      global.document.removeEventListener("mousemove", mapLibreObjectDragMouseMoveHandler, true);
      global.document.removeEventListener("mouseup", mapLibreObjectDragMouseUpHandler, true);
    }
    const drag = mapLibreObjectDragState;
    mapLibreObjectDragState = null;
    if (drag && drag.dragPanWasEnabled && managedMap && managedMap.dragPan) managedMap.dragPan.enable();
    mapLibreObjectDragMouseDownHandler = null;
    mapLibreObjectDragMouseMoveHandler = null;
    mapLibreObjectDragMouseUpHandler = null;
    suppressNextMapLibreClick = false;
    setMapLibreDragCursor(false);
    return true;
  }

  function startHitTestDiagnostics() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || !global.document) return false;
    const container = getTestContainer();
    const diagnostic = getOrCreateHitTestDiagnostic();
    const clickDiagnostic = getOrCreateClickDiagnostic();
    if (!container || !diagnostic || !clickDiagnostic) return false;
    diagnostic.classList.add("is-active");
    diagnostic.setAttribute("aria-hidden", "false");
    clickDiagnostic.classList.add("is-active");
    clickDiagnostic.setAttribute("aria-hidden", "false");
    updateHitTestDiagnostic(null);
    updateClickDiagnostic(null);

    if (!hitTestDiagnosticMoveHandler) {
      hitTestDiagnosticMoveHandler = event => {
        if (mapLibreObjectDragState) {
          pendingHitTestPoint = null;
          clearEditorHoverHighlight();
          return;
        }
        const rect = container.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom;
        pendingHitTestPoint = inside
          ? [event.clientX - rect.left, event.clientY - rect.top]
          : null;
        if (hitTestDiagnosticFrame != null) return;
        hitTestDiagnosticFrame = global.requestAnimationFrame(() => {
          hitTestDiagnosticFrame = null;
          if (mapLibreObjectDragState) {
            pendingHitTestPoint = null;
            clearEditorHoverHighlight();
            return;
          }
          const point = pendingHitTestPoint;
          pendingHitTestPoint = null;
          const hit = point ? hitTestEditorObject(point) : null;
          updateHitTestDiagnostic(hit);
          setEditorHoverHighlight(hit);
        });
      };
      global.document.addEventListener("mousemove", hitTestDiagnosticMoveHandler, true);
    }

    if (!hitTestDiagnosticClickHandler) {
      hitTestDiagnosticClickHandler = event => {
        if (suppressNextMapLibreClick) {
          suppressNextMapLibreClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const target = event.target;
        if (target && typeof target.closest === "function" && target.closest(`#${TEST_LABEL_ID}`)) return;
        const rect = container.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom;
        mapLibreEditorInteractionFocused = inside;
        if (!inside) return;
        const point = [event.clientX - rect.left, event.clientY - rect.top];
        const hit = hitTestEditorObject(point);
        updateClickDiagnostic(hit);
        setMapLibreTestSelection(hit);
        applyMapLibreEditorSelection(hit, event);
        createEditorObjectAtMapLibrePoint(hit, event);
      };
      global.document.addEventListener("click", hitTestDiagnosticClickHandler, true);
    }
    return true;
  }

  function stopHitTestDiagnostics() {
    if (global.document && hitTestDiagnosticMoveHandler) {
      global.document.removeEventListener("mousemove", hitTestDiagnosticMoveHandler, true);
    }
    if (global.document && hitTestDiagnosticClickHandler) {
      global.document.removeEventListener("click", hitTestDiagnosticClickHandler, true);
    }
    if (hitTestDiagnosticFrame != null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(hitTestDiagnosticFrame);
    }
    hitTestDiagnosticMoveHandler = null;
    hitTestDiagnosticClickHandler = null;
    hitTestDiagnosticFrame = null;
    pendingHitTestPoint = null;
    clearEditorHoverHighlight();
    const diagnostic = global.document
      ? global.document.getElementById(HIT_TEST_DIAGNOSTIC_ID)
      : null;
    if (diagnostic) {
      diagnostic.classList.remove("is-active");
      diagnostic.setAttribute("aria-hidden", "true");
      diagnostic.textContent = formatHitTestDiagnostic(null);
    }
    const clickDiagnostic = global.document
      ? global.document.getElementById(CLICK_DIAGNOSTIC_ID)
      : null;
    if (clickDiagnostic) {
      clickDiagnostic.classList.remove("is-active");
      clickDiagnostic.setAttribute("aria-hidden", "true");
      clickDiagnostic.textContent = formatClickDiagnostic(null);
    }
    return true;
  }

  function setLineLayer(kind, editorPoints, paintOverrides) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const definition = LINE_DEFINITIONS[kind];
    if (!definition) throw new Error(`Unbekannter Editor-Linientyp: ${kind}`);
    const data = createLineGeoJson(editorPoints, LINE_FEATURE_IDS[kind] || kind);

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
      enforceEditorOverlayLayerOrder();
    };

    if (!managedStyleReady) {
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

  function createLineCollectionGeoJson(editorLines) {
    const features = Array.isArray(editorLines)
      ? editorLines.map((line, index) => {
          const points = Array.isArray(line) ? line : line && line.points;
          const coordinates = Array.isArray(points)
            ? points.map(point => toMapLibreLngLat(point)).filter(Boolean)
            : [];
          if (coordinates.length < 2) return null;
          return {
            type: "Feature",
            properties: {
              id: line && !Array.isArray(line) && line.id != null ? String(line.id) : String(index),
              color: line && line.polyline && line.polyline.options
                ? line.polyline.options.color || null
                : null,
              width: line && line.polyline && line.polyline.options
                ? Number(line.polyline.options.weight) || null
                : null,
              opacity: line && line.polyline && line.polyline.options
                ? Number(line.polyline.options.opacity) || null
                : null
            },
            geometry: { type: "LineString", coordinates }
          };
        }).filter(Boolean)
      : [];
    return { type: "FeatureCollection", features };
  }

  function applySupplementalLineLayer(kind) {
    if (!managedMap) return;
    const definition = LINE_DEFINITIONS[kind];
    const data = desiredSupplementalLineData[kind];
    if (!definition || !data) return;
    const source = managedMap.getSource(definition.sourceId);
    if (source && typeof source.setData === "function") {
      source.setData(data);
    } else {
      managedMap.addSource(definition.sourceId, { type: "geojson", data });
    }
    if (!managedMap.getLayer(definition.layerId)) {
      managedMap.addLayer(createLineLayerDefinition(kind));
    }
    enforceEditorOverlayLayerOrder();
  }

  function setSupplementalLineLayer(kind, editorLines) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || !desiredSupplementalLineData[kind]) return false;
    desiredSupplementalLineData[kind] = createLineCollectionGeoJson(editorLines);
    const applyLayer = () => applySupplementalLineLayer(kind);
    if (!managedStyleReady) {
      managedMap.once("load", applyLayer);
    } else {
      applyLayer();
    }
    return true;
  }

  function clearSupplementalLineLayer(kind) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap || !desiredSupplementalLineData[kind]) return false;
    desiredSupplementalLineData[kind] = { type: "FeatureCollection", features: [] };
    const definition = LINE_DEFINITIONS[kind];
    const source = definition && managedMap.getSource(definition.sourceId);
    if (source && typeof source.setData === "function") source.setData(desiredSupplementalLineData[kind]);
    return true;
  }

  function getLeafletPolylineEditorPoints(polyline) {
    if (!polyline || typeof polyline.getLatLngs !== "function") return [];
    const latLngs = polyline.getLatLngs();
    const points = [];
    const appendPoints = values => {
      if (!Array.isArray(values)) return;
      values.forEach(value => {
        if (Array.isArray(value)) appendPoints(value);
        else {
          const point = toEditorLatLon(value);
          if (point) points.push(point);
        }
      });
    };
    appendPoints(latLngs);
    return points;
  }

  function getDetourPreviewPolyline(kind, editorState) {
    if (kind === "detourDraft") return editorState && editorState.detourDraft
      ? editorState.detourDraft.polyline
      : null;
    try {
      if (kind === "detourPlanned") {
        return typeof detourPlannedRoutePreviewLine !== "undefined" ? detourPlannedRoutePreviewLine : null;
      }
      if (kind === "detourRemoved") {
        return typeof detourRemovedRoutePreviewLine !== "undefined" ? detourRemovedRoutePreviewLine : null;
      }
    } catch (_err) {
      return null;
    }
    return null;
  }

  function getDetourDraftEditorPoints(editorState) {
    const draft = editorState && editorState.detourDraft;
    if (!draft || !Array.isArray(editorState.routePoints)) return [];
    const start = editorState.routePoints.find(point => point && point.id === draft.startRoutePointId);
    const end = editorState.routePoints.find(point => point && point.id === draft.endRoutePointId);
    if (!start || !end) return [];
    return [start, ...(Array.isArray(draft.points) ? draft.points : []), end];
  }

  function syncSupplementalLine(kind, lines) {
    const data = createLineCollectionGeoJson(lines);
    const signature = JSON.stringify(data);
    if (mirroredLineSignatures[kind] === signature) return true;
    mirroredLineSignatures[kind] = signature;
    if (data.features.length) setSupplementalLineLayer(kind, lines);
    else clearSupplementalLineLayer(kind);
    return true;
  }

  function syncEditorSpecialTracks() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const editorState = getEditorState();
    if (!editorState) return false;
    const tracks = Array.isArray(editorState.specialTracks) ? editorState.specialTracks.slice() : [];
    if (editorState.currentSpecialTrack) tracks.push(editorState.currentSpecialTrack);
    return syncSupplementalLine("specialTracks", tracks);
  }

  function syncEditorDetourPreviews() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const editorState = getEditorState();
    if (!editorState) return false;
    ["detourDraft", "detourPlanned", "detourRemoved"].forEach(kind => {
      let points = [];
      if (kind === "detourDraft") points = getDetourDraftEditorPoints(editorState);
      else if (kind === "detourPlanned" && typeof getDetourPlannedRoutePreviewPoints === "function") {
        points = getDetourPlannedRoutePreviewPoints();
      } else if (kind === "detourRemoved" && typeof getDetourRemovedRoutePreviewPoints === "function") {
        points = getDetourRemovedRoutePreviewPoints();
      } else {
        points = getLeafletPolylineEditorPoints(getDetourPreviewPolyline(kind, editorState));
      }
      syncSupplementalLine(kind, points.length ? [{ id: kind, points }] : []);
    });
    return true;
  }

  function getEditorState() {
    try {
      return typeof state !== "undefined" ? state : null;
    } catch (_err) {
      return null;
    }
  }

  function getEditorStopCatalog() {
    try {
      return typeof stopCatalog !== "undefined" && Array.isArray(stopCatalog) ? stopCatalog : [];
    } catch (_err) {
      return [];
    }
  }

  function resolveCatalogStopReference(hitOrId) {
    const rawId = hitOrId && typeof hitOrId === "object" ? hitOrId.id : hitOrId;
    if (rawId == null) return null;
    const id = String(rawId);
    return getEditorStopCatalog().find(item => item && String(item.id) === id) || null;
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
    if (!MAPLIBRE_MIGRATION_ENABLED || editorMirroringActive) return false;
    syncEditorSelection();
    syncEditorTestLayers();
    editorMirroringActive = true;
    return true;
  }

  function stopEditorLineMirroring() {
    editorMirroringActive = false;
    mirroredLineSignatures.route = null;
    mirroredLineSignatures.preview = null;
    mirroredLineSignatures.specialTracks = null;
    mirroredLineSignatures.detourDraft = null;
    mirroredLineSignatures.detourPlanned = null;
    mirroredLineSignatures.detourRemoved = null;
    mirroredStopsSignature = null;
    mirroredRoutePointsSignature = null;
    mirroredDetourHelperSignature = null;
    mirroredHoverSignature = null;
    mirroredTestSelectionSignature = null;
    mirroredEditorSelectionSignature = null;
  }

  function createStopsGeoJson(stops) {
    const features = Array.isArray(stops)
      ? stops.map(stop => {
          const coordinates = toMapLibreLngLat(stop);
          if (!coordinates) return null;
          const visual = getMirroredStopVisual(stop);
          return {
            type: "Feature",
            properties: {
              id: stop.id == null ? "" : String(stop.id),
              name: stop.name == null ? "" : String(stop.name),
              color: visual.color,
              strokeColor: visual.strokeColor,
              radius: visual.radius
            },
            geometry: { type: "Point", coordinates }
          };
        }).filter(Boolean)
      : [];
    return { type: "FeatureCollection", features };
  }

  function createCatalogStopsGeoJson(catalogStops) {
    const features = Array.isArray(catalogStops)
      ? catalogStops.map(catalogStop => {
          const coordinates = toMapLibreLngLat(catalogStop);
          if (!coordinates || !catalogStop || catalogStop.id == null) return null;
          const visual = getMirroredStopVisual({ transitType: catalogStop.type });
          return {
            type: "Feature",
            properties: {
              id: String(catalogStop.id),
              name: catalogStop.name == null ? "" : String(catalogStop.name),
              catalogType: catalogStop.type == null ? "" : String(catalogStop.type),
              direction: catalogStop.directionHint || catalogStop.direction || "",
              color: visual.color,
              strokeColor: visual.strokeColor
            },
            geometry: { type: "Point", coordinates }
          };
        }).filter(Boolean)
      : [];
    return { type: "FeatureCollection", features };
  }

  function getVisibleEditorCatalogStops() {
    const viewport = getViewportOwnerContext();
    return getEditorStopCatalog().filter(catalogStop => {
      if (!catalogStop) return false;
      const lat = catalogStop.lat;
      const lon = catalogStop.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      try {
        if (typeof isCatalogStopVisible === "function" && !isCatalogStopVisible(catalogStop)) return false;
      } catch (_err) {
        // Der Katalogdatensatz bleibt nutzbar, wenn der optionale UI-Filter noch nicht initialisiert ist.
      }
      return !viewport || viewport.contains(lat, lon);
    });
  }

  function setCatalogStopsLayer(catalogStops) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredCatalogStopsData = createCatalogStopsGeoJson(catalogStops);
    const applyCatalogStops = () => {
      if (!managedMap) return;
      const source = managedMap.getSource(CATALOG_STOP_SOURCE_ID);
      if (source && typeof source.setData === "function") {
        source.setData(desiredCatalogStopsData);
      } else {
        managedMap.addSource(CATALOG_STOP_SOURCE_ID, { type: "geojson", data: desiredCatalogStopsData });
      }
      if (!managedMap.getLayer(CATALOG_STOP_LAYER_ID)) {
        managedMap.addLayer({
          id: CATALOG_STOP_LAYER_ID,
          type: "circle",
          source: CATALOG_STOP_SOURCE_ID,
          paint: {
            "circle-radius": 7,
            "circle-color": ["coalesce", ["get", "color"], "#7c3aed"],
            "circle-opacity": 0.82,
            "circle-stroke-width": 2,
            "circle-stroke-color": ["coalesce", ["get", "strokeColor"], "#5b21b6"]
          }
        });
      }
      enforceEditorOverlayLayerOrder();
    };
    if (!managedStyleReady) managedMap.once("load", applyCatalogStops);
    else applyCatalogStops();
    return true;
  }

  function clearCatalogStopsLayer() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredCatalogStopsData = { type: "FeatureCollection", features: [] };
    const source = managedMap.getSource(CATALOG_STOP_SOURCE_ID);
    if (source && typeof source.setData === "function") source.setData(desiredCatalogStopsData);
    return true;
  }

  function syncEditorCatalogMarkers() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const catalogStops = getVisibleEditorCatalogStops();
    const data = createCatalogStopsGeoJson(catalogStops);
    const signature = JSON.stringify(data);
    if (mirroredCatalogStopsSignature === signature) return true;
    mirroredCatalogStopsSignature = signature;
    if (data.features.length) setCatalogStopsLayer(catalogStops);
    else clearCatalogStopsLayer();
    return true;
  }

  function getMirroredStopVisual(stop) {
    try {
      if (typeof isDetourCutStop === "function" && isDetourCutStop(stop)) {
        return { color: "#6b7280", strokeColor: "#b91c1c", radius: 13 };
      }
    } catch (_err) {
      // Standarddarstellung bleibt aktiv, solange der Umleitungsstatus noch nicht initialisiert ist.
    }
    if (stop && stop.isGhostPoint) {
      return { color: "#64748b", strokeColor: "#334155", radius: 9 };
    }
    if (stop && stop.isDetourReplacement) {
      return { color: "#60a5fa", strokeColor: "#1d4ed8", radius: 9 };
    }
    let transitType = String((stop && (stop.transitType || stop.type)) || "").toLowerCase().trim();
    try {
      if (typeof resolveLineStopTransitType === "function") transitType = resolveLineStopTransitType(stop);
    } catch (_err) {
      // Direkte Stop-Daten bleiben der sichere Fallback fuer den passiven Testpfad.
    }
    if (transitType === "tram") return { color: "#dc2626", strokeColor: "#991b1b", radius: 9 };
    if (transitType === "bus_tram" || transitType === "mixed") {
      return { color: "#be185d", strokeColor: "#831843", radius: 9 };
    }
    if (transitType === "bus" || (stop && stop.sourceType === "catalog")) {
      return { color: "#7c3aed", strokeColor: "#5b21b6", radius: 9 };
    }
    return { color: "#3b82f6", strokeColor: "#1d4ed8", radius: 9 };
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
            "circle-radius": ["coalesce", ["get", "radius"], 9],
            "circle-color": ["coalesce", ["get", "color"], "#3b82f6"],
            "circle-stroke-width": 2,
            "circle-stroke-color": ["coalesce", ["get", "strokeColor"], "#1d4ed8"]
          }
        });
      }
      enforceEditorOverlayLayerOrder();
    };
    if (!managedStyleReady) {
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
    const signature = JSON.stringify(createStopsGeoJson(stops));
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
            "circle-radius": ["interpolate", ["linear"], ["zoom"],
              11, ["match", ["get", "sourceType"], "auto", 1, 2],
              15, ["match", ["get", "sourceType"], "auto", 1.85, 4],
              18, ["match", ["get", "sourceType"], "auto", 2.5, 6]
            ],
            "circle-color": ["match", ["get", "sourceType"], "auto", "#ffffff", "#f97316"],
            "circle-opacity": 0.9,
            "circle-stroke-width": 1,
            "circle-stroke-color": ["match", ["get", "sourceType"], "auto", "#1d4ed8", "#7c2d12"]
          }
        });
      }
      enforceEditorOverlayLayerOrder();
    };
    if (!managedStyleReady) {
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

  function createDetourHelperPointsGeoJson(detourWizard) {
    const replacementStops = detourWizard && Array.isArray(detourWizard.replacementStops)
      ? detourWizard.replacementStops
      : [];
    const manualRoutePoints = detourWizard && Array.isArray(detourWizard.manualRoutePoints)
      ? detourWizard.manualRoutePoints
      : [];
    const features = [...replacementStops, ...manualRoutePoints].map((point, index) => {
      const coordinates = toMapLibreLngLat(point);
      if (!coordinates) return null;
      const kind = point.kind || (point.isGhostPoint
        ? "passThroughStop"
        : (manualRoutePoints.includes(point) ? "guidePoint" : "replacementStop"));
      return {
        type: "Feature",
        properties: {
          id: point.id == null ? String(index) : String(point.id),
          name: point.name == null ? "" : String(point.name),
          kind
        },
        geometry: { type: "Point", coordinates }
      };
    }).filter(Boolean);
    return { type: "FeatureCollection", features };
  }

  function setDetourHelperPointsLayer(detourWizard) {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredDetourHelperData = createDetourHelperPointsGeoJson(detourWizard);
    const applyHelpers = () => {
      if (!managedMap) return;
      const source = managedMap.getSource(DETOUR_HELPER_SOURCE_ID);
      if (source && typeof source.setData === "function") {
        source.setData(desiredDetourHelperData);
      } else {
        managedMap.addSource(DETOUR_HELPER_SOURCE_ID, {
          type: "geojson",
          data: desiredDetourHelperData
        });
      }
      if (!managedMap.getLayer(DETOUR_HELPER_LAYER_ID)) {
        managedMap.addLayer({
          id: DETOUR_HELPER_LAYER_ID,
          type: "circle",
          source: DETOUR_HELPER_SOURCE_ID,
          paint: {
            "circle-radius": ["match", ["get", "kind"], "guidePoint", 8, 9],
            "circle-color": ["match", ["get", "kind"],
              "guidePoint", "#06b6d4",
              "passThroughStop", "#64748b",
              "#8b5cf6"
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": ["match", ["get", "kind"],
              "guidePoint", "#0e7490",
              "passThroughStop", "#334155",
              "#6d28d9"
            ]
          }
        });
      }
      enforceEditorOverlayLayerOrder();
    };
    if (!managedStyleReady) {
      managedMap.once("load", applyHelpers);
    } else {
      applyHelpers();
    }
    return true;
  }

  function clearDetourHelperPointsLayer() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    desiredDetourHelperData = { type: "FeatureCollection", features: [] };
    const source = managedMap.getSource(DETOUR_HELPER_SOURCE_ID);
    if (source && typeof source.setData === "function") source.setData(desiredDetourHelperData);
    return true;
  }

  function syncEditorDetourHelperPoints() {
    if (!MAPLIBRE_MIGRATION_ENABLED || !managedMap) return false;
    const editorState = getEditorState();
    if (!editorState) return false;
    const data = createDetourHelperPointsGeoJson(editorState.detourWizard);
    const signature = JSON.stringify(data);
    if (mirroredDetourHelperSignature === signature) return true;
    mirroredDetourHelperSignature = signature;
    if (data.features.length) setDetourHelperPointsLayer(editorState.detourWizard);
    else clearDetourHelperPointsLayer();
    return true;
  }

  function syncEditorTestLayers() {
    syncEditorLineLayers();
    syncEditorStops();
    syncEditorCatalogMarkers();
    syncEditorRoutePoints();
    syncEditorSpecialTracks();
    syncEditorDetourPreviews();
    syncEditorDetourHelperPoints();
    syncMapLibreTestSelection();
    enforceEditorOverlayLayerOrder();
  }

  function getLeafletMap() {
    try {
      return typeof map !== "undefined" ? map : null;
    } catch (_err) {
      return null;
    }
  }

  function getViewportOwnerEngine() {
    return viewportOwnerEngine;
  }

  function getActiveMapEngine() {
    return ACTIVE_ENGINE;
  }

  function getActiveMap() {
    return ACTIVE_ENGINE === "maplibre" ? managedMap : getLeafletMap();
  }

  function usesLeafletOverlays() {
    return ACTIVE_ENGINE === "leaflet";
  }

  function createEditorPointOverlay(latlng, options, addToMap = true) {
    const leafletMap = getLeafletMap();
    if (!usesLeafletOverlays() || !leafletMap || !global.L || typeof global.L.marker !== "function") return null;
    const marker = global.L.marker(latlng, options || {});
    return addToMap ? marker.addTo(leafletMap) : marker;
  }

  function createEditorLineOverlay(points, options) {
    const leafletMap = getLeafletMap();
    if (!usesLeafletOverlays() || !leafletMap || !global.L || typeof global.L.polyline !== "function") return null;
    return global.L.polyline(points, options || {}).addTo(leafletMap);
  }

  function createEditorLayerGroupOverlay() {
    const leafletMap = getLeafletMap();
    if (!usesLeafletOverlays() || !leafletMap || !global.L || typeof global.L.layerGroup !== "function") return null;
    return global.L.layerGroup().addTo(leafletMap);
  }

  function createEditorCircleOverlay(latlng, options, layerGroup) {
    if (!usesLeafletOverlays() || !global.L || typeof global.L.circleMarker !== "function") return null;
    const overlay = global.L.circleMarker(latlng, options || {});
    if (layerGroup && typeof overlay.addTo === "function") overlay.addTo(layerGroup);
    return overlay;
  }

  function removeEditorOverlay(overlay) {
    if (!overlay) return false;
    const leafletMap = getLeafletMap();
    if (leafletMap && typeof leafletMap.hasLayer === "function" && leafletMap.hasLayer(overlay)) {
      leafletMap.removeLayer(overlay);
    }
    return true;
  }

  function hasEditorOverlay(overlay) {
    const leafletMap = getLeafletMap();
    return !!(overlay && leafletMap && typeof leafletMap.hasLayer === "function" && leafletMap.hasLayer(overlay));
  }

  function setEditorPanEnabled(enabled) {
    const activeMap = getActiveMap();
    const dragging = activeMap && activeMap.dragging ? activeMap.dragging : activeMap && activeMap.dragPan;
    if (!dragging) return false;
    if (enabled && typeof dragging.enable === "function") dragging.enable();
    if (!enabled && typeof dragging.disable === "function") dragging.disable();
    return true;
  }

  function prepareEditorBoxSelectionGesture() {
    if (ACTIVE_ENGINE === "maplibre") suppressNextMapLibreClick = true;
    return setEditorPanEnabled(false);
  }

  function getEditorCenter() {
    const viewport = getViewportOwnerContext();
    return viewport && Number.isFinite(viewport.lat) && Number.isFinite(viewport.lon)
      ? Object.freeze({ lat: viewport.lat, lon: viewport.lon, lng: viewport.lon })
      : null;
  }

  function getEditorZoom() {
    const viewport = getViewportOwnerContext();
    return viewport && Number.isFinite(viewport.catalogZoom) ? viewport.catalogZoom : null;
  }

  function getEditorBounds() {
    const viewport = getViewportOwnerContext();
    if (!viewport) return null;
    return Object.freeze({
      west: viewport.west,
      east: viewport.east,
      south: viewport.south,
      north: viewport.north,
      contains: viewport.contains
    });
  }

  function projectEditorCoordinate(point) {
    const coordinates = toMapLibreLngLat(point);
    if (!coordinates) return null;
    if (ACTIVE_ENGINE === "maplibre" && managedMap && typeof managedMap.project === "function") {
      const projected = managedMap.project(coordinates);
      return projected ? Object.freeze({ x: projected.x, y: projected.y }) : null;
    }
    const leafletMap = getLeafletMap();
    if (!leafletMap || typeof leafletMap.latLngToContainerPoint !== "function") return null;
    const projected = leafletMap.latLngToContainerPoint([coordinates[1], coordinates[0]]);
    return projected ? Object.freeze({ x: projected.x, y: projected.y }) : null;
  }

  function unprojectEditorPoint(point) {
    const x = Array.isArray(point) ? Number(point[0]) : Number(point && point.x);
    const y = Array.isArray(point) ? Number(point[1]) : Number(point && point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (ACTIVE_ENGINE === "maplibre" && managedMap && typeof managedMap.unproject === "function") {
      const lngLat = managedMap.unproject([x, y]);
      return lngLat ? Object.freeze({ lat: lngLat.lat, lon: lngLat.lng, lng: lngLat.lng }) : null;
    }
    const leafletMap = getLeafletMap();
    if (!leafletMap || typeof leafletMap.containerPointToLatLng !== "function") return null;
    const latLng = leafletMap.containerPointToLatLng([x, y]);
    return latLng ? Object.freeze({ lat: latLng.lat, lon: latLng.lng, lng: latLng.lng }) : null;
  }

  function panEditorViewportBy(offset, options) {
    const x = Array.isArray(offset) ? Number(offset[0]) : Number(offset && offset.x);
    const y = Array.isArray(offset) ? Number(offset[1]) : Number(offset && offset.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const activeMap = getActiveMap();
    if (!activeMap || typeof activeMap.panBy !== "function") return false;
    activeMap.panBy([x, y], options || {});
    return true;
  }

  function setEditorZoom(leafletZoom) {
    if (!Number.isFinite(leafletZoom)) return false;
    if (ACTIVE_ENGINE === "maplibre") {
      if (!managedMap || typeof managedMap.zoomTo !== "function") return false;
      managedMap.zoomTo(leafletZoomToMapLibre(leafletZoom), { duration: 0 });
      return true;
    }
    const leafletMap = getLeafletMap();
    if (!leafletMap || typeof leafletMap.setZoom !== "function") return false;
    leafletMap.setZoom(leafletZoom);
    return true;
  }

  function resizeEditorMap() {
    if (ACTIVE_ENGINE === "maplibre") return resizeMapLibreMap();
    const leafletMap = getLeafletMap();
    if (!leafletMap || typeof leafletMap.invalidateSize !== "function") return false;
    leafletMap.invalidateSize(false);
    return true;
  }

  function refreshEditorMapFeatures() {
    if (MAPLIBRE_MIGRATION_ENABLED) syncEditorTestLayers();
    return true;
  }

  function getViewportOwnerContext() {
    const ownerMap = viewportOwnerEngine === "maplibre" ? managedMap : getLeafletMap();
    if (!ownerMap) return null;
    const viewport = viewportOwnerEngine === "maplibre" ? readMapLibreViewport() : readLeafletViewport();
    const bounds = typeof ownerMap.getBounds === "function" ? ownerMap.getBounds() : null;
    const west = bounds && typeof bounds.getWest === "function" ? Number(bounds.getWest()) : null;
    const east = bounds && typeof bounds.getEast === "function" ? Number(bounds.getEast()) : null;
    const south = bounds && typeof bounds.getSouth === "function" ? Number(bounds.getSouth()) : null;
    const north = bounds && typeof bounds.getNorth === "function" ? Number(bounds.getNorth()) : null;
    const ownerZoom = typeof ownerMap.getZoom === "function" ? Number(ownerMap.getZoom()) : null;
    const catalogZoom = Number.isFinite(ownerZoom)
      ? ownerZoom + (viewportOwnerEngine === "maplibre" ? -LEAFLET_TO_MAPLIBRE_ZOOM_OFFSET : 0)
      : null;
    const contains = (lat, lon) => {
      if (![lat, lon, west, east, south, north].every(Number.isFinite)) return false;
      const longitudeInside = west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
      return lat >= south && lat <= north && longitudeInside;
    };
    return Object.freeze({
      engine: viewportOwnerEngine,
      lat: viewport && viewport.lat,
      lon: viewport && viewport.lon,
      zoom: viewport && viewport.zoom,
      catalogZoom,
      bearing: viewport && viewport.bearing,
      pitch: viewport && viewport.pitch,
      west,
      east,
      south,
      north,
      contains
    });
  }

  function syncViewportFromOwner() {
    if (viewportOwnerEngine === "maplibre") return syncMapLibreOwnerViewport();
    if (!leafletViewportMap) leafletViewportMap = getLeafletMap();
    return syncLeafletViewport();
  }

  function applyViewportToMapLibre(viewport) {
    if (!managedMap || !viewport || !Number.isFinite(viewport.lat) || !Number.isFinite(viewport.lon)) return false;
    const options = { center: [viewport.lon, viewport.lat] };
    if (Number.isFinite(viewport.zoom)) options.zoom = viewport.zoom;
    if (Number.isFinite(viewport.bearing)) options.bearing = viewport.bearing;
    if (Number.isFinite(viewport.pitch)) options.pitch = viewport.pitch;
    managedMap.jumpTo(options);
    return true;
  }

  function mapLibreZoomToLeaflet(mapLibreZoom) {
    return Number.isFinite(mapLibreZoom)
      ? mapLibreZoom - LEAFLET_TO_MAPLIBRE_ZOOM_OFFSET
      : null;
  }

  function syncMapLibreOwnerViewport() {
    mapLibreOwnerViewportFrame = null;
    if (viewportOwnerEngine !== "maplibre" || !managedMap) return false;
    const leafletMap = getLeafletMap();
    const viewport = readMapLibreViewport();
    const zoom = viewport && mapLibreZoomToLeaflet(viewport.zoom);
    if (!leafletMap || !viewport || !Number.isFinite(viewport.lat) || !Number.isFinite(viewport.lon) || !Number.isFinite(zoom)) {
      return false;
    }
    leafletMap.setView([viewport.lat, viewport.lon], zoom, { animate: false });
    return true;
  }

  function scheduleMapLibreOwnerViewportSync() {
    if (mapLibreOwnerViewportFrame != null) return;
    mapLibreOwnerViewportFrame = global.requestAnimationFrame(syncMapLibreOwnerViewport);
  }

  function startMapLibreOwnerViewportSync() {
    if (viewportOwnerEngine !== "maplibre" || !managedMap || mapLibreOwnerViewportHandler) return false;
    mapLibreOwnerViewportMap = managedMap;
    mapLibreOwnerViewportHandler = () => {
      if (getLeafletMap()) scheduleMapLibreOwnerViewportSync();
      scheduleViewportDifferenceDiagnostic();
    };
    mapLibreOwnerViewportEndHandler = () => {
      const viewport = getViewportOwnerContext();
      const signature = viewport
        ? [viewport.lat, viewport.lon, viewport.zoom, viewport.bearing, viewport.pitch].join("|")
        : "";
      if (signature === mapLibreOwnerViewportEndSignature) return;
      mapLibreOwnerViewportEndSignature = signature;
      if (global.document && typeof global.CustomEvent === "function") {
        global.document.dispatchEvent(new global.CustomEvent("editor:viewportchange", {
          detail: { engine: "maplibre", viewport }
        }));
      }
    };
    mapLibreOwnerViewportMap.on("move", mapLibreOwnerViewportHandler);
    mapLibreOwnerViewportMap.on("zoom", mapLibreOwnerViewportHandler);
    mapLibreOwnerViewportMap.on("moveend", mapLibreOwnerViewportEndHandler);
    mapLibreOwnerViewportMap.on("zoomend", mapLibreOwnerViewportEndHandler);
    if (managedStyleReady) syncMapLibreOwnerViewport();
    return true;
  }

  function stopMapLibreOwnerViewportSync() {
    if (mapLibreOwnerViewportMap && mapLibreOwnerViewportHandler) {
      mapLibreOwnerViewportMap.off("move", mapLibreOwnerViewportHandler);
      mapLibreOwnerViewportMap.off("zoom", mapLibreOwnerViewportHandler);
    }
    if (mapLibreOwnerViewportMap && mapLibreOwnerViewportEndHandler) {
      mapLibreOwnerViewportMap.off("moveend", mapLibreOwnerViewportEndHandler);
      mapLibreOwnerViewportMap.off("zoomend", mapLibreOwnerViewportEndHandler);
    }
    if (mapLibreOwnerViewportFrame != null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(mapLibreOwnerViewportFrame);
    }
    mapLibreOwnerViewportMap = null;
    mapLibreOwnerViewportHandler = null;
    mapLibreOwnerViewportEndHandler = null;
    mapLibreOwnerViewportEndSignature = null;
    mapLibreOwnerViewportFrame = null;
    return true;
  }

  function setEditorViewport(lat, lon, leafletZoom) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (ACTIVE_ENGINE === "maplibre") {
      const options = { center: [lon, lat] };
      const zoom = leafletZoomToMapLibre(leafletZoom);
      if (Number.isFinite(zoom)) options.zoom = zoom;
      if (!managedMap) {
        pendingMapLibreViewport = Object.freeze({
          lat,
          lon,
          zoom: options.zoom,
          bearing: 0,
          pitch: 0
        });
        return true;
      }
      managedMap.jumpTo(options);
      scheduleMapLibreOwnerViewportSync();
      return true;
    }
    const leafletMap = getLeafletMap();
    if (!leafletMap) return false;
    leafletMap.setView([lat, lon], leafletZoom);
    return true;
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
    const overwritesManualViewport = MAPLIBRE_TEST_INTERACTION_ENABLED && manualMapLibreViewportDirty;
    leafletViewportSyncApplying = true;
    try {
      managedMap.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
    } finally {
      leafletViewportSyncApplying = false;
    }
    if (MAPLIBRE_TEST_INTERACTION_ENABLED) {
      if (overwritesManualViewport) viewportOverwriteNotice = true;
      manualMapLibreViewportDirty = false;
      scheduleMapLibreViewportDiagnostic(
        viewportOverwriteNotice
          ? "Leaflet-Sync hat manuellen Testviewport ueberschrieben"
          : "Leaflet-Sync"
      );
    }
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
    leafletViewportHandler = () => {
      scheduleLeafletViewportSync();
      scheduleViewportDifferenceDiagnostic();
    };
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
    activeEngine: ACTIVE_ENGINE,
    preparedEngine: "maplibre",
    mainEngineRequested: MAPLIBRE_MAIN_ENGINE_REQUESTED,
    sideBySideEnabled: MAPLIBRE_SIDE_BY_SIDE_ENABLED,
    migrationEnabled: MAPLIBRE_MIGRATION_ENABLED,
    interactionRequested: MAPLIBRE_INTERACTION_REQUESTED,
    testInteractionEnabled: MAPLIBRE_TEST_INTERACTION_ENABLED,
    viewportDifferenceThresholds: VIEWPORT_DIFFERENCE_THRESHOLDS,
    viewportStatusFlapMs: VIEWPORT_STATUS_FLAP_MS,
    viewportStatusHistoryLimit: VIEWPORT_STATUS_HISTORY_LIMIT,
    toMapLibreLngLat,
    toEditorLatLon,
    createOpenFreeMapStyle,
    createMapOptions,
    createMapLibreMap,
    isMigrationEnabled,
    applyMapLibreTestInteractionState,
    updateMapLibreInteractionStatus,
    readMapLibreViewport,
    formatMapLibreViewportDiagnostic,
    updateMapLibreViewportDiagnostic,
    scheduleMapLibreViewportDiagnostic,
    startMapLibreViewportDiagnostics,
    stopMapLibreViewportDiagnostics,
    readLeafletViewport,
    getActiveMapEngine,
    getActiveMap,
    usesLeafletOverlays,
    createEditorPointOverlay,
    createEditorLineOverlay,
    createEditorLayerGroupOverlay,
    createEditorCircleOverlay,
    removeEditorOverlay,
    hasEditorOverlay,
    setEditorPanEnabled,
    prepareEditorBoxSelectionGesture,
    getEditorCenter,
    getEditorZoom,
    getEditorBounds,
    projectEditorCoordinate,
    unprojectEditorPoint,
    panEditorViewportBy,
    setEditorZoom,
    resizeEditorMap,
    refreshEditorMapFeatures,
    getViewportOwnerEngine,
    getViewportOwnerContext,
    syncViewportFromOwner,
    setEditorViewport,
    mapLibreZoomToLeaflet,
    syncMapLibreOwnerViewport,
    startMapLibreOwnerViewportSync,
    stopMapLibreOwnerViewportSync,
    centerDistanceMeters,
    shortestAngleDifferenceDegrees,
    calculateViewportDifferences,
    readViewportDifferences,
    formatViewportDifferenceDiagnostic,
    classifyViewportDifference,
    evaluateViewportDifferences,
    getOverallViewportDifferenceLevel,
    resetViewportStatusStability,
    updateViewportStatusStability,
    getViewportStatusHistory,
    getViewportStatusResidency,
    formatViewportStatusStability,
    formatViewportStatusHistoryEntry,
    formatViewportStatusResidency,
    createViewportSessionSummary,
    getOrCreateViewportSessionSummaryDiagnostic,
    renderViewportSessionSummary,
    hideViewportSessionSummary,
    showViewportSessionSummary,
    renderViewportDifferenceDiagnostic,
    updateViewportDifferenceDiagnostic,
    scheduleViewportDifferenceDiagnostic,
    startViewportDifferenceDiagnostics,
    stopViewportDifferenceDiagnostics,
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
    enforceEditorOverlayLayerOrder,
    hitTestEditorObject,
    createHoverHighlightGeoJson,
    setEditorHoverHighlight,
    clearEditorHoverHighlight,
    createTestSelectionGeoJson,
    setMapLibreTestSelection,
    clearMapLibreTestSelection,
    getMapLibreTestSelection,
    syncMapLibreTestSelection,
    createEditorSelectionGeoJson,
    applyEditorSelectionLayer,
    syncEditorSelection,
    formatHitTestDiagnostic,
    resolveEditorObjectReadOnly,
    formatResolvedEditorObject,
    formatClickDiagnostic,
    updateHitTestDiagnostic,
    updateClickDiagnostic,
    resolveEditorSelectionReference,
    resolveCatalogStopReference,
    applyMapLibreEditorSelection,
    isMapLibreDraggablePointHit,
    createEditorObjectAtMapLibrePoint,
    deleteMapLibreSelectedEditorObject,
    startMapLibreEditorDeleteHandling,
    stopMapLibreEditorDeleteHandling,
    applyEditorSelectionDragPreview,
    syncDraggedEditorObjectLayers,
    startMapLibreObjectDragging,
    stopMapLibreObjectDragging,
    startHitTestDiagnostics,
    stopHitTestDiagnostics,
    setLineLayer,
    removeLineLayer,
    clearLineLayer,
    createLineCollectionGeoJson,
    setSupplementalLineLayer,
    clearSupplementalLineLayer,
    syncEditorSpecialTracks,
    syncEditorDetourPreviews,
    createStopsGeoJson,
    setStopsLayer,
    clearStopsLayer,
    syncEditorStops,
    createCatalogStopsGeoJson,
    getVisibleEditorCatalogStops,
    setCatalogStopsLayer,
    clearCatalogStopsLayer,
    syncEditorCatalogMarkers,
    createRoutePointsGeoJson,
    setRoutePointsLayer,
    clearRoutePointsLayer,
    syncEditorRoutePoints,
    createDetourHelperPointsGeoJson,
    setDetourHelperPointsLayer,
    clearDetourHelperPointsLayer,
    syncEditorDetourHelperPoints,
    syncEditorLineLayers,
    syncEditorTestLayers,
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
