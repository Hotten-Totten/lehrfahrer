# Changelog

## V2.0.70 - 2026-06-02
- **Fix: Restore Selection Interaction After HUD Redesign** – Z-index layering bug in V2.0.69 HUD prevented users from selecting cities and lines. Root cause: navHud grid overlay (z-index: 500) was covering selectionBar even when hidden. Solution: Added `#navHud.hidden { display: none; }` CSS rule and ensured pointer-events properly cascade. Now selectionBar is fully interactive when not in navigation mode. Service Worker cache version incremented to force refresh of cached assets.

## V2.0.69 - 2026-06-02
- **Major Redesign: Google Maps-Style Navigation HUD** – Complete restructuring of the navigation interface to match professional GPS apps like Google Maps. New layout:
  - **Top Center**: Large next-action display (arrow icon + street/instruction + distance to maneuver) - easier to read at a glance
  - **Top Right**: Clock and speed indicator (compact, monospace time display)
  - **Right Sidebar**: Vertical button stack (End Navigation + Menu) - no longer takes screen width
  - **Bottom**: Next stop info bar (station name + distance)
  - **Map**: Now full-screen minus HUD areas, better visibility of the route ahead
  - **Bonus**: Live clock updates every second during navigation
- Result: Professional appearance, better use of screen space, more information at a glance without UI clutter.

## V2.0.68 - 2026-06-02
- **Improve: Professional Navigation Icons** – Replaced unprofessional emoji arrows (⬆, ➡, ⬅, etc.) with clean Font Awesome vector icons. Icons are scalable, crisp, and match professional GPS navigation standards. Updated: arrow-up, arrow-right, arrow-left, arrow-up-right, arrow-up-left, flag-checkered (finish). Result: Modern, polished UI.
- **Cleanup: Remove Obsolete "Gespeicherte Offline-Routen" Section** – Deleted leftover UI from old local route storage system. With auto-download, this feature is no longer needed.

## V2.0.67 - 2026-06-02
- **Improve: Vehicle Position Lower on Screen** – Moved vehicle indicator to bottom third of screen (increased bottomFactor from 0.26-0.34 to 0.52-0.60). Driver now sees more of the route ahead, similar to professional GPS navigation apps. Better visibility and situational awareness.
- **Fix: GPS Smoothing Against Jitter** – Implemented exponential moving average (EMA, alpha=0.4) on raw GPS coordinates to eliminate jumping/stuttering movement. GPS noise is filtered out smoothly without reducing responsiveness. Result: Fluid, continuous movement instead of discrete jumps.

## V2.0.66 - 2026-06-01
- **Feature: Navigate to Route Start** – Added new button "📍 Zum Startpunkt" in route panel. When clicked, displays green dashed navigation line from current GPS position to the first point of the selected route. Shows blue marker for current position and orange marker for route start. Automatically fits map bounds to show both points. Displays distance to start point. Helps drivers quickly orient themselves and navigate to the beginning of their assigned route.

## V2.0.65 - 2026-06-01
- **Fix: Implement missing `downloadLineWithGPX()` function** – Auto-download was calling non-existent function, causing all 8 lines to fail. Implemented proper download logic: fetches line JSON from API via `/load_line.php`, stores in IndexedDB linesData, returns success/failure. Now auto-download completes successfully on app startup. Added missing HTML container for available lines display in Settings.

## V2.0.64 - 2026-06-01
- **Refactor: Replace "Route not saved" dialog with Available Lines display** – Removed confusing "Route noch nicht gespeichert" modal that told drivers to practice first. With auto-download, all 8 lines are ready on startup. Added new Settings section showing "✅ Verfügbare Offline-Linien" with visual list of all downloaded lines. Now when driver opens Settings, they see immediately which lines are cached and ready. Deleted: old offline-route-list code (~40 lines), clearAllOfflineRoutes function, showOfflineNotAvailableDialog logic. Result: Zero confusion, maximum transparency.
- **Refactor: Remove Simulation Mode** – Deleted all local simulation code ("Fahrt ▶" button, sim-speed settings, ~150 lines JS, ~50 lines CSS). With auto-download, drivers never need local practice—they select a line and immediately navigate with real GPS. Removed 3 modal buttons (now only "Navigate with GPS" remains). Result: Ultra-clean interface, one workflow, zero confusion.

## V2.0.62 - 2026-06-01
- **Refactor: Remove Download Center Modal** – Removed unnecessary download UI complexity. Auto-download now handles everything silently on startup. Deleted 116 lines of modal code, 150+ lines of CSS, and 8+ event handlers. Result: cleaner codebase, faster app. Drivers never touch download UI—lines are ready automatically when app starts.

## V2.0.61 - 2026-06-01
- **Fix: Auto-Download Now Actually Works!** – Auto-download was checking `linesCatalog` (metadata) instead of `linesData` (actual JSON files). Fixed to check the correct store. Now on app startup with empty cache, all 8 lines are correctly identified as "NEW" and downloaded in background. Progress indicator "⬇ Linien laden…" displays, all 8 lines download successfully (verified: 8/8 complete). Drivers get instant offline line availability without manual steps.

## V2.0.60 - 2026-06-01
- **Fix: Auto-Download Deduplication** – API returns duplicate lines when both new and old directory formats exist. Added automatic deduplication in `fetchAndCacheLinesCatalog()` to filter duplicate IDs before caching, ensuring exact line count matches available inventory. Fixes case where 13 lines displayed but only 8 were actually being downloaded due to ID collisions.

## V2.0.59 - 2026-06-01
- **Auto-Download Lines on Startup** – Lines are now automatically downloaded and cached when app starts, making all lines immediately available offline without user interaction. Driver opens app and all lines are ready to drive. Progress indicator ("⬇ Linien laden…") appears discretely in topbar during background downloads. 200ms delay between downloads prevents server overload.
- **Download Center Button** – Added permanent 📥 button in topbar for manual line management and selective downloads (backup/recovery use case).

## V2.0.55 - 2026-06-01
- **Offline Lines Download Center System** – Complete implementation in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/css/app.css](app/css/app.css):
  - **IndexedDB Schema Upgrade** (DB_VER 2): Added 4 new object stores (`linesCatalog`, `linesData`, `linesGPX`, plus existing `routes`), with 6 supporting database functions for complete offline lines persistence.
  - **Lines Catalog API Integration**: `fetchAndCacheLinesCatalog()` automatically fetches all available lines from `/api/list_lines.php` on app startup, stores metadata in IndexedDB, enabling offline-first downloads without network.
  - **Smart Update Notification Banner**: Top-of-screen alert (orange gradient, dismissible) appears when new lines detected, shows count of available updates, includes "Jetzt laden" button with persistent re-display on new line detection.
  - **Interactive Download Center Modal**: User-facing UI with:
    - Full list of available lines organized by city/route name
    - Real-time cached status indicator ("✓ Schon geladen") for previously downloaded lines
    - Checkboxes for selective download or "Select All" option
    - Live download progress bar showing X/Y lines loaded
    - Auto-saves complete JSON + GPX data per line to IndexedDB
  - **Auto-Fallback Cache Strategy**: Line loader (`loadAndShowRoute()`) now checks in priority order: (1) New `linesData` store for downloaded lines, (2) Old `routes` store for manually saved routes, (3) API fallback if not cached. Enables seamless offline use.
  - **Seamless Navigation Integration**: Auto-save on nav end now also writes to new `linesData` store, maintaining dual compatibility.
  - **Technical Details**:
    - Line IDs generated from city/lineFolder/fileName for consistent indexing
    - Download progress tracking with real-time UI feedback
    - Error handling for failed GPX downloads (JSON preserved)
    - CSS utility for banner with banner-aware layout offset (--banner-h variable)
    - LocalStorage version tracking for update detection

## V2.0.45 - 2026-06-01
- Enhanced road label coverage in [app/js/map.js](app/js/map.js): Expanded street name display filters for both online (OpenFreeMap) and PMTiles offline sources. Now shows all road types: motorway, trunk, primary, secondary, tertiary (main roads) PLUS residential, unclassified, living_street (small side streets). Drivers see complete street network for better navigation orientation.
- Enlarged bus marker from 52px to 68px in [app/css/app.css](app/css/app.css): Bus icon now 30% larger for better visibility on driver's screen, more prominent during navigation, easier to track on map.

## V2.0.44 - 2026-06-01
- Added 3D depth effect to bus marker in [app/css/app.css](app/css/app.css): Replaced flat gradient with multi-layered 5-color gradient (light-to-dark blue), inset box-shadows for internal structure (top/bottom/side highlights), and layered drop-shadows for realistic ground-level depth perception. Added subtle window details via overlay gradients and CSS perspective for 3D volume. Bus now appears as a rounded 3D object rather than a flat icon.

## V2.0.43 - 2026-06-01
- Simplified offline route warning dialog text in [app/index.html](app/index.html): Changed from technical jargon ("Offline-Inventar", "offline nutzen") to simple driver-friendly language ("Route kennst du noch nicht!", "musst sie erst fahren"). Button labels also simplified: "Zuhause Üben (kein GPS nötig)" and "Draußen fahren (mit GPS)" with clearer action verbs.

## V2.0.42 - 2026-06-01
- Enhanced offline route availability dialog in [app/index.html](app/index.html) and [app/js/app.js](app/js/app.js): Now offers two immediate options in addition to "Später": (1) "🏠 Simulation (Zuhause)" starts a practice run at home without GPS, (2) "🚗 Echtes GPS (Draußen)" starts real GPS navigation on the road. Dialog text clarified to explain workflow: simulate at home to record + save, then use real GPS when driving.

## V2.0.41 - 2026-06-01
- Added offline route availability warning modal in [app/index.html](app/index.html) and [app/css/app.css](app/css/app.css); When user loads a route not yet in offline inventory, shows dialog with two options: "Jetzt abfahren & speichern" (start navigation immediately to record + auto-save) or "Später" (dismiss and view route info). Removes manual save button from UI since auto-save is now active.
- Updated [app/js/app.js](app/js/app.js) to detect offline availability and trigger modal display on route load.

## V2.0.40 - 2026-06-01
- Auto-save routes to offline storage when navigation ends in [app/js/app.js](app/js/app.js); Routes are now automatically saved after each completed navigation session, eliminating need for manual save button. Offline availability guaranteed without extra user action.

## V2.0.39 - 2026-06-01
- Added `.gps-dot` CSS class styling in [app/css/app.css](app/css/app.css): was missing, caused GPS marker to be invisible during navigation simulation. Now both real GPS and simulated GPS use the same 52px bus marker with proper styling.
- Ensures cache-busting forces full refresh of CSS on device.

## V2.0.38 - 2026-06-01
- Enlarged GPS bus marker in [app/css/app.css](app/css/app.css): increased from 34px to 52px for much better driver visibility with clearer colors and stronger shadow.
- Improved road label readability in [app/js/map.js](app/js/map.js): increased text size, switched to bold font, darkened color, and strengthened halo for better contrast on day map.
- Updated rollout revisions in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.37 - 2026-06-01
- Fixed map style filter error in [app/js/map.js](app/js/map.js): replaced invalid `in` expression in `road-name-main` with valid `any`/`==` checks for road classes.
- Resolves runtime error `layers[7].filter: Expected 2 arguments, but found 6 instead` and restores map rendering with street labels.
- Updated rollout revisions in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.36 - 2026-06-01
- Added subtle road names for main roads in [app/js/map.js](app/js/map.js) (`motorway`, `trunk`, `primary`, `secondary`, `tertiary`) with line placement and readable halo for driver use.
- Kept map focus clean: labels start at higher zoom and remain visually secondary to route and stops.
- Updated rollout revisions in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.35 - 2026-06-01
- Replaced the GPS point with a bus marker in [app/js/map.js](app/js/map.js) and [app/css/app.css](app/css/app.css), including heading-based rotation for a more realistic driving view.
- Updated service worker registration URL in [app/js/app.js](app/js/app.js) and rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.34 - 2026-06-01
- Updated map rendering in [app/js/map.js](app/js/map.js) to a clearer navigation-style day palette (higher contrast roads, lighter land/background, clearer water/buildings).
- Strengthened route visibility in [app/js/map.js](app/js/map.js) with a clearer casing and thicker main route line for faster driver recognition.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.33 - 2026-06-01
- Fixed map sprite 404 error in [app/js/map.js](app/js/map.js): removed unused `sprite`/`glyphs` style references from custom styles so MapLibre no longer requests missing OpenFreeMap sprite assets.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.32 - 2026-06-01
- Tuned driver camera in [app/js/map.js](app/js/map.js) to be closer to real navigation systems (less extreme pitch/zoom and reduced sky dominance).
- Changed default driver zoom in [app/index.html](app/index.html) from very close to a more practical level (`19 – Standard`).
- Improved update reliability in [app/js/app.js](app/js/app.js) and [app/sw.js](app/sw.js): service worker now forces fresh checks (`updateViaCache: none`), supports `SKIP_WAITING`, and reloads on controller switch.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.31 - 2026-06-01
- Reduced map clutter in [app/js/map.js](app/js/map.js): app now uses the minimal in-app style (`buildRasterStyle`) instead of the full Liberty style, removing unrelated map POIs/labels.
- Reduced PMTiles style clutter in [app/js/map.js](app/js/map.js): removed generic city/place labels so operational stop markers stay visually dominant.
- Tightened stop label focus in [app/js/map.js](app/js/map.js): during active navigation, only the nearest stop label remains visible on-map.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.30 - 2026-06-01
- Further stabilized driver camera bearing in [app/js/map.js](app/js/map.js) for real bus-seat behavior:
	- freeze bearing at standstill / very low speed,
	- require higher speed before trusting noisy device heading,
	- ignore large heading outliers at low speed,
	- cap per-tick rotation by time-based max turn rate.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.29 - 2026-06-01
- Added camera profile presets in [app/index.html](app/index.html) and [app/js/app.js](app/js/app.js): `Standard`, `Extra Ruhig`, `Extra Dynamisch` (persisted locally).
- Improved low-speed camera stability in [app/js/map.js](app/js/map.js): stronger heading dead-zone and slower bearing interpolation to reduce wobble near stops.
- Added intelligent stop-label visibility in [app/js/map.js](app/js/map.js) and [app/css/app.css](app/css/app.css): labels auto-hide at low zoom and are limited to nearby POIs during navigation.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.28 - 2026-05-31
- Added adaptive ultra-cockpit camera in [app/js/map.js](app/js/map.js): driver view now reacts to speed (slow approach / city / faster run) with different zoom, pitch, and forward framing.
- During low-speed stop approach, camera is intentionally less tilted for better readability and reduced motion stress.
- Navigation and simulation now pass speed data to camera updates in [app/js/app.js](app/js/app.js) for consistent profile switching.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.27 - 2026-05-31
- Tightened driver cockpit camera in [app/js/map.js](app/js/map.js): higher nav-mode zoom, stronger pitch, and more aggressive forward framing so the visible area is closer to the road ahead.
- Driver view now places the vehicle lower in frame during active navigation for a more realistic cockpit feel.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.26 - 2026-05-31
- Improved stop visibility on map in [app/js/map.js](app/js/map.js) and [app/css/app.css](app/css/app.css): stops are now rendered as POI markers with readable labels, not only plain dots.
- Improved navigation stop list in [app/js/app.js](app/js/app.js) and [app/css/app.css](app/css/app.css): HUD now shows destination stop plus the next 4 upcoming stops.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.25 - 2026-05-31
- Stabilized navigation camera heading in [app/js/map.js](app/js/map.js): reduced bearing jitter by smoothing heading updates and ignoring tiny oscillations.
- Added robust fallback in [app/js/map.js](app/js/map.js): if GPS heading is unavailable/unstable, camera direction follows movement course from recent GPS fixes.
- Camera bearing state is reset on GPS stop to avoid stale heading carry-over.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.24 - 2026-05-31
- Improved driver visibility in [app/js/map.js](app/js/map.js): active navigation now enforces forward-focused driver camera (no side-view mode switching while driving).
- Driver camera now uses stronger forward bias (higher pitch + dynamic bottom padding) so significantly more road ahead is visible.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.23 - 2026-05-31
- Improved driver focus layout in [app/css/app.css](app/css/app.css): during active navigation, non-essential UI (top bar, selection bar, panel) is hidden so the map and guidance remain central.
- Extended navigation HUD in [app/index.html](app/index.html) and [app/js/app.js](app/js/app.js): added dedicated in-HUD stop button and compact preview of the next three stops with distances.
- Navigation updates now render upcoming stop cards in [app/js/app.js](app/js/app.js) via safe DOM creation.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.22 - 2026-05-31
- Fixed debug drive logging for simulation in [app/js/app.js](app/js/app.js): simulation now starts a recording session (`sim-start`) and writes samples on each simulation tick.
- This resolves empty exported logs when testing via `Fahrt ▶` without live GPS navigation.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.21 - 2026-05-31
- Added debug-only drive logger in [app/js/app.js](app/js/app.js): records raw GPS, snapped tracking point, route state (`ON/OFF/REJOIN`), snap distance, speed, heading, and nearest route index during navigation.
- Added debug HUD controls in [app/js/app.js](app/js/app.js) and [app/css/app.css](app/css/app.css): `REC`, `EXPORT`, `RESET` for field-session capture and JSON export.
- Recording starts automatically on navigation start and stops on nav/sim stop; export file includes thresholds and route metadata for post-analysis tuning.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.20 - 2026-05-31
- Tuned off-route/rejoin thresholds in [app/js/app.js](app/js/app.js) for a calmer Cottbus city profile:
	- `NAV_OFF_ROUTE_ENTER_M`: `130 -> 145`
	- `NAV_REJOIN_START_M`: `70 -> 78`
	- `NAV_REJOIN_BLEND_STEP`: `0.28 -> 0.20`
- Result: less OFF-route flicker in dense urban GPS drift, earlier but smoother rejoin back to route geometry.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.19 - 2026-05-31
- Added off-route detection in [app/js/app.js](app/js/app.js): GPS is treated as off-route when deviation to route geometry exceeds a dedicated threshold.
- Added smooth rejoin flow in [app/js/app.js](app/js/app.js): when the vehicle approaches the route again, map position blends from raw GPS to snapped route position instead of jumping abruptly.
- Extended debug HUD in [app/js/app.js](app/js/app.js) with route state (`ON` / `OFF` / `REJOIN`) and current rejoin progress.
- Updated rollout cache revisions in [app/index.html](app/index.html) and [app/sw.js](app/sw.js) to ensure V2.0.19 assets are delivered.

## V2.0.18 - 2026-05-31
- Added route snapping for live navigation in [app/js/app.js](app/js/app.js): incoming GPS positions are projected onto nearby route segments (windowed map matching) and only applied when deviation is plausible.
- Reduced HUD work in simulation in [app/js/app.js](app/js/app.js) by reusing known route index (`step`) instead of nearest-point search on every tick.
- Extended debug HUD metrics in [app/js/app.js](app/js/app.js) with snap acceptance rate and latest snap distance.
- Updated cache-busting and service-worker shell revision in [app/index.html](app/index.html) and [app/sw.js](app/sw.js) for reliable rollout.

## V2.0.16 - 2026-05-31
- Added a hidden developer performance overlay for navigation HUD timing in [app/js/app.js](app/js/app.js) and [app/css/app.css](app/css/app.css).
- Overlay is strictly debug-only and remains invisible for drivers by default.
- Debug activation: `?debugHud=1` (URL-only, non-persistent), disable via `?debugHud=0`.

## V2.0.15 - 2026-05-31
- Improved DOM safety in [app/js/app.js](app/js/app.js): stop list and offline route list rendering now use explicit element creation with `textContent` instead of template-based `innerHTML` for dynamic values.
- Improved navigation runtime performance in [app/js/app.js](app/js/app.js): GPS HUD update now uses a hint-based nearest-point search window with global fallback only on edge hits, reducing per-tick computation on longer routes.

## V2.0.14 - 2026-05-31
- Improved runtime stability in [app/js/app.js](app/js/app.js): offline/online detection now uses a compatibility fallback when `AbortSignal.timeout` is unavailable.
- Prevents false offline state on browsers/devices with partial AbortSignal support.

## V2.0.13 - 2026-05-31
- Enforced strict write protection in [api/_auth.php](api/_auth.php): write APIs now require a configured server token (`LEHRFAHRER_API_TOKEN`) in all environments, including localhost.
- Removed localhost write bypass.
- Read endpoints remain open, so drivers can continue using the app without token for read/navigation only.

## V2.0.12 - 2026-05-31
- Fixed intermittent `withApiAuthHeaders is not defined` errors caused by mixed browser cache states.
- Added a defensive global API-token helper shim in [index.html](index.html) before local editor scripts load.
- Result: token actions and write-auth test remain functional even if script versions are temporarily mismatched in cache.

## V2.0.11 - 2026-05-31
- Added API token purpose tooltip in editor quickbar via [index.html](index.html), including a short explanation of write-protection scope and behavior.
- Added visual help icon styling for the tooltip in [editor.css](editor.css).

## V2.0.10 - 2026-05-31
- Fixed non-working "API-Token setzen" and "Neuen Ort anlegen" actions in environments where `prompt()` is unsupported.
- Added robust text-input fallback modal in [js/editor.main.js](js/editor.main.js) and input styling in [editor.css](editor.css).
- Result: server menu actions now open a working input dialog instead of silently failing.

## V2.0.9 - 2026-05-31
- Added visible API token status badge in editor quickbar via [index.html](index.html) (`API-Token: an/aus`).
- Added quickbar status styling in [editor.css](editor.css) for active/inactive token state.
- Added dynamic token status refresh in [js/editor.main.js](js/editor.main.js) on startup and after token set/clear actions.

## V2.0.8 - 2026-05-31
- Added editor-side API token management actions in [index.html](index.html) server menu:
	- Token setzen
	- Token testen
	- Token löschen
- Added token helper utilities in [js/editor.state.js](js/editor.state.js): `hasApiToken`, `setApiToken`, `clearApiToken`.
- Added token workflow functions in [js/editor.main.js](js/editor.main.js) including a write-auth probe against `create_city.php`.

## V2.0.7 - 2026-05-31
- Fixed editor city workflow regression by extending [api/list_cities.php](api/list_cities.php) with `includeEmpty=1` support.
- Updated [js/editor.main.js](js/editor.main.js) to request cities with `includeEmpty=1`, so newly created empty cities appear immediately in the editor.
- Added central write-auth guard in [api/_auth.php](api/_auth.php) and applied it to write/delete endpoints:
	[api/create_city.php](api/create_city.php), [api/save_line.php](api/save_line.php), [api/save_gpx.php](api/save_gpx.php), [api/delete_line.php](api/delete_line.php), [api/fetch_stops.php](api/fetch_stops.php), [api/save_catalog.php](api/save_catalog.php).
- Added optional `X-Api-Token` forwarding from editor requests via helper in [js/editor.state.js](js/editor.state.js), used by [js/editor.main.js](js/editor.main.js), [js/editor.api.js](js/editor.api.js), and [js/editor.fetchStops.js](js/editor.fetchStops.js).

## V2.0.6 - 2026-05-31
- Fixed root frontend path handling for localhost subfolder deployments in [index.html](index.html): script includes now use relative paths instead of absolute `/js` and `/data` paths.
- Fixed modular editor API calls in [js/editor.main.js](js/editor.main.js) and [js/editor.api.js](js/editor.api.js) to use relative `API_BASE` endpoints instead of absolute `/api/...`.
- Result: [http://localhost/lehrfahrer/](http://localhost/lehrfahrer/) now loads editor assets and city data correctly.

## V2.0.5 - 2026-05-31
- Fixed city listing in [api/list_cities.php](api/list_cities.php): technical folders like `backup`/`gpx` are excluded from the city selector.
- Added validation to return only cities that actually contain route JSON files (directly or in line subfolders).

## V2.0.4 - 2026-05-31
- Added one-click local startup script [start-local-apache.cmd](start-local-apache.cmd) for Apache/XAMPP.
- Script validates XAMPP path, creates the project junction in htdocs when missing, checks app availability, and opens the app URL.
- Added root [VERSION](VERSION) file for project version tracking.
