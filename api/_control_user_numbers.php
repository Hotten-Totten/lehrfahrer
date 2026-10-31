<?php
declare(strict_types=1);

/**
 * Global account numbers. The registry is a permanent consumption ledger: deleting an
 * account clears only current_account_id, never the issued number or historical ID.
 * A future, separately authorized SysOp bootstrap can retire the old current mapping
 * and assign reserved number 1 in one audited transaction. This module does not do so.
 */
function lehrfahrer_control_apply_user_number_schema(PDO $pdo): void {
    $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
    if ($mysql) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_user_number_allocator (
            singleton_key TINYINT UNSIGNED NOT NULL PRIMARY KEY CHECK (singleton_key = 1),
            next_number BIGINT UNSIGNED NOT NULL CHECK (next_number >= 101)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_user_numbers (
            user_number BIGINT UNSIGNED NOT NULL PRIMARY KEY CHECK (user_number >= 1),
            issued_to_account_id VARCHAR(64) NOT NULL,
            current_account_id VARCHAR(64) NULL UNIQUE,
            issued_at VARCHAR(35) NOT NULL,
            CONSTRAINT account_user_number_current_fk FOREIGN KEY (current_account_id)
                REFERENCES accounts(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $triggerQuery = $pdo->prepare('SELECT COUNT(*) FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?');
        $triggerQuery->execute(['account_user_numbers_no_delete']);
        if ((int)$triggerQuery->fetchColumn() === 0) {
            $pdo->exec("CREATE TRIGGER account_user_numbers_no_delete BEFORE DELETE ON account_user_numbers
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User numbers are permanent'");
        }
        $triggerQuery->execute(['account_user_numbers_no_reassign']);
        if ((int)$triggerQuery->fetchColumn() === 0) {
            $pdo->exec("CREATE TRIGGER account_user_numbers_no_reassign BEFORE UPDATE ON account_user_numbers
                FOR EACH ROW BEGIN
                    IF NEW.user_number <> OLD.user_number OR NEW.issued_to_account_id <> OLD.issued_to_account_id
                       OR NEW.issued_at <> OLD.issued_at
                       OR (OLD.current_account_id IS NULL AND NEW.current_account_id IS NOT NULL)
                       OR (OLD.current_account_id IS NOT NULL AND NEW.current_account_id IS NOT NULL
                           AND OLD.current_account_id <> NEW.current_account_id) THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issued user number is immutable';
                    END IF;
                END");
        }
    } else {
        $pdo->exec('CREATE TABLE IF NOT EXISTS account_user_number_allocator (
            singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
            next_number INTEGER NOT NULL CHECK (next_number >= 101)
        )');
        $pdo->exec('CREATE TABLE IF NOT EXISTS account_user_numbers (
            user_number INTEGER PRIMARY KEY CHECK (user_number >= 1),
            issued_to_account_id TEXT NOT NULL,
            current_account_id TEXT NULL UNIQUE,
            issued_at TEXT NOT NULL,
            FOREIGN KEY (current_account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )');
        $pdo->exec("CREATE TRIGGER IF NOT EXISTS account_user_numbers_no_delete
            BEFORE DELETE ON account_user_numbers BEGIN
                SELECT RAISE(ABORT, 'User numbers are permanent');
            END");
        $pdo->exec("CREATE TRIGGER IF NOT EXISTS account_user_numbers_no_reassign
            BEFORE UPDATE ON account_user_numbers
            WHEN NEW.user_number <> OLD.user_number
              OR NEW.issued_to_account_id <> OLD.issued_to_account_id
              OR NEW.issued_at <> OLD.issued_at
              OR (OLD.current_account_id IS NULL AND NEW.current_account_id IS NOT NULL)
              OR (OLD.current_account_id IS NOT NULL AND NEW.current_account_id IS NOT NULL
                  AND OLD.current_account_id <> NEW.current_account_id)
            BEGIN SELECT RAISE(ABORT, 'Issued user number is immutable'); END");
    }

    // SQLite's outer BEGIN IMMEDIATE is issued through exec() by the migrator;
    // PDO::inTransaction() does not report that SQL-level transaction.
    $ownsTransaction = $mysql && !$pdo->inTransaction();
    if ($ownsTransaction) $pdo->beginTransaction();
    try {
        $rows = $pdo->query('SELECT singleton_key, next_number FROM account_user_number_allocator')->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            $pdo->exec('INSERT INTO account_user_number_allocator (singleton_key, next_number) VALUES (1, 101)');
        } elseif (count($rows) !== 1 || (int)$rows[0]['singleton_key'] !== 1 || (int)$rows[0]['next_number'] < 101) {
            throw new RuntimeException('User-number allocator is invalid.');
        }
        // created_at comes from the legacy account; account ID is the stable tie-breaker.
        $accounts = $pdo->query('SELECT id FROM accounts ORDER BY created_at, id')->fetchAll(PDO::FETCH_COLUMN);
        foreach ($accounts as $accountId) {
            $existing = lehrfahrer_control_user_number_for_account($pdo, (string)$accountId);
            if ($existing === null) lehrfahrer_control_allocate_user_number_in_transaction($pdo, (string)$accountId);
        }
        $currentCount = (int)$pdo->query('SELECT COUNT(*) FROM account_user_numbers WHERE current_account_id IS NOT NULL')->fetchColumn();
        if ($currentCount !== count($accounts)
            || (int)$pdo->query('SELECT COUNT(*) FROM account_user_numbers WHERE user_number BETWEEN 1 AND 100')->fetchColumn() !== 0) {
            throw new RuntimeException('Account number backfill is incomplete or reserved numbers were assigned.');
        }
        if ($ownsTransaction) $pdo->commit();
    } catch (Throwable $error) {
        if ($ownsTransaction && $pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

/** Caller must insert the account and allocate its number in the same transaction. */
function lehrfahrer_control_allocate_user_number(PDO $pdo, string $accountId): int {
    if (!$pdo->inTransaction()) throw new RuntimeException('User-number allocation requires a transaction.');
    return lehrfahrer_control_allocate_user_number_in_transaction($pdo, $accountId);
}

function lehrfahrer_control_allocate_user_number_in_transaction(PDO $pdo, string $accountId): int {
    $account = $pdo->prepare('SELECT id FROM accounts WHERE id = ?');
    $account->execute([$accountId]);
    if ($account->fetchColumn() === false || lehrfahrer_control_user_number_for_account($pdo, $accountId) !== null) {
        throw new RuntimeException('Account is missing or already numbered.');
    }
    $update = $pdo->prepare('UPDATE account_user_number_allocator SET next_number = next_number + 1
        WHERE singleton_key = 1 AND next_number >= 101 AND next_number < 9223372036854775807');
    $update->execute();
    if ($update->rowCount() !== 1) throw new RuntimeException('User-number allocator exhausted or invalid.');
    $number = (int)$pdo->query('SELECT next_number - 1 FROM account_user_number_allocator WHERE singleton_key = 1')->fetchColumn();
    if ($number < 101) throw new RuntimeException('Reserved user-number range cannot be allocated.');
    $insert = $pdo->prepare('INSERT INTO account_user_numbers
        (user_number, issued_to_account_id, current_account_id, issued_at) VALUES (?, ?, ?, ?)');
    $insert->execute([$number, $accountId, $accountId, gmdate('c')]);
    return $number;
}

function lehrfahrer_control_user_number_for_account(PDO $pdo, string $accountId): ?int {
    $query = $pdo->prepare('SELECT user_number FROM account_user_numbers WHERE current_account_id = ?');
    $query->execute([$accountId]);
    $number = $query->fetchColumn();
    return $number === false ? null : (int)$number;
}

function lehrfahrer_control_format_user_number(int $number): string {
    if ($number < 1) throw new InvalidArgumentException('Invalid user number.');
    return str_pad((string)$number, 5, '0', STR_PAD_LEFT);
}
