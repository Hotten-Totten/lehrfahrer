// =========================
// DOM
// =========================
// Dieses Modul sammelt alle DOM-Element-Referenzen
// Macht die Elemente global verfügbar für andere Module

// Kopfbereich / Linien-Metadaten
const citySelect = document.getElementById("citySelect");
const newCityInput = document.getElementById("newCityInput");
const createCityBtn = document.getElementById("createCityBtn");
const lineNameInput = document.getElementById("lineName");
const routeNameInput = document.getElementById("routeName");
const variantNameInput = document.getElementById("variantName");
const variantCategoryInput = document.getElementById("variantCategory");
const directionNameInput = document.getElementById("directionName");
const validFromInput = document.getElementById("validFrom");
const validUntilInput = document.getElementById("validUntil");
const lineDescriptionInput = document.getElementById("lineDescription");
const lineColorInput = document.getElementById("lineColor");

const stopSearchInput = document.getElementById("stopSearchInput");
const searchResults = document.getElementById("searchResults");
const stopOrderList = document.getElementById("stopOrderList");

// Modus- und Bearbeitungsbuttons
const modeFreeStopBtn = document.getElementById("modeFreeStopBtn");
const modeRouteBtn = document.getElementById("modeRouteBtn");
const modeSelectBtn = document.getElementById("modeSelectBtn");
const routingModeWrap = document.getElementById("routingModeWrap");
const routingModeSelect = document.getElementById("routingModeSelect");
const preserveManualChainsWrap = document.getElementById("preserveManualChainsWrap");
const preserveManualChainsInput = document.getElementById("preserveManualChainsInput");
const buildStreetRouteBtn = document.getElementById("buildStreetRouteBtn");
const cancelRoutingBtn = document.getElementById("cancelRoutingBtn");
const rerouteSegmentBtn = document.getElementById("rerouteSegmentBtn");
const autoMinutesBtn = document.getElementById("autoMinutesBtn");
const smoothRouteBtn = document.getElementById("smoothRouteBtn");
const snapStopToRouteBtn = document.getElementById("snapStopToRouteBtn");
const simplifyRouteBtn = document.getElementById("simplifyRouteBtn");


const showOriginalRouteBtn = document.getElementById("showOriginalRouteBtn");
const showSimplifiedRouteBtn = document.getElementById("showSimplifiedRouteBtn");
const startTrackBetweenStopsBtn = document.getElementById("startTrackBetweenStopsBtn");
const finishSpecialTrackBtn = document.getElementById("finishSpecialTrackBtn");
const startDetourWizardBtn = document.getElementById("startDetourWizardBtn");
const acceptDetourRangeBtn = document.getElementById("acceptDetourRangeBtn");
const detourRoutingModeWrap = document.getElementById("detourRoutingModeWrap");
const detourRoutingModeSelect = document.getElementById("detourRoutingModeSelect");
const detourManualInputModeWrap = document.getElementById("detourManualInputModeWrap");
const detourManualInputModeSelect = document.getElementById("detourManualInputModeSelect");
const cancelDetourWizardBtn = document.getElementById("cancelDetourWizardBtn");
const startDetourDraftBtn = document.getElementById("startDetourDraftBtn");
const finishDetourDraftBtn = document.getElementById("finishDetourDraftBtn");
const cancelDetourDraftBtn = document.getElementById("cancelDetourDraftBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");

// Detail-Editor (Stop/Route)
const noSelection = document.getElementById("noSelection");
const stopEditor = document.getElementById("stopEditor");
const routeEditor = document.getElementById("routeEditor");

const stopNameInput = document.getElementById("stopName");
const stopMinuteInput = document.getElementById("stopMinute");
const stopNoteInput = document.getElementById("stopNote");
const stopGhostInput = document.getElementById("stopGhost");
const stopLatInput = document.getElementById("stopLat");
const stopLonInput = document.getElementById("stopLon");
const stopSourceInput = document.getElementById("stopSource");

// Aktionen auf ausgewählten Elementen
const saveStopBtn = document.getElementById("saveStopBtn");
const deleteStopBtn = document.getElementById("deleteStopBtn");

const routeLatInput = document.getElementById("routeLat");
const routeLonInput = document.getElementById("routeLon");
const routeTypeInput = document.getElementById("routeType");
const deleteRoutePointBtn = document.getElementById("deleteRoutePointBtn");

// Statistik- und Statusanzeige
const stopCount = document.getElementById("stopCount");
const routePointCount = document.getElementById("routePointCount");
const catalogCount = document.getElementById("catalogCount");
const currentModeText = document.getElementById("currentModeText");
const routingModeText = document.getElementById("routingModeText");
const preserveManualChainsPreviewRow = document.getElementById("preserveManualChainsPreviewRow");
const preserveManualChainsText = document.getElementById("preserveManualChainsText");
const routeLengthKm = document.getElementById("routeLengthKm");
const estimatedDriveMinutes = document.getElementById("estimatedDriveMinutes");

const statusbar = document.getElementById("statusbar");

// Karten-Overlay / Auswahlrahmen
const selectionBox = document.getElementById("selectionBox");
const mapWrapElement = document.getElementById("mapWrap");

// Debug-Panel
const debugPanel = document.getElementById("debugPanel");
const debugPanelBody = document.getElementById("debugPanelBody");
const debugToggleBtn = document.getElementById("debugToggleBtn");
const debugClearBtn = document.getElementById("debugClearBtn");
const debugClearCacheBtn = document.getElementById("debugClearCacheBtn");

// Datei-Aktionen
const clearBtn = document.getElementById("clearBtn");
const saveLineBtn = document.getElementById("saveLineBtn");
const loadLineBtn = document.getElementById("loadLineBtn");
const exportBtn = document.getElementById("exportBtn");
const exportGpxBtn = document.getElementById("exportGpxBtn");

const exportAutosaveBtn = document.getElementById("exportAutosaveBtn");
const loadAutosaveBtn = document.getElementById("loadAutosaveBtn");
const clearAutosaveBtn = document.getElementById("clearAutosaveBtn");

// Modale Dialoge
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const helpModalTitle = document.getElementById("helpModalTitle");
const helpModalBody = document.getElementById("helpModalBody");
const helpCloseBtn = document.getElementById("helpCloseBtn");

const lineBrowserModal = document.getElementById("lineBrowserModal");
const lineBrowserBody = document.getElementById("lineBrowserBody");
const lineBrowserCloseBtn = document.getElementById("lineBrowserCloseBtn"); 

// Zusätzliche Metrik-Anzeige
const routeLengthText = document.getElementById("routeLength");
const avgSpeedText = document.getElementById("avgSpeed");
const totalTimeText = document.getElementById("totalTime");
