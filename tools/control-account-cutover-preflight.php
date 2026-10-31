<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT')) ?: dirname(__DIR__);
require_once $appRoot . '/api/_control_database.php';
require_once $appRoot . '/api/_control_repositories.php';
require_once $appRoot . '/api/_auth_cutover_gate.php';

/** Read-only check of the already migrated account inventory. No identity values leave this function. */
function lehrfahrer_account_cutover_preflight(PDO $pdo): array {
    $findings = [];
    $add = static function (string $level, string $code) use (&$findings): void {
        $findings[] = ['level' => $level, 'code' => $code];
    };
    $count = static fn(string $table): int => (int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
    $version = (int)$pdo->query('SELECT COALESCE(MAX(version),0) FROM schema_migrations')->fetchColumn();
    if ($version !== LEHRFAHRER_CONTROL_SCHEMA_VERSION) $add('BLOCKER', 'SCHEMA_VERSION');
    $environment = $pdo->query("SELECT value FROM control_metadata WHERE `key` = 'environment'")->fetchColumn();
    if ($environment !== 'staging' && lehrfahrer_environment() === 'staging') $add('BLOCKER', 'ENVIRONMENT');
    $auth = lehrfahrer_auth_cutover_state($pdo);
    $expectedMode = (string)getenv('LEHRFAHRER_CUTOVER_PREFLIGHT_EXPECT_MODE');
    if ($expectedMode === '') $expectedMode = 'PARALLEL';
    if (!in_array($expectedMode, ['PARALLEL', 'ACCOUNT_PRIMARY', 'ANY'], true)
        || $auth['lock'] !== 'OPEN'
        || ($expectedMode !== 'ANY' && $auth['mode'] !== $expectedMode)) $add('BLOCKER', 'AUTH_STATE');

    $tables = ['users', 'user_roles', 'companies', 'roles', 'capabilities', 'role_capabilities',
        'accounts', 'account_memberships', 'membership_roles', 'account_sessions',
        'account_user_numbers', 'account_user_number_allocator', 'platform_roles',
        'platform_capabilities', 'platform_role_capabilities', 'account_platform_roles',
        'sysop_assignment', 'sessions', 'user_activation_tokens', 'account_activation_tokens'];
    $counts = [];
    foreach ($tables as $table) $counts[$table] = $count($table);
    foreach (['users' => 2, 'accounts' => 2, 'account_memberships' => 2,
        'user_roles' => 2, 'membership_roles' => 2,
        'platform_roles' => 2, 'platform_capabilities' => 9,
        'platform_role_capabilities' => 16, 'sysop_assignment' => 0,
        'account_platform_roles' => 0, 'account_user_numbers' => 2,
        'account_user_number_allocator' => 1] as $table => $expected) {
        if ($counts[$table] !== $expected) $add('BLOCKER', strtoupper($table) . '_COUNT');
    }
    foreach ([
        'SELECT COUNT(*) FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE c.id IS NULL',
        'SELECT COUNT(*) FROM user_roles ur LEFT JOIN users u ON u.id = ur.user_id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.id IS NULL OR r.id IS NULL',
        'SELECT COUNT(*) FROM account_memberships m LEFT JOIN accounts a ON a.id = m.account_id LEFT JOIN companies c ON c.id = m.company_id LEFT JOIN users u ON u.id = m.legacy_user_id WHERE a.id IS NULL OR c.id IS NULL OR u.id IS NULL',
        'SELECT COUNT(*) FROM membership_roles mr LEFT JOIN account_memberships m ON m.id = mr.membership_id LEFT JOIN roles r ON r.id = mr.role_id WHERE m.id IS NULL OR r.id IS NULL',
        'SELECT COUNT(*) FROM sessions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN companies c ON c.id = s.company_id WHERE u.id IS NULL OR c.id IS NULL',
        'SELECT COUNT(*) FROM account_sessions s LEFT JOIN accounts a ON a.id = s.account_id LEFT JOIN account_memberships m ON m.id = s.membership_id LEFT JOIN companies c ON c.id = s.technical_company_id WHERE a.id IS NULL OR (s.membership_id IS NOT NULL AND m.id IS NULL) OR (s.technical_company_id IS NOT NULL AND c.id IS NULL)',
        'SELECT COUNT(*) FROM user_activation_tokens t LEFT JOIN users u ON u.id = t.user_id AND u.company_id = t.company_id WHERE u.id IS NULL',
        'SELECT COUNT(*) FROM account_activation_tokens t LEFT JOIN accounts a ON a.id = t.account_id WHERE a.id IS NULL',
    ] as $query) {
        if ((int)$pdo->query($query)->fetchColumn() !== 0) $add('BLOCKER', 'ORPHAN_REFERENCE');
    }
    $legacyRoleCodes = $pdo->query('SELECT code FROM roles')->fetchAll(PDO::FETCH_COLUMN);
    $expectedLegacyRoles = array_keys(lehrfahrer_control_role_definitions());
    sort($legacyRoleCodes); sort($expectedLegacyRoles);
    if ($legacyRoleCodes !== $expectedLegacyRoles) $add('BLOCKER', 'LEGACY_ROLE_DEFINITIONS');
    $legacyCapabilityCodes = $pdo->query('SELECT code FROM capabilities')->fetchAll(PDO::FETCH_COLUMN);
    $expectedLegacyCapabilities = array_keys(lehrfahrer_control_capability_definitions());
    sort($legacyCapabilityCodes); sort($expectedLegacyCapabilities);
    if ($legacyCapabilityCodes !== $expectedLegacyCapabilities) $add('BLOCKER', 'LEGACY_CAPABILITY_DEFINITIONS');
    $roleCapabilities = $pdo->query('SELECT r.code AS role_code, c.code AS capability_code
        FROM role_capabilities rc JOIN roles r ON r.id = rc.role_id
        JOIN capabilities c ON c.id = rc.capability_id')->fetchAll(PDO::FETCH_ASSOC);
    $actualBindings = array_map(static fn(array $row): string => $row['role_code'] . ':' . $row['capability_code'], $roleCapabilities);
    $expectedBindings = [];
    foreach (lehrfahrer_control_role_definitions() as $roleCode => $definition) {
        foreach ($definition['capabilities'] as $capabilityCode) $expectedBindings[] = $roleCode . ':' . $capabilityCode;
    }
    sort($actualBindings); sort($expectedBindings);
    if ($actualBindings !== $expectedBindings || count($roleCapabilities) !== $counts['role_capabilities']) {
        $add('BLOCKER', 'LEGACY_ROLE_CAPABILITIES');
    }
    $platformRoles = $pdo->query('SELECT id, code FROM platform_roles')->fetchAll(PDO::FETCH_ASSOC);
    $platformRoleMap = [];
    foreach ($platformRoles as $row) $platformRoleMap[$row['code']] = $row['id'];
    ksort($platformRoleMap);
    if ($platformRoleMap !== ['COSYSOP' => 'prole_cosysop', 'SYSOP' => 'prole_sysop']) {
        $add('BLOCKER', 'PLATFORM_ROLE_DEFINITIONS');
    }
    $platformCaps = $pdo->query('SELECT id, code FROM platform_capabilities')->fetchAll(PDO::FETCH_ASSOC);
    $expectedPlatformCaps = ['platform.companies.manage', 'platform.accounts.support',
        'platform.system.read', 'platform.system.manage', 'platform.maintenance.execute',
        'platform.tenant_context.open', 'platform.security.read', 'platform.audit.read',
        'platform.roles.manage'];
    $platformCapMap = [];
    foreach ($platformCaps as $row) $platformCapMap[$row['code']] = $row['id'];
    $platformCapsValid = count($platformCapMap) === count($expectedPlatformCaps);
    foreach ($expectedPlatformCaps as $code) {
        if (($platformCapMap[$code] ?? null) !== 'pcap_' . substr(hash('sha256', $code), 0, 24)) {
            $platformCapsValid = false;
        }
    }
    if (!$platformCapsValid) $add('BLOCKER', 'PLATFORM_CAPABILITY_DEFINITIONS');
    $platformBindings = $pdo->query('SELECT r.code AS role_code, c.code AS capability_code
        FROM platform_role_capabilities rc JOIN platform_roles r ON r.id = rc.role_id
        JOIN platform_capabilities c ON c.id = rc.capability_id')->fetchAll(PDO::FETCH_ASSOC);
    $actualPlatformBindings = array_map(
        static fn(array $row): string => $row['role_code'] . ':' . $row['capability_code'], $platformBindings);
    $expectedPlatformBindings = [];
    foreach (['SYSOP', 'COSYSOP'] as $roleCode) {
        foreach ($expectedPlatformCaps as $capabilityCode) {
            if ($roleCode === 'COSYSOP' && in_array($capabilityCode,
                ['platform.system.manage', 'platform.roles.manage'], true)) continue;
            $expectedPlatformBindings[] = $roleCode . ':' . $capabilityCode;
        }
    }
    sort($actualPlatformBindings); sort($expectedPlatformBindings);
    if ($actualPlatformBindings !== $expectedPlatformBindings
        || count($platformBindings) !== $counts['platform_role_capabilities']) {
        $add('BLOCKER', 'PLATFORM_ROLE_CAPABILITIES');
    }
    $users = $pdo->query('SELECT id, company_id, login_normalized, password_hash, active,
        must_change_password FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $accounts = $pdo->query('SELECT id, login_normalized, password_hash, active,
        must_change_password FROM accounts')->fetchAll(PDO::FETCH_ASSOC);
    $memberships = $pdo->query('SELECT id, account_id, company_id, status, legacy_user_id
        FROM account_memberships')->fetchAll(PDO::FETCH_ASSOC);
    $accountsById = array_column($accounts, null, 'id');
    $membersByUser = [];
    foreach ($memberships as $membership) {
        $legacyId = (string)($membership['legacy_user_id'] ?? '');
        if ($legacyId === '' || isset($membersByUser[$legacyId])) $add('BLOCKER', 'MEMBERSHIP_DUPLICATE_OR_UNLINKED');
        $membersByUser[$legacyId] = $membership;
        if (!isset($accountsById[(string)$membership['account_id']])) $add('BLOCKER', 'MEMBERSHIP_ACCOUNT_ORPHAN');
    }
    $legacyRoles = $pdo->query('SELECT user_id, role_id FROM user_roles')->fetchAll(PDO::FETCH_ASSOC);
    $memberRoles = $pdo->query('SELECT membership_id, role_id FROM membership_roles')->fetchAll(PDO::FETCH_ASSOC);
    $rolesByUser = [];
    $rolesByMember = [];
    foreach ($legacyRoles as $row) $rolesByUser[(string)$row['user_id']][] = (string)$row['role_id'];
    foreach ($memberRoles as $row) $rolesByMember[(string)$row['membership_id']][] = (string)$row['role_id'];
    $usedAccounts = [];
    $normalizedLogins = [];
    $legacyLogins = [];
    foreach ($users as $user) {
        $legacyLogin = lehrfahrer_control_normalize_login((string)$user['login_normalized']);
        $legacyLogins[] = $legacyLogin;
        if ($legacyLogin === '' || $legacyLogin !== (string)$user['login_normalized']) $add('BLOCKER', 'LEGACY_LOGIN_NOT_NORMALIZED');
        if (password_get_info((string)$user['password_hash'])['algoName'] === 'unknown') $add('BLOCKER', 'LEGACY_PASSWORD_HASH');
        $membership = $membersByUser[(string)$user['id']] ?? null;
        $account = $membership === null ? null : ($accountsById[(string)$membership['account_id']] ?? null);
        if ($membership === null || $account === null) { $add('BLOCKER', 'ACCOUNT_OR_MEMBERSHIP_MISSING'); continue; }
        $usedAccounts[(string)$account['id']] = true;
        if ((string)$membership['company_id'] !== (string)$user['company_id']
            || (string)$membership['status'] !== ((int)$user['active'] === 1 ? 'active' : 'inactive')) {
            $add('BLOCKER', 'COMPANY_OR_MEMBERSHIP_STATUS');
        }
        foreach (['login_normalized', 'active', 'must_change_password'] as $field) {
            if ((string)$account[$field] !== (string)$user[$field]) $add('BLOCKER', 'ACCOUNT_IDENTITY_MISMATCH');
        }
        if (password_get_info((string)$account['password_hash'])['algoName'] === 'unknown') {
            $add('BLOCKER', 'ACCOUNT_PASSWORD_HASH');
        }
        $old = $rolesByUser[(string)$user['id']] ?? [];
        $new = $rolesByMember[(string)$membership['id']] ?? [];
        sort($old); sort($new);
        if ($old !== $new) $add('BLOCKER', 'ROLE_MISMATCH');
        $normalized = lehrfahrer_control_normalize_login((string)$account['login_normalized']);
        if ($normalized === '' || $normalized !== (string)$account['login_normalized']) $add('BLOCKER', 'LOGIN_NOT_NORMALIZED');
        $normalizedLogins[] = $normalized;
    }
    if (count($usedAccounts) !== count($accounts) || count($membersByUser) !== count($users)) {
        $add('BLOCKER', 'ORPHAN_OR_EXTRA_ACCOUNT');
    }
    if (count(array_unique($normalizedLogins)) !== count($normalizedLogins)) $add('BLOCKER', 'LOGIN_COLLISION');
    if (count(array_unique($legacyLogins)) !== count($legacyLogins)) $add('BLOCKER', 'LOGIN_COLLISION');
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        $collation = $pdo->query("SELECT COLLATION_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts' AND COLUMN_NAME = 'login_normalized'")->fetchColumn();
        if (!is_string($collation) || preg_match('/^utf8mb4_[a-z0-9_]+$/D', $collation) !== 1) {
            $add('BLOCKER', 'LOGIN_COLLATION');
        } elseif (count($normalizedLogins) > 1) {
            $query = $pdo->prepare("SELECT CONVERT(? USING utf8mb4) COLLATE $collation
                = CONVERT(? USING utf8mb4) COLLATE $collation");
            foreach ([$normalizedLogins, $legacyLogins] as $logins) {
                for ($i = 0; $i < count($logins); $i++) for ($j = $i + 1; $j < count($logins); $j++) {
                    $query->execute([$logins[$i], $logins[$j]]);
                    if ((int)$query->fetchColumn() === 1) $add('BLOCKER', 'LOGIN_COLLATION_COLLISION');
                }
            }
        }
    }
    $invalidCompany = (int)$pdo->query("SELECT COUNT(*) FROM account_memberships m JOIN companies c
        ON c.id = m.company_id WHERE m.status = 'active' AND c.status <> 'active'")->fetchColumn();
    if ($invalidCompany !== 0) $add('BLOCKER', 'INACTIVE_COMPANY_MEMBERSHIP');
    $numberRows = $pdo->query('SELECT user_number, issued_to_account_id, current_account_id
        FROM account_user_numbers ORDER BY user_number')->fetchAll(PDO::FETCH_ASSOC);
    $numbered = [];
    $maxNumber = 100;
    $seenNumbers = [];
    foreach ($numberRows as $row) {
        $number = (int)$row['user_number'];
        $maxNumber = max($maxNumber, $number);
        if (isset($seenNumbers[$number])) $add('BLOCKER', 'DUPLICATE_USER_NUMBER');
        $seenNumbers[$number] = true;
        if ($number <= 100 || $row['current_account_id'] === null
            || (string)$row['current_account_id'] !== (string)$row['issued_to_account_id']
            || !isset($accountsById[(string)$row['current_account_id']])) $add('BLOCKER', 'NUMBER_REGISTRY');
        $accountId = (string)$row['current_account_id'];
        if (isset($numbered[$accountId])) $add('BLOCKER', 'DUPLICATE_ACCOUNT_NUMBER');
        $numbered[$accountId] = true;
    }
    if (count($numbered) !== count($accounts)) $add('BLOCKER', 'ACCOUNT_NUMBER_MISSING');
    $allocator = $pdo->query('SELECT singleton_key, next_number FROM account_user_number_allocator')->fetchAll(PDO::FETCH_ASSOC);
    $next = count($allocator) === 1 ? (int)$allocator[0]['next_number'] : 0;
    if (count($allocator) !== 1 || (int)$allocator[0]['singleton_key'] !== 1
        || $next !== 103 || $next <= $maxNumber) $add('BLOCKER', 'NUMBER_ALLOCATOR');
    $sessions = [];
    $now = time();
    foreach (['legacy' => 'sessions', 'account' => 'account_sessions'] as $kind => $table) {
        $rows = $pdo->query('SELECT revoked_at, idle_expires_at, absolute_expires_at'
            . ($kind === 'account' ? ', context_type' : '') . ' FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
        $stats = ['total' => count($rows), 'active' => 0, 'expired' => 0, 'revoked' => 0];
        if ($kind === 'account') $stats += ['selectionPending' => 0, 'tenantContext' => 0];
        foreach ($rows as $row) {
            if ($row['revoked_at'] !== null) $stats['revoked']++;
            elseif (strtotime((string)$row['idle_expires_at']) <= $now
                || strtotime((string)$row['absolute_expires_at']) <= $now) $stats['expired']++;
            else $stats['active']++;
            if ($kind === 'account' && $row['context_type'] === 'PENDING') $stats['selectionPending']++;
            if ($kind === 'account' && $row['context_type'] === 'TENANT') $stats['tenantContext']++;
        }
        if ($stats['expired'] || $stats['revoked']) $add('WARNING', strtoupper($kind) . '_OLD_SESSIONS');
        $sessions[$kind] = $stats;
    }
    $openActivation = (int)$pdo->query('SELECT COUNT(*) FROM account_activation_tokens WHERE used_at IS NULL')->fetchColumn();
    $openLegacyActivation = (int)$pdo->query('SELECT COUNT(*) FROM user_activation_tokens WHERE used_at IS NULL')->fetchColumn();
    if ($openActivation || $openLegacyActivation) $add('WARNING', 'OPEN_ACTIVATIONS');
    $status = in_array('BLOCKER', array_column($findings, 'level'), true) ? 'BLOCKER'
        : (in_array('WARNING', array_column($findings, 'level'), true) ? 'WARNING' : 'PASS');
    return ['status' => $status, 'schemaVersion' => $version, 'counts' => $counts,
        'nextUserNumber' => $next, 'reservedNumbersFree' => !in_array('NUMBER_REGISTRY', array_column($findings, 'code'), true),
        'sessions' => $sessions, 'openActivations' => $openActivation + $openLegacyActivation,
        'auth' => $auth, 'findings' => $findings];
}

if (getenv('LEHRFAHRER_CUTOVER_PREFLIGHT_RUN') === '1') {
    if (!in_array(PHP_SAPI, ['cli', 'cgi-fcgi'], true) || isset($_SERVER['REQUEST_METHOD'])
        || lehrfahrer_environment() !== 'staging') exit(2);
    try {
        $configuration = lehrfahrer_control_mysql_configuration();
        $pdo = new PDO($configuration['dsn'], $configuration['user'], $configuration['password'], $configuration['options']);
        $pdo->exec('SET SESSION TRANSACTION READ ONLY');
        $pdo->beginTransaction();
        $result = lehrfahrer_account_cutover_preflight($pdo);
        $pdo->rollBack();
        echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
        exit($result['status'] === 'BLOCKER' ? 1 : 0);
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        file_put_contents('php://stderr', "Cutover-Preflight fehlgeschlagen.\n");
        exit(1);
    }
}
