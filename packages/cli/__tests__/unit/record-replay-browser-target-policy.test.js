import { describe, expect, it } from "vitest";
import {
  assertRecordedSkillBrowserBinding,
  createRecordedSkillNetworkPolicy,
  navigationAllowedByRecordedSkillPolicy,
  prepareRecordedSkillBrowserTarget,
  recordedSkillBrowserEnvironment,
  requestAllowedByRecordedSkillPolicy,
} from "../../src/lib/record-replay/index.js";

describe("Record & Replay browser target policy", () => {
  it("normalizes an exact HTTPS origin policy and binds credentials by digest", () => {
    const storageState = {
      cookies: [
        {
          name: "session",
          value: "runtime-secret",
          domain: "example.test",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    };
    const target = prepareRecordedSkillBrowserTarget({
      url: "https://example.test/workflow?mode=reviewed",
      allowedOrigins: ["https://example.test"],
      identity: "automation.account",
      storageState,
    });
    const environment = recordedSkillBrowserEnvironment(target);
    const source = {
      adapter: target.adapter,
      targetDigest: target.targetDigest,
      browserVersion: "test",
    };

    expect(environment).not.toHaveProperty("storageState");
    expect(JSON.stringify(environment)).not.toContain("runtime-secret");
    expect(
      assertRecordedSkillBrowserBinding(target, { source, environment }),
    ).toBe(true);

    const wrongCredential = prepareRecordedSkillBrowserTarget({
      url: target.url,
      allowedOrigins: ["https://example.test"],
      identity: "automation.account",
      storageState: { ...storageState, cookies: [] },
    });
    expect(() =>
      assertRecordedSkillBrowserBinding(wrongCredential, {
        source,
        environment,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_CREDENTIAL_DRIFT" }),
    );
  });

  it("denies unreviewed protocols, origins, URL credentials, and redirects", () => {
    const target = prepareRecordedSkillBrowserTarget({
      url: "https://example.test/workflow",
      allowedOrigins: ["https://example.test"],
    });
    expect(requestAllowedByRecordedSkillPolicy(target.url, target)).toBe(true);
    expect(navigationAllowedByRecordedSkillPolicy(target.url, target)).toBe(
      true,
    );
    expect(
      navigationAllowedByRecordedSkillPolicy("data:text/html,escape", target),
    ).toBe(false);
    expect(
      requestAllowedByRecordedSkillPolicy(
        "https://cdn.example.test/app.js",
        target,
      ),
    ).toBe(false);
    expect(
      requestAllowedByRecordedSkillPolicy("file:///etc/passwd", target),
    ).toBe(false);
    expect(() =>
      prepareRecordedSkillBrowserTarget({
        url: "https://user:secret@example.test/",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_TARGET_INVALID" }),
    );
    expect(() =>
      createRecordedSkillNetworkPolicy({
        mode: "allowlist",
        allowedOrigins: ["https://example.test/path"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_TARGET_INVALID" }),
    );
    expect(() =>
      createRecordedSkillNetworkPolicy({
        mode: "deny",
        allowedOrigins: ["https://example.test"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_TARGET_INVALID" }),
    );
  });

  it("keeps self-contained HTML offline and credential-free", () => {
    const target = prepareRecordedSkillBrowserTarget({
      html: "<button>ok</button>",
    });
    expect(target.networkPolicy).toMatchObject({
      mode: "deny",
      allowedOrigins: [],
    });
    expect(
      requestAllowedByRecordedSkillPolicy("https://example.test", target),
    ).toBe(false);
    expect(() =>
      prepareRecordedSkillBrowserTarget({
        html: "<button>ok</button>",
        storageState: { cookies: [], origins: [] },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_TARGET_INVALID" }),
    );
  });

  it("deep-freezes policies and bounds credential state", () => {
    const target = prepareRecordedSkillBrowserTarget({
      url: "https://example.test/",
      storageState: { cookies: [], origins: [] },
    });
    expect(Object.isFrozen(target.networkPolicy.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(target.storageState.cookies)).toBe(true);
    expect(() =>
      target.networkPolicy.allowedOrigins.push("https://evil.test"),
    ).toThrow();

    let oversized = { cookies: [], origins: [] };
    for (let index = 0; index < 18; index += 1) {
      oversized = { child: oversized };
    }
    expect(() =>
      prepareRecordedSkillBrowserTarget({
        url: "https://example.test/",
        storageState: oversized,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_RECORD_TARGET_INVALID" }),
    );
  });
});
