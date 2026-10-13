const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const tool = path.join(__dirname, 'cottbus-migration-dry-run.php');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-cottbus-dry-run-'));
const publicRoot = path.join(sandbox, 'public');
const privateRoot = path.join(sandbox, 'private');
const driverId = 'drv_' + 'a'.repeat(32);
const packageId = 'pkg_' + 'b'.repeat(32);
const routeSpecs = [
  ['Linie_9', 'Standard', 'Route_01_A'],
  ['Linie_9', 'Standard', 'Route_01_B'],
  ['Linie_10', 'Standard', 'Route_01_C'],
  ['Linie_11', 'Standard', 'Route_01_D'],
];

function findPhp() {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('PHP ist fuer den Cottbus-Dry-Run-Test erforderlich.');
}

const php = findPhp();

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function routeRecord([lineFolder, categoryFolder, fileBase], index) {
  const stops = [];
  for (let number = 0; number < 10; number++) {
    stops.push({ catalogId: index === 0 && number < 4 ? `hst_${number + 1}` : `missing_${index}_${number}` });
  }
  return { city: 'cottbus', lineFolder, categoryFolder, fileBase, stops, routePoints: [] };
}

function routeReference(spec) {
  return { city: 'cottbus', lineFolder: spec[0], categoryFolder: spec[1], fileBase: spec[2] };
}

function snapshot(root) {
  const rows = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        rows.push(['d', relative]);
        visit(file);
      } else {
        rows.push(['f', relative, fs.statSync(file).size, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
      }
    }
  }
  visit(root);
  return rows;
}

function run(extra = []) {
  const args = [tool, `--public-root=${publicRoot}`, `--private-root=${privateRoot}`,
    `--gtfs-zip=${path.join(publicRoot, 'gtfs', 'latest.zip')}`,
    `--variants-sqlite=${path.join(publicRoot, 'gtfs', 'variants.sqlite')}`, '--compact', ...extra];
  const result = spawnSync(php, args, { encoding: 'utf8' });
  return { ...result, json: JSON.parse(result.stdout) };
}

before(() => {
  for (const [index, spec] of routeSpecs.entries()) {
    const directory = path.join(publicRoot, 'linien', 'cottbus', spec[0], spec[1]);
    fs.mkdirSync(directory, { recursive: true });
    writeJson(path.join(directory, spec[2] + '.json'), routeRecord(spec, index));
    fs.writeFileSync(path.join(directory, spec[2] + '.gpx'), '<gpx/>');
    fs.writeFileSync(path.join(directory, spec[2] + '.pdf'), '%PDF-fixture');
  }
  fs.mkdirSync(path.join(publicRoot, 'linien', 'test'), { recursive: true });
  fs.mkdirSync(path.join(publicRoot, 'linien', 'proberouten'), { recursive: true });
  fs.mkdirSync(path.join(publicRoot, 'backup_liniendaten'), { recursive: true });
  fs.mkdirSync(path.join(publicRoot, 'WorkingSystem'), { recursive: true });
  fs.mkdirSync(path.join(publicRoot, 'data'), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, 'data', 'haltestellen.js'), 'const stopCatalog = ' + JSON.stringify([
    { id: 'hst_1' }, { id: 'hst_2' }, { id: 'hst_3' }, { id: 'hst_4' }
  ]) + ';');
  writeJson(path.join(publicRoot, 'data', 'city_settings.json'), { cottbus: { dispatchPhone: 'fixture' }, test: { dispatchPhone: 'no' } });
  fs.mkdirSync(path.join(publicRoot, 'gtfs'), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, 'gtfs', 'latest.zip'), 'fixture-zip');
  fs.writeFileSync(path.join(publicRoot, 'gtfs', 'variants.sqlite'), 'fixture-index');

  writeJson(path.join(privateRoot, 'personnel', 'drivers.json'), [{
    id: driverId, firstName: 'Private', lastName: 'Fixture', active: true, roles: ['Fahrer']
  }]);
  const testRoute = { city: 'test', lineFolder: 'Linie_2', categoryFolder: 'Standard', fileBase: 'Test' };
  for (let id = 1; id <= 4; id++) {
    writeJson(path.join(privateRoot, 'trainings', `training_${String(id).padStart(6, '0')}.json`), {
      trainingId: `training_${String(id).padStart(6, '0')}`,
      driverId: id === 4 ? driverId : 'drv_' + 'c'.repeat(32),
      status: id === 4 ? 'created' : 'archived',
      routes: id === 4 ? routeSpecs.slice(0, 2).map(routeReference) : [testRoute],
      documents: []
    });
  }
  const packageDirectory = path.join(privateRoot, 'fahrerunterlagen', 'Private_Fixture', 'fixture-package');
  fs.mkdirSync(packageDirectory, { recursive: true });
  const documentNames = ['cottbus-a.pdf', 'cottbus-b.pdf', 'test-a.pdf', 'test-b.pdf', 'unknown.pdf'];
  for (const name of documentNames) fs.writeFileSync(path.join(packageDirectory, name), '%PDF-' + name);
  fs.writeFileSync(path.join(packageDirectory, 'package.zip'), 'fixture-package-zip');
  writeJson(path.join(packageDirectory, 'paket.json'), {
    id: packageId, driverId: '', status: 'Erstellt', documentCount: 5, lineCount: 3,
    documents: documentNames.map((name, index) => ({
      path: `fahrerunterlagen/Private_Fixture/fixture-package/${name}`,
      lineName: index < 4 ? `Linie ${index}` : '', routeName: index < 4 ? 'Route 01' : '',
      variantCategory: index < 4 ? 'Standard' : ''
    })),
    selectedItems: [
      routeReference(routeSpecs[0]), routeReference(routeSpecs[1]),
      { ...testRoute, fileBase: 'Test-A' }, { ...testRoute, fileBase: 'Test-B' },
      { ...testRoute, fileBase: 'drivers' }
    ]
  });
});

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('Tool enthaelt keine mutierenden Datei- oder SQL-Operationen', () => {
  const source = fs.readFileSync(tool, 'utf8');
  assert.doesNotMatch(source, /\b(?:mkdir|copy|unlink|chmod|chown|file_put_contents|rename|rmdir)\s*\(/i);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/i);
  assert.ok(source.includes("'mode' => 'READ_ONLY'"));
});

test('Dry-Run ist deterministisch und veraendert Quellen nicht', () => {
  const before = snapshot(sandbox);
  const first = run();
  const middle = snapshot(sandbox);
  const second = run();
  const afterState = snapshot(sandbox);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.deepEqual(middle, before);
  assert.deepEqual(afterState, before);
  assert.equal(second.stdout, first.stdout);
  assert.equal(first.json.read_only_evidence.writes_performed, 0);
  assert.equal(first.json.read_only_evidence.database_writes, 0);
  assert.equal(first.json.read_only_evidence.all_fingerprints_unchanged, true);
});

test('Freigaben, Ausschluesse und Mappings sind exakt', () => {
  const report = run().json;
  assert.equal(report.company_id, '{COTTBUS_COMPANY_ID}');
  assert.equal(report.migration_ready, false);
  assert.equal(report.summary.would_migrate.cities, 1);
  assert.equal(report.summary.would_migrate.lines, 3);
  assert.equal(report.summary.would_migrate.routes, 4);
  assert.equal(report.summary.would_migrate.drivers, 1);
  assert.equal(report.summary.would_migrate.trainings, 1);
  assert.equal(report.summary.would_migrate.documents, 2);
  assert.equal(report.summary.would_exclude.test_trainings, 3);
  assert.equal(report.summary.would_exclude.test_package_positions, 2);
  assert.equal(report.summary.would_exclude.drivers_reference, 1);
  assert.equal(report.summary.manual_required.package_documents, 1);
  assert.equal(report.drivers.mapping.action, 'KEEP-ID');
  assert.deepEqual(report.trainings.map(item => item.status), ['EXCLUDE', 'EXCLUDE', 'EXCLUDE', 'INCLUDE']);
  assert.deepEqual(report.package.positions.map(item => item.status), ['INCLUDE', 'INCLUDE', 'EXCLUDE', 'EXCLUDE', 'MANUAL']);
  assert.equal(report.package.zip.status, 'EXCLUDE');
  assert.equal(report.package.driver_assignment, 'MANUELL BESTAETIGEN');
  assert.equal(report.catalog.references, 40);
  assert.equal(report.catalog.valid, 4);
  assert.equal(report.catalog.invalid, 36);
  assert.equal(report.catalog.status, 'BLOCKED');
  assert.equal(report.gtfs.variants_action, 'REBUILD');
  for (const item of report.target_manifest.filter(item => item.target)) {
    assert.ok(item.target.startsWith('companies/{COTTBUS_COMPANY_ID}/'));
  }
  assert.ok(report.source_policy.excluded.includes('linien/test'));
  assert.ok(report.source_policy.excluded.includes('backup_liniendaten'));
  assert.ok(report.source_policy.excluded.includes('WorkingSystem'));
});

test('Unbekannte Produktivdatei fuehrt zu BLOCKED statt stiller Aufnahme', () => {
  const unknown = path.join(publicRoot, 'linien', 'cottbus', 'unexpected.tmp');
  fs.writeFileSync(unknown, 'unexpected');
  try {
    const result = run();
    assert.equal(result.status, 2);
    assert.equal(result.json.status, 'BLOCKED');
    assert.ok(result.json.errors.some(message => message.includes('Unbekannte Datei')));
    assert.equal(result.json.migration_ready, false);
  } finally {
    fs.rmSync(unknown);
  }
});

test('Symlink oder Junction im Produktivbereich wird hart abgewiesen', t => {
  const link = path.join(publicRoot, 'linien', 'cottbus', 'escape');
  try {
    fs.symlinkSync(privateRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip('Symlink/Junction in dieser Testumgebung nicht erlaubt: ' + error.code);
    return;
  }
  try {
    const result = run();
    assert.equal(result.status, 2);
    assert.equal(result.json.status, 'ERROR');
    assert.ok(result.json.errors.some(message => /Symlink|Root-Grenze|verlaesst/.test(message)), result.stdout);
  } finally {
    fs.rmSync(link);
  }
});
