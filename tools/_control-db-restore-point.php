<?php
declare(strict_types=1);

const COTTBUS_CONTROL_DB_EXPECTED_TABLES = [
    'capabilities', 'companies', 'control_metadata', 'role_capabilities', 'roles',
    'schema_migrations', 'sessions', 'user_activation_tokens', 'user_roles', 'users',
];

function cottbusExecutable(array $names): ?string {
    $path = (string)getenv('PATH');
    $extensions = PHP_OS_FAMILY === 'Windows' ? ['', '.exe', '.bat', '.cmd'] : [''];
    foreach (explode(PATH_SEPARATOR, $path) as $directory) {
        if ($directory === '') continue;
        foreach ($names as $name) foreach ($extensions as $extension) {
            $candidate = rtrim($directory, '/\\') . DIRECTORY_SEPARATOR . $name . $extension;
            if (is_file($candidate) && is_executable($candidate)) return $candidate;
        }
    }
    return null;
}

function cottbusControlDbIdentity(string $dsn): array {
    if (!str_starts_with(strtolower($dsn), 'mysql:')) throw new RuntimeException('Restore-Punkt unterstuetzt nur die MariaDB-Control-DB.');
    $parts = [];
    foreach (explode(';', substr($dsn, 6)) as $part) {
        if (!str_contains($part, '=')) continue;
        [$key, $value] = array_map('trim', explode('=', $part, 2));
        $parts[strtolower($key)] = $value;
    }
    if (($parts['dbname'] ?? '') === '' || (($parts['host'] ?? '') === '' && ($parts['unix_socket'] ?? '') === '')) {
        throw new RuntimeException('MariaDB-DSN enthaelt keinen eindeutigen Server und Datenbanknamen.');
    }
    return [
        'driver' => 'mysql', 'database' => $parts['dbname'],
        'host' => $parts['host'] ?? null, 'port' => isset($parts['port']) ? (int)$parts['port'] : null,
        'unix_socket' => isset($parts['unix_socket']) ? '[configured]' : null,
        'charset' => $parts['charset'] ?? null,
    ];
}

function cottbusProbeDatabaseClient(string $binary): bool {
    if (!function_exists('proc_open')) return false;
    $process = proc_open([$binary, '--version'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($process)) return false;
    foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
    return proc_close($process) === 0;
}

function cottbusDbBackupCapability(?array $configuration = null, ?string $privateRoot = null): array {
    if ((string)getenv('LEHRFAHRER_ENV') === 'dev' && getenv('COTTBUS_TEST_DB_BACKUP_CAPABILITY') !== 'NO') {
        return ['DB_BACKUP_CAPABLE' => 'YES', 'DB_RESTORE_PATH_VALID' => 'YES', 'mechanism' => 'ISOLATED_TEST_DOUBLE', 'dump_binary' => null, 'restore_binary' => null];
    }
    try {
        if (!is_array($configuration)) throw new RuntimeException('Control-DB-Konfiguration fehlt.');
        cottbusControlDbIdentity(strval($configuration['dsn'] ?? ''));
        if (!function_exists('proc_open')) throw new RuntimeException('proc_open ist nicht verfuegbar.');
        $dump = cottbusExecutable(['mariadb-dump', 'mysqldump']);
        $restore = cottbusExecutable(['mariadb', 'mysql']);
        if ($dump === null) throw new RuntimeException('mariadb-dump/mysqldump fehlt.');
        if ($restore === null) throw new RuntimeException('mariadb/mysql Restore-Client fehlt.');
        if (!cottbusProbeDatabaseClient($dump) || !cottbusProbeDatabaseClient($restore)) throw new RuntimeException('MariaDB-Dump-/Restore-Client ist nicht ausfuehrbar.');
        if ($privateRoot === null || !is_dir($privateRoot) || is_link($privateRoot) || !is_writable($privateRoot)) {
            throw new RuntimeException('Privater Backup-Root ist nicht sicher beschreibbar.');
        }
        $identity = cottbusControlDbIdentity(strval($configuration['dsn']));
        $arguments = cottbusMysqlArguments($identity, strval($configuration['user'] ?? ''), $configuration['tls_ca'] ?? null, true);
        array_splice($arguments, count($arguments) - 1, 0, ['--no-data']);
        $probe = cottbusRunDatabaseClient(array_merge([$dump], $arguments), strval($configuration['password'] ?? ''), null, null);
        if ($probe['status'] !== 0 || $probe['stderr_present']) throw new RuntimeException('Read-only MariaDB-Dump-Probe ist fehlgeschlagen.');
        foreach (COTTBUS_CONTROL_DB_EXPECTED_TABLES as $table) {
            if (!preg_match('/CREATE TABLE\s+`?' . preg_quote($table, '/') . '`?/i', $probe['stdout'])) {
                throw new RuntimeException('Read-only Dump-Probe findet erwartete Tabelle nicht: ' . $table);
            }
        }
        return ['DB_BACKUP_CAPABLE' => 'YES', 'DB_RESTORE_PATH_VALID' => 'YES', 'mechanism' => basename($dump) . ' + ' . basename($restore),
            'dump_binary' => $dump, 'restore_binary' => $restore];
    } catch (Throwable $error) {
        return ['DB_BACKUP_CAPABLE' => 'NO', 'DB_RESTORE_PATH_VALID' => 'NO', 'mechanism' => null,
            'dump_binary' => null, 'restore_binary' => null, 'blocker' => $error->getMessage()];
    }
}

function cottbusMysqlArguments(array $identity, string $user, ?string $tlsCa, bool $dump): array {
    $arguments = [];
    if (($identity['host'] ?? null) !== null) $arguments[] = '--host=' . $identity['host'];
    if (($identity['port'] ?? null) !== null) $arguments[] = '--port=' . $identity['port'];
    if (($identity['unix_socket'] ?? null) !== null) throw new RuntimeException('Unix-Socket-DSN kann ohne geheimnisfreien Originalpfad nicht gesichert werden.');
    $arguments[] = '--user=' . $user;
    $arguments[] = '--default-character-set=utf8mb4';
    if ($tlsCa !== null && $tlsCa !== '') {
        $arguments[] = '--ssl-ca=' . $tlsCa;
        $arguments[] = '--ssl-verify-server-cert';
    }
    if ($dump) array_push($arguments, '--single-transaction', '--skip-lock-tables', '--hex-blob', '--routines', '--events', '--triggers', '--no-tablespaces');
    $arguments[] = strval($identity['database']);
    return $arguments;
}

function cottbusRunDatabaseClient(array $command, string $password, ?string $stdinPath, ?string $stdoutPath): array {
    $descriptor = [
        0 => $stdinPath === null ? ['pipe', 'r'] : ['file', $stdinPath, 'rb'],
        1 => $stdoutPath === null ? ['pipe', 'w'] : ['file', $stdoutPath, 'wb'],
        2 => ['pipe', 'w'],
    ];
    $environment = getenv();
    if (!is_array($environment)) $environment = [];
    $environment['MYSQL_PWD'] = $password;
    $process = proc_open($command, $descriptor, $pipes, null, $environment, ['bypass_shell' => true]);
    if (!is_resource($process)) throw new RuntimeException('MariaDB-Client konnte nicht gestartet werden.');
    if (isset($pipes[0]) && is_resource($pipes[0])) fclose($pipes[0]);
    $stdout = isset($pipes[1]) && is_resource($pipes[1]) ? stream_get_contents($pipes[1]) : '';
    if (isset($pipes[1]) && is_resource($pipes[1])) fclose($pipes[1]);
    $stderr = isset($pipes[2]) && is_resource($pipes[2]) ? stream_get_contents($pipes[2]) : '';
    if (isset($pipes[2]) && is_resource($pipes[2])) fclose($pipes[2]);
    $status = proc_close($process);
    return ['status' => $status, 'stdout' => strval($stdout), 'stderr_present' => trim(strval($stderr)) !== ''];
}

function cottbusCreateControlDbRestorePoint(array $configuration, string $privateRoot, array $capability, string $schemaVersion, ?callable $runner = null): array {
    if ((string)getenv('LEHRFAHRER_ENV') !== 'staging' && $runner === null) {
        throw new RuntimeException('Control-DB-Restore-Punkte duerfen nur fuer Staging erzeugt werden.');
    }
    if (($capability['DB_BACKUP_CAPABLE'] ?? 'NO') !== 'YES' || ($capability['DB_RESTORE_PATH_VALID'] ?? 'NO') !== 'YES') {
        throw new RuntimeException('Verifizierter DB-Backup-/Restore-Weg fehlt.');
    }
    $identity = cottbusControlDbIdentity(strval($configuration['dsn'] ?? ''));
    $backupBase = $privateRoot . DIRECTORY_SEPARATOR . 'backups' . DIRECTORY_SEPARATOR . 'control-db';
    foreach ([$privateRoot . DIRECTORY_SEPARATOR . 'backups', $backupBase] as $directory) {
        if (is_link($directory)) throw new RuntimeException('Symlink im DB-Backup-Pfad erkannt.');
        if (!is_dir($directory) && !mkdir($directory, 0700)) throw new RuntimeException('Privates DB-Backup-Verzeichnis kann nicht angelegt werden.');
        if (!chmod($directory, 0700)) throw new RuntimeException('Privates DB-Backup-Verzeichnis kann nicht auf 0700 gesetzt werden.');
    }
    $id = gmdate('Ymd\THis\Z') . '-' . bin2hex(random_bytes(6));
    $directory = $backupBase . DIRECTORY_SEPARATOR . $id;
    if (!mkdir($directory, 0700) || !chmod($directory, 0700)) throw new RuntimeException('DB-Restore-Punkt kann nicht angelegt werden.');
    $dumpPath = $directory . DIRECTORY_SEPARATOR . 'control.sql';
    $manifestPath = $directory . DIRECTORY_SEPARATOR . 'manifest.json';
    try {
        $dumpHandle = fopen($dumpPath, 'x+b');
        if ($dumpHandle === false) throw new RuntimeException('Private DB-Backup-Datei kann nicht reserviert werden.');
        fclose($dumpHandle);
        if (!chmod($dumpPath, 0600)) throw new RuntimeException('DB-Dump-Rechte konnten nicht vorab gesetzt werden.');
        $arguments = cottbusMysqlArguments($identity, strval($configuration['user'] ?? ''), $configuration['tls_ca'] ?? null, true);
        $runner ??= 'cottbusRunDatabaseClient';
        $result = $runner(array_merge([strval($capability['dump_binary'])], $arguments), strval($configuration['password'] ?? ''), null, $dumpPath);
        if ($result['status'] !== 0 || $result['stderr_present'] || !is_file($dumpPath) || filesize($dumpPath) < 1) throw new RuntimeException('Konsistenter MariaDB-Dump ist fehlgeschlagen.');
        $dump = file_get_contents($dumpPath);
        foreach (COTTBUS_CONTROL_DB_EXPECTED_TABLES as $table) {
            if (!preg_match('/CREATE TABLE\s+`?' . preg_quote($table, '/') . '`?/i', strval($dump))) throw new RuntimeException('DB-Dump enthaelt erwartete Tabelle nicht: ' . $table);
        }
        if (!chmod($dumpPath, 0600)) throw new RuntimeException('DB-Dump-Rechte konnten nicht gesetzt werden.');
        $manifest = [
            'version' => 1, 'created_at' => gmdate('c'), 'dump_file' => 'control.sql',
            'bytes' => (int)filesize($dumpPath), 'sha256' => hash_file('sha256', $dumpPath),
            'database' => $identity, 'schema_version' => $schemaVersion,
            'expected_tables' => COTTBUS_CONTROL_DB_EXPECTED_TABLES,
            'restore' => ['client' => basename(strval($capability['restore_binary'])), 'mechanism' => 'stdin-logical-restore', 'client_validated' => true],
        ];
        $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        $manifestHandle = fopen($manifestPath, 'x+b');
        if ($manifestHandle === false) throw new RuntimeException('DB-Backup-Manifest kann nicht reserviert werden.');
        fclose($manifestHandle);
        if (!chmod($manifestPath, 0600) || file_put_contents($manifestPath, $json, LOCK_EX) !== strlen($json)) throw new RuntimeException('DB-Backup-Manifest konnte nicht sicher geschrieben werden.');
        return ['directory' => $directory, 'dump' => $dumpPath, 'manifest' => $manifestPath, 'metadata' => $manifest];
    } catch (Throwable $error) {
        @unlink($manifestPath); @unlink($dumpPath); @rmdir($directory);
        throw $error;
    }
}

function cottbusRestoreControlDbIsolated(array $sourceManifest, string $dumpPath, array $targetConfiguration, array $capability, ?callable $runner = null): void {
    $sourceDatabase = strval($sourceManifest['database']['database'] ?? '');
    $targetIdentity = cottbusControlDbIdentity(strval($targetConfiguration['dsn'] ?? ''));
    if ($sourceDatabase === '' || hash_equals($sourceDatabase, strval($targetIdentity['database']))) {
        throw new RuntimeException('Restore-Testziel muss eine andere isolierte Datenbank sein.');
    }
    if (!is_file($dumpPath) || is_link($dumpPath)) throw new RuntimeException('Restore-Testdump fehlt oder ist ein Symlink.');
    if (($capability['DB_RESTORE_PATH_VALID'] ?? 'NO') !== 'YES' || !isset($capability['restore_binary'])) {
        throw new RuntimeException('Restore-Client ist nicht verifiziert.');
    }
    $arguments = cottbusMysqlArguments($targetIdentity, strval($targetConfiguration['user'] ?? ''), $targetConfiguration['tls_ca'] ?? null, false);
    $runner ??= 'cottbusRunDatabaseClient';
    $result = $runner(array_merge([strval($capability['restore_binary'])], $arguments), strval($targetConfiguration['password'] ?? ''), $dumpPath, null);
    if ($result['status'] !== 0 || $result['stderr_present']) throw new RuntimeException('Isolierter MariaDB-Restore-Test ist fehlgeschlagen.');
}
