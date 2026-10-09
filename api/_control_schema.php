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
            'capabilities' => [
                'app.access',
                'routes.read',
            ],
        ],
        'EINWEISER' => [
            'name' => 'Einweiser',
            'capabilities' => [
                'app.access',
                'routes.read',
                'drivers.read',
                'trainings.read',
                'trainings.manage',
                'packages.read',
                'packages.create',
                'packages.download',
            ],
        ],
        'DISPONENT' => [
            'name' => 'Disponent',
            'capabilities' => [
                'app.access',
                'routes.read',
                'drivers.read',
                'drivers.manage',
                'trainings.read',
                'trainings.manage',
                'packages.read',
                'packages.create',
                'packages.download',
                'packages.manage',
                'operations.settings.read',
                'operations.settings.write',
            ],
        ],
        'EDITOR' => [
            'name' => 'Editor',
            'capabilities' => [
                'app.access',
                'routes.read',
                'routes.write',
                'routes.delete',
                'routes.import',
                'routes.maintain',
                'cities.manage',
                'stops.fetch',
                'stops.catalog.write',
            ],
        ],
        'ADMIN' => [
            'name' => 'Administrator',
            'capabilities' => [
                'app.access',
                'routes.read',
                'routes.write',
                'routes.delete',
                'routes.import',
                'routes.maintain',
                'drivers.read',
                'drivers.manage',
                'trainings.read',
                'trainings.manage',
                'packages.read',
                'packages.create',
                'packages.download',
                'packages.manage',
                'operations.settings.read',
                'operations.settings.write',
                'cities.manage',
                'stops.fetch',
                'stops.catalog.write',
                'users.manage',
                'roles.manage',
                'company.manage',
                'audit.read',
                'locks.force_release',
            ],
        ],
    ];
}

function lehrfahrer_control_apply_initial_schema(PDO $pdo): void {
    $pdo->exec(<<<'SQL'
CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    license_id TEXT NULL,
    license_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE users (
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

CREATE INDEX users_company_id_idx ON users(company_id);
CREATE INDEX users_company_email_idx ON users(company_id, email_normalized);

CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE capabilities (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL
);

CREATE TABLE role_capabilities (
    role_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    PRIMARY KEY (role_id, capability_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (capability_id) REFERENCES capabilities(id) ON DELETE CASCADE
);

CREATE TABLE user_roles (
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
SQL);

    $capabilityInsert = $pdo->prepare(
        'INSERT INTO capabilities (id, code, description) VALUES (:id, :code, :description)'
    );
    foreach (lehrfahrer_control_capability_definitions() as $code => $description) {
        $capabilityInsert->execute([
            ':id' => 'cap_' . str_replace('.', '_', $code),
            ':code' => $code,
            ':description' => $description,
        ]);
    }

    $roleInsert = $pdo->prepare('INSERT INTO roles (id, code, name) VALUES (:id, :code, :name)');
    $assignmentInsert = $pdo->prepare(
        'INSERT INTO role_capabilities (role_id, capability_id)
         SELECT :role_id, id FROM capabilities WHERE code = :capability_code'
    );
    foreach (lehrfahrer_control_role_definitions() as $code => $definition) {
        $roleId = 'role_' . strtolower($code);
        $roleInsert->execute([
            ':id' => $roleId,
            ':code' => $code,
            ':name' => $definition['name'],
        ]);
        foreach ($definition['capabilities'] as $capabilityCode) {
            $assignmentInsert->execute([
                ':role_id' => $roleId,
                ':capability_code' => $capabilityCode,
            ]);
            if ($assignmentInsert->rowCount() !== 1) {
                throw new RuntimeException('Unbekannte Capability in Rollendefinition: ' . $capabilityCode);
            }
        }
    }
}

function lehrfahrer_control_apply_session_schema(PDO $pdo): void {
    $pdo->exec(<<<'SQL'
CREATE TABLE control_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX users_id_company_unique ON users(id, company_id);

CREATE TABLE sessions (
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

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_company_id_idx ON sessions(company_id);
CREATE INDEX sessions_expiry_idx ON sessions(idle_expires_at, absolute_expires_at);
SQL);
}

function lehrfahrer_control_apply_capability_binding_schema(PDO $pdo): void {
    $delete = $pdo->prepare(
        'DELETE FROM role_capabilities
         WHERE role_id IN (SELECT id FROM roles WHERE code = :role_code)'
    );
    $insert = $pdo->prepare(
        'INSERT INTO role_capabilities (role_id, capability_id)
         SELECT roles.id, capabilities.id
         FROM roles, capabilities
         WHERE roles.code = :role_code AND capabilities.code = :capability_code'
    );
    foreach (lehrfahrer_control_role_definitions() as $roleCode => $definition) {
        $delete->execute([':role_code' => $roleCode]);
        foreach ($definition['capabilities'] as $capabilityCode) {
            $insert->execute([
                ':role_code' => $roleCode,
                ':capability_code' => $capabilityCode,
            ]);
            if ($insert->rowCount() !== 1) {
                throw new RuntimeException('Capability-Migration ist unvollständig: ' . $roleCode . '/' . $capabilityCode);
            }
        }
    }
}
