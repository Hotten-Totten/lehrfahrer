# Strato-Staging

Die Staging-Pipeline ist ausschließlich an den Branch `staging` und die
GitHub-Environment `staging` gebunden. Sie besitzt kein Promotion- oder
Live-Deployment. Der vorhandene Live-Workflow für `main` wird nicht verwendet
oder verändert.

## Einmalige Strato-Vorbereitung

Vor dem ersten Lauf müssen im Strato-Konto eingerichtet sein:

1. Subdomain `staging.lehrfahrer.de` mit eigenem DocumentRoot.
2. Gültiges HTTPS-Zertifikat für diese Subdomain.
3. Eigene leere MariaDB-Datenbank und eigener Benutzer nur für diese DB.
4. Vertrauenswürdige CA-Kette für die zertifikatsgeprüfte MariaDB-Verbindung.

Weder WordPress-/Fremddatenbanken noch die Live-Control-DB dürfen verwendet
werden. Solange Strato keine verifizierbare CA-Kette bereitstellt, bleibt das
Deployment absichtlich blockiert. Die Pipeline kann die Zertifikatsprüfung
nicht abschalten.

## GitHub-Konfiguration

Nicht sensitive Environment-Variablen:

```text
STAGING_TARGET_PATH=staging.lehrfahrer.de
STAGING_PRIVATE_PATH=lehrfahrer-staging-private
```

Erforderliche Environment-Secrets:

```text
STAGING_DB_DSN
STAGING_DB_USER
STAGING_DB_PASSWORD
STAGING_DB_TLS_CA_PEM
STAGING_API_TOKEN
STAGING_ADMIN_PASSWORD
STAGING_BASIC_AUTH_USER
STAGING_BASIC_AUTH_PASSWORD
```

Die vorhandenen Strato-SSH-Zugangsdaten dienen nur als Transportzugang. Das
Staging-DocumentRoot wird vor jedem Lauf gegen den geheimen Live-Zielpfad
geprüft. Gleichheit bricht den Lauf vor dem Deployment ab.

## Private Runtime-Konfiguration

Die Pipeline erzeugt `runtime-env.php`, Datenbank-CA, Basic-Auth-Datei und
Tenant-Binding ausschließlich im getrennten Staging-Private-Storage. Im
DocumentRoot liegt nur eine `.user.ini`, die auf die private Runtime-Datei
verweist. MariaDB-, API-, Admin- und Basic-Auth-Secrets werden nicht committed
und nicht in Browser oder JavaScript ausgeliefert.

Gesetzte Laufzeitwerte:

```text
LEHRFAHRER_ENV=staging
LEHRFAHRER_PUBLIC_ORIGIN=https://staging.lehrfahrer.de
LEHRFAHRER_PRIVATE_DATA_DIR=<getrennter privater Staging-Pfad>
LEHRFAHRER_DB_DRIVER=mysql
LEHRFAHRER_DB_DSN=<Staging-MariaDB>
LEHRFAHRER_DB_TLS_REQUIRED=1
LEHRFAHRER_BUILD_COMMIT=<staging-Commit>
LEHRFAHRER_BUILD_ID=<GitHub-Run und Versuch>
LEHRFAHRER_DEPLOYED_AT=<UTC-Zeitpunkt>
```

## Testgesellschaft und Schutz

Die idempotente Provisionierung erlaubt in der Staging-Control-DB genau eine
Gesellschaft:

```text
Name: Lehrfahrer Testgesellschaft
Slug: lehrfahrer-test
Admin-Login: staging-admin
```

Der Admin wird über den gehashten Einmaltoken aktiviert; sein Passwort kommt
nur aus dem Staging-Secret. Die Pipeline gibt weder Passwort noch Token aus.

Staging wird zusätzlich zur normalen Lehrfahrer-Authentifizierung vollständig
mit HTTP Basic Auth geschützt. `robots.txt` sperrt alle Pfade und der Header
`X-Robots-Tag: noindex, nofollow, noarchive` verhindert Indexierung.

## Automatische Prüfungen

Vor dem Upload laufen PHP-/JavaScript-Syntax, Control-, Provisioning-, Session-,
Capability-, Security- und Tenant-Tests. Danach prüft die Pipeline:

- Basic Auth vor der gesamten Staging-Site,
- Runtime `STAGING`, Commit, Build und Schema-Version,
- zertifikatsgeprüfte MariaDB-TLS-Verbindung und keine globalen DB-Rechte,
- ausschließlich erwartete InnoDB-/utf8mb4-Tabellen,
- genau eine Testgesellschaft mit Nullbestand,
- Rollen, Capabilities, Tenant-Config und aktiven Testadmin,
- Login, Host-only-Sessioncookie, CSRF, Session-Lookup und Logout,
- unveränderte öffentliche Live-Version vor und nach dem Staging-Lauf.
