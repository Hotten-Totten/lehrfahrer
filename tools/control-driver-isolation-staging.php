<?php
declare(strict_types=1);

try {
    $appRoot = (string)getenv('LEHRFAHRER_APP_ROOT');
    require_once $appRoot . '/api/_account_auth.php';
    if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD'])
        || lehrfahrer_environment() !== 'staging' || lehrfahrer_control_database_driver() !== 'mysql'
        || lehrfahrer_public_origin() !== 'https://staging.lehrfahrer.de') {
        throw new RuntimeException('STAGING_ONLY');
    }
    $login = (string)getenv('LF_TEST_LOGIN');
    $password = (string)getenv('LF_TEST_PASSWORD');
    $action = (string)getenv('LF_TEST_ACTION');
    if (!preg_match('/^staging-isolation-[a-f0-9]{24}$/D', $login)
        || !preg_match('/^[a-f0-9]{64}$/D', $password)
        || !in_array($action, ['create', 'disable'], true)) {
        throw new RuntimeException('INVALID_TEST_INPUT');
    }
    $pdo = lehrfahrer_control_database();
    $companyId = $pdo->query("SELECT id FROM companies WHERE slug = 'lehrfahrer-test' AND status = 'active'")->fetchColumn();
    $roleId = $pdo->query("SELECT id FROM roles WHERE code = 'FAHRER'")->fetchColumn();
    if (!$companyId || !$roleId) throw new RuntimeException('FIXTURE_COMPANY_OR_ROLE_MISSING');

    lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $companyId, $roleId, $login, $password, $action): void {
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN']) {
            throw new RuntimeException('ACCOUNT_PRIMARY_REQUIRED');
        }
        $pdo->beginTransaction();
        try {
            $actor = LehrfahrerAuditActor::authorizedCli();
            $now = gmdate('c');
            if ($action === 'create') {
                $accountId = lehrfahrer_control_id('acc');
                $membershipId = lehrfahrer_control_id('mem');
                $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
                    VALUES (?,?,?,?,1,0,?,?)')->execute([$accountId,$login,'Staging Firmentrennung',password_hash($password,PASSWORD_DEFAULT),$now,$now]);
                lehrfahrer_control_allocate_user_number($pdo, $accountId);
                $pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at)
                    VALUES (?,?,?,'active',?,?)")->execute([$membershipId,$accountId,$companyId,$now,$now]);
                $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipId,$roleId]);
                lehrfahrer_audit_append($pdo, $actor, ['action'=>'ACCOUNT_CREATE','objectType'=>'ACCOUNT','objectId'=>$accountId,'result'=>'SUCCESS']);
                lehrfahrer_audit_append($pdo, $actor, ['action'=>'MEMBERSHIP_CHANGE','objectType'=>'MEMBERSHIP','objectId'=>$membershipId,'result'=>'SUCCESS']);
            } else {
                $lookup = $pdo->prepare('SELECT a.id,a.active,a.password_hash,m.id AS membership_id
                    FROM accounts a JOIN account_memberships m ON m.account_id=a.id
                    WHERE a.login_normalized=? AND m.company_id=?');
                $lookup->execute([$login,$companyId]);
                $row = $lookup->fetch(PDO::FETCH_ASSOC);
                if ($row && !password_verify($password, $row['password_hash'])) throw new RuntimeException('FIXTURE_IDENTITY_MISMATCH');
                if ($row && (int)$row['active'] === 1) {
                    $pdo->prepare('UPDATE accounts SET active=0,updated_at=? WHERE id=?')->execute([$now,$row['id']]);
                    $pdo->prepare("UPDATE account_memberships SET status='inactive',updated_at=? WHERE id=?")
                        ->execute([$now,$row['membership_id']]);
                    $pdo->prepare('UPDATE account_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL')
                        ->execute([$now,$row['id']]);
                    lehrfahrer_audit_append($pdo, $actor, ['action'=>'MEMBERSHIP_CHANGE','objectType'=>'MEMBERSHIP','objectId'=>$row['membership_id'],'result'=>'SUCCESS']);
                }
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    });
    echo "OK\n";
} catch (Throwable) {
    echo "STAGING_ISOLATION_FIXTURE_FAILED\n";
    exit(1);
}
