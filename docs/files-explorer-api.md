# Private file explorer API

All endpoints use `/api/v1`, require the project owner's bearer JWT, and return the standard JSON success/error envelope. A foreign project returns `404`. Explorer metadata is private (`Cache-Control: private, no-store`); responses never contain storage keys or filesystem paths. API keys remain limited to streaming upload/download; they cannot browse folders or file metadata.

## List files

`GET /projects/:projectId/files` returns only `READY` files. Query parameters:

| Parameter | Default | Accepted values |
| --- | --- | --- |
| `page` | `1` | integer 1–1,000,000 |
| `pageSize` | `20` | integer 1–100 |
| `search` | none | case-insensitive filename substring, at most 120 characters |
| `contentType` | none | `image/png`, `image/jpeg`, `image/webp`, `application/pdf`, `video/mp4`, `application/zip` |
| `sort` | `newest` | `newest`, `oldest`, `name-asc`, `name-desc`, `size-asc`, `size-desc` |
| `folderId` | none | UUID for one folder; `root` for unfiled files; omitted for all files |

The `data` object has `items`, `page`, `pageSize`, and `total`. Each item has `id`, `projectId`, nullable `folderId`, `originalName`, `contentType`, `sizeBytes` as a decimal string, `sha256`, `status: "ready"`, and `createdAt`. Sort ties use file ID, so pages are deterministic for an unchanged dataset. Offset pagination can shift if files are added between requests; refresh page 1 after uploads.

## Manage flat folders

- `POST /projects/:projectId/folders` with `{ "name": "Media" }` creates a folder (`201`).
- `GET /projects/:projectId/folders` lists folders by name.
- `PATCH /projects/:projectId/folders/:id` with `{ "name": "Assets" }` renames one folder.
- `DELETE /projects/:projectId/folders/:id` removes an empty folder (`204`).

Names are trimmed, 1–120 characters, and cannot be `.`/`..` or contain path separators/control characters. Sibling names are unique without regard to case (`409` for a duplicate). Folder IDs are project scoped. A folder containing any file record cannot be deleted (`409`). Folders are metadata only; they do not alter object paths. Nested folders and file moves are outside this phase.

## Upload into a folder

The existing `POST /projects/:projectId/files` accepts optional `X-Folder-Id: <uuid>`. Omit it to upload to the project root. The folder must belong to the same project; malformed IDs return `400`, missing or foreign folders return `404`. Success metadata includes nullable `folderId`. The file remains private and follows the existing streaming, quota, and cleanup rules. The one-file multipart contract is unchanged.

## Migration and rollback

Deploy migration `20261120110000_folders` before the new API. It adds a `folders` table and nullable `stored_files.folder_id`, leaving existing files at the project root. A composite foreign key prevents associating a file with a folder from another project. The old API can run against the expanded schema during rollout. To roll back application behavior, deploy the previous API version; keep the expanded schema because dropping it after folder use would destroy user metadata. Back up PostgreSQL before any later schema contraction.
