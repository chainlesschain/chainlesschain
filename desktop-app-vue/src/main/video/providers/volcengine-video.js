/**
 * Volcengine (豆包 Seedance) text-to-video provider.
 *
 * Docs: https://www.volcengine.com/docs/82379/1521309
 * Endpoint: POST /api/v3/contents/generations/tasks  — create async task
 *           GET  /api/v3/contents/generations/tasks/{id} — poll status
 *
 * Response on `succeeded`: content.video_url (temporary signed URL).
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../utils/logger.js");

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MODEL = "doubao-seedance-1.0-lite";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const _deps = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

function buildContentParts({ prompt, imageUrl, ratio, duration, resolution }) {
  const parts = [];
  const textPieces = [prompt];
  if (ratio) {
    textPieces.push(`--ratio ${ratio}`);
  }
  if (duration) {
    textPieces.push(`--duration ${duration}`);
  }
  if (resolution) {
    textPieces.push(`--resolution ${resolution}`);
  }
  parts.push({ type: "text", text: textPieces.join(" ") });
  if (imageUrl) {
    parts.push({
      type: "image_url",
      image_url: { url: imageUrl },
      role: "first_frame",
    });
  }
  return parts;
}

async function createTask({ apiKey, baseURL, model, content }) {
  const res = await _deps.fetch(`${baseURL}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Volcengine createTask ${res.status}: ${text}`);
  }
  return res.json();
}

async function getTask({ apiKey, baseURL, taskId }) {
  const res = await _deps.fetch(
    `${baseURL}/contents/generations/tasks/${taskId}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Volcengine getTask ${res.status}: ${text}`);
  }
  return res.json();
}

async function downloadTo(url, outPath) {
  const res = await _deps.fetch(url);
  if (!res.ok) {
    throw new Error(`download ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, buf);
  return { path: outPath, size: buf.length };
}

/**
 * Generate a video via Volcengine Seedance and save it to outputPath.
 * @returns {Promise<{path, size, taskId, model}>}
 */
async function generateVideo({
  apiKey,
  baseURL = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  prompt,
  imageUrl,
  ratio,
  duration,
  resolution,
  outputPath,
  onProgress,
  pollIntervalMs = POLL_INTERVAL_MS,
  pollTimeoutMs = POLL_TIMEOUT_MS,
}) {
  if (!apiKey) {
    throw new Error("Volcengine apiKey required");
  }
  if (!prompt) {
    throw new Error("prompt required");
  }
  if (!outputPath) {
    throw new Error("outputPath required");
  }

  const content = buildContentParts({
    prompt,
    imageUrl,
    ratio,
    duration,
    resolution,
  });
  logger.info(`[VolcengineVideo] creating task (model=${model})`);
  const { id: taskId } = await createTask({ apiKey, baseURL, model, content });
  onProgress?.({ stage: "task-created", taskId });

  const deadline = _deps.now() + pollTimeoutMs;
  while (_deps.now() < deadline) {
    await _deps.sleep(pollIntervalMs);
    const task = await getTask({ apiKey, baseURL, taskId });
    const status = task.status;
    onProgress?.({ stage: "polling", taskId, status });
    if (status === "succeeded") {
      const url = task.content?.video_url;
      if (!url) {
        throw new Error("succeeded but no video_url");
      }
      onProgress?.({ stage: "downloading", taskId });
      const result = await downloadTo(url, outputPath);
      onProgress?.({ stage: "complete", taskId, ...result });
      return { ...result, taskId, model };
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(
        `task ${status}: ${task.error?.message || task.error?.code || "unknown"}`,
      );
    }
  }
  throw new Error(`Volcengine video task ${taskId} timed out`);
}

module.exports = {
  generateVideo,
  _deps,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
};
