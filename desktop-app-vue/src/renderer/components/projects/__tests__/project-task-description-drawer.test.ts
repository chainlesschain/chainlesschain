import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";
import ProjectTaskDescriptionDrawer from "../ProjectTaskDescriptionDrawer.vue";

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function task(id = "task-1", projectId = "project-1", extra = {}) {
  return {
    taskId: id,
    projectId,
    status: "pending",
    description: `Original ${id}`,
    editable: true,
    reason: null,
    ...extra,
  };
}
function summary(id = "task-1") {
  return {
    id,
    taskType: "query_info",
    status: "pending",
    descriptionPreview: `Original ${id}`,
    updatedAt: 10,
  };
}
function receipt(status = "succeeded", digest = "invocation-1", id = "run-1") {
  return {
    run: {
      id,
      status,
      invocationDigest: digest,
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: status === "running" ? null : "2026-10-06T00:01:00.000Z",
    },
    evidence: [],
    replayed: false,
  };
}
function denied() {
  return Object.assign(new Error("ACTION_NOT_FOUND_OR_DENIED"), {
    code: "ACTION_NOT_FOUND_OR_DENIED",
  });
}

describe("project task description drawer", () => {
  let wrapper: VueWrapper;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let riskApi: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = {
      listControlledTasks: vi.fn(async ({ projectId }) => ({
        project: { id: projectId, status: "active" },
        tasks: [summary()],
        nextCursor: null,
      })),
      readControlledTask: vi.fn(async ({ taskId }) => task(taskId)),
      listDescriptionActionRuns: vi.fn(async () => ({
        runs: [],
        nextCursor: null,
      })),
      previewDescriptionUpdate: vi.fn(async ({ description }) => ({
        request: { invocationDigest: "invocation-1", nonce: "bound-request" },
        before: { description: "Original task-1" },
        after: { description },
      })),
      executeDescriptionUpdate: vi.fn(async () => receipt()),
    };
    riskApi = vi.fn(async () => ({
      review: {
        id: "review-1",
        projectId: "project-1",
        createdAt: "2026-10-06T01:00:00.000Z",
      },
      sourceSnapshot: { secret: "do-not-render-source" },
      evaluation: {
        status: "evaluated",
        asOf: "2026-10-06T01:00:00.000Z",
        summary: { taskCount: 1, riskTaskCount: 0 },
        reasonCodes: [],
        tasks: [],
      },
    }));
    (window as any).electronAPI = {
      task: api,
      project: { evaluateRisk: riskApi },
    };
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
  });

  async function open(props = {}) {
    wrapper = mount(ProjectTaskDescriptionDrawer, {
      props: {
        open: true,
        projectId: "project-1",
        identityKey: "owner:personal:true",
        ...props,
      },
      global: {
        stubs: {
          "a-drawer": {
            props: ["open"],
            template: '<div v-if="open"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();
    return wrapper;
  }
  async function select(id = "task-1") {
    await wrapper.get(`[data-task-id="${id}"]`).trigger("click");
    await flushPromises();
  }
  async function prepare(description = "Reviewed description") {
    await wrapper.get('[data-testid="task-description"]').setValue(description);
    await wrapper.get('[data-testid="preview-description"]').trigger("click");
    await flushPromises();
  }

  it("reads canonical detail, previews before/after and submits only the bound request", async () => {
    await open();
    await select();
    await prepare();
    expect(api.readControlledTask).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(wrapper.get('[data-testid="description-preview"]').text()).toContain(
      "Original task-1",
    );
    expect(wrapper.get('[data-testid="description-preview"]').text()).toContain(
      "Reviewed description",
    );
    expect(api.executeDescriptionUpdate).not.toHaveBeenCalled();
    api.readControlledTask.mockResolvedValue(
      task("task-1", "project-1", { description: "Reviewed description" }),
    );
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await flushPromises();
    expect(api.executeDescriptionUpdate).toHaveBeenCalledWith({
      request: { invocationDigest: "invocation-1", nonce: "bound-request" },
    });
    expect(wrapper.get('[data-testid="current-receipt"]').text()).toBe(
      "修改已完成",
    );
    expect(api.readControlledTask).toHaveBeenCalledTimes(2);
  });

  it("blocks duplicate execution while the native confirmation is pending", async () => {
    const pending = deferred();
    api.executeDescriptionUpdate.mockReturnValue(pending.promise);
    await open();
    await select();
    await prepare();
    const button = wrapper.get('[data-testid="execute-description"]');
    await button.trigger("click");
    await button.trigger("click");
    expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
    expect(button.attributes("disabled")).toBeDefined();
    pending.resolve(receipt("cancelled"));
    await flushPromises();
    expect(wrapper.get('[data-testid="current-receipt"]').text()).toBe(
      "用户已取消",
    );
    expect(
      wrapper.get('[data-testid="task-description"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("keeps one key for repeated previews and creates another only for a new intent", async () => {
    api.executeDescriptionUpdate.mockResolvedValue(receipt("cancelled"));
    await open();
    await select();
    await prepare();
    await wrapper.get('[data-testid="preview-description"]').trigger("click");
    await flushPromises();
    const firstKey =
      api.previewDescriptionUpdate.mock.calls[0][0].idempotencyKey;
    expect(api.previewDescriptionUpdate.mock.calls[1][0].idempotencyKey).toBe(
      firstKey,
    );
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-testid="new-description-intent"]')
      .trigger("click");
    await prepare("Different new intent");
    expect(
      api.previewDescriptionUpdate.mock.calls[2][0].idempotencyKey,
    ).not.toBe(firstKey);
  });

  it("treats a transport error as unresolved and refreshes history instead of retrying", async () => {
    api.executeDescriptionUpdate.mockRejectedValue(
      new Error("connection closed"),
    );
    await open();
    await select();
    await prepare();
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="unresolved-action"]').text()).toContain(
      "结果待核实",
    );
    expect(
      wrapper.find('[data-testid="new-description-intent"]').exists(),
    ).toBe(false);
    await wrapper.get('[data-testid="preview-description"]').trigger("click");
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    expect(api.previewDescriptionUpdate).toHaveBeenCalledTimes(1);
    expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
    api.listDescriptionActionRuns.mockResolvedValue({
      runs: [receipt("succeeded")],
      nextCursor: null,
    });
    api.readControlledTask.mockResolvedValue(
      task("task-1", "project-1", { description: "Reviewed description" }),
    );
    await wrapper.get('[data-testid="refresh-history"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="current-receipt"]').text()).toBe(
      "修改已完成",
    );
    expect(wrapper.find('[data-testid="unresolved-action"]').exists()).toBe(
      false,
    );
    expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
  });

  it.each(["ACTION_VERSION_CONFLICT", "ACTION_IDEMPOTENCY_CONFLICT"])(
    "recovers from a definite %s rejection after an authoritative refresh",
    async (code) => {
      api.executeDescriptionUpdate.mockRejectedValueOnce(
        Object.assign(new Error(code), { code }),
      );
      await open();
      await select();
      await prepare();
      const firstKey =
        api.previewDescriptionUpdate.mock.calls[0][0].idempotencyKey;
      await wrapper.get('[data-testid="execute-description"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("本次修改未执行");
      expect(wrapper.find('[data-testid="unresolved-action"]').exists()).toBe(
        false,
      );
      expect(
        wrapper
          .get('[data-testid="preview-description"]')
          .attributes("disabled"),
      ).toBeDefined();
      api.readControlledTask.mockResolvedValue(
        task("task-1", "project-1", {
          description: "Another committed version",
        }),
      );
      await wrapper.get('[data-testid="refresh-history"]').trigger("click");
      await flushPromises();
      expect(
        wrapper
          .get('[data-testid="preview-description"]')
          .attributes("disabled"),
      ).toBeUndefined();
      await wrapper.get('[data-testid="preview-description"]').trigger("click");
      await flushPromises();
      expect(
        api.previewDescriptionUpdate.mock.calls[1][0].idempotencyKey,
      ).not.toBe(firstKey);
      expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it("clears a rejected new attempt while retaining an earlier unresolved action barrier", async () => {
    api.executeDescriptionUpdate.mockRejectedValueOnce(
      new Error("ACTION_UNRESOLVED_ACTION"),
    );
    await open();
    await select();
    await prepare();
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="unresolved-action"]').exists()).toBe(
      true,
    );
    api.listDescriptionActionRuns.mockResolvedValue({
      runs: [receipt("cancelled", "earlier-invocation")],
      nextCursor: null,
    });
    await wrapper.get('[data-testid="refresh-history"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="unresolved-action"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('[data-testid="preview-description"]').attributes("disabled"),
    ).toBeUndefined();
    expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
  });

  it("sends a plain request that Electron can structured-clone after preview", async () => {
    api.executeDescriptionUpdate.mockImplementation(async (input) => {
      expect(() => structuredClone(input)).not.toThrow();
      return receipt("cancelled");
    });
    await open();
    await select();
    await prepare();
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="current-receipt"]').text()).toBe(
      "用户已取消",
    );
  });

  it("shows persisted running receipts as unresolved and forbids a new intention", async () => {
    api.readControlledTask.mockResolvedValue(
      task("task-1", "project-1", {
        editable: false,
        reason: "ACTION_UNRESOLVED_ACTION",
      }),
    );
    api.listDescriptionActionRuns.mockResolvedValue({
      runs: [receipt("running")],
      nextCursor: null,
    });
    await open();
    await select();
    expect(wrapper.get('[data-testid="action-history"]').text()).toContain(
      "结果待核实",
    );
    expect(
      wrapper.get('[data-testid="task-description"]').attributes("disabled"),
    ).toBeDefined();
    expect(api.previewDescriptionUpdate).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "denied"])(
    "reports %s without claiming a successful edit",
    async (status) => {
      api.executeDescriptionUpdate.mockResolvedValue(receipt(status));
      await open();
      await select();
      await prepare();
      await wrapper.get('[data-testid="execute-description"]').trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-testid="current-receipt"]').text()).toBe(
        status === "cancelled" ? "用户已取消" : "修改被拒绝",
      );
      expect(api.readControlledTask).toHaveBeenCalledTimes(1);
    },
  );

  it("drops old project responses and clears descriptions on route changes", async () => {
    const pending = deferred();
    api.listControlledTasks.mockReturnValueOnce(pending.promise);
    await open();
    await wrapper.setProps({ projectId: "project-2" });
    await flushPromises();
    pending.resolve({
      project: { id: "project-1", status: "active" },
      tasks: [
        {
          ...summary("old-private-task"),
          descriptionPreview: "Old private content",
        },
      ],
      nextCursor: null,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Old private content");
    expect(api.listControlledTasks.mock.calls[1][0].projectId).toBe(
      "project-2",
    );
  });

  it("drops an old selected task detail after a newer selection", async () => {
    api.listControlledTasks.mockResolvedValue({
      project: { id: "project-1", status: "active" },
      tasks: [summary(), summary("task-2")],
      nextCursor: null,
    });
    const pending = deferred();
    api.readControlledTask.mockReturnValueOnce(pending.promise);
    await open();
    await select();
    await select("task-2");
    pending.resolve(
      task("task-1", "project-1", { description: "Stale task-1 detail" }),
    );
    await flushPromises();
    expect(
      (
        wrapper.get('[data-testid="task-description"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe("Original task-2");
    expect(wrapper.text()).not.toContain("Stale task-1 detail");
  });

  it.each(["definite-rejection", "terminal-success", "transport-error"])(
    "reconciles late %s metadata without restoring the old selection",
    async (outcome) => {
      api.listControlledTasks.mockResolvedValue({
        project: { id: "project-1", status: "active" },
        tasks: [summary(), summary("task-2")],
        nextCursor: null,
      });
      const pending = deferred();
      api.executeDescriptionUpdate.mockReturnValueOnce(pending.promise);
      await open();
      await select();
      await prepare();
      await wrapper.get('[data-testid="execute-description"]').trigger("click");
      await select("task-2");
      if (outcome === "terminal-success") pending.resolve(receipt());
      else
        pending.reject(
          new Error(
            outcome === "definite-rejection"
              ? "ACTION_VERSION_CONFLICT"
              : "connection lost",
          ),
        );
      await flushPromises();
      expect(
        (
          wrapper.get('[data-testid="task-description"]')
            .element as HTMLTextAreaElement
        ).value,
      ).toBe("Original task-2");
      expect(wrapper.find('[data-testid="current-receipt"]').exists()).toBe(
        false,
      );
      await select("task-1");
      expect(wrapper.find('[data-testid="unresolved-action"]').exists()).toBe(
        outcome === "transport-error",
      );
      await wrapper
        .get('[data-testid="task-description"]')
        .setValue("Another intentional edit");
      expect(
        wrapper
          .get('[data-testid="preview-description"]')
          .attributes("disabled") !== undefined,
      ).toBe(outcome === "transport-error");
      expect(api.executeDescriptionUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it("clears tasks, drafts, previews and risk after access is revoked", async () => {
    await open();
    await select();
    await prepare();
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    await flushPromises();
    api.listDescriptionActionRuns.mockRejectedValue(denied());
    await wrapper.get('[data-testid="refresh-history"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("当前身份无访问权限");
    expect(wrapper.find('[data-testid="task-editor"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="risk-result"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Original task-1");
  });

  it("clears sensitive content and closes on identity changes without reading for an old identity", async () => {
    await open();
    await select();
    await prepare();
    await wrapper.setProps({ identityKey: "other:personal:true" });
    await flushPromises();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(wrapper.find('[data-testid="task-editor"]').exists()).toBe(false);
    expect(api.listControlledTasks).toHaveBeenCalledTimes(1);
  });

  it("does not leak the result of a confirmation finishing after the drawer closes", async () => {
    const pending = deferred();
    api.executeDescriptionUpdate.mockReturnValue(pending.promise);
    await open();
    await select();
    await prepare();
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await wrapper.setProps({ open: false });
    pending.resolve(receipt());
    await flushPromises();
    expect(wrapper.text()).toBe("");
    expect(api.readControlledTask).toHaveBeenCalledTimes(1);
  });

  it("disables oversized UTF-8 descriptions before preview", async () => {
    await open();
    await select();
    await wrapper
      .get('[data-testid="task-description"]')
      .setValue("界".repeat(3000));
    expect(
      wrapper.get('[data-testid="preview-description"]').attributes("disabled"),
    ).toBeDefined();
    expect(api.previewDescriptionUpdate).not.toHaveBeenCalled();
  });

  it("shows source restrictions and does not fall back to legacy task writes", async () => {
    api.readControlledTask.mockResolvedValue(
      task("task-1", "project-1", {
        editable: false,
        reason: "ACTION_TARGET_NOT_EDITABLE",
        status: "completed",
      }),
    );
    await open();
    await select();
    expect(wrapper.get('[data-testid="task-restriction"]').text()).toContain(
      "仅待处理任务",
    );
    expect(
      wrapper.get('[data-testid="preview-description"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("reports unavailable native methods without generic IPC fallback", async () => {
    const invoke = vi.fn();
    (window as any).electronAPI = { invoke, task: { updateTask: vi.fn() } };
    await open();
    expect(wrapper.text()).toContain("当前版本未提供受控项目任务功能");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads tasks and history with explicit bounded cursors", async () => {
    api.listControlledTasks.mockResolvedValueOnce({
      project: { id: "project-1" },
      tasks: [summary()],
      nextCursor: "task-1",
    });
    api.listControlledTasks.mockResolvedValueOnce({
      project: { id: "project-1" },
      tasks: [summary("task-2")],
      nextCursor: null,
    });
    api.listDescriptionActionRuns.mockResolvedValueOnce({
      runs: [receipt("cancelled", "first", "run-2")],
      nextCursor: "run-2",
    });
    api.listDescriptionActionRuns.mockResolvedValueOnce({
      runs: [receipt("denied", "older", "run-1")],
      nextCursor: null,
    });
    await open();
    await wrapper.get('[data-testid="more-tasks"]').trigger("click");
    await flushPromises();
    await select();
    await wrapper.get('[data-testid="more-history"]').trigger("click");
    await flushPromises();
    expect(api.listControlledTasks.mock.calls[1][0]).toEqual({
      projectId: "project-1",
      afterId: "task-1",
      limit: 50,
    });
    expect(api.listDescriptionActionRuns.mock.calls[1][0]).toEqual({
      taskId: "task-1",
      beforeId: "run-2",
      limit: 20,
    });
    expect(wrapper.get('[data-testid="action-history"]').text()).toContain(
      "run-1",
    );
  });

  it("runs risk checks only on request, showing zero signals without a safety claim", async () => {
    await open();
    expect(riskApi).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    await flushPromises();
    const result = wrapper.get('[data-testid="risk-result"]');
    expect(result.text()).toContain("未发现所选规则信号");
    expect(result.text()).toContain("2026-10-06T01:00:00.000Z");
    expect(result.text()).toContain("review-1");
    expect(result.text()).toContain("补充任务描述不会消除");
    expect(result.text()).not.toContain("do-not-render-source");
    expect(result.text()).not.toContain("无风险");
  });

  it("invalidates an unconfirmed description preview when the selected review changes", async () => {
    await open();
    await select();
    await prepare();
    expect(wrapper.find('[data-testid="description-preview"]').exists()).toBe(
      true,
    );
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="description-preview"]').exists()).toBe(
      false,
    );
    await wrapper.get('[data-testid="preview-description"]').trigger("click");
    await flushPromises();
    expect(api.previewDescriptionUpdate.mock.calls.at(-1)?.[0].reviewId).toBe(
      "review-1",
    );
  });

  it("discards a late preview prepared against a previously selected risk review", async () => {
    const pending = deferred();
    api.previewDescriptionUpdate.mockReturnValue(pending.promise);
    await open();
    await select();
    await wrapper
      .get('[data-testid="task-description"]')
      .setValue("New description");
    await wrapper.get('[data-testid="preview-description"]').trigger("click");
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    await flushPromises();
    pending.resolve({
      request: { invocationDigest: "old-review" },
      before: { description: "Original task-1" },
      after: { description: "New description" },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="description-preview"]').exists()).toBe(
      false,
    );
    expect(api.executeDescriptionUpdate).not.toHaveBeenCalled();
  });

  it("keeps insufficient risk data separate from zero matching signals", async () => {
    riskApi.mockResolvedValue({
      review: { id: "review-1", projectId: "project-1" },
      evaluation: {
        status: "insufficient-data",
        asOf: null,
        summary: null,
        tasks: [],
        reasonCodes: ["INCOMPLETE_READ"],
      },
    });
    await open();
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="risk-result"]').text()).toContain(
      "数据不足",
    );
    expect(wrapper.text()).not.toContain("未发现所选规则信号");
  });

  it("ignores risk data arriving after a revoked task read", async () => {
    const pending = deferred();
    riskApi.mockReturnValue(pending.promise);
    await open();
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    api.readControlledTask.mockRejectedValue(denied());
    await select();
    pending.resolve({
      review: { id: "private-review", projectId: "project-1" },
      evaluation: {
        status: "evaluated",
        summary: { riskTaskCount: 0 },
        tasks: [],
        reasonCodes: [],
      },
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain("private-review");
    expect(wrapper.text()).toContain("当前身份无访问权限");
  });

  it("compiles the real project page and wires the drawer to the actual project route", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/renderer/pages/projects/ProjectDetailPage.vue",
      ),
      "utf8",
    );
    const { descriptor, errors } = parse(source);
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "project-page" });
    expect(
      compileTemplate({
        source: descriptor.template!.content,
        filename: "ProjectDetailPage.vue",
        id: "project-page",
        compilerOptions: { bindingMetadata: script.bindings },
      }).errors,
    ).toEqual([]);
    expect(source).toContain('data-testid="project-tasks-button"');
    expect(source).toContain(
      'v-if="currentProject?.id === projectId && !isAICreatingMode"',
    );
    expect(source).toContain('v-model:open="showControlledTasks"');
    expect(source).toContain(':project-id="String(projectId)"');
    const shellSource = readFileSync(
      resolve(
        process.cwd(),
        "src/renderer/shell/projects/ProjectDetailDrawer.vue",
      ),
      "utf8",
    );
    const shell = parse(shellSource);
    expect(shell.errors).toEqual([]);
    const shellScript = compileScript(shell.descriptor, {
      id: "project-summary-drawer",
    });
    expect(
      compileTemplate({
        source: shell.descriptor.template!.content,
        filename: "ProjectDetailDrawer.vue",
        id: "project-summary-drawer",
        compilerOptions: { bindingMetadata: shellScript.bindings },
      }).errors,
    ).toEqual([]);
  });
});
