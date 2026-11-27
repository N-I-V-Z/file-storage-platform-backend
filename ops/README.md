# Offline backup and restore drill

These commands are for a single API instance with local filesystem storage. Install PostgreSQL 17 client tools (`pg_dump`, `pg_restore`, `createdb`, `psql`) and GNU `tar` on the operator host. Keep the database and ClamAV running; stop the NestJS API and any workers that write to `STORAGE_ROOT`. Confirm no upload or purge is active before taking a backup. An offline window keeps the database snapshot and file archive aligned.

Use a private backup destination on a separate mounted volume or host, outside `STORAGE_ROOT`. The scripts never place the database URL on a child command line, but the `.env` file and resulting archives contain sensitive data. Restrict their permissions and transfer them encrypted. Do not commit a bundle.

```bash
export BACKUP_OFFLINE_ACK=api-stopped
pnpm ops:backup /mnt/private-backups
```

The command publishes `backup-<timestamp>-<id>/` only after `pg_dump`, the storage archive, and SHA-256 manifest succeed. An interrupted run leaves no completed bundle. Restart the API only after checking the command exit status and the new bundle.

Run a drill on an isolated host with enough space for the database and files. Supply `DATABASE_URL` for a database role permitted to create a **new** database, and `STORAGE_ROOT` for the live or reference tree used solely to reject unsafe restore destinations. The script creates a random `fsp_drill_*` database and a new target directory; it refuses an existing target. It verifies archive hashes, restores the database and files, then checks every READY/TRASHED object's size and SHA-256 against restored metadata.

```bash
pnpm ops:restore-drill /mnt/private-backups/backup-<id> /mnt/restore-drill/files
```

Record the reported database name, file count, duration, and backup ID. Inspect the restored app against that database and storage tree before removing drill resources with `dropdb <reported-name>` and deleting the newly created target directory. Never point the application at the drill database until a separate recovery decision is made. Neither script overwrites the live database or storage tree.
