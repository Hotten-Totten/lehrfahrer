<?php
declare(strict_types=1);

require_once __DIR__ . '/_audit_file_operation.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';

/** Recheck the account membership after acquiring the route lock. */
function lehrfahrer_route_audit_actor(array $auth, string $capability): LehrfahrerAuditActor {
    $pdo = $auth['pdo'];
    $companyId = lehrfahrer_route_company_id($auth);
    $actor = LehrfahrerAuditActor::currentAccount($pdo);
    if (($auth['auth_source'] ?? null) !== 'ACCOUNT'
        || $actor->contextType !== 'TENANT'
        || $actor->accountId !== ($auth['account_id'] ?? null)
        || $actor->membershipId !== ($auth['membership_id'] ?? null)
        || $actor->companyId !== $companyId
        || !in_array($capability, lehrfahrer_account_tenant_capabilities(
            $pdo, $actor->accountId, $actor->membershipId), true)) {
        throw new RuntimeException('Account-Berechtigung fuer Routenaktion ist nicht mehr gueltig.');
    }
    return $actor;
}

function lehrfahrer_route_audit_event(string $companyId, string $reference, string $action,
    string $capability): array {
    return ['action' => $action, 'objectType' => 'ROUTE',
        'objectId' => lehrfahrer_audit_file_object_id($companyId, $reference),
        'result' => 'SUCCESS', 'capability' => $capability];
}

/** The existing transition functions retain all lifecycle validation. */
function lehrfahrer_route_audit_status(array $auth, string $routeId, string $variantId,
    string $status, bool $revoke = false): array {
    $companyId = lehrfahrer_route_company_id($auth);
    $pdo = $auth['pdo'];
    return lehrfahrer_audit_file_lock($companyId, static function (string $directory) use (
        $auth, $companyId, $pdo, $routeId, $variantId, $status, $revoke
    ): array {
        lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory);
        $actor = lehrfahrer_route_audit_actor($auth, 'routes.import');
        $persist = static function (array $inventory, array $after) use (
            $companyId, $pdo, $actor, $routeId, $variantId, $revoke
        ): void {
            $reference = $after['savedRoute'] ?? null;
            if (!is_string($reference) || $reference === '') {
                // A work item can enter IN_BEARBEITUNG before a saved route exists.
                // Its technical work identity is distinct from the future saved route.
                $reference = 'gtfs/' . lehrfahrer_gtfs_work_key($routeId, $variantId) . '.json';
                $action = 'GTFS_WORK_START';
            } else {
                lehrfahrer_gtfs_work_reference_target($companyId, $reference);
                $action = match ($after['status']) {
                    'GEPRUEFT' => 'ROUTE_REVIEW',
                    'FREIGEGEBEN' => 'ROUTE_RELEASE',
                    default => 'ROUTE_STATUS_CHANGE',
                };
            }
            if ($revoke) $action = 'ROUTE_RELEASE_REVOKE';
            $event = lehrfahrer_route_audit_event($companyId, $reference, $action, 'routes.import');
            $bytes = json_encode($inventory, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
                | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            lehrfahrer_audit_file_mutate($pdo, $actor, $companyId, $reference, 'UPDATE',
                [['relative' => 'gtfs/index/work-inventory.json', 'area' => 'imports',
                    'kind' => 'UPDATE', 'content' => $bytes]], $event);
        };
        return $revoke
            ? lehrfahrer_gtfs_work_revoke_release($companyId, $routeId, $variantId, $persist)
            : lehrfahrer_gtfs_work_set_status($companyId, $routeId, $variantId, $status, $persist);
    });
}

/** Install the pilot's confirmed new routes in one recoverable transaction. */
function lehrfahrer_route_audit_create_batch(array $auth, array $writes, ?callable $checkpoint = null): void {
    $companyId = lehrfahrer_route_company_id($auth);
    $pdo = $auth['pdo'];
    lehrfahrer_audit_file_lock($companyId, static function (string $directory) use (
        $auth, $companyId, $pdo, $writes, $checkpoint
    ): void {
        lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory);
        $actor = lehrfahrer_route_audit_actor($auth, 'routes.write');
        lehrfahrer_route_audit_actor($auth, 'routes.import');
        $root = lehrfahrer_tenant_area($companyId, 'lines');
        $files = []; $events = []; $references = [];
        foreach ($writes as $write) {
            $path = lehrfahrer_route_checked_path($companyId, $write['path']);
            $reference = str_replace('\\', '/', substr($path, strlen($root) + 1));
            $references[] = $reference;
            $files[] = ['relative' => $reference, 'content' => json_encode($write['data'],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)];
            $events[] = lehrfahrer_route_audit_event($companyId, $reference, 'ROUTE_CREATE', 'routes.write');
        }
        if ($references === []) throw new InvalidArgumentException('Keine Routen fuer die Mehrfachanlage.');
        $firstEvent = array_shift($events);
        lehrfahrer_audit_file_mutate($pdo, $actor, $companyId, $references[0], 'CREATE',
            $files, $firstEvent, $checkpoint, $events, $references);
    });
}
