<?php
declare(strict_types=1);

require_once __DIR__ . '/_audit_file_operation.php';
require_once __DIR__ . '/_route_gpx.php';

function lehrfahrer_route_bundle_target(string $companyId, string $city, string $lineFolder,
    string $categoryFolder, string $fileBase): array {
    $relative = $city . '/' . $lineFolder . '/' . $categoryFolder . '/' . $fileBase . '.json';
    return [$relative, lehrfahrer_route_file($companyId, $city, $fileBase, 'json', $lineFolder, $categoryFolder)];
}

/** Keep the existing collision and diversion decision, now under the save lock. */
function lehrfahrer_route_bundle_choose_target(string $companyId, array &$data, string $city,
    string $lineFolder, string $categoryFolder, string &$fileBase, bool $forceOverwrite): array {
    [$relative, $path] = lehrfahrer_route_bundle_target($companyId, $city, $lineFolder, $categoryFolder, $fileBase);
    if (!is_file($path) || $forceOverwrite) return [$relative, $path];
    $existing = lehrfahrer_gtfs_work_read_json($path);
    if (!is_array($existing)) throw new RuntimeException('Vorhandene Route kann nicht verglichen werden.');
    $oldLine = is_array($existing['line'] ?? null) ? $existing['line'] : $existing;
    $newLine = is_array($data['line'] ?? null) ? $data['line'] : $data;
    $oldRoute = $oldLine['routeName'] ?? $existing['routeName'] ?? '';
    $oldDirection = $oldLine['directionName'] ?? $existing['directionName'] ?? '';
    $newRoute = $newLine['routeName'] ?? $data['routeName'] ?? '';
    $newDirection = $newLine['directionName'] ?? $data['directionName'] ?? '';
    $same = $oldRoute === $newRoute && $oldDirection === $newDirection;
    $diversion = hasDiversionSuffix($fileBase) || hasDiversionSuffix((string)$newRoute)
        || hasDiversionSuffix((string)$oldRoute);
    if ($same && !$diversion) {
        $base = $fileBase;
        for ($i = 1; $i <= 99; $i++) {
            $suffix = 'Umleitung_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
            $candidate = $base . '_' . $suffix;
            [$candidateRelative, $candidatePath] = lehrfahrer_route_bundle_target(
                $companyId, $city, $lineFolder, $categoryFolder, $candidate);
            if (file_exists($candidatePath)) continue;
            $fileBase = $candidate;
            $routeName = trim((string)$newRoute);
            if ($routeName === '') $routeName = 'Route';
            if (!hasDiversionSuffix($routeName)) $routeName .= ' ' . $suffix;
            $data['routeName'] = $routeName;
            if (is_array($data['line'] ?? null)) $data['line']['routeName'] = $routeName;
            return [$candidateRelative, $candidatePath];
        }
    } elseif (!$same) {
        $base = $fileBase;
        for ($i = 1; $i <= 99; $i++) {
            $candidate = $base . '_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
            [$candidateRelative, $candidatePath] = lehrfahrer_route_bundle_target(
                $companyId, $city, $lineFolder, $categoryFolder, $candidate);
            if (file_exists($candidatePath)) continue;
            $fileBase = $candidate;
            return [$candidateRelative, $candidatePath];
        }
    }
    throw new RuntimeException('Kein freies Routenziel verfuegbar.');
}

function lehrfahrer_route_bundle_manual_target_allowed(string $companyId, array $inventory, string $path): void {
    foreach ($inventory['entries'] ?? [] as $entry) {
        if (!is_array($entry)) throw new RuntimeException('GTFS-Arbeitsvorrat ist ungueltig.');
        $reference = $entry['savedRoute'] ?? null;
        if ($reference === null || $reference === '') continue;
        if (!is_string($reference)) throw new RuntimeException('GTFS-Routenreferenz ist ungueltig.');
        $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
        if (lehrfahrer_tenant_same_path($path, $target['path'])) {
            throw new RuntimeException('Diese GTFS-Arbeitsroute muss mit ihrer GTFS-Identitaet gespeichert werden.');
        }
    }
}

/** Validate exactly the current inventory entry and compute only the required update. */
function lehrfahrer_route_bundle_gtfs_inventory(string $companyId, array $inventory, array $data,
    string $reference, string $path, ?array $oldRoute, string $changeType): ?string {
    $work = $data['meta']['gtfsWork'] ?? null;
    $routeId = trim((string)($work['routeId'] ?? ''));
    $variantId = trim((string)($work['variantId'] ?? ''));
    if ($routeId === '' || $variantId === '') throw new RuntimeException('GTFS-Routenkennung fehlt.');
    $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
    if (!lehrfahrer_tenant_same_path($target['path'], $path)) {
        throw new RuntimeException('GTFS-Speicherziel stimmt nicht mit der Routenreferenz ueberein.');
    }
    lehrfahrer_gtfs_work_unique_entry($inventory, $routeId, $variantId);
    foreach ($inventory['entries'] as $i => $entry) {
        if ((string)($entry['routeId'] ?? '') !== $routeId || (string)($entry['variantId'] ?? '') !== $variantId) continue;
        if (($entry['timetableStatus'] ?? '') === 'ENTFALLEN') throw new RuntimeException('GTFS-Fuehrung ist nicht mehr im CURRENT.');
        $status = (string)($entry['status'] ?? '');
        if (!in_array($status, LEHRFAHRER_GTFS_WORK_STATUSES, true)) throw new RuntimeException('GTFS-Arbeitsstatus ist ungueltig.');
        $oldReference = $entry['savedRoute'] ?? null;
        if ($oldReference !== null && $oldReference !== '') {
            if (!is_string($oldReference)) throw new RuntimeException('Gespeicherte GTFS-Routenreferenz ist ungueltig.');
            try {
                lehrfahrer_gtfs_work_load_saved_route($companyId, $oldReference, $routeId, $variantId);
            } catch (Throwable $error) {
                if ($status !== 'IN_BEARBEITUNG' || !hash_equals($oldReference, $reference)) throw $error;
                lehrfahrer_gtfs_work_load_saved_route_for_repair($companyId, $inventory, $entry, $routeId, $variantId);
            }
        }
        if (in_array($status, ['GEPRUEFT', 'FREIGEGEBEN'], true)
            && (!is_string($oldReference) || !hash_equals($oldReference, $reference))) {
            throw new RuntimeException('Freigegebene Route darf nicht unter anderem Ziel gespeichert werden.');
        }
        if ($oldRoute !== null) {
            $oldWork = $oldRoute['meta']['gtfsWork'] ?? null;
            $repairable = !is_array($oldWork) && $status === 'IN_BEARBEITUNG'
                && is_string($oldReference) && hash_equals($oldReference, $reference)
                && !array_key_exists('gtfsWork', is_array($oldRoute['meta'] ?? null) ? $oldRoute['meta'] : []);
            if ((!is_array($oldWork) && !$repairable)
                || (is_array($oldWork) && ((string)($oldWork['routeId'] ?? '') !== $routeId
                    || (string)($oldWork['variantId'] ?? '') !== $variantId))) {
                throw new RuntimeException('Zieldatei gehoert zu einer anderen GTFS-Fuehrung.');
            }
        }
        $next = $entry;
        if (($next['savedRoute'] ?? null) !== $reference) $next['savedRoute'] = $reference;
        if ($status === 'UNGEPRUEFT') $next['status'] = 'IN_BEARBEITUNG';
        if ($changeType === 'CHANGED' && in_array($status, ['GEPRUEFT', 'FREIGEGEBEN'], true)) {
            $next['status'] = 'IN_BEARBEITUNG';
        }
        if ($next !== $entry) {
            $next['reviewRequired'] = ($next['status'] ?? '') !== 'FREIGEGEBEN';
            $next['updatedAt'] = date('c');
            $inventory['entries'][$i] = $next;
            $inventory['updatedAt'] = date('c');
            return json_encode($inventory, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        }
        return null;
    }
    throw new RuntimeException('GTFS-Arbeitsvariante fehlt.');
}

function lehrfahrer_route_bundle_save(array $auth, array $data, string $city, string $lineFolder,
    string $categoryFolder, string $fileBase, bool $forceOverwrite): array {
    $companyId = lehrfahrer_route_company_id($auth);
    $pdo = $auth['pdo'];
    return lehrfahrer_audit_file_lock($companyId, static function (string $directory) use (
        $pdo, $auth, $companyId, $data, $city, $lineFolder, $categoryFolder, $fileBase, $forceOverwrite
    ): array {
        lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory);
        $actor = LehrfahrerAuditActor::currentAccount($pdo);
        if ($actor->contextType !== 'TENANT' || $actor->accountId !== $auth['account_id']
            || $actor->membershipId !== $auth['membership_id'] || $actor->companyId !== $companyId
            || !in_array('routes.write', lehrfahrer_account_tenant_capabilities(
                $pdo, $actor->accountId, $actor->membershipId), true)) {
            throw new RuntimeException('Account-Berechtigung fuer Routensave ist nicht mehr gueltig.');
        }
        return lehrfahrer_gtfs_work_with_inventory_lock($companyId, static function () use (
            $pdo, $actor, $companyId, $data, $city, $lineFolder, $categoryFolder, $fileBase, $forceOverwrite
        ): array {
            [$reference, $path] = lehrfahrer_route_bundle_choose_target($companyId, $data, $city,
                $lineFolder, $categoryFolder, $fileBase, $forceOverwrite);
            $oldRaw = is_file($path) ? @file_get_contents($path) : null;
            if ($oldRaw === false) throw new RuntimeException('Vorhandene Route kann nicht gelesen werden.');
            $oldRoute = $oldRaw === null ? null : json_decode($oldRaw, true);
            if ($oldRaw !== null && !is_array($oldRoute)) throw new RuntimeException('Vorhandene Route kann nicht verglichen werden.');
            $changeType = $oldRoute === null ? 'NEW' : lehrfahrer_route_content_change($oldRoute, $data);
            $effective = $changeType === 'UNCHANGED' ? $oldRoute : $data;
            if ($changeType !== 'UNCHANGED') $effective['savedAt'] = date('c');

            $inventoryPath = lehrfahrer_gtfs_work_inventory_path($companyId);
            $inventory = lehrfahrer_gtfs_work_read_json($inventoryPath);
            if (is_file($inventoryPath) && (!is_array($inventory) || !is_array($inventory['entries'] ?? null))) {
                throw new RuntimeException('GTFS-Arbeitsvorrat ist ungueltig.');
            }
            $inventoryBytes = null;
            if (array_key_exists('gtfsWork', is_array($effective['meta'] ?? null) ? $effective['meta'] : [])) {
                if (!is_array($inventory)) throw new RuntimeException('GTFS-Arbeitsvorrat fehlt.');
                $inventoryBytes = lehrfahrer_route_bundle_gtfs_inventory($companyId, $inventory, $effective,
                    $reference, $path, $oldRoute, $changeType);
            } else {
                if (is_array($oldRoute['meta']['gtfsWork'] ?? null)) {
                    throw new RuntimeException('GTFS-Routenidentitaet darf nicht entfernt werden.');
                }
                lehrfahrer_route_bundle_manual_target_allowed($companyId, $inventory ?? [], $path);
            }

            $json = json_encode($effective, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $artifactData = $effective;
            if ($changeType === 'UNCHANGED' && empty($artifactData['savedAt'])) {
                $artifactData['savedAt'] = date('c', (int)(filemtime($path) ?: 0));
            }
            $pdf = buildLineOverviewPdf($artifactData, $city, $lineFolder);
            if (!str_starts_with($pdf, '%PDF-')) throw new RuntimeException('PDF konnte nicht vorbereitet werden.');
            $gpx = lehrfahrer_route_gpx_from_data($artifactData);
            $files = [];
            if ($changeType !== 'UNCHANGED') $files[] = ['relative' => $reference, 'kind' => $oldRaw === null ? 'CREATE' : 'UPDATE', 'content' => $json];
            $stem = substr($reference, 0, -5);
            $repair = false;
            foreach (['pdf' => $pdf, 'gpx' => $gpx] as $extension => $bytes) {
                $relative = $stem . '.' . $extension;
                $target = lehrfahrer_audit_file_target($companyId, $relative);
                $previous = is_file($target) ? @file_get_contents($target) : null;
                if ($previous === false) throw new RuntimeException('Begleitartefakt kann nicht gelesen werden.');
                // Existing legacy artifacts have no version/hash binding. Only absence is
                // an unambiguous repair reason for a semantically unchanged route.
                if ($changeType === 'UNCHANGED' && $previous !== null) continue;
                if ($previous === $bytes) continue;
                $files[] = ['relative' => $relative, 'kind' => $previous === null ? 'CREATE' : 'UPDATE', 'content' => $bytes];
                if ($changeType === 'UNCHANGED') $repair = true;
            }
            if ($inventoryBytes !== null) $files[] = ['relative' => 'gtfs/index/work-inventory.json',
                'area' => 'imports', 'kind' => 'UPDATE', 'content' => $inventoryBytes];

            if ($files !== []) {
                $kind = $oldRaw === null ? 'CREATE' : 'UPDATE';
                $event = ['action' => 'ROUTE_SAVE', 'objectType' => 'ROUTE',
                    'objectId' => lehrfahrer_audit_file_object_id($companyId, $reference), 'result' => 'SUCCESS'];
                lehrfahrer_audit_file_mutate($pdo, $actor, $companyId, $reference, $kind, $files, $event);
            }
            return ['city' => $city, 'lineFolder' => $lineFolder, 'categoryFolder' => $categoryFolder,
                'fileBase' => $fileBase, 'file' => basename($path), 'changeType' => $changeType,
                'savedAt' => $effective['savedAt'] ?? null, 'gpxSaved' => true, 'pdfSaved' => true,
                'repair' => $repair];
        });
    });
}
