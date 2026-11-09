<?php
declare(strict_types=1);
require_once __DIR__ . '/api/_first_start.php';

header('Cache-Control: no-store, private');
header('Content-Type: text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

$step = 'code'; $error = ''; $enrollment = '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
try {
    if (!lehrfahrer_first_start_configured()) { http_response_code(404); exit; }
    if (!in_array($method, ['GET','POST'], true)) { header('Allow: GET, POST'); http_response_code(405); exit; }
    if ($method === 'POST') {
        lehrfahrer_auth_require_same_origin();
        lehrfahrer_first_start_check_code($_POST['setup_code'] ?? null);
    }
    $pdo = lehrfahrer_first_start_connection();
    if (!lehrfahrer_first_start_empty($pdo)) { http_response_code(404); exit; }
    if ($method === 'POST') {
        $step = 'details';
        if (($_POST['action'] ?? '') === 'create') {
            $enrollment = lehrfahrer_first_start($pdo, $_POST)['enrollmentCode'];
            $step = 'done';
        }
    }
} catch (InvalidArgumentException $exception) {
    http_response_code(400); $error = $exception->getMessage();
} catch (Throwable $exception) {
    http_response_code(503); $step = 'unavailable';
    $error = 'Die Einrichtung kann derzeit nicht abgeschlossen werden. Bitte den Betreiber kontaktieren.';
    error_log('Lehrfahrer first-start request blocked or failed.');
}
$escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lehrfahrer einrichten</title>
<style>
body{font:1rem/1.55 system-ui,sans-serif;background:#eff3f6;color:#142538;margin:0;padding:2rem 1rem}
main{max-width:34rem;margin:auto;background:#fff;padding:1.5rem;border-radius:12px}
label{display:block;margin:1rem 0 .25rem}input{box-sizing:border-box;width:100%;padding:.65rem;font:inherit;border:1px solid #8293a6;border-radius:4px}
button{margin-top:1rem;background:#145d79;color:white;border:0;border-radius:4px;padding:.7rem 1rem;font:inherit}code{overflow-wrap:anywhere}
</style></head><body><main>
<h1>Lehrfahrer einrichten</h1>
<?php if ($error !== ''): ?><p role="alert"><?= $escape($error) ?></p><?php endif; ?>
<?php if ($step === 'code'): ?>
<p>Gib den einmaligen Einrichtungscode des Betreibers ein.</p>
<form method="post"><label for="setup-code">Einrichtungscode</label>
<input id="setup-code" name="setup_code" type="password" autocomplete="off" required maxlength="43">
<button>Weiter</button></form>
<?php elseif ($step === 'details'): ?>
<p>Das erste Konto verwaltet die Firma und übernimmt die Plattformverwaltung (SysOp). Die Firma startet mit leeren Fachbereichen.</p>
<form method="post">
<input type="hidden" name="setup_code" value="<?= $escape($_POST['setup_code']) ?>">
<input type="hidden" name="action" value="create">
<label for="company">Firma</label><input id="company" name="name" value="Cottbusverkehr GmbH" required maxlength="120">
<label for="slug">Firmenkürzel</label><input id="slug" name="slug" value="cottbusverkehr" required maxlength="63" pattern="[a-z0-9][a-z0-9_\-]{1,62}">
<label for="name">Name für beide Rollen</label><input id="name" name="admin_display_name" value="Frank Fudeus" required maxlength="120">
<label for="login">Anmeldename</label><input id="login" name="admin_login" autocomplete="username" required maxlength="63">
<label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="72">
<label for="confirm">Passwort wiederholen</label><input id="confirm" name="password_confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="72">
<button>Firma und Konto einrichten</button></form>
<?php elseif ($step === 'done'): ?>
<h2>Firma und Konto sind eingerichtet</h2>
<p>Kopiere den folgenden Code. Gib ihn bei der Anmeldung im Feld für die erste Passkey-Einrichtung ein. Er gilt zehn Minuten und wird einmal angezeigt.</p>
<p><code><?= $escape($enrollment) ?></code></p>
<p><a href="account-login.php">Zur Anmeldung und Passkey-Einrichtung</a></p>
<?php endif; ?>
</main></body></html>
