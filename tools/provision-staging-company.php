<?php

function lehrfahrer_staging_provision_error(string $message): void {
    file_put_contents('php://stderr', $message . "\n");
}

$cgiProvision = PHP_SAPI !== 'cli'
    && getenv('LEHRFAHRER_STAGING_CGI_PROVISION') === '1';
if (PHP_SAPI !== 'cli' && !$cgiProvision) {
    http_response_code(404);
    exit;
}

$configuredRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
$appRoot = $configuredRoot !== '' ? realpath($configuredRoot) : dirname(__DIR__);
if (!is_string($appRoot) || !is_file($appRoot . '/api/_company_provisioning.php')) {
    lehrfahrer_staging_provision_error('LEHRFAHRER_APP_ROOT ist ungueltig.');
    exit(2);
}
require_once $appRoot . '/api/_company_provisioning.php';

if (lehrfahrer_environment() !== 'staging') {
    lehrfahrer_staging_provision_error('Dieses Werkzeug darf nur in der Staging-Umgebung laufen.');
    exit(2);
}

$resultFile = '';
if ($cgiProvision) {
    $resultFile = trim((string)getenv('LEHRFAHRER_STAGING_PROVISION_RESULT_FILE'));
    $resultDirectory = $resultFile !== '' ? realpath(dirname($resultFile)) : false;
    $privateRoot = realpath(lehrfahrer_private_storage_root());
    if ($resultDirectory === false || $privateRoot === false
        || $resultDirectory !== $privateRoot || basename($resultFile) !== 'provision-result.json') {
        lehrfahrer_staging_provision_error('CGI-Ergebnisdatei liegt nicht im privaten Staging-Speicher.');
        exit(2);
    }
}

$options = getopt('', [
    'company-name:',
    'company-slug:',
    'license-status:',
    'license-id::',
    'admin-display-name:',
    'admin-login:',
    'admin-email::',
]);
$password = (string)getenv('LEHRFAHRER_STAGING_ADMIN_PASSWORD');
if (strlen($password) < 14) {
    lehrfahrer_staging_provision_error('LEHRFAHRER_STAGING_ADMIN_PASSWORD fehlt oder ist zu kurz.');
    exit(2);
}

$input = [
    'name' => trim((string)($options['company-name'] ?? '')),
    'slug' => trim((string)($options['company-slug'] ?? '')),
    'license_status' => trim((string)($options['license-status'] ?? '')),
    'license_id' => trim((string)($options['license-id'] ?? '')),
    'admin_display_name' => trim((string)($options['admin-display-name'] ?? '')),
    'admin_login' => trim((string)($options['admin-login'] ?? '')),
    'admin_email' => trim((string)($options['admin-email'] ?? '')),
];

try {
    $pdo = lehrfahrer_control_database();
    $companies = new LehrfahrerCompanyRepository($pdo);
    $users = new LehrfahrerUserRepository($pdo);
    $companyCount = (int)$pdo->query('SELECT COUNT(*) FROM companies')->fetchColumn();
    $existing = $companies->findBySlug($input['slug']);
    if ($existing !== null) {
        if ($companyCount !== 1 || $existing['name'] !== $input['name']) {
            throw new RuntimeException('Staging enthaelt einen unerwarteten Gesellschaftsbestand.');
        }
        $admin = $users->findAuthenticationRecordByLogin($existing['id'], $input['admin_login']);
        if (!is_array($admin) || (int)$admin['active'] !== 1) {
            throw new RuntimeException('Die vorhandene Staging-Gesellschaft besitzt keinen aktiven erwarteten Admin.');
        }
        $result = ['company_id' => $existing['id'], 'slug' => $existing['slug'], 'created' => false];
    } else {
        if ($companyCount !== 0) {
            throw new RuntimeException('Staging ist nicht leer; Provisioning wird abgebrochen.');
        }
        $provisioned = lehrfahrer_create_company_from_template($pdo, $input);
        lehrfahrer_activate_company_admin($pdo, $provisioned['activation']['token'], $password);
        $result = [
            'company_id' => $provisioned['company']['id'],
            'slug' => $provisioned['company']['slug'],
            'created' => true,
        ];
    }
    $json = json_encode(
        $result,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n";
    if ($cgiProvision) {
        $temporaryResult = $resultFile . '.tmp.' . getmypid();
        try {
            if (file_put_contents($temporaryResult, $json, LOCK_EX) !== strlen($json)
                || !chmod($temporaryResult, 0600) || !rename($temporaryResult, $resultFile)) {
                throw new RuntimeException('CGI-Ergebnisdatei konnte nicht atomar geschrieben werden.');
            }
        } finally {
            if (is_file($temporaryResult)) unlink($temporaryResult);
        }
    } else {
        fwrite(STDOUT, $json);
    }
} catch (Throwable $error) {
    lehrfahrer_staging_provision_error('Staging-Provisioning fehlgeschlagen: ' . $error->getMessage());
    exit(1);
}
