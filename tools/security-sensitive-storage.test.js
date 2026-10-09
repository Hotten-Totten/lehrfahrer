const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Apache und nginx sperren sensible Altpfade weiterhin', () => {
  const apache = source('.htaccess');
  for (const pattern of [/data\/drivers\\\.json/, /data\/trainings/, /fahrerunterlagen/, /linien\/test/]) {
    assert.match(apache, pattern);
  }
  assert.match(source('data/.htaccess'), /Require all denied/);
  assert.match(source('data/trainings/.htaccess'), /Require all denied/);
  assert.match(source('linien/test/.htaccess'), /Require all denied/);
  const nginx = source('deploy/hetzner/nginx-staging.conf');
  for (const route of ['/data/drivers.json', '/data/trainings/', '/fahrerunterlagen/']) {
    assert.ok(nginx.includes(route));
  }
});

test('versionierte Testlinien enthalten keine sensiblen Personaldateien', () => {
  const forbidden = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/^(?:drivers(?:\..*)?\.json|trainings?\.json|training_\d+\.json|paket\.json)$/i.test(entry.name)) {
        forbidden.push(path.relative(root, file));
      }
    }
  };
  visit(path.join(root, 'linien', 'test'));
  assert.deepEqual(forbidden, []);
});

test('Phase 4C nutzt nur privaten Tenant-Speicher, ohne Legacy-Migration', () => {
  const personnel = source('api/_tenant_personnel_storage.php');
  const packages = source('api/_driver_packages.php');
  assert.match(personnel, /lehrfahrer_route_authorize/);
  assert.match(personnel, /'drivers'/);
  assert.match(personnel, /'trainings'/);
  assert.match(personnel, /'documents'/);
  assert.match(packages, /'packages'/);
  for (const file of ['api/drivers.php', 'api/trainings.php', 'api/_driver_packages.php']) {
    assert.doesNotMatch(source(file), /lehrfahrer_migrate_private_/);
  }
  assert.match(source('api/_private_storage.php'), /Privater Datenspeicher darf nicht innerhalb des Webroots liegen/);
});

test('Paketantworten geben keine Dateisystem- oder Webpfade aus', () => {
  const create = source('api/create_driver_documents.php');
  const list = source('api/list_driver_packages.php');
  assert.ok(create.includes("'file' => $pdfName"));
  assert.ok(create.includes("'packagePath' => ''"));
  assert.ok(list.includes("'path' => ''"));
  assert.ok(list.includes("'packagePath' => ''"));
  assert.ok(!source('js/editor.driverDocuments.js').includes('link.href = documentInfo.path'));
});
