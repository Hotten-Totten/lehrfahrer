<?php
declare(strict_types=1);

const POSTCHECK_COMPANY = 'cmp_2ff1b82166c99988ed6f7eb51cca7b56';

try {
    if (getenv('LEHRFAHRER_ENV') !== 'staging') throw new RuntimeException('Nur Staging erlaubt.');
    $appRoot = (string)getenv('LEHRFAHRER_APP_ROOT');
    if ($appRoot === '' || !is_dir($appRoot)) throw new RuntimeException('Staging-App-Root fehlt.');
    require_once $appRoot . '/api/_tenant_storage.php';
    require_once $appRoot . '/api/_gtfs_variant_index.php';
    require_once $appRoot . '/api/_gtfs_version.php';
    require_once $appRoot . '/api/_control_repositories.php';

    $zip = lehrfahrer_tenant_path(POSTCHECK_COMPANY, 'imports', 'gtfs/latest.zip');
    $index = lehrfahrer_tenant_path(POSTCHECK_COMPANY, 'imports', 'gtfs/index/variants.sqlite');
    $baseline = lehrfahrer_tenant_path(POSTCHECK_COMPANY, 'imports', 'gtfs/index/variants.sqlite.previous');
    $inventoryPath = lehrfahrer_tenant_path(POSTCHECK_COMPANY, 'imports', 'gtfs/index/work-inventory.json');
    if (!is_file($baseline) || is_link($baseline) || !is_readable($baseline)) throw new RuntimeException('GTFS-Baseline fehlt.');
    $validated = lehrfahrer_gtfs_validate_variant_index($index, ['143']);
    if ($validated['routes'] !== 75 || $validated['variants'] !== 678) throw new RuntimeException('Cottbus-Index ist nicht 75/678.');
    $version = lehrfahrer_gtfs_version_info($zip, $index);
    if ($version['indexMatchesZip'] !== true) throw new RuntimeException('GTFS-ZIP und Index passen nicht zusammen.');
    if (!is_file($inventoryPath) || is_link($inventoryPath)) throw new RuntimeException('GTFS-Arbeitsvorrat fehlt.');
    $inventory = json_decode((string)file_get_contents($inventoryPath), true, 512, JSON_THROW_ON_ERROR);
    $complete = $inventory['completeness'] ?? [];
    if (!is_array($inventory) || ($inventory['sourceIndexSha256'] ?? '') !== $validated['sha256']
        || ($inventory['agencyIds'] ?? []) !== ['143']
        || ($complete['complete'] ?? false) !== true
        || ($complete['capturedLineCount'] ?? null) !== 75
        || ($complete['capturedVariantCount'] ?? null) !== 678) {
        throw new RuntimeException('GTFS-Arbeitsvorrat ist nicht aktuell oder unvollstaendig.');
    }
    $entries = $inventory['entries'] ?? null;
    if (!is_array($entries) || count($entries) !== 678) throw new RuntimeException('GTFS-Variantenbestand ist unvollstaendig.');
    foreach ($entries as $entry) {
        if (!is_array($entry) || !in_array($entry['status'] ?? null, ['UNGEPRUEFT', 'IN_BEARBEITUNG', 'GEPRUEFT', 'FREIGEGEBEN'], true)) {
            throw new RuntimeException('GTFS-Freigabestatus ist ungueltig.');
        }
    }
    $settingsPath = lehrfahrer_tenant_path(POSTCHECK_COMPANY, 'settings', 'city_settings.json');
    if (!is_file($settingsPath) || is_link($settingsPath)) throw new RuntimeException('Cottbus-Einstellungen fehlen.');
    $settings = json_decode((string)file_get_contents($settingsPath), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($settings) || !is_array($settings['cottbus'] ?? null)) throw new RuntimeException('Cottbus-Einstellungen sind ungueltig.');
    foreach (['drivers', 'trainings', 'packages', 'documents'] as $area) {
        $directory = lehrfahrer_tenant_area(POSTCHECK_COMPANY, $area);
        if (!is_dir($directory) || is_link($directory)) throw new RuntimeException('Cottbus-Fachbereich fehlt: ' . $area);
        $hasFile = false;
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isLink()) throw new RuntimeException('Symlink im Cottbus-Fachbereich: ' . $area);
            if ($file->isFile()) $hasFile = true;
        }
        if (!$hasFile) throw new RuntimeException('Cottbus-Fachbereich ist leer: ' . $area);
    }

    $pdo = lehrfahrer_control_database();
    if (lehrfahrer_control_driver($pdo) !== 'mysql') throw new RuntimeException('Staging-Control-DB ist nicht MariaDB.');
    $company = (new LehrfahrerCompanyRepository($pdo))->findBySlug('cottbusverkehr');
    if (!is_array($company) || ($company['id'] ?? '') !== POSTCHECK_COMPANY || ($company['status'] ?? '') !== 'active') {
        throw new RuntimeException('Cottbus-Gesellschaft ist nicht eindeutig.');
    }
    $users = $pdo->prepare('SELECT id, active, must_change_password, password_hash FROM users WHERE company_id = :company_id AND login_normalized = :login');
    $users->execute([':company_id' => POSTCHECK_COMPANY, ':login' => 'cottbus-admin']);
    $admin = $users->fetchAll();
    if (count($admin) !== 1 || !str_starts_with((string)$admin[0]['password_hash'], '$')) throw new RuntimeException('Cottbus-Admin ist nicht eindeutig.');
    $roles = $pdo->prepare('SELECT roles.code FROM user_roles JOIN roles ON roles.id = user_roles.role_id WHERE user_roles.user_id = :user_id ORDER BY roles.code');
    $roles->execute([':user_id' => $admin[0]['id']]);
    if ($roles->fetchAll(PDO::FETCH_COLUMN) !== ['ADMIN']) throw new RuntimeException('Cottbus-Admin-Rolle weicht ab.');
    $tokens = $pdo->prepare('SELECT token_hash, expires_at, used_at FROM user_activation_tokens WHERE company_id = :company_id AND user_id = :user_id');
    $tokens->execute([':company_id' => POSTCHECK_COMPANY, ':user_id' => $admin[0]['id']]);
    $records = $tokens->fetchAll();
    if ((int)$admin[0]['active'] === 1) {
        if ((int)$admin[0]['must_change_password'] !== 0 || $records !== []) throw new RuntimeException('Aktivierter Admin besitzt noch einen Token.');
    } elseif ((int)$admin[0]['must_change_password'] !== 1 || count($records) !== 1
        || preg_match('/^[0-9a-f]{64}$/D', (string)$records[0]['token_hash']) !== 1
        || $records[0]['used_at'] !== null || strtotime((string)$records[0]['expires_at']) === false) {
        throw new RuntimeException('Inaktiver Admin besitzt keinen sicheren Token.');
    }
    echo 'COTTBUS_CURRENT_POSTCHECK=OK', PHP_EOL;
    echo 'COTTBUS_CURRENT_GTFS=75/678', PHP_EOL;
} catch (Throwable $error) {
    file_put_contents('php://stderr', 'Cottbus-Postcheck: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
