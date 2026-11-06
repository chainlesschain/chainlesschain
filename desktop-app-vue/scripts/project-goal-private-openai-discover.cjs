"use strict";
const http = require("node:http"),
  https = require("node:https");
const { TextDecoder } = require("node:util");
const {
  privateOpenAIEndpoint,
} = require("../src/main/task/project-goal-volcengine-model");
async function main() {
  const endpoint = privateOpenAIEndpoint(
    process.env.DMM_PRIVATE_OPENAI_BASE_URL,
  );
  const key = process.env.DMM_PRIVATE_OPENAI_API_KEY;
  const data = await new Promise((resolve, reject) => {
    const req = (endpoint.startsWith("https:") ? https : http).get(
      `${endpoint}/models`,
      {
        agent: false,
        signal: AbortSignal.timeout(10000),
        headers: {
          "Accept-Encoding": "identity",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.destroy();
          reject(
            Object.assign(new Error("MODEL_DISCOVERY_UNAVAILABLE"), {
              statusCode: res.statusCode,
            }),
          );
          return;
        }
        let bytes = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 65536) {
            res.destroy();
            reject(new Error("MODEL_DISCOVERY_LIMIT"));
          } else chunks.push(chunk);
        });
        res.once("error", reject);
        res.once("end", () => {
          try {
            resolve(
              JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  Buffer.concat(chunks),
                ),
              ),
            );
          } catch {
            reject(new Error("MODEL_DISCOVERY_INVALID"));
          }
        });
      },
    );
    req.once("error", reject);
  });
  const models = data?.data;
  if (
    !Array.isArray(models) ||
    models.length > 100 ||
    models.some(
      (m) =>
        typeof m?.id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(m.id),
    )
  )
    throw new Error("MODEL_DISCOVERY_INVALID");
  console.log(
    JSON.stringify({
      endpoint,
      authenticated: Boolean(key),
      models: models.map((m) => m.id),
    }),
  );
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "unavailable",
      httpStatus: Number.isInteger(error?.statusCode) ? error.statusCode : null,
      networkCode: [
        "ECONNREFUSED",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ETIMEDOUT",
        "ECONNRESET",
        "EPERM",
        "EACCES",
      ].includes(error?.code)
        ? error.code
        : error?.name === "TimeoutError"
          ? "TIMEOUT"
          : "UNAVAILABLE",
      inferenceRequests: 0,
    }),
  );
  console.error(
    "Private OpenAI model discovery failed; no inference was requested and raw response/configuration is withheld.",
  );
  process.exitCode = 1;
});
