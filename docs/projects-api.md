# Projects and API keys

All endpoints use `/api/v1`. Project and key management require a bearer access JWT. A user can see or change only projects they own; an unknown or foreign project returns `404`.

| Endpoint | Request | Success |
| --- | --- | --- |
| `POST /projects` | `{ "name": "Workspace" }` | `201` project metadata |
| `GET /projects` | — | `200` owned projects |
| `GET /projects/:id` | — | `200` project metadata |
| `PATCH /projects/:id` | `{ "name": "New name" }` | `200` updated project |
| `DELETE /projects/:id` | — | `204`; deletes project and its keys |
| `POST /projects/:id/api-keys` | `{ "name": "Uploader", "scopes": ["files:write"], "expiresAt": "2027-01-01T00:00:00Z" }` | `201` key metadata **and plaintext `token`** |
| `GET /projects/:id/api-keys` | — | `200` key metadata only |
| `DELETE /projects/:id/api-keys/:keyId` | — | `204`; revokes the key |

Names are trimmed; project names allow 1–120 characters and key names 1–100. Scope values are `projects:read`, `files:read`, and `files:write`; at least one is required. `expiresAt` is optional but, if supplied, must be a future ISO date. The key list includes scopes, creation, expiry, revocation, and last-use timestamps. It never returns the secret or its hash. Treat the create response as sensitive and show/copy the token only once.

The issued token has the form `fsp_<key-uuid>_<random-secret>`. PostgreSQL stores its SHA-256 hash, not the token. Third-party clients send `Authorization: ApiKey <token>`. The Phase 4 proof endpoint `GET /projects/:projectId/key-access` requires `projects:read`, verifies the token against the requested project and updates `lastUsedAt`; revoked, expired, or forged keys return `401`, while wrong project or missing scope returns `403`. File endpoints will apply `files:read` or `files:write` in later phases. Never place an API key in a URL, browser storage, or logs.
