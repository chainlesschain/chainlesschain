/** Explicit short-lived desktop connection. No DB path or client-supplied actor. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inspectPrivatePath } from "@chainlesschain/session-core/private-storage";
import { goalExtensionRef } from "@chainlesschain/session-core/goal-extension-proposal-contract";
import {
  validateGoalEvidenceProjection,
  validateGoalEventHistoryPage,
  parseGoalEventCursor,
} from "@chainlesschain/session-core/goal-evidence-contract";
import { validateGoalDraftDescriptor } from "@chainlesschain/session-core/goal-draft-connection-contract";
import { createProjectGoalDraftClient } from "./project-goal-draft-connection.js";
function fail() {
  throw new Error("CLI_GOAL_CONNECTION_UNAVAILABLE");
}
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
export function createProjectGoalConnection(file) {
  let fd;
  try {
    if (
      typeof file !== "string" ||
      !file ||
      file.length > 4096 ||
      /[\u0000-\u001f]/u.test(file)
    )
      fail();
    const target = path.resolve(file);
    const before = fs.lstatSync(target);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size > 4096 ||
      !inspectPrivatePath(target).ok
    )
      fail();
    fd = fs.openSync(
      target,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fs.fstatSync(fd);
    if (!sameFile(before, opened)) fail();
    const raw = Buffer.alloc(4097);
    const count = fs.readSync(fd, raw, 0, raw.length, 0);
    if (count > 4096 || !sameFile(opened, fs.fstatSync(fd))) fail();
    const descriptor = JSON.parse(raw.subarray(0, count).toString("utf8"));
    if (descriptor.schema === "chainlesschain.project-goal-connection/v3") {
      const verified = validateGoalDraftDescriptor(descriptor);
      return createProjectGoalDraftClient(verified, () => {
        if (
          Date.now() >= verified.expiresAt ||
          !sameFile(opened, fs.lstatSync(target))
        )
          fail();
      });
    }
    const evidence =
      descriptor.schema === "chainlesschain.project-goal-connection/v2";
    const events =
      descriptor.schema === "chainlesschain.project-goal-connection/v4";
    const history =
      descriptor.schema === "chainlesschain.project-goal-connection/v5";
    const endpointPath = history
      ? "/goal-event-history"
      : events
        ? "/goal-events"
        : evidence
          ? "/goal-evidence"
          : "/goal-summary";
    if (
      Object.keys(descriptor).sort().join() !==
        (evidence || events || history
          ? "capability,endpoint,expiresAt,goalRef,key,schema"
          : "endpoint,expiresAt,goalRef,key,schema") ||
      (history
        ? descriptor.capability !== "goal.event-history"
        : events
          ? descriptor.capability !== "goal.events"
          : evidence
            ? descriptor.capability !== "goal.evidence"
            : descriptor.schema !==
              "chainlesschain.project-goal-connection/v1") ||
      typeof descriptor.endpoint !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/goal-(?:summary|evidence|events|event-history)$/.test(
        descriptor.endpoint,
      ) ||
      new URL(descriptor.endpoint).pathname !== endpointPath ||
      Number(new URL(descriptor.endpoint).port) > 65535 ||
      typeof descriptor.key !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.key) ||
      !Number.isSafeInteger(descriptor.expiresAt) ||
      descriptor.expiresAt <= Date.now() ||
      descriptor.expiresAt > Date.now() + 15 * 60 * 1000 + 5000
    )
      fail();
    const ref = goalExtensionRef(descriptor.goalRef);
    function validate() {
      if (
        Date.now() >= descriptor.expiresAt ||
        !sameFile(opened, fs.lstatSync(target))
      )
        fail();
    }
    const mac = (value) =>
      createHmac("sha256", Buffer.from(descriptor.key, "hex"))
        .update(value)
        .digest("hex");
    async function read(id = ref.id, { signal, after } = {}) {
      validate();
      if (id !== ref.id) fail();
      if (after !== undefined && !history) fail();
      if (after !== undefined) parseGoalEventCursor(after);
      const requestPath =
        endpointPath + (after === undefined ? "" : `?after=${after}`);
      const nonce = randomBytes(32).toString("hex");
      try {
        const result = await new Promise((resolve, reject) => {
          const request = http.get(
            descriptor.endpoint +
              (after === undefined ? "" : `?after=${after}`),
            {
              agent: false,
              signal,
              maxHeaderSize: 4096,
              headers: {
                "X-CC-Nonce": nonce,
                "X-CC-Signature": mac(`request\nGET\n${requestPath}\n${nonce}`),
              },
            },
            (response) => {
              const chunks = [];
              let bytes = 0;
              response.on("error", reject);
              response.on("data", (chunk) => {
                bytes += chunk.length;
                if (bytes > 16 * 1024) response.destroy(new Error("limit"));
                else chunks.push(chunk);
              });
              response.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8"),
                  signature = response.headers["x-cc-signature"];
                if (
                  (!history && response.statusCode !== 200) ||
                  typeof signature !== "string" ||
                  !/^[a-f0-9]{64}$/.test(signature) ||
                  !timingSafeEqual(
                    Buffer.from(signature),
                    Buffer.from(
                      mac(
                        history
                          ? `response\n${nonce}\n${response.statusCode}\n${body}`
                          : `response\n${nonce}\n${body}`,
                      ),
                    ),
                  )
                ) {
                  reject(new Error("signature"));
                  return;
                }
                try {
                  const parsed = JSON.parse(body);
                  if (history && response.statusCode !== 200) {
                    if (
                      [409, 410].includes(response.statusCode) &&
                      Object.keys(parsed).join() === "error" &&
                      [
                        "GOAL_EVENT_CURSOR_INVALID",
                        "GOAL_EVENT_HISTORY_GAP",
                        "GOAL_EVENT_HISTORY_REGRESSED",
                        "GOAL_EVENT_HISTORY_UNAVAILABLE",
                        "GOAL_EVENT_HISTORY_INVALID",
                      ].includes(parsed.error)
                    ) {
                      reject(
                        Object.assign(new Error(parsed.error), {
                          code: parsed.error,
                        }),
                      );
                      return;
                    }
                    reject(new Error("status"));
                    return;
                  }
                  resolve(parsed);
                } catch {
                  reject(new Error("json"));
                }
              });
            },
          );
          request.setTimeout(5000, () => request.destroy(new Error("timeout")));
          const deadline = setTimeout(
            () => request.destroy(new Error("timeout")),
            5000,
          );
          request.once("close", () => clearTimeout(deadline));
          request.on("error", reject);
        });
        validate();
        if (history) return validateGoalEventHistoryPage(result, ref, after);
        if (
          Object.keys(result).sort().join() !==
            (events
              ? "goalRef,receipts,risk,schema"
              : evidence
                ? "goalRef,objective,receipts,risk,schema,status"
                : "goalRef,objective,schema,status") ||
          result.schema !==
            (events
              ? "chainlesschain.project-goal-events/v1"
              : evidence
                ? "chainlesschain.project-goal-evidence/v1"
                : "chainlesschain.project-goal-summary/v1") ||
          JSON.stringify(goalExtensionRef(result.goalRef)) !==
            JSON.stringify(ref) ||
          (!events &&
            (typeof result.objective !== "string" ||
              result.objective.length > 4096 ||
              result.status !== "active"))
        )
          fail();
        if (evidence || events)
          validateGoalEvidenceProjection({
            risk: result.risk,
            receipts: result.receipts,
          });
        return { ...result, goalRef: ref };
      } catch (error) {
        if (
          history &&
          [
            "GOAL_EVENT_CURSOR_INVALID",
            "GOAL_EVENT_HISTORY_GAP",
            "GOAL_EVENT_HISTORY_REGRESSED",
            "GOAL_EVENT_HISTORY_UNAVAILABLE",
            "GOAL_EVENT_HISTORY_INVALID",
          ].includes(error.code)
        )
          throw error;
        fail();
      }
    }
    validate();
    return history
      ? Object.freeze({
          goalRef: ref,
          eventHistory: true,
          readEventPage: (after, options = {}) =>
            read(ref.id, { ...options, after }),
          read: async () => fail(),
        })
      : events
        ? Object.freeze({
            goalRef: ref,
            events: true,
            readEvents: read,
            read: async () => fail(),
          })
        : Object.freeze({ goalRef: ref, evidence, read });
  } catch {
    fail();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export async function readProjectGoalCatalog(options = {}) {
  if (
    options.after !== undefined ||
    !Number.isSafeInteger(options.limit ?? 20) ||
    (options.limit ?? 20) < 1 ||
    (options.limit ?? 20) > 20
  )
    fail();
  const source = createProjectGoalConnection(options.connection);
  const goal = await source.read();
  return {
    schema: "chainlesschain.goal-catalog.v1",
    source: "desktop-project",
    snapshot: true,
    storeId: source.goalRef.storeId,
    observedAt: new Date().toISOString(),
    entries: [
      {
        id: source.goalRef.id,
        title: goal.objective
          .replace(
            /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
            " ",
          )
          .slice(0, 160),
        status: goal.status,
        revision: source.goalRef.revision,
        controlGeneration: source.goalRef.controlGeneration,
      },
    ],
    scannedCount: 1,
    skippedCount: 0,
    invalidNameCount: 0,
    nextCursor: null,
  };
}
