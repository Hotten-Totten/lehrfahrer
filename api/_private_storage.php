<?php

function lehrfahrer_private_normalize_path(string $path): string {
    return rtrim(str_replace('\\', '/', $path), '/');
}

function lehrfahrer_private_storage_root(): string {
    static $root = null;
    if (is_string($root)) return $root;

    $projectRoot = dirname(__DIR__);
    $documentRoot = trim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $resolvedDocumentRoot = $documentRoot !== '' ? realpath($documentRoot) : false;
    $privateParent = $resolvedDocumentRoot !== false
        ? dirname($resolvedDocumentRoot)
        : dirname($projectRoot);
    $configured = trim((string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR'));
    $candidate = $configured !== ''
        ? $configured
        : $privateParent . DIRECTORY_SEPARATOR . 'lehrfahrer-private';

    $isAbsolute = preg_match('/^[a-zA-Z]:[\\\\\/]/', $candidate) === 1
        || str_starts_with($candidate, '/')
        || str_starts_with($candidate, '\\\\');
    if (!$isAbsolute) {
        throw new RuntimeException('LEHRFAHRER_PRIVATE_DATA_DIR muss ein absoluter Pfad sein.');
    }

    $normalizedProject = lehrfahrer_private_normalize_path($projectRoot);
    $normalizedCandidate = lehrfahrer_private_normalize_path($candidate);
    $caseInsensitive = DIRECTORY_SEPARATOR === '\\';
    $projectCompare = $caseInsensitive ? strtolower($normalizedProject) : $normalizedProject;
    $candidateCompare = $caseInsensitive ? strtolower($normalizedCandidate) : $normalizedCandidate;
    $documentCompare = $resolvedDocumentRoot === false
        ? ''
        : ($caseInsensitive
            ? strtolower(lehrfahrer_private_normalize_path($resolvedDocumentRoot))
            : lehrfahrer_private_normalize_path($resolvedDocumentRoot));
    if ($candidateCompare === $projectCompare
        || str_starts_with($candidateCompare, $projectCompare . '/')
        || ($documentCompare !== '' && ($candidateCompare === $documentCompare
            || str_starts_with($candidateCompare, $documentCompare . '/')))) {
        throw new RuntimeException('Privater Datenspeicher darf nicht innerhalb des Webroots liegen.');
    }

    if (!is_dir($candidate) && !mkdir($candidate, 0700, true)) {
        throw new RuntimeException('Privater Datenspeicher konnte nicht angelegt werden.');
    }
    @chmod($candidate, 0700);
    $resolved = realpath($candidate);
    if ($resolved === false) {
        throw new RuntimeException('Privater Datenspeicher konnte nicht aufgelöst werden.');
    }
    $root = $resolved;
    return $root;
}

function lehrfahrer_private_storage_directory(string $name): string {
    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $name)) {
        throw new InvalidArgumentException('Ungültiger privater Speicherbereich.');
    }
    $directory = lehrfahrer_private_storage_root() . DIRECTORY_SEPARATOR . $name;
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) {
        throw new RuntimeException('Privater Speicherbereich konnte nicht angelegt werden.');
    }
    @chmod($directory, 0700);
    return $directory;
}

function lehrfahrer_migrate_private_file(string $legacyFile, string $privateFile): void {
    if (!is_file($legacyFile)) return;
    if (is_file($privateFile)) {
        if (hash_file('sha256', $legacyFile) === hash_file('sha256', $privateFile)) {
            @unlink($legacyFile);
        }
        return;
    }

    $directory = dirname($privateFile);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) {
        throw new RuntimeException('Privates Zielverzeichnis konnte nicht angelegt werden.');
    }
    if (@rename($legacyFile, $privateFile)) {
        @chmod($privateFile, 0600);
        return;
    }
    if (!@copy($legacyFile, $privateFile)
        || hash_file('sha256', $legacyFile) !== hash_file('sha256', $privateFile)
        || !@unlink($legacyFile)) {
        @unlink($privateFile);
        throw new RuntimeException('Bestehende sensible Datei konnte nicht sicher migriert werden.');
    }
    @chmod($privateFile, 0600);
}

function lehrfahrer_migrate_private_files(string $legacyDirectory, string $privateDirectory, string $pattern): void {
    if (!is_dir($legacyDirectory)) return;
    foreach (glob($legacyDirectory . DIRECTORY_SEPARATOR . $pattern) ?: [] as $legacyFile) {
        if (!is_file($legacyFile)) continue;
        lehrfahrer_migrate_private_file(
            $legacyFile,
            $privateDirectory . DIRECTORY_SEPARATOR . basename($legacyFile)
        );
    }
}

function lehrfahrer_migrate_private_tree(string $legacyDirectory, string $privateDirectory): void {
    if (!is_dir($legacyDirectory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($legacyDirectory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink()) {
            throw new RuntimeException('Symbolische Links im sensiblen Altbestand werden nicht migriert.');
        }
        $relative = substr($item->getPathname(), strlen($legacyDirectory) + 1);
        $target = $privateDirectory . DIRECTORY_SEPARATOR . $relative;
        if ($item->isDir()) {
            if (!is_dir($target) && !mkdir($target, 0700, true)) {
                throw new RuntimeException('Privates Paketverzeichnis konnte nicht angelegt werden.');
            }
            continue;
        }
        lehrfahrer_migrate_private_file($item->getPathname(), $target);
    }
}
