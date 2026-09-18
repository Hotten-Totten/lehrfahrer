const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const apiSource = fs.readFileSync(path.resolve(__dirname, '../api/manage_city.php'), 'utf8');
const editorSource = fs.readFileSync(path.resolve(__dirname, '../js/editor.main.js'), 'utf8');
const editorHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const listLinesSource = fs.readFileSync(path.resolve(__dirname, '../api/list_lines.php'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');

test('Ortsverwaltung ist authentifiziert und bietet kompakte UI-Aktionen', () => {
  assert.ok(apiSource.includes('lehrfahrer_require_write_auth()'));
  assert.match(editorHtml, /id="renameCityBtn"[^>]*>Umbenennen<\/button>/);
  assert.match(editorHtml, /id="deleteCityBtn"[^>]*>Löschen<\/button>/);
});

test('Rename- und Delete-Buttons sind an die echten Aktionen gebunden', () => {
  assert.ok(editorSource.includes('renameCityBtn.addEventListener("click", renameSelectedCity)'));
  assert.ok(editorSource.includes('deleteCityBtn.addEventListener("click", deleteSelectedCity)'));
});

test('Rename-Request benennt alten und neuen Ort eindeutig', () => {
  assert.ok(editorSource.includes('{ action: "rename", oldName: city, newName }'));
  assert.ok(apiSource.includes("$input['oldName'] ?? ($input['city'] ?? '')"));
  assert.ok(apiSource.includes("$input['newName'] ?? ($input['newCity'] ?? '')"));
});

test('API akzeptiert ausschließlich POST und liefert strukturierte Laufzeitfehler', () => {
  assert.ok(apiSource.includes("if ($method !== 'POST')"));
  assert.ok(apiSource.includes('set_exception_handler(function (Throwable $error)'));
  assert.ok(apiSource.includes("'ok' => false"));
});

test('Datenverzeichnis wird vor dem gemeinsamen Rename-Delete-Lock angelegt', () => {
  const mkdirPos = apiSource.indexOf("if (!is_dir($dataRoot) && !mkdir($dataRoot, 0775, true))");
  const lockPos = apiSource.indexOf("fopen($dataRoot . DIRECTORY_SEPARATOR . '.city-management.lock'");
  assert.ok(mkdirPos >= 0 && lockPos > mkdirPos);
});

test('erfolgreicher Rename lädt und validiert die aktualisierte Ortsliste', () => {
  assert.ok(editorSource.includes('loadCitiesFromServer(result.city, { throwOnError: true })'));
  assert.ok(editorSource.includes('citySelect.value !== result.city || availableCities.includes(city)'));
});

test('erfolgreiches Delete lädt den Folgeort und prüft das Entfernen', () => {
  assert.ok(editorSource.includes('loadCitiesFromServer(result.nextCity || "", { throwOnError: true })'));
  assert.ok(editorSource.includes('Der gelöschte Ort ist weiterhin in der Ortsliste vorhanden.'));
});

test('API-Fehler zeigen HTTP-Status, Servertext und sichtbaren Dialog', () => {
  assert.ok(editorSource.includes('throw new Error(`HTTP ${response.status}:'));
  assert.ok(editorSource.includes('showCityManagementError("Ort umbenennen", error)'));
  assert.ok(editorSource.includes('showCityManagementError("Ort löschen", error)'));
  assert.ok(editorSource.includes('showInfoPopup({'));
});

test('leerer und identischer neuer Ortsname werden verhindert', () => {
  assert.ok(apiSource.includes("if ($newCity === '')"));
  assert.ok(apiSource.includes('if ($newCity === $city)'));
  assert.ok(editorSource.includes('Der neue Ortsname darf nicht leer sein.'));
});

test('Dublette aus Verzeichnis oder vorhandenen Einstellungen wird verhindert', () => {
  assert.ok(apiSource.includes('if (cityManagePath($citiesRoot, $newCity) !== null)'));
  assert.ok(apiSource.includes('if (array_key_exists($newCity, $settings))'));
});

test('Umbenennen verschiebt den Ort statt ihn zu kopieren', () => {
  assert.ok(apiSource.includes('@rename($sourcePath, $tempPath)'));
  assert.ok(apiSource.includes('@rename($tempPath, $targetPath)'));
  assert.ok(!apiSource.includes('copy($sourcePath'));
});

test('Linien, Betriebsfahrten und Routenzahl werden vor dem Löschen analysiert', () => {
  assert.ok(apiSource.includes("cityManageRouteType($data) === 'line'"));
  for (const field of ['normalLineCount', 'normalRouteCount', 'operationalRouteCount', 'totalRouteCount']) {
    assert.ok(apiSource.includes(`'${field}'`));
    assert.ok(editorSource.includes(`analysis.${field}`));
  }
});

test('Leitstellennummer und weitere Einstellungen werden analysiert und umbenannt', () => {
  assert.ok(apiSource.includes("'dispatchPhone' => $dispatchPhone"));
  assert.ok(apiSource.includes("$settings[$newCity] = $settings[$city]"));
  assert.ok(apiSource.includes("unset($settings[$city])"));
});

test('Routen- und Betriebsreferenzen migrieren auf den neuen Ort', () => {
  assert.ok(apiSource.includes("$key === 'city'"));
  assert.ok(apiSource.includes("$key === 'relatedRouteIds'"));
  assert.ok(apiSource.includes("['jsonPath', 'gpxPath', 'pdfPath']"));
  assert.ok(apiSource.includes('cityManageRestoreFiles($originals)'));
});

test('Löschen verlangt Analyse und explizite Bestätigung', () => {
  const analyzePos = editorSource.indexOf("action: \"analyze\"");
  const confirmPos = editorSource.indexOf('buildCityDeleteMessage');
  const deletePos = editorSource.indexOf("action: \"delete\"");
  assert.ok(analyzePos >= 0 && confirmPos >= 0 && deletePos > analyzePos);
  assert.ok(apiSource.includes("($input['confirmed'] ?? false) !== true"));
  assert.ok(editorSource.includes('if (!confirmed) return'));
});

test('Abbruch der Bestätigung sendet keine Löschanforderung', () => {
  const functionBody = editorSource.slice(
    editorSource.indexOf('async function deleteSelectedCity'),
    editorSource.indexOf('function startInputMaskWatchdog')
  );
  assert.ok(functionBody.indexOf('if (!confirmed) return') < functionBody.indexOf("action: \"delete\""));
});

test('geladene oder ungespeicherte Editordaten erzeugen eine Warnung', () => {
  assert.ok(editorSource.includes('function cityOperationHasUnsavedEditorData'));
  assert.ok(editorSource.includes('möglicherweise ungespeicherte Daten'));
  assert.ok(editorSource.includes('confirmCityOperationWithEditorData("Ort umbenennen")'));
  assert.ok(editorSource.includes('confirmCityOperationWithEditorData("Ort löschen")'));
});

test('Löschen entfernt Ortsordner und Ortseinstellungen ohne hart geschützten Ort', () => {
  assert.ok(apiSource.includes('cityManageDeleteTree($trashPath)'));
  assert.ok(apiSource.includes('unset($settings[$city])'));
  assert.ok(!apiSource.includes("$city === 'cottbus'"));
});

test('leere Ortsliste bleibt sauber leer statt einen Ort zu erfinden', () => {
  assert.ok(editorSource.includes('Keine Orte vorhanden'));
  const loadCitiesBlock = editorSource.slice(
    editorSource.indexOf('async function loadCitiesFromServer'),
    editorSource.indexOf('async function loadCityDispatchPhoneSetting')
  );
  assert.ok(loadCitiesBlock.includes('citySelect.value = ""'));
});

test('App- und Offline-Katalog werden bei nächster Synchronisierung vollständig ersetzt', () => {
  assert.ok(listLinesSource.includes("'city'              => $city"));
  assert.ok(appSource.includes('catalogStore.clear()'));
  assert.ok(appSource.includes('dataStore.clear()'));
  assert.ok(appSource.includes('dbReplaceLineSnapshot(serverCatalog, nextRecords)'));
});
