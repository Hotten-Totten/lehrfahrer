<?php

function lehrfahrer_password_algorithm() {
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}

function lehrfahrer_password_hash(string $password): string {
    if ($password === '') {
        throw new InvalidArgumentException('Passwort darf nicht leer sein.');
    }
    $hash = password_hash($password, lehrfahrer_password_algorithm());
    if (!is_string($hash) || $hash === '') {
        throw new RuntimeException('Passwort konnte nicht sicher gehasht werden.');
    }
    return $hash;
}

function lehrfahrer_password_verify(string $password, string $hash): bool {
    return $hash !== '' && password_verify($password, $hash);
}

function lehrfahrer_password_needs_rehash(string $hash): bool {
    return password_needs_rehash($hash, lehrfahrer_password_algorithm());
}
