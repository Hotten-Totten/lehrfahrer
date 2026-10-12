<?php

function lehrfahrer_control_capability_definitions(): array {
    return [
        'app.access' => 'Fahrer-App verwenden',
        'routes.read' => 'Freigegebene Linien und Routen lesen',
        'routes.write' => 'Linien und Routen speichern',
        'routes.delete' => 'Linien und Routen löschen',
        'routes.import' => 'Linien und Routen importieren',
        'routes.maintain' => 'Linienbestand technisch pflegen',
        'drivers.read' => 'Fahrerdaten lesen',
        'drivers.manage' => 'Fahrerdaten verwalten',
        'trainings.read' => 'Einweisungen lesen',
        'trainings.manage' => 'Einweisungen verwalten',
        'packages.read' => 'Fahrerpakete lesen',
        'packages.create' => 'Fahrerpakete erstellen',
        'packages.download' => 'Fahrerpakete herunterladen',
        'packages.manage' => 'Fahrerpakete verwalten',
        'operations.settings.read' => 'Betriebliche Einstellungen lesen',
        'operations.settings.write' => 'Betriebliche Einstellungen ändern',
        'cities.manage' => 'Orte verwalten',
        'stops.fetch' => 'Haltestellen abrufen',
        'stops.catalog.write' => 'Haltestellenkatalog speichern',
        'users.manage' => 'Benutzer verwalten',
        'roles.manage' => 'Rollen verwalten',
        'company.manage' => 'Gesellschaftseinstellungen verwalten',
        'audit.read' => 'Auditprotokoll lesen',
        'locks.force_release' => 'Gesellschaftsweiten Schreib-Lock lösen',
    ];
}

function lehrfahrer_control_role_definitions(): array {
    return [
        'FAHRER' => [
            'name' => 'Fahrer',
            'capabilities' => ['app.access', 'routes.read'],
        ],
        'EINWEISER' => [
            'name' => 'Einweiser',
            'capabilities' => [
                'app.access', 'routes.read', 'drivers.read', 'trainings.read',
                'trainings.manage', 'packages.read', 'packages.create', 'packages.download',
            ],
        ],
        'DISPONENT' => [
            'name' => 'Disponent',
            'capabilities' => [
                'app.access', 'routes.read', 'drivers.read', 'drivers.manage',
                'trainings.read', 'trainings.manage', 'packages.read', 'packages.create',
                'packages.download', 'packages.manage', 'operations.settings.read',
                'operations.settings.write',
            ],
        ],
        'EDITOR' => [
            'name' => 'Editor',
            'capabilities' => [
                'app.access', 'routes.read', 'routes.write', 'routes.delete',
                'routes.import', 'routes.maintain', 'cities.manage', 'stops.fetch',
                'stops.catalog.write',
            ],
        ],
        'ADMIN' => [
            'name' => 'Administrator',
            'capabilities' => [
                'app.access', 'routes.read', 'routes.write', 'routes.delete',
                'routes.import', 'routes.maintain', 'drivers.read', 'drivers.manage',
                'trainings.read', 'trainings.manage', 'packages.read', 'packages.create',
                'packages.download', 'packages.manage', 'operations.settings.read',
                'operations.settings.write', 'cities.manage', 'stops.fetch',
                'stops.catalog.write', 'users.manage', 'roles.manage', 'company.manage',
                'audit.read', 'locks.force_release',
            ],
        ],
    ];
}

function lehrfahrer_control_schema_exec(PDO $pdo, array $statements): void {
    foreach ($statements as $statement) $pdo->exec($statement);
}

function lehrfahrer_control_apply_initial_schema(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        lehrfahrer_control_schema_exec($pdo, [
            "CREATE TABLE IF NOT EXISTS companies (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                slug VARCHAR(63) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'inactive')),
                license_id VARCHAR(128) NULL,
                license_status VARCHAR(32) NOT NULL,
                created_at VARCHAR(35) NOT NULL,
                updated_at VARCHAR(35) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                company_id VARCHAR(64) NOT NULL,
                login_normalized VARCHAR(191) NOT NULL,
                email_normalized VARCHAR(254) NULL,
                display_name VARCHAR(255) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                active TINYINT UNSIGNED NOT NULL CHECK (active IN (0, 1)),
                must_change_password TINYINT UNSIGNED NOT NULL CHECK (must_change_password IN (0, 1)),
                last_login VARCHAR(35) NULL,
                blocked_until VARCHAR(35) NULL,
                created_at VARCHAR(35) NOT NULL,
                updated_at VARCHAR(35) NOT NULL,
                CONSTRAINT users_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
                UNIQUE KEY users_company_login_unique (company_id, login_normalized),
                KEY users_company_id_idx (company_id),
                KEY users_company_email_idx (company_id, email_normalized)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS roles (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                code VARCHAR(64) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS capabilities (
                id VARCHAR(128) NOT NULL PRIMARY KEY,
                code VARCHAR(128) NOT NULL UNIQUE,
                description VARCHAR(512) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS role_capabilities (
                role_id VARCHAR(64) NOT NULL,
                capability_id VARCHAR(128) NOT NULL,
                PRIMARY KEY (role_id, capability_id),
                CONSTRAINT role_capabilities_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                CONSTRAINT role_capabilities_capability_fk FOREIGN KEY (capability_id) REFERENCES capabilities(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS user_roles (
                user_id VARCHAR(64) NOT NULL,
                role_id VARCHAR(64) NOT NULL,
                PRIMARY KEY (user_id, role_id),
                CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ]);
    } else {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    license_id TEXT NULL,
    license_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    login_normalized TEXT NOT NULL COLLATE NOCASE,
    email_normalized TEXT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1)),
    last_login TEXT NULL,
    blocked_until TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    UNIQUE (company_id, login_normalized)
);
CREATE INDEX IF NOT EXISTS users_company_id_idx ON users(company_id);
CREATE INDEX IF NOT EXISTS users_company_email_idx ON users(company_id, email_normalized);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS capabilities (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS role_capabilities (
    role_id TEXT NOT NULL, capability_id TEXT NOT NULL,
    PRIMARY KEY (role_id, capability_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (capability_id) REFERENCES capabilities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL, role_id TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
SQL);
    }
    lehrfahrer_control_seed_roles_and_capabilities($pdo);
}

function lehrfahrer_control_seed_roles_and_capabilities(PDO $pdo): void {
    $findCapability = $pdo->prepare('SELECT id FROM capabilities WHERE code = :code');
    $insertCapability = $pdo->prepare(
        'INSERT INTO capabilities (id, code, description) VALUES (:id, :code, :description)'
    );
    $updateCapability = $pdo->prepare('UPDATE capabilities SET description = :description WHERE id = :id');
    foreach (lehrfahrer_control_capability_definitions() as $code => $description) {
        $id = 'cap_' . str_replace('.', '_', $code);
        $findCapability->execute([':code' => $code]);
        $existingId = $findCapability->fetchColumn();
        if ($existingId === false) {
            $insertCapability->execute([':id' => $id, ':code' => $code, ':description' => $description]);
        } else {
            $updateCapability->execute([':id' => (string)$existingId, ':description' => $description]);
        }
    }

    $findRole = $pdo->prepare('SELECT id FROM roles WHERE code = :code');
    $insertRole = $pdo->prepare('INSERT INTO roles (id, code, name) VALUES (:id, :code, :name)');
    $updateRole = $pdo->prepare('UPDATE roles SET name = :name WHERE id = :id');
    $assignmentInsert = $pdo->prepare(
        'INSERT INTO role_capabilities (role_id, capability_id)
         SELECT :role_id, capabilities.id FROM capabilities
         WHERE capabilities.code = :capability_code
           AND NOT EXISTS (
               SELECT 1 FROM role_capabilities
               WHERE role_id = :existing_role_id AND capability_id = capabilities.id
           )'
    );
    foreach (lehrfahrer_control_role_definitions() as $code => $definition) {
        $roleId = 'role_' . strtolower($code);
        $findRole->execute([':code' => $code]);
        $existingRoleId = $findRole->fetchColumn();
        if ($existingRoleId === false) {
            $insertRole->execute([':id' => $roleId, ':code' => $code, ':name' => $definition['name']]);
        } else {
            $roleId = (string)$existingRoleId;
            $updateRole->execute([':id' => $roleId, ':name' => $definition['name']]);
        }
        foreach ($definition['capabilities'] as $capabilityCode) {
            $assignmentInsert->execute([
                ':role_id' => $roleId,
                ':existing_role_id' => $roleId,
                ':capability_code' => $capabilityCode,
            ]);
        }
    }
}

function lehrfahrer_control_apply_session_schema(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        lehrfahrer_control_schema_exec($pdo, [
            "CREATE TABLE IF NOT EXISTS control_metadata (
                `key` VARCHAR(128) NOT NULL PRIMARY KEY,
                value VARCHAR(512) NOT NULL,
                updated_at VARCHAR(35) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            'CREATE UNIQUE INDEX IF NOT EXISTS users_id_company_unique ON users(id, company_id)',
            "CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                session_token_hash CHAR(64) NOT NULL UNIQUE,
                user_id VARCHAR(64) NOT NULL,
                company_id VARCHAR(64) NOT NULL,
                csrf_token_hash CHAR(64) NOT NULL,
                environment VARCHAR(16) NOT NULL CHECK (environment IN ('dev', 'staging', 'production')),
                created_at VARCHAR(35) NOT NULL,
                last_activity_at VARCHAR(35) NOT NULL,
                idle_expires_at VARCHAR(35) NOT NULL,
                absolute_expires_at VARCHAR(35) NOT NULL,
                revoked_at VARCHAR(35) NULL,
                ip_hash CHAR(64) NULL,
                user_agent_hash CHAR(64) NULL,
                device_label VARCHAR(120) NULL,
                CONSTRAINT sessions_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                CONSTRAINT sessions_user_company_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
                KEY sessions_user_id_idx (user_id),
                KEY sessions_company_id_idx (company_id),
                KEY sessions_expiry_idx (idle_expires_at, absolute_expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ]);
        return;
    }
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS control_metadata (`key` TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_id_company_unique ON users(id, company_id);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    csrf_token_hash TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('dev', 'staging', 'production')),
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    idle_expires_at TEXT NOT NULL,
    absolute_expires_at TEXT NOT NULL,
    revoked_at TEXT NULL,
    ip_hash TEXT NULL,
    user_agent_hash TEXT NULL,
    device_label TEXT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_company_id_idx ON sessions(company_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(idle_expires_at, absolute_expires_at);
SQL);
}

function lehrfahrer_control_apply_capability_binding_schema(PDO $pdo): void {
    $delete = $pdo->prepare(
        'DELETE FROM role_capabilities WHERE role_id IN (SELECT id FROM roles WHERE code = :role_code)'
    );
    $insert = $pdo->prepare(
        'INSERT INTO role_capabilities (role_id, capability_id)
         SELECT roles.id, capabilities.id FROM roles, capabilities
         WHERE roles.code = :role_code AND capabilities.code = :capability_code'
    );
    foreach (lehrfahrer_control_role_definitions() as $roleCode => $definition) {
        $delete->execute([':role_code' => $roleCode]);
        foreach ($definition['capabilities'] as $capabilityCode) {
            $insert->execute([':role_code' => $roleCode, ':capability_code' => $capabilityCode]);
            if ($insert->rowCount() !== 1) {
                throw new RuntimeException('Capability-Migration ist unvollständig: ' . $roleCode . '/' . $capabilityCode);
            }
        }
    }
}

function lehrfahrer_control_apply_company_template_schema(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        lehrfahrer_control_schema_exec($pdo, [
            'ALTER TABLE companies ADD COLUMN IF NOT EXISTS template_version_created INT UNSIGNED NULL',
            'ALTER TABLE companies ADD COLUMN IF NOT EXISTS template_version_current INT UNSIGNED NULL',
            "CREATE TABLE IF NOT EXISTS user_activation_tokens (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                company_id VARCHAR(64) NOT NULL,
                token_hash CHAR(64) NOT NULL UNIQUE,
                created_at VARCHAR(35) NOT NULL,
                expires_at VARCHAR(35) NOT NULL,
                used_at VARCHAR(35) NULL,
                CONSTRAINT activation_tokens_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                CONSTRAINT activation_tokens_user_company_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
                KEY activation_tokens_expiry_idx (expires_at, used_at),
                KEY activation_tokens_user_idx (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ]);
        return;
    }

    $columns = $pdo->query('PRAGMA table_info(companies)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('template_version_created', $columns, true)) {
        $pdo->exec('ALTER TABLE companies ADD COLUMN template_version_created INTEGER NULL');
    }
    if (!in_array('template_version_current', $columns, true)) {
        $pdo->exec('ALTER TABLE companies ADD COLUMN template_version_current INTEGER NULL');
    }
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS user_activation_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS activation_tokens_expiry_idx ON user_activation_tokens(expires_at, used_at);
CREATE INDEX IF NOT EXISTS activation_tokens_user_idx ON user_activation_tokens(user_id);
SQL);
}
