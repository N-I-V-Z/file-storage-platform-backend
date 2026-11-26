CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "actor_type" VARCHAR(16) NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "resource_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_after" TIMESTAMPTZ(6),

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_project_id_occurred_at_id_idx" ON "audit_events"("project_id", "occurred_at" DESC, "id" DESC);
CREATE INDEX "audit_events_purge_after_idx" ON "audit_events"("purge_after");
