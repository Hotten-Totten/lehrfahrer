<?php
declare(strict_types=1);
require_once __DIR__ . '/_audit.php';

function lehrfahrer_company_account_primary(PDO $pdo): bool {
    return (lehrfahrer_environment() !== 'production' || lehrfahrer_account_login_enabled()) && lehrfahrer_auth_cutover_state($pdo)['mode'] === 'ACCOUNT_PRIMARY';
}

/** Trusted CLI provisioning only; never attach a new company to an existing account by login. */
function lehrfahrer_company_seed_account(PDO $pdo, string $companyId, string $userId): array {
    if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD']) || !lehrfahrer_control_transaction_active($pdo)) {
        throw new RuntimeException('Account-Provisioning benoetigt einen internen CLI-Vorgang mit Transaktion.');
    }
    $query=$pdo->prepare('SELECT * FROM users WHERE id=? AND company_id=?');
    $query->execute([$userId,$companyId]);$user=$query->fetch(PDO::FETCH_ASSOC);
    if (!is_array($user) || (int)$user['active']!==0 || (int)$user['must_change_password']!==1) {
        throw new RuntimeException('Neuer Firmenadministrator ist nicht eindeutig inaktiv.');
    }
    $accountId=lehrfahrer_control_id('acc');$membershipId=lehrfahrer_control_id('mem');$now=gmdate('c');
    $pdo->prepare('INSERT INTO accounts(id,login_normalized,email_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
        VALUES(?,?,?,?,?,0,1,?,?)')->execute([$accountId,$user['login_normalized'],$user['email_normalized'],$user['display_name'],$user['password_hash'],$now,$now]);
    lehrfahrer_control_allocate_user_number_in_transaction($pdo,$accountId);
    $pdo->prepare("INSERT INTO account_memberships(id,account_id,company_id,status,legacy_user_id,created_at,updated_at)
        VALUES(?,?,?,'inactive',?,?,?)")->execute([$membershipId,$accountId,$companyId,$userId,$now,$now]);
    $role=$pdo->query("SELECT id FROM roles WHERE code='ADMIN'")->fetchColumn();
    if (!is_string($role)) throw new RuntimeException('Administratorrolle fehlt.');
    $pdo->prepare('INSERT INTO membership_roles(membership_id,role_id) VALUES(?,?)')->execute([$membershipId,$role]);
    $actor=LehrfahrerAuditActor::authorizedCli();
    foreach ([['action'=>'ACCOUNT_CREATE','objectType'=>'ACCOUNT','objectId'=>$accountId],
        ['action'=>'MEMBERSHIP_CHANGE','objectType'=>'MEMBERSHIP','objectId'=>$membershipId],
        ['action'=>'TENANT_ROLE_ASSIGN','objectType'=>'MEMBERSHIP','objectId'=>$membershipId,
            'relatedObjectType'=>'TENANT_ROLE','relatedObjectId'=>$role]] as $event) {
        lehrfahrer_audit_append($pdo,$actor,$event+['result'=>'SUCCESS']);
    }
    return ['accountId'=>$accountId,'membershipId'=>$membershipId];
}

/** Called only after the original activation token has been verified and its legacy user locked. */
function lehrfahrer_company_activate_linked_account(PDO $pdo, string $companyId, string $userId, string $passwordHash): void {
    $query=$pdo->prepare('SELECT m.id,m.account_id,m.status,a.active,a.must_change_password FROM account_memberships m
        JOIN accounts a ON a.id=m.account_id WHERE m.company_id=? AND m.legacy_user_id=?'
        .(lehrfahrer_control_driver($pdo)==='mysql'?' FOR UPDATE':''));
    $query->execute([$companyId,$userId]);$rows=$query->fetchAll(PDO::FETCH_ASSOC);
    if ($rows===[] && !lehrfahrer_company_account_primary($pdo)) return;
    if (count($rows)!==1 || $rows[0]['status']!=='inactive' || (int)$rows[0]['active']!==0 || (int)$rows[0]['must_change_password']!==1) {
        throw new RuntimeException('Account-Aktivierungszuordnung ist ungueltig.');
    }
    $row=$rows[0];$now=gmdate('c');
    $update=$pdo->prepare('UPDATE accounts SET password_hash=?,active=1,must_change_password=0,updated_at=? WHERE id=? AND active=0 AND must_change_password=1');
    $update->execute([$passwordHash,$now,$row['account_id']]);
    if ($update->rowCount()!==1) throw new RuntimeException('Account konnte nicht aktiviert werden.');
    $update=$pdo->prepare("UPDATE account_memberships SET status='active',updated_at=? WHERE id=? AND account_id=? AND company_id=? AND status='inactive'");
    $update->execute([$now,$row['id'],$row['account_id'],$companyId]);
    if ($update->rowCount()!==1) throw new RuntimeException('Firmenzuordnung konnte nicht aktiviert werden.');
    $actor=LehrfahrerAuditActor::knownAccount($pdo,(string)$row['account_id']);
    lehrfahrer_audit_append($pdo,$actor,['action'=>'AUTH_ACCOUNT_ACTIVATE','objectType'=>'ACCOUNT','objectId'=>$row['account_id'],'result'=>'SUCCESS']);
    lehrfahrer_audit_append($pdo,$actor,['action'=>'AUTH_MEMBERSHIP_ACTIVATE','objectType'=>'MEMBERSHIP','objectId'=>$row['id'],'result'=>'SUCCESS']);
}
