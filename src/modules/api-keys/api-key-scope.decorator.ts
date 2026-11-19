import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from './api-key-scopes.js';

export const API_KEY_SCOPE_METADATA = 'apiKeyScope';

export const RequireApiKeyScope = (scope: ApiKeyScope) =>
  SetMetadata(API_KEY_SCOPE_METADATA, scope);
