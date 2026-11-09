<?php
declare(strict_types=1);

/** A production enrollment code authorizes one pending ceremony, never a session. */
function lehrfahrer_mfa_consume_enrollment_grant(PDO $pdo, string $accountId, ?string $code): bool {
    $environment = lehrfahrer_environment();
    if ($environment !== 'production') {
        $bootstrap = $pdo->query("SELECT value FROM control_metadata WHERE `key`='first_start_completed'")->fetchColumn();
        if ($bootstrap !== $accountId) return true;
    }
    if (!is_string($code) || preg_match('/^[A-Za-z0-9_-]{43}$/D', $code) !== 1) return false;
    $key = 'mfa_enroll_' . $accountId;
    $query = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
    $query->execute([$key]); $value = $query->fetchColumn();
    if (!is_string($value)) return false;
    $grant = json_decode($value, true);
    if (!is_array($grant) || ($grant['environment'] ?? '') !== $environment
        || !is_int($grant['expires'] ?? null) || $grant['expires'] <= time()
        || !is_string($grant['hash'] ?? null) || !hash_equals($grant['hash'], hash('sha256', $code))) return false;
    $delete = $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ? AND value = ?');
    $delete->execute([$key, $value]);
    return $delete->rowCount() === 1;
}
