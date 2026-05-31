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

function lehrfahrer_require_write_auth(): void {
    $expected = getenv('LEHRFAHRER_API_TOKEN');
    $expected = is_string($expected) ? trim($expected) : '';

    $remoteAddr = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $isLoopback = ($remoteAddr === '127.0.0.1' || $remoteAddr === '::1');

    // Ohne gesetzten Token nur lokale Schreibzugriffe erlauben.
    if ($expected === '') {
        if ($isLoopback) {
            return;
        }
        lehrfahrer_reject_unauthorized('Schreibzugriff verweigert. Setze LEHRFAHRER_API_TOKEN und sende X-Api-Token.');
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
