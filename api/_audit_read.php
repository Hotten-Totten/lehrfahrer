<?php
declare(strict_types=1);
require_once __DIR__ . '/_audit.php';

final class LehrfahrerAuditReadDenied extends RuntimeException {
    public function __construct(public readonly int $status) { parent::__construct('Audit-Zugriff nicht erlaubt.'); }
}

/** No legacy/token fallback and no caller-supplied tenant identity. */
function lehrfahrer_audit_read_company(PDO $pdo): string {
    $session = lehrfahrer_account_current_session($pdo, false);
    if ($session === null) throw new LehrfahrerAuditReadDenied(401);
    if ($session['context_type'] !== 'TENANT') throw new LehrfahrerAuditReadDenied(403);
    $account = (string)$session['account_id'];
    $membership = (string)$session['membership_id'];
    if (!in_array('audit.read', lehrfahrer_account_tenant_capabilities($pdo, $account, $membership), true)) {
        throw new LehrfahrerAuditReadDenied(403);
    }
    $query = $pdo->prepare("SELECT m.company_id FROM account_memberships m JOIN companies c ON c.id=m.company_id
        WHERE m.id=? AND m.account_id=? AND m.status='active' AND c.status='active'");
    $query->execute([$membership, $account]);
    $company = $query->fetchColumn();
    if (!is_string($company) || $company === '') throw new LehrfahrerAuditReadDenied(403);
    return $company;
}

function lehrfahrer_audit_read_filters(array $input): array {
    if (array_diff(array_keys($input), ['from', 'to', 'action', 'result', 'objectId', 'before', 'limit']) !== []) {
        throw new InvalidArgumentException('Unbekannter Filter.');
    }
    $filters = [];
    foreach ($input as $key => $value) {
        if (!is_string($value)) throw new InvalidArgumentException('Filter ungueltig.');
        if ($value !== '') $filters[$key] = $value;
    }
    foreach (['from', 'to'] as $key) {
        if (!isset($filters[$key])) continue;
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $filters[$key], new DateTimeZone('UTC'));
        if ($date === false || $date->format('Y-m-d') !== $filters[$key]) throw new InvalidArgumentException('Datum ungueltig.');
    }
    if (isset($filters['from'], $filters['to']) && $filters['from'] > $filters['to']) throw new InvalidArgumentException('Zeitraum ungueltig.');
    if (isset($filters['action']) && !array_key_exists($filters['action'], lehrfahrer_audit_event_catalog())) throw new InvalidArgumentException('Ereignisart ungueltig.');
    if (isset($filters['result']) && !in_array($filters['result'], ['SUCCESS','DENIED','FAILED'], true)) throw new InvalidArgumentException('Ergebnis ungueltig.');
    if (isset($filters['objectId']) && preg_match('/^(?:[a-z]{2,12}_[a-f0-9]{32}|training_[0-9]{6})$/D', $filters['objectId']) !== 1) throw new InvalidArgumentException('Objekt-ID ungueltig.');
    if (isset($filters['before']) && preg_match('/^aud_[a-f0-9]{32}$/D', $filters['before']) !== 1) throw new InvalidArgumentException('Seitennavigation ungueltig.');
    if (isset($filters['limit']) && (preg_match('/^[1-9][0-9]?$/D', $filters['limit']) !== 1 || (int)$filters['limit'] > 50)) throw new InvalidArgumentException('Seitengroesse ungueltig.');
    return $filters;
}

/** Every page reauthorizes; explicit projection avoids exposing internal chain/platform data. */
function lehrfahrer_audit_read_page(PDO $pdo, array $input): array {
    $company = lehrfahrer_audit_read_company($pdo);
    $filters = lehrfahrer_audit_read_filters($input);
    $where = ["company_id = ?", "context_type = 'TENANT'"];
    $values = [$company];
    foreach (['action'=>'action', 'result'=>'result', 'objectId'=>'object_id'] as $key => $column) {
        if (isset($filters[$key])) { $where[] = "$column = ?"; $values[] = $filters[$key]; }
    }
    if (isset($filters['from'])) { $where[] = 'occurred_at >= ?'; $values[] = $filters['from'] . 'T00:00:00Z'; }
    if (isset($filters['to'])) { $where[] = 'occurred_at <= ?'; $values[] = $filters['to'] . 'T23:59:59Z'; }
    if (isset($filters['before'])) {
        $cursor = $pdo->prepare("SELECT sequence_number FROM audit_events WHERE event_id=? AND company_id=? AND context_type='TENANT'");
        $cursor->execute([$filters['before'], $company]);
        $sequence = $cursor->fetchColumn();
        if ($sequence === false) throw new InvalidArgumentException('Seitennavigation ungueltig.');
        $where[] = 'sequence_number < ?'; $values[] = (int)$sequence;
    }
    $limit = (int)($filters['limit'] ?? 25);
    $query = $pdo->prepare('SELECT sequence_number,event_id,occurred_at,account_id,membership_id,
        action,object_type,object_id,result,reason_code FROM audit_events WHERE ' . implode(' AND ', $where)
        . ' ORDER BY sequence_number DESC LIMIT ' . ($limit + 1));
    $query->execute($values);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    $more = count($rows) > $limit;
    $rows = array_slice($rows, 0, $limit);
    $next = $more ? (string)$rows[count($rows)-1]['event_id'] : null;
    foreach ($rows as &$row) unset($row['sequence_number']);
    unset($row);
    return ['ok'=>true, 'events'=>$rows, 'nextBefore'=>$next,
        'actions'=>array_keys(lehrfahrer_audit_event_catalog())];
}
