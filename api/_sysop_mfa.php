<?php
declare(strict_types=1);

require_once __DIR__ . '/_auth_cutover_gate.php';
require_once __DIR__ . '/_mfa_enrollment_grant.php';

const LEHRFAHRER_SYSOP_MFA_COOKIE = '__Host-lehrfahrer_mfa_pending';
final class LehrfahrerMfaRejected extends RuntimeException {}

function lehrfahrer_sysop_mfa_required(PDO $pdo, string $accountId): bool {
    if (!lehrfahrer_account_login_enabled()) return false;
    $query = $pdo->prepare('SELECT COUNT(*) FROM sysop_assignment WHERE account_id = ?');
    $query->execute([$accountId]);
    return (int)$query->fetchColumn() === 1;
}

function lehrfahrer_sysop_mfa_credentials(PDO $pdo, string $accountId): array {
    $query = $pdo->prepare("SELECT id, credential_id, public_key, sign_count FROM account_passkeys
        WHERE account_id = ? AND status = 'active' AND rp_id = ? ORDER BY created_at, id");
    $query->execute([$accountId, lehrfahrer_sysop_mfa_rp_id()]);
    return $query->fetchAll(PDO::FETCH_ASSOC);
}

function lehrfahrer_sysop_mfa_pending_token(): string {
    $token = $_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] ?? '';
    return is_string($token) && preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) === 1 ? $token : '';
}

function lehrfahrer_sysop_mfa_set_cookie(string $token, int $expires): void {
    if (!setcookie(LEHRFAHRER_SYSOP_MFA_COOKIE, $token, lehrfahrer_auth_cookie_options($expires))) {
        throw new RuntimeException('Sicherheitspruefung konnte nicht gestartet werden.');
    }
}

function lehrfahrer_sysop_mfa_clear_cookie(): void {
    setcookie(LEHRFAHRER_SYSOP_MFA_COOKIE, '', lehrfahrer_auth_cookie_options(time() - 3600));
}

function lehrfahrer_sysop_mfa_encode(string $bytes): string {
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function lehrfahrer_sysop_mfa_decode(string $encoded): string {
    if ($encoded === '' || preg_match('/^[A-Za-z0-9_-]+$/D', $encoded) !== 1) {
        throw new LehrfahrerMfaRejected('Ungueltige WebAuthn-Daten.');
    }
    $bytes = base64_decode(strtr($encoded, '-_', '+/'), true);
    if ($bytes === false || !hash_equals($encoded, lehrfahrer_sysop_mfa_encode($bytes))) {
        throw new LehrfahrerMfaRejected('Ungueltige WebAuthn-Daten.');
    }
    return $bytes;
}

function lehrfahrer_sysop_mfa_library(): \lbuchs\WebAuthn\WebAuthn {
    $path = __DIR__ . '/third_party/lbuchs-webauthn-v2.2.0/src';
    $old = get_include_path();
    set_include_path($path . PATH_SEPARATOR . $old);
    try { require_once $path . '/WebAuthn.php'; }
    finally { set_include_path($old); }
    return new \lbuchs\WebAuthn\WebAuthn(lehrfahrer_account_configuration()['name'], lehrfahrer_sysop_mfa_rp_id(), ['none'], true);
}

function lehrfahrer_sysop_mfa_start_unguarded(PDO $pdo, string $accountId, ?string $deviceLabel, ?string $enrollmentCode = null): ?array {
    $credentials = lehrfahrer_sysop_mfa_credentials($pdo, $accountId);
    $purpose = $credentials === [] ? 'ENROLL' : 'AUTH';
    if ($purpose === 'ENROLL' && !lehrfahrer_mfa_consume_enrollment_grant($pdo, $accountId, $enrollmentCode)) return null;
    $token = lehrfahrer_auth_random_token();
    $now = time();
    $label = trim((string)$deviceLabel);
    $label = function_exists('mb_substr') ? mb_substr($label, 0, 120, 'UTF-8') : substr($label, 0, 120);
    $query = $pdo->prepare('INSERT INTO account_mfa_pending
        (id, account_id, token_hash, purpose, environment, created_at, expires_at, device_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $query->execute([lehrfahrer_control_id('mfa'), $accountId, lehrfahrer_auth_token_hash($token),
        $purpose, lehrfahrer_environment(), lehrfahrer_auth_timestamp($now),
        lehrfahrer_auth_timestamp($now + 600), $label === '' ? null : $label]);
    return ['mfaPending' => true, 'purpose' => $purpose, 'token' => $token,
        'csrf' => lehrfahrer_auth_csrf_token($token), 'expiresAt' => $now + 600];
}

function lehrfahrer_sysop_mfa_pending(PDO $pdo, bool $lock = false): ?array {
    $token = lehrfahrer_sysop_mfa_pending_token();
    if ($token === '') return null;
    $query = $pdo->prepare('SELECT p.*, a.active, a.must_change_password FROM account_mfa_pending p
        JOIN accounts a ON a.id = p.account_id
        WHERE p.token_hash = ? AND p.environment = ?' .
        ($lock && lehrfahrer_control_driver($pdo) === 'mysql' ? ' FOR UPDATE' : ''));
    $query->execute([lehrfahrer_auth_token_hash($token), lehrfahrer_environment()]);
    $pending = $query->fetch(PDO::FETCH_ASSOC);
    if (!is_array($pending) || $pending['consumed_at'] !== null
        || strtotime((string)$pending['expires_at']) <= time()
        || (int)$pending['active'] !== 1 || (int)$pending['must_change_password'] !== 0
        || !lehrfahrer_sysop_mfa_required($pdo, (string)$pending['account_id'])) return null;
    $credentials = lehrfahrer_sysop_mfa_credentials($pdo, (string)$pending['account_id']);
    if (($pending['purpose'] === 'ENROLL') !== ($credentials === [])) return null;
    $pending['_token'] = $token;
    $pending['_credentials'] = $credentials;
    return $pending;
}

/** Only server-stored pending rows may contribute an account identity to denial audit. */
function lehrfahrer_sysop_mfa_denial_audit(PDO $pdo): array {
    require_once __DIR__ . '/_audit.php';
    $token = lehrfahrer_sysop_mfa_pending_token();
    if ($token === '') return [LehrfahrerAuditActor::unauthenticated(), 'MFA_REJECTED'];
    $query = $pdo->prepare('SELECT account_id,consumed_at,expires_at,challenge_expires_at
        FROM account_mfa_pending WHERE token_hash = ? AND environment = ?');
    $query->execute([lehrfahrer_auth_token_hash($token), lehrfahrer_environment()]);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) !== 1) return [LehrfahrerAuditActor::unauthenticated(), 'MFA_REJECTED'];
    $row = $rows[0];
    $reason = $row['consumed_at'] !== null ? 'CHALLENGE_REPLAY'
        : (strtotime((string)$row['expires_at']) <= time()
            || ($row['challenge_expires_at'] !== null
                && strtotime((string)$row['challenge_expires_at']) <= time())
            ? 'EXPIRED' : 'MFA_REJECTED');
    return [LehrfahrerAuditActor::knownAccount($pdo, (string)$row['account_id']), $reason];
}

function lehrfahrer_sysop_mfa_begin(PDO $pdo, string $csrf): ?array {
    return lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $csrf): ?array {
        $pending = lehrfahrer_sysop_mfa_pending($pdo);
        if ($pending === null || !hash_equals(lehrfahrer_auth_csrf_token($pending['_token']), $csrf)) return null;
        $webauthn = lehrfahrer_sysop_mfa_library();
        if ($pending['purpose'] === 'ENROLL') {
            $account = $pdo->prepare('SELECT login_normalized, display_name FROM accounts WHERE id = ?');
            $account->execute([(string)$pending['account_id']]);
            $user = $account->fetch(PDO::FETCH_ASSOC);
            if (!is_array($user)) return null;
            $options = $webauthn->getCreateArgs((string)$pending['account_id'],
                (string)$user['login_normalized'], (string)$user['display_name'], 300, true, true);
        } else {
            $ids = array_map(static fn(array $row): string => lehrfahrer_sysop_mfa_decode((string)$row['credential_id']),
                $pending['_credentials']);
            $options = $webauthn->getGetArgs($ids, 300, true, true, true, true, true, true);
        }
        $query = $pdo->prepare('UPDATE account_mfa_pending SET challenge = ?, challenge_expires_at = ?
            WHERE id = ? AND consumed_at IS NULL');
        $query->execute([lehrfahrer_sysop_mfa_encode($webauthn->getChallenge()->getBinaryString()),
            lehrfahrer_auth_timestamp(min(time() + 300, strtotime((string)$pending['expires_at']))), $pending['id']]);
        if ($query->rowCount() !== 1) return null;
        return ['purpose' => $pending['purpose'], 'options' => $options];
    });
}

function lehrfahrer_sysop_mfa_validate_client(string $clientData, string $type): void {
    $client = json_decode($clientData, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($client) || ($client['type'] ?? null) !== $type
        || ($client['origin'] ?? null) !== lehrfahrer_sysop_mfa_origin()) {
        throw new LehrfahrerMfaRejected('WebAuthn-Origin oder Typ ungueltig.');
    }
}

/** Shared verification for first enrollment and an additional credential. */
function lehrfahrer_sysop_mfa_verify_creation(array $input, string $challenge): array {
    foreach (['id', 'clientDataJSON', 'attestationObject'] as $field) {
        if (!isset($input[$field]) || !is_string($input[$field])) {
            throw new LehrfahrerMfaRejected('WebAuthn-Antwort ungueltig.');
        }
    }
    $clientData = lehrfahrer_sysop_mfa_decode($input['clientDataJSON']);
    lehrfahrer_sysop_mfa_validate_client($clientData, 'webauthn.create');
    $data = lehrfahrer_sysop_mfa_library()->processCreate($clientData,
        lehrfahrer_sysop_mfa_decode($input['attestationObject']),
        lehrfahrer_sysop_mfa_decode($challenge), true);
    $credentialId = lehrfahrer_sysop_mfa_encode((string)$data->credentialId);
    if (!hash_equals($credentialId, $input['id']) || $data->rpId !== lehrfahrer_sysop_mfa_rp_id()) {
        throw new LehrfahrerMfaRejected('Credential ungueltig.');
    }
    return ['credentialId' => $credentialId, 'publicKey' => (string)$data->credentialPublicKey,
        'signCount' => (int)($data->signatureCounter ?? 0)];
}

/** Always consumes the challenge, including on a failed WebAuthn assertion. */
function lehrfahrer_sysop_mfa_finish(PDO $pdo, string $csrf, array $input): ?array {
    $denialBefore = lehrfahrer_sysop_mfa_denial_audit($pdo);
    try {
        $result = lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $csrf, $input): ?array {
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        if ($mysql) { $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'); $pdo->beginTransaction(); }
        try {
            $pending = lehrfahrer_sysop_mfa_pending($pdo, true);
            if ($pending === null || !hash_equals(lehrfahrer_auth_csrf_token($pending['_token']), $csrf)) {
                if ($mysql) $pdo->rollBack();
                return null;
            }
            $challenge = $pending['challenge'];
            $validChallenge = is_string($challenge) && $challenge !== ''
                && strtotime((string)$pending['challenge_expires_at']) > time();
            $clear = $pdo->prepare('UPDATE account_mfa_pending SET challenge = NULL, challenge_expires_at = NULL WHERE id = ?');
            $clear->execute([$pending['id']]);
            if (!$validChallenge) { if ($mysql) $pdo->commit(); return null; }
            try {
                foreach (['id', 'clientDataJSON'] as $field) {
                    if (!isset($input[$field]) || !is_string($input[$field])) {
                        throw new LehrfahrerMfaRejected('WebAuthn-Antwort ungueltig.');
                    }
                }
                $responseField = $pending['purpose'] === 'ENROLL' ? ['attestationObject']
                    : ['authenticatorData', 'signature'];
                foreach ($responseField as $field) {
                    if (!isset($input[$field]) || !is_string($input[$field])) {
                        throw new LehrfahrerMfaRejected('WebAuthn-Antwort ungueltig.');
                    }
                }
                $clientData = lehrfahrer_sysop_mfa_decode((string)($input['clientDataJSON'] ?? ''));
                $webauthn = lehrfahrer_sysop_mfa_library();
                if ($pending['purpose'] === 'ENROLL') {
                    $created = lehrfahrer_sysop_mfa_verify_creation($input, $challenge);
                    $passkeyId = lehrfahrer_control_id('pkey');
                    $insert = $pdo->prepare("INSERT INTO account_passkeys
                        (id, account_id, credential_id, public_key, sign_count, rp_id, status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)");
                    $insert->execute([$passkeyId, $pending['account_id'], $created['credentialId'],
                        $created['publicKey'], $created['signCount'],
                        lehrfahrer_sysop_mfa_rp_id(), lehrfahrer_auth_timestamp(time())]);
                    $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
                        WHERE account_id = ? AND environment = ? AND revoked_at IS NULL');
                    $revoke->execute([lehrfahrer_auth_timestamp(time()), $pending['account_id'], lehrfahrer_environment()]);
                    require_once __DIR__ . '/_audit.php';
                    lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::knownAccount($pdo, (string)$pending['account_id']),
                        ['action' => 'AUTH_PASSKEY_REGISTER', 'objectType' => 'PASSKEY',
                            'objectId' => $passkeyId, 'result' => 'SUCCESS']);
                    if ($revoke->rowCount() > 0) {
                        lehrfahrer_audit_append($pdo,
                            LehrfahrerAuditActor::knownAccount($pdo, (string)$pending['account_id']),
                            ['action' => 'AUTH_SESSION_REVOKE', 'objectType' => 'SESSION',
                                'result' => 'SUCCESS']);
                    }
                    $result = ['enrolled' => true];
                } else {
                    lehrfahrer_sysop_mfa_validate_client($clientData, 'webauthn.get');
                    $credentialId = (string)($input['id'] ?? '');
                    $matches = array_values(array_filter($pending['_credentials'],
                        static fn(array $row): bool => hash_equals((string)$row['credential_id'], $credentialId)));
                    if (count($matches) !== 1) throw new LehrfahrerMfaRejected('Credential nicht zugeordnet.');
                    $credential = $matches[0];
                    if (isset($input['userHandle']) && $input['userHandle'] !== null
                        && lehrfahrer_sysop_mfa_decode((string)$input['userHandle']) !== (string)$pending['account_id']) {
                        throw new LehrfahrerMfaRejected('Account-ID ungueltig.');
                    }
                    $webauthn->processGet($clientData,
                        lehrfahrer_sysop_mfa_decode((string)($input['authenticatorData'] ?? '')),
                        lehrfahrer_sysop_mfa_decode((string)($input['signature'] ?? '')),
                        (string)$credential['public_key'], lehrfahrer_sysop_mfa_decode($challenge),
                        (int)$credential['sign_count'], true);
                    $update = $pdo->prepare('UPDATE account_passkeys SET sign_count = ?, last_used_at = ?
                        WHERE id = ? AND account_id = ? AND status = ?');
                    $update->execute([(int)$webauthn->getSignatureCounter(), lehrfahrer_auth_timestamp(time()),
                        $credential['id'], $pending['account_id'], 'active']);
                    if ($update->rowCount() !== 1) throw new RuntimeException('Credential nicht mehr aktiv.');
                    $memberships = lehrfahrer_account_memberships($pdo, (string)$pending['account_id']);
                    $platform = lehrfahrer_account_platform_capabilities($pdo, (string)$pending['account_id']);
                    $context = count($memberships) === 1 ? 'TENANT'
                        : (count($memberships) === 0 && $platform !== [] ? 'PLATFORM' : 'PENDING');
                    $session = lehrfahrer_account_create_session($pdo, (string)$pending['account_id'], $context,
                        $context === 'TENANT' ? (string)$memberships[0]['id'] : null,
                        $pending['device_label'], true);
                    require_once __DIR__ . '/_audit.php';
                    $auditActor = LehrfahrerAuditActor::createdSession($pdo, $session['token']);
                    lehrfahrer_audit_append($pdo, $auditActor, ['action' => 'AUTH_MFA',
                        'objectType' => 'PASSKEY', 'objectId' => (string)$credential['id'], 'result' => 'SUCCESS']);
                    lehrfahrer_audit_append($pdo, $auditActor, ['action' => 'AUTH_LOGIN', 'result' => 'SUCCESS']);
                    $result = ['enrolled' => false, 'session' => $session];
                }
                $consume = $pdo->prepare('UPDATE account_mfa_pending SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL');
                $consume->execute([lehrfahrer_auth_timestamp(time()), $pending['id']]);
                if ($consume->rowCount() !== 1) throw new RuntimeException('Sicherheitspruefung bereits verwendet.');
                if ($mysql) $pdo->commit();
                return $result;
            } catch (LehrfahrerMfaRejected|\lbuchs\WebAuthn\WebAuthnException|JsonException $_verificationError) {
                if ($mysql) $pdo->commit();
                return null;
            }
        } catch (Throwable $error) {
            if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        });
    } catch (Throwable $error) {
        if (!$error instanceof LehrfahrerAuditWriteFailure) {
            [$actor] = lehrfahrer_sysop_mfa_denial_audit($pdo);
            lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_MFA',
                'objectType' => 'PASSKEY', 'result' => 'FAILED', 'reasonCode' => 'INTERNAL_FAILURE'],
                LEHRFAHRER_AUDIT_OPERATIONAL);
        }
        throw $error;
    }
    if ($result === null) {
        [$actor, $reason] = lehrfahrer_sysop_mfa_denial_audit($pdo);
        if ($reason === 'MFA_REJECTED' && $denialBefore[1] !== 'MFA_REJECTED') $reason = $denialBefore[1];
        lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_MFA',
            'objectType' => 'PASSKEY', 'result' => 'DENIED', 'reasonCode' => $reason],
            LEHRFAHRER_AUDIT_OPERATIONAL);
    }
    return $result;
}
