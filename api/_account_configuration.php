<?php
declare(strict_types=1);
require_once __DIR__ . '/_runtime_info.php';

/** Explicit opt-in; a missing production configuration never enables account login. */
function lehrfahrer_account_configuration(): array {
    $environment = lehrfahrer_environment();
    if ($environment === 'staging') return ['enabled'=>true, 'origin'=>'https://staging.lehrfahrer.de',
        'rpId'=>'staging.lehrfahrer.de', 'name'=>'Lehrfahrer Staging'];
    if ($environment !== 'production' || getenv('LEHRFAHRER_ENV') !== 'production'
        || getenv('LEHRFAHRER_ACCOUNT_LOGIN_ENABLED') !== '1') return ['enabled'=>false];
    $origin = lehrfahrer_public_origin();
    $host = strtolower((string)parse_url($origin, PHP_URL_HOST));
    $rpId = trim((string)getenv('LEHRFAHRER_PASSKEY_RP_ID'));
    if ($host === '' || !str_contains($host, '.') || $host === 'staging.lehrfahrer.de' || $rpId !== $host
        || filter_var($host, FILTER_VALIDATE_IP) || parse_url($origin, PHP_URL_PORT) !== null
        || !filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
        throw new RuntimeException('Produktive Passkey-Konfiguration ist ungueltig.');
    }
    return ['enabled'=>true, 'origin'=>$origin, 'rpId'=>$rpId, 'name'=>'Lehrfahrer'];
}

function lehrfahrer_account_login_enabled(): bool {
    return lehrfahrer_account_configuration()['enabled'];
}

function lehrfahrer_sysop_mfa_rp_id(): string {
    $configuration = lehrfahrer_account_configuration();
    if (!$configuration['enabled']) throw new RuntimeException('Account-Anmeldung ist nicht freigegeben.');
    return $configuration['rpId'];
}

function lehrfahrer_sysop_mfa_origin(): string {
    $configuration = lehrfahrer_account_configuration();
    if (!$configuration['enabled']) throw new RuntimeException('Account-Anmeldung ist nicht freigegeben.');
    return $configuration['origin'];
}
