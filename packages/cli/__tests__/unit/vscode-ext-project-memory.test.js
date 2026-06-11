/** VS Code extension — project-memory palette commands (pure module). */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);
const {
  TERMINAL_NAME,
  buildInitCommand,
  buildMemoryFilesCommand,
  initQuickPickItems,
  runInTerminal,
} = require_("../../../vscode-extension/src/project-memory-commands.js");

describe("command builders", () => {
  it("builds init variants", () => {
    expect(buildInitCommand()).toBe("chainlesschain init");
    expect(buildInitCommand({ ai: true })).toBe("chainlesschain init --ai");
    expect(buildInitCommand({ force: true })).toBe(
      "chainlesschain init --force",
    );
    expect(buildInitCommand({ ai: true, force: true })).toBe(
      "chainlesschain init --ai --force",
    );
    expect(buildMemoryFilesCommand()).toBe("chainlesschain memory files");
  });

  it("quick-pick items map to offline and --ai modes", () => {
    const items = initQuickPickItems();
    expect(items).toHaveLength(2);
    expect(items[0].args).toEqual({});
    expect(items[1].args).toEqual({ ai: true });
    expect(buildInitCommand(items[1].args)).toContain("--ai");
  });
});

describe("runInTerminal", () => {
  function fakeVscode(existingTerminals = []) {
    const created = [];
    return {
      created,
      window: {
        terminals: existingTerminals,
        createTerminal: (opts) => {
          const t = {
            name: opts.name,
            cwd: opts.cwd,
            sent: [],
            shown: 0,
            show() {
              this.shown += 1;
            },
            sendText(cmd) {
              this.sent.push(cmd);
            },
          };
          created.push(t);
          return t;
        },
      },
    };
  }

  it("creates the shared terminal at cwd and sends the command", () => {
    const api = fakeVscode();
    const term = runInTerminal(api, "chainlesschain init", "C:/proj");
    expect(api.created).toHaveLength(1);
    expect(term.name).toBe(TERMINAL_NAME);
    expect(term.cwd).toBe("C:/proj");
    expect(term.sent).toEqual(["chainlesschain init"]);
    expect(term.shown).toBe(1);
  });

  it("reuses a live terminal with the shared name, skips exited ones", () => {
    const live = {
      name: TERMINAL_NAME,
      sent: [],
      shown: 0,
      show() {
        this.shown += 1;
      },
      sendText(c) {
        this.sent.push(c);
      },
    };
    const dead = { name: TERMINAL_NAME, exitStatus: { code: 0 } };
    const api = fakeVscode([dead, live]);
    const term = runInTerminal(api, "chainlesschain memory files");
    expect(term).toBe(live);
    expect(api.created).toHaveLength(0);
    expect(live.sent).toEqual(["chainlesschain memory files"]);
  });
});
