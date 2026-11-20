import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const FILE_SORTS = [
  'newest',
  'oldest',
  'name-asc',
  'name-desc',
  'size-asc',
  'size-desc',
] as const;

export type FileSort = (typeof FILE_SORTS)[number];

export const FILE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'application/zip',
] as const;

export class FileListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(FILE_CONTENT_TYPES)
  contentType?: (typeof FILE_CONTENT_TYPES)[number];

  @IsOptional()
  @IsIn(FILE_SORTS)
  sort: FileSort = 'newest';
}
