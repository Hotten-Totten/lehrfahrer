<?php
declare(strict_types=1);

require_once __DIR__ . '/api/_runtime_info.php';
if (lehrfahrer_environment() !== 'staging') {
    http_response_code(404);
    exit;
}
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($method, ['GET', 'HEAD'], true)) {
    header('Allow: GET, HEAD');
    http_response_code(405);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
if ($method === 'HEAD') exit;
?>
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lehrfahrer – Account-Anmeldung</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f4f6f8; color: #17202a; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
    main { box-sizing: border-box; width: min(420px, calc(100% - 32px)); background: #fff; padding: 28px; border-radius: 14px; box-shadow: 0 10px 30px #17202a20; }
    h1 { margin: 0 0 20px; font-size: 1.5rem; }
    h2 { margin: 0 0 14px; font-size: 1.15rem; }
    label { display: grid; gap: 6px; margin: 14px 0; font-weight: 600; }
    input, button, .link-button { box-sizing: border-box; width: 100%; min-height: 46px; border-radius: 8px; font: inherit; }
    input { border: 1px solid #aeb7c2; padding: 10px 12px; }
    button, .link-button { display: grid; place-items: center; border: 0; background: #b51f2e; color: #fff; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; padding: 9px 12px; }
    button:disabled { opacity: .6; cursor: wait; }
    button.secondary, .link-button.secondary { background: #e8edf2; color: #17202a; }
    button + button, button + .link-button, .link-button + button { margin-top: 10px; }
    :focus-visible { outline: 3px solid #176b9b; outline-offset: 2px; }
    [hidden] { display: none !important; }
    #environment { display: inline-block; margin-bottom: 12px; padding: 4px 8px; border-radius: 999px; background: #e8edf2; font-weight: 800; }
    #message { min-height: 24px; margin: 14px 0 0; color: #9b1c2b; }
    #runtime, #legacyFallback { margin-top: 18px; color: #66717d; font-size: .82rem; }
    #legacyFallback a { color: #3f5264; }
    #accountDetails { margin: 0 0 18px; color: #334155; font-size: .94rem; line-height: 1.55; }
  </style>
</head>
<body>
  <main>
    <div id="environment">STAGING</div>
    <h1>Lehrfahrer-Anmeldung</h1>
    <form id="accountLoginForm" hidden>
      <label for="accountLogin">Loginname</label>
      <input id="accountLogin" name="username" autocomplete="username" required>
      <label for="accountPassword">Passwort</label>
      <input id="accountPassword" name="password" type="password" autocomplete="current-password" required>
      <button id="accountLoginButton" type="submit">Anmelden</button>
    </form>
    <section id="membershipSection" aria-labelledby="membershipTitle" hidden>
      <h2 id="membershipTitle">Gesellschaft auswählen</h2>
      <div id="membershipChoices"></div>
      <button id="membershipLogout" class="secondary" type="button">Abmelden</button>
    </section>
    <section id="accountSection" aria-labelledby="accountTitle" hidden>
      <h2 id="accountTitle">Konto</h2>
      <p id="activeCompany"></p>
      <div id="accountDetails"></div>
      <a id="continueTarget" class="link-button" href="/">Zum Editor</a>
      <button id="switchCompany" class="secondary" type="button">Gesellschaft wechseln</button>
      <button id="accountLogout" class="secondary" type="button">Abmelden</button>
    </section>
    <p id="message" role="status" aria-live="polite"></p>
    <div id="runtime"></div>
    <p id="legacyFallback"><a href="login.html">Bisherige Anmeldung verwenden</a></p>
  </main>
  <script src="js/tenant-cache-boundary.js?v=6f1f3c95d4c9" defer></script>
  <script src="js/account-login.js?v=f3e29b4c762a" defer></script>
</body>
</html>
