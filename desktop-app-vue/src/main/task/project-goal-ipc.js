"use strict";

const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const CHANNELS = Object.freeze({
  create: "project:goal-create",
  read: "project:goal-read",
  openCliConnection: "project:goal-cli-connection-open",
  closeCliConnection: "project:goal-cli-connection-close",
  cliConnectionStatus: "project:goal-cli-connection-status",
  list: "project:goal-list",
  revise: "project:goal-revise",
  start: "project:goal-monitor-start",
  stop: "project:goal-monitor-stop",
  check: "project:goal-monitor-check",
  status: "project:goal-monitor-status",
  proposals: "project:goal-proposals",
  deliveryDraftStatus: "project:goal-delivery-drafts-status",
  configureDeliveryDrafts: "project:goal-delivery-drafts-configure",
  proposeDeliveryDraft: "project:goal-delivery-drafts-propose",
  listDeliveryDrafts: "project:goal-delivery-drafts-list",
  readDeliveryDraft: "project:goal-delivery-drafts-read",
  prepareDeliveryDraft: "project:goal-delivery-drafts-prepare",
  importDraftRequest: "project:goal-draft-import",
  listDraftImports: "project:goal-draft-imports-list",
  readDraftImport: "project:goal-draft-import-read",
  prepareDraftImport: "project:goal-draft-import-prepare",
  revokeDraftImport: "project:goal-draft-import-revoke",
  listExternalDraftGrants: "project:goal-external-drafts-grants",
  revokeExternalDraftGrant: "project:goal-external-drafts-revoke",
  listExternalDrafts: "project:goal-external-drafts-list",
  readExternalDraft: "project:goal-external-drafts-read",
  prepareExternalDraft: "project:goal-external-drafts-prepare",
  prepareIntent: "project:goal-intent-prepare",
  executeIntent: "project:goal-intent-execute",
  readIntent: "project:goal-intent-read",
  stopOccurrence: "project:goal-occurrence-stop",
  endFollowUp: "project:goal-follow-up-end",
  configureAcceptance: "project:goal-acceptance-configure",
  acceptanceStatus: "project:goal-acceptance-status",
  acknowledgeAcceptance: "project:goal-acceptance-acknowledge",
  checkAcceptance: "project:goal-acceptance-check",
  completeGoal: "project:goal-complete",
  memoryList: "project:goal-memory-list",
  memoryCreate: "project:goal-memory-create",
  memoryCorrect: "project:goal-memory-correct",
  memoryDelete: "project:goal-memory-delete",
  memoryRevoke: "project:goal-memory-revoke",
  memoryOperations: "project:goal-memory-operations",
  memoryRecover: "project:goal-memory-recover",
  memoryDiscard: "project:goal-memory-discard",
});
function error(code) {
  return Object.assign(new Error(code), { code });
}

function display(value) {
  return JSON.stringify(value).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Fixed personal goal endpoints. Writes use a persisted native intent and a
 * live trusted renderer window; the background monitoring host has no dialog. */
function createProjectGoalHost({
  database,
  electron = null,
  getCurrentUserDid = () =>
    require("./project-goal-auth-session").getProjectGoalActor(),
  validateSender = (event) =>
    require("../ipc/ipc-sender-guard").validateSender(event),
  monitoringController = null,
  clock = Date.now,
  getAuthenticationGeneration = () =>
    require("./project-goal-auth-session").getProjectGoalAuthGeneration(),
} = {}) {
  const getElectron = () => electron || require("electron");
  const currentDatabase = () =>
    database?.getDatabase ? database.getDatabase() : database;
  function currentWindow(event) {
    if (validateSender(event)?.trusted !== true)
      throw error("GOAL_UNTRUSTED_SENDER");
    const window = getElectron().BrowserWindow.fromWebContents(event?.sender);
    if (!window || window.isDestroyed()) throw error("GOAL_WINDOW_UNAVAILABLE");
    return window;
  }
  function service(event) {
    currentWindow(event);
    const getActor = () => {
      currentWindow(event);
      const actor = getCurrentUserDid();
      if (typeof actor !== "string" || !actor)
        throw error("GOAL_IDENTITY_REQUIRED");
      return actor;
    };
    getActor();
    return new PersonalProjectGoalService({
      db: database?.getDatabase ? database.getDatabase() : database,
      getActor,
      now: () => new Date(clock()).toISOString(),
    });
  }
  const navigationStates = new WeakMap();
  function pinnedContext(event, trackNavigation = false) {
    const parent = currentWindow(event),
      frame = event.senderFrame,
      url = frame?.url;
    const db = currentDatabase(),
      actorDid = getCurrentUserDid(),
      generation = getAuthenticationGeneration();
    if (
      trackNavigation &&
      event?.sender &&
      !navigationStates.has(event.sender)
    ) {
      const state = { generation: 0 };
      navigationStates.set(event.sender, state);
      for (const name of [
        "did-start-navigation",
        "did-navigate-in-page",
        "render-process-gone",
        "destroyed",
      ])
        event.sender.on?.(name, () => {
          state.generation++;
        });
    }
    const navigation = trackNavigation
        ? navigationStates.get(event.sender)
        : undefined,
      navigationGeneration = navigation?.generation;
    if (!actorDid) throw error("GOAL_IDENTITY_REQUIRED");
    const getActor = () => {
      if (
        currentWindow(event) !== parent ||
        event.senderFrame !== frame ||
        frame?.url !== url ||
        navigation?.generation !== navigationGeneration
      )
        throw error("GOAL_EXTENSION_WINDOW_CHANGED");
      if (currentDatabase() !== db) throw error("GOAL_DATABASE_CHANGED");
      if (
        getCurrentUserDid() !== actorDid ||
        getAuthenticationGeneration() !== generation
      )
        throw error("GOAL_EXTENSION_AUTHENTICATION_CHANGED");
      return actorDid;
    };
    getActor();
    return { parent, db, getActor, actorDid };
  }
  const cliBridge =
    require("./project-goal-cli-bridge").createProjectGoalCliBridge({
      dialog: () => getElectron().dialog,
      getConnectionDirectory: () =>
        require("node:path").join(
          getElectron().app.getPath("userData"),
          "goal-connections",
        ),
      clock,
      subscribeAuthChanges: require("./project-goal-auth-session")
        .subscribeProjectGoalAuthChanges,
      async capture(event, input) {
        if (
          !input ||
          !Object.hasOwn(input, "goalRef") ||
          Object.keys(input).some(
            (key) => !["goalRef", "evidence", "drafts"].includes(key),
          ) ||
          (input.evidence !== undefined &&
            typeof input.evidence !== "boolean") ||
          (input.drafts !== undefined && typeof input.drafts !== "boolean") ||
          (input.drafts === true && input.evidence === true)
        )
          throw error("GOAL_INVALID_REQUEST");
        const ref =
          require("@chainlesschain/session-core/goal-extension-proposal-contract").goalExtensionRef(
            input.goalRef,
          );
        const { parent, db, getActor } = pinnedContext(event);
        const {
          ProjectGoalEvidenceReader,
        } = require("@chainlesschain/session-core/project-goal-evidence-reader");
        const reader = new ProjectGoalEvidenceReader({ db, getActor, clock });
        const evidence = input.evidence === true;
        const draftsConnection = input.drafts === true;
        let native = null,
          access = null,
          beforeGrant = null,
          grantRef = null;
        let invalid = false;
        const listeners = new Set();
        const invalidate = () => {
          invalid = true;
          for (const fn of listeners) fn();
        };
        const events = [
          "did-start-navigation",
          "did-navigate-in-page",
          "render-process-gone",
          "destroyed",
        ];
        for (const name of events) event.sender.on?.(name, invalidate);
        parent.on?.("closed", invalidate);
        const context = {
          parent,
          evidence,
          drafts: draftsConnection,
          get access() {
            return access;
          },
          get grantRef() {
            return grantRef;
          },
          read() {
            if (invalid) throw error("GOAL_BRIDGE_UNAVAILABLE");
            getActor();
            const summary = reader.readSummary(ref);
            if (grantRef)
              native.external.assertGrant({ goalRef: ref, grantRef });
            getActor();
            return summary;
          },
          onInvalidate(fn) {
            listeners.add(fn);
            if (invalid) fn();
            return () => listeners.delete(fn);
          },
          readEvidence() {
            const summary = this.read();
            if (!evidence) throw error("GOAL_BRIDGE_UNAVAILABLE");
            const result = reader.read(ref);
            this.read();
            return { ...summary, ...result };
          },
          authorizeDrafts() {
            if (!draftsConnection || !native || !beforeGrant)
              throw error("GOAL_BRIDGE_UNAVAILABLE");
            const grant = native.external.grant({
              goalRef: ref,
              access,
              expectedEpoch: beforeGrant.epoch,
            });
            grantRef = Object.freeze({ id: grant.id, epoch: grant.epoch });
          },
          readDraftContext() {
            const summary = this.read();
            return {
              ...summary,
              grant: {
                ...grantRef,
                plugin: access.plugin,
                declarationDigest: access.declarationDigest,
              },
              sources: this.draftSources(),
            };
          },
          draftSources(afterId) {
            this.read();
            const result = native.external.sourcePage({
              goalRef: ref,
              grantRef,
              ...(afterId !== undefined ? { afterId } : {}),
            });
            this.read();
            return result;
          },
          enqueueDraft(proposal) {
            this.read();
            return native.external.enqueue({
              goalRef: ref,
              grantRef,
              proposal,
            });
          },
          draftReceipt({ requestId, inputDigest }) {
            this.read();
            return native.external.submissionReceipt({
              goalRef: ref,
              grantRef,
              requestId,
              inputDigest,
            });
          },
          dispose() {
            for (const name of events)
              event.sender.removeListener?.(name, invalidate);
            parent.removeListener?.("closed", invalidate);
            listeners.clear();
          },
        };
        if (draftsConnection) {
          try {
            context.read();
            const picked = await getElectron().dialog.showOpenDialog(parent, {
              title: "选择 CLI / IDE 草稿来源授权请求",
              properties: ["openFile"],
              filters: [
                { name: "Goal draft access request", extensions: ["json"] },
              ],
            });
            context.read();
            if (picked?.canceled || picked?.filePaths?.length !== 1)
              throw error("GOAL_BRIDGE_UNAVAILABLE");
            access =
              require("./project-goal-draft-request-file").readGoalDraftAccessFile(
                picked.filePaths[0],
              );
            Object.freeze(access.plugin);
            Object.freeze(access);
            native = workflowContext(event);
            native.getActor();
            beforeGrant = native.external.grantStatus({ goalRef: ref, access });
            context.read();
          } catch (cause) {
            context.dispose();
            throw cause;
          }
        }
        return context;
      },
    });
  function workflowContext(event) {
    const { parent, db, getActor, actorDid } = pinnedContext(event, true);
    const {
      ApprovalGate,
    } = require("@chainlesschain/session-core/approval-gate");
    const {
      ProjectGoalWorkflow,
    } = require("@chainlesschain/session-core/project-goal-workflow");
    const {
      ProjectGoalDeliveryDrafts,
    } = require("./project-goal-delivery-drafts");
    const {
      ProjectGoalDraftImports,
      IMPORT_PLUGIN,
    } = require("@chainlesschain/session-core/project-goal-draft-imports");
    const {
      ProjectGoalExternalDrafts,
    } = require("@chainlesschain/session-core/project-goal-external-drafts");
    const {
      digestBusinessObjectContent: digest,
    } = require("@chainlesschain/session-core/business-object-contract");
    let drafts, imports, external;
    const gate = new ApprovalGate({
      confirm: async ({ request, before, after, actorDid }) => {
        const parent = currentWindow(event);
        if (getActor() !== actorDid) throw error("GOAL_IDENTITY_CHANGED");
        const goal = hostWorkflow.goals.get({
          id: request.input.goalIntent.goalId,
        });
        const creation = request.actionType === "task.create";
        const imported = imports?.describeIntent(request.input.goalIntent.id);
        const externalSource = external?.describeIntent(
          request.input.goalIntent.id,
        );
        const result = await getElectron().dialog.showMessageBox(parent, {
          type: "question",
          title: creation ? "确认目标建议：创建任务" : "确认目标建议：修改描述",
          message: creation
            ? "为该目标保存以下待处理任务？"
            : "按该目标建议修改任务描述？",
          detail: [
            `目标：${display(goal.objective)}`,
            `目标版本：${goal.revision}`,
            `当前身份：${display(actorDid)}`,
            `对象：${display(request.target.id)}`,
            `对象版本：${request.expectedVersion}`,
            ...(creation ? [`任务类型：${display(after.taskType)}`] : []),
            `修改前：${display(before.description)}`,
            `修改后：${display(after.description)}`,
            `风险检查：${display(request.input.riskReview.id)}`,
            `风险来源摘要：${request.input.riskReview.contentDigest}`,
            `意图：${display(request.input.goalIntent.id)}`,
            `操作摘要：${request.actionDigest}`,
            ...(request.input.goalIntent.extensionRef
              ? [
                  `${imported ? "已采纳外部请求草稿" : externalSource ? "在线来源待审草稿" : "内置交付助手草稿"}：${display(request.input.goalIntent.extensionRef.draftId)}`,
                  `转换：${display(request.input.goalIntent.extensionRef.conversionId)}`,
                  `草稿摘要：${request.input.goalIntent.extensionRef.draftDigest}`,
                ]
              : []),
            ...(imported
              ? [
                  `请求文件声明的来源（未经代码鉴定）：${display(imported.declaredPlugin)}`,
                  `采纳请求摘要：${imported.contentDigest}`,
                ]
              : []),
            ...(externalSource
              ? [
                  `来源标签（未经代码鉴定）：${display(externalSource.plugin)}`,
                  `原生来源授权：${externalSource.grantId}（代次 ${externalSource.epoch}）`,
                  `声明摘要：${externalSource.declarationDigest}`,
                ]
              : []),
            "保存动作只证明该操作完成；原风险与目标验收需要再次检查。",
          ].join("\n\n"),
          buttons: ["取消", creation ? "确认创建" : "确认修改"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        getActor();
        return result?.response === 1;
      },
    });
    const hostWorkflow = new ProjectGoalWorkflow({
      db,
      getActor,
      clock,
      verifyExtensionIntent: (context) => {
        const {
          readExtensionIntentBinding,
        } = require("@chainlesschain/session-core/project-goal-draft-imports");
        const { draft } = readExtensionIntentBinding({
          db,
          intent: context.intent,
          actor: context.actor,
        });
        if (digest(draft.plugin) === digest(IMPORT_PLUGIN))
          return imports ? imports.verifyIntentInTransaction(context) : false;
        if (
          draft.origin === "extension-suggestion" &&
          ["user", "project", "local"].includes(draft.plugin.scope)
        )
          return external ? external.verifyIntentInTransaction(context) : false;
        const { PLUGIN } = require("./project-goal-delivery-drafts");
        return digest(draft.plugin) === digest(PLUGIN) && drafts
          ? drafts.queue.verifyIntentInTransaction(context)
          : false;
      },
      approvalGate: Object.freeze({
        decide: (context) =>
          gate.decide({ ...context, policy: "strict", riskLevel: "high" }),
      }),
    });
    drafts = new ProjectGoalDeliveryDrafts({
      workflow: hostWorkflow,
      clock,
      confirm: async ({ goal, plugin, capability }) => {
        getActor();
        const choice = await getElectron().dialog.showMessageBox(parent, {
          type: "question",
          title: "启用交付助手草稿",
          message: "允许内置交付助手为此目标保存待确认的任务说明草稿？",
          detail: [
            `目标：${display(goal.objective)}`,
            `目标版本：${goal.revision}`,
            `当前身份：${display(actorDid)}`,
            `内置包：${plugin.scope}:${plugin.name}@${plugin.version}`,
            `能力：${capability}`,
            "保存规则生成的建议；用户显式请求后可建立原生预览，修改任务仍须逐次原生确认。禁用后历史保留，旧草稿及未确认预览不能继续使用。",
          ].join("\n\n"),
          buttons: ["取消", "启用草稿"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        getActor();
        return choice?.response === 1;
      },
    });
    imports = new ProjectGoalDraftImports({
      workflow: hostWorkflow,
      clock,
      confirm: async ({ goal, envelope }) => {
        getActor();
        const choice = await getElectron().dialog.showMessageBox(parent, {
          type: "question",
          title: "逐份采纳外部任务说明请求",
          message: "将下列完整正文采纳为待审草稿？",
          detail: [
            `目标：${display(goal.objective)}`,
            `目标版本：${goal.revision}`,
            `当前身份：${display(actorDid)}`,
            `请求文件声明的来源（未经代码鉴定）：${display(envelope.declaredPlugin)}`,
            `原生风险来源：${display(envelope.proposal.sourceRef)}`,
            `请求：${display(envelope.proposal.requestId)}`,
            `标题：${display(envelope.proposal.title)}`,
            `拟保存的完整说明：${display(envelope.proposal.description)}`,
            `请求内容摘要：${envelope.contentDigest}`,
            "内容摘要不证明插件身份。采纳只保存此份待审草稿；后续需建立当前预览并逐次原生确认，才会修改任务。可逐份撤销采纳；撤销不会回滚已完成修改。",
          ].join("\n\n"),
          buttons: ["取消", "采纳此份草稿"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        getActor();
        return choice?.response === 1;
      },
    });
    external = new ProjectGoalExternalDrafts({ workflow: hostWorkflow, clock });
    return { workflow: hostWorkflow, drafts, imports, external, getActor };
  }
  function workflow(event) {
    return workflowContext(event).workflow;
  }
  const controller =
    monitoringController ||
    require("./project-goal-monitoring-host").createProjectGoalMonitoringController(
      {
        database,
        electron: getElectron(),
        getCurrentUserDid,
        clock,
        onError: (error) =>
          require("../utils/logger.js").logger.error(
            "[Goals] Monitoring host error:",
            error,
          ),
      },
    );
  function completion(event) {
    currentWindow(event);
    const db = currentDatabase();
    const getActor = () => {
      currentWindow(event);
      if (currentDatabase() !== db) throw error("GOAL_DATABASE_CHANGED");
      const actor = getCurrentUserDid();
      if (!actor) throw error("GOAL_IDENTITY_REQUIRED");
      return actor;
    };
    getActor();
    const {
      ApprovalGate,
    } = require("@chainlesschain/session-core/approval-gate");
    const {
      ProjectGoalCompletionService,
    } = require("@chainlesschain/session-core/project-goal-completion");
    const gate = new ApprovalGate({
      confirm: async ({ goal, criteria, actorDid, acknowledgementId }) => {
        const parent = currentWindow(event);
        const current = hostCompletion.goals.get({ id: goal.id });
        if (
          getActor() !== actorDid ||
          current?.revision !== goal.revision ||
          current.controlGeneration !== goal.controlGeneration ||
          current.status !== "active"
        )
          throw error("GOAL_COMPLETION_ACK_STALE");
        const result = await getElectron().dialog.showMessageBox(parent, {
          type: "question",
          title: "记录目标人工验收",
          message: "你确认已完成以下人工验收条件？",
          detail: [
            `目标：${display(goal.objective)}`,
            `目标版本：${goal.revision}`,
            `当前身份：${display(actorDid)}`,
            ...criteria.map(
              (criterion) => `验收条件：${display(criterion.description)}`,
            ),
            `验收记录：${display(acknowledgementId)}`,
            "确认会保存你的人工验收记录；目标还需要重新检查全部业务条件。",
          ].join("\n\n"),
          buttons: ["取消", "确认我已验收"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result?.response === 1;
      },
    });
    const hostCompletion = new ProjectGoalCompletionService({
      db,
      getActor,
      clock,
      approvalGate: Object.freeze({
        decide: (context) =>
          gate.decide({ ...context, policy: "strict", riskLevel: "high" }),
      }),
    });
    return hostCompletion;
  }
  function memoryCall(event, method, params) {
    const parent = currentWindow(event),
      frame = event.senderFrame,
      url = frame?.url;
    const db = currentDatabase();
    const actorDid = getCurrentUserDid();
    if (!actorDid) throw error("GOAL_IDENTITY_REQUIRED");
    const generation = getAuthenticationGeneration();
    const getActor = () => {
      if (
        currentWindow(event) !== parent ||
        event.senderFrame !== frame ||
        frame?.url !== url
      )
        throw error("GOAL_MEMORY_WINDOW_CHANGED");
      if (currentDatabase() !== db) throw error("GOAL_DATABASE_CHANGED");
      const current = getCurrentUserDid();
      if (!current) throw error("GOAL_IDENTITY_REQUIRED");
      if (current !== actorDid || getAuthenticationGeneration() !== generation)
        throw error("GOAL_MEMORY_AUTHENTICATION_CHANGED");
      return current;
    };
    getActor();
    const {
      ProjectGoalMemoryService,
    } = require("@chainlesschain/session-core/project-goal-memory");
    const {
      ContextMemoryKernel,
      NativeSqliteMemoryPort,
    } = require("@chainlesschain/context-memory-kernel");
    const service = new ProjectGoalMemoryService({
      db,
      getActor,
      clock,
      onAuthorityChanged: () => {
        const windows = getElectron().BrowserWindow.getAllWindows?.() ?? [
          parent,
        ];
        for (const window of windows) {
          const webContents = window.webContents;
          if (
            !window.isDestroyed() &&
            webContents &&
            !webContents.isDestroyed()
          )
            webContents.send("project:goal-memory-invalidated", {});
        }
      },
      memoryHostFactory: ({ scope, authorize }) => {
        const port = new NativeSqliteMemoryPort({ db, scope, authorize });
        return {
          port,
          kernel: new ContextMemoryKernel({
            memoryPort: port,
            reconciliationPort: port,
            clock,
          }),
        };
      },
    });
    const result = service[method](params);
    if (result?.then)
      return result.then((value) => {
        getActor();
        return value;
      });
    getActor();
    return result;
  }
  async function monitor(event) {
    currentWindow(event);
    if (!getCurrentUserDid()) throw error("GOAL_IDENTITY_REQUIRED");
    const engine = await controller.initialize();
    currentWindow(event);
    if (!getCurrentUserDid()) throw error("GOAL_IDENTITY_REQUIRED");
    return engine;
  }
  function deliveryCall(event, method, params) {
    const context = workflowContext(event);
    const result = context.drafts[method](params);
    if (result && typeof result.then === "function")
      return result.then((value) => {
        context.getActor();
        return value;
      });
    context.getActor();
    return result;
  }
  function importCall(event, method, params) {
    const context = workflowContext(event),
      result = context.imports[method](params);
    if (result && typeof result.then === "function")
      return result.then((value) => {
        context.getActor();
        return value;
      });
    context.getActor();
    return result;
  }
  function externalCall(event, method, params) {
    const context = workflowContext(event),
      result = context.external[method](params);
    context.getActor();
    return result;
  }
  return Object.freeze({
    create: (event, params) => service(event).create(params),
    read: (event, params) => service(event).get(params),
    openCliConnection: (event, params) => cliBridge.open(event, params),
    closeCliConnection: (event) => {
      currentWindow(event);
      cliBridge.close();
      return cliBridge.status();
    },
    cliConnectionStatus: (event) => {
      currentWindow(event);
      return cliBridge.status();
    },
    list: (event, params) => service(event).list(params),
    revise: (event, params) => service(event).revise(params),
    start: async (event, params) => (await monitor(event)).start(params),
    stop: async (event, params) => (await monitor(event)).stop(params),
    check: async (event, params) => (await monitor(event)).checkNow(params),
    status: async (event, params) => (await monitor(event)).status(params),
    proposals: (event, params) => workflow(event).list(params),
    deliveryDraftStatus: (event, params) =>
      deliveryCall(event, "status", params),
    configureDeliveryDrafts: (event, params) =>
      deliveryCall(event, "configure", params),
    proposeDeliveryDraft: (event, params) =>
      deliveryCall(event, "propose", params),
    listDeliveryDrafts: (event, params) => deliveryCall(event, "list", params),
    readDeliveryDraft: (event, params) => deliveryCall(event, "read", params),
    prepareDeliveryDraft: (event, params) =>
      deliveryCall(event, "prepare", params),
    importDraftRequest: async (event, params) => {
      if (
        !params ||
        Object.keys(params).length !== 1 ||
        !Object.hasOwn(params, "goalRef")
      )
        throw error("GOAL_INVALID_REQUEST");
      const context = workflowContext(event),
        goalRef =
          require("@chainlesschain/session-core/goal-extension-proposal-contract").goalExtensionRef(
            params.goalRef,
          );
      const chosen = await getElectron().dialog.showOpenDialog(
        currentWindow(event),
        {
          title: "选择外部任务说明请求",
          properties: ["openFile"],
          filters: [{ name: "Goal draft request", extensions: ["json"] }],
        },
      );
      context.getActor();
      if (chosen?.canceled || chosen?.filePaths?.length !== 1)
        return { state: "cancelled" };
      const envelope =
        require("./project-goal-draft-request-file").readGoalDraftRequestFile(
          chosen.filePaths[0],
        );
      const result = await context.imports.adopt({ goalRef, envelope });
      context.getActor();
      return result;
    },
    listDraftImports: (event, params) => importCall(event, "list", params),
    readDraftImport: (event, params) => importCall(event, "read", params),
    prepareDraftImport: (event, params) => importCall(event, "prepare", params),
    revokeDraftImport: (event, params) => importCall(event, "revoke", params),
    listExternalDraftGrants: (event, params) =>
      externalCall(event, "listGrants", params),
    revokeExternalDraftGrant: (event, params) => {
      const value = externalCall(event, "revoke", params);
      cliBridge.closeGrant(params.id);
      return value;
    },
    listExternalDrafts: (event, params) =>
      externalCall(event, "listDrafts", params),
    readExternalDraft: (event, params) =>
      externalCall(event, "readDraft", params),
    prepareExternalDraft: (event, params) =>
      externalCall(event, "prepareDraft", params),
    prepareIntent: (event, params) => {
      if (Object.hasOwn(params || {}, "extensionRef"))
        throw error("GOAL_EXTENSION_USE_DRAFT_ID");
      return workflow(event).prepare(params);
    },
    executeIntent: (event, params) => workflow(event).execute(params),
    readIntent: (event, params) => workflow(event).getIntent(params),
    stopOccurrence: async (event, params) =>
      (await monitor(event)).stopOccurrence(params),
    endFollowUp: async (event, params) =>
      (await monitor(event)).endFollowUp(params),
    configureAcceptance: (event, params) => completion(event).configure(params),
    acceptanceStatus: (event, params) => completion(event).status(params),
    acknowledgeAcceptance: (event, params) =>
      completion(event).acknowledge(params),
    checkAcceptance: (event, params) => completion(event).inspect(params),
    completeGoal: (event, params) => completion(event).complete(params),
    memoryList: (event, params) => memoryCall(event, "list", params),
    memoryCreate: (event, params) => memoryCall(event, "create", params),
    memoryCorrect: (event, params) => memoryCall(event, "correct", params),
    memoryDelete: (event, params) => memoryCall(event, "delete", params),
    memoryRevoke: (event, params) => memoryCall(event, "revoke", params),
    memoryOperations: (event, params) =>
      memoryCall(event, "operations", params),
    memoryRecover: (event, params) => memoryCall(event, "recover", params),
    memoryDiscard: (event, params) => memoryCall(event, "discard", params),
    initializeMonitoring: () => controller.initialize(),
    close: () => {
      cliBridge.close();
      return controller.close();
    },
  });
}
function registerProjectGoalIPC(database, dependencies = {}) {
  const electron = dependencies.electron || require("electron");
  const host = createProjectGoalHost({ ...dependencies, database, electron });
  for (const [method, channel] of Object.entries(CHANNELS))
    electron.ipcMain.handle(channel, (event, params) =>
      host[method](event, params),
    );
  return host;
}
module.exports = { CHANNELS, createProjectGoalHost, registerProjectGoalIPC };
