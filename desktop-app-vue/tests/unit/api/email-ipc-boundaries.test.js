import { describe, expect, it } from "vitest";

const {
  EmailIPCBoundaryError,
  HARD_EMAIL_IPC_LIMITS,
  createEmailIPCLimits,
  normalizeAccountUpdates,
  normalizeEmailListOptions,
  normalizeMailOptions,
} = require("../../../src/main/api/email-ipc-boundaries.js");

describe("Email IPC boundaries", () => {
  it("clamps hostile configuration to immutable hard limits", () => {
    const limits = createEmailIPCLimits(
      Object.fromEntries(
        Object.keys(HARD_EMAIL_IPC_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(limits).toEqual(HARD_EMAIL_IPC_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it("maps only fixed account columns and preserves a blank edit password", () => {
    const limits = createEmailIPCLimits();
    expect(
      normalizeAccountUpdates(
        {
          displayName: "Bounded",
          imapTls: true,
          syncFrequency: 1,
          password: "",
          autoSync: false,
        },
        limits,
      ),
    ).toEqual({
      normalized: [
        ["display_name", "Bounded"],
        ["imap_tls", 1],
        ["sync_frequency", limits.minSyncSeconds],
      ],
      password: undefined,
      autoSync: false,
    });

    expect(() =>
      normalizeAccountUpdates({ "email = NULL --": "bad" }, limits),
    ).toThrow(EmailIPCBoundaryError);
  });

  it("always creates a bounded email list window", () => {
    const limits = createEmailIPCLimits({
      maxEmails: 4,
      maxQueryOffset: 10,
    });
    expect(
      normalizeEmailListOptions(
        { limit: Infinity, offset: 999, isRead: false },
        limits,
      ),
    ).toEqual({ limit: 4, offset: 10, isRead: false });
  });

  it("accepts bounded binary attachments and rejects renderer paths", () => {
    const limits = createEmailIPCLimits({
      maxAttachmentBytes: 4,
      maxOutgoingAttachmentBytes: 6,
    });
    const normalized = normalizeMailOptions(
      {
        to: "to@example.com",
        subject: "hello",
        attachments: [
          { filename: "one.txt", content: new Uint8Array([1, 2, 3, 4]) },
        ],
      },
      limits,
    );
    expect(Buffer.isBuffer(normalized.attachments[0].content)).toBe(true);

    expect(() =>
      normalizeMailOptions(
        {
          to: "to@example.com",
          attachments: [
            {
              filename: "secret.txt",
              path: "C:\\sensitive.txt",
              content: new Uint8Array([1]),
            },
          ],
        },
        limits,
      ),
    ).toThrow(/paths are not allowed/);
  });
});
