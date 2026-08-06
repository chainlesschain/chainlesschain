import { describe, expect, it } from "vitest";
import {
  createSessionPersistenceFailure,
  isSessionPersistenceFailure,
  projectSessionPersistenceFailure,
} from "../../src/lib/session-persistence-failure.js";

describe("session persistence failure", () => {
  it("projects only bounded content-free ENOSPC diagnostics", () => {
    const cause = new Error("secret path and transcript content");
    cause.code = "ENOSPC";
    cause.path = "C:/private/session.jsonl";
    const error = createSessionPersistenceFailure(cause, {
      sessionId: "private-session-id",
      operation: "transcript-append",
      commitState: "unknown",
    });

    expect(isSessionPersistenceFailure(error)).toBe(true);
    expect(
      projectSessionPersistenceFailure(error, { phase: "after-model" }),
    ).toEqual({
      schema: "chainlesschain.session-persistence-failure.v1",
      code: "CC_SESSION_PERSISTENCE_FAILED",
      fs_code: "ENOSPC",
      operation: "transcript-append",
      phase: "after-model",
      commit_state: "unknown",
      retryable: false,
    });
    expect(JSON.stringify(projectSessionPersistenceFailure(error))).not.toMatch(
      /private|secret|transcript content/,
    );
  });

  it("allows ENOSPC retry only when non-commit is known", () => {
    const cause = Object.assign(new Error("full"), { code: "ENOSPC" });
    expect(
      createSessionPersistenceFailure(cause, {
        commitState: "not-committed",
      }),
    ).toMatchObject({ commitState: "not-committed", retryable: true });
    expect(
      createSessionPersistenceFailure(cause, { commitState: "committed" }),
    ).toMatchObject({ commitState: "committed", retryable: false });
  });

  it("classifies raw EROFS as not committed and ignores unrelated failures", () => {
    const readOnly = Object.assign(new Error("read only"), { code: "EROFS" });
    const classified = createSessionPersistenceFailure(readOnly, {
      operation: "append-event",
    });

    expect(classified).toMatchObject({
      code: "CC_SESSION_PERSISTENCE_FAILED",
      fsCode: "EROFS",
      commitState: "not-committed",
      retryable: false,
    });

    const unrelated = Object.assign(new Error("permission"), {
      code: "EACCES",
    });
    expect(createSessionPersistenceFailure(unrelated)).toBe(unrelated);
  });

  it("finds a storage code through a bounded domain cause chain", () => {
    const disk = Object.assign(new Error("private disk detail"), {
      code: "ENOSPC",
    });
    const nested = new Error("nested", { cause: disk });
    const domain = Object.assign(
      new Error("anchor failed", { cause: nested }),
      {
        code: "SESSION_INDEX_ANCHOR_FAILED",
        commitState: "unknown",
      },
    );

    expect(
      createSessionPersistenceFailure(domain, {
        operation: "append-authority-event",
        commitState: domain.commitState,
      }),
    ).toMatchObject({
      code: "CC_SESSION_PERSISTENCE_FAILED",
      fsCode: "ENOSPC",
      operation: "append-authority-event",
      commitState: "unknown",
      retryable: false,
    });
  });

  it("projects only fixed operation and phase vocabularies", () => {
    const error = Object.assign(new Error("classified"), {
      code: "CC_SESSION_PERSISTENCE_FAILED",
      fsCode: "ENOSPC",
      operation: "C:/private/session.jsonl",
      commitState: "unknown",
      retryable: true,
    });

    expect(
      projectSessionPersistenceFailure(error, {
        phase: "secret transcript content",
      }),
    ).toMatchObject({
      operation: "unknown",
      phase: "unspecified",
      retryable: false,
    });
    expect(JSON.stringify(projectSessionPersistenceFailure(error))).not.toMatch(
      /private|secret|transcript/,
    );
  });
});
