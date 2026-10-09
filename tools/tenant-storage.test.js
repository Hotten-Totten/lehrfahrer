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
const companyA = 'cmp_' + 'a'.repeat(32);
const companyB = 'cmp_' + 'b'.repeat(32);
const companyC = 'cmp_' + 'c'.repeat(32);
const companyD = 'cmp_' + 'd'.repeat(32);
const companyE = 'cmp_' + 'e'.repeat(32);
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
      lehrfahrer_tenant_root(${phpString(companyA)}),
      lehrfahrer_tenant_root(${phpString(companyB)}),
      lehrfahrer_tenant_path(${phpString(companyA)}, 'lines', 'route-1.json')
    ]);
  `);
  assert.equal(path.resolve(result[0]), path.join(privateRoot, 'companies', companyA));
  assert.equal(path.resolve(result[1]), path.join(privateRoot, 'companies', companyB));
  assert.equal(path.resolve(result[2]), path.join(privateRoot, 'companies', companyA, 'lines', 'route-1.json'));
  assert.ok(outside(webroot, result[0]));
  assert.equal(fs.existsSync(path.join(privateRoot, 'companies')), false);
});

test('ungueltige und ueberlaufende company_id werden abgewiesen', () => {
  const result = runPhp(`
    $values = ['0', '01', 'cmp_', 'cmp_' . str_repeat('a', 31),
      'cmp_' . str_repeat('a', 33), 'CMP_' . str_repeat('a', 32),
      'cmp_' . str_repeat('g', 32), 'cmp_' . str_repeat('a', 32) . '/..',
      '../' . str_repeat('a', 32), 'cmp_%61', 'cmp_%2561', 'abc'];
    $rejected = [];
    foreach ($values as $value) {
      try { lehrfahrer_tenant_root($value); $rejected[] = false; }
      catch (InvalidArgumentException $error) { $rejected[] = true; }
    }
    echo json_encode($rejected);
  `);
  assert.deepEqual(result, Array(12).fill(true));
});

test('nur die neun festgelegten Bereiche sind erlaubt', () => {
  const result = runPhp(`
    $areas = LEHRFAHRER_TENANT_AREAS;
    try { lehrfahrer_tenant_area(${phpString(companyA)}, 'other'); $rejected = false; }
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
      try { lehrfahrer_tenant_path(${phpString(companyA)}, 'lines', $relative); $rejected[] = false; }
      catch (InvalidArgumentException $error) { $rejected[] = true; }
    }
    echo json_encode($rejected);
  `);
  assert.deepEqual(result, Array(invalid.length + 1).fill(true));
});

test('Tenant A kann weder Tenant B noch die Root-Grenze aufloesen', () => {
  const result = runPhp(`
    echo json_encode([
      lehrfahrer_tenant_path(${phpString(companyA)}, 'lines', 'nested/route.json'),
      lehrfahrer_tenant_path(${phpString(companyB)}, 'lines', 'nested/route.json')
    ]);
  `);
  const tenantA = path.join(privateRoot, 'companies', companyA);
  const tenantB = path.join(privateRoot, 'companies', companyB);
  assert.ok(!outside(tenantA, result[0]));
  assert.ok(!outside(tenantB, result[1]));
  assert.ok(outside(tenantA, result[1]));
  assert.ok(outside(tenantB, result[0]));
});

test('Verzeichnisse werden nur auf Anforderung und privat angelegt', () => {
  const result = runPhp(`
    echo json_encode([
      lehrfahrer_tenant_root(${phpString(companyC)}, true),
      lehrfahrer_tenant_area(${phpString(companyC)}, 'documents', true),
      lehrfahrer_tenant_ensure_directory(${phpString(companyC)}, 'documents', 'nested/deep'),
      lehrfahrer_tenant_path(${phpString(companyC)}, 'documents', 'another/file.pdf', true)
    ]);
  `);
  for (const directory of [result[0], result[1], result[2], path.dirname(result[3])]) {
    assert.ok(fs.statSync(directory).isDirectory());
    assert.ok(!outside(path.join(privateRoot, 'companies', companyC), directory));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    }
  }
  assert.equal(fs.existsSync(result[3]), false);
});

test('Symlinks auf fremde Roots werden auch bei vorhandenen Dateien abgewiesen', t => {
  const tenantA = path.join(privateRoot, 'companies', companyD, 'lines');
  const tenantB = path.join(privateRoot, 'companies', companyE, 'lines');
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
    try { lehrfahrer_tenant_path(${phpString(companyD)}, 'lines', 'escape/secret.json'); $blocked = false; }
    catch (RuntimeException $error) { $blocked = true; }
    echo json_encode($blocked);
  `);
  assert.equal(result, true);
});
