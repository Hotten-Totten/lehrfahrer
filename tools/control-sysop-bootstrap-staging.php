<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT')) ?: dirname(__DIR__);
require_once $appRoot . '/api/_control_database.php';
require_once $appRoot . '/api/_auth_cutover_gate.php';

const LEHRFAHRER_SYSOP_BOOTSTRAP_LOGIN = 'cottbus-admin';
const LEHRFAHRER_SYSOP_BOOTSTRAP_OLD_NUMBER = 102;

function lehrfahrer_sysop_bootstrap_capabilities(): array {
    return ['platform.accounts.support', 'platform.audit.read',
        'platform.companies.manage', 'platform.maintenance.execute', 'platform.roles.manage',
        'platform.security.read', 'platform.system.manage', 'platform.system.read',
        'platform.tenant_context.open'];
}

function lehrfahrer_sysop_bootstrap_require(bool $condition, string $code): void {
    if (!$condition) throw new RuntimeException($code);
}

/** Read-only and exact: no account, role, or number is selected by proximity. */
function lehrfahrer_sysop_bootstrap_preflight(PDO $pdo): array {
    lehrfahrer_sysop_bootstrap_require(
        lehrfahrer_auth_cutover_state($pdo) === ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN'], 'AUTH_STATE');
    $query = $pdo->prepare("SELECT value FROM control_metadata WHERE `key` = 'environment'");
    $query->execute();
    lehrfahrer_sysop_bootstrap_require($query->fetchColumn() === 'staging', 'DATABASE_ENVIRONMENT');
    $query = $pdo->prepare('SELECT id, active, must_change_password FROM accounts WHERE login_normalized = ?');
    $query->execute([LEHRFAHRER_SYSOP_BOOTSTRAP_LOGIN]);
    $accounts = $query->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($accounts) === 1 && (int)$accounts[0]['active'] === 1
        && (int)$accounts[0]['must_change_password'] === 0, 'TARGET_ACCOUNT');
    $accountId = (string)$accounts[0]['id'];

    $memberships = $pdo->prepare('SELECT m.id, m.company_id, m.status, c.slug, c.status AS company_status
        FROM account_memberships m JOIN companies c ON c.id = m.company_id WHERE m.account_id = ?');
    $memberships->execute([$accountId]);
    $memberships = $memberships->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($memberships) === 1 && $memberships[0]['status'] === 'active'
        && $memberships[0]['company_status'] === 'active'
        && $memberships[0]['slug'] === 'cottbusverkehr', 'TARGET_MEMBERSHIP');
    $membership = $memberships[0];
    $roles = $pdo->prepare('SELECT r.code FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
        WHERE mr.membership_id = ? ORDER BY r.code');
    $roles->execute([(string)$membership['id']]);
    lehrfahrer_sysop_bootstrap_require($roles->fetchAll(PDO::FETCH_COLUMN) === ['ADMIN'], 'TARGET_TENANT_ROLE');

    lehrfahrer_sysop_bootstrap_require((int)$pdo->query('SELECT COUNT(*) FROM sysop_assignment')->fetchColumn() === 0,
        'SYSOP_ALREADY_ASSIGNED');
    lehrfahrer_sysop_bootstrap_require((int)$pdo->query('SELECT COUNT(*) FROM account_platform_roles')->fetchColumn() === 0,
        'PLATFORM_ROLE_ALREADY_ASSIGNED');
    $platformRoles = $pdo->query('SELECT id, code FROM platform_roles ORDER BY code')->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require($platformRoles === [
        ['id' => 'prole_cosysop', 'code' => 'COSYSOP'],
        ['id' => 'prole_sysop', 'code' => 'SYSOP']], 'PLATFORM_ROLE_DEFINITIONS');
    $platformCapabilities = $pdo->query("SELECT c.code FROM platform_role_capabilities rc
        JOIN platform_capabilities c ON c.id = rc.capability_id
        WHERE rc.role_id = 'prole_sysop' ORDER BY c.code")->fetchAll(PDO::FETCH_COLUMN);
    lehrfahrer_sysop_bootstrap_require($platformCapabilities === lehrfahrer_sysop_bootstrap_capabilities(),
        'SYSOP_CAPABILITIES');

    $numbers = $pdo->query('SELECT user_number, issued_to_account_id, current_account_id
        FROM account_user_numbers ORDER BY user_number')->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($numbers) === 3
        && array_map(static fn(array $row): int => (int)$row['user_number'], $numbers) === [101, 102, 103],
        'NUMBER_REGISTRY');
    $current = [];
    foreach ($numbers as $row) {
        lehrfahrer_sysop_bootstrap_require($row['current_account_id'] !== null
            && $row['current_account_id'] === $row['issued_to_account_id']
            && !isset($current[(string)$row['current_account_id']]), 'NUMBER_REGISTRY');
        $current[(string)$row['current_account_id']] = true;
    }
    lehrfahrer_sysop_bootstrap_require(count($current) === 3
        && (int)$pdo->query('SELECT COUNT(*) FROM accounts')->fetchColumn() === 3
        && (string)$numbers[1]['current_account_id'] === $accountId, 'NUMBER_REGISTRY');
    $smoke = $pdo->prepare('SELECT a.login_normalized FROM accounts a WHERE a.id = ?');
    $smoke->execute([(string)$numbers[2]['current_account_id']]);
    lehrfahrer_sysop_bootstrap_require($smoke->fetchColumn() === 'staging-driver-smoke', 'SMOKE_NUMBER');
    $allocator = $pdo->query('SELECT singleton_key, next_number FROM account_user_number_allocator')->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($allocator) === 1
        && (int)$allocator[0]['singleton_key'] === 1 && (int)$allocator[0]['next_number'] === 104,
        'NUMBER_ALLOCATOR');
    return ['accountId' => $accountId, 'companyId' => (string)$membership['company_id'],
        'membershipId' => (string)$membership['id'], 'oldNumber' => LEHRFAHRER_SYSOP_BOOTSTRAP_OLD_NUMBER];
}

/** Validate the complete post-state before commit and on every subsequent read-only check. */
function lehrfahrer_sysop_bootstrap_postcheck(PDO $pdo, string $accountId): array {
    $target = $pdo->prepare('SELECT id, active FROM accounts WHERE login_normalized = ?');
    $target->execute([LEHRFAHRER_SYSOP_BOOTSTRAP_LOGIN]);
    $targets = $target->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($targets) === 1 && (string)$targets[0]['id'] === $accountId
        && (int)$targets[0]['active'] === 1, 'TARGET_ACCOUNT');
    $rows = $pdo->query('SELECT singleton_key, account_id FROM sysop_assignment')->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($rows) === 1 && (int)$rows[0]['singleton_key'] === 1
        && (string)$rows[0]['account_id'] === $accountId, 'SYSOP_SINGLETON');
    $numbers = $pdo->query('SELECT user_number, issued_to_account_id, current_account_id FROM account_user_numbers
        ORDER BY user_number')->fetchAll(PDO::FETCH_ASSOC);
    lehrfahrer_sysop_bootstrap_require(count($numbers) === 4
        && (int)$numbers[0]['user_number'] === 1 && $numbers[0]['issued_to_account_id'] === $accountId
        && $numbers[0]['current_account_id'] === $accountId
        && (int)$numbers[1]['user_number'] === 101
        && $numbers[1]['issued_to_account_id'] === $numbers[1]['current_account_id']
        && (int)$numbers[2]['user_number'] === 102 && $numbers[2]['issued_to_account_id'] === $accountId
        && $numbers[2]['current_account_id'] === null
        && (int)$numbers[3]['user_number'] === 103
        && $numbers[3]['issued_to_account_id'] === $numbers[3]['current_account_id'], 'NUMBER_REGISTRY');
    $smoke = $pdo->prepare('SELECT login_normalized FROM accounts WHERE id = ?');
    $smoke->execute([(string)$numbers[3]['current_account_id']]);
    lehrfahrer_sysop_bootstrap_require($smoke->fetchColumn() === 'staging-driver-smoke', 'SMOKE_NUMBER');
    lehrfahrer_sysop_bootstrap_require(lehrfahrer_control_user_number_for_account($pdo, $accountId) === 1
        && (int)$pdo->query('SELECT next_number FROM account_user_number_allocator WHERE singleton_key = 1')->fetchColumn() === 104
        && (int)$pdo->query('SELECT COUNT(*) FROM account_platform_roles')->fetchColumn() === 0,
        'NUMBER_OR_PLATFORM_STATE');
    $membershipCount = $pdo->prepare('SELECT COUNT(*) FROM account_memberships WHERE account_id = ?');
    $membershipCount->execute([$accountId]);
    lehrfahrer_sysop_bootstrap_require((int)$membershipCount->fetchColumn() === 1, 'TENANT_MEMBERSHIP');
    $roles = $pdo->prepare('SELECT r.code FROM account_memberships m
        JOIN companies c ON c.id = m.company_id JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id WHERE m.account_id = ? AND m.status = ?
        AND c.status = ? AND c.slug = ? ORDER BY r.code');
    $roles->execute([$accountId, 'active', 'active', 'cottbusverkehr']);
    lehrfahrer_sysop_bootstrap_require($roles->fetchAll(PDO::FETCH_COLUMN) === ['ADMIN'], 'TENANT_ROLE');
    require_once (trim((string)getenv('LEHRFAHRER_APP_ROOT')) ?: dirname(__DIR__)) . '/api/_account_auth.php';
    $platform = lehrfahrer_account_platform_capabilities($pdo, $accountId);
    lehrfahrer_sysop_bootstrap_require($platform === lehrfahrer_sysop_bootstrap_capabilities()
        && !in_array('drivers.manage', $platform, true)
        && !in_array('trainings.manage', $platform, true)
        && !in_array('packages.manage', $platform, true), 'PLATFORM_CAPABILITIES');
    return ['accountId' => $accountId, 'userNumber' => 1,
        'retiredNumber' => 102, 'platformCapabilities' => $platform];
}

function lehrfahrer_sysop_bootstrap_apply(PDO $pdo): array {
    return lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo): array {
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        if ($mysql) {
            $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
            $pdo->beginTransaction();
        }
        try {
            $preflight = lehrfahrer_sysop_bootstrap_preflight($pdo);
            $accountId = $preflight['accountId'];
            $retire = $pdo->prepare('UPDATE account_user_numbers SET current_account_id = NULL
                WHERE user_number = 102 AND issued_to_account_id = ? AND current_account_id = ?');
            $retire->execute([$accountId, $accountId]);
            lehrfahrer_sysop_bootstrap_require($retire->rowCount() === 1, 'RETIRE_00102');
            $assign = $pdo->prepare('INSERT INTO account_user_numbers
                (user_number, issued_to_account_id, current_account_id, issued_at) VALUES (1, ?, ?, ?)');
            $assign->execute([$accountId, $accountId, gmdate('c')]);
            $sysop = $pdo->prepare('INSERT INTO sysop_assignment
                (singleton_key, account_id, assigned_at) VALUES (1, ?, ?)');
            $sysop->execute([$accountId, gmdate('c')]);
            $sessions = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
                WHERE account_id = ? AND environment = ? AND revoked_at IS NULL');
            $sessions->execute([gmdate('c'), $accountId, 'staging']);
            $verified = lehrfahrer_sysop_bootstrap_postcheck($pdo, $accountId);
            if ($mysql) $pdo->commit();
            return $verified + ['revokedSessions' => $sessions->rowCount()];
        } catch (Throwable $error) {
            if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    });
}

if (getenv('LEHRFAHRER_SYSOP_BOOTSTRAP_RUN') === '1') {
    if (!in_array(PHP_SAPI, ['cli', 'cgi-fcgi'], true) || isset($_SERVER['REQUEST_METHOD'])
        || lehrfahrer_environment() !== 'staging' || lehrfahrer_control_database_driver() !== 'mysql') exit(2);
    $action = (string)getenv('LEHRFAHRER_SYSOP_BOOTSTRAP_ACTION');
    if (!in_array($action, ['preflight', 'apply', 'verify'], true)) exit(2);
    try {
        $configuration = lehrfahrer_control_mysql_configuration();
        $pdo = new PDO($configuration['dsn'], $configuration['user'], $configuration['password'], $configuration['options']);
        if ($action === 'preflight') {
            $pdo->exec('SET SESSION TRANSACTION READ ONLY');
            $pdo->beginTransaction();
            $result = lehrfahrer_sysop_bootstrap_preflight($pdo);
            $pdo->rollBack();
            echo json_encode(['ok' => true, 'targetNumber' => 102, 'sysopAssignments' => 0,
                'company' => 'cottbusverkehr', 'auth' => ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN']], JSON_THROW_ON_ERROR) . "\n";
        } elseif ($action === 'apply') {
            $result = lehrfahrer_sysop_bootstrap_apply($pdo);
            echo json_encode(['ok' => true, 'userNumber' => $result['userNumber'],
                'retiredNumber' => $result['retiredNumber'], 'platformCapabilities' => count($result['platformCapabilities']),
                'revokedSessions' => $result['revokedSessions']], JSON_THROW_ON_ERROR) . "\n";
        } else {
            $account = $pdo->prepare('SELECT id FROM accounts WHERE login_normalized = ?');
            $account->execute([LEHRFAHRER_SYSOP_BOOTSTRAP_LOGIN]);
            $id = $account->fetchColumn();
            lehrfahrer_sysop_bootstrap_require(is_string($id), 'TARGET_ACCOUNT');
            $result = lehrfahrer_sysop_bootstrap_postcheck($pdo, $id);
            echo json_encode(['ok' => true, 'userNumber' => $result['userNumber'],
                'retiredNumber' => $result['retiredNumber'], 'platformCapabilities' => count($result['platformCapabilities']),
                'auth' => lehrfahrer_auth_cutover_state($pdo)], JSON_THROW_ON_ERROR) . "\n";
        }
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        file_put_contents('php://stderr', 'SysOp-Bootstrap: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
