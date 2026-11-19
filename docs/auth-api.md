# Authentication API

All routes below use the `/api/v1/auth` prefix. JSON successes use `{ success: true, data, timestamp }`, with the result shown in the table inside `data`. JSON errors use `{ success: false, error, path, timestamp }`. See `response-contract.md` for exceptions.

| Route | Request | Success |
| --- | --- | --- |
| `POST /register` | `{ "email": "user@example.com", "password": "at-least-12-characters" }` | `201` with `{ id, email }` |
| `POST /login` | `{ "email": "user@example.com", "password": "..." }` | `200` with `{ accessToken, user: { id, email } }` and refresh cookie |
| `POST /refresh` | `fsp_refresh` cookie | `200` with a new access token and rotated refresh cookie |
| `GET /me` | `Authorization: Bearer <accessToken>` | `200` with `{ id, email }` |
| `POST /logout` | Bearer access token | `204`; revokes the session and clears the refresh cookie |

The access token expires after 15 minutes. The refresh session expires after 30 days. The refresh cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/api/v1/auth`, and `Secure` in production. Browser requests must use `credentials: 'include'`; `/refresh` rejects an `Origin` outside `CORS_ORIGINS`. Keep the access token in memory, not `localStorage`. On a `401`, refresh once and retry the original request; if refresh fails, return to sign-in.

Refresh tokens are opaque. PostgreSQL stores only HMAC hashes, including hashes of consumed tokens. Reusing any consumed token revokes the session, so the client must serialize refresh requests. `JWT_REFRESH_SECRET` is the HMAC key for those hashes despite its existing name. Registration and login are rate limited per API process; use shared storage before running multiple API instances.
