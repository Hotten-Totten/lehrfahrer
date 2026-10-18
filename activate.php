<?php
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
?><!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lehrfahrer – Konto aktivieren</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f4f6f8; color: #17202a; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
    main { width: min(420px, calc(100% - 32px)); background: #fff; padding: 28px; border-radius: 14px; box-shadow: 0 10px 30px #17202a20; }
    h1 { margin: 0 0 20px; font-size: 1.5rem; }
    label { display: grid; gap: 6px; margin: 14px 0; font-weight: 600; }
    input, button { box-sizing: border-box; width: 100%; min-height: 46px; border-radius: 8px; font: inherit; }
    input { border: 1px solid #aeb7c2; padding: 10px 12px; }
    button { border: 0; background: #b51f2e; color: #fff; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    #message { min-height: 24px; margin: 14px 0 0; color: #9b1c2b; }
    a { color: #8f1826; }
  </style>
  <script src="js/activate.js" defer></script>
</head>
<body>
  <main>
    <h1>Konto aktivieren</h1>
    <form id="activationForm">
      <label>Neues Passwort<input id="password" type="password" autocomplete="new-password" minlength="14" required></label>
      <label>Passwort wiederholen<input id="confirmation" type="password" autocomplete="new-password" minlength="14" required></label>
      <button id="activationButton" type="submit">Konto aktivieren</button>
    </form>
    <p id="message" role="status" aria-live="polite"></p>
    <a href="login.html">Zur Anmeldung</a>
  </main>
</body>
</html>
