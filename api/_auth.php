<?php

function lehrfahrer_reject_unauthorized(string $message): void {
    http_response_code(403);
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'ok' => false,
        'error' => $message
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function lehrfahrer_get_header_ci(string $name): string {
    $target = strtolower($name);

    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            foreach ($headers as $key => $value) {
                if (strtolower((string)$key) === $target) {
                    return is_string($value) ? trim($value) : '';
                }
            }
        }
    }

    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    $value = $_SERVER[$serverKey] ?? '';
    return is_string($value) ? trim($value) : '';
}

function lehrfahrer_is_local_request(): bool {
    $serverName = strtolower(trim((string)($_SERVER['SERVER_NAME'] ?? '')));
    $httpHost = strtolower(trim((string)($_SERVER['HTTP_HOST'] ?? '')));
    $remoteAddr = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
    $serverAddr = trim((string)($_SERVER['SERVER_ADDR'] ?? ''));

    $host = preg_replace('/:\d+$/', '', $httpHost);
    $host = trim((string)$host, '[]');

    $localHosts = ['localhost', '127.0.0.1', '::1'];
    $localAddrs = ['127.0.0.1', '::1'];

    return in_array($serverName, $localHosts, true)
        || in_array($host, $localHosts, true)
        || in_array($remoteAddr, $localAddrs, true)
        || in_array($serverAddr, $localAddrs, true);
}

function lehrfahrer_require_write_auth(): void {
    $expected = getenv('LEHRFAHRER_API_TOKEN');
    $expected = is_string($expected) ? trim($expected) : '';

    if ($expected === '') {
        if (lehrfahrer_is_local_request()) {
            return;
        }

        lehrfahrer_reject_unauthorized('Server ist nicht fuer Schreibzugriffe konfiguriert: LEHRFAHRER_API_TOKEN fehlt.');
    }

    $provided = lehrfahrer_get_header_ci('X-Api-Token');
    if ($provided === '') {
        $postToken = $_POST['apiToken'] ?? '';
        $getToken = $_GET['apiToken'] ?? '';
        if (is_string($postToken) && trim($postToken) !== '') {
            $provided = trim($postToken);
        } elseif (is_string($getToken) && trim($getToken) !== '') {
            $provided = trim($getToken);
        }
    }

    if ($provided === '' || !hash_equals($expected, $provided)) {
        lehrfahrer_reject_unauthorized('Ungültiger oder fehlender API-Token.');
    }
}
