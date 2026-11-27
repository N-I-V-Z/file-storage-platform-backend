# Private file sharing

Owners can issue read-only links for a `READY` file only when `scanned_at` confirms a clean malware scan. Existing unscanned files remain private and must be reuploaded or rescanned before sharing. Creating a link does not change the file's private status.

## Owner endpoints

All paths below use `/api/v1` and require the owner's Bearer access token.

- `POST /projects/:projectId/files/:fileId/share-links` accepts optional `{ "expiresAt": "2026-11-28T10:00:00.000Z" }`. The default is 24 hours; the maximum is seven days. The response contains a random `fsps_...` token **once**. It returns 404 for foreign, trashed, or unscanned files.
- `GET /projects/:projectId/files/:fileId/share-links` returns link IDs, file IDs, creation, expiry, and revocation timestamps. It never returns token text or hashes.
- `DELETE /projects/:projectId/files/:fileId/share-links/:linkId` revokes an active link and returns 204. Revocation is irreversible.

The database stores only SHA-256 token hashes. Issuance and revocation record audit events with link IDs, never token values. Moving a file to trash revokes all its links in the same database transaction; restoring the file does not reactivate them.

## Recipient download

The public `GET` and `HEAD /api/v1/shared-files/download` routes accept `Authorization: Share <token>`. The token is sent in a header, not a request URL. A future web link uses a URL fragment, which is not transmitted in HTTP requests, then passes the token in this header. Invalid, forged, expired, revoked, unscanned, and trashed links all return a generic 404. Requests are limited to 30 per minute per IP.

The existing download stream handles `Range`, `206`, `416`, `Content-Length`, and `ETag`. Responses set `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. The server does not expose filesystem paths. For direct API use, copy the token to a secure server environment and send the header on each request.

## Deployment

Apply the additive `share_links` migration before deploying this API. Keep ClamAV available for new uploads. Verify that a link for a newly scanned file downloads, then that revocation and trash return 404. Never record Authorization headers in proxy, application, or telemetry logs.
