# API-Autorisierung – Phase 3

`api/_api_authorization.php` ist die zentrale Autorisierungsschicht für die in
Phase 3 angebundenen APIs. Ein vorhandener Sessioncookie wird immer als Session
geprüft; eine ungültige Session fällt nicht still auf den Legacy-Token zurück.
Ohne Session bleibt der bestehende `X-Api-Token` einschließlich seiner bisherigen
GET-/POST-Fallbacks vorübergehend kompatibel. Neue Token-Transportwege wurden
nicht eingeführt.

Jede autorisierte Antwort kennzeichnet den Weg mit:

```text
X-Lehrfahrer-Auth-Mode: session
X-Lehrfahrer-Auth-Mode: legacy-token
```

Der Header dient der Diagnose während der Migration und enthält keine Benutzer-
oder Mandantendaten. `company_id` und `user_id` des Sessionwegs stammen
ausschließlich aus der serverseitigen Session.

## Statuscodes und Mutationen

- `401`: keine oder ungültige Session und kein Legacy-Tokenweg
- `403`: gültige Session ohne Capability, falscher CSRF-Token oder falsche Origin
- `405`: GET/HEAD auf einem als Mutation gebundenen Endpunkt

Sessionbasierte Mutationen benötigen Capability, konfigurierte Same-Origin-
Herkunft und `X-CSRF-Token`. Der Legacy-Tokenweg bleibt bis zur späteren
Migration ohne Session-CSRF kompatibel. Ein globaler Schreib-Lock und die
vollständige Mandantentrennung der Fachdaten sind weiterhin nicht aktiv.

## Capability-Zuordnung

| API / Operation | Capability |
|---|---|
| `list_cities.php`, `list_lines.php`, `load_line.php`, `download_line_pdf.php` | `routes.read` |
| `pdf/preview_v2.php` | `routes.read` |
| `city_settings.php` GET / POST | `operations.settings.read` / `operations.settings.write` |
| `drivers.php` GET / Mutation | `drivers.read` / `drivers.manage` |
| `trainings.php` GET / Mutation | `trainings.read` / `trainings.manage` |
| `list_driver_packages.php` | `packages.read` |
| `download_driver_package.php` | `packages.download` |
| `create_driver_documents.php` | `packages.create` |
| `manage_driver_package.php` | `packages.manage` |
| `save_line.php`, `save_gpx.php` | `routes.write` |
| `delete_line.php` | `routes.delete` |
| `regenerate_pdfs.php`, `normalize_ghost_points.php` | `routes.maintain` |
| `import_vbb_line.php`, `import_gtfs.php` | `routes.import` |
| `create_city.php`, `manage_city.php` | `cities.manage` |
| `fetch_stops.php` ohne Speichern | `stops.fetch` |
| `fetch_stops.php` mit `save=1`, `save_catalog.php` | `stops.catalog.write` |

`manage_city.php` verwendet auch für die Analyse bewusst `cities.manage`, weil
die Analyse interne Bestands- und Konfigurationsinformationen offenlegt und in
Phase 3 keine zusätzliche Read-Capability eingeführt werden soll.
