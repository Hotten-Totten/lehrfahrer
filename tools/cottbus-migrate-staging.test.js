const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const tool = path.join(__dirname, 'cottbus-migrate-staging.php');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-cottbus-migrate-'));
const publicRoot = path.join(sandbox, 'public');
const privateRoot = path.join(sandbox, 'private');
const gtfsRoot = path.join(sandbox, 'gtfs');
const driverId = 'drv_' + 'a'.repeat(32);

function findPhp() {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('PHP ist fuer den Cottbus-Migrationstest erforderlich.');
}
const php = findPhp();

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
function writeCsv(name, header, rows) {
  fs.mkdirSync(gtfsRoot, { recursive: true });
  const text = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(gtfsRoot, name), text);
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function snapshot(directory) {
  const rows = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        rows.push(['d', relative]);
        walk(full);
      } else {
        rows.push(['f', relative, fs.statSync(full).size,
          crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
      }
    }
  }
  walk(directory);
  return rows;
}

const referenceGroups = [
  {
    spec: ['Linie_15', 'Standard', 'Route_15'], free: 1,
    stops: [
      ['91474', 'Hauptbahnhof'], ['212495', 'Marienstraße/Glad House'], ['143385', 'Stadtpromenade'],
      ['392447', 'Stadthalle Post'], ['468289', 'Stadtverwaltung'], ['17123', 'BTU/Bibliothek'],
      ['672326', 'Freizeitbad Lagune'], ['520729', 'Goyatzer Straße'], ['559795', 'Rennbahnweg'],
      ['653546', 'Philipp-Reis-Straße'], ['293738', 'Cottbus-Center'], ['7721', 'Siedlerstraße'],
      ['214053', 'Striesower Straße'], ['162706', 'Am Ring'], ['385854', 'Sielow Feuerwehr'],
      ['301764', 'Windmühlenweg']
    ]
  },
  {
    spec: ['Linie_37', 'Standard', 'Route_37'], free: 12,
    stops: [
      ['229387', 'Babow'], ['161232', 'Milkersdorf Ausbau'], ['84800', 'Milkersdorf Schloss'],
      ['59513', 'Kunersdorf Abzw Bahnhof'], ['410898', 'Kunersdorf Straße des Friedens'],
      ['84323', 'Papitz Kirchstraße'], ['410898', 'Kunersdorf Straße des Friedens'],
      ['32839', 'Kunersdorf Bahnhof'], ['558756', 'Klein Limberg'], ['402361', 'Limberg Hauptstraße'],
      ['446552', 'Glinzig Brückengasse'], ['99298', 'Kolkwitz Teiche'],
      ['189573', 'Kolkwitz Schumannstraße'], ['587828', 'Kolkwitz Rathaus']
    ]
  },
  {
    spec: ['Linie_9', 'Standard', 'Route_9_A'], free: 0,
    stops: [
      ['99788', 'Hauptbahnhof'], ['282045', 'Weinbergstraße'], ['605161', 'Ottilienstraße'],
      ['59738', 'Sportzentrum'], ['230173', 'Vom-Stein-Straße'], ['333542', 'Südeck']
    ]
  },
  {
    spec: ['Linie_9', 'Standard', 'Route_9_B'], free: 8,
    stops: [
      ['hst_3065', 'Südeck', '333542'], ['hst_697', 'Cottbus, Sportzentrum', '59738'],
      ['hst_719', 'Cottbus, Stadtring', '630120'], ['hst_593', 'Cottbus, Hauptbahnhof', '99788']
    ]
  }
];

const stopDefinitions = new Map();
for (const group of referenceGroups) {
  for (const [old, name, mapped] of group.stops) {
    const id = mapped || old;
    const canonicalName = name.replace(/^Cottbus,\s*/, '');
    if (!stopDefinitions.has(id)) stopDefinitions.set(id, canonicalName);
  }
}
while (stopDefinitions.size < 1531) {
  const number = stopDefinitions.size + 1;
  stopDefinitions.set(`fixture_${String(number).padStart(4, '0')}`, `Fixture Stop ${number}`);
}
const stopIds = [...stopDefinitions.keys()];
const stopCoordinates = new Map(stopIds.map((id, index) => [id, [51.5 + (index % 400) / 10000, 14.1 + (index % 500) / 10000]]));

function makeRoute(group, groupIndex) {
  const [lineFolder, categoryFolder, fileBase] = group.spec;
  const stops = group.stops.map(([old, name, mapped], index) => {
    const target = mapped || old;
    const [lat, lon] = stopCoordinates.get(target);
    return {
      id: `stop_${groupIndex}_${index}`, name, lat: mapped ? lat + 0.00001 : lat,
      lon, sourceType: 'catalog', catalogId: old, groupId: old
    };
  });
  for (let index = 0; index < group.free; index++) {
    stops.push({ id: `free_${groupIndex}_${index}`, name: `Freie Haltestelle ${index + 1}`,
      lat: 51.6 + index / 10000, lon: 14.2, sourceType: 'free', catalogId: null, groupId: null });
  }
  return {
    city: 'cottbus', lineFolder, categoryFolder,
    fileBase: groupIndex === 0 ? 'historischer_fileBase' : fileBase,
    lineName: lineFolder.replace('Linie_', 'Linie '), routeName: fileBase,
    directionName: 'Fixture', status: 'created', stops,
    routePoints: [{ lat: 51.5, lon: 14.1, instruction: 'unchanged' }, { lat: 51.6, lon: 14.2 }],
    jsonPath: 'linien/legacy.json', gpxPath: 'linien/legacy.gpx', pdfPath: 'linien/legacy.pdf'
  };
}

function routeRef(group) {
  return { city: 'cottbus', lineFolder: group.spec[0], categoryFolder: group.spec[1], fileBase: group.spec[2] };
}

function createGtfs() {
  writeCsv('agency.txt', ['agency_id', 'agency_name'], [
    ['143', 'Cottbusverkehr'], ['999', 'Fremdagency']
  ]);
  const routes = [];
  for (let index = 0; index < 75; index++) routes.push([`r${index}`, '143', String(index + 1), `Route ${index + 1}`, '3']);
  routes.push(['foreign-route', '999', 'X', 'Foreign', '3']);
  writeCsv('routes.txt', ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], routes);
  const trips = [];
  for (let index = 0; index < 3686; index++) trips.push([
    `r${index % 75}`, `svc${index % 7}`, `t${index}`, `shape${index % 10}`
  ]);
  trips.push(['foreign-route', 'foreign-service', 'foreign-trip', 'foreign-shape']);
  writeCsv('trips.txt', ['route_id', 'service_id', 'trip_id', 'shape_id'], trips);
  const stopTimes = [];
  for (let index = 0; index < 62227; index++) stopTimes.push([
    `t${index % 3686}`, stopIds[index % stopIds.length], String(Math.floor(index / 3686) + 1)
  ]);
  stopTimes.push(['foreign-trip', 'foreign-stop', '1']);
  writeCsv('stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence'], stopTimes);
  const stops = stopIds.map((id, index) => {
    const [lat, lon] = stopCoordinates.get(id);
    return [id, stopDefinitions.get(id), lat.toFixed(6), lon.toFixed(6), index > 0 && index < 5 ? stopIds[0] : '', ''];
  });
  stops.push(['foreign-stop', 'Foreign Stop', '50.0', '13.0', '', '']);
  writeCsv('stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'parent_station', 'level_id'], stops);
  writeCsv('calendar.txt', ['service_id', 'monday', 'start_date', 'end_date'],
    Array.from({ length: 7 }, (_, index) => [`svc${index}`, '1', '20260101', '20261231']).concat([
      ['foreign-service', '1', '20260101', '20261231']
    ]));
  writeCsv('calendar_dates.txt', ['service_id', 'date', 'exception_type'], [['svc0', '20261003', '2'], ['foreign-service', '20261003', '1']]);
  const shapes = [];
  for (let index = 0; index < 10; index++) {
    shapes.push([`shape${index}`, '51.5', '14.1', '1']);
    shapes.push([`shape${index}`, '51.6', '14.2', '2']);
  }
  shapes.push(['foreign-shape', '50', '13', '1']);
  writeCsv('shapes.txt', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapes);
  writeCsv('frequencies.txt', ['trip_id', 'start_time', 'end_time', 'headway_secs'], [
    ['t0', '06:00:00', '07:00:00', '600'], ['foreign-trip', '06:00:00', '07:00:00', '600']
  ]);
  writeCsv('transfers.txt', ['from_stop_id', 'to_stop_id', 'from_route_id', 'to_route_id'], [
    [stopIds[0], stopIds[1], 'r0', 'r1'], ['foreign-stop', 'foreign-stop', 'foreign-route', 'foreign-route']
  ]);
  writeCsv('feed_info.txt', ['feed_publisher_name', 'feed_lang'], [['Fixture', 'de']]);
}

function createSources() {
  for (const [index, group] of referenceGroups.entries()) {
    const [lineFolder, categoryFolder, fileBase] = group.spec;
    const directory = path.join(publicRoot, 'linien', 'cottbus', lineFolder, categoryFolder);
    writeJson(path.join(directory, fileBase + '.json'), makeRoute(group, index));
    fs.writeFileSync(path.join(directory, fileBase + '.gpx'), `<gpx><name>${fileBase}</name></gpx>`);
    fs.writeFileSync(path.join(directory, fileBase + '.pdf'), `%PDF-fixture-${fileBase}`);
  }
  writeJson(path.join(publicRoot, 'data', 'city_settings.json'), {
    cottbus: { dispatchPhone: '0355-fixture', anotherDefault: 'do-not-copy' },
    test: { dispatchPhone: 'exclude' }
  });
  writeJson(path.join(privateRoot, 'personnel', 'drivers.json'), [{
    id: driverId, firstName: 'Private', lastName: 'Fixture', personnelNumber: '1', depot: 'CB',
    note: '', active: true, roles: ['Fahrer'], created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
    forbiddenLegacyPath: '/legacy'
  }]);
  for (let number = 1; number <= 4; number++) {
    writeJson(path.join(privateRoot, 'trainings', `training_${String(number).padStart(6, '0')}.json`), {
      trainingId: `training_${String(number).padStart(6, '0')}`,
      driverId: number === 4 ? driverId : 'drv_' + 'b'.repeat(32),
      status: number === 4 ? 'created' : 'archived',
      routes: number === 4 ? referenceGroups.slice(0, 2).map(routeRef) : [{ city: 'test', lineFolder: 'Test', categoryFolder: 'Test', fileBase: 'Test' }]
    });
  }
  const packageDir = path.join(privateRoot, 'fahrerunterlagen', 'Private_Fixture', 'legacy-package');
  fs.mkdirSync(packageDir, { recursive: true });
  const names = ['cottbus-a.pdf', 'cottbus-b.pdf', 'test-a.pdf', 'test-b.pdf', 'unknown.pdf'];
  for (const name of names) fs.writeFileSync(path.join(packageDir, name), '%PDF-' + name);
  fs.writeFileSync(path.join(packageDir, 'legacy.zip'), 'legacy mixed zip');
  writeJson(path.join(packageDir, 'paket.json'), {
    id: 'pkg_' + 'c'.repeat(32), driverId: '', created: '2026-01-01T00:00:00Z',
    documents: names.map((name, index) => ({
      path: `fahrerunterlagen/Private_Fixture/legacy-package/${name}`,
      lineName: index < 2 ? `Linie ${index + 1}` : '', routeName: index < 2 ? 'Route' : '',
      directionName: '', variantName: '', variantCategory: index < 2 ? 'Standard' : '', validFrom: '', validUntil: ''
    })),
    selectedItems: [
      routeRef(referenceGroups[0]), routeRef(referenceGroups[1]),
      { city: 'test', lineFolder: 'Test', categoryFolder: 'Test', fileBase: 'Test-A' },
      { city: 'test', lineFolder: 'Test', categoryFolder: 'Test', fileBase: 'Test-B' },
      { city: 'test', lineFolder: 'Test', categoryFolder: 'Test', fileBase: 'drivers' }
    ]
  });
  createGtfs();
}

function args(extra = []) {
  return [tool, '--dry-run', `--public-root=${publicRoot}`, `--private-root=${privateRoot}`,
    `--gtfs-directory=${gtfsRoot}`, '--compact', ...extra];
}
function run(extra = [], env = {}) {
  const result = spawnSync(php, args(extra), {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'dev', ...env }
  });
  return { ...result, json: JSON.parse(result.stdout) };
}
function phpString(value) { return JSON.stringify(String(value).replaceAll('\\', '/')); }
function phpBytes(value) { return `base64_decode('${Buffer.from(String(value)).toString('base64')}')`; }
function runLibrary(code) {
  return spawnSync(php, ['-r', `require ${phpString(tool)}; ${code}`], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'dev' }
  });
}

before(createSources);
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('Dry-Run ist byteidentisch, read-only und vollstaendig', () => {
  const beforeState = snapshot(sandbox);
  const first = run();
  const middleState = snapshot(sandbox);
  const second = run();
  const afterState = snapshot(sandbox);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(middleState, beforeState);
  assert.deepEqual(afterState, beforeState);
  assert.equal(first.json.READY_FOR_APPLY, 'YES');
  assert.equal(first.json.read_only_evidence.database_connections, 0);
  assert.equal(first.json.read_only_evidence.database_writes, 0);
  assert.equal(first.json.read_only_evidence.target_writes, 0);
});

test('Realer Staging-Tenant wird im Dry-Run nur gelesen und mit echter ID geplant', () => {
  const company = 'cmp_' + 'c'.repeat(32);
  const stagingRoot = path.join(sandbox, 'real-staging');
  const companyRoot = path.join(stagingRoot, 'companies', company);
  for (const area of ['lines', 'cities', 'drivers', 'trainings', 'packages', 'documents', 'catalogs', 'settings', 'imports']) {
    fs.mkdirSync(path.join(companyRoot, area), { recursive: true });
  }
  fs.writeFileSync(path.join(companyRoot, 'settings', 'company.json'), '{}\n');
  const before = snapshot(stagingRoot);
  const options = `[
    'public-root'=>${phpString(publicRoot)},
    'private-root'=>${phpString(privateRoot)},
    'gtfs-directory'=>${phpString(gtfsRoot)},
    'company-id'=>${phpString(company)},
    'staging-private-root'=>${phpString(stagingRoot)}
  ]`;
  const result = runLibrary(
    `$options=${options}; $plan=cottbusBuildPlan($options,${phpString(company)});` +
    `putenv('LEHRFAHRER_ENV=staging'); putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${phpString(stagingRoot)});` +
    `[$checked,$root]=cottbusDryRunTargetGate($options);` +
    `$state=cottbusDryRunTargetState($plan,$checked,$root);` +
    `echo json_encode(['manifest'=>$plan['deterministic_manifest'],'real_target'=>$state]);`
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(snapshot(stagingRoot), before);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.manifest.company_id, company);
  assert.equal(payload.real_target.company_id, company);
  assert.equal(payload.real_target.target_unchanged, true);
  assert.equal(payload.real_target.other_tenants_unchanged, true);
  assert.ok(Object.values(payload.real_target.target_status).every(value => value === 'CREATE'));
});

test('GTFS-Filter und Katalog enthalten nur Cottbusverkehr und sind reproduzierbar', () => {
  const report = run().json;
  assert.deepEqual(report.deterministic_manifest.gtfs.counts, {
    agencies: 1, routes: 75, trips: 3686, stop_times: 62227, used_stops: 1531, feed_stop_rows: 1531
  });
  assert.equal(report.deterministic_manifest.gtfs.foreign_agencies, 0);
  assert.equal(report.deterministic_manifest.gtfs.reproducible_zip, true);
  assert.equal(report.deterministic_manifest.catalog.count, 1531);
  assert.equal(report.deterministic_manifest.catalog.foreign_stops, 0);
  assert.match(report.deterministic_manifest.gtfs.zip_sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.deterministic_manifest.variants_index.schema_version, 3);
  assert.deepEqual(report.deterministic_manifest.variants_index.agency_ids, ['143']);
  assert.equal(report.deterministic_manifest.variants_index.routes, 75);
  assert.ok(report.deterministic_manifest.variants_index.variants > 0);
  assert.equal(report.deterministic_manifest.variants_index.integrity_check, 'ok');
});

test('Streaming-Filter bleibt im begrenzten PHP-Speicher lauffaehig', () => {
  const result = spawnSync(php, ['-d', 'memory_limit=64M', ...args()], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'dev' }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).deterministic_manifest.gtfs.counts.stop_times, 62227);
});

test('GTFS-CSV liest RFC-Quotes, BOM, CRLF, leere und zusaetzliche Felder strikt', () => {
  const valid = '\ufefftrip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,x_extension\r\n' +
    'c-trip,08:00:00,08:00:00,c-stop,1,"Central, Platform \\",,0,cottbus\r\n' +
    'foreign-trip,,,foreign-stop,1,"Foreign, Terminus \\",,,foreign\r\n';
  const malformed = 'trip_id,stop_id,stop_sequence\nmalformed-trip,only-two\n';
  const code =
    `$stream=fopen('php://temp','r+'); fwrite($stream,${phpBytes(valid)}); rewind($stream);` +
    `$included=[]; $foreign=0; $header=cottbusScanCsvStream($stream,'stop_times.txt',` +
    `function($row) use (&$included,&$foreign) {` +
    `if ($row['trip_id']==='c-trip') $included[]=$row; else $foreign++; }); fclose($stream);` +
    `$bad=fopen('php://temp','r+'); fwrite($bad,${phpBytes(malformed)}); rewind($bad);` +
    `$blocked=false; try { cottbusScanCsvStream($bad,'stop_times.txt',static function($row){}); }` +
    `catch (Throwable $error) { $blocked=str_contains($error->getMessage(),'Ungueltige GTFS-Zeile'); } fclose($bad);` +
    `echo json_encode(['header'=>$header,'included'=>$included,'foreign'=>$foreign,'malformed_blocked'=>$blocked]);`;
  const result = runLibrary(code);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.header[0], 'trip_id');
  assert.equal(payload.header.length, 9);
  assert.equal(payload.header.at(-1), 'x_extension');
  assert.equal(payload.included.length, 1);
  assert.equal(payload.included[0].stop_headsign, 'Central, Platform \\');
  assert.equal(payload.included[0].pickup_type, '');
  assert.equal(payload.included[0].x_extension, 'cottbus');
  assert.equal(payload.foreign, 1);
  assert.equal(payload.malformed_blocked, true);
});

test('Deterministischer ZIP-Writer normalisiert Reihenfolge und Metadaten', () => {
  const code = `$a=cottbusDeterministicZip(['z.txt'=>"Z\n",'a.txt'=>"A\n"]);` +
    `$b=cottbusDeterministicZip(['a.txt'=>"A\n",'z.txt'=>"Z\n"]);` +
    `echo json_encode(['same'=>hash_equals($a,$b),'zip'=>base64_encode($a)]);`;
  const result = runLibrary(code);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.same, true);
  const zip = Buffer.from(payload.zip, 'base64');
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(10), 0); // normalisierte DOS-Zeit
  assert.equal(zip.readUInt16LE(12), 33); // 1980-01-01
  const firstNameLength = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + firstNameLength).toString(), 'a.txt');
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test('Routen, Fahrer, Training und Paket entsprechen exakt der Freigabe', () => {
  const report = run().json;
  const manifest = report.deterministic_manifest;
  assert.equal(manifest.routes.count, 4);
  assert.equal(manifest.routes.lines, 3);
  assert.equal(manifest.routes.free_stops_preserved, 21);
  assert.equal(manifest.routes.geometry, 'UNCHANGED');
  assert.equal(manifest.remappings.length, 40);
  assert.equal(manifest.remappings.filter(item => item.match === 'EXACT').length, 36);
  assert.equal(manifest.remappings.filter(item => item.match === 'HIGH').length, 4);
  assert.deepEqual(manifest.driver, { count: 1, id_action: 'KEEP-ID' });
  assert.deepEqual(manifest.training.include, ['training_000004']);
  assert.deepEqual(manifest.training.exclude, ['training_000001', 'training_000002', 'training_000003']);
  assert.equal(manifest.package.documents, 2);
  assert.equal(manifest.package.legacy_zip, 'EXCLUDE');
  assert.equal(manifest.package.new_zip, 'REBUILD');
  assert.equal(manifest.settings.master_defaults_copied, false);
  assert.ok(manifest.would_exclude.includes('fileBase=drivers'));
  assert.ok(manifest.would_exclude.includes('fifth-unresolved-pdf'));
  assert.ok(manifest.would_exclude.includes('variants.sqlite-copy'));
  assert.ok(manifest.manifest.every(item => item.target.startsWith('companies/{COTTBUS_COMPANY_ID}/')));
  assert.doesNotMatch(JSON.stringify(manifest.manifest), /Private_Fixture|forbiddenLegacyPath/);
});

test('Abweichende Mappingkoordinate und Symlink/Junction werden hart abgewiesen', t => {
  const routeFile = path.join(publicRoot, 'linien', 'cottbus', ...referenceGroups[0].spec.slice(0, 2), referenceGroups[0].spec[2] + '.json');
  const original = fs.readFileSync(routeFile, 'utf8');
  const route = JSON.parse(original);
  route.stops[0].lat += 0.01;
  fs.writeFileSync(routeFile, JSON.stringify(route));
  try {
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stdout, /koordinate/i);
  } finally {
    fs.writeFileSync(routeFile, original);
  }
  const link = path.join(publicRoot, 'linien', 'cottbus', 'escape');
  try {
    fs.symlinkSync(privateRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.diagnostic('Symlink/Junction in dieser Umgebung nicht erlaubt: ' + error.code);
    return;
  }
  try {
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stdout, /Symlink|Junction|Unbekannter Dateityp/);
  } finally {
    fs.rmSync(link);
  }
});

test('Apply-Sicherheitsgates blockieren Umgebung, Token und company_id vor jedem Schreiben', () => {
  const base = args().filter(value => value !== '--dry-run');
  base.push('--apply');
  const noStaging = spawnSync(php, base, { cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'dev' } });
  assert.equal(noStaging.status, 2);
  assert.match(noStaging.stdout, /ausschliesslich.*staging/);
  const noToken = spawnSync(php, base, { cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'staging' } });
  assert.equal(noToken.status, 2);
  assert.match(noToken.stdout, /Bestaetigungstoken/);
  const invalidCompany = spawnSync(php, [...base, `--confirm=APPLY-COTTBUS-STAGING`, '--company-id=invalid'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'staging' }
  });
  assert.equal(invalidCompany.status, 2);
  assert.match(invalidCompany.stdout, /nicht kanonisch/);
});

test('Testgesellschaft, Mastertemplate und fehlende Control-DB-Gesellschaft werden blockiert', () => {
  for (const [record, pattern] of [
    ['null', 'existiert nicht'],
    ["['slug'=>'lehrfahrer-test','name'=>'Test']", 'Testgesellschaft'],
    ["['slug'=>'master-template','name'=>'Master Template']", 'Mastertemplate']
  ]) {
    const result = runLibrary(`try { cottbusValidateCompanyRecord(${record}); echo 'NOT_BLOCKED'; } catch (Throwable $e) { echo $e->getMessage(); }`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(pattern));
  }
  const overlapRoot = phpString(publicRoot);
  const overlap = runLibrary(`try { cottbusApply([], ['public_root'=>${overlapRoot},'private_root'=>${phpString(privateRoot)}], 'cmp_${'e'.repeat(32)}', ${overlapRoot}); } catch (Throwable $e) { echo $e->getMessage(); }`);
  assert.match(overlap.stdout, /nicht identisch oder verschachtelt/);
  const target = path.join(sandbox, 'approval-target');
  fs.mkdirSync(target, { recursive: true });
  const approval = runLibrary(`try { cottbusApply([], ['public_root'=>${phpString(publicRoot)},'private_root'=>${phpString(privateRoot)},'deterministic_manifest'=>['source_fingerprint'=>'${'f'.repeat(64)}']], 'cmp_${'e'.repeat(32)}', ${phpString(target)}); } catch (Throwable $e) { echo $e->getMessage(); }`);
  assert.match(approval.stdout, /exakten Live-Fingerprint/);
});

test('Idempotenz unterscheidet CREATE, SKIP, abweichend und unbekannte Datei', () => {
  const targetRoot = path.join(sandbox, 'target-private');
  const company = 'cmp_' + 'd'.repeat(32);
  const companyRoot = path.join(targetRoot, 'companies', company);
  fs.mkdirSync(path.join(companyRoot, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(companyRoot, 'settings', 'company.json'), '{}');
  const codePrefix = `$root=${phpString(targetRoot)}; $company=${phpString(company)}; $files=['companies/'.$company.'/drivers/drivers.json'=>"fixture\n"];`;
  let result = runLibrary(`${codePrefix} echo json_encode(cottbusExistingTargetStatus($root,$company,$files));`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { [`companies/${company}/drivers/drivers.json`]: 'CREATE' });
  fs.mkdirSync(path.join(companyRoot, 'drivers'));
  fs.writeFileSync(path.join(companyRoot, 'drivers', 'drivers.json'), 'fixture\n');
  result = runLibrary(`${codePrefix} echo json_encode(cottbusExistingTargetStatus($root,$company,$files));`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { [`companies/${company}/drivers/drivers.json`]: 'SKIP' });
  fs.writeFileSync(path.join(companyRoot, 'drivers', 'drivers.json'), 'different');
  result = runLibrary(`${codePrefix} try { cottbusExistingTargetStatus($root,$company,$files); } catch(Throwable $e) { echo $e->getMessage(); }`);
  assert.match(result.stdout, /Abweichende/);
  fs.writeFileSync(path.join(companyRoot, 'drivers', 'unknown.json'), '{}');
  result = runLibrary(`${codePrefix} try { cottbusExistingTargetStatus($root,$company,$files); } catch(Throwable $e) { echo $e->getMessage(); }`);
  assert.match(result.stdout, /Unbekannte Datei/);
});

test('Keine Fachnavigation oder Routingdatei wird durch das Werkzeug referenziert', () => {
  const source = fs.readFileSync(tool, 'utf8');
  assert.doesNotMatch(source, /(?:navigation|routinggraph|off-route|curve|arrow)/i);
  assert.ok(source.includes("'geometry' => 'UNCHANGED'"));
  assert.ok(source.includes("'variants-index:BUILD_AND_VALIDATE'"));
  assert.ok(source.includes("'activation' => 'ATOMIC_TENANT_ROOT_SWAP'"));
});
