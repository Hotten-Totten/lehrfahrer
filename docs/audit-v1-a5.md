# Audit V1 A5

Technical scope: driver create/change/activation/delete, training create/status/route
completion, package create/regenerate/rename/delete and PDF/ZIP access, operational
city dispatch-phone changes. Read-only lists retain their existing compatibility.
Mutations and package downloads require a verified account and active tenant membership.
Mutations additionally enforce the existing capability, same-origin and CSRF checks.

## Consistency and recovery

The A4 tenant lock encloses the complete read/modify/write request, including training
ID allocation and package source reads. Journal version 3 adds a closed business
identity to the existing recovery engine. Versions 1 and 2 remain supported unchanged.
Only the object's exact list/manifest/settings file and, for packages, its own PDFs
and ZIP may participate. Every mutation uses CRITICAL audit and reversible activation.
Readers reject unfinished or invalid journals in their own tenant. Writers recover
before reading data. An ambiguous recovery remains blocked.

Package regeneration prepares every PDF, manifest and optional ZIP before activation.
Rename invalidates the old ZIP in the same transaction; delete includes the manifest,
cached ZIP and all own PDFs. Empty technical directories can remain. ZIP downloads are
built in temporary storage and do not mutate package data. No existing staging records
are modified by automated local tests.

## Events and data minimization

DRIVER_CREATE / DRIVER_CHANGE / DRIVER_STATUS_CHANGE / DRIVER_DELETE
TRAINING_CREATE / TRAINING_STATUS_CHANGE / TRAINING_ROUTE_COMPLETE
PACKAGE_CREATE / PACKAGE_CHANGE / PACKAGE_DELETE / PACKAGE_DOWNLOAD
SETTING_CHANGE

Object IDs hash tenant + object type + technical ID. No names, personnel numbers,
notes, telephone numbers, PDF names or full payloads enter the audit ledger.
Server session supplies account, membership, tenant and capability.
Unchanged driver edits, repeated route completion, unchanged package rename and
unchanged dispatch-phone saves produce no additional event.

PACKAGE_DOWNLOAD is OPERATIONAL. It records an authorized access with prepared bytes,
not proof of receipt by the browser. Audit failure returns 503 before document headers
or bytes are sent. The endpoint does not report a successful download on audit failure.

## Verification and acceptance

Local integration tests use two isolated tenants and verified account sessions.
They cover real endpoints, foreign IDs, legacy/token denial, CSRF, actor spoofing,
each mutation's audit failure, no-op writes, malformed data, blocked reads, concurrent
driver creation, package regeneration and training status transitions.
Recovery tests cover each business type at every journal boundary and package partial
activation. Existing A4 route and batch-recovery tests remain required.

Staging acceptance remains open until deployment and the joint UI test. No production
deployment is part of A5. Local browser settings and city/route lifecycle migrations
are separate paths; A5 does not change their behavior.
