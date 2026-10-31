<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
require_once __DIR__ . '/control-account-preflight.php';

/** The caller owns the connection; all target writes and verification share one transaction. */
function lehrfahrer_control_migrate_accounts(PDO $pdo, ?callable $afterAccount = null,
    bool $requireStagingBaseline = false): array {
    $driver = lehrfahrer_control_driver($pdo);
    if ($driver === 'mysql') $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    $pdo->beginTransaction();
    try {
        if ($driver === 'mysql') {
            $environment = $pdo->query("SELECT value FROM control_metadata WHERE `key` = 'environment' FOR UPDATE")->fetchColumn();
            if ($environment !== 'staging') throw new RuntimeException('Datenbank ist nicht Staging.');
        }
        $preflight = lehrfahrer_control_account_preflight_read($pdo, $driver);
        if (($preflight['status'] ?? '') !== 'PASS'
            || ($preflight['counts']['legacyUsers'] ?? -1) !== 2
            || ($preflight['counts']['plannedMembershipRoles'] ?? -1) !== 2
            || ($preflight['company']['valid'] ?? -1) !== 2
            || ($preflight['company']['inactive'] ?? -1) !== 0
            || ($preflight['roles']['orphanUser'] ?? -1) !== 0
            || ($preflight['roles']['orphanRole'] ?? -1) !== 0
            || ($preflight['password']['present'] ?? -1) !== 2
            || ($preflight['password']['active'] ?? -1) !== 2
            || ($preflight['activation']['open'] ?? -1) !== 0
            || ($preflight['sessions']['currentlyValid'] ?? -1) !== 0) {
            throw new RuntimeException('Vorprüfung weicht vom freigegebenen Bestand ab.');
        }
        if ($requireStagingBaseline && (
            ($preflight['password']['mustChange'] ?? -1) !== 0
            || ($preflight['password']['blockedUntilSet'] ?? -1) !== 0
            || ($preflight['password']['lastLoginSet'] ?? -1) !== 2
            || ($preflight['activation']['total'] ?? -1) !== 1
            || ($preflight['activation']['used'] ?? -1) !== 1)) {
            throw new RuntimeException('Staging-Bestand hat sich gegenüber P1.2 geändert.');
        }
        $users = $pdo->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $oldRoles = $pdo->query('SELECT ur.user_id, ur.role_id FROM user_roles ur ORDER BY ur.user_id, ur.role_id')->fetchAll(PDO::FETCH_ASSOC);
        $insertAccount = $pdo->prepare('INSERT INTO accounts
            (id, login_normalized, email_normalized, display_name, password_hash, active,
             must_change_password, last_login, blocked_until, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $insertMembership = $pdo->prepare('INSERT INTO account_memberships
            (id, account_id, company_id, status, legacy_user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)');
        $insertRole = $pdo->prepare('INSERT INTO membership_roles (membership_id, role_id) VALUES (?, ?)');
        $accountIds = [];
        $membershipIds = [];
        foreach ($users as $user) {
            $userId = (string)$user['id'];
            $accountId = lehrfahrer_control_id('acc');
            $membershipId = lehrfahrer_control_id('mem');
            $insertAccount->execute([$accountId, $user['login_normalized'], $user['email_normalized'],
                $user['display_name'], $user['password_hash'], (int)$user['active'],
                (int)$user['must_change_password'], $user['last_login'], $user['blocked_until'],
                $user['created_at'], $user['updated_at']]);
            if ($afterAccount !== null) $afterAccount($pdo, $userId);
            $insertMembership->execute([$membershipId, $accountId, $user['company_id'],
                (int)$user['active'] === 1 ? 'active' : 'inactive', $userId,
                $user['created_at'], $user['updated_at']]);
            $accountIds[$userId] = $accountId;
            $membershipIds[$userId] = $membershipId;
        }
        foreach ($oldRoles as $role) $insertRole->execute([$membershipIds[(string)$role['user_id']], $role['role_id']]);
        $validated = lehrfahrer_control_validate_account_copy($pdo);
        if (!$validated['valid']) throw new RuntimeException('Alt-Neu-Vergleich fehlgeschlagen.');
        $pdo->commit();
        return ['status' => 'MIGRIERT', 'counts' => $validated['counts'], 'validated' => true];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

/** Compare every legacy identity and role without returning any personal or secret values. */
function lehrfahrer_control_validate_account_copy(PDO $pdo): array {
    $users = $pdo->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $accounts = $pdo->query('SELECT * FROM accounts')->fetchAll(PDO::FETCH_ASSOC);
    $memberships = $pdo->query('SELECT * FROM account_memberships')->fetchAll(PDO::FETCH_ASSOC);
    $oldRoles = $pdo->query('SELECT user_id, role_id FROM user_roles ORDER BY user_id, role_id')->fetchAll(PDO::FETCH_ASSOC);
    $newRoles = $pdo->query('SELECT membership_id, role_id FROM membership_roles ORDER BY membership_id, role_id')->fetchAll(PDO::FETCH_ASSOC);
    $counts = ['users' => count($users), 'accounts' => count($accounts),
        'memberships' => count($memberships), 'legacyRoles' => count($oldRoles),
        'membershipRoles' => count($newRoles)];
    $emptyTables = ['account_platform_roles', 'sysop_assignment', 'account_sessions', 'account_activation_tokens'];
    foreach ($emptyTables as $table) $counts[$table] = (int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
    $valid = $counts['users'] === $counts['accounts'] && $counts['users'] === $counts['memberships']
        && $counts['legacyRoles'] === $counts['membershipRoles'];
    foreach ($emptyTables as $table) $valid = $valid && $counts[$table] === 0;
    $accountsById = [];
    foreach ($accounts as $account) $accountsById[(string)$account['id']] = $account;
    $membersByLegacy = [];
    foreach ($memberships as $membership) {
        $legacyId = (string)($membership['legacy_user_id'] ?? '');
        if ($legacyId === '' || isset($membersByLegacy[$legacyId])) $valid = false;
        $membersByLegacy[$legacyId] = $membership;
    }
    $rolesByUser = [];
    foreach ($oldRoles as $row) $rolesByUser[(string)$row['user_id']][] = (string)$row['role_id'];
    $rolesByMember = [];
    foreach ($newRoles as $row) $rolesByMember[(string)$row['membership_id']][] = (string)$row['role_id'];
    $usedAccounts = [];
    foreach ($users as $user) {
        $membership = $membersByLegacy[(string)$user['id']] ?? null;
        $account = $membership === null ? null : ($accountsById[(string)$membership['account_id']] ?? null);
        if ($membership === null || $account === null) { $valid = false; continue; }
        $accountId = (string)$account['id'];
        if (isset($usedAccounts[$accountId])) $valid = false;
        $usedAccounts[$accountId] = true;
        foreach (['login_normalized', 'email_normalized', 'display_name', 'password_hash',
                  'active', 'must_change_password', 'last_login', 'blocked_until',
                  'created_at', 'updated_at'] as $field) {
            if ((string)($account[$field] ?? '') !== (string)($user[$field] ?? '')) $valid = false;
        }
        if ((string)$membership['company_id'] !== (string)$user['company_id']
            || (string)$membership['status'] !== ((int)$user['active'] === 1 ? 'active' : 'inactive')
            || (string)$membership['created_at'] !== (string)$user['created_at']
            || (string)$membership['updated_at'] !== (string)$user['updated_at']) $valid = false;
        $expectedRoles = $rolesByUser[(string)$user['id']] ?? [];
        $actualRoles = $rolesByMember[(string)$membership['id']] ?? [];
        sort($expectedRoles, SORT_STRING); sort($actualRoles, SORT_STRING);
        if ($expectedRoles !== $actualRoles) $valid = false;
    }
    return ['valid' => $valid, 'counts' => $counts];
}

if (getenv('LEHRFAHRER_ACCOUNT_MIGRATE_RUN') === '1') {
    if (!in_array(PHP_SAPI, ['cli', 'cgi-fcgi'], true) || isset($_SERVER['REQUEST_METHOD'])
        || lehrfahrer_environment() !== 'staging') exit(2);
    try {
        if (lehrfahrer_control_database_driver() !== 'mysql') throw new RuntimeException('Dialekt');
        $configuration = lehrfahrer_control_mysql_configuration();
        $pdo = new PDO($configuration['dsn'], $configuration['user'], $configuration['password'], $configuration['options']);
        $result = lehrfahrer_control_migrate_accounts($pdo, null, true);
        $postCommit = lehrfahrer_control_validate_account_copy($pdo);
        if (!$postCommit['valid'] || $postCommit['counts'] !== $result['counts']) {
            throw new RuntimeException('Nachprüfung fehlgeschlagen.');
        }
        $result['postCommitValidated'] = true;
        echo json_encode($result, JSON_THROW_ON_ERROR), "\n";
    } catch (Throwable $error) {
        file_put_contents('php://stderr', "Account-Migration blockiert oder fehlgeschlagen.\n");
        exit(2);
    }
}
