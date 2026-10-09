const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-tenant-storage-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
fs.mkdirSync(webroot);
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function findPhp() {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('PHP ist fuer den Tenant-Storage-Test erforderlich.');
}

const php = findPhp();
const phpString = value => JSON.stringify(String(value).replaceAll('\\', '/'));

function runPhp(code) {
  const setup = `
    putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${phpString(privateRoot)});
    $_SERVER['DOCUMENT_ROOT'] = ${phpString(webroot)};
    require ${phpString(path.join(projectRoot, 'api', '_tenant_storage.php'))};
  `;
  const result = spawnSync(php, ['-r', setup + code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function outside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

test('gueltige IDs liefern getrennte Roots ausserhalb des Webroots', () => {
  const result = runPhp(`
    echo json_encode([
      lehrfahrer_tenant_root(1),
      lehrfahrer_tenant_root('2'),
      lehrfahrer_tenant_path(1, 'lines', 'route-1.json')
    ]);
  `);
  assert.equal(path.resolve(result[0]), path.join(privateRoot, 'companies', '1'));
  assert.equal(path.resolve(result[1]), path.join(privateRoot, 'companies', '2'));
  assert.equal(path.resolve(result[2]), path.join(privateRoot, 'companies', '1', 'lines', 'route-1.json'));
  assert.ok(outside(webroot, result[0]));
  assert.equal(fs.existsSync(path.join(privateRoot, 'companies')), false);
});

test('ungueltige und ueberlaufende company_id werden abgewiesen', () => {
  const result = runPhp(`
    $values = [0, -1, '0', '01', '1/2', '../2', '2%2f3', '999999999999999999999999', 'abc'];
    $rejected = [];
    foreach ($values as $value) {
      try { lehrfahrer_tenant_root($value); $rejected[] = false; }
      catch (InvalidArgumentException $error) { $rejected[] = true; }
    }
    echo json_encode($rejected);
  `);
  assert.deepEqual(result, Array(9).fill(true));
});

test('nur die neun festgelegten Bereiche sind erlaubt', () => {
  const result = runPhp(`
    $areas = LEHRFAHRER_TENANT_AREAS;
    try { lehrfahrer_tenant_area(1, 'other'); $rejected = false; }
    catch (InvalidArgumentException $error) { $rejected = true; }
    echo json_encode([$areas, $rejected]);
  `);
  assert.deepEqual(result[0], [
    'lines', 'cities', 'drivers', 'trainings', 'packages',
    'documents', 'catalogs', 'settings', 'imports'
  ]);
  assert.equal(result[1], true);
});

test('Traversal, absolute und kodierte Pfade sowie Sonderzeichen werden abgewiesen', () => {
  const invalid = [
    '../other', 'a/../other', '..\\other', '%2e%2e/other',
    '%252e%252e/other', '/etc/passwd', 'C:\\Windows\\secret',
    '//server/share', 'a//b', 'a/./b', 'a%2fb', 'a:b',
    'a?b', 'a#b', 'a b', 'ä', '', 'a\\b'
  ];
  const result = runPhp(`
    $paths = json_decode(${phpString(JSON.stringify(invalid))}, true);
    $paths[] = "a\\0b";
    $rejected = [];
    foreach ($paths as $relative) {
      try { lehrfahrer_tenant_path(1, 'lines', $relative); $rejected[] = false; }
      catch (InvalidArgumentException $error) { $rejected[] = true; }
    }
    echo json_encode($rejected);
  `);
  assert.deepEqual(result, Array(invalid.length + 1).fill(true));
});

test('Tenant A kann weder Tenant B noch die Root-Grenze aufloesen', () => {
  const result = runPhp(`
    echo json_encode([
      lehrfahrer_tenant_path(1, 'lines', 'nested/route.json'),
      lehrfahrer_tenant_path(2, 'lines', 'nested/route.json')
    ]);
  `);
  const tenantA = path.join(privateRoot, 'companies', '1');
  const tenantB = path.join(privateRoot, 'companies', '2');
  assert.ok(!outside(tenantA, result[0]));
  assert.ok(!outside(tenantB, result[1]));
  assert.ok(outside(tenantA, result[1]));
  assert.ok(outside(tenantB, result[0]));
});

test('Verzeichnisse werden nur auf Anforderung und privat angelegt', () => {
  const result = runPhp(`
    echo json_encode([
      lehrfahrer_tenant_root(3, true),
      lehrfahrer_tenant_area(3, 'documents', true),
      lehrfahrer_tenant_ensure_directory(3, 'documents', 'nested/deep'),
      lehrfahrer_tenant_path(3, 'documents', 'another/file.pdf', true)
    ]);
  `);
  for (const directory of [result[0], result[1], result[2], path.dirname(result[3])]) {
    assert.ok(fs.statSync(directory).isDirectory());
    assert.ok(!outside(path.join(privateRoot, 'companies', '3'), directory));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    }
  }
  assert.equal(fs.existsSync(result[3]), false);
});

test('Symlinks auf fremde Roots werden auch bei vorhandenen Dateien abgewiesen', t => {
  const tenantA = path.join(privateRoot, 'companies', '4', 'lines');
  const tenantB = path.join(privateRoot, 'companies', '5', 'lines');
  fs.mkdirSync(tenantA, { recursive: true });
  fs.mkdirSync(tenantB, { recursive: true });
  const link = path.join(tenantA, 'escape');
  try {
    fs.symlinkSync(tenantB, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip('Symlink/Junction in dieser Testumgebung nicht erlaubt: ' + error.code);
    return;
  }
  const result = runPhp(`
    try { lehrfahrer_tenant_path(4, 'lines', 'escape/secret.json'); $blocked = false; }
    catch (RuntimeException $error) { $blocked = true; }
    echo json_encode($blocked);
  `);
  assert.equal(result, true);
});
