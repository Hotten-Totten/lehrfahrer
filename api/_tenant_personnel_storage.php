<?php

// PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E.
require_once __DIR__ . '/_tenant_route_storage.php';

function lehrfahrer_personnel_authorize(string $capability, bool $mutation = false): string {
    return lehrfahrer_route_authorize($capability, $mutation, true);
}

function lehrfahrer_personnel_driver_file(string $companyId, bool $create = false): string {
    return lehrfahrer_tenant_path($companyId, 'drivers', 'drivers.json', $create);
}

function lehrfahrer_personnel_driver(string $companyId, string $driverId): ?array {
    if (!preg_match('/^drv_[a-f0-9]{32}$/D', $driverId)) return null;
    $file = lehrfahrer_personnel_driver_file($companyId);
    if (!is_file($file)) return null;
    $drivers = json_decode((string)file_get_contents($file), true);
    if (!is_array($drivers)) return null;
    foreach ($drivers as $driver) {
        if (is_array($driver) && ($driver['id'] ?? null) === $driverId) return $driver;
    }
    return null;
}

function lehrfahrer_personnel_training_file(string $companyId, string $trainingId, bool $create = false): ?string {
    if (!preg_match('/^training_\d{6}$/D', $trainingId)) return null;
    return lehrfahrer_tenant_path($companyId, 'trainings', $trainingId . '.json', $create);
}

function lehrfahrer_personnel_training(string $companyId, string $trainingId): ?array {
    $file = lehrfahrer_personnel_training_file($companyId, $trainingId);
    if ($file === null || !is_file($file)) return null;
    $training = json_decode((string)file_get_contents($file), true);
    return is_array($training) ? $training : null;
}

function lehrfahrer_personnel_route_file(string $companyId, array $item): ?string {
    try {
        $file = lehrfahrer_route_file(
            $companyId,
            (string)($item['city'] ?? ''),
            (string)($item['fileBase'] ?? ''),
            'json',
            (string)($item['lineFolder'] ?? ''),
            (string)($item['categoryFolder'] ?? '')
        );
        return is_file($file) ? $file : null;
    } catch (InvalidArgumentException $error) {
        return null;
    }
}

function lehrfahrer_personnel_document_file(string $companyId, string $packageId, string $fileName, bool $create = false): ?string {
    if (!preg_match('/^pkg_[a-f0-9]{32}$/D', $packageId)
        || !preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.pdf$/D', $fileName)) return null;
    return lehrfahrer_tenant_path($companyId, 'documents', $packageId . '/' . $fileName, $create);
}
