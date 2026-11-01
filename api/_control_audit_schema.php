<?php
declare(strict_types=1);

/** Additive audit ledger. The application has no update/delete interface for events. */
function lehrfahrer_control_apply_audit_schema(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_chain_state (
            singleton_key TINYINT UNSIGNED NOT NULL PRIMARY KEY CHECK (singleton_key = 1),
            last_sequence BIGINT UNSIGNED NOT NULL,
            last_hash CHAR(64) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_events (
            sequence_number BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            event_id VARCHAR(64) NOT NULL UNIQUE,
            occurred_at VARCHAR(20) NOT NULL,
            account_id VARCHAR(64) NULL,
            context_type VARCHAR(16) NOT NULL,
            membership_id VARCHAR(64) NULL,
            company_id VARCHAR(64) NULL,
            role_snapshot VARCHAR(512) NULL,
            capability_snapshot VARCHAR(128) NULL,
            action VARCHAR(80) NOT NULL,
            object_type VARCHAR(32) NULL,
            object_id VARCHAR(128) NULL,
            result VARCHAR(8) NOT NULL CHECK (result IN ('SUCCESS','DENIED','FAILED')),
            reason_code VARCHAR(48) NULL,
            previous_hash CHAR(64) NOT NULL,
            event_hash CHAR(64) NOT NULL,
            KEY audit_company_time_idx (company_id, occurred_at, sequence_number),
            KEY audit_account_time_idx (account_id, occurred_at, sequence_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $pdo->exec("INSERT IGNORE INTO audit_chain_state (singleton_key,last_sequence,last_hash)
            VALUES (1,0,'" . str_repeat('0', 64) . "')");
    } else {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_chain_state (
            singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
            last_sequence INTEGER NOT NULL, last_hash TEXT NOT NULL)");
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_events (
            sequence_number INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
            occurred_at TEXT NOT NULL, account_id TEXT NULL, context_type TEXT NOT NULL,
            membership_id TEXT NULL, company_id TEXT NULL, role_snapshot TEXT NULL,
            capability_snapshot TEXT NULL, action TEXT NOT NULL, object_type TEXT NULL,
            object_id TEXT NULL, result TEXT NOT NULL CHECK (result IN ('SUCCESS','DENIED','FAILED')),
            reason_code TEXT NULL, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL)");
        $pdo->exec('CREATE INDEX IF NOT EXISTS audit_company_time_idx ON audit_events(company_id,occurred_at,sequence_number)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS audit_account_time_idx ON audit_events(account_id,occurred_at,sequence_number)');
        $pdo->exec("INSERT OR IGNORE INTO audit_chain_state (singleton_key,last_sequence,last_hash)
            VALUES (1,0,'" . str_repeat('0', 64) . "')");
    }
}
