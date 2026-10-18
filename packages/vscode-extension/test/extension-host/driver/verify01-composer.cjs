"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const digest = (text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** Drive only the public webview's textarea and normal send button. No
 * extension implementation or protocol message is replaced or patched. */
async function fillAndSubmit(client, prompt, snapshot) {
  assert.ok(
    typeof prompt === "string" &&
      prompt.length > 512 &&
      Buffer.byteLength(prompt, "utf8") <= 1024 * 1024,
  );
  const observed = await client.evaluate(`(() => {
    const input = document.querySelector('textarea#input'), button = document.querySelector('#send');
    if (!input || !button || button.disabled) throw new Error('composer is unavailable');
    input.focus(); input.value = ${JSON.stringify(prompt)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
  assert.equal(
    observed,
    prompt,
    "actual composer truncated or changed the original prompt",
  );
  const actual = await snapshot();
  assert.equal(
    actual.inputText,
    prompt,
    "public UI snapshot differs from original prompt",
  );
  assert.equal(actual.sendEnabled, true);
  const submitted = await client.evaluate(`(() => {
    const input = document.querySelector('textarea#input'), button = document.querySelector('#send');
    if (!input || !button || button.disabled || input.value !== ${JSON.stringify(prompt)}) return false;
    button.click(); return true;
  })()`);
  assert.equal(submitted, true, "normal composer submission failed");
  return {
    method: "real-webview-cdp-composer",
    promptDigest: digest(prompt),
    observedDigest: digest(observed),
    utf8Bytes: Buffer.byteLength(observed, "utf8"),
    submitted: true,
  };
}

async function sendLongPrompt({ config, snapshot }) {
  const endpointFile = process.env.CHAINLESSCHAIN_VERIFY01_CDP_ENDPOINT_FILE;
  assert.equal(
    endpointFile,
    path.join(config.captureDir, "cdp-initial.json"),
    "unexpected CDP endpoint file",
  );
  while (!fs.existsSync(endpointFile) && Date.now() < config.deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const { port, endpoint } = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  const url = new URL(endpoint);
  assert.equal(url.protocol, "ws:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, String(port));
  const { findChatWebview } = require("../cdp-journey.cjs");
  const { client } = await findChatWebview(
    port,
    Math.max(1, config.deadline - Date.now()),
    null,
    path.join(config.captureDir, "cdp-discovery.ndjson"),
    () => endpoint,
  );
  try {
    const receipt = await fillAndSubmit(client, config.prompt, snapshot);
    fs.writeFileSync(
      path.join(config.captureDir, "composer-submit.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    client.close();
  }
}
module.exports = { fillAndSubmit, sendLongPrompt };
