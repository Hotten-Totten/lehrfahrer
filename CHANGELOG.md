# Changelog

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
