# File Storage Platform API

NestJS API for private project storage on PostgreSQL and a local VPS filesystem. Uploaded files are scanned by ClamAV before becoming available for download or expiring share links.

## Local development

Copy `.env.example` to `.env` and set local secrets and service URLs. Start PostgreSQL, Redis and ClamAV with the adjacent `file-storage-platform-infra/compose.yaml`, then run:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:deploy
pnpm start:dev
```

`GET /health` checks process liveness. `GET /ready` checks PostgreSQL, Redis, storage free space and ClamAV. The API uses port 4000 by default. Swagger is at `/api/docs` during local development.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

See [production operations](docs/production-operations.md) for HTTPS, release order, monitoring, backup/restore and the bounded load harness. API contracts are in `docs/`.
