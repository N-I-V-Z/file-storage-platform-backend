# Database migrations

Run migrations from this repository. Start the local PostgreSQL service in `../file-storage-platform-infra`, configure `DATABASE_URL` in `.env`, then run `pnpm db:migrate:deploy` and `pnpm db:status`. The initial migration creates `users` and `sessions`. Re-running deploy should report no pending migrations.

Before a production release, take a PostgreSQL backup and verify that it restores into an isolated database. Record the backup identifier with the release. Deploy migrations before starting API instances that need the new schema. Keep each migration compatible with the previously deployed API until all instances have been replaced.

Prisma migrations in this repository are forward-only SQL. If a deployment fails, first roll back the application release. If the schema itself must be reverted, restore the verified backup into an isolated database, check its data, and switch traffic only after review. For a small schema defect, prefer a corrective forward migration that preserves existing rows. Never edit a migration that has already been applied.

For local development, use `pnpm db:migrate:dev` to create a new migration after editing `prisma/schema.prisma`. Commit the migration SQL and schema together, then verify `pnpm db:migrate:deploy` against an empty test database before merging.
