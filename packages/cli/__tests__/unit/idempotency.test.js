/**
 * idempotency — content-addressed edit-replay classification + deterministic
 * idempotency keys (P0-2 "Diff Apply 内容哈希" + "外部 API Idempotency Key").
 */
import { describe, it, expect } from "vitest";
import {
  EDIT_REPLAY,
  classifyEditReplay,
  editIdempotencyKey,
  operationIdempotencyKey,
} from "../../src/lib/idempotency.js";

describe("classifyEditReplay", () => {
  it("APPLY when old_string is still present", () => {
    expect(
      classifyEditReplay({
        content: "const a = 1;\n",
        oldString: "const a = 1;",
        newString: "const a = 2;",
      }),
    ).toBe(EDIT_REPLAY.APPLY);
  });

  it("ALREADY_APPLIED when old is gone and new is present (resumed replay)", () => {
    expect(
      classifyEditReplay({
        content: "const a = 2;\n",
        oldString: "const a = 1;",
        newString: "const a = 2;",
      }),
    ).toBe(EDIT_REPLAY.ALREADY_APPLIED);
  });

  it("CONFLICT when neither old nor new is present", () => {
    expect(
      classifyEditReplay({
        content: "totally unrelated\n",
        oldString: "const a = 1;",
        newString: "const a = 2;",
      }),
    ).toBe(EDIT_REPLAY.CONFLICT);
  });

  it("does NOT auto-detect a pure deletion (new_string empty) as already-applied", () => {
    expect(
      classifyEditReplay({
        content: "unrelated\n",
        oldString: "delete me",
        newString: "",
      }),
    ).toBe(EDIT_REPLAY.CONFLICT);
  });

  it("prefers APPLY when old is present even if new also appears elsewhere", () => {
    expect(
      classifyEditReplay({
        content: "x=2; x=1;",
        oldString: "x=1",
        newString: "x=2",
      }),
    ).toBe(EDIT_REPLAY.APPLY);
  });
});

describe("editIdempotencyKey", () => {
  it("is deterministic and sensitive to path / old / new / replaceAll", () => {
    const base = { path: "a.js", oldString: "a", newString: "b" };
    const k = editIdempotencyKey(base);
    expect(k).toMatch(/^edit_[0-9a-f]{40}$/);
    expect(editIdempotencyKey(base)).toBe(k); // stable
    expect(editIdempotencyKey({ ...base, path: "b.js" })).not.toBe(k);
    expect(editIdempotencyKey({ ...base, newString: "c" })).not.toBe(k);
    expect(editIdempotencyKey({ ...base, replaceAll: true })).not.toBe(k);
  });
});

describe("operationIdempotencyKey", () => {
  it("is stable across retries of the same effect (key order independent)", () => {
    const a = operationIdempotencyKey({
      tool: "publish_artifact",
      args: { title: "R", path: "/x", kind: "doc" },
    });
    const b = operationIdempotencyKey({
      tool: "publish_artifact",
      args: { kind: "doc", path: "/x", title: "R" }, // reordered
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^op_[0-9a-f]{40}$/);
  });

  it("differs when tool, args, or scope differ", () => {
    const base = { tool: "notify", args: { title: "t" } };
    const k = operationIdempotencyKey(base);
    expect(operationIdempotencyKey({ ...base, tool: "schedule" })).not.toBe(k);
    expect(operationIdempotencyKey({ ...base, args: { title: "u" } })).not.toBe(
      k,
    );
    expect(operationIdempotencyKey({ ...base, scope: "sess-1" })).not.toBe(k);
  });
});
