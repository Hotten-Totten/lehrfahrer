<?php
declare(strict_types=1);

require_once __DIR__ . '/api/_account_auth.php';

header('Cache-Control: no-store, private');
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function accountDirectoryError(int $status, string $message): never {
    http_response_code($status);
    echo $message;
    exit;
}

function accountDirectoryText(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    accountDirectoryError(405, 'Methode nicht erlaubt.');
}

try {
    $pdo = lehrfahrer_control_database();
    $session = lehrfahrer_account_current_session($pdo, false);
    if ($session === null) {
        accountDirectoryError(401, 'Bitte zuerst als SysOp anmelden.');
    }
    if (!in_array($session['context_type'], ['TENANT', 'PLATFORM'], true)
        || !lehrfahrer_sysop_mfa_required($pdo, (string)$session['account_id'])
        || $session['mfa_verified_at'] === null) {
        accountDirectoryError(403, 'Diese Übersicht ist dem SysOp mit bestätigtem Passkey vorbehalten.');
    }

    $after = $_GET['after'] ?? '';
    if (!is_string($after) || strlen($after) > 64) {
        accountDirectoryError(400, 'Ungültige Seitenangabe.');
    }
    $query = $pdo->prepare('SELECT m.id, c.name AS company_name, c.status AS company_status,
        a.display_name, a.login_normalized, a.active, m.status
        FROM account_memberships m
        JOIN accounts a ON a.id = m.account_id
        JOIN companies c ON c.id = m.company_id
        WHERE m.id > ? ORDER BY m.id LIMIT 51');
    $query->execute([$after]);
    $memberships = $query->fetchAll(PDO::FETCH_ASSOC);
    $hasMore = count($memberships) > 50;
    if ($hasMore) array_pop($memberships);
} catch (Throwable) {
    accountDirectoryError(503, 'Die Firmenkonten sind derzeit nicht verfügbar.');
}
?>
<!doctype html>
<html lang="de">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Firmenkonten – Lehrfahrer</title>
<style>
  body { max-width: 70rem; margin: 2rem auto; padding: 0 1rem; font: 1rem system-ui, sans-serif; }
  .table-container { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .6rem; border-bottom: 1px solid #bbb; }
</style>
<main>
  <a href="account-login.php?mode=manage">Zum Konto</a>
  <h1>Firmenkonten</h1>
  <p>Hier siehst du, welcher Firma ein Konto zugeordnet ist und ob der Zugang aktiv ist.</p>
  <?php if ($memberships === []): ?>
  <p>Keine Firmenkonten auf dieser Seite.</p>
  <?php else: ?>
  <div class="table-container">
    <table>
      <thead><tr><th>Firma</th><th>Name</th><th>Anmeldename</th><th>Zugang</th></tr></thead>
      <tbody>
        <?php foreach ($memberships as $membership): ?>
        <tr>
          <td><?= accountDirectoryText($membership['company_name']) ?></td>
          <td><?= accountDirectoryText($membership['display_name']) ?></td>
          <td><?= accountDirectoryText($membership['login_normalized']) ?></td>
          <td><?= (int)$membership['active'] === 1 && $membership['status'] === 'active'
              && $membership['company_status'] === 'active' ? 'Aktiv' : 'Inaktiv' ?></td>
        </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?php endif; ?>
  <p>
    <?php if ($after !== ''): ?><a href="platform-accounts.php">Erste Seite</a><?php endif; ?>
    <?php if ($hasMore): ?><a href="?after=<?= rawurlencode(end($memberships)['id']) ?>">Nächste Seite</a><?php endif; ?>
  </p>
</main>
</html>
