-- CreateTable
CREATE TABLE "consumed_refresh_tokens" (
    "session_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumed_refresh_tokens_pkey" PRIMARY KEY ("session_id","token_hash")
);

-- AddForeignKey
ALTER TABLE "consumed_refresh_tokens" ADD CONSTRAINT "consumed_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
