import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class FolderNameDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  // eslint-disable-next-line no-control-regex -- Folder names must reject control characters.
  @Matches(/^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$/)
  name!: string;
}
