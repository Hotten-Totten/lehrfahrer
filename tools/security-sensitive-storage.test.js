const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function findPhp() {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function runPhp(php, code) {
  const result = spawnSync(php, ['-r', code], { encoding: null });
  assert.equal(result.status, 0, result.stderr?.toString('utf8'));
  return result.stdout;
}

function phpString(value) {
  return JSON.stringify(String(value).replaceAll('\\', '/'));
}

test('Apache und nginx sperren alle sensiblen Altpfade', () => {
  const apache = source('.htaccess');
  assert.match(apache, /data\/drivers\\\.json/);
  assert.match(apache, /data\/trainings/);
  assert.match(apache, /fahrerunterlagen/);
  assert.match(apache, /linien\/test/);
  assert.match(source('data/.htaccess'), /Require all denied/);
  assert.match(source('data/trainings/.htaccess'), /Require all denied/);
  assert.match(source('linien/test/.htaccess'), /Require all denied/);

  const nginx = source('deploy/hetzner/nginx-staging.conf');
  for (const route of ['/data/drivers.json', '/data/trainings/', '/fahrerunterlagen/']) {
    assert.ok(nginx.includes(route));
  }
});

test('versionierte Testlinien enthalten keine Fahrer-, Einweisungs- oder Paketdateien', () => {
  const testRoot = path.join(projectRoot, 'linien', 'test');
  const forbidden = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (/^(?:drivers(?:\..*)?\.json|trainings?\.json|training_\d+\.json|paket\.json)$/i.test(entry.name)) {
        forbidden.push(path.relative(projectRoot, entryPath));
      }
    }
  };
  visit(testRoot);
  assert.deepEqual(forbidden, []);
});

test('APIs verwenden ausschliesslich den privaten Speicherhelfer', () => {
  assert.ok(source('api/drivers.php').includes("lehrfahrer_private_storage_directory('personnel')"));
  assert.ok(source('api/trainings.php').includes("lehrfahrer_private_storage_directory('trainings')"));
  assert.ok(source('api/_driver_packages.php').includes("lehrfahrer_private_storage_directory('fahrerunterlagen')"));
  assert.ok(source('api/_private_storage.php').includes('Privater Datenspeicher darf nicht innerhalb des Webroots liegen.'));
});

test('Paketmetadaten geben keine oeffentlichen Dateipfade mehr aus', () => {
  const createSource = source('api/create_driver_documents.php');
  const listSource = source('api/list_driver_packages.php');
  assert.ok(createSource.includes("'file' => $pdfName"));
  assert.ok(createSource.includes("'packagePath' => ''"));
  assert.ok(listSource.includes("'path' => ''"));
  assert.ok(listSource.includes("'packagePath' => ''"));
  assert.ok(!source('js/editor.driverDocuments.js').includes('link.href = documentInfo.path'));
});

test('authentifizierte APIs migrieren und lesen Fahrer, Einweisungen und Pakete privat', t => {
  const php = findPhp();
  if (!php) return t.skip('PHP ist nicht verfuegbar.');

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-security-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const webroot = path.join(sandbox, 'webroot');
  const apiDir = path.join(webroot, 'api');
  const privateDir = path.join(sandbox, 'private');
  fs.mkdirSync(path.join(webroot, 'data', 'trainings'), { recursive: true });
  fs.mkdirSync(path.join(webroot, 'fahrerunterlagen', 'Fahrer', '2026-10-09_120000'), { recursive: true });
  fs.mkdirSync(apiDir, { recursive: true });

  for (const file of [
    '_auth.php', '_private_storage.php', '_driver_packages.php', 'drivers.php',
    'trainings.php', 'list_driver_packages.php', 'download_driver_package.php'
  ]) {
    fs.copyFileSync(path.join(projectRoot, 'api', file), path.join(apiDir, file));
  }

  fs.writeFileSync(path.join(webroot, 'data', 'drivers.json'), JSON.stringify([
    { id: 'drv_test', firstName: 'Erika', lastName: 'Muster', roles: ['Fahrer'] }
  ]));
  fs.writeFileSync(path.join(webroot, 'data', 'trainings', 'training_000001.json'), JSON.stringify({
    trainingId: 'training_000001', status: 'created', routes: []
  }));
  const packageDir = path.join(webroot, 'fahrerunterlagen', 'Fahrer', '2026-10-09_120000');
  fs.writeFileSync(path.join(packageDir, 'Linie_15.pdf'), '%PDF-security-test');
  fs.writeFileSync(path.join(packageDir, 'paket.json'), JSON.stringify({
    id: 'pkg_security_01', driverName: 'Erika Muster', documents: [
      { lineName: '15', path: 'fahrerunterlagen/Fahrer/2026-10-09_120000/Linie_15.pdf' }
    ]
  }));

  const bootstrap = [
    `putenv('LEHRFAHRER_API_TOKEN=security-test-token');`,
    `putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${phpString(privateDir)});`,
    `$_SERVER['DOCUMENT_ROOT'] = ${phpString(webroot)};`,
    `$_SERVER['REQUEST_METHOD'] = 'GET';`,
    `$_SERVER['HTTP_X_API_TOKEN'] = 'security-test-token';`
  ].join('');

  const drivers = JSON.parse(runPhp(php, `${bootstrap} require ${phpString(path.join(apiDir, 'drivers.php'))};`).toString('utf8'));
  assert.equal(drivers.ok, true);
  assert.equal(drivers.drivers[0].lastName, 'Muster');

  const trainings = JSON.parse(runPhp(php, `${bootstrap} require ${phpString(path.join(apiDir, 'trainings.php'))};`).toString('utf8'));
  assert.equal(trainings.ok, true);
  assert.equal(trainings.trainings[0].trainingId, 'training_000001');

  const packages = JSON.parse(runPhp(php, `${bootstrap} require ${phpString(path.join(apiDir, 'list_driver_packages.php'))};`).toString('utf8'));
  assert.equal(packages.ok, true);
  assert.equal(packages.packages[0].documents[0].file, 'Linie_15.pdf');
  assert.equal(packages.packages[0].documents[0].path, '');
  assert.equal(packages.packages[0].packagePath, '');

  const pdfBootstrap = `${bootstrap} $_GET['id']='pkg_security_01'; $_GET['document']='Linie_15.pdf';`;
  assert.equal(runPhp(php, `${pdfBootstrap} require ${phpString(path.join(apiDir, 'download_driver_package.php'))};`).toString('utf8'), '%PDF-security-test');

  assert.ok(fs.existsSync(path.join(privateDir, 'personnel', 'drivers.json')));
  assert.ok(fs.existsSync(path.join(privateDir, 'trainings', 'training_000001.json')));
  assert.ok(fs.existsSync(path.join(privateDir, 'fahrerunterlagen', 'Fahrer', '2026-10-09_120000', 'paket.json')));
  assert.ok(!fs.existsSync(path.join(webroot, 'data', 'drivers.json')));
  assert.ok(!fs.existsSync(path.join(webroot, 'data', 'trainings', 'training_000001.json')));
  assert.ok(!fs.existsSync(path.join(webroot, 'fahrerunterlagen', 'Fahrer', '2026-10-09_120000', 'paket.json')));
});
