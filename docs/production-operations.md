# Single VPS operations

For the current InstaBox container deployment, use `file-storage-platform-infra/compose.instabox.yaml` and `README.instabox.md`. The generic VPS bundle is documented in `README.production.md`. The host process instructions below describe the non-container deployment path.

This deployment keeps one Next.js process, one NestJS process, PostgreSQL, Redis, ClamAV and a private filesystem on an 8 GiB RAM / 20 GB disk VPS. Keep one API instance: upload reservations, active stream limits and rate limits currently use process-local state. Do not deploy a second API instance until these controls have a shared coordinator.

## Network and TLS

Use two DNS names on the same site, such as `app.example.com` and `api.example.com`. Copy `ops/Caddyfile.example` to the host Caddy configuration and replace the names. Run Caddy on the host; it terminates HTTPS on 443 and proxies to Next.js on `127.0.0.1:3000` and NestJS on `127.0.0.1:4000`. Open only 80/443 and restricted SSH at the host firewall. Keep 3000/4000/5432/6379/3310 off the public interface. Caddy requires DNS and reachable 80/443 to obtain public certificates; validate and reload its configuration before switching traffic. [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Set backend `NODE_ENV=production`, `HOST=127.0.0.1`, `CORS_ORIGINS=https://app.example.com`, the real database/Redis/ClamAV endpoints, and an absolute `STORAGE_ROOT` outside the source tree. Set frontend `NEXT_PUBLIC_APP_URL=https://app.example.com` and `NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1` **before building**; set `API_INTERNAL_URL=http://127.0.0.1:4000/api/v1` for server-side calls. Start Next.js with `pnpm start --hostname 127.0.0.1 --port 3000`; start the API with `pnpm start:prod`. Use a service manager to restart both processes and persist logs. Keep `.env` readable only by the service account, and give that account exclusive write access to `STORAGE_ROOT`. Do not make `STORAGE_ROOT` a web root.

## Release order

1. Record current commit IDs and a verified backup ID. Ensure PostgreSQL, Redis and ClamAV are healthy. Stop API writes, run `BACKUP_OFFLINE_ACK=api-stopped pnpm ops:backup <off-host-mounted-dir>`, and complete a restore drill on an isolated host. [Backup procedure](../ops/README.md).
2. In CI or staging with a **separate test database and storage tree**, run `pnpm install --frozen-lockfile`, format, lint, typecheck, unit/E2E tests and build. Deploy the reviewed artifacts to the VPS. Apply `pnpm db:migrate:deploy` once against production before starting the new API, then check `pnpm db:status`. Never point the E2E suite at production data.
3. Start the API and confirm `curl --fail http://127.0.0.1:4000/ready` reports all four services up. Start the frontend and verify login, upload, download, Range and share link over HTTPS. Confirm the refresh cookie is `Secure` in production.
4. If the release fails, stop writes and return to the previous application build. Prisma migrations are forward-only; retain additive schema or restore the verified backup into an isolated environment, then switch traffic only after review. Never edit an applied migration. [Migration recovery](database-migrations.md).

## Backups and recovery

Back up PostgreSQL and `STORAGE_ROOT` in the same offline window. `pg_dump -Fc` creates a consistent database archive, while the stopped API keeps file bytes aligned with metadata. Store bundles encrypted off the VPS; a second directory on the same 20 GB disk is not disaster recovery. Keep at least seven daily and four weekly bundles, subject to actual capacity and policy; record the oldest successful restore drill, not just the newest backup. Run a restore drill at least monthly and before destructive migrations. The drill validates checksums and every retained object's length/hash. PostgreSQL recommends testing restores from custom-format archives with `pg_restore`; copying a running PostgreSQL data directory is not a valid substitute. [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [filesystem backup limits](https://www.postgresql.org/docs/17/backup-file.html).

Recovery order: isolate the failed release, restore the verified database into a fresh database and file tree, inspect project/file counts and sample downloads, then point a single API instance at the restored pair. Reissue credentials if a backup was exposed. Record the recovery point and any uploads lost after it; this design has no continuous WAL archive or point-in-time recovery.

## Monitoring and rehearsals

Probe local `/health` for process liveness and `/ready` for PostgreSQL, Redis, free disk reserve and ClamAV. An authenticated admin can read `GET /api/v1/admin/operations` for disk free, temporary bytes/files, active uploads/downloads and process RSS. Alert on any 503 for two consecutive probes, disk free below 2 GiB (uploads stop at the configured 1 GiB reserve), repeated 5xx/429 responses, failed backup, restore drill older than 30 days, a growing `temporaryBytes` trend or `temporaryTruncated: true`, and ClamAV signature update failure. Sample CPU, disk I/O, network throughput and active connections from the host/service manager. Keep request logs without tokens, cookies, request bodies, filenames or storage paths. The public Caddy example blocks health and Swagger routes; probe them on loopback. The operations endpoint requires the current database ADMIN role and must never be used with a token in the URL.

Run `pnpm ops:load` only against a disposable project and compare p50/p95 latency, error count and resource use with a baseline. The E2E suite covers abort, timeout, simulated disk full, concurrent quota, download disconnect and Range. Rehearse real scanner outage and disk pressure on staging with an isolated volume; confirm fail-closed upload behavior and eventual temporary-file cleanup. [Load harness](../ops/README.md).

## Known limits

This setup has one VPS and one disk failure domain. A full restore requires downtime and enough space on a separate host or volume. The sample Caddy configuration is an operator template, not an installed service; real domains, DNS, certificates, firewall rules, off-host backup storage and restore drill evidence must be provided before public launch.
