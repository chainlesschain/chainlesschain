export interface ControlledTaskSummary {
  id: string;
  taskType: string;
  status: string;
  descriptionPreview: string;
  updatedAt: number;
}

export interface ControlledTask {
  taskId: string;
  projectId: string;
  status: string;
  description: string;
  editable: boolean;
  reason: string | null;
}

export interface DescriptionPreview {
  request: { invocationDigest: string; [key: string]: unknown };
  before: { description: string };
  after: { description: string };
}

export interface ActionReceipt {
  run: {
    id: string;
    status: string;
    invocationDigest: string;
    startedAt: string;
    completedAt: string | null;
  };
  evidence: unknown[];
  replayed?: boolean;
  executionState?: string;
}

export interface RiskReview {
  review: { id: string; projectId: string; createdAt: string };
  evaluation: {
    status: string;
    asOf: string | null;
    summary: { taskCount: number; riskTaskCount: number } | null;
    reasonCodes: string[];
    tasks: Array<{ taskRef: { id: string }; reasonCodes: string[] }>;
  };
}

export interface TaskDescriptionApi {
  listControlledTasks(input: {
    projectId: string;
    afterId?: string;
    limit?: number;
  }): Promise<{
    project: { id: string; status: string };
    tasks: ControlledTaskSummary[];
    nextCursor: string | null;
  }>;
  readControlledTask(input: { taskId: string }): Promise<ControlledTask>;
  listDescriptionActionRuns(input: {
    taskId: string;
    beforeId?: string;
    limit?: number;
  }): Promise<{
    runs: ActionReceipt[];
    nextCursor: string | null;
  }>;
  previewDescriptionUpdate(input: {
    taskId: string;
    description: string;
    idempotencyKey: string;
    reviewId?: string;
  }): Promise<DescriptionPreview>;
  executeDescriptionUpdate(input: {
    request: DescriptionPreview["request"];
  }): Promise<ActionReceipt>;
}

export function actionCode(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (
    typeof candidate?.code === "string" &&
    /^(ACTION|BUSINESS_ACTION|PROJECT_RISK|GOAL|ORG_AUTH|ORG_APPROVAL|ORG_PROPOSAL)_[A-Z_]+$/.test(
      candidate.code,
    )
  )
    return candidate.code;
  // Electron serializes errors without custom .code, retaining the fixed code
  // within its invocation error message. Never surface arbitrary raw messages.
  return typeof candidate?.message === "string"
    ? candidate.message.match(
        /\b(?:ACTION|BUSINESS_ACTION|PROJECT_RISK|GOAL|ORG_AUTH|ORG_APPROVAL|ORG_PROPOSAL)_[A-Z_]+\b/,
      )?.[0] || ""
    : "";
}

export function isAuthorityError(error: unknown): boolean {
  return /NOT_FOUND_OR_DENIED|AUTHENTIC|AUTHORITY|IDENTITY|UNTRUSTED|ORGANIZATION|WINDOW_UNAVAILABLE/.test(
    actionCode(error),
  );
}

export function isDefiniteActionRejection(error: unknown): boolean {
  return new Set([
    "ACTION_VERSION_CONFLICT",
    "ACTION_TARGET_NOT_EDITABLE",
    "ACTION_INVALID_REQUEST",
    "ACTION_INVALID_ID",
    "ACTION_INVALID_DESCRIPTION",
    "ACTION_UNSUPPORTED_REQUEST",
    "ACTION_IDEMPOTENCY_CONFLICT",
    "ACTION_SOURCE_INVALID",
    "ACTION_NOT_FOUND_OR_DENIED",
    "ACTION_ORGANIZATION_UNSUPPORTED",
    "ACTION_AUTHORITY_CHANGED",
    "ACTION_AUTHENTICATION_REQUIRED",
    "ACTION_INVALID_TASK_TYPE",
    "PROJECT_RISK_REVIEW_STALE",
    "PROJECT_RISK_REVIEW_CONFLICT",
    "PROJECT_RISK_ACTION_SOURCE_INVALID",
    "PROJECT_RISK_NOT_FOUND_OR_DENIED",
    "PROJECT_RISK_ORGANIZATION_UNSUPPORTED",
    "PROJECT_RISK_AUTHENTICATION_REQUIRED",
  ]).has(actionCode(error));
}

export function taskRestriction(reason: string | null | undefined): string {
  switch (reason) {
    case "ACTION_UNRESOLVED_ACTION":
      return "此前修改结果待核实，暂不能开始新的修改。请刷新修改记录。";
    case "ACTION_DESCRIPTION_TOO_LARGE":
      return "任务描述超出当前可编辑范围，仅显示摘要。";
    case "ACTION_SOURCE_INVALID":
      return "任务数据暂不满足编辑条件。";
    case "ACTION_TARGET_NOT_EDITABLE":
      return "仅待处理任务且项目处于草稿或进行中时可修改描述。";
    case "ACTION_SOURCE_CHANGED":
      return "本次修改未执行，请刷新修改记录和任务内容后重新预览。";
    default:
      return "当前任务不能修改描述。";
  }
}

export function runLabel(status: string): string {
  return (
    (
      {
        succeeded: "修改已完成",
        cancelled: "用户已取消",
        denied: "修改被拒绝",
        failed: "修改未完成",
      } as Record<string, string>
    )[status] || "结果待核实"
  );
}

export function unresolved(receipt: ActionReceipt): boolean {
  return !["succeeded", "cancelled", "denied", "failed"].includes(
    receipt.run.status,
  );
}

export function taskStatus(status: string): string {
  return (
    (
      {
        pending: "待处理",
        running: "执行中",
        completed: "已完成",
        failed: "失败",
      } as Record<string, string>
    )[status] || "未知状态"
  );
}

export function riskReason(reason: string): string {
  return (
    (
      {
        OVERDUE_INCOMPLETE_TASK: "已逾期且未完成",
        BLOCKED_BY_INCOMPLETE_DEPENDENCY: "前置任务尚未完成",
      } as Record<string, string>
    )[reason] || "数据不足或规则不适用"
  );
}
