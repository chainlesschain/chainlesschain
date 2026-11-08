import { describe, expect, it } from "vitest";
import {
  loadArchivedRollouts,
  replayRequest,
} from "../../scripts/codex-app-server-archived-replay.mjs";
import { officialValidators } from "../../scripts/codex-app-server-turn-probe.mjs";

describe("archived native replay preparation", () => {
  it.each(["0.160.0", "0.164.0"])(
    "verifies genuine archived bytes for %s without starting native",
    (version) => {
      const fixture = loadArchivedRollouts(version);
      expect(fixture.rollouts).toHaveLength(2);
      expect(fixture.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(
        new Set(fixture.rollouts.map((rollout) => rollout.threadId)).size,
      ).toBe(2);
      for (const rollout of fixture.rollouts) {
        expect(rollout.parts[0]).toBe("sessions");
        expect(rollout.bytes).toBeInstanceOf(Buffer);
        expect(rollout.source).toBe("vscode");
      }
    },
  );
  it.each(["turn/start", "thread/start", "thread/resume", "command/exec"])(
    "rejects %s before dispatch",
    (method) => {
      expect(() =>
        replayRequest(
          {
            request() {
              throw new Error("dispatched");
            },
          },
          method,
          {},
        ),
      ).toThrow("replay RPC is not read-only");
    },
  );
  it("rejects unsupported versions before reading fixture files", () => {
    expect(() => loadArchivedRollouts("0.999.0", "/missing")).toThrow(
      "unsupported archived version",
    );
  });
  it("compiles official int64 schemas and rejects malformed requests", () => {
    const validators = officialValidators("0.164.0");
    expect(() =>
      validators.check("request", {
        id: Number.MAX_SAFE_INTEGER,
        method: "initialize",
        params: { clientInfo: { name: "test", version: "1.0.0" } },
      }),
    ).not.toThrow();
    expect(() =>
      validators.check("request", {
        id: Number.MAX_SAFE_INTEGER,
        params: { clientInfo: { name: "test", version: "1.0.0" } },
      }),
    ).toThrow();
  });
});
