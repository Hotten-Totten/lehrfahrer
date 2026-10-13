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

    $deliveryFile = (string)getenv('LEHRFAHRER_REISSUE_DELIVERY_FILE');
    $fileMode = $deliveryFile !== '';
    if ($fileMode) {
        if (realpath(dirname($deliveryFile)) !== $privateRoot
            || preg_match('/^activation-link-[0-9a-f]{32}\.txt$/D', basename($deliveryFile)) !== 1
            || file_exists($deliveryFile) || is_link($deliveryFile)) {
            throw new RuntimeException('Privater Uebergabepfad ist ungueltig.');
        }
        $delivery = @fopen($deliveryFile, 'x');
        if ($delivery === false || !@chmod($deliveryFile, 0600)) {
            if (is_resource($delivery)) fclose($delivery);
            if (is_file($deliveryFile)) @unlink($deliveryFile);
            throw new RuntimeException('Private Uebergabe konnte nicht vorbereitet werden.');
        }
    } else {
        // /dev/tty bypasses stdout, pipes, CI logs and redirection.
        $delivery = @fopen('/dev/tty', 'w');
        if ($delivery === false) {
            throw new RuntimeException('Sicheres Operator-Terminal fehlt.');
        }
    }
    $delivered = false;
    try {
        $result = lehrfahrer_reissue_company_admin_activation(
            lehrfahrer_control_database(), $companyId, $login
        );
        $output = $fileMode
            ? 'https://staging.lehrfahrer.de/activate.php#token=' . $result['token'] . "\n"
            : "Neuer Aktivierungstoken (nur diese Ausgabe):\n"
                . $result['token'] . "\nGueltig bis: " . $result['expires_at'] . "\n";
        if (fwrite($delivery, $output) !== strlen($output) || !fflush($delivery)) {
            throw new RuntimeException('Operator-Ausgabe fehlgeschlagen.');
        }
        $delivered = true;
    } finally {
        fclose($delivery);
        if ($fileMode && !$delivered && is_file($deliveryFile)) @unlink($deliveryFile);
    }
} catch (Throwable $error) {
    file_put_contents('php://stderr', "Reissue nicht durchgefuehrt oder Ausgabe fehlgeschlagen.\n");
    exit(1);
}
