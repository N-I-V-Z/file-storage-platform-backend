import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { API_KEY_SCOPES, ApiKeyScope } from '../api-key-scopes.js';

export class CreateApiKeyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes: ApiKeyScope[];

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}
