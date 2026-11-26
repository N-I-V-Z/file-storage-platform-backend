# Read-only administration

All `/api/v1/admin/*` endpoints require a Bearer access token for a user whose **current database role** is `ADMIN`. Anonymous and API key requests return `401`; signed-in `USER` accounts return `403`. The role is loaded from the user's session on each request, so demotion blocks an existing token immediately. Every response uses the standard API envelope and `Cache-Control: private, no-store`.

| Endpoint | Data |
| --- | --- |
| `GET /admin/overview` | `userCount`, `projectCount`, READY `fileCount`, and decimal-string `quotaBytes`, `usedBytes`, `reservedBytes` across projects. Used bytes still include trash until purge. |
| `GET /admin/projects?page=1&pageSize=20` | Newest projects, owner ID, project name, quota balances and creation time. |
| `GET /admin/audit-events?page=1&pageSize=20&projectId=<uuid>` | Minimal audit events across projects, including deleted projects still inside their retention window. The project filter is optional. |

List page numbers start at 1 and page sizes are 1–100. Invalid values return `400`. Items are ordered by creation/event time descending with UUID as a stable tie-breaker. These reports contain no password hash, API key secret/hash, file name, storage key, or filesystem path. They offer no mutation routes.

## Granting or revoking the first admin

Registration always creates a `USER`. There is no self-promotion endpoint or email-based automatic grant. A trusted database operator must verify the intended account's identity, find its UUID by email, and change that exact row during a controlled maintenance session:

```sql
SELECT id, email, role FROM users WHERE email = '<verified-email>';
UPDATE users SET role = 'ADMIN' WHERE id = '<verified-user-uuid>' AND role = 'USER';
```

Confirm that exactly one row changed. To revoke access, update the same UUID from `ADMIN` to `USER`; existing sessions then lose admin access immediately. Do not put credentials or account details in Git history. Deploy the additive role migration before deploying the admin API. Rolling back application code leaves role values intact; do not drop the column in a routine rollback.
