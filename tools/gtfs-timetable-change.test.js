const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-gtfs-change-'));
let php;
const indexes = {};
const phpString = value => JSON.stringify(String(value).replaceAll('\\', '/'));

function findPhp() {
  return [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean).find(candidate => {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    return !result.error && result.status === 0;
  });
}

function runPhp(code) {
  const result = spawnSync(php, ['-r', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function feed(routes, agency = '143') {
  const stopMap = new Map();
  const routeRows = [];
  const tripRows = [];
  const stopTimeRows = [];
  routes.forEach(route => {
    routeRows.push([route.id, agency, route.short || route.id, route.long || '', route.type || '3']);
    route.variants.forEach((variant, index) => {
      const tripId = `${route.id}_trip_${index}`;
      tripRows.push([route.id, 'service', tripId, variant.headsign || '', variant.direction ?? '0']);
      variant.stops.forEach((stop, stopIndex) => {
        const item = typeof stop === 'string' ? { id: stop, name: stop.toUpperCase() } : stop;
        stopMap.set(item.id, item);
        stopTimeRows.push([tripId, item.id, stopIndex + 1]);
      });
    });
  });
  const rows = values => values.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  return {
    'agency.txt': `agency_id,agency_name\n${agency},Cottbusverkehr\n`,
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_type\n' + rows(routeRows),
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,parent_station\n' + rows([...stopMap.values()].map((stop, index) => [stop.id, stop.name, 51.7 + index / 1000, 14.3 + index / 1000, ''])),
    'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\n' + rows(tripRows),
    'stop_times.txt': 'trip_id,stop_id,stop_sequence\n' + rows(stopTimeRows)
  };
}

function build(name, routes, agency = '143') {
  const target = path.join(sandbox, `${name}.sqlite`);
  const encoded = Buffer.from(JSON.stringify(feed(routes, agency))).toString('base64');
  runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_variant_index.php'))};`
    + `$files=json_decode(base64_decode(${phpString(encoded)}),true);`
    + `lehrfahrer_gtfs_build_variant_index($files,${phpString(target)},[${phpString(agency)}],['created_at'=>'2026-10-19T00:00:00Z']);`);
  indexes[name] = target;
}

function compare(current, previous = null, agency = '143') {
  const output = runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$r=lehrfahrer_gtfs_compare_indexes(${phpString(indexes[current])},${previous ? phpString(indexes[previous]) : 'null'},[${phpString(agency)}]);`
    + `echo json_encode($r,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);`);
  return JSON.parse(output);
}

function route(id, short, variants) { return { id, short, variants }; }
const base = [
  route('R10', '10', [
    { direction: '0', headsign: 'Zentrum', stops: ['a', 'b', 'c'] },
    { direction: '1', headsign: 'Bahnhof', stops: ['c', 'b', 'a'] }
  ]),
  route('R20', '20', [{ direction: '0', headsign: 'Nord', stops: ['d', 'e'] }])
];
const clone = value => JSON.parse(JSON.stringify(value));

before(() => {
  php = findPhp();
  if (!php) throw new Error('PHP fehlt.');
  build('base', base);
  build('identical', clone(base));
  build('new-line', [...clone(base), route('R30', '30', [{ direction: '0', headsign: 'Sued', stops: ['f', 'g'] }])]);
  build('removed-line', clone(base).filter(item => item.id !== 'R20'));
  const newVariant = clone(base); newVariant[0].variants.push({ direction: '2', headsign: 'Messe', stops: ['a', 'h'] }); build('new-variant', newVariant);
  const removedVariant = clone(base); removedVariant[0].variants.splice(1, 1); build('removed-variant', removedVariant);
  const changedStops = clone(base); changedStops[0].variants[0].stops = ['a', 'x', 'b', 'c']; build('changed-stops', changedStops);
  const reordered = clone(base); reordered[0].variants[0].stops = ['a', 'c', 'b']; build('reordered', reordered);
  const headsign = clone(base); headsign[0].variants[0].headsign = 'Neues Zentrum'; build('headsign', headsign);
  build('numeric-routes', [route('10', '10', [{ direction: '0', headsign: 'Zentrum', stops: ['a', 'b'] }])]);
  build('foreign', base, '999');
  build('renumbered', [route('NEW10', '10', [
    { direction: '0', headsign: 'Uhlandstraße', stops: ['a', 'b', 'c', 'u'] },
    { direction: '1', headsign: 'Bahnhof', stops: ['c', 'b', 'a'] }
  ]), route('NEW20', '20', [{ direction: '0', headsign: 'Nord', stops: ['d', 'e'] }])], '287');
});

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('A: identischer GTFS ist vollstaendig UNVERAENDERT', () => {
  const result = compare('identical', 'base');
  assert.deepEqual(result.lineCounts, { NEU: 0, GEAENDERT: 0, UNVERAENDERT: 2, ENTFALLEN: 0 });
  assert.equal(result.variantCounts.UNVERAENDERT, 3);
});

test('B: neue Linie wird mit allen Varianten als NEU erkannt', () => {
  const result = compare('new-line', 'base');
  const line = result.lines.find(item => item.routeId === 'R30');
  assert.equal(line.status, 'NEU');
  assert.equal(line.variants.every(item => item.status === 'NEU'), true);
});

test('C: entfallene Linie wird als ENTFALLEN erkannt', () => {
  const result = compare('removed-line', 'base');
  assert.equal(result.lines.find(item => item.routeId === 'R20').status, 'ENTFALLEN');
});

test('D: zusaetzliche Variante einer bestehenden Linie wird als NEU erkannt', () => {
  const line = compare('new-variant', 'base').lines.find(item => item.routeId === 'R10');
  assert.equal(line.status, 'GEAENDERT');
  assert.equal(line.variants.filter(item => item.status === 'NEU').length, 1);
});

test('E: fehlende Variante einer bestehenden Linie wird als ENTFALLEN erkannt', () => {
  const line = compare('removed-variant', 'base').lines.find(item => item.routeId === 'R10');
  assert.equal(line.variants.filter(item => item.status === 'ENTFALLEN').length, 1);
});

test('F: geaenderte Stopfolge nennt neue und bestehende Stopanzahl', () => {
  const variant = compare('changed-stops', 'base').lines.find(item => item.routeId === 'R10').variants.find(item => item.status === 'GEAENDERT');
  assert.deepEqual(variant.diff.addedStopIds, ['x']);
  assert.equal(variant.diff.stopCountChanged, true);
});

test('G: reine Reihenfolgeaenderung wird konkret erkannt', () => {
  const variant = compare('reordered', 'base').lines.find(item => item.routeId === 'R10').variants.find(item => item.status === 'GEAENDERT');
  assert.equal(variant.diff.orderChanged, true);
  assert.deepEqual(variant.diff.addedStopIds, []);
  assert.deepEqual(variant.diff.removedStopIds, []);
});

test('H: geaenderter Headsign wird ohne falsche neue Variante erkannt', () => {
  const line = compare('headsign', 'base').lines.find(item => item.routeId === 'R10');
  const variant = line.variants.find(item => item.status === 'GEAENDERT');
  assert.equal(variant.diff.headsignChanged, true);
  assert.equal(line.variants.some(item => item.status === 'NEU'), false);
});

test('I: ALLE uebernimmt jede aktuelle Linie und Variante vollstaendig', () => {
  const analysis = compare('new-line', 'base');
  const encoded = Buffer.from(JSON.stringify(analysis)).toString('base64');
  const result = JSON.parse(runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$a=json_decode(base64_decode(${phpString(encoded)}),true);echo json_encode(lehrfahrer_gtfs_working_set($a,'all'));`));
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.missingRouteCount, 0);
  assert.equal(result.completeness.missingVariantCount, 0);
});

test('I2: numerische GTFS-route_id wird bei ALLE typsicher uebernommen', () => {
  const analysis = compare('numeric-routes');
  const encoded = Buffer.from(JSON.stringify(analysis)).toString('base64');
  const result = JSON.parse(runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$a=json_decode(base64_decode(${phpString(encoded)}),true);echo json_encode(lehrfahrer_gtfs_working_set($a,'all'));`));
  assert.equal(result.completeness.complete, true);
  assert.equal(String(result.routes[0].routeId), '10');
});

test('J: Teiluebernahme liefert eine sichtbare Vollstaendigkeitswarnung', () => {
  const analysis = compare('new-line', 'base');
  const encoded = Buffer.from(JSON.stringify(analysis)).toString('base64');
  const result = JSON.parse(runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$a=json_decode(base64_decode(${phpString(encoded)}),true);echo json_encode(lehrfahrer_gtfs_working_set($a,'new'));`));
  assert.equal(result.completeness.complete, false);
  assert.match(result.warning, /Nicht alle Linien\/Varianten/);
});

test('K: Uebernahme veraendert keine bestehende Lehrfahrer-Route', () => {
  const routeFile = path.join(sandbox, 'tenant', 'lines', 'cottbus', '10.json');
  fs.mkdirSync(path.dirname(routeFile), { recursive: true });
  fs.writeFileSync(routeFile, JSON.stringify({ lineName: 'Linie 10', routePoints: [[1, 2]], note: 'manuell' }));
  const before = crypto.createHash('sha256').update(fs.readFileSync(routeFile)).digest('hex');
  const analysis = compare('new-line', 'base');
  const output = path.join(sandbox, 'tenant', 'imports', 'gtfs', 'index', 'working-set.json');
  const encoded = Buffer.from(JSON.stringify(analysis)).toString('base64');
  runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$a=json_decode(base64_decode(${phpString(encoded)}),true);$w=lehrfahrer_gtfs_working_set($a,'all');lehrfahrer_gtfs_write_working_set(${phpString(output)},$w);`);
  const afterHash = crypto.createHash('sha256').update(fs.readFileSync(routeFile)).digest('hex');
  assert.equal(afterHash, before);
});

test('L: manuelle routePoints und fachliche Felder bleiben byteidentisch', () => {
  const routeFile = path.join(sandbox, 'tenant', 'lines', 'cottbus', '10.json');
  const routeData = fs.readFileSync(routeFile, 'utf8');
  assert.deepEqual(JSON.parse(routeData), { lineName: 'Linie 10', routePoints: [[1, 2]], note: 'manuell' });
});

test('M: Tenant-/Agency-Isolation lehnt einen fremden Betreiber ab', () => {
  const code = `require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `try{lehrfahrer_gtfs_compare_indexes(${phpString(indexes.foreign)},null,['143']);exit(9);}catch(Throwable $e){echo 'blocked';}`;
  assert.equal(runPhp(code), 'blocked');
});

test('M2: Betreiberidentitaet statt Agency- und Route-ID, geaenderte Stopfolge erkannt', () => {
  const result = JSON.parse(runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$r=lehrfahrer_gtfs_compare_operator_indexes(${phpString(indexes.renumbered)},${phpString(indexes.base)});echo json_encode($r);`));
  assert.deepEqual(result.agencyIds, ['287']);
  assert.deepEqual(result.previousAgencyIds, ['143']);
  assert.equal(result.lineCounts.GEAENDERT, 1);
  assert.equal(result.lineCounts.UNVERAENDERT, 1);
  assert.equal(result.lines.find(line => line.line === '10').routeId, 'NEW10');
});

test('M3: fehlender oder mehrdeutiger Betreiber wird abgelehnt', () => {
  const helper = phpString(path.join(root, 'api', '_gtfs_timetable_change.php'));
  for (const rows of [[], [{ agency_id: '143', agency_name: 'Fremdbetrieb' }],
    [{ agency_id: '143', agency_name: 'Cottbusverkehr' }, { agency_id: '287', agency_name: 'Cottbusverkehr' }]]) {
    const encoded = Buffer.from(JSON.stringify(rows)).toString('base64');
    assert.equal(runPhp(`require ${helper};try{lehrfahrer_gtfs_operator_id_from_rows(json_decode(base64_decode(${phpString(encoded)}),true));echo 'bad';}catch(Throwable $e){echo 'blocked';}`), 'blocked');
  }
});

test('N: der alte Vergleichsstand bleibt bei Analyse und Uebernahme unveraendert erhalten', () => {
  const before = fs.readFileSync(indexes.base);
  const analysis = compare('new-line', 'base');
  const output = path.join(sandbox, 'tenant', 'imports', 'gtfs', 'index', 'working-set-2.json');
  const encoded = Buffer.from(JSON.stringify(analysis)).toString('base64');
  runPhp(`require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `$a=json_decode(base64_decode(${phpString(encoded)}),true);lehrfahrer_gtfs_write_working_set(${phpString(output)},lehrfahrer_gtfs_working_set($a,'all'));`);
  assert.deepEqual(fs.readFileSync(indexes.base), before);
  const source = fs.readFileSync(path.join(root, 'api', 'import_gtfs.php'), 'utf8');
  assert.match(source, /rename\(\$finalPath, \$backupPath\)/);
  assert.doesNotMatch(source, /rename\(gtfs_index_building_path\(\), \$finalPath\)[\s\S]{0,160}@unlink\(\$backupPath\)/);
});

test('O: Arbeitsvorrat erfasst jede aktuelle Variante und bereitet nur private Entwuerfe vor', () => {
  const privateRoot = path.join(sandbox, 'work-private');
  const company = 'cmp_11111111111111111111111111111111';
  const current = path.join(privateRoot, 'companies', company, 'imports', 'gtfs', 'index', 'variants.sqlite');
  const previous = path.join(path.dirname(current), 'variants.sqlite.previous');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.copyFileSync(indexes.identical, current);
  fs.copyFileSync(indexes.base, previous);
  const output = runPhp(`putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${phpString(privateRoot)});`
    + `require ${phpString(path.join(root, 'api', '_tenant_storage.php'))};`
    + `require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `require ${phpString(path.join(root, 'api', '_gtfs_work_inventory.php'))};`
    + `$i=lehrfahrer_gtfs_work_reconcile(${phpString(company)},${phpString(current)},['143']);`
    + `$n=lehrfahrer_gtfs_work_prepare_all(${phpString(company)},${phpString(current)},$i);`
    + `$i=lehrfahrer_gtfs_work_reconcile(${phpString(company)},${phpString(current)},['143']);`
    + `echo json_encode(['inventory'=>$i,'prepared'=>$n]);`);
  const result = JSON.parse(output);
  assert.deepEqual(result.inventory.completeness, {
    expectedLineCount: 2, capturedLineCount: 2, expectedVariantCount: 3, capturedVariantCount: 3, complete: true
  });
  assert.equal(result.prepared, 3);
  assert.equal(result.inventory.entries.every(entry => entry.status === 'UNGEPRUEFT' && entry.draftPrepared), true);
  assert.equal(fs.existsSync(path.join(privateRoot, 'companies', company, 'lines')), false);
  const drafts = fs.readdirSync(path.join(privateRoot, 'companies', company, 'imports', 'gtfs', 'work-routes'));
  assert.equal(drafts.length, 3);
  const draft = JSON.parse(fs.readFileSync(path.join(privateRoot, 'companies', company, 'imports', 'gtfs', 'work-routes', drafts[0]), 'utf8'));
  assert.ok(draft.stops.length >= 2);
  assert.deepEqual(draft.routePoints, []);
  assert.ok(draft.meta.gtfsWork.routeId && draft.meta.gtfsWork.variantId);
});

test('P: unveraenderter Status bleibt, geaenderte Variante wird pruefpflichtig und entfallene bleibt markiert', () => {
  const privateRoot = path.join(sandbox, 'transition-private');
  const company = 'cmp_22222222222222222222222222222222';
  const current = path.join(privateRoot, 'companies', company, 'imports', 'gtfs', 'index', 'variants.sqlite');
  const previous = path.join(path.dirname(current), 'variants.sqlite.previous');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.copyFileSync(indexes.base, current);
  fs.copyFileSync(indexes.base, previous);
  const prelude = `putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${phpString(privateRoot)});`
    + `require ${phpString(path.join(root, 'api', '_tenant_storage.php'))};`
    + `require ${phpString(path.join(root, 'api', '_gtfs_timetable_change.php'))};`
    + `require ${phpString(path.join(root, 'api', '_gtfs_work_inventory.php'))};`;
  const seeded = JSON.parse(runPhp(prelude
    + `$i=lehrfahrer_gtfs_work_reconcile(${phpString(company)},${phpString(current)},['143']);`
    + `$e=$i['entries'][0];lehrfahrer_gtfs_work_set_status(${phpString(company)},$e['routeId'],$e['variantId'],'IN_BEARBEITUNG');`
    + `echo json_encode($e);`));
  const stable = JSON.parse(runPhp(prelude
    + `$i=lehrfahrer_gtfs_work_reconcile(${phpString(company)},${phpString(current)},['143']);echo json_encode($i);`));
  assert.equal(stable.entries.find(entry => entry.routeId === seeded.routeId && entry.variantId === seeded.variantId).status, 'IN_BEARBEITUNG');

  fs.copyFileSync(indexes['changed-stops'], current);
  const changed = JSON.parse(runPhp(prelude
    + `$i=lehrfahrer_gtfs_work_reconcile(${phpString(company)},${phpString(current)},['143']);echo json_encode($i);`));
  const review = changed.entries.find(entry => entry.timetableStatus === 'GEAENDERT');
  assert.ok(review);
  assert.equal(review.status, 'UNGEPRUEFT');
  assert.equal(review.reviewRequired, true);

  fs.copyFileSync(indexes['removed-variant'], current);
  const removed = JSON.parse(runPhp(prelude
    + `$i=lehrfahrer_gtfs_work_reconcile(${phpString(company)},${phpString(current)},['143']);echo json_encode($i);`));
  assert.ok(removed.entries.some(entry => entry.timetableStatus === 'ENTFALLEN'));
});

test('Q: Fahrer-App fordert explizit nur freigegebene Routen an', () => {
  const app = fs.readFileSync(path.join(root, 'app', 'js', 'app.js'), 'utf8');
  const list = fs.readFileSync(path.join(root, 'api', 'list_lines.php'), 'utf8');
  const load = fs.readFileSync(path.join(root, 'api', 'load_line.php'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'js', 'editor.api.js'), 'utf8');
  assert.match(app, /list_lines\.php\?scope=driver/);
  assert.match(app, /load_line\.php\?scope=driver/);
  assert.doesNotMatch(app, /load_line\.php\?city=/);
  assert.doesNotMatch(app, /result\.lines\.length === 0/);
  assert.match(list, /!\$includeUnreleased && !lehrfahrer_gtfs_work_route_is_released/);
  assert.match(load, /!\$includeUnreleased && !lehrfahrer_gtfs_work_route_is_released/);
  assert.match(editor, /Alle Varianten vorbereiten|workPrepareAll/);
  assert.match(editor, /buildStreetRouteFromStops\(\)/);
});

test('R: einmalige Staging-Vorbereitung ist hart auf Umgebung, Bestand und 75\/678 begrenzt', () => {
  const tool = fs.readFileSync(path.join(root, 'tools', 'prepare-cottbus-gtfs-work-staging.php'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-strato-staging.yml'), 'utf8');
  assert.match(tool, /LEHRFAHRER_ENV[\s\S]*staging/);
  assert.match(tool, /routes'\] !== 75|routes'\]\s*!==\s*75/);
  assert.match(tool, /variants'\] !== 678|variants'\]\s*!==\s*678/);
  assert.match(tool, /protected_data_unchanged/);
  assert.match(workflow, /PREPARE_GTFS_WORK[\s\S]*inputs\.preflight_cottbus/);
  assert.match(workflow, /live_work_hash_before[\s\S]*live_work_hash_after/);
});

test('S: GTFS-Betreiberwahl aktiviert Schliessen und entfernt das Modal-Overlay', () => {
  const editor = fs.readFileSync(path.join(root, 'js', 'editor.api.js'), 'utf8');
  const chooseStart = editor.indexOf('function chooseGtfsAgenciesInPopup');
  const chooseEnd = editor.indexOf('async function postGtfsImport', chooseStart);
  const chooseSource = editor.slice(chooseStart, chooseEnd);
  const closeStart = editor.indexOf('function closeVbbImportProgressPopup');
  const closeEnd = editor.indexOf('function showVbbImportProgressPopup', closeStart);
  const closeSource = editor.slice(closeStart, closeEnd);
  assert.match(chooseSource, /refs\.closeBtn\.disabled = false/);
  assert.match(chooseSource, /refs\.closeBtn\.onclick = \(\) => \{[\s\S]*finish\(null\)[\s\S]*closeVbbImportProgressPopup\(\)/);
  assert.match(closeSource, /refs\.modal\.classList\.add\("hidden"\)/);
  assert.match(closeSource, /refs\.modal\.setAttribute\("aria-busy", "false"\)/);
});

test('T: Fahrplanwechsel zeigt die vorhandene GTFS-Versionsinfo oben an', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'js', 'editor.api.js'), 'utf8');
  const modal = html.slice(html.indexOf('id="gtfsChangeModal"'), html.indexOf('id="gtfsWorkModal"'));
  assert.match(modal, /id="gtfsChangeVersionInfo"[\s\S]*id="gtfsChangeSummary"/);
  assert.match(editor, /renderGtfsChangeAnalysis[\s\S]*loadGtfsVersionInfo\("gtfsChangeVersionInfo", true\)/);
  assert.match(editor, /postGtfsImport\(\{ action: "serverInfo" \}\)/);
  assert.match(editor, /Aktueller GTFS-Stand: \$\{version\.stand\}/);
  assert.match(editor, /Importiert: \$\{version\.importedAt \|\| version\.importDateNote\}/);
});
