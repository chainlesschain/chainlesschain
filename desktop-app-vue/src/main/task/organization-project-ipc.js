"use strict";

const { randomUUID } = require("node:crypto");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const {
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");
const {
  OrganizationProjectApprovalService,
} = require("@chainlesschain/session-core/organization-project-approval-service");
const {
  OrganizationProjectProposalStore,
} = require("@chainlesschain/session-core/organization-project-proposal-store");
const {
  OrganizationProjectTransferService,
} = require("@chainlesschain/session-core/organization-project-transfer-service");
const {
  OrganizationTaskDescriptionActionService,
  OrganizationTaskCreateActionService,
} = require("@chainlesschain/session-core/organization-task-action-service");
const {
  createOrganizationProjectAuthorityHost,
} = require("./organization-project-authority-host");

const CHANNELS = Object.freeze({
  context: "organization-project:context",
  setup: "organization-project:setup",
  previewPolicy: "organization-project:policy-preview",
  attestPolicy: "organization-project:policy-attest",
  configureWorkflow: "organization-project:workflow-configure",
  previewBinding: "organization-project:binding-preview",
  bindProject: "organization-project:binding-bind",
  revokeBinding: "organization-project:binding-revoke",
  listTasks: "organization-project:task-list",
  readTask: "organization-project:task-read",
  previewDescription: "organization-project:description-preview",
  previewCreate: "organization-project:create-preview",
  submitProposal: "organization-project:proposal-submit",
  listProposals: "organization-project:proposal-list",
  readProposal: "organization-project:proposal-read",
  respondProposal: "organization-project:proposal-respond",
  cancelProposal: "organization-project:proposal-cancel",
  executeProposal: "organization-project:proposal-execute",
  getRun: "organization-project:action-run",
  listRuns: "organization-project:action-runs",
  transferCatalog: "organization-project:transfer-catalog",
  previewTransfer: "organization-project:transfer-preview",
  submitTransfer: "organization-project:transfer-submit",
  readTransfer: "organization-project:transfer-read",
  listTransfers: "organization-project:transfer-list",
  acceptTransfer: "organization-project:transfer-accept",
  cancelTransfer: "organization-project:transfer-cancel",
  rejectTransfer: "organization-project:transfer-reject",
});
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function input(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("ORG_AUTH_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("ORG_AUTH_INVALID_REQUEST");
  return structuredClone(value);
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("ORG_AUTH_INVALID_REQUEST");
  return value;
}
function display(value) {
  return JSON.stringify(value).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function createOrganizationProjectHost({
  database,
  electron = null,
  clock = Date.now,
  ...dependencies
} = {}) {
  const getElectron = () => electron || require("electron");
  const ownerHost = createOrganizationProjectAuthorityHost({
    ...dependencies,
    database,
    electron,
    clock,
  });
  function factory(event) {
    const authority = ownerHost.createAuthority(event),
      { db, getActor } = authority;
    const approvals = new OrganizationProjectApprovalService({
      db,
      getActor,
      authority,
      now: clock,
    });
    const proposals = new OrganizationProjectProposalStore({
      db,
      getActor,
      authority,
      approvals,
      now: clock,
    });
    const transfers = new OrganizationProjectTransferService({
      db,
      getActor,
      authority,
      now: clock,
    });
    async function confirm(title, message, details) {
      const actor = getActor();
      const parent = getElectron().BrowserWindow.fromWebContents(event.sender);
      const result = await getElectron().dialog.showMessageBox(parent, {
        type: "question",
        title,
        message,
        detail: [`当前身份：${display(actor)}`, ...details].join("\n\n"),
        buttons: ["取消", "确认"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (getActor() !== actor) fail("ORG_AUTH_IDENTITY_CHANGED");
      return result?.response === 1;
    }
    function action(create = false, approvalId = null, proposalId = null) {
      const gate = new ApprovalGate({
        confirm: async ({ request, before, after }) =>
          confirm(
            create ? "确认执行已批准的任务创建" : "确认执行已批准的描述修改",
            create
              ? "保存以下待处理任务？保存后不会自动执行。"
              : "按已批准的提议修改任务描述？",
            [
              `项目/任务：${display(request.target.id)}`,
              `修改前：${display(before.description)}`,
              `修改后：${display(after.description)}`,
              ...(create ? [`任务类型：${display(after.taskType)}`] : []),
              `操作摘要：${request.actionDigest}`,
            ],
          ),
      });
      const Service = create
        ? OrganizationTaskCreateActionService
        : OrganizationTaskDescriptionActionService;
      return new Service({
        db,
        getActor,
        authority,
        approvals,
        approvalId,
        now: clock,
        approvalGate: Object.freeze({
          decide: (context) =>
            gate.decide({ ...context, policy: "strict", riskLevel: "high" }),
        }),
        proposalGuard:
          proposalId === null
            ? null
            : ({ request }) => {
                const proposal = proposals.getInTransaction({ proposalId });
                if (!proposal.bodyAvailable || !proposal.request)
                  fail("ORG_PROPOSAL_BODY_UNAVAILABLE");
                if (
                  proposal.requestDigest !== digest(request) ||
                  proposal.approvalId !== approvalId
                )
                  fail("ORG_PROPOSAL_BINDING_MISMATCH");
                return true;
              },
      });
    }
    // All tables/fences exist before a preview captures its schema revision.
    const descriptions = action(),
      creation = action(true);
    return {
      authority,
      db,
      getActor,
      approvals,
      proposals,
      transfers,
      descriptions,
      creation,
      action,
      confirm,
    };
  }
  function columns(db, table) {
    return new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );
  }
  function label(db, table, name = "name") {
    return columns(db, table).has(name) ? `substr(${name},1,128)` : "NULL";
  }
  function setup(c, params) {
    return c.db
      .transaction(() => {
        const actor = c.getActor(),
          source = c.authority._owner(id(params.orgId), actor);
        // Organization owners configure only their own directory and policy.
        // An unbound project ID is a caller-supplied hint, not personal data.
        const p = { id: id(params.projectId) };
        const binding = c.db
          .prepare(
            "SELECT * FROM cc_organization_project_bindings WHERE project_id=?",
          )
          .get(p.id);
        if (binding && binding.org_id !== params.orgId)
          fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
        const members = c.db
          .prepare(
            `SELECT member_did AS did,role,status,${label(c.db, "organization_members", "display_name")} AS name FROM organization_members WHERE org_id=? ORDER BY member_did LIMIT 1001`,
          )
          .all(params.orgId);
        if (members.length > 1000) fail("ORG_AUTH_SOURCE_INVALID");
        const targets = c.db
          .prepare(
            `SELECT id,${label(c.db, "organization_projects")} AS name FROM organization_projects WHERE org_id=? ORDER BY id LIMIT 101`,
          )
          .all(params.orgId);
        const workflows = c.db
          .prepare(
            "SELECT * FROM approval_workflows WHERE org_id=? AND trigger_action IN ('task.create','task.update-description') ORDER BY id LIMIT 21",
          )
          .all(params.orgId);
        if (targets.length > 100 || workflows.length > 20)
          fail("ORG_AUTH_SOURCE_INVALID");
        const stored = c.db
          .prepare(
            "SELECT policy_json,policy_digest FROM cc_organization_project_policies WHERE org_id=?",
          )
          .get(params.orgId);
        let policy = null,
          policyState = "missing";
        if (stored) {
          if (
            typeof stored.policy_json !== "string" ||
            Buffer.byteLength(stored.policy_json) > 65536
          )
            fail("ORG_AUTH_POLICY_CORRUPT");
          try {
            policy = JSON.parse(stored.policy_json);
            if (digest(policy) !== stored.policy_digest)
              fail("ORG_AUTH_POLICY_CORRUPT");
          } catch {
            fail("ORG_AUTH_POLICY_CORRUPT");
          }
          try {
            c.authority._policy(params.orgId);
            policyState = "current";
          } catch (error) {
            if (
              !/^(ORG_AUTH_POLICY_STALE|ORG_AUTH_NOT_FOUND_OR_DENIED)$/u.test(
                error.code || "",
              )
            )
              throw error;
            policyState = "stale";
          }
        }
        return {
          actorDid: actor,
          projectId: p.id,
          orgId: params.orgId,
          members,
          organizationProjects: targets,
          workflows: workflows.map((w) => ({
            id: w.id,
            name: w.name,
            actionType: w.trigger_action,
            approvalType: w.approval_type,
            steps: JSON.parse(w.approvers),
            timeoutHours: w.timeout_hours,
            enabled: w.enabled === 1,
          })),
          policy,
          policyState,
          sourceDigest: digest(source),
          binding: binding ?? null,
        };
      })
      .immediate();
  }
  function context(c, params) {
    return c.db
      .transaction(() => {
        const actor = c.getActor(),
          p = { id: id(params.projectId) };
        const binding = c.db
          .prepare(
            "SELECT * FROM cc_organization_project_bindings WHERE project_id=?",
          )
          .get(p.id);
        let canManage = false,
          permissions = [],
          workflows = [];
        if (binding) {
          try {
            c.authority._owner(binding.org_id, actor);
            canManage = true;
          } catch (error) {
            if (error.code !== "ORG_AUTH_NOT_FOUND_OR_DENIED") throw error;
          }
          let reason = null;
          try {
            const auth = c.authority.assertAuthorizedInTransaction({
              projectId: p.id,
              actorDid: actor,
              permission: "task.read",
            });
            const policy = c.authority._policy(auth.scope.id).policy;
            permissions =
              policy.permissions.find(
                (grant) => grant.actorDid === actor && grant.projectId === p.id,
              )?.permissions ?? [];
            workflows = policy.workflows
              .map((pin) =>
                c.db
                  .prepare(
                    "SELECT id,name,trigger_action FROM approval_workflows WHERE id=?",
                  )
                  .get(pin.workflowId),
              )
              .filter(Boolean)
              .map((w) => ({
                id: w.id,
                name: w.name,
                actionType: w.trigger_action,
              }));
          } catch (error) {
            if (!canManage) throw error;
            reason = error.code;
          }
          return {
            actorDid: actor,
            projectId: p.id,
            mode: "organization",
            binding: {
              orgId: binding.org_id,
              organizationProjectId: binding.organization_project_id,
              status: binding.status,
              revision: binding.revision,
            },
            canManage,
            permissions,
            workflows,
            reason,
            ownedOrganizations: [],
          };
        }
        const organizations = c.db
          .prepare(
            `SELECT o.org_id AS id,${columns(c.db, "organization_info").has("name") ? "substr(o.name,1,128)" : "NULL"} AS name FROM organization_info o JOIN organization_members m ON m.org_id=o.org_id AND m.member_did=o.owner_did WHERE o.owner_did=? AND m.status='active' AND m.role='owner' ORDER BY o.org_id LIMIT 101`,
          )
          .all(actor);
        if (organizations.length > 100) fail("ORG_AUTH_SOURCE_INVALID");
        const fields = columns(c.db, "projects");
        const isProjectOwner = !!c.db
          .prepare(
            `SELECT 1 FROM projects WHERE id=? AND user_id=?${fields.has("deleted") ? " AND (deleted IS NULL OR deleted=0)" : ""}`,
          )
          .get(p.id, actor);
        if (!isProjectOwner && !organizations.length)
          fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
        return {
          actorDid: actor,
          projectId: p.id,
          mode: "unbound",
          binding: null,
          canManage: organizations.length > 0,
          permissions: [],
          workflows: [],
          ownedOrganizations: organizations,
          isProjectOwner,
        };
      })
      .immediate();
  }
  return Object.freeze({
    transferCatalog: (event, params) => {
      const value = input(params, ["projectId"]),
        c = factory(event);
      return c.db
        .transaction(() => {
          const actor = c.getActor(),
            fields = columns(c.db, "projects");
          const personal = c.db
            .prepare(
              `SELECT 1 FROM projects WHERE id=? AND user_id=?${fields.has("deleted") ? " AND (deleted IS NULL OR deleted=0)" : ""}`,
            )
            .get(id(value.projectId), actor);
          const bound = c.db
            .prepare(
              "SELECT 1 FROM cc_organization_project_bindings WHERE project_id=?",
            )
            .get(value.projectId);
          if (!personal || bound)
            return { canInitiate: false, organizations: [] };
          const organizations = c.db
            .prepare(
              `SELECT o.org_id AS id,o.owner_did AS ownerDid,${columns(c.db, "organization_info").has("name") ? "substr(o.name,1,128)" : "NULL"} AS name FROM organization_info o JOIN organization_members m ON m.org_id=o.org_id AND m.member_did=? JOIN organization_members owner ON owner.org_id=o.org_id AND owner.member_did=o.owner_did AND owner.role='owner' AND owner.status='active' WHERE m.status='active' AND o.owner_did<>? ORDER BY o.org_id LIMIT 101`,
            )
            .all(actor, actor);
          if (organizations.length > 100) fail("ORG_AUTH_SOURCE_INVALID");
          for (const org of organizations) {
            c.authority._source(org.id);
            org.projects = c.db
              .prepare(
                `SELECT id,${label(c.db, "organization_projects")} AS name FROM organization_projects WHERE org_id=? ORDER BY id LIMIT 101`,
              )
              .all(org.id);
            if (org.projects.length > 100) fail("ORG_AUTH_SOURCE_INVALID");
          }
          return { canInitiate: organizations.length > 0, organizations };
        })
        .immediate();
    },
    previewTransfer: (event, params) =>
      factory(event).transfers.preview(params),
    submitTransfer: (event, params) => factory(event).transfers.submit(params),
    readTransfer: (event, params) => factory(event).transfers.get(params),
    listTransfers: (event, params) => factory(event).transfers.list(params),
    acceptTransfer: (event, params) => factory(event).transfers.accept(params),
    cancelTransfer: (event, params) => factory(event).transfers.cancel(params),
    rejectTransfer: (event, params) => factory(event).transfers.reject(params),
    context: (event, params) =>
      context(factory(event), input(params, ["projectId"])),
    setup: (event, params) =>
      setup(factory(event), input(params, ["projectId", "orgId"])),
    previewPolicy: (event, params) => {
      const c = factory(event);
      return c.authority.previewPolicy(params);
    },
    attestPolicy: (event, params) => {
      const c = factory(event);
      return c.authority.attestPolicy(params);
    },
    previewBinding: (event, params) => {
      const c = factory(event);
      return c.authority.previewBinding(params);
    },
    bindProject: (event, params) => {
      const c = factory(event);
      return c.authority.bindProject(params);
    },
    revokeBinding: (event, params) => {
      const c = factory(event);
      return c.authority.revokeBinding(params);
    },
    async configureWorkflow(event, params) {
      const value = input(params, [
          "orgId",
          "actionType",
          "name",
          "steps",
          "approvalType",
          "timeoutHours",
          "expectedSourceDigest",
        ]),
        c = factory(event);
      const before = () =>
        c.db
          .transaction(() => {
            const source = c.authority._owner(id(value.orgId), c.getActor());
            if (digest(source) !== value.expectedSourceDigest)
              fail("ORG_AUTH_VERSION_CONFLICT");
            const workflowCount = c.db
              .prepare(
                "SELECT count(*) AS n FROM (SELECT 1 FROM approval_workflows WHERE org_id=? AND trigger_action IN ('task.create','task.update-description') LIMIT 20)",
              )
              .get(value.orgId).n;
            if (workflowCount >= 20) fail("ORG_AUTH_SOURCE_INVALID");
            if (
              !["task.create", "task.update-description"].includes(
                value.actionType,
              ) ||
              typeof value.name !== "string" ||
              !value.name.trim() ||
              value.name.length > 80 ||
              !["sequential", "parallel", "any_one"].includes(
                value.approvalType,
              ) ||
              !Number.isSafeInteger(value.timeoutHours) ||
              value.timeoutHours < 1 ||
              value.timeoutHours > 168 ||
              !Array.isArray(value.steps) ||
              !value.steps.length ||
              value.steps.length > 32
            )
              fail("ORG_APPROVAL_INVALID_PLAN");
            for (const step of value.steps) {
              if (
                !Array.isArray(step) ||
                !step.length ||
                step.length > 32 ||
                new Set(step).size !== step.length
              )
                fail("ORG_APPROVAL_INVALID_PLAN");
              for (const did of step) {
                id(did);
                if (
                  !source.members.some(
                    (member) =>
                      member.member_did === did && member.status === "active",
                  )
                )
                  fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
              }
            }
            return c.getActor();
          })
          .immediate();
      const actor = before();
      if (
        !(await c.confirm(
          "确认组织审批计划",
          "保存以下审批计划？权限需在保存后重新确认。",
          [
            `名称：${display(value.name)}`,
            `操作：${display(value.actionType)}`,
            `审批步骤：${display(value.steps)}`,
            `审批方式：${display(value.approvalType)}`,
            `有效时长：${value.timeoutHours} 小时`,
          ],
        ))
      )
        return { status: "cancelled" };
      return c.db
        .transaction(() => {
          if (c.getActor() !== actor) fail("ORG_AUTH_IDENTITY_CHANGED");
          const source = c.authority._owner(value.orgId, actor);
          if (digest(source) !== value.expectedSourceDigest)
            fail("ORG_AUTH_VERSION_CONFLICT");
          const workflowId = randomUUID(),
            at = clock();
          c.db
            .prepare(
              "INSERT INTO approval_workflows(id,org_id,name,trigger_resource_type,trigger_action,approval_type,approvers,timeout_hours,on_timeout,enabled,created_at,updated_at) VALUES(?,?,?,'task',?,?,?,?,'reject',1,?,?)",
            )
            .run(
              workflowId,
              value.orgId,
              value.name,
              value.actionType,
              value.approvalType,
              JSON.stringify(value.steps),
              value.timeoutHours,
              at,
              at,
            );
          return { status: "configured", workflowId };
        })
        .immediate();
    },
    listTasks: (event, params) => factory(event).descriptions.listTasks(params),
    readTask: (event, params) => {
      const value = input(params, ["taskId"]);
      return factory(event).descriptions.readTask(value.taskId);
    },
    previewDescription: (event, params) => {
      const result = factory(event).descriptions.preview(params);
      return { ...result, requestDigest: digest(result.request) };
    },
    previewCreate: (event, params) => {
      const result = factory(event).creation.preview(params);
      return { ...result, requestDigest: digest(result.request) };
    },
    submitProposal: (event, params) => factory(event).proposals.submit(params),
    listProposals: (event, params) => factory(event).proposals.list(params),
    readProposal: (event, params) => {
      const c = factory(event);
      return c.db
        .transaction(() => {
          const proposal = c.proposals.getInTransaction(params),
            actor = c.getActor();
          const actionRunId =
            proposal.requesterDid === actor
              ? (c.db
                  .prepare(
                    "SELECT id FROM cc_business_action_runs WHERE actor_did=? AND invocation_digest=?",
                  )
                  .get(actor, proposal.invocationDigest)?.id ?? null)
              : null;
          const result = {
            ...proposal,
            actionRunId,
            canRespond: false,
            canExecute: false,
            canCancel:
              proposal.requesterDid === actor &&
              ["pending", "approved"].includes(proposal.approvalStatus),
            eligibilityReason: null,
          };
          if (!proposal.bodyAvailable || !proposal.request) return result;
          const known = (error) => {
            if (
              !/^(ORG_AUTH_(NOT_FOUND_OR_DENIED|POLICY_STALE|VERSION_CONFLICT|SCOPE_CONFLICT)|ORG_APPROVAL_(AUTHORITY_CHANGED|WORKFLOW_CHANGED|VERSION_CONFLICT|EXPIRED|NOT_PENDING|NOT_APPROVED|NOT_FOUND_OR_DENIED|ALREADY_RESPONDED|STEP_CONFLICT|ALREADY_CONSUMED))$/u.test(
                error.code || "",
              )
            )
              throw error;
            result.eligibilityReason = error.code;
          };
          if (
            proposal.approvalStatus === "pending" &&
            proposal.approval.plan.steps[proposal.currentStep]?.includes(actor)
          ) {
            try {
              c.approvals.verifyDecisionInTransaction({
                approvalId: proposal.approvalId,
                step: proposal.currentStep,
                decision: "approve",
              });
              result.canRespond = true;
            } catch (error) {
              known(error);
            }
          }
          if (
            proposal.approvalStatus === "approved" &&
            !actionRunId &&
            proposal.requesterDid === actor
          ) {
            try {
              c.approvals.verifyApprovedInTransaction({
                approvalId: proposal.approvalId,
                request: proposal.request,
                projectId: proposal.projectId,
                actorDid: actor,
              });
              result.canExecute = true;
            } catch (error) {
              known(error);
            }
          }
          return result;
        })
        .immediate();
    },
    async respondProposal(event, params) {
      const value = input(params, ["proposalId", "step", "decision"]),
        c = factory(event);
      const proposal = c.proposals.get({ proposalId: value.proposalId });
      if (!proposal.bodyAvailable || !proposal.request)
        fail("ORG_PROPOSAL_BODY_UNAVAILABLE");
      const response = {
        approvalId: proposal.approvalId,
        step: value.step,
        decision: value.decision,
      };
      c.db
        .transaction(() => c.approvals.verifyDecisionInTransaction(response))
        .immediate();
      const before =
        proposal.request.target.type === "Task"
          ? c.descriptions.readTask(proposal.request.target.id).description
          : "";
      if (
        !(await c.confirm(
          "确认组织任务审批",
          value.decision === "approve"
            ? "批准以下提议？批准后仍需请求者确认执行。"
            : "拒绝以下提议？",
          [
            `修改前：${display(before)}`,
            `提议内容：${display(proposal.request.input)}`,
            `目标：${display(proposal.request.target.id)}`,
            `操作摘要：${proposal.request.actionDigest}`,
            `审批步骤：${value.step + 1}`,
          ],
        ))
      )
        return { status: "cancelled-confirmation" };
      return c.db
        .transaction(() => {
          const current = c.proposals.getInTransaction({
            proposalId: value.proposalId,
          });
          if (
            !current.bodyAvailable ||
            current.requestDigest !== proposal.requestDigest
          )
            fail("ORG_PROPOSAL_BODY_UNAVAILABLE");
          if (current.approvalId !== proposal.approvalId)
            fail("ORG_PROPOSAL_BINDING_MISMATCH");
          const result = c.approvals.respondInTransaction(response);
          if (
            value.decision === "approve" &&
            !c.proposals.getInTransaction({ proposalId: value.proposalId })
              .bodyAvailable
          )
            fail("ORG_PROPOSAL_BODY_UNAVAILABLE");
          return result;
        })
        .immediate();
    },
    async cancelProposal(event, params) {
      const value = input(params, ["proposalId"]),
        c = factory(event),
        proposal = c.proposals.get(value);
      if (proposal.requesterDid !== c.getActor())
        fail("ORG_APPROVAL_NOT_FOUND_OR_DENIED");
      if (
        !(await c.confirm(
          "取消任务提议",
          "取消此提议？已保存任务不会因此改变。",
          [`提议：${display(value.proposalId)}`],
        ))
      )
        return { status: "cancelled-confirmation" };
      return c.approvals.cancel({ approvalId: proposal.approvalId });
    },
    executeProposal(event, params) {
      const value = input(params, ["proposalId"]),
        c = factory(event),
        proposal = c.proposals.get(value);
      if (!proposal.bodyAvailable || !proposal.request)
        fail("ORG_PROPOSAL_BODY_UNAVAILABLE");
      if (proposal.requesterDid !== c.getActor())
        fail("ORG_APPROVAL_NOT_FOUND_OR_DENIED");
      return c
        .action(
          proposal.request.actionType === "task.create",
          proposal.approvalId,
          value.proposalId,
        )
        .execute(proposal.request);
    },
    getRun: (event, params) => {
      const value = input(params, ["runId"]);
      return factory(event).descriptions.getRun(value.runId);
    },
    listRuns: (event, params) => {
      const value = input(
          params,
          [],
          ["projectId", "taskId", "beforeId", "limit"],
        ),
        c = factory(event);
      if (value.taskId !== undefined && value.projectId === undefined)
        return c.descriptions.listRuns(value);
      if (value.projectId !== undefined && value.taskId === undefined)
        return c.creation.listProjectRuns(value);
      fail("ORG_AUTH_INVALID_REQUEST");
    },
  });
}
function registerOrganizationProjectIPC(database, dependencies = {}) {
  const electron = dependencies.electron || require("electron");
  const host = createOrganizationProjectHost({
    ...dependencies,
    database,
    electron,
  });
  for (const [method, channel] of Object.entries(CHANNELS))
    electron.ipcMain.handle(channel, (event, params) =>
      host[method](event, params),
    );
  return host;
}
module.exports = {
  CHANNELS,
  createOrganizationProjectHost,
  registerOrganizationProjectIPC,
};
