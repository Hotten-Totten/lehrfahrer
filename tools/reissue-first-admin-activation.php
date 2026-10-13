<?php

// Install only in the private staging directory. This is an SSH/operator tool,
// deliberately not an HTTP endpoint and never invoked by the deploy workflow.
if (getenv('REQUEST_METHOD') !== false || getenv('REMOTE_ADDR') !== false
    || getenv('HTTP_HOST') !== false || !is_file(__DIR__ . '/runtime-env.php')) {
    exit(2);
}
require __DIR__ . '/runtime-env.php';

$appRoot = realpath((string)getenv('LEHRFAHRER_APP_ROOT'));
if (!is_string($appRoot) || !is_file($appRoot . '/api/_company_provisioning.php')) {
    exit(2);
}
require_once $appRoot . '/api/_company_provisioning.php';

try {
    $privateRoot = realpath(lehrfahrer_private_storage_root());
    $webroot = realpath($appRoot);
    if (lehrfahrer_environment() !== 'staging' || $privateRoot === false
        || realpath(__DIR__) !== $privateRoot || $webroot === false
        || str_starts_with($privateRoot . DIRECTORY_SEPARATOR, $webroot . DIRECTORY_SEPARATOR)
        || getenv('LEHRFAHRER_REISSUE_CONFIRM') !== '1') {
        throw new RuntimeException('Interner Operator-Kontext fehlt.');
    }
    $companyId = (string)getenv('LEHRFAHRER_REISSUE_COMPANY_ID');
    $login = (string)getenv('LEHRFAHRER_REISSUE_ADMIN_LOGIN');
    if (preg_match('/^cmp_[0-9a-f]{32}$/D', $companyId) !== 1
        || $login === '' || lehrfahrer_control_normalize_login($login) !== $login) {
        throw new RuntimeException('Reissue-Ziel fehlt oder ist ungueltig.');
    }

    // /dev/tty bypasses stdout, pipes, CI logs and redirection. If unavailable,
    // refuse before touching the database; plaintext must not enter artifacts.
    $terminal = @fopen('/dev/tty', 'w');
    if ($terminal === false) {
        throw new RuntimeException('Sicheres Operator-Terminal fehlt.');
    }
    try {
        $result = lehrfahrer_reissue_company_admin_activation(
            lehrfahrer_control_database(), $companyId, $login
        );
        $output = "Neuer Aktivierungstoken (nur diese Ausgabe):\n"
            . $result['token'] . "\nGueltig bis: " . $result['expires_at'] . "\n";
        if (fwrite($terminal, $output) !== strlen($output)) {
            throw new RuntimeException('Operator-Ausgabe fehlgeschlagen.');
        }
    } finally {
        fclose($terminal);
    }
} catch (Throwable $error) {
    file_put_contents('php://stderr', "Reissue nicht durchgefuehrt oder Ausgabe fehlgeschlagen.\n");
    exit(1);
}
