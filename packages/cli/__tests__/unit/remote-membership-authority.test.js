import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DurableRemoteMembershipAuthority,
  REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE_CODE,
  REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
} from "../../src/lib/remote-membership-authority.js";

const roots = [];

function fixture(now = () => 1_000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-membership-"));
  roots.push(root);
  const filePath = path.join(root, "membership.json");
  return {
    filePath,
    authority: new DurableRemoteMembershipAuthority({ filePath, now }),
  };
}

function createAndJoin(authority) {
  const session = authority.createSession({
    sessionId: "remote-1",
    agentSessionId: "agent-1",
    hostPrincipalId: "host",
    scopes: ["observe", "prompt", "approve", "interrupt"],
    expiresAt: 100_000,
  });
  const member = authority.joinMember({
    sessionId: "remote-1",
    principalId: "phone",
    scopes: ["observe", "approve"],
    expectedSessionEpoch: session.sessionEpoch,
  });
  return { session, member };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("DurableRemoteMembershipAuthority", () => {
  it("reconstructs active membership after an authority restart", () => {
    const { filePath, authority } = fixture();
    const { session, member } = createAndJoin(authority);

    const restarted = new DurableRemoteMembershipAuthority({
      filePath,
      now: () => 2_000,
    });
    const result = restarted.readMembership(
      {
        sessionId: "remote-1",
        principalId: "phone",
        sessionEpoch: session.sessionEpoch,
        membershipEpoch: member.membershipEpoch,
      },
      "approve",
    );

    expect(result).toMatchObject({
      ok: true,
      binding: {
        authorityVersion: REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
        sessionEpoch: "1",
        membershipEpoch: "2",
        principalId: "phone",
      },
    });
  });

  it("uses monotonic CAS epochs to reject replay, out-of-order revoke, and late membership", () => {
    const { filePath, authority } = fixture();
    const { session, member: first } = createAndJoin(authority);
    const revoked = authority.revokeMember({
      sessionId: "remote-1",
      principalId: "phone",
      expectedSessionEpoch: session.sessionEpoch,
      expectedMembershipEpoch: first.membershipEpoch,
    });
    expect(revoked.revokedEpoch).toBe("3");

    const restarted = new DurableRemoteMembershipAuthority({
      filePath,
      now: () => 2_000,
    });
    expect(
      restarted.readMembership(
        {
          sessionId: "remote-1",
          principalId: "phone",
          sessionEpoch: session.sessionEpoch,
          membershipEpoch: first.membershipEpoch,
        },
        "approve",
      ),
    ).toMatchObject({ ok: false, reason: "membership-revoked" });

    const second = restarted.joinMember({
      sessionId: "remote-1",
      principalId: "phone",
      scopes: ["observe", "approve"],
      expectedSessionEpoch: session.sessionEpoch,
    });
    expect(second.membershipEpoch).toBe("4");
    expect(
      restarted.readMembership(
        {
          sessionId: "remote-1",
          principalId: "phone",
          sessionEpoch: session.sessionEpoch,
          membershipEpoch: first.membershipEpoch,
        },
        "approve",
      ),
    ).toMatchObject({ ok: false, reason: "stale-membership-epoch" });

    expect(() =>
      authority.revokeMember({
        sessionId: "remote-1",
        principalId: "phone",
        expectedSessionEpoch: session.sessionEpoch,
        expectedMembershipEpoch: first.membershipEpoch,
      }),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE_CODE,
      }),
    );
    expect(
      restarted.readMembership(
        {
          sessionId: "remote-1",
          principalId: "phone",
          sessionEpoch: session.sessionEpoch,
          membershipEpoch: second.membershipEpoch,
        },
        "approve",
      ),
    ).toMatchObject({ ok: true });
  });

  it("fails closed after session close or durable TTL expiry", () => {
    let now = 1_000;
    const { authority } = fixture(() => now);
    const { session, member } = createAndJoin(authority);
    const binding = {
      sessionId: "remote-1",
      principalId: "phone",
      sessionEpoch: session.sessionEpoch,
      membershipEpoch: member.membershipEpoch,
    };

    now = 100_001;
    expect(authority.readMembership(binding, "approve")).toMatchObject({
      ok: false,
      reason: "membership-session-expired",
    });

    now = 2_000;
    authority.closeSession({
      sessionId: "remote-1",
      hostPrincipalId: "host",
      expectedSessionEpoch: session.sessionEpoch,
    });
    expect(authority.readMembership(binding, "approve")).toMatchObject({
      ok: false,
      reason: "membership-session-closed",
    });
  });

  it("never calls the fenced approval CAS for a revoked epoch", () => {
    const { authority } = fixture();
    const { session, member } = createAndJoin(authority);
    authority.revokeMember({
      sessionId: "remote-1",
      principalId: "phone",
      expectedSessionEpoch: session.sessionEpoch,
      expectedMembershipEpoch: member.membershipEpoch,
    });
    let sideEffect = 0;

    const result = authority.withActiveMembership(
      {
        sessionId: "remote-1",
        principalId: "phone",
        sessionEpoch: session.sessionEpoch,
        membershipEpoch: member.membershipEpoch,
      },
      "approve",
      () => {
        sideEffect += 1;
        return true;
      },
    );

    expect(result).toMatchObject({ ok: false, reason: "membership-revoked" });
    expect(sideEffect).toBe(0);
  });

  it("rejects asynchronous work because the file lock cannot cover it", () => {
    const { authority } = fixture();
    const { session, member } = createAndJoin(authority);
    const binding = {
      sessionId: "remote-1",
      principalId: "phone",
      sessionEpoch: session.sessionEpoch,
      membershipEpoch: member.membershipEpoch,
    };

    expect(() =>
      authority.withActiveMembership(binding, "approve", async () => true),
    ).toThrow(/must be synchronous/);
    expect(() =>
      authority.withActiveMembership(binding, "approve", () =>
        Promise.resolve(true),
      ),
    ).toThrow(/returned a Promise/);
  });
});
