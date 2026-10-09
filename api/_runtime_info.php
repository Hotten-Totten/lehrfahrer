<?php

function lehrfahrer_environment(): string {
    $environment = strtolower(trim((string)getenv('LEHRFAHRER_ENV')));
    if ($environment === '') return 'production';
    if (!in_array($environment, ['dev', 'staging', 'production'], true)) {
        throw new RuntimeException('LEHRFAHRER_ENV ist ungültig.');
    }
    return $environment;
}

function lehrfahrer_environment_label(?string $environment = null): string {
    return match ($environment ?? lehrfahrer_environment()) {
        'dev' => 'DEV',
        'staging' => 'STAGING',
        default => 'LIVE',
    };
}

function lehrfahrer_public_origin(): string {
    $configured = rtrim(trim((string)getenv('LEHRFAHRER_PUBLIC_ORIGIN')), '/');
    if ($configured !== '') {
        $parts = parse_url($configured);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
            || (($parts['path'] ?? '') !== '' && ($parts['path'] ?? '') !== '/')) {
            throw new RuntimeException('LEHRFAHRER_PUBLIC_ORIGIN ist ungültig.');
        }
        $scheme = strtolower((string)$parts['scheme']);
        if ($scheme !== 'https' && !(lehrfahrer_environment() === 'dev' && $scheme === 'http')) {
            throw new RuntimeException('LEHRFAHRER_PUBLIC_ORIGIN muss HTTPS verwenden.');
        }
        return $configured;
    }

    if (lehrfahrer_environment() !== 'dev') {
        throw new RuntimeException('LEHRFAHRER_PUBLIC_ORIGIN fehlt.');
    }
    return 'https://localhost';
}

function lehrfahrer_project_version(): string {
    static $version = null;
    if (is_string($version)) return $version;
    $versionFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'VERSION';
    $version = is_file($versionFile) ? trim((string)file_get_contents($versionFile)) : 'unbekannt';
    return $version;
}

function lehrfahrer_runtime_info(?PDO $pdo = null): array {
    $schemaVersion = null;
    if ($pdo instanceof PDO) {
        $schemaVersion = (int)$pdo->query('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')->fetchColumn();
    }
    return [
        'environment' => lehrfahrer_environment(),
        'environmentLabel' => lehrfahrer_environment_label(),
        'version' => lehrfahrer_project_version(),
        'commit' => trim((string)getenv('LEHRFAHRER_BUILD_COMMIT')) ?: null,
        'buildId' => trim((string)getenv('LEHRFAHRER_BUILD_ID')) ?: null,
        'deployedAt' => trim((string)getenv('LEHRFAHRER_DEPLOYED_AT')) ?: null,
        'databaseSchemaVersion' => $schemaVersion,
    ];
}
