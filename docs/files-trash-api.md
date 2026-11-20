# Private file trash API

All paths use `/api/v1` and require the project owner's Bearer JWT. API keys cannot list, trash, restore, or purge files. Foreign projects and file IDs return `404`. JSON responses use the standard success/error envelope; `204` responses have no body. Trash data is private and never exposes storage keys or filesystem paths.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| `DELETE` | `/projects/:projectId/files/:fileId` | Move a READY file to trash; `204`. Repeating after transition returns `404`. |
| `GET` | `/projects/:projectId/trash` | List trashed files with the same bounded page, pageSize, search, MIME, folder, and sort parameters as the READY file list. |
| `POST` | `/projects/:projectId/trash/:fileId/restore` | Restore a file before expiry; `200` with `{ id, status: "ready" }`. Expired retention returns `409`. |
| `DELETE` | `/projects/:projectId/trash/:fileId` | Permanently purge a trashed file; `204` after physical and metadata deletion. A storage failure returns `503` and queues retry. |

The trash list returns `{ items, page, pageSize, total }`. Each item contains `id`, `projectId`, nullable `folderId`, `originalName`, `contentType`, decimal-string `sizeBytes`, `status: "trashed"`, `createdAt`, `trashedAt`, and `purgeAfter`. No trashed file appears in the READY list or private download endpoint.

## Retention and quota

Retention is 30 days from trashing. Trashed files remain on disk and count toward project `usedBytes`; restoring does not alter usage. Purge removes the object and atomically deletes the metadata row and decrements `usedBytes` once. A folder containing a trashed file remains nonempty until purge.

Purge first changes the row to `PURGING`. If object deletion or database finalization fails, the row remains unavailable to readers and a reconciler retries at startup and every 10 minutes. It handles up to 100 oldest candidates per run, isolates per-file failures, and moves failed attempts behind other candidates. Files past `purgeAfter` are claimed and purged by the same reconciler. A repeated client DELETE while the row is `PURGING` returns `404`; the server continues recovery independently.

## Rollout and rollback

Apply migration `20261120170000_file_trash` before deploying these endpoints. It only adds enum values, nullable timestamps, and an index; existing READY rows retain their state and data. Keep the expanded schema on application rollback. An older application build may not understand `TRASHED` or `PURGING` rows, so deploy a compatibility build if rolling back after users have trashed files. Never drop the new columns or enum values while such rows exist. Back up PostgreSQL and `STORAGE_ROOT` together before changing retention or storage code.
