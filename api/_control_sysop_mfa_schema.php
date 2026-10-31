<?php
declare(strict_types=1);

/** Additive SYSOP-only WebAuthn storage. No existing account rows are modified. */
function lehrfahrer_control_apply_sysop_mfa_schema(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_passkeys (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            account_id VARCHAR(64) NOT NULL,
            credential_id VARBINARY(1536) NOT NULL UNIQUE,
            public_key TEXT NOT NULL,
            sign_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
            rp_id VARCHAR(255) NOT NULL,
            status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'revoked')),
            created_at VARCHAR(35) NOT NULL,
            last_used_at VARCHAR(35) NULL,
            revoked_at VARCHAR(35) NULL,
            CONSTRAINT account_passkeys_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
            KEY account_passkeys_account_status_idx (account_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_mfa_pending (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            account_id VARCHAR(64) NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('ENROLL', 'AUTH')),
            environment VARCHAR(16) NOT NULL,
            challenge VARCHAR(128) NULL,
            challenge_expires_at VARCHAR(35) NULL,
            created_at VARCHAR(35) NOT NULL,
            expires_at VARCHAR(35) NOT NULL,
            consumed_at VARCHAR(35) NULL,
            device_label VARCHAR(120) NULL,
            CONSTRAINT account_mfa_pending_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
            KEY account_mfa_pending_account_idx (account_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $column = $pdo->query("SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account_sessions' AND COLUMN_NAME = 'mfa_verified_at'");
        if ((int)$column->fetchColumn() === 0) {
            $pdo->exec('ALTER TABLE account_sessions ADD COLUMN mfa_verified_at VARCHAR(35) NULL');
        }
    } else {
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_passkeys (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE,
            public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
            rp_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
            created_at TEXT NOT NULL, last_used_at TEXT NULL, revoked_at TEXT NULL,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
        )");
        $pdo->exec('CREATE INDEX IF NOT EXISTS account_passkeys_account_status_idx ON account_passkeys(account_id, status)');
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_mfa_pending (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
            purpose TEXT NOT NULL CHECK (purpose IN ('ENROLL', 'AUTH')),
            environment TEXT NOT NULL, challenge TEXT NULL, challenge_expires_at TEXT NULL,
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT NULL,
            device_label TEXT NULL, FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
        )");
        $pdo->exec('CREATE INDEX IF NOT EXISTS account_mfa_pending_account_idx ON account_mfa_pending(account_id)');
        $columns = $pdo->query('PRAGMA table_info(account_sessions)')->fetchAll(PDO::FETCH_ASSOC);
        if (!in_array('mfa_verified_at', array_column($columns, 'name'), true)) {
            $pdo->exec('ALTER TABLE account_sessions ADD COLUMN mfa_verified_at TEXT NULL');
        }
    }
}
