const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, after } = require('node:test');

const root = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-user-numbers-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const q = value => JSON.stringify(String(value).replaceAll('\\', '/'));
const dbPath = path.join(folder, 'numbers.sqlite');
const setup = `
require ${q(path.join(root, 'api', '_control_database.php'))};
$pdo = new PDO('sqlite:' . ${q(dbPath)}, null, null,
  [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 5000');
`;
const run = (code, expected = 0) => {
  const result = spawnSync(php, ['-r', setup + code], { encoding: 'utf8' });
  assert.equal(result.status, expected, result.stderr);
  return result.stdout.trim();
};
const insert = (id, created = '2025-01-01T00:00:00Z') => `
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
 VALUES (?,?,?,?,1,0,?,?)')->execute([${q(id)},${q(id)},${q(id)},'hash',${q(created)},${q(created)}]);`;
const rejected = sql => `try { $pdo->exec(${q(sql)}); echo 'NO'; } catch (Throwable $e) { echo 'YES'; }`;

test('deterministic backfill, reserved range and idempotent migration', () => {
  run('lehrfahrer_control_migrate($pdo); ' + insert('second', '2025-02-01') + insert('first', '2025-01-01'));
  run(`$pdo->exec('DELETE FROM schema_migrations WHERE version=6');
    lehrfahrer_control_migrate($pdo);
    echo json_encode([$pdo->query('SELECT issued_to_account_id,user_number FROM account_user_numbers ORDER BY user_number')->fetchAll(),
      $pdo->query('SELECT next_number FROM account_user_number_allocator')->fetchColumn(),
      $pdo->query('SELECT COUNT(*) FROM sysop_assignment')->fetchColumn(),
      $pdo->query('SELECT COUNT(*) FROM account_platform_roles')->fetchColumn()]);`);
  const data = JSON.parse(run(`lehrfahrer_control_migrate($pdo);
    echo json_encode([$pdo->query('SELECT issued_to_account_id,user_number FROM account_user_numbers ORDER BY user_number')->fetchAll(),
      $pdo->query('SELECT next_number FROM account_user_number_allocator')->fetchColumn()]);`));
  assert.deepEqual(data[0].map(row => [row.issued_to_account_id, Number(row.user_number)]), [['first', 101], ['second', 102]]);
  assert.equal(Number(data[1]), 103);
});

test('allocation is transactional, unique and never enters reserved range', () => {
  const result = run(`lehrfahrer_control_migrate($pdo); $pdo->beginTransaction(); ${insert('third')}
    $number = lehrfahrer_control_allocate_user_number($pdo, 'third'); $pdo->commit();
    echo json_encode([$number, lehrfahrer_control_format_user_number($number),
      lehrfahrer_control_user_number_for_account($pdo, 'third')]);`);
  assert.deepEqual(JSON.parse(result), [103, '00103', 103]);
  assert.equal(run(rejected("INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at) VALUES (103,'other','first','now')")), 'YES');
  assert.equal(run(rejected('DELETE FROM account_user_numbers WHERE user_number=103')), 'YES');
  assert.equal(run(rejected('UPDATE account_user_numbers SET user_number=104 WHERE user_number=103')), 'YES');
  assert.equal(run(rejected("UPDATE account_user_numbers SET issued_to_account_id='other' WHERE user_number=103")), 'YES');
  assert.equal(run(rejected("UPDATE account_user_numbers SET current_account_id='first' WHERE user_number=103")), 'YES');
  assert.equal(run(`echo json_encode([lehrfahrer_control_format_user_number(1),lehrfahrer_control_format_user_number(9999),
    lehrfahrer_control_format_user_number(99999),lehrfahrer_control_format_user_number(100000)]);`),
  '["00001","09999","99999","100000"]');
});

test('deactivation and deletion never recycle consumed numbers', () => {
  const result = JSON.parse(run(`$pdo->exec("UPDATE accounts SET active=0, display_name='Anonymisiert' WHERE id='third'");
    $before=lehrfahrer_control_user_number_for_account($pdo,'third');
    $pdo->exec("DELETE FROM accounts WHERE id='third'");
    $historical=$pdo->query("SELECT issued_to_account_id,current_account_id FROM account_user_numbers WHERE user_number=103")->fetch();
    $pdo->beginTransaction(); ${insert('fourth')}
    $next=lehrfahrer_control_allocate_user_number($pdo,'fourth'); $pdo->commit();
    echo json_encode([$before,$historical,$next]);`));
  assert.equal(result[0], 103);
  assert.deepEqual(result[1], { issued_to_account_id: 'third', current_account_id: null });
  assert.equal(result[2], 104);
  assert.equal(run(rejected("UPDATE account_user_numbers SET current_account_id='fourth' WHERE user_number=103")), 'YES');
});

test('allocator crosses five-digit display boundary', () => {
  const result = JSON.parse(run(`$pdo->exec('UPDATE account_user_number_allocator SET next_number=99999');
    $pdo->beginTransaction(); ${insert('high1')}
    $a=lehrfahrer_control_allocate_user_number($pdo,'high1'); ${insert('high2')}
    $b=lehrfahrer_control_allocate_user_number($pdo,'high2'); $pdo->commit();
    echo json_encode([lehrfahrer_control_format_user_number($a),lehrfahrer_control_format_user_number($b)]);`));
  assert.deepEqual(result, ['99999', '100000']);
});

test('concurrent transactions allocate distinct numbers', async () => {
  const worker = id => new Promise((resolve, reject) => {
    const code = setup + `lehrfahrer_control_migrate($pdo); $pdo->beginTransaction(); ${insert(id)}
      $n=lehrfahrer_control_allocate_user_number($pdo,${q(id)}); usleep(150000); $pdo->commit(); echo $n;`;
    const proc = spawn(php, ['-r', code]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', data => { stdout += data; });
    proc.stderr.on('data', data => { stderr += data; });
    proc.on('close', code => code === 0 ? resolve(Number(stdout)) : reject(new Error(stderr)));
  });
  const numbers = await Promise.all([worker('parallel-a'), worker('parallel-b')]);
  assert.equal(new Set(numbers).size, 2);
  assert.ok(numbers.every(number => number >= 101));
});

test('future reserved-number promotion has a path without recycling old number', () => {
  const result = JSON.parse(run(`$pdo->beginTransaction();
    $old=lehrfahrer_control_user_number_for_account($pdo,'first');
    $pdo->prepare('UPDATE account_user_numbers SET current_account_id=NULL WHERE user_number=?')->execute([$old]);
    $pdo->prepare('INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at)
      VALUES (1,?,?,?)')->execute(['first','first',gmdate('c')]);
    $pdo->commit(); echo json_encode([$old,lehrfahrer_control_user_number_for_account($pdo,'first'),
      $pdo->query('SELECT issued_to_account_id FROM account_user_numbers WHERE user_number=101')->fetchColumn()]);`));
  assert.deepEqual(result, [101, 1, 'first']);
  // This is an isolated SQLite fixture, never a staging or production assignment.
});
