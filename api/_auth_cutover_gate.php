<?php
declare(strict_types=1);

require_once __DIR__ . '/_control_database.php';
require_once __DIR__ . '/_account_configuration.php';

final class LehrfahrerAuthCutoverBusy extends RuntimeException {}

function lehrfahrer_auth_cutover_state(PDO $pdo): array {
    $query = $pdo->prepare('SELECT `key`, value FROM control_metadata WHERE `key` IN (?, ?)');
    $query->execute(['auth_mode', 'auth_cutover_lock']);
    $values = $query->fetchAll(PDO::FETCH_KEY_PAIR);
    if (lehrfahrer_environment() === 'production' && lehrfahrer_account_login_enabled()) {
        $environment = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
        $environment->execute(['environment']);
        if ($environment->fetchColumn() !== 'production' || !isset($values['auth_mode'], $values['auth_cutover_lock'])) {
            throw new RuntimeException('Produktiver Auth-Zustand ist nicht eindeutig gebunden.');
        }
    }
    $mode = $values['auth_mode'] ?? 'PARALLEL';
    $lock = $values['auth_cutover_lock'] ?? 'OPEN';
    if (!in_array($mode, ['PARALLEL', 'ACCOUNT_PRIMARY'], true)
        || !in_array($lock, ['OPEN', 'LOCKED'], true)) {
        throw new RuntimeException('Auth-Cutover-Zustand ist ungültig.');
    }
    return ['mode' => $mode, 'lock' => $lock];
}

/** The future cutover must use this exact lock before setting LOCKED. */
function lehrfahrer_auth_cutover_lock_name(PDO $pdo): string {
    return lehrfahrer_control_mysql_lock_name($pdo) . '_auth';
}

function lehrfahrer_auth_cutover_begin_sqlite(PDO $pdo): void {
    try {
        lehrfahrer_control_sqlite_begin_immediate($pdo);
    } catch (PDOException $error) {
        if ((int)($error->errorInfo[1] ?? 0) === 5) {
            throw new LehrfahrerAuthCutoverBusy('Auth-Sperre nicht verfügbar.', 0, $error);
        }
        throw $error;
    }
}

function lehrfahrer_with_auth_mutation_gate(PDO $pdo, callable $action): mixed {
    static $active = [];
    $id = spl_object_id($pdo);
    if (isset($active[$id])) return $action();
    if (lehrfahrer_control_transaction_active($pdo)) throw new LogicException('Auth-Mutation in fremder Transaktion.');
    $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
    $lockName = $mysql ? lehrfahrer_auth_cutover_lock_name($pdo) : null;
    if ($mysql) {
        $acquire = $pdo->prepare('SELECT GET_LOCK(?, 15)');
        $acquire->execute([$lockName]);
        if ((int)$acquire->fetchColumn() !== 1) throw new LehrfahrerAuthCutoverBusy('Auth-Sperre nicht verfügbar.');
    } else {
        lehrfahrer_auth_cutover_begin_sqlite($pdo);
    }
    $active[$id] = true;
    try {
        if (lehrfahrer_auth_cutover_state($pdo)['lock'] !== 'OPEN') {
            throw new LehrfahrerAuthCutoverBusy('Auth-Cutover läuft.');
        }
        $result = $action();
        if (!$mysql) lehrfahrer_control_sqlite_finish($pdo, true);
        return $result;
    } catch (Throwable $error) {
        if (!$mysql && lehrfahrer_control_transaction_active($pdo)) lehrfahrer_control_sqlite_finish($pdo, false);
        throw $error;
    } finally {
        unset($active[$id]);
        if ($mysql) {
            $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$lockName]);
        }
    }
}

/** Explicit recovery only. No timer may reopen authentication during a running cutover. */
function lehrfahrer_auth_cutover_set_lock(PDO $pdo, string $state, ?string $owner = null): void {
    if (!in_array($state, ['LOCKED', 'OPEN'], true) || (lehrfahrer_environment() === 'production'
        && (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD']) || $owner === null
            || !lehrfahrer_account_login_enabled()))) {
        throw new RuntimeException('Cutover-Sperre ist hier nicht erlaubt.');
    }
    if ($owner !== null && !preg_match('/^[0-9]+-[0-9]+$/D', $owner)) {
        throw new RuntimeException('Cutover-Eigentuemer ist ungueltig.');
    }
    $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
    if ($mysql) {
        $lockName = lehrfahrer_auth_cutover_lock_name($pdo);
        $acquire = $pdo->prepare('SELECT GET_LOCK(?, 15)');
        $acquire->execute([$lockName]);
        if ((int)$acquire->fetchColumn() !== 1) throw new LehrfahrerAuthCutoverBusy('Auth-Sperre nicht verfügbar.');
    } else {
        lehrfahrer_auth_cutover_begin_sqlite($pdo);
    }
    try {
        if ($mysql) $pdo->beginTransaction();
        $current = lehrfahrer_auth_cutover_state($pdo);
        $ownerQuery = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
        $ownerQuery->execute(['auth_cutover_owner']);
        $storedOwner = $ownerQuery->fetchColumn();
        if ($state === 'LOCKED' && $current['mode'] !== 'PARALLEL' && lehrfahrer_environment() !== 'production') {
            throw new RuntimeException('Auth-Modus ist nicht PARALLEL.');
        }
        if ($state === 'LOCKED' && $current['lock'] !== 'OPEN') throw new RuntimeException('Cutover bereits gesperrt.');
        if ($state === 'OPEN' && $current['lock'] !== 'LOCKED') throw new RuntimeException('Keine Cutover-Sperre aktiv.');
        if ($state === 'LOCKED' && $storedOwner !== false) throw new RuntimeException('Cutover-Vorgang bereits markiert.');
        if ($state === 'OPEN' && ($owner === null ? $storedOwner !== false
            : !is_string($storedOwner) || !hash_equals($owner, $storedOwner))) {
            throw new RuntimeException('Cutover-Eigentuemer stimmt nicht.');
        }
        $now = gmdate('c');
        $exists = $pdo->prepare('SELECT 1 FROM control_metadata WHERE `key` = ?');
        $exists->execute(['auth_cutover_lock']);
        if ($exists->fetchColumn() === false) {
            $insert = $pdo->prepare('INSERT INTO control_metadata (`key`, value, updated_at) VALUES (?, ?, ?)');
            $insert->execute(['auth_cutover_lock', $state, $now]);
        } else {
            $update = $pdo->prepare('UPDATE control_metadata SET value = ?, updated_at = ? WHERE `key` = ?');
            $update->execute([$state, $now, 'auth_cutover_lock']);
        }
        if ($state === 'LOCKED' && $owner !== null) {
            $insertOwner = $pdo->prepare('INSERT INTO control_metadata (`key`, value, updated_at) VALUES (?, ?, ?)');
            $insertOwner->execute(['auth_cutover_owner', $owner, $now]);
        }
        if ($state === 'OPEN' && lehrfahrer_environment() === 'production') {
            $deleteOwner = $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ? AND value = ?');
            $deleteOwner->execute(['auth_cutover_owner', $owner]);
        }
        if ($mysql) $pdo->commit(); else lehrfahrer_control_sqlite_finish($pdo, true);
    } catch (Throwable $error) {
        if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
        elseif (!$mysql && lehrfahrer_control_transaction_active($pdo)) lehrfahrer_control_sqlite_finish($pdo, false);
        throw $error;
    } finally {
        if ($mysql) {
            $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$lockName]);
        }
    }
}
