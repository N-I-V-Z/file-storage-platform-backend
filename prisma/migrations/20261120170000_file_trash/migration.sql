ALTER TYPE "StoredFileStatus" ADD VALUE 'TRASHED';
ALTER TYPE "StoredFileStatus" ADD VALUE 'PURGING';

ALTER TABLE "stored_files"
  ADD COLUMN "trashed_at" TIMESTAMPTZ(6),
  ADD COLUMN "purge_after" TIMESTAMPTZ(6);

CREATE INDEX "stored_files_status_purge_after_idx"
  ON "stored_files"("status", "purge_after");
