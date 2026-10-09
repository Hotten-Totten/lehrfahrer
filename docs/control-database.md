# Control-Datenbank – Phase 1 und 2

Schema-Version 1 enthält Gesellschaften, Benutzer, Rollen und Capabilities.
Schema-Version 2 ergänzt die isolierte Login-/Session-Grundlage. Schema-Version
3 synchronisiert die explizite Standardrollenmatrix für die serverseitige
Capability-Prüfung. Schreib-Locks sind nicht aktiviert; der bisherige Tokenweg
bleibt vorübergehend parallel verfügbar.

## Speicherort

Der Pfad wird ausschließlich über den bestehenden privaten Speicher aufgelöst:

```text
LEHRFAHRER_PRIVATE_DATA_DIR/control/lehrfahrer.sqlite
```

Ohne explizite Umgebungsvariable verwendet der private Speicher weiterhin das
bereits abgesicherte Verzeichnis außerhalb des `DocumentRoot`. Eine Lage im
Projekt- oder Webroot wird von `_private_storage.php` abgewiesen.

Die Datenbank wird erst erzeugt, wenn `lehrfahrer_control_database()` bewusst
aufgerufen wird. Nur die neuen Auth-Endpunkte und das CLI-Bootstrap laden sie.

## Umgebungen

`LEHRFAHRER_ENV` muss `dev`, `staging` oder `production` sein (ohne Wert gilt
`production`). Jede Umgebung erhält einen eigenen absoluten
`LEHRFAHRER_PRIVATE_DATA_DIR` und damit eine eigene Control-Datenbank. Die
Datenbank speichert ihre Umgebung und verweigert eine Nutzung unter einer
anderen Umgebung. Staging-Daten werden nicht aus Produktion kopiert.

`LEHRFAHRER_PUBLIC_ORIGIN` legt die einzige zulässige Origin fest. In Staging
und Produktion ist HTTPS zwingend. Der Sessioncookie ist hostgebunden und heißt
`__Host-lehrfahrer_session`; er verwendet `Secure`, `HttpOnly`,
`SameSite=Strict`, `Path=/` und kein Domain-Attribut.

Optionale, beim Deployment gesetzte Runtime-Werte:

- `LEHRFAHRER_BUILD_COMMIT`
- `LEHRFAHRER_BUILD_ID`
- `LEHRFAHRER_DEPLOYED_AT`

Die Runtime-Ausgabe enthält außerdem Umgebung, Version und Schema-Version und
führt dabei keine Shell-Befehle aus.

## Sessions

Session- und CSRF-Token werden nur gehasht in SQLite gespeichert. Der
CSRF-Token wird kryptographisch aus dem zufälligen Session-Token abgeleitet und
im Browser nur im Arbeitsspeicher gehalten. Eine Session läuft nach 30 Minuten
Inaktivität und absolut nach 12 Stunden ab. Die Aktivität wird höchstens alle
fünf Minuten persistiert. Deaktivierte Benutzer oder Gesellschaften machen eine
Session sofort ungültig. `lehrfahrer_auth_revoke_user_sessions()` bereitet den
späteren Widerruf aller Sessions nach Passwortänderungen vor.

## Bootstrap-ADMIN

Der erste ADMIN wird ausschließlich per CLI angelegt. Das Initialpasswort wird
nicht als Argument, sondern aus `LEHRFAHRER_BOOTSTRAP_PASSWORD` gelesen:

```text
php tools/bootstrap-admin.php --company-slug=betrieb --company-name="Betrieb" --login=admin --display-name="Administration"
```

Ein Marker verhindert die erneute Ausführung. Nur eine ausdrückliche
`--force`-Option hebt diese Sperre auf. Der Benutzer muss sein Passwort beim
ersten späteren dafür vorgesehenen Ablauf ändern.

## SQLite-Konfiguration

- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`
- PDO-Fehlermodus `PDO::ERRMODE_EXCEPTION`
- vorbereitete Statements ohne emulierte Prepares
- Journal-Modus wird nicht verändert

WAL wird ausdrücklich nicht automatisch aktiviert. Der tatsächlich bestehende
Journal-Modus kann mit `lehrfahrer_control_sqlite_info()` diagnostiziert werden.

## Vor Phase 5 auf Strato verifizieren

1. `pdo_sqlite` und die verwendete SQLite-Version im Web- und SSH-PHP.
2. Der private Pfad liegt auf einem Dateisystem mit zuverlässigen POSIX-Locks.
3. Parallele Leser sowie konkurrierende `BEGIN IMMEDIATE`-Transaktionen.
4. Verhalten von `busy_timeout` bei blockierter Schreibtransaktion.
5. Crash-Recovery nach abgebrochener Transaktion.
6. Ob WAL auf diesem Dateisystem offiziell und praktisch unterstützt wird.
7. Schreibrechte, Dateirechte, freier Speicher und Backup/Wiederherstellung.
8. Gleichzeitige PHP-Prozesse des realen Strato-Webservers.

Falls zuverlässige SQLite-Dateisperren oder WAL auf dem Hosting nicht garantiert
werden können, muss vor Einführung des globalen Schreib-Locks auf eine
serverbasierte relationale Datenbank gewechselt werden.
