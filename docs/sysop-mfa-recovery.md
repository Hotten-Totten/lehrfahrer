# SYSOP Passkey recovery (Staging V1)

This is an exceptional server-side operation. There is no browser endpoint, URL flag, tenant ADMIN action, or automatic timer for it. A verified operator must confirm the actual account through `sysop_assignment`; user number `00001` alone is insufficient.

1. Record the current auth mode and lock state and validate a private Control DB restore point before any mutation. In a server-side maintenance session, acquire the existing named auth lock and set `control_metadata.auth_cutover_lock` to `LOCKED`; verify that new login and context changes are blocked. The existing cutover helper itself only permits this transition in `PARALLEL` mode and must not be used for an `ACCOUNT_PRIMARY` recovery.
2. In one database transaction, read the single `sysop_assignment` row and confirm that its account is the intended active SYSOP and the corresponding platform role. Lock the account row. Abort on any ambiguity.
3. For that exact account ID only, set all active `account_passkeys` to `status='revoked'` with `revoked_at`; mark unconsumed `account_mfa_pending` rows consumed; and revoke all active `account_sessions`. Do not remove credential history or change user numbers, roles, memberships, or other accounts. Commit all three changes together.
4. Verify zero active credentials, zero active pending ceremonies and zero active account sessions for that account; verify other accounts are unchanged. Reopen the auth gate only after verification.
5. The SYSOP signs in with the existing password and must complete fresh Passkey enrollment before a full session can be issued. If enrollment fails, the account remains in enrollment mode without a full session. An operator verifies enrollment and a subsequent password plus Passkey login.

The recovery transaction must be executed only against the intended Staging Control DB, with a second-person review and a validated restore point. Never use a normal tenant ADMIN session as authority for this operation. For Production, a separate procedure and approval are required.
