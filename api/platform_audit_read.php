<?php
declare(strict_types=1);
require_once __DIR__ . '/_platform_audit_read.php';
header('Cache-Control: no-store, private');
header('Vary: Cookie');
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json; charset=utf-8');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    lehrfahrer_auth_json_response(405,['ok'=>false,'error'=>'Methode nicht erlaubt.']);
}
try {
    lehrfahrer_auth_json_response(200,lehrfahrer_platform_audit_page(lehrfahrer_control_database(),$_GET));
} catch (LehrfahrerAuditReadDenied $error) {
    lehrfahrer_auth_json_response($error->status,['ok'=>false,'error'=>$error->status===401
        ? 'Account-Anmeldung erforderlich.' : 'Keine Berechtigung für das Plattformprotokoll.']);
} catch (InvalidArgumentException $error) {
    lehrfahrer_auth_json_response(400,['ok'=>false,'error'=>'Ungültige Plattformfilter.']);
} catch (Throwable $error) {
    lehrfahrer_auth_json_response(503,['ok'=>false,'error'=>'Plattformprotokoll derzeit nicht verfügbar.']);
}
