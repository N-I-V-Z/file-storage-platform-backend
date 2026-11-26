# Private streaming download API

`GET` and `HEAD /api/v1/projects/:projectId/files/:fileId/download` serve only files in `READY` state. Send `Authorization: Bearer <accessToken>` as the project owner or `Authorization: ApiKey <token>` with `files:read` for that project. Authentication and project access are checked before the object is opened. A missing, foreign, or unfinished file returns `404` after project authorization. Revoked and expired keys return `401`; a key without read scope returns `403`.

The response is binary, not the JSON success envelope. Full `GET` returns `200`; `HEAD` returns the same representation headers without a body. Headers include `Content-Type`, `Content-Disposition: attachment` with an encoded filename, `Content-Length`, a quoted SHA-256 `ETag`, `Accept-Ranges: bytes`, and `Cache-Control: private, no-store`. The private storage key and filesystem path are never returned.

## Byte ranges

Use a single `Range: bytes=<start>-<end>`, `bytes=<start>-`, or `bytes=-<suffix-length>` header. A satisfiable range returns `206` with exact `Content-Range` and `Content-Length`; `HEAD` supports the same headers. Ranges extending beyond EOF are clamped. An invalid, multiple, or unsatisfiable range returns `416` with `Content-Range: bytes */<full-size>`. A range on a zero-byte file also returns `416`. When `If-Range` does not match the current ETag, the server sends the full representation with `200`.

Downloads stream directly from the filesystem with backpressure and close their file handle on completion, disconnect, error, or timeout. `MAX_CONCURRENT_DOWNLOADS` defaults to 16 per API process, `DOWNLOAD_TIMEOUT_MS` to 10 minutes, and the route is limited to 120 requests/minute/IP. At capacity the API returns `429`; an unavailable or inconsistent storage object returns `503` before the response starts. If a read fails after headers have been sent, the connection is closed because a valid error response can no longer replace partial bytes.

The current schema has no public visibility policy. All files remain private; public links and signed sharing belong to the later sharing phase. This phase adds no database migration. Rollback consists of deploying the previous API version; existing file data and metadata remain valid.
