# Control-Datenbank – MariaDB

Die produktive Control Plane verwendet MariaDB über PDO und `pdo_mysql`.
SQLite ist wegen des NFS-Dateisystems des Hostings kein produktives Backend
mehr. Es bleibt ausschließlich als explizites lokales DEV-/Test-Backend
erhalten. Die fachlichen Datenbestände und die GTFS-SQLite-Indizes sind davon
nicht betroffen.

Das aktuelle Schema hat Version 3 und enthält `companies`, `users`, `roles`,
`capabilities`, `role_capabilities`, `user_roles`, `sessions`,
`control_metadata` und `schema_migrations`. MariaDB-Tabellen verwenden InnoDB,
`utf8mb4` und `utf8mb4_unicode_ci`.

## Produktionskonfiguration

Ohne `LEHRFAHRER_DB_DRIVER` wird `mysql` verwendet. Produktion und Staging
benötigen eine serverseitige Konfiguration, die weder im Repository noch im
DocumentRoot abgelegt und nie an Browser oder JavaScript ausgeliefert wird:

```text
LEHRFAHRER_DB_DRIVER=mysql
LEHRFAHRER_DB_HOST=<interner Datenbankhost>
LEHRFAHRER_DB_PORT=3306
LEHRFAHRER_DB_NAME=<umgebungsspezifische Datenbank>
LEHRFAHRER_DB_USER=<minimal berechtigter Benutzer>
LEHRFAHRER_DB_PASSWORD=<Secret>
```

Alternativ ersetzt `LEHRFAHRER_DB_DSN` die Werte für Host, Port und
Datenbankname, zum Beispiel:

```text
LEHRFAHRER_DB_DSN=mysql:host=<host>;port=3306;dbname=<datenbank>;charset=utf8mb4
```

Der Benutzer und das Passwort bleiben auch beim DSN separat erforderlich.
Fehlende oder ungültige MariaDB-Konfiguration führt zu einem harten Fehler; es
gibt keinen stillen Rückfall auf SQLite. `LEHRFAHRER_ENV` muss passend als
`staging` oder `production` gesetzt sein. Jede Umgebung erhält eine eigene
Datenbank und einen eigenen Datenbankbenutzer.

## TLS und Berechtigungen

TLS wird aktiviert, sobald Strato eine vertrauenswürdige CA-Datei bzw. die
vollständige Zertifikatskette für den internen Datenbankhost bereitstellt:

```text
LEHRFAHRER_DB_TLS_REQUIRED=1
LEHRFAHRER_DB_TLS_CA=<absoluter privater Pfad zur CA-Datei>
```

Die Implementierung prüft das Serverzertifikat. Eine Option zum Abschalten der
Zertifikatsprüfung existiert bewusst nicht. Die Live-Prüfung zeigte zwar
TLS-Unterstützung des MariaDB-Servers, die Zertifikatsprüfung mit dem lokalen
System-Truststore war jedoch nicht erfolgreich. Vor Aktivierung in Produktion
muss deshalb die von Strato vorgesehene CA-/Zertifikatskonfiguration bestätigt
werden. Bis dahin darf TLS nicht durch eine unsichere Einstellung simuliert
werden.

Der Anwendungsbenutzer benötigt nur Verbindung, Lesen und Schreiben sowie DDL
für die kontrollierten Schema-Migrationen in seiner eigenen Datenbank. Globale
Rechte, `FILE`, Benutzerverwaltung und Zugriff aus dem öffentlichen Internet
sind nicht erforderlich. Der Datenbankzugriff erfolgt ausschließlich
serverseitig.

## Migrationen und Parallelität

Vor jeder Migration wird ein datenbankspezifischer MariaDB-Named-Lock über
`GET_LOCK()` bezogen und anschließend über `RELEASE_LOCK()` freigegeben. Damit
werden parallele PHP-Prozesse serialisiert. Die DDL-Schritte sind wiederholbar
formuliert, weil MariaDB bei DDL implizite Commits ausführt. Eine
Schema-Version wird erst nach erfolgreichem Abschluss ihres Schritts in
`schema_migrations` eingetragen.

Anwendungsoperationen verwenden normale InnoDB-Transaktionen. Foreign Keys
sichern insbesondere Gesellschafts-, Benutzer-, Rollen- und Sessionbezüge.
Repositories und Authentifizierung verwenden vorbereitete, weitgehend
dialektneutrale Statements.

Vor einem Produktionslauf sind erforderlich:

1. Datenbankbackup bzw. getesteter Restore-Punkt.
2. Gesonderte Staging-Datenbank mit denselben Servereigenschaften.
3. Erfolgreicher Schema- und Authentifizierungs-Smoke-Test in Staging.
4. Verifizierte Zugangsdaten, Minimalrechte und gegebenenfalls TLS-CA.
5. Erst danach ein separat freigegebener Bootstrap bzw. eine Bestandsmigration.

## Lokales SQLite-Backend

SQLite ist nur mit beiden expliziten Werten zulässig:

```text
LEHRFAHRER_ENV=dev
LEHRFAHRER_DB_DRIVER=sqlite
```

Die Datei liegt dann unter
`LEHRFAHRER_PRIVATE_DATA_DIR/control/lehrfahrer.sqlite`, außerhalb des
DocumentRoot. Aktiv sind `PRAGMA foreign_keys = ON` und ein `busy_timeout` von
5000 ms; WAL wird nicht eingeschaltet. In Staging und Produktion wird SQLite
unabhängig vom Pfad abgewiesen.

## Sessions und Bootstrap

Session- und CSRF-Token werden ausschließlich gehasht gespeichert. Sessions
laufen nach 30 Minuten Inaktivität und absolut nach 12 Stunden ab. Deaktivierte
Benutzer oder Gesellschaften machen eine Session ungültig.

Der erste ADMIN wird weiterhin nur per CLI angelegt. Das Initialpasswort wird
aus `LEHRFAHRER_BOOTSTRAP_PASSWORD` gelesen und nicht als Argument übergeben:

```text
php tools/bootstrap-admin.php --company-slug=betrieb --company-name="Betrieb" --login=admin --display-name="Administration"
```

Das Kommando setzt einen Bootstrap-Marker und ist erst nach gesonderter
Freigabe gegen die jeweilige Zielumgebung auszuführen.

## Test

Der MariaDB-Integrationstest benötigt eine ausschließlich für Tests bestimmte,
leere oder wiederverwendbare Datenbank:

```text
LEHRFAHRER_MARIADB_TEST_DSN=mysql:host=127.0.0.1;port=3306;dbname=lehrfahrer_test;charset=utf8mb4
LEHRFAHRER_MARIADB_TEST_USER=<testbenutzer>
LEHRFAHRER_MARIADB_TEST_PASSWORD=<testpasswort>
node --test tools/control-database-mariadb.test.js
```

Ohne diese drei Testwerte wird der MariaDB-Test übersprungen. Er prüft Schema
und Wiederholbarkeit, Gesellschaft/Benutzer/Rollen/Capabilities,
Login-Passwort, Session/CSRF/Logout, Transaktions-Rollback, Foreign-Key-Fehler,
parallele Verbindungen und Named Locks. Die bestehenden Tests verwenden
weiterhin ausschließlich das explizite lokale DEV-SQLite-Backend.
