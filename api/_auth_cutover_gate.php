<?php
declare(strict_types=1);

require_once __DIR__ . '/_control_database.php';

final class LehrfahrerAuthCutoverBusy extends RuntimeException {}

function lehrfahrer_auth_cutover_state(PDO $pdo): array {
    $query = $pdo->prepare('SELECT `key`, value FROM control_metadata WHERE `key` IN (?, ?)');
    $query->execute(['auth_mode', 'auth_cutover_lock']);
    $values = $query->fetchAll(PDO::FETCH_KEY_PAIR);
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
        $pdo->exec('BEGIN IMMEDIATE');
    } catch (PDOException $error) {
        if ((int)($error->errorInfo[1] ?? 0) === 5) {
            throw new LehrfahrerAuthCutoverBusy('Auth-Sperre nicht verfügbar.', 0, $error);
        }
        throw $error;
    }
}

function lehrfahrer_with_auth_mutation_gate(PDO $pdo, callable $action): mixed {
    if (lehrfahrer_environment() === 'production') return $action();
    static $active = [];
    $id = spl_object_id($pdo);
    if (isset($active[$id])) return $action();
    if ($pdo->inTransaction()) throw new LogicException('Auth-Mutation in fremder Transaktion.');
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
        if (!$mysql) $pdo->exec('COMMIT');
        return $result;
    } catch (Throwable $error) {
        if (!$mysql) $pdo->exec('ROLLBACK');
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
function lehrfahrer_auth_cutover_set_lock(PDO $pdo, string $state): void {
    if (lehrfahrer_environment() === 'production' || !in_array($state, ['LOCKED', 'OPEN'], true)) {
        throw new RuntimeException('Cutover-Sperre ist hier nicht erlaubt.');
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
        if ($state === 'LOCKED' && $current['mode'] !== 'PARALLEL') {
            throw new RuntimeException('Auth-Modus ist nicht PARALLEL.');
        }
        if ($state === 'LOCKED' && $current['lock'] !== 'OPEN') throw new RuntimeException('Cutover bereits gesperrt.');
        if ($state === 'OPEN' && $current['lock'] !== 'LOCKED') throw new RuntimeException('Keine Cutover-Sperre aktiv.');
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
        if ($mysql) $pdo->commit(); else $pdo->exec('COMMIT');
    } catch (Throwable $error) {
        if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
        elseif (!$mysql) $pdo->exec('ROLLBACK');
        throw $error;
    } finally {
        if ($mysql) {
            $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$lockName]);
        }
    }
}
