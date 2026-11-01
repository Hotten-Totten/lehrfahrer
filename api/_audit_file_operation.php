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

function lehrfahrer_audit_file_related_path(string $routeRelative, string $relative, string $area): bool {
    if ($area === 'imports') return $relative === 'gtfs/index/work-inventory.json';
    $stem = substr($routeRelative, 0, -5);
    return in_array($relative, [$routeRelative, $stem . '.gpx', $stem . '.pdf'], true);
}

function lehrfahrer_audit_file_directory(string $companyId): string {
    return lehrfahrer_tenant_ensure_directory($companyId, 'imports', 'audit-file-operations');
}

function lehrfahrer_audit_file_lock(string $companyId, callable $work): mixed {
    $directory = lehrfahrer_audit_file_directory($companyId);
    $path = $directory . DIRECTORY_SEPARATOR . '.lock';
    if (is_link($path)) throw new RuntimeException('Audit-Dateisperre ist unsicher.');
    $handle = fopen($path, 'c');
    if ($handle === false) throw new RuntimeException('Audit-Dateisperre fehlt.');
    try {
        if (!flock($handle, LOCK_EX)) throw new RuntimeException('Audit-Dateisperre fehlgeschlagen.');
        return $work($directory);
    } finally {
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
    foreach ($record['files'] as $i => $file) {
        $fileKeys = is_array($file) ? array_keys($file) : [];
        sort($fileKeys);
        if (!is_int($i) || !is_array($file) || !is_string($file['relative'] ?? null)
            || $fileKeys !== ['area','newHash','oldHash','relative']
            || !in_array($file['area'] ?? null, ['lines','imports'], true)
            || !lehrfahrer_audit_file_related_path($record['routeRelative'], $file['relative'], $file['area'])
            || ($file['area'] === 'imports'
                && ($file['relative'] !== 'gtfs/index/work-inventory.json' || $record['kind'] !== 'UPDATE'))
            || (($file['oldHash'] ?? null) !== null
                && preg_match('/^[a-f0-9]{64}$/D', (string)$file['oldHash']) !== 1)
            || (($file['newHash'] ?? null) !== null
                && preg_match('/^[a-f0-9]{64}$/D', (string)$file['newHash']) !== 1)
            || ($record['kind'] === 'CREATE' && $file['oldHash'] !== null)
            || ($record['kind'] !== 'CREATE' && $file['oldHash'] === null)
            || ($record['kind'] === 'DELETE' && $file['newHash'] !== null)
            || ($record['kind'] !== 'DELETE' && $file['newHash'] === null)) {
            throw new RuntimeException('Journal-Dateieintrag ungueltig.');
        }
        lehrfahrer_tenant_segments($file['relative']);
    }
    return $record;
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
        if ($record['kind'] === 'CREATE') {
            if ($currentHash !== null && $currentHash !== $newHash) throw new RuntimeException('CREATE-Ziel wurde fremd veraendert.');
            if ($currentHash !== null && !@unlink($target)) throw new RuntimeException('CREATE-Rollback fehlgeschlagen.');
        } elseif ($record['kind'] === 'UPDATE') {
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
 * Infrastructure only. Callers must supply a catalogued SUCCESS event whose
 * objectId is the server-derived route ID; no live route writer uses this yet.
 */
function lehrfahrer_audit_file_mutate(PDO $pdo, LehrfahrerAuditActor $actor, string $companyId,
    string $routeRelative, string $kind, array $files, array $event, ?callable $checkpoint = null): string {
    if (!in_array($kind, ['CREATE', 'UPDATE', 'DELETE'], true) || $files === []
        || !in_array($actor->contextType, ['TENANT', 'SYSTEM'], true)
        || ($actor->contextType === 'TENANT' && $actor->companyId !== $companyId)
        || lehrfahrer_control_transaction_active($pdo)) {
        throw new InvalidArgumentException('Audit-Dateivorgang ungueltig.');
    }
    $objectId = lehrfahrer_audit_file_object_id($companyId, $routeRelative);
    if (($event['objectId'] ?? null) !== $objectId || ($event['result'] ?? null) !== 'SUCCESS') {
        throw new InvalidArgumentException('Audit-Ereignis gehoert nicht zum Routenobjekt.');
    }
    lehrfahrer_audit_validate_event($actor, $event, LEHRFAHRER_AUDIT_CRITICAL);
    return lehrfahrer_audit_file_lock($companyId, static function (string $directory) use (
        $pdo, $actor, $companyId, $routeRelative, $kind, $files, $event, $checkpoint, $objectId
    ): string {
        lehrfahrer_audit_file_recover_locked($pdo, $companyId, $directory);
        $id = 'op_' . bin2hex(random_bytes(16));
        $record = ['id' => $id, 'companyId' => $companyId, 'routeRelative' => $routeRelative,
            'objectId' => $objectId, 'kind' => $kind, 'state' => 'PREPARING',
            'auditEventId' => null, 'files' => []];
        $payloads = [];
        $seen = [];
        foreach (array_values($files) as $i => $file) {
            if (!is_array($file) || !is_string($file['relative'] ?? null)
                || ($kind !== 'DELETE' && !is_string($file['content'] ?? null))) {
                throw new InvalidArgumentException('Audit-Dateieintrag ungueltig.');
            }
            $relative = $file['relative'];
            $area = $file['area'] ?? 'lines';
            if (!is_string($area) || !in_array($area, ['lines','imports'], true)
                || !lehrfahrer_audit_file_related_path($routeRelative, $relative, $area)
                || ($area === 'imports'
                    && ($relative !== 'gtfs/index/work-inventory.json' || $kind !== 'UPDATE'))) {
                throw new InvalidArgumentException('Audit-Dateibereich ungueltig.');
            }
            $key = $area . '/' . $relative;
            if (isset($seen[$key])) throw new InvalidArgumentException('Doppeltes Audit-Dateiziel.');
            $seen[$key] = true;
            $target = lehrfahrer_audit_file_target($companyId, $relative, $area);
            $old = is_file($target) ? @file_get_contents($target) : null;
            if ($old === false || ($kind === 'CREATE' && $old !== null)
                || ($kind !== 'CREATE' && $old === null)) throw new RuntimeException('Dateizustand passt nicht zum Vorgang.');
            $record['files'][] = ['area' => $area, 'relative' => $relative,
                'oldHash' => $old === null ? null : hash('sha256', $old),
                'newHash' => $kind === 'DELETE' ? null : hash('sha256', $file['content'])];
            if ($kind !== 'DELETE') $payloads[$i] = $file['content'];
        }
        if ($kind !== 'UPDATE' && !isset($seen['lines/' . $routeRelative])) {
            throw new InvalidArgumentException('Routenobjekt fehlt im Dateivorgang.');
        }
        if ($kind === 'UPDATE' && !isset($seen['lines/' . $routeRelative])
            && !isset($seen['imports/gtfs/index/work-inventory.json'])) {
            throw new InvalidArgumentException('Routenbezug fehlt im Dateivorgang.');
        }
        lehrfahrer_audit_file_store($directory, $record);
        try {
            if ($checkpoint !== null) $checkpoint('PREPARING');
            foreach ($record['files'] as $i => $file) {
                $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
                if ($kind === 'UPDATE') {
                    $old = (string)@file_get_contents($target);
                    if (hash('sha256', $old) !== $file['oldHash']) throw new RuntimeException('Routendatei hat sich geaendert.');
                    lehrfahrer_audit_file_write_complete(
                        lehrfahrer_audit_file_auxiliary($target, $id, $i, 'bak'), $old);
                }
                if ($kind !== 'DELETE') lehrfahrer_audit_file_write_complete(
                    lehrfahrer_audit_file_auxiliary($target, $id, $i, 'new'), $payloads[$i]);
            }
            lehrfahrer_audit_file_transition($directory, $record, 'PREPARED');
            if ($checkpoint !== null) $checkpoint('PREPARED');
            $pdo->beginTransaction();
            $audit = lehrfahrer_audit_append($pdo, $actor, $event, LEHRFAHRER_AUDIT_CRITICAL);
            $record['auditEventId'] = $audit['eventId'];
            lehrfahrer_audit_file_transition($directory, $record, 'AUDIT_PREPARED');
            if ($checkpoint !== null) $checkpoint('AUDIT_PREPARED');
            lehrfahrer_audit_file_transition($directory, $record, 'ACTIVATING');
            if ($checkpoint !== null) $checkpoint('ACTIVATING');
            foreach ($record['files'] as $i => $file) {
                $target = lehrfahrer_audit_file_target($companyId, $file['relative'], $file['area']);
                $aux = dirname($target) . DIRECTORY_SEPARATOR . '.lf-audit-' . $id . '-' . $i . '.'
                    . ($kind === 'DELETE' ? 'bak' : 'new');
                if ($kind === 'DELETE') {
                    if (is_link($target) || !is_file($target) || is_link($aux)
                        || file_exists($aux) || !@rename($target, $aux)) {
                        throw new RuntimeException('Dateiloeschung konnte nicht reversibel aktiviert werden.');
                    }
                } elseif ($kind === 'CREATE') {
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
    });
}
