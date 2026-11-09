<?php
declare(strict_types=1);

require_once __DIR__ . '/_company_provisioning.php';

function lehrfahrer_first_start_configured(): bool {
    $expires = (string)getenv('LEHRFAHRER_FIRST_START_EXPIRES');
    return getenv('LEHRFAHRER_FIRST_START_ENABLED') === '1'
        && in_array(lehrfahrer_environment(), ['production', 'staging'], true)
        && lehrfahrer_account_login_enabled()
        && preg_match('/^[a-f0-9]{64}$/D', (string)getenv('LEHRFAHRER_FIRST_START_HASH')) === 1
        && ctype_digit($expires) && (int)$expires > time() && (int)$expires <= time() + 3600;
}

/** HTTP setup must never invoke the auto-migrating database factory. */
function lehrfahrer_first_start_connection(): PDO {
    $expected = (string)getenv('LEHRFAHRER_FIRST_START_DATABASE');
    if ($expected === '' || lehrfahrer_control_database_driver() !== 'mysql') throw new RuntimeException('SETUP_DATABASE');
    $config = lehrfahrer_control_mysql_configuration();
    $pdo = new PDO($config['dsn'], $config['user'], $config['password'], $config['options']);
    if ($pdo->query('SELECT DATABASE()')->fetchColumn() !== $expected) throw new RuntimeException('SETUP_DATABASE');
    return $pdo;
}

function lehrfahrer_first_start_private_root(): ?string {
    $configured = (string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR');
    $private = $configured === '' ? false : realpath($configured);
    if (!$private || !is_dir($private) || is_link($configured)) return null;
    foreach ([dirname(__DIR__), $_SERVER['DOCUMENT_ROOT'] ?? ''] as $candidate) {
        $web = $candidate === '' ? false : realpath($candidate);
        if (!$web) continue;
        $root = str_replace('\\','/',$private).'/';
        $public = str_replace('\\','/',$web).'/';
        if (PHP_OS_FAMILY === 'Windows') { $root = strtolower($root); $public = strtolower($public); }
        if (str_starts_with($root,$public)) return null;
    }
    return $private;
}

function lehrfahrer_first_start_empty(PDO $pdo): bool {
    $query = $pdo->query("SELECT `key`,value FROM control_metadata WHERE `key` IN ('environment','first_start_pending','first_start_completed')");
    $metadata = $query->fetchAll(PDO::FETCH_KEY_PAIR);
    $private = lehrfahrer_first_start_private_root();
    if (($metadata['environment'] ?? null) !== lehrfahrer_environment()
        || $private === null || ($metadata['first_start_pending'] ?? null) !== hash('sha256',$private)
        || isset($metadata['first_start_completed'])
        || (int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn() !== LEHRFAHRER_CONTROL_SCHEMA_VERSION
        || lehrfahrer_auth_cutover_state($pdo) !== ['mode'=>'ACCOUNT_PRIMARY','lock'=>'OPEN']) return false;
    foreach (['companies','users','accounts','sysop_assignment','account_user_numbers','account_sessions','sessions'] as $table) {
        if ((int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() !== 0) return false;
    }
    // An existing company tree, even an orphan, needs independent operator review.
    $entries = scandir($private);
    if ($entries === false || array_diff($entries, ['.','..','companies']) !== []) return false;
    $companies = $private . '/companies';
    if (is_link($companies)) return false;
    return !file_exists($companies) || (is_dir($companies) && scandir($companies) === ['.', '..']);
}

function lehrfahrer_first_start_check_code(mixed $code): void {
    if (!lehrfahrer_first_start_configured() || !is_string($code)
        || preg_match('/^[A-Za-z0-9_-]{43}$/D', $code) !== 1
        || !hash_equals((string)getenv('LEHRFAHRER_FIRST_START_HASH'), hash('sha256', $code))) {
        throw new InvalidArgumentException('Einrichtungsfreigabe ungültig oder abgelaufen.');
    }
}

function lehrfahrer_first_start(PDO $pdo, array $input): array {
    lehrfahrer_first_start_check_code($input['setup_code'] ?? '');
    foreach (['name','slug','admin_display_name','admin_login','password','password_confirm'] as $field) {
        if (!is_string($input[$field] ?? null) || strlen($input[$field]) > 200) throw new InvalidArgumentException('Bitte alle Felder prüfen.');
    }
    $values = lehrfahrer_company_provision_validate(array_intersect_key($input, array_flip(['name','slug','admin_display_name','admin_login'])) + ['license_status'=>'active']);
    $password = $input['password'];
    if (strlen($password) < 12 || strlen($password) > 72 || str_contains($password, "\0") || $password !== $input['password_confirm']) {
        throw new InvalidArgumentException('Das Passwort muss 12 bis 72 Byte umfassen und in beiden Feldern übereinstimmen.');
    }
    $login = lehrfahrer_control_normalize_login($values['admin_login']);
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,62}$/D', $login)) throw new InvalidArgumentException('Bitte einen gültigen Anmeldenamen eingeben.');
    $companyId = null;
    try {
        return lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $values, $password, $login, $input, &$companyId): array {
            $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
            if ($mysql) $pdo->beginTransaction();
            try {
                $actor = LehrfahrerAuditActor::authorizedFirstStart($pdo, $input['setup_code']);
                $template = lehrfahrer_master_tenant_template();
                $company = (new LehrfahrerCompanyRepository($pdo))->create([
                    'name'=>$values['name'], 'slug'=>$values['slug'], 'status'=>'active', 'license_status'=>'active',
                    'template_version_created'=>$template['template_version'], 'template_version_current'=>$template['template_version'],
                ]);
                $companyId = $company['id'];
                $account = lehrfahrer_control_id('acc'); $membership = lehrfahrer_control_id('mem'); $now = gmdate('c');
                $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')
                    ->execute([$account,$login,$values['admin_display_name'],lehrfahrer_password_hash($password),$now,$now]);
                $pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
                    ->execute([$membership,$account,$companyId,$now,$now]);
                $role = $pdo->query("SELECT id FROM roles WHERE code='ADMIN'")->fetchColumn();
                if (!is_string($role)) throw new RuntimeException('SETUP_ADMIN_ROLE');
                $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membership,$role]);
                $pdo->prepare('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (1,?,?)')->execute([$account,$now]);
                $pdo->prepare('INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at) VALUES (1,?,?,?)')->execute([$account,$account,$now]);
                foreach ($template['tenant_areas'] as $area) lehrfahrer_tenant_area($companyId, $area, true);
                lehrfahrer_company_write_config($companyId, lehrfahrer_company_config($company, $template));
                $enrollmentCode = lehrfahrer_auth_random_token();
                $write = $pdo->prepare('INSERT INTO control_metadata (`key`,value,updated_at) VALUES (?,?,?)');
                $write->execute(['mfa_enroll_'.$account, json_encode(['environment'=>lehrfahrer_environment(), 'hash'=>hash('sha256',$enrollmentCode), 'expires'=>time()+600], JSON_THROW_ON_ERROR),$now]);
                $write->execute(['first_start_completed',$account,$now]);
                $pdo->exec("DELETE FROM control_metadata WHERE `key`='first_start_pending'");
                foreach ([['ACCOUNT_CREATE','ACCOUNT',$account], ['MEMBERSHIP_CHANGE','MEMBERSHIP',$membership],
                    ['SYSOP_CHANGE','ACCOUNT',$account], ['AUTH_MFA_ENROLL_AUTHORIZE','ACCOUNT',$account]] as [$action,$type,$id]) {
                    lehrfahrer_audit_append($pdo,$actor,['action'=>$action,'objectType'=>$type,'objectId'=>$id,'result'=>'SUCCESS']);
                }
                lehrfahrer_audit_append($pdo,$actor,['action'=>'TENANT_ROLE_ASSIGN','objectType'=>'MEMBERSHIP','objectId'=>$membership,
                    'relatedObjectType'=>'TENANT_ROLE','relatedObjectId'=>$role,'result'=>'SUCCESS']);
                if ($mysql) $pdo->commit();
                return ['enrollmentCode'=>$enrollmentCode];
            } catch (Throwable $error) {
                if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
        });
    } catch (Throwable $error) {
        if ($companyId !== null) lehrfahrer_company_cleanup_failed_provision($pdo,$companyId);
        throw $error;
    }
}
