<?php

/** Additive, unused Phase 2 identity and platform schema. */
function lehrfahrer_control_apply_phase2_schema(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        $tables = [
            "CREATE TABLE IF NOT EXISTS accounts (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                login_normalized VARCHAR(191) NOT NULL UNIQUE,
                email_normalized VARCHAR(254) NULL,
                display_name VARCHAR(255) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                active TINYINT UNSIGNED NOT NULL CHECK (active IN (0, 1)),
                must_change_password TINYINT UNSIGNED NOT NULL CHECK (must_change_password IN (0, 1)),
                last_login VARCHAR(35) NULL, blocked_until VARCHAR(35) NULL,
                created_at VARCHAR(35) NOT NULL, updated_at VARCHAR(35) NOT NULL,
                KEY accounts_email_idx (email_normalized)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS account_memberships (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                account_id VARCHAR(64) NOT NULL, company_id VARCHAR(64) NOT NULL,
                status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'inactive')),
                legacy_user_id VARCHAR(64) NULL,
                created_at VARCHAR(35) NOT NULL, updated_at VARCHAR(35) NOT NULL,
                CONSTRAINT phase2_membership_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                CONSTRAINT phase2_membership_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
                UNIQUE KEY phase2_membership_account_company_uq (account_id, company_id),
                UNIQUE KEY phase2_membership_legacy_user_uq (legacy_user_id),
                UNIQUE KEY phase2_membership_id_account_uq (id, account_id),
                KEY phase2_membership_company_status_idx (company_id, status),
                KEY phase2_membership_account_status_idx (account_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS membership_roles (
                membership_id VARCHAR(64) NOT NULL, role_id VARCHAR(64) NOT NULL,
                PRIMARY KEY (membership_id, role_id),
                CONSTRAINT phase2_member_role_membership_fk FOREIGN KEY (membership_id) REFERENCES account_memberships(id) ON DELETE RESTRICT,
                CONSTRAINT phase2_member_role_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
                KEY phase2_member_role_role_idx (role_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS platform_roles (
                id VARCHAR(64) NOT NULL PRIMARY KEY, code VARCHAR(64) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS platform_capabilities (
                id VARCHAR(128) NOT NULL PRIMARY KEY, code VARCHAR(128) NOT NULL UNIQUE,
                description VARCHAR(512) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS platform_role_capabilities (
                role_id VARCHAR(64) NOT NULL, capability_id VARCHAR(128) NOT NULL,
                PRIMARY KEY (role_id, capability_id),
                CONSTRAINT phase2_prc_role_fk FOREIGN KEY (role_id) REFERENCES platform_roles(id) ON DELETE RESTRICT,
                CONSTRAINT phase2_prc_cap_fk FOREIGN KEY (capability_id) REFERENCES platform_capabilities(id) ON DELETE RESTRICT,
                KEY phase2_prc_cap_idx (capability_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS account_platform_roles (
                account_id VARCHAR(64) NOT NULL, role_code VARCHAR(64) NOT NULL CHECK (role_code = 'COSYSOP'),
                assigned_at VARCHAR(35) NOT NULL, assigned_by_account_id VARCHAR(64) NULL,
                PRIMARY KEY (account_id, role_code),
                CONSTRAINT phase2_apr_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                CONSTRAINT phase2_apr_role_fk FOREIGN KEY (role_code) REFERENCES platform_roles(code) ON DELETE RESTRICT,
                CONSTRAINT phase2_apr_assigner_fk FOREIGN KEY (assigned_by_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                KEY phase2_apr_role_idx (role_code),
                KEY phase2_apr_assigner_idx (assigned_by_account_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS sysop_assignment (
                singleton_key TINYINT UNSIGNED NOT NULL PRIMARY KEY CHECK (singleton_key = 1),
                account_id VARCHAR(64) NOT NULL UNIQUE,
                assigned_at VARCHAR(35) NOT NULL, assigned_by_account_id VARCHAR(64) NULL,
                CONSTRAINT phase2_sysop_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                CONSTRAINT phase2_sysop_assigner_fk FOREIGN KEY (assigned_by_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                KEY phase2_sysop_assigner_idx (assigned_by_account_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS account_sessions (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                account_id VARCHAR(64) NOT NULL,
                session_token_hash CHAR(64) NOT NULL UNIQUE,
                csrf_token_hash CHAR(64) NOT NULL,
                context_type VARCHAR(24) NOT NULL CHECK (context_type IN ('PENDING', 'TENANT', 'PLATFORM', 'PLATFORM_COMPANY')),
                membership_id VARCHAR(64) NULL, technical_company_id VARCHAR(64) NULL,
                environment VARCHAR(16) NOT NULL CHECK (environment IN ('dev', 'staging', 'production')),
                created_at VARCHAR(35) NOT NULL, last_activity_at VARCHAR(35) NOT NULL,
                idle_expires_at VARCHAR(35) NOT NULL, absolute_expires_at VARCHAR(35) NOT NULL,
                revoked_at VARCHAR(35) NULL,
                ip_hash CHAR(64) NULL, user_agent_hash CHAR(64) NULL, device_label VARCHAR(120) NULL,
                CONSTRAINT phase2_session_context_ck CHECK (
                    (context_type = 'TENANT' AND membership_id IS NOT NULL AND technical_company_id IS NULL)
                    OR (context_type = 'PLATFORM_COMPANY' AND membership_id IS NULL AND technical_company_id IS NOT NULL)
                    OR (context_type IN ('PENDING', 'PLATFORM') AND membership_id IS NULL AND technical_company_id IS NULL)
                ),
                CONSTRAINT phase2_session_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                CONSTRAINT phase2_session_membership_account_fk FOREIGN KEY (membership_id, account_id) REFERENCES account_memberships(id, account_id) ON DELETE RESTRICT,
                CONSTRAINT phase2_session_company_fk FOREIGN KEY (technical_company_id) REFERENCES companies(id) ON DELETE RESTRICT,
                KEY phase2_session_account_idx (account_id),
                KEY phase2_session_member_account_idx (membership_id, account_id),
                KEY phase2_session_company_idx (technical_company_id),
                KEY phase2_session_expiry_idx (idle_expires_at, absolute_expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS account_activation_tokens (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                account_id VARCHAR(64) NOT NULL,
                token_hash CHAR(64) NOT NULL UNIQUE,
                created_at VARCHAR(35) NOT NULL, expires_at VARCHAR(35) NOT NULL, used_at VARCHAR(35) NULL,
                CONSTRAINT phase2_activation_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                KEY phase2_activation_expiry_idx (expires_at, used_at),
                KEY phase2_activation_account_idx (account_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ];
    } else {
        $tables = [
            'CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY, login_normalized TEXT NOT NULL UNIQUE, email_normalized TEXT NULL,
                display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                active INTEGER NOT NULL CHECK (active IN (0, 1)),
                must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1)),
                last_login TEXT NULL, blocked_until TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )',
            'CREATE INDEX IF NOT EXISTS accounts_email_idx ON accounts(email_normalized)',
            "CREATE TABLE IF NOT EXISTS account_memberships (
                id TEXT PRIMARY KEY, account_id TEXT NOT NULL, company_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
                legacy_user_id TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
                UNIQUE (account_id, company_id), UNIQUE (legacy_user_id), UNIQUE (id, account_id)
            )",
            'CREATE INDEX IF NOT EXISTS phase2_membership_company_status_idx ON account_memberships(company_id, status)',
            'CREATE INDEX IF NOT EXISTS phase2_membership_account_status_idx ON account_memberships(account_id, status)',
            'CREATE TABLE IF NOT EXISTS membership_roles (
                membership_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (membership_id, role_id),
                FOREIGN KEY (membership_id) REFERENCES account_memberships(id) ON DELETE RESTRICT,
                FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
            )',
            'CREATE INDEX IF NOT EXISTS phase2_member_role_role_idx ON membership_roles(role_id)',
            'CREATE TABLE IF NOT EXISTS platform_roles (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS platform_capabilities (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS platform_role_capabilities (
                role_id TEXT NOT NULL, capability_id TEXT NOT NULL, PRIMARY KEY (role_id, capability_id),
                FOREIGN KEY (role_id) REFERENCES platform_roles(id) ON DELETE RESTRICT,
                FOREIGN KEY (capability_id) REFERENCES platform_capabilities(id) ON DELETE RESTRICT
            )',
            'CREATE INDEX IF NOT EXISTS phase2_prc_cap_idx ON platform_role_capabilities(capability_id)',
            "CREATE TABLE IF NOT EXISTS account_platform_roles (
                account_id TEXT NOT NULL, role_code TEXT NOT NULL CHECK (role_code = 'COSYSOP'),
                assigned_at TEXT NOT NULL, assigned_by_account_id TEXT NULL,
                PRIMARY KEY (account_id, role_code),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (role_code) REFERENCES platform_roles(code) ON DELETE RESTRICT,
                FOREIGN KEY (assigned_by_account_id) REFERENCES accounts(id) ON DELETE RESTRICT
            )",
            'CREATE INDEX IF NOT EXISTS phase2_apr_role_idx ON account_platform_roles(role_code)',
            'CREATE INDEX IF NOT EXISTS phase2_apr_assigner_idx ON account_platform_roles(assigned_by_account_id)',
            'CREATE TABLE IF NOT EXISTS sysop_assignment (
                singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
                account_id TEXT NOT NULL UNIQUE, assigned_at TEXT NOT NULL, assigned_by_account_id TEXT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (assigned_by_account_id) REFERENCES accounts(id) ON DELETE RESTRICT
            )',
            'CREATE INDEX IF NOT EXISTS phase2_sysop_assigner_idx ON sysop_assignment(assigned_by_account_id)',
            "CREATE TABLE IF NOT EXISTS account_sessions (
                id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
                session_token_hash TEXT NOT NULL UNIQUE, csrf_token_hash TEXT NOT NULL,
                context_type TEXT NOT NULL CHECK (context_type IN ('PENDING', 'TENANT', 'PLATFORM', 'PLATFORM_COMPANY')),
                membership_id TEXT NULL, technical_company_id TEXT NULL,
                environment TEXT NOT NULL CHECK (environment IN ('dev', 'staging', 'production')),
                created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL,
                idle_expires_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL,
                revoked_at TEXT NULL, ip_hash TEXT NULL, user_agent_hash TEXT NULL, device_label TEXT NULL,
                CHECK ((context_type = 'TENANT' AND membership_id IS NOT NULL AND technical_company_id IS NULL)
                    OR (context_type = 'PLATFORM_COMPANY' AND membership_id IS NULL AND technical_company_id IS NOT NULL)
                    OR (context_type IN ('PENDING', 'PLATFORM') AND membership_id IS NULL AND technical_company_id IS NULL)),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (membership_id, account_id) REFERENCES account_memberships(id, account_id) ON DELETE RESTRICT,
                FOREIGN KEY (technical_company_id) REFERENCES companies(id) ON DELETE RESTRICT
            )",
            'CREATE INDEX IF NOT EXISTS phase2_session_account_idx ON account_sessions(account_id)',
            'CREATE INDEX IF NOT EXISTS phase2_session_member_account_idx ON account_sessions(membership_id, account_id)',
            'CREATE INDEX IF NOT EXISTS phase2_session_company_idx ON account_sessions(technical_company_id)',
            'CREATE INDEX IF NOT EXISTS phase2_session_expiry_idx ON account_sessions(idle_expires_at, absolute_expires_at)',
            'CREATE TABLE IF NOT EXISTS account_activation_tokens (
                id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
            )',
            'CREATE INDEX IF NOT EXISTS phase2_activation_expiry_idx ON account_activation_tokens(expires_at, used_at)',
            'CREATE INDEX IF NOT EXISTS phase2_activation_account_idx ON account_activation_tokens(account_id)',
        ];
    }
    foreach ($tables as $table) $pdo->exec($table);
    lehrfahrer_control_seed_phase2_platform_definitions($pdo);
    foreach (['platform_roles' => 2, 'platform_capabilities' => 9,
              'platform_role_capabilities' => 16] as $table => $expected) {
        if ((int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() !== $expected) {
            throw new RuntimeException('Phase-2-Plattformdefinitionen sind nicht eindeutig.');
        }
    }
    foreach (['accounts', 'account_memberships', 'membership_roles', 'account_platform_roles',
              'sysop_assignment', 'account_sessions', 'account_activation_tokens'] as $table) {
        if ((int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() !== 0) {
            throw new RuntimeException('Phase-2-Migration darf keine Account- oder Zuweisungsdaten enthalten.');
        }
    }
}

function lehrfahrer_control_seed_phase2_platform_definitions(PDO $pdo): void {
    $roles = ['SYSOP' => 'Systemoperator', 'COSYSOP' => 'Co-Systemoperator'];
    $capabilities = [
        'platform.companies.manage' => 'Gesellschaften technisch verwalten',
        'platform.accounts.support' => 'Technische Kontenhilfe',
        'platform.system.read' => 'Systemstatus lesen',
        'platform.system.manage' => 'Plattformkonfiguration verwalten',
        'platform.maintenance.execute' => 'Zulässige Wartung ausführen',
        'platform.tenant_context.open' => 'Technischen Mandantenkontext öffnen',
        'platform.security.read' => 'Bereinigte Sicherheitsdiagnose lesen',
        'platform.audit.read' => 'Auditinformationen lesen',
        'platform.roles.manage' => 'Plattformrollen verwalten',
    ];
    $selectRole = $pdo->prepare('SELECT id FROM platform_roles WHERE code = :code');
    $insertRole = $pdo->prepare('INSERT INTO platform_roles (id, code, name) VALUES (:id, :code, :name)');
    foreach ($roles as $code => $name) {
        $id = 'prole_' . strtolower($code);
        $selectRole->execute([':code' => $code]);
        $existing = $selectRole->fetchColumn();
        if ($existing === false) $insertRole->execute([':id' => $id, ':code' => $code, ':name' => $name]);
        elseif ($existing !== $id) throw new RuntimeException('Plattformrolle hat eine unerwartete ID.');
    }
    $selectCapability = $pdo->prepare('SELECT id FROM platform_capabilities WHERE code = :code');
    $insertCapability = $pdo->prepare('INSERT INTO platform_capabilities (id, code, description) VALUES (:id, :code, :description)');
    foreach ($capabilities as $code => $description) {
        $id = 'pcap_' . substr(hash('sha256', $code), 0, 24);
        $selectCapability->execute([':code' => $code]);
        $existing = $selectCapability->fetchColumn();
        if ($existing === false) $insertCapability->execute([':id' => $id, ':code' => $code, ':description' => $description]);
        elseif ($existing !== $id) throw new RuntimeException('Plattform-Capability hat eine unerwartete ID.');
    }
    $selectBinding = $pdo->prepare('SELECT 1 FROM platform_role_capabilities WHERE role_id = :role_id AND capability_id = :capability_id');
    $insertBinding = $pdo->prepare('INSERT INTO platform_role_capabilities (role_id, capability_id) VALUES (:role_id, :capability_id)');
    foreach ($roles as $roleCode => $_name) {
        foreach (array_keys($capabilities) as $capabilityCode) {
            if ($roleCode === 'COSYSOP' && in_array($capabilityCode, ['platform.system.manage', 'platform.roles.manage'], true)) continue;
            $binding = [
                ':role_id' => 'prole_' . strtolower($roleCode),
                ':capability_id' => 'pcap_' . substr(hash('sha256', $capabilityCode), 0, 24),
            ];
            $selectBinding->execute($binding);
            if ($selectBinding->fetchColumn() === false) $insertBinding->execute($binding);
        }
    }
}
