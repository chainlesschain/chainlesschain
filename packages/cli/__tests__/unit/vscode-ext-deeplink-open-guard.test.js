/**
 * Deep-link file containment: `vscode://…/open?file=…` is untrusted input
 * (any web page can mint one). openFileAtLine must refuse to open a target
 * outside the open workspace folders — absolute paths elsewhere, `..`
 * escapes, UNC/device paths — instead of displaying any readable file
 * (e.g. `?file=C:\Users\me\.ssh\id_rsa`). Same boundary as the MCP tools
 * (ide-path-guard). Headless (no vscode host).
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function makeMemento() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
  };
}

function makeProvider({ folder = "C:\\ws" } = {}) {
  const opened = [];
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {
      showTextDocument: async () => {},
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: folder } }],
      getConfiguration: () => ({ get: () => undefined }),
      openTextDocument: async (p) => {
        opened.push(p);
        return { fake: true };
      },
    },
    Position: class {
      constructor(l, c) {
        this.line = l;
        this.character = c;
      }
    },
    Range: class {
      constructor(a, b) {
        this.start = a;
        this.end = b;
      }
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true, send: () => true }) },
    state: makeMemento(),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, opened, posted };
}

describe.runIf(process.platform === "win32")(
  "openFileAtLine — workspace containment (win32 paths)",
  () => {
    it("opens a relative path inside the workspace", async () => {
      const { provider, opened } = makeProvider();
      await provider.openFileAtLine("src\\index.js", 3);
      expect(opened).toEqual(["C:\\ws\\src\\index.js"]);
    });

    it("opens an absolute path inside the workspace", async () => {
      const { provider, opened } = makeProvider();
      await provider.openFileAtLine("C:\\ws\\readme.md", null);
      expect(opened).toEqual(["C:\\ws\\readme.md"]);
    });

    it("rejects an absolute path outside every workspace folder", async () => {
      const { provider, opened, posted } = makeProvider();
      await provider.openFileAtLine("C:\\Users\\me\\.ssh\\id_rsa", 1);
      expect(opened).toEqual([]);
      const err = posted.find((p) => p.kind === "error");
      expect(err?.text).toContain("outside the open workspace");
    });

    it("rejects a relative path that escapes the workspace root", async () => {
      const { provider, opened } = makeProvider();
      await provider.openFileAtLine("..\\secrets\\key.pem", 1);
      expect(opened).toEqual([]);
    });

    it("rejects UNC targets", async () => {
      const { provider, opened } = makeProvider();
      await provider.openFileAtLine("\\\\evil\\share\\x.txt", 1);
      expect(opened).toEqual([]);
    });

    it("rejects a prefix-confusion sibling (C:\\ws2 is not inside C:\\ws)", async () => {
      const { provider, opened } = makeProvider();
      await provider.openFileAtLine("C:\\ws2\\x.txt", 1);
      expect(opened).toEqual([]);
    });
  },
);

describe("openFileAtLine — containment (posix paths)", () => {
  it("allows inside, rejects outside", async () => {
    const { provider, opened } = makeProvider({ folder: "/ws" });
    await provider.openFileAtLine(
      process.platform === "win32" ? "C:\\etc\\passwd" : "/etc/passwd",
      1,
    );
    expect(opened).toEqual([]);
  });
});
