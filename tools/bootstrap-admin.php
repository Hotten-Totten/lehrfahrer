<?php

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once dirname(__DIR__) . '/api/_control_repositories.php';

$options = getopt('', [
    'company-slug:',
    'company-name:',
    'login:',
    'display-name:',
    'email::',
    'password-env::',
    'force',
]);
$companySlug = trim((string)($options['company-slug'] ?? ''));
$companyName = trim((string)($options['company-name'] ?? ''));
$login = trim((string)($options['login'] ?? ''));
$displayName = trim((string)($options['display-name'] ?? ''));
$email = trim((string)($options['email'] ?? ''));
$passwordEnvironment = trim((string)($options['password-env'] ?? 'LEHRFAHRER_BOOTSTRAP_PASSWORD'));
$password = $passwordEnvironment !== '' ? (string)getenv($passwordEnvironment) : '';
$force = array_key_exists('force', $options);

if ($companySlug === '' || $companyName === '' || $login === '' || $displayName === '' || $password === '') {
    fwrite(STDERR, "Pflichtangaben oder Initialpasswort fehlen.\n");
    exit(2);
}

try {
    $pdo = lehrfahrer_control_database();
    $marker = $pdo->prepare('SELECT value FROM control_metadata WHERE key = :key');
    $marker->execute([':key' => 'bootstrap_admin_completed']);
    if ($marker->fetchColumn() !== false && !$force) {
        fwrite(STDERR, "Bootstrap wurde bereits abgeschlossen.\n");
        exit(3);
    }

    $pdo->beginTransaction();
    $companies = new LehrfahrerCompanyRepository($pdo);
    $users = new LehrfahrerUserRepository($pdo);
    $roles = new LehrfahrerRoleRepository($pdo);
    $company = $companies->findBySlug($companySlug);
    if ($company === null) {
        $company = $companies->create([
            'slug' => $companySlug,
            'name' => $companyName,
            'status' => 'active',
            'license_status' => 'inactive',
        ]);
    }
    $user = $users->create($company['id'], [
        'login' => $login,
        'display_name' => $displayName,
        'email' => $email,
        'password' => $password,
        'active' => true,
        'must_change_password' => true,
    ]);
    $roles->assignRole($company['id'], $user['id'], 'ADMIN');
    $metadata = $pdo->prepare(
        'INSERT INTO control_metadata (key, value, updated_at)
         VALUES (:key, :value, :updated_at)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );
    $metadata->execute([
        ':key' => 'bootstrap_admin_completed',
        ':value' => $user['id'],
        ':updated_at' => gmdate('c'),
    ]);
    $pdo->commit();
    fwrite(STDOUT, "Bootstrap-ADMIN wurde angelegt.\n");
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "Bootstrap fehlgeschlagen: " . $error->getMessage() . "\n");
    exit(1);
}
