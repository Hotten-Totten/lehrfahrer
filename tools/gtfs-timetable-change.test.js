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
