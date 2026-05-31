# Changelog

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
