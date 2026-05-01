-- V013: Add audit_mtc_event_id to operation_logs (Q-ENG-2 Phase 2)
--
-- When the audit-mtc bridge fires (audit.mtc.enabled=true), the CLI emit
-- returns an event_id that we store back on the OpLog row so the UI can
-- render a per-row "待批次关闭" / "已关批" badge by querying
-- `cc audit mtc reconcile-check <event_id>`.
--
-- nullable — old rows + rows from tenants without the bridge enabled
-- carry NULL (UI renders "MTC 未启用" badge).

ALTER TABLE operation_logs
    ADD COLUMN IF NOT EXISTS audit_mtc_event_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_operation_logs_audit_mtc_event_id
    ON operation_logs(audit_mtc_event_id);
