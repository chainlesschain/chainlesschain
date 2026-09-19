import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const first = await iterator.next();
if (first.done || Buffer.byteLength(first.value) > 1024 * 1024)
  throw new Error("evaluation process input exceeds 1 MiB");
const request = JSON.parse(first.value);
const moduleUrl = new URL(request.moduleUrl);
const implementation = await import(moduleUrl.href);
const handler = implementation[request.exportName];
if (typeof handler !== "function")
  throw new Error("evaluation process export is unavailable");

if (request.protocol !== "chainlesschain.evolution-process-broker/v1") {
  const extra = await iterator.next();
  if (!extra.done) throw new Error("evaluation process received extra input");
  const value = await handler(request.payload);
  process.stdout.write(`${JSON.stringify({ ok: true, value })}\n`);
} else {
  let sequence = 0;
  const pending = new Map();
  const readResponses = (async () => {
    for await (const line of iterator) {
      if (Buffer.byteLength(line) > 1024 * 1024)
        throw new Error("evaluation broker response exceeds 1 MiB");
      const message = JSON.parse(line);
      const waiter = pending.get(message?.requestId);
      if (
        !waiter ||
        message?.type !== "broker-response" ||
        typeof message.ok !== "boolean" ||
        Object.keys(message).some(
          (key) => !["type", "requestId", "ok", "value", "error"].includes(key),
        )
      ) {
        throw new Error("evaluation broker response is invalid");
      }
      pending.delete(message.requestId);
      if (message.ok) waiter.resolve(message.value);
      else waiter.reject(new Error("parent broker rejected the operation"));
    }
    if (pending.size > 0)
      throw new Error("evaluation broker closed with pending operations");
  })();

  const call = (operation, input) =>
    new Promise((resolve, reject) => {
      sequence += 1;
      const requestId = `broker-${sequence}`;
      pending.set(requestId, { resolve, reject });
      process.stdout.write(
        `${JSON.stringify({
          type: "broker-request",
          requestId,
          operation,
          input,
        })}\n`,
      );
    });
  const runtime = Object.freeze({
    recordTokens: (count) => call("record-tokens", { count }),
    invokeTool: (toolId, input) => call("invoke-tool", { toolId, input }),
    retrieveMemory: (input) => call("retrieve-memory", { input }),
    invokeModel: (input) => call("invoke-model", { input }),
  });
  const value = await handler(request.payload, runtime);
  if (pending.size > 0)
    throw new Error(
      "evaluation target returned with unsettled broker requests",
    );
  process.stdout.write(`${JSON.stringify({ type: "result", value })}\n`, () =>
    process.exit(0),
  );
  await readResponses;
}
