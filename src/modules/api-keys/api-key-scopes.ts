export const API_KEY_SCOPES = [
  'projects:read',
  'files:read',
  'files:write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
