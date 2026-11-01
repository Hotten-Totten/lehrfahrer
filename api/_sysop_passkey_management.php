<?php
declare(strict_types=1);

require_once __DIR__ . '/_account_auth.php';

function lehrfahrer_sysop_passkeys_audit_denial(PDO $pdo, string $reason): void {
    $session = lehrfahrer_account_current_session($pdo, false);
    $actor = $session === null ? LehrfahrerAuditActor::unauthenticated()
        : LehrfahrerAuditActor::currentAccount($pdo);
    lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_PASSKEY_MANAGE',
        'objectType' => 'PASSKEY', 'result' => 'DENIED', 'reasonCode' => $reason],
        LEHRFAHRER_AUDIT_OPERATIONAL);
}

/** Authentication, second factor and SYSOP assignment are all server authoritative. */
function lehrfahrer_sysop_passkeys_session(PDO $pdo, ?string $csrf = null): ?array {
    if (lehrfahrer_environment() !== 'staging') return null;
    $session = lehrfahrer_account_current_session($pdo, false);
    if ($session === null || $session['mfa_verified_at'] === null
        || !lehrfahrer_sysop_mfa_required($pdo, (string)$session['account_id'])) return null;
    if ($csrf !== null && ($csrf === ''
        || !hash_equals(lehrfahrer_auth_csrf_token((string)$session['_token']), $csrf))) return null;
    return $session;
}

function lehrfahrer_sysop_passkeys_name(string $name): string {
    $name = trim($name);
    if ($name === '' || mb_strlen($name, 'UTF-8') > 120 || preg_match('/[\x00-\x1F\x7F]/', $name)) {
        throw new LehrfahrerMfaRejected('Passkey-Name ungueltig.');
    }
    return $name;
}

function lehrfahrer_sysop_passkeys_list(PDO $pdo): ?array {
    $session = lehrfahrer_sysop_passkeys_session($pdo);
    if ($session === null) return null;
    $query = $pdo->prepare("SELECT id, display_name, created_at, last_used_at, status FROM account_passkeys
        WHERE account_id = ? AND rp_id = ? AND status = 'active' ORDER BY created_at, id");
    $query->execute([$session['account_id'], LEHRFAHRER_SYSOP_MFA_RP_ID]);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    return array_map(static fn(array $row, int $index): array => [
        'id' => (string)$row['id'],
        'name' => trim((string)$row['display_name']) !== '' ? (string)$row['display_name'] : 'Passkey ' . ($index + 1),
        'createdAt' => (string)$row['created_at'],
        'lastUsedAt' => $row['last_used_at'] === null ? null : (string)$row['last_used_at'],
        'status' => 'Aktiv',
    ], $rows, array_keys($rows));
}

function lehrfahrer_sysop_passkeys_begin(PDO $pdo, string $csrf, string $name): ?array {
    $name = lehrfahrer_sysop_passkeys_name($name);
    return lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $csrf, $name): ?array {
        $session = lehrfahrer_sysop_passkeys_session($pdo, $csrf);
        if ($session === null) return null;
        $accountId = (string)$session['account_id'];
        $credentials = lehrfahrer_sysop_mfa_credentials($pdo, $accountId);
        if ($credentials === []) return null;
        $account = $pdo->prepare('SELECT login_normalized, display_name FROM accounts WHERE id = ?');
        $account->execute([$accountId]);
        $user = $account->fetch(PDO::FETCH_ASSOC);
        if (!is_array($user)) return null;
        $ids = array_map(static fn(array $row): string => lehrfahrer_sysop_mfa_decode((string)$row['credential_id']), $credentials);
        $webauthn = lehrfahrer_sysop_mfa_library();
        $options = $webauthn->getCreateArgs($accountId, (string)$user['login_normalized'],
            (string)$user['display_name'], 300, true, true, null, $ids);
        $now = time();
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        if ($mysql) $pdo->beginTransaction();
        try {
            $invalidate = $pdo->prepare("UPDATE account_mfa_pending SET consumed_at = ?
                WHERE account_id = ? AND session_id = ? AND purpose = 'ENROLL' AND consumed_at IS NULL");
            $invalidate->execute([lehrfahrer_auth_timestamp($now), $accountId, $session['id']]);
            $insert = $pdo->prepare("INSERT INTO account_mfa_pending
                (id, account_id, token_hash, purpose, environment, challenge, challenge_expires_at,
                 created_at, expires_at, device_label, session_id)
                VALUES (?, ?, ?, 'ENROLL', 'staging', ?, ?, ?, ?, ?, ?)");
            $insert->execute([lehrfahrer_control_id('mfa'), $accountId,
                lehrfahrer_auth_token_hash(lehrfahrer_auth_random_token()),
                lehrfahrer_sysop_mfa_encode($webauthn->getChallenge()->getBinaryString()),
                lehrfahrer_auth_timestamp($now + 300), lehrfahrer_auth_timestamp($now),
                lehrfahrer_auth_timestamp($now + 300), $name, $session['id']]);
            if ($mysql) $pdo->commit();
            return ['options' => $options];
        } catch (Throwable $error) {
            if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    });
}

function lehrfahrer_sysop_passkeys_finish(PDO $pdo, string $csrf, array $input): bool {
    $success = lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $csrf, $input): bool {
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        if ($mysql) { $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'); $pdo->beginTransaction(); }
        try {
            $session = lehrfahrer_sysop_passkeys_session($pdo, $csrf);
            if ($session === null) { if ($mysql) $pdo->rollBack(); return false; }
            $query = $pdo->prepare("SELECT * FROM account_mfa_pending
                WHERE account_id = ? AND session_id = ? AND purpose = 'ENROLL'
                  AND environment = 'staging' AND consumed_at IS NULL" . ($mysql ? ' FOR UPDATE' : ''));
            $query->execute([$session['account_id'], $session['id']]);
            $rows = $query->fetchAll(PDO::FETCH_ASSOC);
            if (count($rows) !== 1) { if ($mysql) $pdo->rollBack(); return false; }
            $pending = $rows[0];
            $consume = $pdo->prepare('UPDATE account_mfa_pending SET consumed_at = ?, challenge = NULL,
                challenge_expires_at = NULL WHERE id = ? AND consumed_at IS NULL');
            $consume->execute([lehrfahrer_auth_timestamp(time()), $pending['id']]);
            if ($consume->rowCount() !== 1) throw new RuntimeException('Challenge bereits verwendet.');
            try {
                if (strtotime((string)$pending['expires_at']) <= time()
                    || strtotime((string)$pending['challenge_expires_at']) <= time()
                    || !is_string($pending['challenge']) || $pending['challenge'] === '') {
                    throw new LehrfahrerMfaRejected('Challenge abgelaufen.');
                }
                $created = lehrfahrer_sysop_mfa_verify_creation($input, $pending['challenge']);
                $existing = $pdo->prepare('SELECT 1 FROM account_passkeys WHERE credential_id = ?');
                $existing->execute([$created['credentialId']]);
                if ($existing->fetchColumn() !== false) throw new LehrfahrerMfaRejected('Passkey bereits vorhanden.');
                $insert = $pdo->prepare("INSERT INTO account_passkeys
                    (id, account_id, credential_id, public_key, sign_count, rp_id, status, created_at, display_name)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)");
                $passkeyId = lehrfahrer_control_id('pkey');
                $insert->execute([$passkeyId, $session['account_id'], $created['credentialId'],
                    $created['publicKey'], $created['signCount'], LEHRFAHRER_SYSOP_MFA_RP_ID,
                    lehrfahrer_auth_timestamp(time()), $pending['device_label']]);
                lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::currentAccount($pdo),
                    ['action' => 'AUTH_PASSKEY_REGISTER', 'objectType' => 'PASSKEY',
                        'objectId' => $passkeyId, 'result' => 'SUCCESS']);
                if ($mysql) $pdo->commit();
                return true;
            } catch (LehrfahrerMfaRejected|\lbuchs\WebAuthn\WebAuthnException|JsonException $_verificationError) {
                if ($mysql) $pdo->commit();
                return false;
            }
        } catch (Throwable $error) {
            if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    });
    if (!$success) lehrfahrer_sysop_passkeys_audit_denial($pdo, 'MFA_REJECTED');
    return $success;
}

function lehrfahrer_sysop_passkeys_rename(PDO $pdo, string $csrf, string $id, string $name): bool {
    $name = lehrfahrer_sysop_passkeys_name($name);
    $success = lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $csrf, $id, $name): bool {
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        if ($mysql) $pdo->beginTransaction();
        try {
            $session = lehrfahrer_sysop_passkeys_session($pdo, $csrf);
            if ($session === null || $id === '') { if ($mysql) $pdo->rollBack(); return false; }
            $query = $pdo->prepare("SELECT display_name FROM account_passkeys
                WHERE id = ? AND account_id = ? AND rp_id = ? AND status = 'active'" . ($mysql ? ' FOR UPDATE' : ''));
            $query->execute([$id, $session['account_id'], LEHRFAHRER_SYSOP_MFA_RP_ID]);
            $current = $query->fetchColumn();
            if ($current === false) { if ($mysql) $pdo->rollBack(); return false; }
            if ($current !== $name) {
                $update = $pdo->prepare("UPDATE account_passkeys SET display_name = ?
                    WHERE id = ? AND account_id = ? AND rp_id = ? AND status = 'active'");
                $update->execute([$name, $id, $session['account_id'], LEHRFAHRER_SYSOP_MFA_RP_ID]);
                if ($update->rowCount() !== 1) throw new RuntimeException('Passkey-Umbenennung fehlgeschlagen.');
                lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::currentAccount($pdo),
                    ['action' => 'AUTH_PASSKEY_RENAME', 'objectType' => 'PASSKEY',
                        'objectId' => $id, 'result' => 'SUCCESS']);
            }
            if ($mysql) $pdo->commit();
            return true;
        } catch (Throwable $error) {
            if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    });
    if (!$success) lehrfahrer_sysop_passkeys_audit_denial($pdo, 'CONFLICT');
    return $success;
}

function lehrfahrer_sysop_passkeys_revoke(PDO $pdo, string $csrf, string $id): bool {
    $success = lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $csrf, $id): bool {
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        if ($mysql) { $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'); $pdo->beginTransaction(); }
        try {
            $session = lehrfahrer_sysop_passkeys_session($pdo, $csrf);
            if ($session === null || $id === '') { if ($mysql) $pdo->rollBack(); return false; }
            $query = $pdo->prepare("SELECT id FROM account_passkeys
                WHERE account_id = ? AND rp_id = ? AND status = 'active'" . ($mysql ? ' FOR UPDATE' : ''));
            $query->execute([$session['account_id'], LEHRFAHRER_SYSOP_MFA_RP_ID]);
            $active = $query->fetchAll(PDO::FETCH_COLUMN);
            if (count($active) < 2 || !in_array($id, $active, true)) {
                if ($mysql) $pdo->rollBack();
                return false;
            }
            $update = $pdo->prepare("UPDATE account_passkeys SET status = 'revoked', revoked_at = ?
                WHERE id = ? AND account_id = ? AND rp_id = ? AND status = 'active'");
            $update->execute([lehrfahrer_auth_timestamp(time()), $id, $session['account_id'], LEHRFAHRER_SYSOP_MFA_RP_ID]);
            if ($update->rowCount() !== 1) throw new RuntimeException('Passkey-Widerruf fehlgeschlagen.');
            lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::currentAccount($pdo),
                ['action' => 'AUTH_PASSKEY_REVOKE', 'objectType' => 'PASSKEY',
                    'objectId' => $id, 'result' => 'SUCCESS']);
            if ($mysql) $pdo->commit();
            return true;
        } catch (Throwable $error) {
            if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    });
    if (!$success) lehrfahrer_sysop_passkeys_audit_denial($pdo, 'CONFLICT');
    return $success;
}
