<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
require_once ($appRoot !== '' ? $appRoot : dirname(__DIR__)) . '/api/_control_repositories.php';

/** Reads the legacy identity inventory without calling the auto-migrating DB factory. */
function lehrfahrer_control_account_preflight(PDO $pdo): array {
    $driver = lehrfahrer_control_driver($pdo);
    if ($driver === 'mysql') {
        $pdo->exec('SET SESSION TRANSACTION READ ONLY');
    } else {
        $pdo->exec('PRAGMA query_only = ON');
    }
    $pdo->beginTransaction();
    try {
        $result = lehrfahrer_control_account_preflight_read($pdo, $driver);
        $pdo->rollBack();
        return $result;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function lehrfahrer_control_account_preflight_read(PDO $pdo, string $driver): array {
    $findings = [];
    $add = static function (string $level, string $code, array $subjects = []) use (&$findings): void {
        $findings[] = ['level' => $level, 'code' => $code, 'subjects' => $subjects];
    };
    $version = (int)$pdo->query('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')->fetchColumn();
    if ($version !== 5) {
        $add('BLOCKER', 'UNEXPECTED_SCHEMA_VERSION');
        return ['status' => 'BLOCKIERT', 'schemaVersion' => $version, 'scanned' => false,
            'findings' => $findings];
    }
    $newTables = ['accounts', 'account_memberships', 'membership_roles',
        'account_platform_roles', 'sysop_assignment', 'account_sessions', 'account_activation_tokens'];
    $newCounts = [];
    foreach ($newTables as $table) {
        $newCounts[$table] = (int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
        if ($newCounts[$table] !== 0) $add('BLOCKER', 'TARGET_TABLE_NOT_EMPTY', [$table]);
    }
    if ($findings !== []) {
        return ['status' => 'BLOCKIERT', 'schemaVersion' => $version, 'scanned' => false,
            'newTables' => $newCounts, 'findings' => $findings];
    }
    $definitionCounts = [
        'platform_roles' => (int)$pdo->query('SELECT COUNT(*) FROM platform_roles')->fetchColumn(),
        'platform_capabilities' => (int)$pdo->query('SELECT COUNT(*) FROM platform_capabilities')->fetchColumn(),
        'platform_role_capabilities' => (int)$pdo->query('SELECT COUNT(*) FROM platform_role_capabilities')->fetchColumn(),
    ];
    if ($definitionCounts !== ['platform_roles' => 2, 'platform_capabilities' => 9,
        'platform_role_capabilities' => 16]) {
        $add('BLOCKER', 'PLATFORM_DEFINITIONS_UNEXPECTED');
        return ['status' => 'BLOCKIERT', 'schemaVersion' => $version, 'scanned' => false,
            'newTables' => $newCounts, 'definitionCounts' => $definitionCounts,
            'findings' => $findings];
    }

    $collation = null;
    if ($driver === 'mysql') {
        $statement = $pdo->query("SELECT COLLATION_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts' AND COLUMN_NAME = 'login_normalized'");
        $collation = $statement->fetchColumn();
        if (!is_string($collation) || preg_match('/^utf8mb4_[a-z0-9_]+$/D', $collation) !== 1) {
            $add('BLOCKER', 'ACCOUNT_LOGIN_COLLATION_UNCLEAR');
            return ['status' => 'BLOCKIERT', 'schemaVersion' => $version, 'scanned' => false,
                'newTables' => $newCounts, 'findings' => $findings];
        }
    }
    $users = $pdo->query('SELECT u.id, u.company_id, u.login_normalized, u.email_normalized,
            u.password_hash, u.active, u.must_change_password, u.blocked_until, u.last_login,
            c.id AS found_company_id, c.status AS company_status
        FROM users u LEFT JOIN companies c ON c.id = u.company_id ORDER BY u.id')->fetchAll(PDO::FETCH_ASSOC);
    $companyCounts = ['valid' => 0, 'inactive' => 0, 'orphan' => 0];
    $password = ['present' => 0, 'missingOrUnknown' => 0, 'active' => 0,
        'inactive' => 0, 'mustChange' => 0, 'blockedUntilSet' => 0, 'lastLoginSet' => 0];
    $email = ['present' => 0, 'nonCanonical' => 0];
    $normalizedLogins = [];
    foreach ($users as $user) {
        $id = (string)$user['id'];
        $companyId = (string)$user['company_id'];
        $subject = [$id, $companyId];
        if ($user['found_company_id'] === null) {
            $companyCounts['orphan']++;
            $add('BLOCKER', 'USER_COMPANY_MISSING', $subject);
        } elseif ($user['company_status'] === 'inactive') {
            $companyCounts['inactive']++;
            $add('WARNUNG', 'USER_COMPANY_INACTIVE', $subject);
        } elseif ($user['company_status'] === 'active') {
            $companyCounts['valid']++;
        } else {
            $add('BLOCKER', 'USER_COMPANY_STATUS_UNKNOWN', $subject);
        }
        $login = (string)$user['login_normalized'];
        $normalized = lehrfahrer_control_normalize_login($login);
        $normalizedLogins[] = $normalized;
        if ($normalized === '' || (function_exists('mb_strlen') ? mb_strlen($normalized, 'UTF-8') : strlen($normalized)) > 191) {
            $add('BLOCKER', 'LOGIN_NOT_MIGRATABLE', $subject);
        } elseif ($login !== $normalized) {
            $add('WARNUNG', 'LOGIN_NOT_CANONICAL', $subject);
        }
        if ($user['email_normalized'] !== null) {
            $email['present']++;
            if ((string)$user['email_normalized'] !== lehrfahrer_control_normalize_email((string)$user['email_normalized'])) {
                $email['nonCanonical']++;
                $add('WARNUNG', 'EMAIL_NOT_CANONICAL', $subject);
            }
        }
        $hashInfo = password_get_info((string)$user['password_hash']);
        if (in_array($hashInfo['algoName'] ?? '', ['argon2id', 'argon2i', 'bcrypt'], true)) {
            $password['present']++;
        } else {
            $password['missingOrUnknown']++;
            $add('BLOCKER', 'PASSWORD_HASH_MISSING_OR_UNKNOWN', $subject);
        }
        if ((int)$user['active'] === 1) $password['active']++;
        else {
            $password['inactive']++;
            $add('WARNUNG', 'USER_INACTIVE', $subject);
        }
        if ((int)$user['must_change_password'] === 1) $password['mustChange']++;
        if ($user['blocked_until'] !== null) $password['blockedUntilSet']++;
        if ($user['last_login'] !== null) $password['lastLoginSet']++;
    }

    $compare = null;
    if ($driver === 'mysql') {
        $compare = $pdo->prepare("SELECT CONVERT(:left_login USING utf8mb4) COLLATE $collation
            = CONVERT(:right_login USING utf8mb4) COLLATE $collation");
    }
    $loginConflicts = 0;
    for ($i = 0, $count = count($users); $i < $count; $i++) {
        for ($j = $i + 1; $j < $count; $j++) {
            $left = $normalizedLogins[$i];
            $right = $normalizedLogins[$j];
            $same = $left === $right;
            if (!$same && $compare !== null) {
                $compare->execute([':left_login' => $left, ':right_login' => $right]);
                $same = (int)$compare->fetchColumn() === 1;
            }
            if (!$same) continue;
            $loginConflicts++;
            $kind = (string)$users[$i]['login_normalized'] === (string)$users[$j]['login_normalized']
                ? 'EXACT' : ($left === $right ? 'NORMALIZED' : 'DB_COLLATION');
            $add('BLOCKER', 'GLOBAL_LOGIN_COLLISION_' . $kind,
                [(string)$users[$i]['id'], (string)$users[$i]['company_id'],
                 (string)$users[$j]['id'], (string)$users[$j]['company_id']]);
        }
    }

    $roleRows = $pdo->query('SELECT ur.user_id, ur.role_id, u.company_id, r.id AS found_role_id
        FROM user_roles ur LEFT JOIN users u ON u.id = ur.user_id
        LEFT JOIN roles r ON r.id = ur.role_id ORDER BY ur.user_id, ur.role_id')->fetchAll(PDO::FETCH_ASSOC);
    $roleCounts = ['total' => count($roleRows), 'orphanUser' => 0, 'orphanRole' => 0, 'duplicates' => 0];
    $seenRoles = [];
    foreach ($roleRows as $row) {
        $key = (string)$row['user_id'] . "\0" . (string)$row['role_id'];
        if (isset($seenRoles[$key])) {
            $roleCounts['duplicates']++;
            $add('BLOCKER', 'USER_ROLE_DUPLICATE', [(string)$row['user_id'], (string)$row['role_id']]);
        }
        $seenRoles[$key] = true;
        if ($row['company_id'] === null) {
            $roleCounts['orphanUser']++;
            $add('BLOCKER', 'USER_ROLE_USER_MISSING', [(string)$row['user_id'], (string)$row['role_id']]);
        }
        if ($row['found_role_id'] === null) {
            $roleCounts['orphanRole']++;
            $add('BLOCKER', 'USER_ROLE_ROLE_MISSING', [(string)$row['user_id'], (string)$row['role_id']]);
        }
    }

    $now = time();
    $tokens = $pdo->query('SELECT t.user_id, t.company_id, t.expires_at, t.used_at,
        u.company_id AS found_user_company, c.id AS found_company_id
        FROM user_activation_tokens t LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN companies c ON c.id = t.company_id')->fetchAll(PDO::FETCH_ASSOC);
    $activation = ['total' => count($tokens), 'open' => 0, 'expired' => 0,
        'used' => 0, 'orphan' => 0, 'reissueAtCutover' => 0];
    foreach ($tokens as $token) {
        $subject = [(string)$token['user_id'], (string)$token['company_id']];
        if ($token['found_user_company'] === null || $token['found_company_id'] === null
            || $token['found_user_company'] !== $token['company_id']) {
            $activation['orphan']++;
            $add('BLOCKER', 'ACTIVATION_TARGET_INVALID', $subject);
        }
        $expires = strtotime((string)$token['expires_at']);
        if ($expires === false) $add('BLOCKER', 'ACTIVATION_EXPIRY_INVALID', $subject);
        if ($token['used_at'] !== null) $activation['used']++;
        elseif ($expires !== false && $expires <= $now) {
            $activation['expired']++;
            $add('WARNUNG', 'ACTIVATION_EXPIRED', $subject);
        } elseif ($expires !== false) {
            $activation['open']++;
            $activation['reissueAtCutover']++;
            $add('WARNUNG', 'ACTIVATION_REISSUE_AT_CUTOVER', $subject);
        }
    }

    $sessions = $pdo->query('SELECT s.user_id, s.company_id, s.environment,
        s.idle_expires_at, s.absolute_expires_at, s.revoked_at,
        u.company_id AS found_user_company, u.active AS user_active,
        c.id AS found_company_id, c.status AS company_status
        FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN companies c ON c.id = s.company_id')->fetchAll(PDO::FETCH_ASSOC);
    $sessionCounts = ['total' => count($sessions), 'currentlyValid' => 0,
        'expired' => 0, 'revoked' => 0, 'orphan' => 0, 'inactiveContext' => 0];
    foreach ($sessions as $session) {
        if ($session['found_user_company'] === null || $session['found_company_id'] === null
            || $session['found_user_company'] !== $session['company_id']) {
            $sessionCounts['orphan']++;
            $add('BLOCKER', 'SESSION_TARGET_INVALID', [(string)$session['user_id'], (string)$session['company_id']]);
        }
        $idle = strtotime((string)$session['idle_expires_at']);
        $absolute = strtotime((string)$session['absolute_expires_at']);
        if ($idle === false || $absolute === false) {
            $add('BLOCKER', 'SESSION_EXPIRY_INVALID');
        } elseif ($session['revoked_at'] !== null) {
            $sessionCounts['revoked']++;
        } elseif ($idle <= $now || $absolute <= $now) {
            $sessionCounts['expired']++;
        } elseif ((int)$session['user_active'] !== 1 || $session['company_status'] !== 'active'
            || $session['environment'] !== lehrfahrer_environment()) {
            $sessionCounts['inactiveContext']++;
            $add('WARNUNG', 'SESSION_CONTEXT_INACTIVE');
        } else {
            $sessionCounts['currentlyValid']++;
        }
    }
    if ($sessionCounts['expired'] > 0) $add('WARNUNG', 'SESSIONS_EXPIRED', [$sessionCounts['expired']]);
    $blockers = count(array_filter($findings, static fn(array $finding): bool => $finding['level'] === 'BLOCKER'));
    $warnings = count($findings) - $blockers;
    return [
        'status' => $blockers === 0 ? 'PASS' : 'BLOCKIERT',
        'schemaVersion' => $version,
        'scanned' => true,
        'counts' => ['legacyUsers' => count($users), 'plannedAccounts' => count($users),
            'plannedMemberships' => count($users), 'plannedMembershipRoles' => count($roleRows),
            'plannedPlatformAssignments' => 0, 'plannedSysopAssignments' => 0,
            'plannedAccountSessions' => 0],
        'newTables' => $newCounts,
        'definitionCounts' => $definitionCounts,
        'company' => $companyCounts,
        'roles' => $roleCounts,
        'password' => $password,
        'email' => $email,
        'activation' => $activation,
        'sessions' => $sessionCounts,
        'loginConflicts' => $loginConflicts,
        'blockers' => $blockers, 'warnings' => $warnings,
        'cutoverSessions' => 'REVOKE_AND_REAUTHENTICATE',
        'findings' => $findings,
    ];
}

if (getenv('LEHRFAHRER_ACCOUNT_PREFLIGHT_RUN') === '1') {
    if (!in_array(PHP_SAPI, ['cli', 'cgi-fcgi'], true) || isset($_SERVER['REQUEST_METHOD'])
        || lehrfahrer_environment() !== 'staging') {
        file_put_contents('php://stderr', "Preflight ist ausschließlich für die Staging-MariaDB per Shell freigegeben.\n");
        exit(2);
    }
    try {
        if (lehrfahrer_control_database_driver() !== 'mysql') {
            throw new RuntimeException('Unerwarteter Datenbankdialekt.');
        }
        $configuration = lehrfahrer_control_mysql_configuration();
        $pdo = new PDO($configuration['dsn'], $configuration['user'], $configuration['password'], $configuration['options']);
        $pdo->exec('SET SESSION TRANSACTION READ ONLY');
        $environment = $pdo->query("SELECT value FROM control_metadata WHERE `key` = 'environment'")->fetchColumn();
        if ($environment !== 'staging') throw new RuntimeException('Datenbank ist nicht als Staging gebunden.');
        $report = lehrfahrer_control_account_preflight($pdo);
        echo json_encode($report, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
        exit($report['status'] === 'PASS' ? 0 : 1);
    } catch (Throwable $error) {
        file_put_contents('php://stderr', "Preflight blockiert: Datenbank- oder Schemafehler.\n");
        exit(2);
    }
}
