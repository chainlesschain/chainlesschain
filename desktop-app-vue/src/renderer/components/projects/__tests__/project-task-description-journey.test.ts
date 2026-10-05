import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import ProjectTaskDescriptionDrawer from "../ProjectTaskDescriptionDrawer.vue";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  createTaskDescriptionHost,
} = require("../../../../main/task/task-description-ipc.js");

describe("project task drawer through the real native host and database", () => {
  let db: any;
  let wrapper: VueWrapper;
  let actor: string;
  let dialog: ReturnType<typeof vi.fn>;
  let host: any;
  const event = {
    sender: {},
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  const owner = "did:chainlesschain:owner";

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT,
        status TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        task_type TEXT NOT NULL, description TEXT NOT NULL, status TEXT,
        org_id TEXT, workspace_id TEXT, updated_at INTEGER NOT NULL,
        created_at INTEGER, completed_at INTEGER, sync_status TEXT,
        deleted INTEGER DEFAULT 0, due_date INTEGER, blocked_by TEXT);
    `);
    db.prepare(
      "INSERT INTO projects (id,user_id,name,status,updated_at) VALUES (?,?,?,?,?)",
    ).run("project-1", owner, "Personal project", "active", 10);
    db.prepare(
      "INSERT INTO project_tasks (id,project_id,task_type,description,status,updated_at,created_at,sync_status,due_date) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      "task-1",
      "project-1",
      "query_info",
      "Persisted original",
      "pending",
      10,
      10,
      "synced",
      1,
    );
    actor = owner;
    dialog = vi.fn(async () => ({ response: 1 }));
    host = createTaskDescriptionHost({
      database: { getDatabase: () => db },
      getCurrentUserDid: () => actor,
      electron: {
        BrowserWindow: {
          fromWebContents: () => ({ isDestroyed: () => false }),
        },
        dialog: { showMessageBox: dialog },
      },
    });
    // Simulate Electron's structured-clone boundary in both directions. The
    // production service's frozen objects arrive as ordinary mutable renderer
    // data, so a Vue proxy must not be sent back to ipcRenderer.invoke.
    const bridge = (method: string) => async (input: unknown) =>
      structuredClone(await host[method](event, structuredClone(input)));
    (window as any).electronAPI = {
      task: {
        listControlledTasks: bridge("listTasks"),
        readControlledTask: bridge("readTask"),
        listDescriptionActionRuns: bridge("listRuns"),
        previewDescriptionUpdate: bridge("preview"),
        executeDescriptionUpdate: bridge("execute"),
      },
      project: { evaluateRisk: bridge("evaluateRisk") },
    };
  });
  afterEach(() => {
    wrapper?.unmount();
    db.close();
    delete (window as any).electronAPI;
  });

  async function openAndSelect() {
    wrapper = mount(ProjectTaskDescriptionDrawer, {
      props: { open: true, projectId: "project-1", identityKey: owner },
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
    expect(wrapper.text()).toContain("Persisted original");
    await wrapper.get('[data-task-id="task-1"]').trigger("click");
    await flushPromises();
  }

  it("lists, reads, previews, confirms, commits and reads durable history and risk evidence", async () => {
    await openAndSelect();
    await wrapper
      .get('[data-testid="task-description"]')
      .setValue("Agreed delivery note");
    await wrapper.get('[data-testid="preview-description"]').trigger("click");
    await flushPromises();
    expect(dialog).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Persisted original");
    expect(wrapper.get('[data-testid="description-preview"]').text()).toContain(
      "Agreed delivery note",
    );
    await wrapper.get('[data-testid="execute-description"]').trigger("click");
    await flushPromises();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][1].detail).toContain("Persisted original");
    expect(dialog.mock.calls[0][1].detail).toContain("Agreed delivery note");
    expect(
      db.prepare("SELECT description,sync_status FROM project_tasks").get(),
    ).toEqual({ description: "Agreed delivery note", sync_status: "pending" });
    expect(wrapper.get('[data-testid="current-receipt"]').text()).toBe(
      "修改已完成",
    );
    await wrapper.get('[data-testid="refresh-history"]').trigger("click");
    await flushPromises();
    const history = host.listRuns(event, { taskId: "task-1" });
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].evidence.map((record: any) => record.kind)).toEqual([
      "local-user-confirmation",
      "sqlite-task-description-update",
    ]);
    expect(wrapper.get('[data-testid="action-history"]').text()).toContain(
      history.runs[0].run.id,
    );
    await wrapper.get('[data-testid="evaluate-risk"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="risk-result"]').text()).toContain(
      "已逾期且未完成",
    );
    expect(wrapper.get('[data-testid="risk-result"]').text()).toContain(
      "补充任务描述不会消除",
    );
  });

  it("removes displayed native source data when the real host observes an ownership transfer", async () => {
    await openAndSelect();
    db.prepare("UPDATE projects SET user_id=? WHERE id=?").run(
      "did:chainlesschain:other",
      "project-1",
    );
    await wrapper.get('[data-testid="refresh-history"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("当前身份无访问权限");
    expect(wrapper.text()).not.toContain("Persisted original");
    expect(wrapper.find('[data-testid="task-editor"]').exists()).toBe(false);
    expect(dialog).not.toHaveBeenCalled();
  });
});
