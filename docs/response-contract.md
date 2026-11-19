# HTTP response contract

All versioned JSON endpoints under `/api/v1/` return a common envelope. HTTP status codes remain meaningful; the envelope does not replace them.

```json
{
  "success": true,
  "data": { "id": "..." },
  "timestamp": "2026-11-19T00:00:00.000Z"
}
```

`data` is the endpoint's documented result: an object or array. The response interceptor adds the envelope once, globally; controllers and services return domain data without wrapping it. A future paginated response may also contain `meta` with page information. Current endpoints do not send `meta`.

Errors use the shared exception filter and retain their HTTP status:

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Not Found", "details": [] },
  "path": "/api/v1/projects/00000000-0000-4000-8000-000000000000",
  "timestamp": "2026-11-19T00:00:00.000Z"
}
```

`path` excludes the query string. `error.code` is currently the HTTP status name; domain-specific codes can be added deliberately when a client needs to distinguish cases with the same status. Do not expose internal exception messages for 5xx responses.

`204 No Content` has no JSON body for logout, project deletion, and key revocation. The unversioned `/`, `/health`, and `/ready` probes retain their existing success shapes, and `/api/docs-json` remains the OpenAPI document. `/ready` failures still use the error envelope with service status in `details`. Binary `StreamableFile` responses pass through without a JSON wrapper.

The frontend temporarily accepts both raw success JSON and this envelope while the two repositories are merged. New API clients should consume `data` from the envelope.
