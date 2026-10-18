import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import Component from "../BoardAttachments.vue";
import { useAppStore } from "../../../stores/app";
import { useIdentityStore } from "../../../stores/identity";

const summary = (extra = {}) => ({
  id: "attachment-1",
  taskId: "task-1",
  fileName: "notes.txt",
  fileSize: 5,
  mimeType: "text/plain",
  uploaderDid: "did:member",
  createdAt: 100,
  ...extra,
});
const list = (rows = [summary()]) => ({ success: true, attachments: rows });
const preview = (extra = {}) => ({
  success: true,
  attachment: summary(),
  preview: { kind: "text", text: "hello", base64: btoa("hello") },
  ...extra,
});
function pending() {
  let resolve!: (value: any) => void, reject!: (reason: any) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("board attachment component", () => {
  let wrapper: any, api: any, invalidate: () => void, unsubscribe: any;
  let createObjectURL: any, revokeObjectURL: any, click: any;
  let originalCreate: any, originalRevoke: any;
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    useAppStore().isAuthenticated = true;
    useAppStore().deviceId = "device-1";
    api = {
      getAttachments: vi.fn().mockResolvedValue(list()),
      uploadAttachment: vi.fn().mockResolvedValue({
        success: true,
        attachmentId: "new",
        activityId: "activity",
      }),
      deleteAttachment: vi.fn().mockResolvedValue({ success: true }),
      previewAttachment: vi.fn().mockResolvedValue(preview()),
    };
    unsubscribe = vi.fn();
    (window as any).electronAPI = {
      task: api,
      notification: {
        onInvalidated: vi.fn((fn) => {
          invalidate = fn;
          return unsubscribe;
        }),
      },
    };
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURL = vi.fn().mockReturnValue("blob:temporary-attachment");
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });
  afterEach(() => {
    wrapper?.unmount();
    click.mockRestore();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as any).electronAPI;
  });
  async function render() {
    wrapper = mount(Component, {
      props: { taskId: "task-1" },
      global: {
        stubs: { "a-button": { template: "<button><slot /></button>" } },
      },
    });
    await flushPromises();
  }
  async function action(name: string) {
    await wrapper.find(`[data-action="${name}"]`).trigger("click");
    await flushPromises();
  }
  it("lists only summaries and never retains response paths or bodies", async () => {
    api.getAttachments.mockResolvedValue(
      list([
        summary({
          filePath: "SECRET-PATH",
          content: "SECRET-CONTENT",
          base64: "SECRET-BYTES",
        }),
      ]),
    );
    await render();
    expect(api.getAttachments).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(wrapper.text()).toContain("notes.txt");
    expect(JSON.stringify(wrapper.vm.attachments)).not.toContain("SECRET");
  });
  it("uploads through the native picker API with only a task ID and refreshes", async () => {
    await render();
    await action("upload");
    expect(api.uploadAttachment).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(api.getAttachments).toHaveBeenCalledTimes(2);
  });
  it("treats picker cancellation as no mutation and preserves the list", async () => {
    await render();
    api.uploadAttachment.mockResolvedValue({ success: false, cancelled: true });
    await action("upload");
    expect(api.getAttachments).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("notes.txt");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("deletes only by attachment ID and reloads authoritative summaries", async () => {
    await render();
    api.getAttachments.mockResolvedValue(list([]));
    await action("delete");
    expect(api.deleteAttachment).toHaveBeenCalledWith({
      attachmentId: "attachment-1",
    });
    expect(wrapper.findAll("[data-attachment-id]")).toHaveLength(0);
  });
  it.each(["upload", "delete", "preview"])(
    "clears old data on denied %s without exposing native errors",
    async (name) => {
      await render();
      api[`${name === "delete" ? "delete" : name}Attachment`].mockResolvedValue(
        { success: false, error: "SECRET-PATH" },
      );
      await action(name);
      expect(wrapper.findAll("[data-attachment-id]")).toHaveLength(0);
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("SECRET-PATH");
    },
  );
  it("renders text as interpolation, never HTML or images", async () => {
    api.previewAttachment.mockResolvedValue(
      preview({
        preview: {
          kind: "text",
          text: '<img src=x onerror="alert(1)">',
          base64: "",
        },
      }),
    );
    await render();
    await action("preview");
    expect(wrapper.find("pre").text()).toContain("<img");
    expect(wrapper.findAll("img,iframe,object,embed,script")).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it.each(["refresh", "upload", "delete", "preview", "download"])(
    "shows a fixed storage-mode error for unsupported %s",
    async (name) => {
      await render();
      const method =
        name === "refresh"
          ? "getAttachments"
          : name === "download"
            ? "previewAttachment"
            : `${name}Attachment`;
      api[method].mockRejectedValue(
        new Error(
          "Error invoking remote method: BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED SECRET-PATH",
        ),
      );
      await action(name);
      expect(wrapper.find('[role="alert"]').text()).toBe(
        "当前存储模式不支持附件操作",
      );
      expect(wrapper.text()).not.toContain("SECRET-PATH");
      expect(wrapper.findAll("[data-attachment-id]")).toHaveLength(0);
    },
  );
  it("binary preview offers download without decoding or creating a URL", async () => {
    api.previewAttachment.mockResolvedValue(
      preview({
        attachment: summary({ mimeType: "image/svg+xml" }),
        preview: { kind: "download", base64: btoa("hello") },
      }),
    );
    await render();
    await action("preview");
    expect(wrapper.text()).toContain("不提供内嵌预览");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("downloads unsafe MIME only as octet-stream, with sanitized filename and fresh reads", async () => {
    api.previewAttachment.mockResolvedValue(
      preview({
        attachment: summary({
          fileName: "../unsafe\\page.html",
          mimeType: "text/html",
        }),
      }),
    );
    await render();
    await action("preview");
    await action("download");
    expect(api.previewAttachment).toHaveBeenCalledTimes(2);
    expect(createObjectURL.mock.calls[0][0].type).toBe(
      "application/octet-stream",
    );
    expect(createObjectURL.mock.calls[0][0].size).toBe(5);
    const anchor = click.mock.instances[0];
    expect(anchor.download).not.toMatch(/[\\/]/);
    expect(document.body.contains(anchor)).toBe(false);
    expect(wrapper.findAll("iframe,img,object,embed")).toHaveLength(0);
  });
  it.each([
    { attachment: summary({ taskId: "other-task" }) },
    { attachment: summary({ id: "other-attachment" }) },
    { attachment: summary({ fileSize: 6 }) },
    { preview: { kind: "html", base64: btoa("hello") } },
    { preview: { kind: "download", base64: "!!!invalid" } },
  ])(
    "rejects mismatched or malformed download projection %j",
    async (extra) => {
      api.previewAttachment.mockResolvedValue(preview(extra));
      await render();
      await action("download");
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    },
  );
  it("rejects text exceeding the preview byte cap", async () => {
    api.previewAttachment.mockResolvedValue(
      preview({
        preview: { kind: "text", text: "x".repeat(65537), base64: "" },
      }),
    );
    await render();
    await action("preview");
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it.each(["login", "device", "vault", "task", "host", "unmount"])(
    "discards late preview after %s invalidation",
    async (kind) => {
      await render();
      const late = pending();
      api.previewAttachment.mockReturnValueOnce(late.promise);
      await action("preview");
      if (kind === "login") {
        useAppStore().setAuthenticated(false);
        useAppStore().setAuthenticated(true);
      } else if (kind === "device") {
        useAppStore().setDeviceId("other");
        useAppStore().setDeviceId("device-1");
      } else if (kind === "vault")
        useIdentityStore().contexts.personal.localDB = "another.db";
      else if (kind === "task") {
        api.getAttachments.mockResolvedValue(list([]));
        await wrapper.setProps({ taskId: "task-2" });
      } else if (kind === "host") invalidate();
      else wrapper.unmount();
      late.resolve(
        preview({ preview: { kind: "text", text: "LATE-SECRET", base64: "" } }),
      );
      await flushPromises();
      expect(wrapper.text()).not.toContain("LATE-SECRET");
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );
  it.each(["timer", "host", "task", "logout", "unmount"])(
    "revokes the Blob URL on %s",
    async (kind) => {
      await render();
      await action("download");
      if (kind === "timer") await vi.advanceTimersByTimeAsync(1000);
      else if (kind === "host") invalidate();
      else if (kind === "task") {
        api.getAttachments.mockResolvedValue(list([]));
        await wrapper.setProps({ taskId: "task-2" });
      } else if (kind === "logout") useAppStore().setAuthenticated(false);
      else wrapper.unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:temporary-attachment");
    },
  );
  it("does not allow an old failed list to clear a new task's list", async () => {
    const old = pending();
    api.getAttachments.mockReturnValueOnce(old.promise);
    await render();
    api.getAttachments.mockResolvedValue(
      list([summary({ taskId: "task-2", fileName: "new.txt" })]),
    );
    await wrapper.setProps({ taskId: "task-2" });
    await flushPromises();
    old.reject(new Error("old denied"));
    await flushPromises();
    expect(wrapper.text()).toContain("new.txt");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
