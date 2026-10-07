import { actionCode } from "./task-description-ui";
export type OrganizationContext = {
  actorDid: string;
  projectId: string;
  mode: "unbound" | "organization";
  canManage: boolean;
  isProjectOwner?: boolean;
  permissions: string[];
  reason?: string | null;
  binding: null | {
    orgId: string;
    organizationProjectId: string;
    status: string;
    revision: number;
  };
  ownedOrganizations: Array<{ id: string; name: string | null }>;
  workflows: Array<{ id: string; name: string; actionType: string }>;
};
export type OrganizationProposal = {
  proposalId: string;
  projectId: string;
  requesterDid: string;
  approvalId: string;
  requestDigest: string;
  target: { id: string; type: string };
  createdAt: number;
  expiresAt: number;
  approvalStatus: string;
  currentStep: number;
  bodyAvailable: boolean;
  unavailableReason?: string | null;
  request?: any;
  approval?: {
    plan: { type: string; steps: string[][] };
    consumedRunId: string | null;
  };
  canExecute?: boolean;
  canRespond?: boolean;
  canCancel?: boolean;
  eligibilityReason?: string | null;
  actionRunId?: string | null;
};
export type OrganizationApi = Record<string, (input: any) => Promise<any>>;
export function organizationApi(): OrganizationApi {
  const api = (window as any).electronAPI?.organizationProject;
  if (!api) throw new Error("ORG_API_UNAVAILABLE");
  return api;
}
export function organizationAuthorityError(value: unknown) {
  return /^(ORG_AUTH_(IDENTITY_|NOT_FOUND_OR_DENIED|POLICY_(STALE|REQUIRED|CORRUPT)|SCOPE_CONFLICT|SOURCE_(INVALID|INCOMPLETE)|AUTHORITY_REQUIRED|NATIVE_DATABASE_REQUIRED|CLOCK_INVALID|WINDOW_|UNTRUSTED_|DATABASE_)|ORG_(PROPOSAL|APPROVAL|TRANSFER)_(NOT_FOUND_OR_DENIED|IDENTITY_)|ACTION_(AUTHORITY_|AUTHENTICATION_|NOT_FOUND_OR_DENIED))/u.test(
    actionCode(value),
  );
}
export function organizationSessionError(value: unknown) {
  return /^(ORG_AUTH_(IDENTITY_|WINDOW_|UNTRUSTED_|DATABASE_)|ORG_(TRANSFER|APPROVAL|PROPOSAL)_IDENTITY_|ACTION_(AUTHORITY_|AUTHENTICATION_))/u.test(
    actionCode(value),
  );
}
export function organizationError(value: unknown) {
  const code = actionCode(value);
  if (
    /(VERSION_CONFLICT|AUTHORITY_CHANGED|WORKFLOW_CHANGED|POLICY_STALE)/u.test(
      code,
    )
  )
    return "项目或授权已变化。请刷新；旧提议可取消后重新准备。";
  if (/(UNRESOLVED|OUTCOME_UNKNOWN)/u.test(code))
    return "已有待核实操作。请刷新记录，系统不会自动重试。";
  if (/(BODY_UNAVAILABLE|EXPIRED)/u.test(code))
    return "提议已过期或内容已不可用。请查看记录并重新准备提议。";
  if (/(NOT_APPROVED|NOT_PENDING|STEP_CONFLICT|ALREADY_RESPONDED)/u.test(code))
    return "审批状态已变化，请刷新提议。";
  if (organizationAuthorityError(value))
    return "当前身份无法访问此项目，请检查登录与组织授权。";
  if (code === "ORG_API_UNAVAILABLE") return "当前版本未提供组织任务工作区。";
  return "操作未完成，请刷新状态后核对。";
}
export function proposalStatus(value: string) {
  return (
    (
      {
        pending: "等待审批",
        approved: "已批准，等待执行",
        consumed: "已执行",
        rejected: "已拒绝",
        cancelled: "已取消",
        expired: "已过期",
      } as Record<string, string>
    )[value] || "状态待核实"
  );
}
export function timeLabel(value: number) {
  return new Date(value).toLocaleString();
}
