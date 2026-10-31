<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT')) ?: dirname(__DIR__);
require_once $appRoot . '/api/_control_database.php';
require_once $appRoot . '/api/_control_repositories.php';
require_once $appRoot . '/api/_auth_cutover_gate.php';

const LEHRFAHRER_DRIVER_SMOKE_LOGIN = 'staging-driver-smoke';

/** Read only: use the same release validator as the Driver API, including its inventory lock. */
function lehrfahrer_driver_smoke_released_count(string $companyId): int {
    $appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT')) ?: dirname(__DIR__);
    require_once $appRoot . '/api/_tenant_route_storage.php';
    require_once $appRoot . '/api/_gtfs_work_inventory.php';
    $cityPath = lehrfahrer_route_line_city_path($companyId, 'cottbus');
    if (!is_dir($cityPath) || is_link($cityPath)) return 0;
    $count = 0;
    foreach (glob($cityPath . '/*/*/*.json') ?: [] as $path) {
        if (is_link($path) || !is_file($path)) continue;
        $line = lehrfahrer_gtfs_work_load_driver_route($companyId, $path);
        if (!is_array($line) || !is_array($line['meta']['gtfsWork'] ?? null)
            || !is_array($line['routePoints'] ?? null) || count($line['routePoints']) < 2) continue;
        $count++;
    }
    return $count;
}

/** Exact staging-only account, membership, role and capability boundary. */
function lehrfahrer_driver_smoke_identity(PDO $pdo): array {
    $query = $pdo->prepare('SELECT id, active, must_change_password, password_hash FROM accounts WHERE login_normalized = ?');
    $query->execute([LEHRFAHRER_DRIVER_SMOKE_LOGIN]);
    $accounts = $query->fetchAll(PDO::FETCH_ASSOC);
    if (count($accounts) === 0) return ['present' => false, 'valid' => false];
    if (count($accounts) !== 1) return ['present' => true, 'valid' => false,
        'accountId' => '', 'companyId' => '', 'userNumber' => null];
    $account = $accounts[0];
    $accountId = (string)$account['id'];
    $query = $pdo->prepare('SELECT m.id, m.company_id, m.status, m.legacy_user_id, c.slug, c.status AS company_status
        FROM account_memberships m JOIN companies c ON c.id = m.company_id WHERE m.account_id = ?');
    $query->execute([$accountId]);
    $memberships = $query->fetchAll(PDO::FETCH_ASSOC);
    $roles = [];
    if (count($memberships) === 1) {
        $query = $pdo->prepare('SELECT r.code FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
            WHERE mr.membership_id = ?');
        $query->execute([(string)$memberships[0]['id']]);
        $roles = $query->fetchAll(PDO::FETCH_COLUMN);
    }
    $query = $pdo->prepare('SELECT COUNT(*) FROM account_platform_roles WHERE account_id = ?');
    $query->execute([$accountId]);
    $platformCount = (int)$query->fetchColumn();
    $query = $pdo->prepare('SELECT COUNT(*) FROM sysop_assignment WHERE account_id = ?');
    $query->execute([$accountId]);
    $sysopCount = (int)$query->fetchColumn();
    $number = lehrfahrer_control_user_number_for_account($pdo, $accountId);
    $member = $memberships[0] ?? [];
    $valid = (int)$account['active'] === 1 && (int)$account['must_change_password'] === 0
        && password_get_info((string)$account['password_hash'])['algoName'] !== 'unknown'
        && count($memberships) === 1 && $member['legacy_user_id'] === null
        && ($member['slug'] ?? '') === 'cottbusverkehr' && ($member['status'] ?? '') === 'active'
        && ($member['company_status'] ?? '') === 'active' && $roles === ['FAHRER']
        && $platformCount === 0 && $sysopCount === 0 && $number !== null && $number > 100;
    return ['present' => true, 'valid' => $valid, 'accountId' => $accountId,
        'companyId' => (string)($member['company_id'] ?? ''), 'userNumber' => $number];
}

function lehrfahrer_driver_smoke_company(PDO $pdo): array {
    $query = $pdo->prepare('SELECT id, status FROM companies WHERE slug = ?');
    $query->execute(['cottbusverkehr']);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) !== 1 || $rows[0]['status'] !== 'active') {
        throw new RuntimeException('Aktive Staging-Gesellschaft Cottbusverkehr fehlt.');
    }
    return $rows[0];
}

if (getenv('LEHRFAHRER_DRIVER_SMOKE_RUN') === '1') {
    if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD'])
        || lehrfahrer_environment() !== 'staging' || lehrfahrer_control_database_driver() !== 'mysql') exit(2);
    $action = (string)getenv('LEHRFAHRER_DRIVER_SMOKE_ACTION');
    if (!in_array($action, ['inspect', 'provision'], true)) exit(2);
    try {
        $config = lehrfahrer_control_mysql_configuration();
        $pdo = new PDO($config['dsn'], $config['user'], $config['password'], $config['options']);
        $environment = $pdo->query("SELECT value FROM control_metadata WHERE `key` = 'environment'")->fetchColumn();
        if ($environment !== 'staging') throw new RuntimeException('Control-DB ist nicht Staging.');
        $auth = lehrfahrer_auth_cutover_state($pdo);
        if ($auth !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']) throw new RuntimeException('Auth-Zustand ist nicht PARALLEL/OPEN.');
        $company = lehrfahrer_driver_smoke_company($pdo);
        $released = lehrfahrer_driver_smoke_released_count((string)$company['id']);
        if ($released < 1) throw new RuntimeException('NO_AUTHORIZED_RELEASED_DRIVER_ROUTE');
        $identity = lehrfahrer_driver_smoke_identity($pdo);
        if ($action === 'provision') {
            $password = (string)getenv('LEHRFAHRER_STAGING_DRIVER_SMOKE_PASSWORD');
            if (strlen($password) < 40) throw new RuntimeException('Staging-Smoke-Secret fehlt.');
            if ($identity['present']) throw new RuntimeException('Smoke-Account existiert bereits; keine Neuanlage.');
            $role = $pdo->query("SELECT id FROM roles WHERE code = 'FAHRER'")->fetchAll(PDO::FETCH_COLUMN);
            if (count($role) !== 1) throw new RuntimeException('Minimale Fahrerrolle fehlt.');
            $capabilities = $pdo->prepare('SELECT c.code FROM role_capabilities rc JOIN capabilities c
                ON c.id = rc.capability_id WHERE rc.role_id = ? ORDER BY c.code');
            $capabilities->execute([$role[0]]);
            if ($capabilities->fetchAll(PDO::FETCH_COLUMN) !== ['app.access', 'routes.read']) {
                throw new RuntimeException('Fahrerrolle hat nicht die erwarteten Minimalrechte.');
            }
            $number = lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $company, $role, $password): int {
                if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']
                    || lehrfahrer_driver_smoke_identity($pdo)['present']) {
                    throw new RuntimeException('Smoke-Provisionierung nicht mehr eindeutig erlaubt.');
                }
                $pdo->beginTransaction();
                try {
                    $accountId = lehrfahrer_control_id('acc');
                    $membershipId = lehrfahrer_control_id('mem');
                    $now = gmdate('c');
                    $insert = $pdo->prepare('INSERT INTO accounts
                        (id, login_normalized, display_name, password_hash, active, must_change_password, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 1, 0, ?, ?)');
                    $insert->execute([$accountId, LEHRFAHRER_DRIVER_SMOKE_LOGIN, 'Staging Driver Smoke',
                        password_hash($password, PASSWORD_DEFAULT), $now, $now]);
                    $number = lehrfahrer_control_allocate_user_number($pdo, $accountId);
                    $insert = $pdo->prepare("INSERT INTO account_memberships
                        (id, account_id, company_id, status, legacy_user_id, created_at, updated_at)
                        VALUES (?, ?, ?, 'active', NULL, ?, ?)");
                    $insert->execute([$membershipId, $accountId, $company['id'], $now, $now]);
                    $insert = $pdo->prepare('INSERT INTO membership_roles (membership_id, role_id) VALUES (?, ?)');
                    $insert->execute([$membershipId, $role[0]]);
                    $pdo->commit();
                    return $number;
                } catch (Throwable $error) {
                    if ($pdo->inTransaction()) $pdo->rollBack();
                    throw $error;
                }
            });
            unset($password);
            $identity = lehrfahrer_driver_smoke_identity($pdo);
            if (!$identity['valid'] || $identity['userNumber'] !== $number) {
                throw new RuntimeException('Smoke-Account-Nachpruefung fehlgeschlagen.');
            }
        }
        echo json_encode(['ok' => true, 'releasedRoutes' => $released,
            'smokeAccountPresent' => $identity['present'], 'smokeAccountValid' => $identity['valid'],
            'userNumber' => $identity['userNumber'] ?? null, 'auth' => $auth], JSON_THROW_ON_ERROR) . "\n";
    } catch (Throwable $error) {
        file_put_contents('php://stderr', 'Driver-Smoke-Staging: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
