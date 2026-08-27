import { afterEach, describe, expect, it, vi } from "vitest";

const EmailIPCHandler = require("../../../src/main/api/email-ipc.js");
const {
  EmailIPCBoundaryError,
} = require("../../../src/main/api/email-ipc-boundaries.js");

function createHandler({
  prepare,
  limits = {},
  clientFactory,
  ...options
} = {}) {
  const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };
  const database = {
    db: {
      prepare: vi.fn(
        prepare ||
          (() => ({
            all: vi.fn(() => []),
            get: vi.fn(),
            run: vi.fn(() => ({ changes: 1 })),
          })),
      ),
    },
  };
  const credentialStore = options.credentialStore || {
    migrateDatabase: vi.fn(),
    setPassword: vi.fn((id) => `cc-email-secret:v1:${id}`),
    getPassword: vi.fn(() => "secret"),
    deletePassword: vi.fn(),
  };
  const handler = new EmailIPCHandler(database, {
    appDataPath: "C:\\bounded-app-data",
    ipcMain,
    limits,
    clientFactory,
    credentialStore,
    migrateCredentials: false,
    registerHandlers: false,
    ...options,
  });
  return { credentialStore, database, handler, ipcMain };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Email IPC resource boundaries", () => {
  it("registers and removes exactly the fixed channel surface", () => {
    const { handler, ipcMain } = createHandler();

    handler.registerHandlers();
    handler.registerHandlers();
    expect(ipcMain.handle).toHaveBeenCalledTimes(30);

    handler.cleanup();
    handler.cleanup();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(30);
    expect(() => handler.registerHandlers()).toThrow(EmailIPCBoundaryError);
  });

  it("rejects dynamic account columns before preparing an UPDATE", async () => {
    const prepared = [];
    const { handler } = createHandler({
      prepare: (query) => {
        prepared.push(query);
        return {
          get: vi.fn(() => ({ id: "account-1", password: "ref" })),
          run: vi.fn(),
        };
      },
    });

    await expect(
      handler.updateAccount("account-1", { "status = 'active' --": true }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "email_account_update_field",
    });
    expect(prepared.some((query) => query.startsWith("UPDATE"))).toBe(false);
    handler.cleanup();
  });

  it("stores only an opaque credential reference in the account row", async () => {
    const inserted = [];
    const credentialStore = {
      migrateDatabase: vi.fn(),
      setPassword: vi.fn(() => "opaque-email-secret-ref"),
      getPassword: vi.fn(() => "plain-secret"),
      deletePassword: vi.fn(),
    };
    const client = {
      configure: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    };
    const { handler } = createHandler({
      credentialStore,
      clientFactory: () => client,
      prepare: (query) => {
        if (query.startsWith("SELECT COUNT")) {
          return { get: vi.fn(() => ({ count: 0 })) };
        }
        if (query.includes("INSERT INTO email_accounts")) {
          return { run: vi.fn((params) => inserted.push(params)) };
        }
        throw new Error(`unexpected query: ${query}`);
      },
    });
    handler.syncMailboxes = vi.fn().mockResolvedValue({ success: true });
    handler.startAutoSync = vi.fn();

    await handler.addAccount({
      email: "one@example.com",
      password: "plain-secret",
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
      autoSync: false,
    });

    expect(credentialStore.setPassword).toHaveBeenCalledWith(
      expect.any(String),
      "plain-secret",
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain("opaque-email-secret-ref");
    expect(inserted[0]).not.toContain("plain-secret");
    handler.cleanup();
  });

  it("binds default LIMIT/OFFSET values for email collections", async () => {
    let statement;
    const { handler } = createHandler({
      limits: { maxEmails: 4, maxQueryOffset: 9 },
      prepare: (query) => {
        statement = { query, all: vi.fn(() => []) };
        return statement;
      },
    });

    await handler.getEmails({ limit: 999, offset: 999 });

    expect(statement.query).toContain("LIMIT ? OFFSET ?");
    expect(statement.all).toHaveBeenCalledWith([4, 9]);
    handler.cleanup();
  });

  it("caps retained clients and rejects overlapping fetches per account", async () => {
    let releaseFetch;
    const client = {
      configure: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      fetchEmails: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseFetch = resolve;
          }),
      ),
      disconnect: vi.fn(),
    };
    const { handler } = createHandler({
      limits: { maxClients: 1, maxConcurrentFetches: 1 },
      clientFactory: () => client,
      prepare: (query) => {
        if (query.includes("FROM email_accounts WHERE id")) {
          return {
            get: vi.fn(() => ({
              id: "account-1",
              email: "one@example.com",
              password: "cc-email-secret:v1:account-1",
              imap_host: "imap.example.com",
              imap_port: 993,
              imap_tls: 1,
              smtp_host: "smtp.example.com",
              smtp_port: 587,
              smtp_secure: 0,
            })),
          };
        }
        return { run: vi.fn(() => ({ changes: 1 })) };
      },
    });
    handler.saveEmails = vi.fn().mockResolvedValue(undefined);

    const firstFetch = handler.fetchEmails("account-1");
    await Promise.resolve();
    await expect(handler.fetchEmails("account-1")).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "email_fetches",
    });
    expect(() => handler.getEmailClient("account-2")).toThrow(
      EmailIPCBoundaryError,
    );

    releaseFetch([]);
    await firstFetch;
    expect(client.disconnect).toHaveBeenCalled();
    handler.cleanup();
  });

  it("uses a main-owned save dialog instead of a renderer path", async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const showSaveDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: "C:\\chosen\\report.pdf",
    });
    const { handler } = createHandler({
      fs: {
        copyFile,
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        realpath: vi.fn(async (value) => value),
      },
      showSaveDialog,
      prepare: () => ({
        get: vi.fn(() => ({
          id: "attachment-1",
          filename: "report.pdf",
          file_path: "C:\\bounded-app-data\\attachments\\report.pdf",
        })),
      }),
    });

    await expect(handler.downloadAttachment("attachment-1")).resolves.toEqual({
      success: true,
      filePath: "C:\\chosen\\report.pdf",
    });
    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "report.pdf" }),
    );
    expect(copyFile).toHaveBeenCalledWith(
      "C:\\bounded-app-data\\attachments\\report.pdf",
      "C:\\chosen\\report.pdf",
    );
    handler.cleanup();
  });

  it("rejects a database attachment path outside the managed root", async () => {
    const copyFile = vi.fn();
    const showSaveDialog = vi.fn();
    const { handler } = createHandler({
      fs: {
        copyFile,
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        realpath: vi.fn(async (value) =>
          value.endsWith("attachments")
            ? "C:\\bounded-app-data\\attachments"
            : "C:\\outside\\secret.txt",
        ),
      },
      showSaveDialog,
      prepare: () => ({
        get: vi.fn(() => ({
          id: "attachment-1",
          filename: "secret.txt",
          file_path: "C:\\outside\\secret.txt",
        })),
      }),
    });

    await expect(
      handler.downloadAttachment("attachment-1"),
    ).rejects.toMatchObject({
      code: "PATH_OUTSIDE_ROOT",
      scope: "email_attachment_source",
    });
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
    handler.cleanup();
  });
});
