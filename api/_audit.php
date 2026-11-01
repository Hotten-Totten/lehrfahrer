<?php
declare(strict_types=1);

require_once __DIR__ . '/_account_auth.php';

/** Proposed default only. No automatic deletion is performed in Audit V1 A1. */
const LEHRFAHRER_AUDIT_RETENTION_PROPOSAL_MONTHS = 12;
const LEHRFAHRER_AUDIT_GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const LEHRFAHRER_AUDIT_CRITICAL = 'CRITICAL';
const LEHRFAHRER_AUDIT_OPERATIONAL = 'OPERATIONAL';

final class LehrfahrerAuditWriteFailure extends RuntimeException {
    public function __construct(public readonly string $mode, Throwable $cause) {
        parent::__construct('Audit-Ereignis konnte nicht geschrieben werden.', 0, $cause);
    }
}

/** The caller cannot construct an actor from request data. */
final class LehrfahrerAuditActor {
    private function __construct(
        public readonly ?string $accountId,
        public readonly string $contextType,
        public readonly ?string $membershipId,
        public readonly ?string $companyId,
        public readonly ?string $roleSnapshot
    ) {}

    public static function unauthenticated(): self {
        return new self(null, 'PREAUTH', null, null, null);
    }

    public static function currentAccount(PDO $pdo): self {
        $session = lehrfahrer_account_current_session($pdo, false);
        if ($session === null) throw new RuntimeException('Keine verifizierte Account-Session.');
        $public = lehrfahrer_account_public_session($pdo, $session);
        $context = (string)$session['context_type'];
        $roles = $context === 'TENANT' ? $public['tenantRoles'] : $public['platformRoles'];
        sort($roles, SORT_STRING);
        return new self((string)$session['account_id'], $context,
            $context === 'TENANT' ? (string)$session['membership_id'] : null,
            $context === 'TENANT' ? (string)$public['companyId'] : null,
            $roles === [] ? null : implode(',', $roles));
    }

    public static function authorizedCli(): self {
        if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD'])) {
            throw new RuntimeException('CLI-Auditkontext nicht verfuegbar.');
        }
        return new self(null, 'SYSTEM', null, null, null);
    }
}

/** A1 contract: actions and their only permitted object types. */
function lehrfahrer_audit_event_catalog(): array {
    return [
        'AUTH_LOGIN' => null, 'AUTH_LOGOUT' => 'SESSION',
        'AUTH_MFA' => 'PASSKEY', 'AUTH_CONTEXT_CHANGE' => 'MEMBERSHIP',
        'ACCOUNT_CREATE' => 'ACCOUNT', 'ACCOUNT_CHANGE' => 'ACCOUNT',
        'ACCOUNT_DEACTIVATE' => 'ACCOUNT', 'MEMBERSHIP_CHANGE' => 'MEMBERSHIP',
        'TENANT_ROLE_CHANGE' => 'MEMBERSHIP', 'PLATFORM_ROLE_CHANGE' => 'ACCOUNT',
        'SYSOP_CHANGE' => 'ACCOUNT', 'PASSKEY_CHANGE' => 'PASSKEY',
        'ROUTE_SAVE' => 'ROUTE', 'ROUTE_DELETE' => 'ROUTE',
        'ROUTE_STATUS_CHANGE' => 'ROUTE', 'ROUTE_RELEASE' => 'ROUTE',
        'ROUTE_RELEASE_REVOKE' => 'ROUTE',
        'DRIVER_CHANGE' => 'DRIVER', 'TRAINING_CHANGE' => 'TRAINING',
        'PACKAGE_CREATE' => 'PACKAGE', 'PACKAGE_CHANGE' => 'PACKAGE',
        'PACKAGE_DOWNLOAD' => 'PACKAGE', 'SETTING_CHANGE' => 'SETTING',
        'SECURITY_DENIAL' => null, 'SYSTEM_CHANGE' => 'SYSTEM',
    ];
}

function lehrfahrer_audit_reason_codes(): array {
    return ['INVALID_CREDENTIALS', 'MFA_REJECTED', 'EXPIRED', 'FORBIDDEN',
        'CSRF_REJECTED', 'NOT_FOUND', 'INVALID_INPUT', 'CONFLICT',
        'STORAGE_FAILURE', 'INTERNAL_FAILURE'];
}

function lehrfahrer_audit_validate_event(LehrfahrerAuditActor $actor, array $event, string $mode): array {
    if (!in_array($mode, [LEHRFAHRER_AUDIT_CRITICAL, LEHRFAHRER_AUDIT_OPERATIONAL], true)
        || array_diff(array_keys($event), ['action', 'objectType', 'objectId', 'result', 'reasonCode', 'capability']) !== []) {
        throw new InvalidArgumentException('Audit-Vertrag ungueltig.');
    }
    $action = $event['action'] ?? null;
    $catalog = lehrfahrer_audit_event_catalog();
    if (!is_string($action) || !array_key_exists($action, $catalog)) {
        throw new InvalidArgumentException('Audit-Aktion ungueltig.');
    }
    $objectType = $event['objectType'] ?? null;
    $objectId = $event['objectId'] ?? null;
    if ($objectType !== $catalog[$action] || ($objectType === null && $objectId !== null)
        || ($objectId !== null
        && (!is_string($objectId) || preg_match('/^(?:[a-z]{2,12}_[a-f0-9]{32}|training_[0-9]{6})$/D', $objectId) !== 1))) {
        throw new InvalidArgumentException('Audit-Objekt ungueltig.');
    }
    $result = $event['result'] ?? null;
    if (!in_array($result, ['SUCCESS', 'DENIED', 'FAILED'], true)) {
        throw new InvalidArgumentException('Audit-Ergebnis ungueltig.');
    }
    $reason = $event['reasonCode'] ?? null;
    if ($reason !== null && !in_array($reason, lehrfahrer_audit_reason_codes(), true)) {
        throw new InvalidArgumentException('Audit-Grund ungueltig.');
    }
    $capability = $event['capability'] ?? null;
    $platformCapabilities = ['platform.accounts.support', 'platform.audit.read',
        'platform.companies.manage', 'platform.maintenance.execute',
        'platform.roles.manage', 'platform.security.read', 'platform.system.manage',
        'platform.system.read', 'platform.tenant_context.open'];
    if ($capability !== null && (!is_string($capability)
        || (!array_key_exists($capability, lehrfahrer_control_capability_definitions())
            && !in_array($capability, $platformCapabilities, true)))) {
        throw new InvalidArgumentException('Audit-Capability ungueltig.');
    }
    if ($actor->contextType === 'PREAUTH' && !str_starts_with($action, 'AUTH_')
        && $action !== 'SECURITY_DENIAL') throw new InvalidArgumentException('Audit-Kontext ungueltig.');
    return [$action, $objectType, $objectId, $result, $reason, $capability];
}

function lehrfahrer_audit_canonical(array $fields): string {
    return json_encode(array_values($fields), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

/** Append in the caller's transaction when one exists; otherwise own a short transaction. */
function lehrfahrer_audit_append(PDO $pdo, LehrfahrerAuditActor $actor, array $event,
    string $mode = LEHRFAHRER_AUDIT_CRITICAL): array {
    [$action, $objectType, $objectId, $result, $reason, $capability] =
        lehrfahrer_audit_validate_event($actor, $event, $mode);
    $ownTransaction = !$pdo->inTransaction();
    $savepointCreated = false;
    $sqliteImmediate = $ownTransaction && lehrfahrer_control_driver($pdo) === 'sqlite';
    try {
        if ($ownTransaction) {
            if ($sqliteImmediate) $pdo->exec('BEGIN IMMEDIATE');
            else $pdo->beginTransaction();
        } else {
            $pdo->exec('SAVEPOINT lehrfahrer_audit_append');
            $savepointCreated = true;
        }
        $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
        $state = $pdo->query('SELECT last_sequence,last_hash FROM audit_chain_state WHERE singleton_key=1'
            . ($mysql ? ' FOR UPDATE' : ''))->fetch(PDO::FETCH_ASSOC);
        if (!is_array($state) || !preg_match('/^[a-f0-9]{64}$/D', (string)$state['last_hash'])) {
            throw new RuntimeException('Audit-Kettenzustand ungueltig.');
        }
        $sequence = (int)$state['last_sequence'] + 1;
        $id = 'aud_' . bin2hex(random_bytes(16));
        $timestamp = gmdate('Y-m-d\TH:i:s\Z');
        $fields = [$sequence, $id, $timestamp, $actor->accountId, $actor->contextType,
            $actor->membershipId, $actor->companyId, $actor->roleSnapshot, $capability,
            $action, $objectType, $objectId, $result, $reason];
        $previous = (string)$state['last_hash'];
        $hash = hash('sha256', $previous . "\n" . lehrfahrer_audit_canonical($fields));
        $insert = $pdo->prepare('INSERT INTO audit_events
            (sequence_number,event_id,occurred_at,account_id,context_type,membership_id,company_id,
             role_snapshot,capability_snapshot,action,object_type,object_id,result,reason_code,
             previous_hash,event_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $insert->execute([...$fields, $previous, $hash]);
        $update = $pdo->prepare('UPDATE audit_chain_state SET last_sequence=?,last_hash=?
            WHERE singleton_key=1 AND last_sequence=? AND last_hash=?');
        $update->execute([$sequence, $hash, $state['last_sequence'], $previous]);
        if ($update->rowCount() !== 1) throw new RuntimeException('Audit-Kette konkurrierend geaendert.');
        if ($ownTransaction) {
            if ($sqliteImmediate) $pdo->exec('COMMIT');
            else $pdo->commit();
        }
        else $pdo->exec('RELEASE SAVEPOINT lehrfahrer_audit_append');
        return ['eventId' => $id, 'sequence' => $sequence, 'eventHash' => $hash];
    } catch (Throwable $error) {
        if ($ownTransaction && $pdo->inTransaction()) {
            if ($sqliteImmediate) $pdo->exec('ROLLBACK');
            else $pdo->rollBack();
        }
        elseif ($savepointCreated && $pdo->inTransaction()) {
            $pdo->exec('ROLLBACK TO SAVEPOINT lehrfahrer_audit_append');
            $pdo->exec('RELEASE SAVEPOINT lehrfahrer_audit_append');
        }
        throw new LehrfahrerAuditWriteFailure($mode, $error);
    }
}

/** Internal verification only; A1 exposes no HTTP read interface. */
function lehrfahrer_audit_verify_chain(PDO $pdo): bool {
    $ownTransaction = !$pdo->inTransaction();
    if ($ownTransaction) $pdo->beginTransaction();
    try {
        $state = $pdo->query('SELECT last_sequence,last_hash FROM audit_chain_state WHERE singleton_key=1')
            ->fetch(PDO::FETCH_ASSOC);
        if (!is_array($state)) return false;
        $rows = $pdo->query('SELECT * FROM audit_events ORDER BY sequence_number')->fetchAll(PDO::FETCH_ASSOC);
        $previous = LEHRFAHRER_AUDIT_GENESIS_HASH;
        $sequence = 0;
        foreach ($rows as $row) {
            if ((int)$row['sequence_number'] !== ++$sequence || !hash_equals($previous, (string)$row['previous_hash'])) return false;
            $fields = [$sequence, $row['event_id'], $row['occurred_at'], $row['account_id'],
                $row['context_type'], $row['membership_id'], $row['company_id'],
                $row['role_snapshot'], $row['capability_snapshot'], $row['action'],
                $row['object_type'], $row['object_id'], $row['result'], $row['reason_code']];
            $hash = hash('sha256', $previous . "\n" . lehrfahrer_audit_canonical($fields));
            if (!hash_equals($hash, (string)$row['event_hash'])) return false;
            $previous = $hash;
        }
        return $sequence === (int)$state['last_sequence'] && hash_equals($previous, (string)$state['last_hash']);
    } finally {
        if ($ownTransaction && $pdo->inTransaction()) $pdo->rollBack();
    }
}
