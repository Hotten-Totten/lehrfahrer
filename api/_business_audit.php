<?php
declare(strict_types=1);
require_once __DIR__ . '/_route_audit.php';

/** Keep read/modify/write, ID allocation, and response under the same tenant lock. */
function lehrfahrer_business_request(string $companyId, bool $mutation, callable $work): void {
    try {
        if ($mutation) {
            lehrfahrer_audit_file_lock($companyId, static function (string $directory) use ($companyId, $work): void {
                lehrfahrer_audit_file_recover_locked(lehrfahrer_control_database(), $companyId, $directory);
                $work();
            });
        } else {
            $handle = lehrfahrer_audit_file_read_lock($companyId);
            try {
                if (lehrfahrer_audit_file_any_blocked($companyId)) throw new RuntimeException('Dateivorgang offen.');
                $work();
            } finally { flock($handle, LOCK_UN); fclose($handle); }
        }
    } catch (Throwable $error) {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'Vorgang konnte nicht sicher abgeschlossen werden. Bitte erneut versuchen.'],
            JSON_UNESCAPED_UNICODE);
    }
}

function lehrfahrer_business_actor(string $companyId, string $capability): array {
    $auth = lehrfahrer_api_require_session();
    if (lehrfahrer_route_company_id($auth) !== $companyId) throw new RuntimeException('Gesellschaft stimmt nicht ueberein.');
    return [$auth['pdo'], lehrfahrer_route_audit_actor($auth, $capability)];
}

/** All bytes are prepared first; one CRITICAL audit transaction witnesses all files. */
function lehrfahrer_business_commit(string $companyId, string $type, string $id, string $action,
    string $capability, array $files, ?callable $checkpoint = null): void {
    [$pdo, $actor] = lehrfahrer_business_actor($companyId, $capability);
    $business = ['type' => $type, 'id' => $id];
    $identity = lehrfahrer_audit_file_business_identity($companyId, $business);
    $event = ['action' => $action, 'objectType' => $type, 'objectId' => $identity['objectId'],
        'result' => 'SUCCESS', 'capability' => $capability];
    $allowed = [
        'drivers.manage' => ['DRIVER_CREATE','DRIVER_CHANGE','DRIVER_STATUS_CHANGE','DRIVER_DELETE'],
        'trainings.manage' => ['TRAINING_CREATE','TRAINING_STATUS_CHANGE','TRAINING_ROUTE_COMPLETE'],
        'packages.create' => ['PACKAGE_CREATE','PACKAGE_CHANGE'],
        'packages.manage' => ['PACKAGE_CHANGE','PACKAGE_DELETE'],
        'operations.settings.write' => ['SETTING_CHANGE'],
    ];
    if (!in_array($action, $allowed[$capability] ?? [], true)) throw new InvalidArgumentException('Audit-Aktion ungueltig.');
    $main = null;
    foreach ($files as &$file) {
        $target = lehrfahrer_tenant_path($companyId, $file['area'], $file['relative'], true);
        $file['kind'] = ($file['kind'] ?? '') === 'DELETE' ? 'DELETE' : (is_file($target) ? 'UPDATE' : 'CREATE');
        if ($file['area'] === $identity['area'] && $file['relative'] === $identity['relative']) $main = $file['kind'];
    }
    unset($file);
    if ($main === null) throw new InvalidArgumentException('Audit-Hauptdatei fehlt.');
    lehrfahrer_audit_file_mutate($pdo, $actor, $companyId, $identity['reference'], $main, $files,
        $event, $checkpoint, [], [], $business);
}

function lehrfahrer_business_json(array $data): string {
    return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/** Download event means access authorized and bytes ready, not proof of client receipt. */
function lehrfahrer_business_download(string $companyId, string $packageId): void {
    [$pdo, $actor] = lehrfahrer_business_actor($companyId, 'packages.download');
    $identity = lehrfahrer_audit_file_business_identity($companyId, ['type' => 'PACKAGE', 'id' => $packageId]);
    lehrfahrer_audit_append($pdo, $actor, ['action' => 'PACKAGE_DOWNLOAD', 'objectType' => 'PACKAGE',
        'objectId' => $identity['objectId'], 'result' => 'SUCCESS', 'capability' => 'packages.download'],
        LEHRFAHRER_AUDIT_OPERATIONAL);
}

/** Build ZIP bytes off to the side. No cache is activated before the audit commit. */
function lehrfahrer_business_zip(string $manifest, array $pdfs): string {
    $path = tempnam(sys_get_temp_dir(), 'lf-package-');
    if ($path === false) throw new RuntimeException('ZIP-Vorbereitung fehlgeschlagen.');
    try {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('ZIP kann nicht vorbereitet werden.');
        if (!$zip->addFromString('paket.json', $manifest)) throw new RuntimeException('ZIP-Manifest fehlt.');
        foreach ($pdfs as $name => $bytes) {
            if (!$zip->addFromString($name, $bytes)) throw new RuntimeException('ZIP-Dokument fehlt.');
        }
        if (!$zip->close()) throw new RuntimeException('ZIP konnte nicht abgeschlossen werden.');
        $bytes = file_get_contents($path);
        if ($bytes === false) throw new RuntimeException('ZIP konnte nicht gelesen werden.');
        return $bytes;
    } finally { @unlink($path); }
}
