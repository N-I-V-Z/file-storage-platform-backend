# Streaming upload API

`POST /api/v1/projects/:projectId/files` accepts exactly one `multipart/form-data` part named `file`. Authenticate with `Authorization: Bearer <accessToken>` as the project owner or `Authorization: ApiKey <token>` scoped to `files:write` for that project. Never put a key in a URL or form field. An optional `X-Content-SHA256` header must be 64 lowercase hexadecimal characters and match the received file. Requests are limited to 20 attempts/minute/IP in the current single-process deployment.

Accepted MIME/signature pairs are PNG, JPEG, WebP, PDF, MP4, and ZIP. The supplied filename must be 1–255 UTF-8 bytes and cannot contain path separators or control characters. The server generates both the public file ID and private storage key; it never uses the supplied filename as a path. Empty files, unsupported or mismatched signatures, extra multipart parts, and checksum mismatches return `400`. The actual byte limit is 512 MiB by default; exceeding it returns `413`. A full project quota also returns `413`; insufficient disk space or an `ENOSPC` write returns `507`. The concurrency limit returns `429`. An interrupted or timed-out upload is canceled and its reservation is released.

On success, HTTP `201` returns the usual JSON envelope. Example `data`:

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "projectId": "00000000-0000-4000-8000-000000000002",
  "originalName": "picture.png",
  "contentType": "image/png",
  "sizeBytes": 262152,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "ready",
  "createdAt": "2026-11-19T00:00:00.000Z"
}
```

Only metadata is stored in PostgreSQL. The file stays private under `STORAGE_ROOT/objects/`; download and public sharing arrive in later phases. No file in `temporary/`, `processing/`, or `quarantine/` is served. A `READY` row is created only after the temporary file has been checked and promoted. The response does not reveal filesystem paths or the private storage key.

## Quota and operations

`PROJECT_QUOTA_BYTES` defaults to 10 GiB for new projects. The migration assigns 10 GiB to existing projects; changing the environment later does not retroactively change existing limits. Each upload reserves the configured `MAX_UPLOAD_BYTES` atomically before writing, then finalization charges actual bytes and releases unused reservation. `MIN_DISK_FREE_BYTES` defaults to 1 GiB; the free-space preflight accounts for active uploads in this process. `MAX_CONCURRENT_UPLOADS` defaults to 4 and `UPLOAD_TIMEOUT_MS` to 10 minutes. Run a single API instance for this MVP; multi-instance concurrency and disk accounting require a shared coordinator and shared storage.

On failure the API marks the upload abandoned, deletes its temporary or promoted object, and releases the reservation. At startup and every 10 minutes, reconciliation retries cleanup for abandoned uploads and uploads whose 15-minute reservation has expired. If filesystem cleanup fails, the reservation stays held until a later retry. Project deletion returns `409` while it contains file records; a file deletion workflow must be added before projects with files can be removed.

The current allowlist checks file signatures but does **not** scan for malware. `quarantine/` is reserved for a future scanner; do not advertise uploads as malware scanned or make uploaded files public until that gate is implemented. Back up PostgreSQL metadata and `STORAGE_ROOT` together.
