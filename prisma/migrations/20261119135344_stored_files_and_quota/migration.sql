-- CreateEnum
CREATE TYPE "StoredFileStatus" AS ENUM ('UPLOADING', 'ABANDONED', 'READY');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "quota_bytes" BIGINT NOT NULL DEFAULT 10737418240,
ADD COLUMN     "reserved_bytes" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "used_bytes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "storage_key" UUID NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "status" "StoredFileStatus" NOT NULL DEFAULT 'UPLOADING',
    "reservation_bytes" BIGINT NOT NULL,
    "size_bytes" BIGINT,
    "sha256" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_project_id_status_idx" ON "stored_files"("project_id", "status");

-- CreateIndex
CREATE INDEX "stored_files_status_expires_at_idx" ON "stored_files"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
