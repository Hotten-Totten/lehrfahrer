<?php
declare(strict_types=1);
require_once __DIR__ . '/_audit_read.php';

/** A dedicated platform read context; tenant membership/tenant audit.read never grant this access. */
function lehrfahrer_platform_audit_authorize(PDO $pdo): void {
    $session = lehrfahrer_account_current_session($pdo, false);
    if ($session === null) throw new LehrfahrerAuditReadDenied(401);
    // A verified tenant session may belong to an independently assigned platform operator.
    // Keep its selected company intact; this endpoint explicitly authorizes platform scope.
    if (!in_array($session['context_type'], ['TENANT', 'PLATFORM'], true)
        || !in_array('platform.audit.read', lehrfahrer_account_platform_capabilities(
            $pdo, (string)$session['account_id']), true)) {
        throw new LehrfahrerAuditReadDenied(403);
    }
}

function lehrfahrer_platform_audit_filters(array $input): array {
    if (array_diff(array_keys($input), ['from','to','action','result','before','limit','companyId','context']) !== []) {
        throw new InvalidArgumentException('Unbekannter Plattformfilter.');
    }
    $common = array_diff_key($input, ['companyId'=>true,'context'=>true]);
    $filters = lehrfahrer_audit_read_filters($common);
    foreach (['companyId','context'] as $key) {
        if (!array_key_exists($key,$input)) continue;
        if (!is_string($input[$key])) throw new InvalidArgumentException('Plattformfilter ungueltig.');
        if ($input[$key] !== '') $filters[$key] = $input[$key];
    }
    if (isset($filters['companyId']) && preg_match('/^cmp_[a-f0-9]{32}$/D',$filters['companyId']) !== 1) {
        throw new InvalidArgumentException('Firmenfilter ungueltig.');
    }
    if (isset($filters['context']) && !in_array($filters['context'], ['TENANT','PLATFORM','PREAUTH','SYSTEM'],true)) {
        throw new InvalidArgumentException('Kontextfilter ungueltig.');
    }
    return $filters;
}

function lehrfahrer_platform_audit_page(PDO $pdo, array $input): array {
    lehrfahrer_platform_audit_authorize($pdo);
    $filters = lehrfahrer_platform_audit_filters($input);
    $where = ["context_type IN ('TENANT','PLATFORM','PREAUTH','SYSTEM')"];
    $values = [];
    foreach (['action'=>'action','result'=>'result','companyId'=>'company_id','context'=>'context_type'] as $key=>$column) {
        if (isset($filters[$key])) { $where[] = "$column = ?"; $values[] = $filters[$key]; }
    }
    if (isset($filters['from'])) { $where[] = 'occurred_at >= ?'; $values[] = $filters['from'].'T00:00:00Z'; }
    if (isset($filters['to'])) { $where[] = 'occurred_at <= ?'; $values[] = $filters['to'].'T23:59:59Z'; }
    $condition = implode(' AND ',$where);
    if (isset($filters['before'])) {
        // A cursor belongs to this filter scope; no hidden-object or account lookup is exposed.
        $cursor = $pdo->prepare('SELECT sequence_number FROM audit_events WHERE '.$condition.' AND event_id = ?');
        $cursor->execute([...$values,$filters['before']]);
        $sequence = $cursor->fetchColumn();
        if ($sequence === false) throw new InvalidArgumentException('Plattformseite ungueltig.');
        $where[] = 'sequence_number < ?'; $values[] = (int)$sequence;
    }
    $limit = (int)($filters['limit'] ?? 25);
    // Explicit projection: never query account/membership/target identifiers, roles or chain hashes.
    $query = $pdo->prepare('SELECT event_id,occurred_at,context_type,company_id,action,object_type,result,reason_code
        FROM audit_events WHERE '.implode(' AND ',$where).' ORDER BY sequence_number DESC LIMIT '.($limit+1));
    $query->execute($values);
    $rows = $query->fetchAll(PDO::FETCH_ASSOC);
    $more = count($rows)>$limit;
    $rows = array_slice($rows,0,$limit);
    return ['ok'=>true,'accessContext'=>'PLATFORM','events'=>$rows,
        'nextBefore'=>$more ? (string)$rows[count($rows)-1]['event_id'] : null,
        'actions'=>array_keys(lehrfahrer_audit_event_catalog())];
}
