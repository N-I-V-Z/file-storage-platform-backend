ALTER TABLE "projects"
  ADD CONSTRAINT "projects_quota_balances_check"
  CHECK (
    "quota_bytes" >= 0
    AND "used_bytes" >= 0
    AND "reserved_bytes" >= 0
    AND "used_bytes" + "reserved_bytes" <= "quota_bytes"
  );

ALTER TABLE "stored_files"
  ADD CONSTRAINT "stored_files_reservation_check"
  CHECK (
    "reservation_bytes" > 0
    AND ("size_bytes" IS NULL OR ("size_bytes" >= 0 AND "size_bytes" <= "reservation_bytes"))
    AND (
      "status" <> 'READY'
      OR ("size_bytes" IS NOT NULL AND "sha256" ~ '^[0-9a-f]{64}$')
    )
  );
