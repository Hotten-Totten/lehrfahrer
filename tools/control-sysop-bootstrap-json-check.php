<?php
declare(strict_types=1);

// Private workflow helper: consume the bootstrap response without logging its contents.
try {
    $response = json_decode((string)getenv('LEHRFAHRER_SYSOP_JSON_RESPONSE'), true, 512, JSON_THROW_ON_ERROR);
    $expected = (string)getenv('LEHRFAHRER_SYSOP_JSON_EXPECT');
    if (!is_array($response) || ($response['ok'] ?? null) !== true) exit(1);
    if ($expected === 'preflight') {
        $valid = ($response['targetNumber'] ?? null) === 102
            && ($response['sysopAssignments'] ?? null) === 0
            && ($response['company'] ?? null) === 'cottbusverkehr'
            && ($response['auth']['mode'] ?? null) === 'ACCOUNT_PRIMARY'
            && ($response['auth']['lock'] ?? null) === 'OPEN';
    } elseif ($expected === 'apply') {
        $valid = ($response['userNumber'] ?? null) === 1
            && ($response['retiredNumber'] ?? null) === 102
            && ($response['platformCapabilities'] ?? null) === 9
            && is_int($response['revokedSessions'] ?? null)
            && $response['revokedSessions'] >= 0;
    } elseif ($expected === 'verify') {
        $valid = ($response['userNumber'] ?? null) === 1
            && ($response['retiredNumber'] ?? null) === 102
            && ($response['platformCapabilities'] ?? null) === 9
            && ($response['auth']['mode'] ?? null) === 'ACCOUNT_PRIMARY'
            && ($response['auth']['lock'] ?? null) === 'OPEN';
    } else {
        $valid = false;
    }
    exit($valid ? 0 : 1);
} catch (Throwable $_error) {
    exit(1);
}
