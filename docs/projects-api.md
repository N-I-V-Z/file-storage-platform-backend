# Projects and API keys

All endpoints use `/api/v1`. JSON successes use `{ success: true, data, timestamp }`, with the result shown in the table inside `data`; `204` responses have no body. Errors use `{ success: false, error, path, timestamp }`. See `response-contract.md`. Project and key management require a bearer access JWT. A user can see or change only projects they own; an unknown or foreign project returns `404`.

| Endpoint | Request | Success |
| --- | --- | --- |
| `POST /projects` | `{ "name": "Workspace" }` | `201` project metadata |
| `GET /projects` | — | `200` owned projects |
| `GET /projects/:id` | — | `200` project metadata |
| `GET /projects/:id/usage` | — | `200` storage balances for the owner |
| `GET /projects/:id/usage/breakdown` | — | `200` owner-only metadata breakdown and balance check |
| `PATCH /projects/:id` | `{ "name": "New name" }` | `200` updated project |
| `DELETE /projects/:id` | — | `204`; deletes project and its keys, or `409` while files exist |
| `POST /projects/:id/api-keys` | `{ "name": "Uploader", "scopes": ["files:write"], "expiresAt": "2027-01-01T00:00:00Z" }` | `201` key metadata **and plaintext `token`** |
| `GET /projects/:id/api-keys` | — | `200` key metadata only |
| `DELETE /projects/:id/api-keys/:keyId` | — | `204`; revokes the key |

Names are trimmed; project names allow 1–120 characters and key names 1–100. Scope values are `projects:read`, `files:read`, and `files:write`; at least one is required. `expiresAt` is optional but, if supplied, must be a future ISO date. The key list includes scopes, creation, expiry, revocation, and last-use timestamps. It never returns the secret or its hash. Treat the create response as sensitive and show/copy the token only once.

`GET /projects/:id/usage` requires the owner's bearer JWT. Its `data` has `projectId` plus `quotaBytes`, `usedBytes`, and `reservedBytes` as decimal **strings**, for example `{ "projectId": "<uuid>", "quotaBytes": "10737418240", "usedBytes": "4096", "reservedBytes": "0" }`. Parse the balances as `BigInt` for arithmetic; JavaScript `Number` can lose precision for large quotas. `usedBytes` includes finalized files, while `reservedBytes` is capacity held by in-progress uploads. Available bytes are `quotaBytes - usedBytes - reservedBytes`. The endpoint reads current PostgreSQL balances, so changing `PROJECT_QUOTA_BYTES` in the environment does not retroactively change existing projects. There is no migration in this change.

`GET /projects/:id/usage/breakdown` reads the owned project's balances and file metadata from one PostgreSQL snapshot. It returns the same four fields plus decimal-string `readyBytes`, `trashBytes`, and `pendingBytes`, and boolean `matchesBalance`. READY sizes contribute to `readyBytes`; TRASHED and PURGING sizes remain charged in `trashBytes`; UPLOADING and ABANDONED reservations contribute to `pendingBytes`. `matchesBalance` is true only when `usedBytes = readyBytes + trashBytes`, `reservedBytes = pendingBytes`, and every finalized file has a size. A false value identifies drift for investigation; this read-only endpoint never rewrites quota counters or touches files. It requires the owner JWT, returns 404 for unknown or foreign projects, and exposes no storage path or key. The original `/usage` response remains unchanged.

The issued token has the form `fsp_<key-uuid>_<random-secret>`. PostgreSQL stores its SHA-256 hash, not the token. Third-party clients send `Authorization: ApiKey <token>`. The Phase 4 proof endpoint `GET /projects/:projectId/key-access` requires `projects:read`, verifies the token against the requested project and updates `lastUsedAt`; revoked, expired, or forged keys return `401`, while wrong project or missing scope returns `403`. It allows 20 attempts per minute per client IP before returning `429`, using in-process storage. Move this limiter to shared Redis storage before running multiple API instances. File upload and download endpoints already enforce `files:write` and `files:read` respectively; project usage remains owner-only. Never place an API key in a URL, browser storage, or logs.
