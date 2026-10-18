import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { route, messages } = vi.hoisted(() => ({
  route: { value: null as any },
  messages: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("vue-router", () => ({
  useRoute: () => route.value,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("ant-design-vue", () => ({ message: messages }));
vi.mock("@ant-design/icons-vue", () => ({
  PlusOutlined: {},
  FilterOutlined: {},
  SearchOutlined: {},
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => ({}) }));
let boardStore: any;
vi.mock("@/stores/taskBoard", () => ({ useTaskBoardStore: () => boardStore }));
import Page from "../TaskBoardPage.vue";
import { useAppStore } from "../../../stores/app";
import { useIdentityStore } from "../../../stores/identity";

const target = { taskId: "task-1", boardId: "board-1", orgId: "org-1" };
const pending = () => {
  let resolve!: (value: any) => void;
  let reject!: (reason: any) => void;
  return {
    promise: new Promise((r, fail) => {
      resolve = r;
      reject = fail;
    }),
    resolve: (value: any) => resolve(value),
    reject: (reason: any) => reject(reason),
  };
};

describe("task notice route and manual mention", () => {
  let wrapper: any, api: any;
  beforeEach(() => {
    setActivePinia(createPinia());
    useAppStore().isAuthenticated = true;
    route.value = reactive({
      params: { id: "board-1" },
      query: { taskId: "task-1", taskNoticeId: "cc-board-mention:notice" },
    });
    boardStore = reactive({
      currentBoard: null,
      columns: [],
      tasks: [],
      filteredTasks: [],
      currentTask: null,
      taskDetailVisible: false,
      filters: {},
      loadBoard: vi.fn().mockResolvedValue({ success: true }),
      closeTaskDetail: vi.fn(() => {
        boardStore.currentTask = null;
        boardStore.taskDetailVisible = false;
      }),
    });
    api = {
      notification: {
        openTask: vi.fn().mockResolvedValue({ success: true, target }),
        onInvalidated: vi.fn(() => vi.fn()),
      },
      task: { mentionUser: vi.fn().mockResolvedValue({ success: true }) },
      invoke: vi.fn(async (channel: string) =>
        channel === "task:get-board"
          ? { success: true, board: { id: "board-1", orgId: "org-1" } }
          : {
              success: true,
              task: { id: "task-1", boardId: "board-1", title: "Fresh task" },
            },
      ),
    };
    (window as any).electronAPI = api;
    vi.clearAllMocks();
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
  });
  function render() {
    wrapper = mount(Page, {
      global: {
        stubs: {
          BoardTaskCreator: {
            name: "BoardTaskCreator",
            props: ["boardId", "initialColumnId"],
            emits: ["created"],
            template: "<div data-creator-stub />",
          },
          ...Object.fromEntries(
            [
              "a-radio-button",
              "a-radio-group",
              "a-space",
              "a-page-header",
              "a-col",
              "a-select-option",
              "a-select",
              "a-row",
              "a-card",
              "a-badge",
              "a-tag",
              "a-avatar",
              "a-spin",
              "a-table",
              "a-form-item",
              "a-textarea",
              "a-date-picker",
              "a-form",
              "a-modal",
              "a-descriptions-item",
              "a-descriptions",
              "a-divider",
            ].map((name) => [name, { template: "<div><slot /></div>" }]),
          ),
          "a-drawer": { template: "<div><slot /></div>" },
          "a-button": { template: "<button><slot /></button>" },
          "a-input": {
            props: ["value"],
            emits: ["update:value"],
            template:
              '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
          },
        },
      },
    });
    return flushPromises();
  }
  it("opens fresh task only after matching board/org and a final notice recheck", async () => {
    await render();
    expect(api.notification.openTask).toHaveBeenCalledTimes(2);
    expect(boardStore.currentTask.title).toBe("Fresh task");
    expect(boardStore.taskDetailVisible).toBe(true);
  });
  it.each(["board", "org", "task", "revoked"])(
    "rejects %s mismatch without filling the drawer",
    async (kind) => {
      if (kind === "revoked")
        api.notification.openTask
          .mockResolvedValueOnce({ success: true, target })
          .mockResolvedValueOnce({ success: false });
      else
        api.invoke.mockImplementation(async (channel: string) =>
          channel === "task:get-board"
            ? {
                success: true,
                board: {
                  id: kind === "board" ? "other" : "board-1",
                  orgId: kind === "org" ? "other" : "org-1",
                },
              }
            : {
                success: true,
                task: {
                  id: kind === "task" ? "other" : "task-1",
                  boardId: "board-1",
                },
              },
        );
      await render();
      expect(boardStore.currentTask).toBeNull();
      expect(boardStore.taskDetailVisible).toBe(false);
    },
  );
  it.each([
    "logout",
    "same-session-login",
    "same-device-return",
    "vault",
    "route",
  ])("discards late task contents across %s changes", async (kind) => {
    const late = pending();
    api.invoke.mockImplementation(async (channel: string) =>
      channel === "task:get-board"
        ? { success: true, board: { id: "board-1", orgId: "org-1" } }
        : late.promise,
    );
    await render();
    if (kind === "logout") {
      useAppStore().isAuthenticated = false;
      useAppStore().isAuthenticated = true;
    } else if (kind === "same-session-login") {
      useAppStore().setAuthenticated(false);
      useAppStore().setAuthenticated(true);
    } else if (kind === "same-device-return") {
      const original = useAppStore().deviceId;
      useAppStore().setDeviceId("temporary-device");
      useAppStore().setDeviceId(original);
    } else if (kind === "vault")
      useIdentityStore().contexts.personal.localDB = "changed.db";
    else route.value.params.id = "other-board";
    late.resolve({
      success: true,
      task: { id: "task-1", boardId: "board-1", title: "Late secret" },
    });
    await flushPromises();
    expect(boardStore.currentTask).toBeNull();
  });
  it("clears an open drawer when the notice route is removed", async () => {
    await render();
    route.value.query = {};
    await flushPromises();
    expect(boardStore.currentTask).toBeNull();
  });
  it("clears an open drawer on host invalidation and removes its listener", async () => {
    await render();
    const invalidate = api.notification.onInvalidated.mock.calls[0][0];
    invalidate();
    expect(boardStore.currentTask).toBeNull();
    wrapper.unmount();
    expect(
      api.notification.onInvalidated.mock.results[0].value,
    ).toHaveBeenCalledOnce();
  });
  it("does not let an old rejected open erase the newly authorized drawer", async () => {
    const old = pending();
    api.notification.openTask.mockReturnValueOnce(old.promise);
    await render();
    route.value.query.taskNoticeId = "cc-board-mention:new";
    await flushPromises();
    expect(boardStore.currentTask.title).toBe("Fresh task");
    old.reject(new Error("Old source denied"));
    await flushPromises();
    expect(boardStore.currentTask.title).toBe("Fresh task");
  });
  it("submits only task ID and recipient DID through the scoped preload", async () => {
    await render();
    const field = wrapper.find('input[placeholder="输入成员 DID"]');
    await field.setValue(" did:recipient ");
    const button = wrapper
      .findAll("button")
      .find((node: any) => node.text() === "发送任务通知");
    await button.trigger("click");
    await flushPromises();
    expect(api.task.mentionUser).toHaveBeenCalledWith({
      taskId: "task-1",
      userDid: "did:recipient",
    });
    expect(messages.success).toHaveBeenCalledWith("任务通知已发送");
  });
  it("shows a generic failure when mention authorization is denied", async () => {
    await render();
    api.task.mentionUser.mockResolvedValue({
      success: false,
      error: "internal secret",
    });
    await wrapper
      .find('input[placeholder="输入成员 DID"]')
      .setValue("did:recipient");
    await wrapper
      .findAll("button")
      .find((node: any) => node.text() === "发送任务通知")
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("无法发送任务通知");
    expect(wrapper.text()).not.toContain("internal secret");
  });
  it("refreshes detail and list from scoped reads after a controlled update", async () => {
    await render();
    const fresh = { id: "task-1", boardId: "board-1", title: "Saved title" };
    api.task.getTask = vi
      .fn()
      .mockResolvedValue({ success: true, task: fresh });
    api.task.getTasks = vi
      .fn()
      .mockResolvedValue({ success: true, tasks: [fresh] });
    await wrapper.vm.refreshEditedTask();
    expect(api.task.getTask).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(api.task.getTasks).toHaveBeenCalledWith({ boardId: "board-1" });
    expect(boardStore.currentTask.title).toBe("Saved title");
    expect(boardStore.tasks).toEqual([fresh]);
  });
  it("closes detail when the fresh list no longer contains the edited task", async () => {
    await render();
    api.task.getTask = vi.fn().mockResolvedValue({
      success: true,
      task: { id: "task-1", boardId: "board-1" },
    });
    api.task.getTasks = vi.fn().mockResolvedValue({ success: true, tasks: [] });
    await wrapper.vm.refreshEditedTask();
    expect(boardStore.currentTask).toBeNull();
  });
  it("does not publish refreshed task data after authentication ABA", async () => {
    await render();
    const call = pending();
    api.task.getTask = vi.fn().mockResolvedValue({
      success: true,
      task: { id: "task-1", boardId: "board-1", title: "Late title" },
    });
    api.task.getTasks = vi.fn().mockReturnValue(call.promise);
    const work = wrapper.vm.refreshEditedTask();
    await flushPromises();
    useAppStore().isAuthenticated = false;
    useAppStore().isAuthenticated = true;
    call.resolve({
      success: true,
      tasks: [{ id: "task-1", boardId: "board-1" }],
    });
    await work;
    expect(boardStore.currentTask).toBeNull();
    expect(boardStore.tasks).toEqual([]);
  });
  it("does not overwrite a different detail selected during refresh", async () => {
    await render();
    const call = pending();
    api.task.getTask = vi.fn().mockReturnValue(call.promise);
    api.task.getTasks = vi.fn();
    const work = wrapper.vm.refreshEditedTask();
    boardStore.currentTask = {
      id: "task-2",
      boardId: "board-1",
      title: "Other task",
    };
    call.resolve({ success: true, task: { id: "task-1", boardId: "board-1" } });
    await work;
    expect(boardStore.currentTask.id).toBe("task-2");
    expect(api.task.getTasks).not.toHaveBeenCalled();
  });
  it("connects the creator to the selected column and refreshes only the authoritative list on success", async () => {
    await render();
    wrapper.vm.createTaskInColumn("column-2");
    await flushPromises();
    const creator = wrapper.findComponent({ name: "BoardTaskCreator" });
    expect(creator.props()).toMatchObject({
      boardId: "board-1",
      initialColumnId: "column-2",
    });
    api.task.getTasks = vi.fn().mockResolvedValue({
      success: true,
      tasks: [{ id: "new-task", boardId: "board-1", title: "Actual title" }],
    });
    creator.vm.$emit("created", "new-task");
    await flushPromises();
    expect(api.task.getTasks).toHaveBeenCalledWith({ boardId: "board-1" });
    expect(boardStore.tasks[0].title).toBe("Actual title");
    expect(wrapper.vm.showCreateTask).toBe(false);
  });
  it("does not claim a refreshed list when the created task is missing", async () => {
    await render();
    wrapper.vm.createTaskInColumn(null);
    api.task.getTasks = vi.fn().mockResolvedValue({ success: true, tasks: [] });
    await wrapper.vm.refreshCreatedTask("new-task");
    expect(boardStore.tasks).toEqual([]);
    expect(wrapper.vm.showCreateTask).toBe(true);
    expect(messages.error).toHaveBeenCalledWith(
      "任务已创建，列表刷新失败，请重新读取看板。",
    );
  });
  it.each(["auth", "route", "modal"])(
    "discards delayed created lists across %s ABA",
    async (kind) => {
      await render();
      wrapper.vm.createTaskInColumn(null);
      const delayed = pending();
      api.task.getTasks = vi.fn().mockReturnValue(delayed.promise);
      const operation = wrapper.vm.refreshCreatedTask("new-task");
      if (kind === "auth") {
        useAppStore().isAuthenticated = false;
        useAppStore().isAuthenticated = true;
      }
      if (kind === "route") {
        route.value.params.id = "other";
        route.value.params.id = "board-1";
      }
      if (kind === "modal") {
        wrapper.vm.showCreateTask = false;
        wrapper.vm.showCreateTask = true;
      }
      delayed.resolve({
        success: true,
        tasks: [{ id: "new-task", boardId: "board-1" }],
      });
      await operation;
      expect(boardStore.tasks).toEqual([]);
      expect(messages.success).not.toHaveBeenCalled();
    },
  );
});
