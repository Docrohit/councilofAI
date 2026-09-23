# Change Council storage

Change: [schema/persistence behavior]. Inspect server/db.ts, server/store.ts,
direct SQL in server/app.ts and native consumers. Current node:sqlite storage
has no ORM migration command. PostgreSQL is a future direction.

Describe schema/data impact, owner isolation, compatibility, locking, backfill,
rollback limits and backups/keys. A PostgreSQL design must address native
SQLite/offline behavior and process-local queues; ask unresolved choices first.

Test existing-data upgrade, clean install, interruption, constraints and restore
using disposable databases. Explain irreversible operations honestly and use
parameterized SQL. Record transaction/external-side-effect boundaries. Run
native/hosted persistence checks and obtain independent review. Production
migration/restore needs explicit approval and a suitable backup.
