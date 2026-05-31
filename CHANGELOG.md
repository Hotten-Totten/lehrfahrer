# Changelog

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
