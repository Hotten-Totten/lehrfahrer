<?php
declare(strict_types=1);

require_once __DIR__ . '/_tenant_route_storage.php';
require_once __DIR__ . '/_audit.php';

const LEHRFAHRER_AUDIT_FILE_STATES = [
    'PREPARING', 'PREPARED', 'AUDIT_PREPARED', 'ACTIVATING',
    'FILE_ACTIVATED', 'DB_COMMITTED', 'COMPLETED', 'BLOCKED',
];

function lehrfahrer_audit_file_object_id(string $companyId, string $routeRelative): string {
    lehrfahrer_tenant_company_id($companyId);
    lehrfahrer_tenant_segments($routeRelative);
    if (!str_ends_with($routeRelative, '.json')) throw new InvalidArgumentException('Routenobjekt muss JSON sein.');
    return 'route_' . substr(hash('sha256', $companyId . "\0" . $routeRelative), 0, 32);
}

function lehrfahrer_audit_file_related_path(string $routeRelative, string $relative, string $area,
    string $kind = 'UPDATE'): bool {
    if ($area === 'imports') return $relative === 'gtfs/index/work-inventory.json';
    $stem = substr($routeRelative, 0, -5);
    if (in_array($relative, [$routeRelative, $stem . '.gpx', $stem . '.pdf'], true)) return true;
    if ($kind !== 'DELETE') return false;
    $directory = dirname($routeRelative);
    $parts = explode('/', $routeRelative);
    $city = $parts[0];
    $base = basename($stem);
    $prefix = trim(implode('_', array_slice($parts, 1, -1)), '_');
    $legacyPdf = $city . '/pdf/' . ($prefix === '' ? '' : $prefix . '__') . $base . '.pdf';
    $allowed = [$routeRelative, $stem . '.gpx', $stem . '.pdf',
        $directory . '/gpx/' . $base . '.pdf', $legacyPdf];
    if ($directory === $city) $allowed[] = $city . '/gpx/' . $base . '.gpx';
    return in_array($relative, $allowed, true);
}

function lehrfahrer_audit_file_directory(string $companyId): string {
    return lehrfahrer_tenant_ensure_directory($companyId, 'imports', 'audit-file-operations');
}

function lehrfahrer_audit_file_lock(string $companyId, callable $work): mixed {
    static $held = [];
    if (isset($held[$companyId])) return $work($held[$companyId]);
    $directory = lehrfahrer_audit_file_directory($companyId);
    $path = $directory . DIRECTORY_SEPARATOR . '.lock';
    if (is_link($path)) throw new RuntimeException('Audit-Dateisperre ist unsicher.');
    $handle = fopen($path, 'c');
    if ($handle === false) throw new RuntimeException('Audit-Dateisperre fehlt.');
    try {
        if (!flock($handle, LOCK_EX)) throw new RuntimeException('Audit-Dateisperre fehlgeschlagen.');
        $held[$companyId] = $directory;
        return $work($directory);
    } finally {
        unset($held[$companyId]);
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

/** Hold the returned handle until the response has been fully sent. */
function lehrfahrer_audit_file_read_lock(string $companyId) {
    $directory = lehrfahrer_audit_file_directory($companyId);
    $path = $directory . DIRECTORY_SEPARATOR . '.lock';
    if (is_link($path)) throw new RuntimeException('Audit-Dateisperre ist unsicher.');
    $handle = fopen($path, 'c');
    if ($handle === false || !flock($handle, LOCK_SH)) {
        if (is_resource($handle)) fclose($handle);
        throw new RuntimeException('Audit-Lesesperre fehlgeschlagen.');
    }
    return $handle;
}

/** For existing maintenance writers that must not race a recoverable Save. */
function lehrfahrer_audit_file_write_lock(string $companyId) {
    $directory = lehrfahrer_audit_file_directory($companyId);
    $path = $directory . DIRECTORY_SEPARATOR . '.lock';
    if (is_link($path)) throw new RuntimeException('Audit-Dateisperre ist unsicher.');
    $handle = fopen($path, 'c');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        if (is_resource($handle)) fclose($handle);
        throw new RuntimeException('Audit-Dateisperre fehlgeschlagen.');
    }
    return $handle;
}

function lehrfahrer_audit_file_journal_path(string $directory, string $id): string {
    if (preg_match('/^op_[a-f0-9]{32}$/D', $id) !== 1) throw new InvalidArgumentException('Vorgangs-ID ungueltig.');
    return $directory . DIRECTORY_SEPARATOR . $id . '.json';
}

function lehrfahrer_audit_file_seal(array $record): array {
    unset($record['checksum']);
    $record['checksum'] = hash('sha256', json_encode($record, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    return $record;
}

function lehrfahrer_audit_file_store(string $directory, array $record): void {
    $path = lehrfahrer_audit_file_journal_path($directory, $record['id']);
    $bytes = json_encode(lehrfahrer_audit_file_seal($record), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $temp = $path . '.tmp-' . bin2hex(random_bytes(8));
    $handle = @fopen($temp, 'x+b');
    if ($handle === false) throw new RuntimeException('Journal kann nicht vorbereitet werden.');
    try {
        if (@fwrite($handle, $bytes) !== strlen($bytes) || !@fflush($handle)
            || (function_exists('fsync') && !@fsync($handle))) {
            throw new RuntimeException('Journal wurde nicht vollstaendig geschrieben.');
        }
    } finally {
        if (!@fclose($handle)) { @unlink($temp); throw new RuntimeException('Journal konnte nicht geschlossen werden.'); }
    }
    @chmod($temp, 0600);
    if (!@rename($temp, $path)) { @unlink($temp); throw new RuntimeException('Journal konnte nicht aktiviert werden.'); }
}

function lehrfahrer_audit_file_read(string $path, string $companyId): array {
    if (is_link($path) || !is_file($path)) throw new RuntimeException('Journalpfad ungueltig.');
    $record = json_decode((string)@file_get_contents($path), true);
    if (!is_array($record) || !isset($record['checksum']) || !is_string($record['checksum'])) {
        throw new RuntimeException('Journal ungueltig.');
    }
    $seal = lehrfahrer_audit_file_seal($record);
    $required = ['id','companyId','routeRelative','objectId','kind','state','auditEventId','files','checksum'];
    $batch = ($record['version'] ?? null) === 2;
    if ($batch) $required = array_merge($required, ['version', 'routes']);
    $keys = array_keys($record);
    sort($required); sort($keys);
    if ($keys !== $required || !hash_equals($seal['checksum'], $record['checksum'])
        || ($record['companyId'] ?? null) !== $companyId
        || !in_array($record['state'] ?? null, LEHRFAHRER_AUDIT_FILE_STATES, true)
        || !in_array($record['kind'] ?? null, ['CREATE', 'UPDATE', 'DELETE'], true)
        || !is_array($record['files'] ?? null) || $record['files'] === []
        || (($record['auditEventId'] ?? null) !== null
            && (!is_string($record['auditEventId'])
                || preg_match('/^aud_[a-f0-9]{32}$/D', $record['auditEventId']) !== 1))
        || lehrfahrer_audit_file_journal_path(dirname($path), (string)($record['id'] ?? '')) !== $path
        || ($record['objectId'] ?? null) !== lehrfahrer_audit_file_object_id($companyId, (string)($record['routeRelative'] ?? ''))) {
        throw new RuntimeException('Journal wurde manipuliert oder ist ungueltig.');
    }
    $batchReferences = $batch ? lehrfahrer_audit_file_batch_references($record) : [];
    foreach ($record['files'] as $i => $file) {
        $fileKeys = is_array($file) ? array_keys($file) : [];
        sort($fileKeys);
        if (!is_int($i) || !is_array($file) || !is_string($file['relative'] ?? null)
            || !in_array($fileKeys, [
                ['area','newHash','oldHash','relative'],
                ['area','kind','newHash','oldHash','relative'],
            ], true)
            || !in_array($file['area'] ?? null, ['lines','imports'], true)
            || ($batch
                ? ($file['area'] !== 'lines' || ($file['kind'] ?? $record['kind']) !== 'CREATE'
                    || !isset($batchReferences[$file['relative']]))
                : !lehrfahrer_audit_file_related_path($record['routeRelative'], $file['relative'], $file['area'],
                    $file['kind'] ?? $record['kind']))
            || ($file['area'] === 'imports'
                && ($file['relative'] !== 'gtfs/index/work-inventory.json' || ($file['kind'] ?? $record['kind']) !== 'UPDATE'))
            || !in_array($file['kind'] ?? $record['kind'], ['CREATE','UPDATE','DELETE'], true)
            || (($file['oldHash'] ?? null) !== null
                && preg_match('/^[a-f0-9]{64}$/D', (string)$file['oldHash']) !== 1)
            || (($file['newHash'] ?? null) !== null
                && preg_match('/^[a-f0-9]{64}$/D', (string)$file['newHash']) !== 1)
            || (($file['kind'] ?? $record['kind']) === 'CREATE' && $file['oldHash'] !== null)
            || (($file['kind'] ?? $record['kind']) !== 'CREATE' && $file['oldHash'] === null)
            || (($file['kind'] ?? $record['kind']) === 'DELETE' && $file['newHash'] !== null)
            || (($file['kind'] ?? $record['kind']) !== 'DELETE' && $file['newHash'] === null)) {
            throw new RuntimeException('Journal-Dateieintrag ungueltig.');
        }
        lehrfahrer_tenant_segments($file['relative']);
    }
    if ($batch && (count($record['files']) !== count($batchReferences)
        || count(array_unique(array_column($record['files'], 'relative'))) !== count($batchReferences))) {
        throw new RuntimeException('Mehrfachanlage besitzt keine vollstaendige Dateiliste.');
    }
    return $record;
}

/** Version 2 is restricted to a complete batch of new JSON routes. */
function lehrfahrer_audit_file_batch_references(array $record): array {
    if ($record['kind'] !== 'CREATE' || !is_array($record['routes'] ?? null)
        || !array_is_list($record['routes']) || $record['routes'] === []) {
        throw new RuntimeException('Mehrfachanlage ist ungueltig.');
    }
    $references = [];
    $hasWitness = $record['auditEventId'] !== null;
    foreach ($record['routes'] as $route) {
        $keys = is_array($route) ? array_keys($route) : [];
        sort($keys);
        if ($keys !== ['auditEventId', 'objectId', 'relative']
            || !is_string($route['relative'] ?? null) || count(explode('/', $route['relative'])) !== 4
            || isset($references[$route['relative']])
            || $route['objectId'] !== lehrfahrer_audit_file_object_id($record['companyId'], $route['relative'])
            || ($hasWitness ? preg_match('/^aud_[a-f0-9]{32}$/D', (string)$route['auditEventId']) !== 1
                : $route['auditEventId'] !== null)) {
            throw new RuntimeException('Mehrfachanlage enthaelt eine ungueltige Route.');
        }
        $references[$route['relative']] = $route['objectId'];
    }
    $first = $record['routes'][0];
    if ($first['relative'] !== $record['routeRelative'] || $first['objectId'] !== $record['objectId']
        || $first['auditEventId'] !== $record['auditEventId']
        || ($hasWitness && count(array_unique(array_column($record['routes'], 'auditEventId'))) !== count($references))) {
        throw new RuntimeException('Mehrfachanlage besitzt widerspruechliche Auditzeugen.');
    }
    return $references;
}

function lehrfahrer_audit_file_transition(string $directory, array &$record, string $next): void {
    $allowed = [
        'PREPARING' => ['PREPARED', 'COMPLETED', 'BLOCKED'],
        'PREPARED' => ['AUDIT_PREPARED', 'COMPLETED', 'BLOCKED'],
        'AUDIT_PREPARED' => ['ACTIVATING', 'COMPLETED', 'BLOCKED'],
        'ACTIVATING' => ['FILE_ACTIVATED', 'COMPLETED', 'BLOCKED'],
        'FILE_ACTIVATED' => ['DB_COMMITTED', 'COMPLETED', 'BLOCKED'],
        'DB_COMMITTED' => ['COMPLETED', 'BLOCKED'],
        'BLOCKED' => ['COMPLETED'],
    ];
    if (!in_array($next, $allowed[$record['state']] ?? [], true)) {
        throw new RuntimeException('Ungueltiger Journal-Uebergang.');
    }
    $record['state'] = $next;
    lehrfahrer_audit_file_store($directory, $record);
}

/** A journal is visible before any route file can change. Invalid journals block the whole tenant. */
function lehrfahrer_audit_file_route_blocked(string $companyId, string $absoluteJsonPath): bool {
    $checked = lehrfahrer_route_checked_path($companyId, $absoluteJsonPath);
    $root = lehrfahrer_tenant_area($companyId, 'lines');
    $relative = str_replace('\\', '/', substr($checked, strlen($root) + 1));
    $objectId = lehrfahrer_audit_file_object_id($companyId, $relative);
    $directory = lehrfahrer_audit_file_directory($companyId);
    foreach (glob($directory . DIRECTORY_SEPARATOR . '*.json') ?: [] as $path) {
        try {
            $record = lehrfahrer_audit_file_read($path, $companyId);
        } catch (Throwable $error) {
            return true;
        }
        if ($record['objectId'] === $objectId) return true;
        foreach ($record['routes'] ?? [] as $route) {
            if ($route['objectId'] === $objectId) return true;
        }
    }
    return false;
}

function lehrfahrer_audit_file_any_blocked(string $companyId): bool {
    $directory = lehrfahrer_audit_file_directory($companyId);
    foreach (glob($directory . DIRECTORY_SEPARATOR . '*.json') ?: [] as $path) {
        try { $record = lehrfahrer_audit_file_read($path, $companyId); }
        catch (Throwable $error) { return true; }
        return true;
    }
    return false;
}

function lehrfahrer_audit_file_request_blocked(string $companyId, string $city, string $line,
    string $lineFolder = '', string $categoryFolder = ''): bool {
    $candidates = [];
    if ($lineFolder !== '' && $categoryFolder !== '') $candidates[] = [$lineFolder, $categoryFolder];
    if ($lineFolder !== '') $candidates[] = [$lineFolder, ''];
    $candidates[] = ['', ''];
    foreach ($candidates as [$folder, $category]) {
        $path = lehrfahrer_route_file($companyId, $city, $line, 'json', $folder, $category);
        if (lehrfahrer_audit_file_route_blocked($companyId, $path)) return true;
    }
    return false;
}

function lehrfahrer_audit_file_target(string $companyId, string $relative, string $area = 'lines'): string {
    if (!in_array($area, ['lines','imports'], true)
        || ($area === 'imports' && $relative !== 'gtfs/index/work-inventory.json')) {
        throw new InvalidArgumentException('Audit-Dateibereich ungueltig.');
    }
    $path = lehrfahrer_tenant_path($companyId, $area, $relative);
    if (is_link($path) || is_link(dirname($path)) || (file_exists($path) && !is_file($path))) {
        throw new RuntimeException('Audit-Dateiziel ist unsicher.');
    }
    return $path;
}

function lehrfahrer_audit_file_auxiliary(string $path, string $id, int $index, string $suffix): string {
    $aux = dirname($path) . DIRECTORY_SEPARATOR . '.lf-audit-' . $id . '-' . $index . '.' . $suffix;
    if (file_exists($aux) || is_link($aux)) throw new RuntimeException('Audit-Hilfsdatei existiert bereits.');
    return $aux;
}

function lehrfahrer_audit_file_write_complete(string $path, string $bytes): void {
    $handle = @fopen($path, 'x+b');
    if ($handle === false) throw new RuntimeException('Audit-Datei kann nicht vorbereitet werden.');
    try {
        if (@fwrite($handle, $bytes) !== strlen($bytes) || !@fflush($handle)
            || (function_exists('fsync') && !@fsync($handle))) {
            throw new RuntimeException('Audit-Datei wurde nicht vollstaendig geschrieben.');
        }
    } finally {
        if (!@fclose($handle)) throw new RuntimeException('Audit-Datei konnte nicht geschlossen werden.');
    }
    @chmod($path, 0600);
    if (!hash_equals(hash('sha256', $bytes), (string)@hash_file('sha256', $path))) {
        throw new RuntimeException('Audit-Datei ist nach dem Schreiben unvollstaendig.');
    }
}

function lehrfahrer_audit_file_event_committed(PDO $pdo, array $record): bool {
    $id = $record['auditEventId'] ?? null;
    if ($id === null) return false;
    if (!is_string($id) || preg_match('/^aud_[a-f0-9]{32}$/D', $id) !== 1) {
        throw new RuntimeException('Audit-Witness ist ungueltig.');
    }
    if (($record['version'] ?? null) === 2) {
        $committed = 0;
        foreach ($record['routes'] as $route) {
            $single = ['auditEventId' => $route['auditEventId'], 'objectId' => $route['objectId']];
            if (lehrfahrer_audit_file_event_committed($pdo, $single)) $committed++;
        }
        if ($committed !== 0 && $committed !== count($record['routes'])) {
            throw new RuntimeException('Mehrfachanlage besitzt nur teilweise Auditzeugen.');
        }
        return $committed !== 0;
    }
    $query = $pdo->prepare('SELECT object_id,result FROM audit_events WHERE event_id = ?');
    $query->execute([$id]);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) return false;
    if (count($rows) !== 1 || $rows[0]['object_id'] !== $record['objectId']
        || $rows[0]['result'] !== 'SUCCESS') {
        throw new RuntimeException('Audit-Witness stimmt nicht mit der Dateioperation ueberein.');
    }
    return true;
}

function lehrfahrer_audit_file_cleanup(string $companyId, array $record): void {
    foreach ($record['files'] as $i => $file) {
        $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
        foreach (['new', 'bak'] as $suffix) {
            $aux = dirname($target) . DIRECTORY_SEPARATOR . '.lf-audit-' . $record['id'] . '-' . $i . '.' . $suffix;
            if (is_link($aux)) throw new RuntimeException('Audit-Hilfsdatei ist ein Symlink.');
            if (is_file($aux) && !@unlink($aux)) throw new RuntimeException('Audit-Hilfsdatei konnte nicht entfernt werden.');
        }
    }
}

function lehrfahrer_audit_file_restore(string $companyId, array $record): void {
    foreach (array_reverse($record['files'], true) as $i => $file) {
        $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
        $backup = dirname($target) . DIRECTORY_SEPARATOR . '.lf-audit-' . $record['id'] . '-' . $i . '.bak';
        if (is_link($backup)) throw new RuntimeException('Audit-Backup ist ein Symlink.');
        $currentHash = is_file($target) ? @hash_file('sha256', $target) : null;
        $oldHash = $file['oldHash'];
        $newHash = $file['newHash'];
        $kind = $file['kind'] ?? $record['kind'];
        if ($kind === 'CREATE') {
            if ($currentHash !== null && $currentHash !== $newHash) throw new RuntimeException('CREATE-Ziel wurde fremd veraendert.');
            if ($currentHash !== null && !@unlink($target)) throw new RuntimeException('CREATE-Rollback fehlgeschlagen.');
        } elseif ($kind === 'UPDATE') {
            if ($currentHash === $oldHash) continue;
            if ($currentHash !== $newHash || !is_file($backup)
                || @hash_file('sha256', $backup) !== $oldHash
                || !@rename($backup, $target)) {
                throw new RuntimeException('UPDATE-Rollback fehlgeschlagen.');
            }
        } else {
            if ($currentHash === $oldHash) continue;
            if ($currentHash !== null || !is_file($backup)
                || @hash_file('sha256', $backup) !== $oldHash
                || !@rename($backup, $target)) {
                throw new RuntimeException('DELETE-Rollback fehlgeschlagen.');
            }
        }
    }
}

function lehrfahrer_audit_file_recover_locked(PDO $pdo, string $companyId, string $directory): array {
    if (lehrfahrer_control_transaction_active($pdo)) throw new LogicException('Recovery in fremder DB-Transaktion.');
    $outcome = [];
    foreach (glob($directory . DIRECTORY_SEPARATOR . '*.json') ?: [] as $path) {
        $record = null;
        try {
            $record = lehrfahrer_audit_file_read($path, $companyId);
            if (lehrfahrer_audit_file_event_committed($pdo, $record)) {
                if (!in_array($record['state'], ['FILE_ACTIVATED', 'DB_COMMITTED', 'COMPLETED', 'BLOCKED'], true)) {
                    throw new RuntimeException('Commit-Witness widerspricht dem Journal-State.');
                }
                foreach ($record['files'] as $file) {
                    $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
                    $actual = is_file($target) ? @hash_file('sha256', $target) : null;
                    if ($actual !== $file['newHash']) {
                        throw new RuntimeException('Committierte Datei stimmt nicht mit dem Journal ueberein.');
                    }
                }
                if ($record['state'] === 'FILE_ACTIVATED') lehrfahrer_audit_file_transition($directory, $record, 'DB_COMMITTED');
            } else {
                lehrfahrer_audit_file_restore($companyId, $record);
            }
            lehrfahrer_audit_file_cleanup($companyId, $record);
            if ($record['state'] !== 'COMPLETED') lehrfahrer_audit_file_transition($directory, $record, 'COMPLETED');
            if (!@unlink($path)) throw new RuntimeException('Journal-Cleanup fehlgeschlagen.');
            $outcome[$record['id']] = 'COMPLETED';
        } catch (Throwable $error) {
            if (isset($record) && is_array($record) && ($record['state'] ?? '') !== 'BLOCKED'
                && ($record['state'] ?? '') !== 'COMPLETED') {
                try { lehrfahrer_audit_file_transition($directory, $record, 'BLOCKED'); } catch (Throwable $ignored) {}
            }
            throw new RuntimeException('Audit-Datei-Recovery blockiert: ' . $error->getMessage(), 0, $error);
        }
    }
    return $outcome;
}

function lehrfahrer_audit_file_recover(PDO $pdo, string $companyId): array {
    return lehrfahrer_audit_file_lock($companyId, static fn(string $directory): array =>
        lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory));
}

/**
 * Callers supply catalogued SUCCESS events for the server-derived route ID.
 * All events commit with the files; the first event witnesses that transaction.
 */
function lehrfahrer_audit_file_mutate(PDO $pdo, LehrfahrerAuditActor $actor, string $companyId,
    string $routeRelative, string $kind, array $files, array $event, ?callable $checkpoint = null,
    array $additionalEvents = [], array $batchRoutes = []): string {
    if (!in_array($kind, ['CREATE', 'UPDATE', 'DELETE'], true) || $files === []
        || !in_array($actor->contextType, ['TENANT', 'SYSTEM'], true)
        || ($actor->contextType === 'TENANT' && $actor->companyId !== $companyId)
        || lehrfahrer_control_transaction_active($pdo)) {
        throw new InvalidArgumentException('Audit-Dateivorgang ungueltig.');
    }
    $objectId = lehrfahrer_audit_file_object_id($companyId, $routeRelative);
    $additionalEvents = array_values($additionalEvents);
    $events = array_merge([$event], $additionalEvents);
    $batchReferences = [];
    foreach ($batchRoutes as $relative) {
        if ($kind !== 'CREATE' || !is_string($relative) || count(explode('/', $relative)) !== 4
            || isset($batchReferences[$relative])) throw new InvalidArgumentException('Mehrfachanlage ungueltig.');
        $batchReferences[$relative] = lehrfahrer_audit_file_object_id($companyId, $relative);
    }
    if ($batchRoutes !== [] && (array_key_first($batchReferences) !== $routeRelative
        || array_values($batchReferences) !== array_column($events, 'objectId'))) {
        throw new InvalidArgumentException('Mehrfachanlage und Auditziele stimmen nicht ueberein.');
    }
    foreach ($events as $item) {
        if (($batchRoutes === [] && ($item['objectId'] ?? null) !== $objectId)
            || ($batchRoutes !== [] && ($item['action'] ?? null) !== 'ROUTE_CREATE')
            || ($item['result'] ?? null) !== 'SUCCESS') {
            throw new InvalidArgumentException('Audit-Ereignis gehoert nicht zum Routenobjekt.');
        }
        lehrfahrer_audit_validate_event($actor, $item, LEHRFAHRER_AUDIT_CRITICAL);
    }
    $operation = static function (string $directory) use (
        $pdo, $actor, $companyId, $routeRelative, $kind, $files, $event, $checkpoint, $objectId, $additionalEvents, $batchReferences
    ): string {
        lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory);
        $id = 'op_' . bin2hex(random_bytes(16));
        $record = ['id' => $id, 'companyId' => $companyId, 'routeRelative' => $routeRelative,
            'objectId' => $objectId, 'kind' => $kind, 'state' => 'PREPARING',
            'auditEventId' => null, 'files' => []];
        if ($batchReferences !== []) {
            $record['version'] = 2;
            $record['routes'] = [];
            foreach ($batchReferences as $relative => $routeObjectId) {
                $record['routes'][] = ['relative' => $relative, 'objectId' => $routeObjectId, 'auditEventId' => null];
            }
        }
        $payloads = [];
        $seen = [];
        foreach (array_values($files) as $i => $file) {
            if (!is_array($file)) throw new InvalidArgumentException('Audit-Dateieintrag ungueltig.');
            $fileKind = $file['kind'] ?? $kind;
            if (!is_string($file['relative'] ?? null)
                || !in_array($fileKind, ['CREATE','UPDATE','DELETE'], true)
                || ($fileKind !== 'DELETE' && !is_string($file['content'] ?? null))) {
                throw new InvalidArgumentException('Audit-Dateieintrag ungueltig.');
            }
            $relative = $file['relative'];
            $area = $file['area'] ?? 'lines';
            if (!is_string($area) || !in_array($area, ['lines','imports'], true)
                || ($batchReferences !== []
                    ? ($area !== 'lines' || $fileKind !== 'CREATE' || !isset($batchReferences[$relative]))
                    : !lehrfahrer_audit_file_related_path($routeRelative, $relative, $area, $fileKind))
                || ($area === 'imports'
                    && ($relative !== 'gtfs/index/work-inventory.json' || $fileKind !== 'UPDATE'))) {
                throw new InvalidArgumentException('Audit-Dateibereich ungueltig.');
            }
            $key = $area . '/' . $relative;
            if (isset($seen[$key])) throw new InvalidArgumentException('Doppeltes Audit-Dateiziel.');
            $seen[$key] = true;
            $target = lehrfahrer_audit_file_target($companyId, $relative, $area);
            $old = is_file($target) ? @file_get_contents($target) : null;
            if ($old === false || ($fileKind === 'CREATE' && $old !== null)
                || ($fileKind !== 'CREATE' && $old === null)) throw new RuntimeException('Dateizustand passt nicht zum Vorgang.');
            $record['files'][] = ['area' => $area, 'relative' => $relative,
                'oldHash' => $old === null ? null : hash('sha256', $old),
                'newHash' => $fileKind === 'DELETE' ? null : hash('sha256', $file['content'])];
            if ($fileKind !== $kind) $record['files'][$i]['kind'] = $fileKind;
            if ($fileKind !== 'DELETE') $payloads[$i] = $file['content'];
        }
        if ($batchReferences !== [] && count($seen) !== count($batchReferences)) {
            throw new InvalidArgumentException('Mehrfachanlage ist unvollstaendig.');
        }
        if ($kind !== 'UPDATE' && !isset($seen['lines/' . $routeRelative])) {
            throw new InvalidArgumentException('Routenobjekt fehlt im Dateivorgang.');
        }
        if ($kind === 'UPDATE' && !isset($seen['lines/' . $routeRelative])
            && !isset($seen['imports/gtfs/index/work-inventory.json'])
            && !is_file(lehrfahrer_audit_file_target($companyId, $routeRelative))) {
            throw new InvalidArgumentException('Routenbezug fehlt im Dateivorgang.');
        }
        lehrfahrer_audit_file_store($directory, $record);
        try {
            if ($checkpoint !== null) $checkpoint('PREPARING');
            foreach ($record['files'] as $i => $file) {
                $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
                $fileKind = $file['kind'] ?? $kind;
                if ($fileKind === 'UPDATE') {
                    $old = (string)@file_get_contents($target);
                    if (hash('sha256', $old) !== $file['oldHash']) throw new RuntimeException('Routendatei hat sich geaendert.');
                    lehrfahrer_audit_file_write_complete(
                        lehrfahrer_audit_file_auxiliary($target, $id, $i, 'bak'), $old);
                }
                if ($fileKind !== 'DELETE') lehrfahrer_audit_file_write_complete(
                    lehrfahrer_audit_file_auxiliary($target, $id, $i, 'new'), $payloads[$i]);
            }
            lehrfahrer_audit_file_transition($directory, $record, 'PREPARED');
            if ($checkpoint !== null) $checkpoint('PREPARED');
            $pdo->beginTransaction();
            $audit = lehrfahrer_audit_append($pdo, $actor, $event, LEHRFAHRER_AUDIT_CRITICAL);
            $record['auditEventId'] = $audit['eventId'];
            if ($batchReferences !== []) $record['routes'][0]['auditEventId'] = $audit['eventId'];
            foreach ($additionalEvents as $index => $additionalEvent) {
                $additionalAudit = lehrfahrer_audit_append($pdo, $actor, $additionalEvent, LEHRFAHRER_AUDIT_CRITICAL);
                if ($batchReferences !== []) $record['routes'][$index + 1]['auditEventId'] = $additionalAudit['eventId'];
            }
            lehrfahrer_audit_file_transition($directory, $record, 'AUDIT_PREPARED');
            if ($checkpoint !== null) $checkpoint('AUDIT_PREPARED');
            lehrfahrer_audit_file_transition($directory, $record, 'ACTIVATING');
            if ($checkpoint !== null) $checkpoint('ACTIVATING');
            foreach ($record['files'] as $i => $file) {
                $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
                $fileKind = $file['kind'] ?? $kind;
                $aux = dirname($target) . DIRECTORY_SEPARATOR . '.lf-audit-' . $id . '-' . $i . '.'
                    . ($fileKind === 'DELETE' ? 'bak' : 'new');
                if ($fileKind === 'DELETE') {
                    if (is_link($target) || !is_file($target) || is_link($aux)
                        || file_exists($aux) || !@rename($target, $aux)) {
                        throw new RuntimeException('Dateiloeschung konnte nicht reversibel aktiviert werden.');
                    }
                } elseif ($fileKind === 'CREATE') {
                    if (is_link($aux) || !is_file($aux) || !@link($aux, $target)) {
                        throw new RuntimeException('Neue Routendatei konnte nicht exklusiv aktiviert werden.');
                    }
                } elseif (is_link($aux) || !is_file($aux) || !@rename($aux, $target)) {
                    throw new RuntimeException('Dateiaktivierung fehlgeschlagen.');
                }
                if ($checkpoint !== null) $checkpoint('ACTIVATED_' . $i);
            }
            lehrfahrer_audit_file_transition($directory, $record, 'FILE_ACTIVATED');
            if ($checkpoint !== null) $checkpoint('FILE_ACTIVATED');
            $pdo->commit();
            if ($checkpoint !== null) $checkpoint('DB_COMMIT');
            lehrfahrer_audit_file_transition($directory, $record, 'DB_COMMITTED');
            lehrfahrer_audit_file_cleanup($companyId, $record);
            lehrfahrer_audit_file_transition($directory, $record, 'COMPLETED');
            @unlink(lehrfahrer_audit_file_journal_path($directory, $id));
            return $id;
        } catch (Throwable $error) {
            if (lehrfahrer_control_transaction_active($pdo)) {
                try { $pdo->rollBack(); } catch (Throwable $ignored) {}
            }
            try { lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory); }
            catch (Throwable $recoveryError) {
                throw new RuntimeException('Audit-Dateivorgang blockiert: ' . $recoveryError->getMessage(), 0, $error);
            }
            throw $error;
        }
    };
    return lehrfahrer_audit_file_lock($companyId, $operation);
}
