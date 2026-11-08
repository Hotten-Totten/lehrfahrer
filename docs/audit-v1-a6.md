# Audit V1 A6 – lesender Mandantenzugang

`api/audit_read.php` accepts GET only. Every page resolves a verified account session,
requires an active TENANT membership and `audit.read`, and derives the company from
that membership. Legacy sessions, API tokens, PENDING/PLATFORM contexts and supplied
company/account parameters cannot select a tenant. No write/delete endpoint exists.

`audit.html` is reached through Server → Verwaltung → Auditprotokoll. The static
shell contains no business data. The API returns no-store/private responses and
only an explicit projection of tenant events: UTC time, event ID, action/result,
reason code, technical actor/membership and object IDs. Names, notes, credentials,
role/capability snapshots, global sequence numbers and chain hashes are omitted.
The ledger is not joined to personnel or account names. PREAUTH, SYSTEM and
PLATFORM events are excluded even if a company ID were present.

Filters: inclusive UTC calendar dates, catalog action, result and exact technical
object ID. Unknown parameters, arrays and malformed values return 400. Default
page size is 25, maximum 50; descending keyset pagination uses a tenant-validated
opaque event ID. Invalid and foreign cursors return the same generic error. There
is no global count, unbounded export or expensive per-request full-chain scan.
The read view makes no assertion that it has verified the entire hash chain.

No schema migration or business-data change is required. Retention, platform
access (A7), external integrity anchoring and final A8 acceptance remain separate.

Verification: `node --test tools/audit-read.test.js`, existing audit writer,
account auth and file-operation regression tests. The A6 suite uses isolated
temporary SQLite databases and an actual local HTTP server. It covers tenant
isolation, revoked permission/membership, legacy/token/platform denial, projection,
filters, foreign cursors, pagination, HTTP methods, no-store headers and a ledger
outage returning 503 without database details.

Staging deployment and manual acceptance must be recorded after their actual checks.

Local validation 2026-11-08: focused Node suites 67/67; standalone PHP audit
writer passed; full Node suite 714 tests, 703 passed, 9 skipped, only the
two previously documented navigation-off-route failures (tests at 102/163).

Deployment follow-up: the historical Cottbus postcheck required nonempty package
and document directories even after A5 explicitly removed its test package.
These two areas may now be empty; directory and symlink checks stay in force.
No package or document is created to satisfy a deployment check.
