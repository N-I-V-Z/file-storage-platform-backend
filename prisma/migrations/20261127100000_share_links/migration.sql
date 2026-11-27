CREATE TABLE "share_links" (
  "id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");
CREATE INDEX "share_links_file_id_created_at_idx" ON "share_links"("file_id", "created_at" DESC);
CREATE INDEX "share_links_expires_at_idx" ON "share_links"("expires_at");
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
