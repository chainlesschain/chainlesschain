import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentLoop,
  _resetSubtreeInstructionLoaders,
} from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
const text = (content = "Let me retry write_file") => ({
  message: { role: "assistant", content },
});
const write = (target) => ({
  message: {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: target, content: "delivered" }),
        },
      },
    ],
  },
});
describe("subtree deferred mutation termination", () => {
  let root;
  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-deferred-")),
    );
    for (const dir of ["a", "b"]) {
      fs.mkdirSync(path.join(root, dir));
      fs.writeFileSync(
        path.join(root, dir, "AGENTS.md"),
        "Use plain text. Do not write secrets.",
      );
    }
    _resetSubtreeInstructionLoaders();
  });
  afterEach(() => {
    _resetSubtreeInstructionLoaders();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function run(replies, limit = 10) {
    const chatFn = vi.fn(async () => replies.shift() || text());
    const events = [];
    for await (const event of agentLoop(
      [
        {
          role: "user",
          content: "Write the requested file, obeying all rules.",
        },
      ],
      {
        cwd: root,
        chatFn,
        permissionMode: "acceptEdits",
        contextMemorySkipPlanning: true,
        iterationBudget: new IterationBudget({ limit }),
      },
    ))
      events.push(event);
    return {
      events,
      chatFn,
      reason: events.findLast((e) => e.type === "run-ended")?.reason,
    };
  }
  it("reminds once without replay and reports incomplete", async () => {
    const r = await run([
      write("a/out.txt"),
      text(),
      text("Cannot proceed under the rules."),
    ]);
    expect(r.reason).toBe("deferred-mutation-unresolved");
    expect(r.chatFn).toHaveBeenCalledTimes(3);
    expect(fs.existsSync(path.join(root, "a/out.txt"))).toBe(false);
    expect(r.events.filter((e) => e.type === "tool-result")).toHaveLength(1);
  });
  it("allows an explicit retry and writes exactly once", async () => {
    const r = await run([
      write("a/out.txt"),
      text(),
      write("a/./out.txt"),
      text("done"),
    ]);
    expect(r.reason).toBe("complete");
    expect(fs.readFileSync(path.join(root, "a/out.txt"), "utf8")).toBe(
      "delivered",
    );
    const results = r.events.filter((e) => e.type === "tool-result");
    expect(results).toHaveLength(2);
    expect(results[0].result.mutationPerformed).toBe(false);
    expect(results[1].result.error).toBeUndefined();
  });
  it("does not clear an unrelated target", async () => {
    const r = await run([
      write("a/out.txt"),
      write("other.txt"),
      text(),
      text(),
    ]);
    expect(r.reason).toBe("deferred-mutation-unresolved");
    expect(fs.existsSync(path.join(root, "other.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "a/out.txt"))).toBe(false);
  });
  it("retains multiple targets independently", async () => {
    const r = await run([
      write("a/out.txt"),
      write("b/out.txt"),
      write("a/out.txt"),
      text(),
      text(),
    ]);
    expect(r.reason).toBe("deferred-mutation-unresolved");
    expect(r.events.at(-1).pendingMutations).toEqual([
      { tool: "write_file", targets: [path.join(root, "b/out.txt")] },
    ]);
  });
  it("never exceeds the existing budget", async () => {
    const r = await run([write("a/out.txt")], 1);
    expect(r.reason).toBe("budget-exhausted");
    expect(r.chatFn).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(root, "a/out.txt"))).toBe(false);
  });
  it("records both source and destination for a deferred move", async () => {
    fs.writeFileSync(path.join(root, "a/source.txt"), "original");
    const move = {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "move",
            type: "function",
            function: {
              name: "move_file",
              arguments: JSON.stringify({
                path: "a/source.txt",
                target_path: "b/dest.txt",
              }),
            },
          },
        ],
      },
    };
    const r = await run([move, text(), text()]);
    expect(r.reason).toBe("deferred-mutation-unresolved");
    expect(r.events.at(-1).pendingMutations).toEqual([
      {
        tool: "move_file",
        targets: [
          path.join(root, "a/source.txt"),
          path.join(root, "b/dest.txt"),
        ].sort(),
      },
    ]);
    expect(fs.readFileSync(path.join(root, "a/source.txt"), "utf8")).toBe(
      "original",
    );
    expect(fs.existsSync(path.join(root, "b/dest.txt"))).toBe(false);
  });
  it("ends incomplete without another call when the final response uses the last budget slot", async () => {
    const r = await run([write("a/out.txt"), text()], 2);
    expect(r.reason).toBe("deferred-mutation-unresolved");
    expect(r.chatFn).toHaveBeenCalledTimes(2);
  });
  it("allows ordinary answers and successful writes", async () => {
    expect((await run([text("Answer only")])).reason).toBe("complete");
    expect((await run([write("plain.txt"), text("done")])).reason).toBe(
      "complete",
    );
  });
});
