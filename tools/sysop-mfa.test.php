<?php
declare(strict_types=1);

function check(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
    echo "PASS $label\n";
}
function b64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function cborHead(int $major, int $length): string {
    if ($length < 24) return chr(($major << 5) | $length);
    if ($length < 256) return chr(($major << 5) | 24) . chr($length);
    return chr(($major << 5) | 25) . pack('n', $length);
}
function cbor(mixed $value): string {
    if (is_int($value)) return $value >= 0 ? cborHead(0, $value) : cborHead(1, -1 - $value);
    if (is_array($value)) {
        $result = cborHead(5, count($value));
        foreach ($value as $key => $item) $result .= cbor($key) . cbor($item);
        return $result;
    }
    if ($value instanceof BinaryValue) return cborHead(2, strlen($value->data)) . $value->data;
    return cborHead(3, strlen($value)) . $value;
}
final class BinaryValue { public function __construct(public string $data) {} }

$dir = sys_get_temp_dir() . '/lf-mfa-' . bin2hex(random_bytes(8));
$projectRnd = dirname(__DIR__) . '/.rnd';
$projectRndExisted = file_exists($projectRnd);
mkdir($dir, 0700, true);
$originalWorkingDirectory = getcwd();
chdir($dir);
putenv('RANDFILE=' . $dir . '/openssl.rnd');
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . $dir);
putenv('LEHRFAHRER_DB_DRIVER=sqlite');
putenv('LEHRFAHRER_ENV=dev');
mkdir($dir . '/webroot');
$_SERVER['DOCUMENT_ROOT'] = $dir . '/webroot';
require dirname(__DIR__) . '/api/_account_auth.php';
$pdo = lehrfahrer_control_database();
check((int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn() === 9,
    'additive MFA schema migrated');
check((int)$pdo->query('SELECT COUNT(*) FROM account_passkeys')->fetchColumn() === 0,
    'migration seeds no credential');
$now = lehrfahrer_auth_timestamp(time());
$hash = password_hash('correct-password', PASSWORD_DEFAULT);
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')
    ->execute(['sysop', 'sysop', 'Systemkonto', $hash, $now, $now]);
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')
    ->execute(['normal', 'normal', 'Normal', $hash, $now, $now]);
$pdo->prepare('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (1,?,?)')->execute(['sysop', $now]);
$company = (new LehrfahrerCompanyRepository($pdo))->create(['slug' => 'cottbus', 'name' => 'Cottbusverkehr',
    'status' => 'active', 'license_status' => 'active']);
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at)
    VALUES (?,?,?,'active',?,?)")->execute(['member-sysop', 'sysop', $company['id'], $now, $now]);
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at)
    VALUES (?,?,?,'active',?,?)")->execute(['member-normal', 'normal', $company['id'], $now, $now]);
$adminRole = $pdo->query("SELECT id FROM roles WHERE code = 'ADMIN'")->fetchColumn();
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute(['member-sysop', $adminRole]);
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute(['member-normal', $adminRole]);
$pdo->prepare('INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at)
    VALUES (?,?,?,?)')->execute([1, 'sysop', 'sysop', $now]);
putenv('LEHRFAHRER_ENV=staging');
check(lehrfahrer_sysop_mfa_required($pdo, 'sysop'), 'sysop assignment requires MFA');
check(!lehrfahrer_sysop_mfa_required($pdo, 'normal'), 'normal account remains unchanged');
check(lehrfahrer_account_login($pdo, 'sysop', 'wrong-password') === null, 'wrong password creates no pending');
$pending = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
check(($pending['purpose'] ?? '') === 'ENROLL', 'password opens enrollment only');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $pending['token'];
check(lehrfahrer_account_current_session($pdo, false) === null, 'pending is not a full session');
$preEnrollmentSession = lehrfahrer_account_create_session($pdo, 'sysop', 'TENANT', 'member-sysop');
$begin = lehrfahrer_sysop_mfa_begin($pdo, $pending['csrf']);
check(($begin['purpose'] ?? '') === 'ENROLL', 'enrollment challenge issued');
$keyOptions = ['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1'];
$opensslConfig = getenv('OPENSSL_CONF') ?: (PHP_OS_FAMILY === 'Windows'
    ? 'C:/xampp/php/extras/openssl/openssl.cnf' : '');
if ($opensslConfig !== '') $keyOptions['config'] = $opensslConfig;
$private = openssl_pkey_new($keyOptions);
if ($private === false) throw new RuntimeException('Test EC key generation unavailable: ' . openssl_error_string());
$details = openssl_pkey_get_details($private);
$credentialId = random_bytes(32);
$cose = cbor([1 => 2, 3 => -7, -1 => 1, -2 => new BinaryValue($details['ec']['x']), -3 => new BinaryValue($details['ec']['y'])]);
$authData = hash('sha256', LEHRFAHRER_SYSOP_MFA_RP_ID, true) . chr(0x45) . pack('N', 0)
    . str_repeat("\0", 16) . pack('n', strlen($credentialId)) . $credentialId . $cose;
$attestation = cbor(['fmt' => 'none', 'attStmt' => [], 'authData' => new BinaryValue($authData)]);
$client = json_encode(['type' => 'webauthn.create', 'challenge' => $begin['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
$payload = ['id' => b64($credentialId), 'clientDataJSON' => b64($client), 'attestationObject' => b64($attestation)];
$wrong = $payload;
$wrong['clientDataJSON'] = b64(json_encode(['type' => 'webauthn.create',
    'challenge' => b64(random_bytes(32)), 'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR));
check(lehrfahrer_sysop_mfa_finish($pdo, $pending['csrf'], $wrong) === null, 'wrong enrollment challenge denied');
check(lehrfahrer_sysop_mfa_finish($pdo, $pending['csrf'], $payload) === null, 'failed challenge cannot be reused');
check(lehrfahrer_sysop_mfa_credentials($pdo, 'sysop') === [], 'failed enrollment does not activate MFA');
$pending = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $pending['token'];
$begin = lehrfahrer_sysop_mfa_begin($pdo, $pending['csrf']);
$client = json_encode(['type' => 'webauthn.create', 'challenge' => $begin['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
$payload['clientDataJSON'] = b64($client);
check(lehrfahrer_sysop_mfa_finish($pdo, $pending['csrf'], $payload) === ['enrolled' => true], 'valid passkey enrolled');
check(count(lehrfahrer_sysop_mfa_credentials($pdo, 'sysop')) === 1, 'credential stored for sysop');
$beforeMigrationReplay = $pdo->query("SELECT credential_id, public_key, sign_count, status FROM account_passkeys WHERE account_id = 'sysop'")->fetch(PDO::FETCH_ASSOC);
lehrfahrer_control_apply_sysop_mfa_management_schema($pdo);
$afterMigrationReplay = $pdo->query("SELECT credential_id, public_key, sign_count, status FROM account_passkeys WHERE account_id = 'sysop'")->fetch(PDO::FETCH_ASSOC);
check($beforeMigrationReplay === $afterMigrationReplay, 'additive management migration preserves existing passkey');
$preEnrollmentLookup = $pdo->prepare('SELECT revoked_at FROM account_sessions WHERE session_token_hash = ?');
$preEnrollmentLookup->execute([lehrfahrer_auth_token_hash($preEnrollmentSession['token'])]);
check($preEnrollmentLookup->fetchColumn() !== null, 'first enrollment revokes existing sysop sessions');
$oldSession = lehrfahrer_account_create_session($pdo, 'sysop', 'PENDING', null);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $oldSession['token'];
check(lehrfahrer_account_current_session($pdo, false) === null, 'non-MFA session cannot use activated sysop account');
unset($_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]);
$login = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
check(($login['purpose'] ?? '') === 'AUTH', 'subsequent login requires passkey');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $login['token'];
$request = lehrfahrer_sysop_mfa_begin($pdo, $login['csrf']);
$assertionData = hash('sha256', LEHRFAHRER_SYSOP_MFA_RP_ID, true) . chr(0x05) . pack('N', 1);
$assertionClient = json_encode(['type' => 'webauthn.get', 'challenge' => $request['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
openssl_sign($assertionData . hash('sha256', $assertionClient, true), $signature, $private, OPENSSL_ALGO_SHA256);
$assertion = ['id' => b64($credentialId), 'clientDataJSON' => b64($assertionClient),
    'authenticatorData' => b64($assertionData), 'signature' => b64($signature)];
$wrongOrigin = $assertion;
$wrongOrigin['clientDataJSON'] = b64(json_encode(['type' => 'webauthn.get',
    'challenge' => $request['options']->publicKey->challenge, 'origin' => 'https://www.lehrfahrer.de'], JSON_THROW_ON_ERROR));
check(lehrfahrer_sysop_mfa_finish($pdo, $login['csrf'], $wrongOrigin) === null, 'production origin denied');
check(lehrfahrer_sysop_mfa_finish($pdo, $login['csrf'], $assertion) === null, 'origin rejection consumes challenge');
$login = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $login['token'];
$request = lehrfahrer_sysop_mfa_begin($pdo, $login['csrf']);
$assertionClient = json_encode(['type' => 'webauthn.get', 'challenge' => $request['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
openssl_sign($assertionData . hash('sha256', $assertionClient, true), $signature, $private, OPENSSL_ALGO_SHA256);
$assertion['clientDataJSON'] = b64($assertionClient);
$assertion['signature'] = b64($signature);
$foreign = $assertion;
$foreign['id'] = b64(random_bytes(32));
check(lehrfahrer_sysop_mfa_finish($pdo, $login['csrf'], $foreign) === null, 'foreign credential denied');
$login = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $login['token'];
$request = lehrfahrer_sysop_mfa_begin($pdo, $login['csrf']);
$assertionClient = json_encode(['type' => 'webauthn.get', 'challenge' => $request['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
openssl_sign($assertionData . hash('sha256', $assertionClient, true), $signature, $private, OPENSSL_ALGO_SHA256);
$assertion['clientDataJSON'] = b64($assertionClient);
$assertion['signature'] = b64($signature);
$wrongHandle = $assertion;
$wrongHandle['userHandle'] = b64('normal');
check(lehrfahrer_sysop_mfa_finish($pdo, $login['csrf'], $wrongHandle) === null, 'manipulated account handle denied');
$login = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $login['token'];
$request = lehrfahrer_sysop_mfa_begin($pdo, $login['csrf']);
$assertionClient = json_encode(['type' => 'webauthn.get', 'challenge' => $request['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
openssl_sign($assertionData . hash('sha256', $assertionClient, true), $signature, $private, OPENSSL_ALGO_SHA256);
$assertion['clientDataJSON'] = b64($assertionClient);
$assertion['signature'] = b64($signature);
$verified = lehrfahrer_sysop_mfa_finish($pdo, $login['csrf'], $assertion);
check(is_array($verified) && !$verified['enrolled'], 'signed assertion creates full session');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $verified['session']['token'];
check(lehrfahrer_account_current_session($pdo, false) !== null, 'MFA session accepted');
$public = lehrfahrer_account_public_session($pdo, lehrfahrer_account_current_session($pdo, false));
check($public['companyName'] === 'Cottbusverkehr' && in_array('ADMIN', $public['tenantRoles'], true),
    'Cottbus ADMIN tenant context preserved');
check(in_array('SYSOP', $public['platformRoles'], true) && $public['userNumber'] === '00001',
    'SYSOP role and number preserved after MFA');
require dirname(__DIR__) . '/api/_sysop_passkey_management.php';
$sessionCsrf = $verified['session']['csrf'];
$keys = lehrfahrer_sysop_passkeys_list($pdo);
check(count($keys) === 1 && $keys[0]['name'] === 'Passkey 1', 'existing unnamed Windows passkey listed');
$firstId = $keys[0]['id'];
check(!lehrfahrer_sysop_passkeys_revoke($pdo, $sessionCsrf, $firstId), 'last active passkey protected');
check(!lehrfahrer_sysop_passkeys_rename($pdo, 'wrong-csrf', $firstId, 'Windows Haupt-PC'),
    'wrong CSRF blocks rename');
$beforeRename = $pdo->query("SELECT credential_id, public_key, sign_count, status FROM account_passkeys WHERE account_id = 'sysop'")->fetch(PDO::FETCH_ASSOC);
check(lehrfahrer_sysop_passkeys_rename($pdo, $sessionCsrf, $firstId, 'Windows Haupt-PC'),
    'first passkey can be named without changing credential');
check($beforeRename === $pdo->query("SELECT credential_id, public_key, sign_count, status FROM account_passkeys WHERE account_id = 'sysop'")->fetch(PDO::FETCH_ASSOC),
    'rename changes no security fields');
check(lehrfahrer_sysop_passkeys_list($pdo)[0]['name'] === 'Windows Haupt-PC', 'new label shown');
check(!lehrfahrer_sysop_passkeys_rename($pdo, $sessionCsrf, 'foreign-key', 'Fremd'),
    'foreign credential cannot be renamed');
unset($_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]);
$normalSession = lehrfahrer_account_login($pdo, 'normal', 'correct-password');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $normalSession['token'];
check(($normalSession['context'] ?? '') === 'TENANT'
    && lehrfahrer_sysop_passkeys_list($pdo) === null, 'tenant ADMIN cannot list SYSOP passkeys');
check(lehrfahrer_sysop_passkeys_begin($pdo, $normalSession['csrf'], 'Fremd') === null,
    'normal account cannot begin registration');
check(!lehrfahrer_sysop_passkeys_revoke($pdo, $normalSession['csrf'], $firstId),
    'foreign account cannot revoke SYSOP credential');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $verified['session']['token'];
check(lehrfahrer_sysop_passkeys_begin($pdo, 'wrong-csrf', 'iPad') === null,
    'wrong CSRF blocks managed enrollment');
$managed = lehrfahrer_sysop_passkeys_begin($pdo, $sessionCsrf, 'iPad');
check(isset($managed['options']->publicKey->challenge), 'second registration challenge issued');
$secondPrivate = openssl_pkey_new($keyOptions);
$secondDetails = openssl_pkey_get_details($secondPrivate);
$secondCredentialId = random_bytes(32);
$secondCose = cbor([1 => 2, 3 => -7, -1 => 1,
    -2 => new BinaryValue($secondDetails['ec']['x']), -3 => new BinaryValue($secondDetails['ec']['y'])]);
$secondAuthData = hash('sha256', LEHRFAHRER_SYSOP_MFA_RP_ID, true) . chr(0x45) . pack('N', 0)
    . str_repeat("\0", 16) . pack('n', strlen($secondCredentialId)) . $secondCredentialId . $secondCose;
$secondClient = json_encode(['type' => 'webauthn.create',
    'challenge' => $managed['options']->publicKey->challenge, 'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
$secondPayload = ['id' => b64($secondCredentialId), 'clientDataJSON' => b64($secondClient),
    'attestationObject' => b64(cbor(['fmt' => 'none', 'attStmt' => [], 'authData' => new BinaryValue($secondAuthData)]))];
check(lehrfahrer_sysop_passkeys_finish($pdo, $sessionCsrf, $secondPayload), 'second passkey registered');
check(!lehrfahrer_sysop_passkeys_finish($pdo, $sessionCsrf, $secondPayload), 'managed challenge replay denied');
$keys = lehrfahrer_sysop_passkeys_list($pdo);
check(count($keys) === 2 && in_array('iPad', array_column($keys, 'name'), true),
    'both passkeys remain active');
$secondId = array_values(array_filter($keys, static fn(array $key): bool => $key['name'] === 'iPad'))[0]['id'];
check(!lehrfahrer_sysop_passkeys_revoke($pdo, $sessionCsrf, 'foreign-key'),
    'manipulated credential ID cannot revoke a key');
unset($_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]);
$loginB = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $loginB['token'];
check(lehrfahrer_sysop_passkeys_list($pdo) === null, 'MFA pending cannot manage passkeys');
$requestB = lehrfahrer_sysop_mfa_begin($pdo, $loginB['csrf']);
$clientB = json_encode(['type' => 'webauthn.get', 'challenge' => $requestB['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
$authB = hash('sha256', LEHRFAHRER_SYSOP_MFA_RP_ID, true) . chr(0x05) . pack('N', 1);
openssl_sign($authB . hash('sha256', $clientB, true), $signatureB, $secondPrivate, OPENSSL_ALGO_SHA256);
$assertionB = ['id' => b64($secondCredentialId), 'clientDataJSON' => b64($clientB),
    'authenticatorData' => b64($authB), 'signature' => b64($signatureB)];
$verifiedB = lehrfahrer_sysop_mfa_finish($pdo, $loginB['csrf'], $assertionB);
check(is_array($verifiedB) && !$verifiedB['enrolled'], 'second credential authenticates');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $verified['session']['token'];
check(lehrfahrer_sysop_passkeys_revoke($pdo, $sessionCsrf, $secondId), 'one of two passkeys revoked');
check(count(lehrfahrer_sysop_passkeys_list($pdo)) === 1, 'remaining passkey stays active');
unset($_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]);
$revokedAttempt = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $revokedAttempt['token'];
$revokedChallenge = lehrfahrer_sysop_mfa_begin($pdo, $revokedAttempt['csrf']);
$revokedClient = json_encode(['type' => 'webauthn.get',
    'challenge' => $revokedChallenge['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
openssl_sign($authB . hash('sha256', $revokedClient, true), $revokedSig, $secondPrivate, OPENSSL_ALGO_SHA256);
check(lehrfahrer_sysop_mfa_finish($pdo, $revokedAttempt['csrf'], [
    'id' => b64($secondCredentialId), 'clientDataJSON' => b64($revokedClient),
    'authenticatorData' => b64($authB), 'signature' => b64($revokedSig)]) === null,
    'revoked passkey cannot log in');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $verified['session']['token'];
check(!lehrfahrer_sysop_passkeys_revoke($pdo, $sessionCsrf, $firstId),
    'last passkey still protected after revocation');
check(lehrfahrer_account_current_session($pdo, false) !== null, 'management keeps current MFA session');
check(lehrfahrer_sysop_mfa_finish($pdo, $login['csrf'], $assertion) === null, 'challenge cannot be replayed');
$expired = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $expired['token'];
lehrfahrer_sysop_mfa_begin($pdo, $expired['csrf']);
$pdo->prepare('UPDATE account_mfa_pending SET challenge_expires_at = ? WHERE token_hash = ?')
    ->execute([lehrfahrer_auth_timestamp(time() - 1), lehrfahrer_auth_token_hash($expired['token'])]);
check(lehrfahrer_sysop_mfa_finish($pdo, $expired['csrf'], $assertion) === null, 'expired challenge denied');
$wrongRp = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
$_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE] = $wrongRp['token'];
$wrongRpBegin = lehrfahrer_sysop_mfa_begin($pdo, $wrongRp['csrf']);
$wrongRpClient = json_encode(['type' => 'webauthn.get', 'challenge' => $wrongRpBegin['options']->publicKey->challenge,
    'origin' => LEHRFAHRER_SYSOP_MFA_ORIGIN], JSON_THROW_ON_ERROR);
$wrongRpData = hash('sha256', 'www.lehrfahrer.de', true) . chr(0x05) . pack('N', 2);
openssl_sign($wrongRpData . hash('sha256', $wrongRpClient, true), $wrongRpSig, $private, OPENSSL_ALGO_SHA256);
check(lehrfahrer_sysop_mfa_finish($pdo, $wrongRp['csrf'], ['id' => b64($credentialId),
    'clientDataJSON' => b64($wrongRpClient), 'authenticatorData' => b64($wrongRpData),
    'signature' => b64($wrongRpSig)]) === null, 'wrong RP ID denied');
$pdo->beginTransaction();
$pdo->prepare("UPDATE account_passkeys SET status = 'revoked', revoked_at = ? WHERE account_id = ? AND status = 'active'")
    ->execute([$now, 'sysop']);
$pdo->prepare('UPDATE account_mfa_pending SET consumed_at = ? WHERE account_id = ? AND consumed_at IS NULL')
    ->execute([$now, 'sysop']);
$pdo->prepare('UPDATE account_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL')
    ->execute([$now, 'sysop']);
$pdo->commit();
check(lehrfahrer_account_current_session($pdo, false) === null, 'server-side recovery revokes active session');
check(lehrfahrer_sysop_mfa_credentials($pdo, 'sysop') === [], 'server-side recovery revokes only sysop keys');
unset($_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]);
$recovery = lehrfahrer_account_login($pdo, 'sysop', 'correct-password');
check(($recovery['purpose'] ?? '') === 'ENROLL', 'server-side recovery allows controlled re-enrollment');
$pdo->exec('DELETE FROM sysop_assignment');
check(!lehrfahrer_sysop_mfa_required($pdo, 'sysop')
    && !isset(lehrfahrer_account_login($pdo, 'sysop', 'correct-password')['mfaPending']),
    'user number 00001 alone is not the MFA authority');
$normal = lehrfahrer_account_login($pdo, 'normal', 'correct-password');
check(isset($normal['token']) && !isset($normal['mfaPending']), 'non-sysop login unaffected');

// Remove only this isolated fixture; no staging or production data is touched.
$pdo = null;
chdir($originalWorkingDirectory);
foreach (glob($dir . '/control/*') ?: [] as $file) @unlink($file);
@unlink($dir . '/openssl.rnd');
@unlink($dir . '/.rnd');
if (!$projectRndExisted) @unlink($projectRnd);
@rmdir($dir . '/control');
@rmdir($dir . '/webroot');
@rmdir($dir);
