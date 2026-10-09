# Phase 4C: Fahrer, Einweisungen und Unterlagen

**PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E.**

Die APIs verwenden den serverseitig autorisierten Gesellschaftskontext und speichern
Fahrer, Einweisungen, Paketmetadaten/ZIPs und erzeugte PDFs unter
`LEHRFAHRER_PRIVATE_DATA_DIR/companies/{company_id}/` in den Bereichen
`drivers`, `trainings`, `packages` und `documents`. Routenquellen stammen
ausschließlich aus dem Phase-4B-Linienbereich derselben Gesellschaft.

Bei Sessions kommt die ID aus der Session. Der Legacy-Token verwendet nur die
serverseitig konfigurierte `LEHRFAHRER_LEGACY_COMPANY_ID`. Request-Parameter
werden dafür nicht akzeptiert. Der Phase-4A-Pfadhelfer schützt die Root-Grenze
und lehnt Symlinks ab. Paketdateien sind nur über autorisierte APIs abrufbar.

Bestehende private Produktionsdaten werden in Phase 4C weder gelesen noch
migriert, verschoben oder gelöscht. Die produktiven Altdaten bleiben bis zur
geplanten Phase 4E unverändert. Deshalb ist dieser Commit nicht deploybar.
