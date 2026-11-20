-- Expand the metadata model; existing files remain at the project root.
CREATE TABLE "folders" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "folders_project_id_id_key" ON "folders"("project_id", "id");
CREATE INDEX "folders_project_id_idx" ON "folders"("project_id");
CREATE UNIQUE INDEX "folders_project_name_ci_key" ON "folders"("project_id", lower("name"));
ALTER TABLE "folders" ADD CONSTRAINT "folders_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stored_files" ADD COLUMN "folder_id" UUID;
CREATE INDEX "stored_files_project_id_folder_id_status_idx"
    ON "stored_files"("project_id", "folder_id", "status");
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_project_id_folder_id_fkey"
    FOREIGN KEY ("project_id", "folder_id") REFERENCES "folders"("project_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
