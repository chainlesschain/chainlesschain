import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import http from "node:http";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createProjectGoalDraftClient } from "../../src/lib/project-goal-draft-connection.js";
const require = createRequire(import.meta.url);
const {
  handleGoalDraftRequest,
} = require("../../../../desktop-app-vue/src/main/task/project-goal-drafts-transport.js");
const {
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");
const goalRef = {
  id: "goal-1",
  storeId: "project-goals-12345678-1234-1234-1234-123456789abc",
  revision: 1,
  controlGeneration: 0,
};
const plugin = { name: "drafter", scope: "project", version: "1.0.0" },
  grantRef = { id: `goal-external-grant-${"a".repeat(64)}`, epoch: 1 },
  declarationDigest = `sha256:${"b".repeat(64)}`;
const proposal = {
  type: "task.description.update",
  goalRef,
  sourceRef: `goal-proposal-${"c".repeat(64)}`,
  requestId: "request-1",
  title: "Follow-up",
  description: "New description",
};
let server,
  descriptor,
  context,
  valid,
  nonces,
  dropResponse,
  mutateStatus,
  client,
  check;
const mac = (value) =>
  createHmac("sha256", Buffer.from(descriptor.key, "hex"))
    .update(value)
    .digest("hex");
beforeEach(async () => {
  valid = true;
  nonces = new Set();
  dropResponse = false;
  mutateStatus = false;
  const saved = new Map();
  context = {
    read: () => {
      if (!valid) throw new Error("revoked");
      return { goalRef, objective: "Delivery", status: "active" };
    },
    draftSources: () => ({
      entries: [
        {
          id: proposal.sourceRef,
          sourceTaskId: "t1",
          reviewId: "r1",
          reviewDigest: declarationDigest,
        },
      ],
      scannedCount: 1,
      unavailableCount: 0,
      nextCursor: null,
    }),
    enqueueDraft: vi.fn((value) => {
      saved.set(value.requestId, {
        state: "saved",
        proposalId: `goal-extension-${"d".repeat(64)}`,
        requestId: value.requestId,
        inputDigest: digest(value),
      });
      return { proposalId: `goal-extension-${"d".repeat(64)}` };
    }),
    draftReceipt: ({ requestId, inputDigest }) =>
      saved.get(requestId) || {
        state: "not-found",
        proposalId: null,
        requestId,
        inputDigest,
      },
  };
  context.readDraftContext = () => ({
    ...context.read(),
    grant: { ...grantRef, plugin, declarationDigest },
    sources: context.draftSources(),
  });
  server = http.createServer((request, response) => {
    const original = response.end.bind(response),
      head = response.writeHead.bind(response);
    response.writeHead = (status, ...args) =>
      head(mutateStatus ? 201 : status, ...args);
    response.end = (...args) => {
      if (dropResponse && request.method === "POST") response.destroy();
      else original(...args);
    };
    handleGoalDraftRequest({
      request,
      response,
      context,
      read: context.read,
      mac,
      nonces,
      port: server.address().port,
      close: () => {},
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  descriptor = {
    endpoint: `http://127.0.0.1:${server.address().port}/goal-drafts`,
    key: randomBytes(32).toString("hex"),
    goalRef,
    plugin,
    declarationDigest,
    grantRef,
  };
  check = vi.fn();
  client = createProjectGoalDraftClient(descriptor, check);
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
function raw({
  body = JSON.stringify({ operation: "enqueue", proposal }),
  signedBody = body,
  nonce = randomBytes(32).toString("hex"),
  headers = {},
  method = "POST",
  firstChunk,
  onWritten,
} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      descriptor.endpoint,
      {
        method,
        agent: false,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-CC-Nonce": nonce,
          "X-CC-Signature": mac(
            `request-v3\n${method}\n/goal-drafts\n${nonce}\n${createHash("sha256").update(signedBody).digest("hex")}`,
          ),
          ...headers,
        },
      },
      (response) => {
        let text = "";
        response.on("error", reject);
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: JSON.parse(text),
            signature: response.headers["x-cc-signature"],
            text,
            nonce,
          }),
        );
      },
    );
    request.on("error", reject);
    if (firstChunk) {
      request.write(body.slice(0, firstChunk));
      setTimeout(() => {
        onWritten();
        request.end(body.slice(firstChunk));
      }, 20);
    } else request.end(body);
  });
}
describe("independent v3 authenticated draft transport", () => {
  it("reads bounded native source identifiers, submits pending only, and queries exact receipts", async () => {
    expect(await client.read()).toMatchObject({
      goalRef,
      grant: { ...grantRef, plugin },
    });
    expect(await client.sources()).toMatchObject({ scannedCount: 1 });
    const receipt = await client.enqueue(proposal);
    expect(
      await client.receipt({
        requestId: proposal.requestId,
        inputDigest: digest(proposal),
      }),
    ).toEqual(receipt);
    expect(context.enqueueDraft).toHaveBeenCalledTimes(1);
    expect(Object.keys(client)).not.toEqual(
      expect.arrayContaining(["key", "endpoint", "execute"]),
    );
  });
  it("authenticates actual body bytes and never accepts tampered JSON", async () => {
    const result = await raw({
      signedBody: JSON.stringify({ operation: "sources" }),
    });
    expect(result.status).toBe(403);
    expect(context.enqueueDraft).not.toHaveBeenCalled();
  });
  it("signs the HTTP status and rejects a substituted successful status", async () => {
    mutateStatus = true;
    await expect(client.enqueue(proposal)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
  });
  it("rejects replay without a second pending write", async () => {
    const nonce = randomBytes(32).toString("hex");
    expect((await raw({ nonce })).status).toBe(200);
    expect((await raw({ nonce })).status).toBe(429);
    expect(context.enqueueDraft).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized bodies before writing", async () => {
    expect((await raw({ body: " ".repeat(16385) })).status).toBe(400);
    expect(context.enqueueDraft).not.toHaveBeenCalled();
  });
  it("rechecks revocation after fully receiving the body", async () => {
    const result = await raw({
      firstChunk: 12,
      onWritten: () => (valid = false),
    });
    expect(result.status).toBe(410);
    expect(context.enqueueDraft).not.toHaveBeenCalled();
  });
  it("rejects browser-origin requests and unsupported execution operations", async () => {
    expect(
      (await raw({ headers: { Origin: "https://example.test" } })).status,
    ).toBe(403);
    expect(
      (
        await raw({
          body: JSON.stringify({ operation: "execute", intentId: "i1" }),
        })
      ).status,
    ).toBe(409);
    expect(context.enqueueDraft).not.toHaveBeenCalled();
  });
  it("retains an unknown outcome after saving with a lost response; exact receipt lookup recovers it", async () => {
    dropResponse = true;
    await expect(client.enqueue(proposal)).rejects.toMatchObject({
      code: "CLI_GOAL_DRAFT_OUTCOME_UNKNOWN",
    });
    dropResponse = false;
    expect(
      await client.receipt({
        requestId: proposal.requestId,
        inputDigest: digest(proposal),
      }),
    ).toMatchObject({ state: "saved" });
    expect(context.enqueueDraft).toHaveBeenCalledTimes(1);
  });
  it("does not label a failed private-file preflight as dispatched", async () => {
    check.mockImplementation(() => {
      throw new Error("changed file");
    });
    await expect(client.enqueue(proposal)).rejects.not.toHaveProperty(
      "outcomeUnknown",
    );
    expect(context.enqueueDraft).not.toHaveBeenCalled();
  });
  it("revalidates private descriptor identity after native save and preserves uncertainty", async () => {
    check
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("changed file");
      });
    await expect(client.enqueue(proposal)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    expect(context.enqueueDraft).toHaveBeenCalledTimes(1);
  });
  it("signs bounded errors without leaking the internal native failure", async () => {
    context.enqueueDraft.mockImplementation(() => {
      throw new Error("PRIVATE INTERNAL ERROR");
    });
    const result = await raw();
    expect(result.status).toBe(409);
    expect(result.text).not.toContain("PRIVATE");
    expect(result.signature).toBe(
      mac(`response-v3\n${result.nonce}\n409\n${result.text}`),
    );
  });
});
