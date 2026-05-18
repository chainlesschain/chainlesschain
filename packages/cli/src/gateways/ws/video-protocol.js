/**
 * Video Editing Protocol — WebSocket routes for cc ui video editing.
 *
 * Follows the same pattern as session-core-protocol.js:
 * - Request/response handlers return { ok, ... } or { ok: false, error }
 * - Streaming handlers take (message, sender, signal) and emit stream.event
 *
 * Route keys use dot-case: video.assets.list, video.deconstruct, etc.
 */

function ok(data = {}) {
  return { ok: true, ...data };
}
function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function createPipeline(message) {
  const { VideoPipeline } = require("../../skills/video-editing/pipeline.js");
  return new VideoPipeline({
    videoPath: message.videoPath,
    audioPath: message.audioPath,
    instruction: message.instruction || "",
    outputPath: message.outputPath || "./output.mp4",
    existingSrt: message.existingSrt,
    fps: message.fps || 2,
    mainCharacter: message.mainCharacter || "",
  });
}

// ── Request/Response handlers ─────────────────────────────────

async function videoAssetsList(_message) {
  const fs = require("fs").promises;
  const path = require("path");
  const base = process.env.APPDATA
    ? path.join(
        process.env.APPDATA,
        "chainlesschain-desktop-vue",
        ".chainlesschain",
        "video-editing",
      )
    : path.join(process.env.HOME || "~", ".chainlesschain", "video-editing");
  try {
    const dirs = await fs.readdir(base);
    const assets = [];
    for (const d of dirs) {
      const metaPath = path.join(base, d, "meta.json");
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
        const stat = await fs.stat(metaPath);
        assets.push({
          hash: d,
          ...meta,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        /* skip invalid */
      }
    }
    return ok({ assets });
  } catch {
    return ok({ assets: [] });
  }
}

// ── Streaming handlers ────────────────────────────────────────

async function videoDeconstruct(message, sender, signal) {
  if (!message.videoPath) return fail("BAD_REQUEST", "videoPath required");
  const pipeline = createPipeline(message);
  pipeline.on("event", (ev) => {
    if (signal?.aborted) return;
    sender({ type: "stream.event", event: ev });
  });
  try {
    const dir = await pipeline.deconstruct();
    return ok({
      assetDir: dir,
      hash: dir.split(/[/\\]/).pop(),
    });
  } catch (err) {
    return fail("DECONSTRUCT_ERROR", err.message);
  }
}

async function videoPlan(message, sender, signal) {
  if (!message.assetDir && !message.assetHash)
    return fail("BAD_REQUEST", "assetDir or assetHash required");
  const pipeline = createPipeline(message);
  if (message.assetDir) pipeline.cacheDir = message.assetDir;
  pipeline.on("event", (ev) => {
    if (signal?.aborted) return;
    sender({ type: "stream.event", event: ev });
  });
  try {
    const plan = await pipeline.plan(message.assetDir);
    return ok({ shotPlan: plan });
  } catch (err) {
    return fail("PLAN_ERROR", err.message);
  }
}

async function videoAssemble(message, sender, signal) {
  if (!message.assetDir) return fail("BAD_REQUEST", "assetDir required");
  if (!message.shotPlan) return fail("BAD_REQUEST", "shotPlan required");
  const pipeline = createPipeline(message);
  pipeline.cacheDir = message.assetDir;
  pipeline.on("event", (ev) => {
    if (signal?.aborted) return;
    sender({ type: "stream.event", event: ev });
  });
  try {
    const points = await pipeline.assemble(message.shotPlan, message.assetDir);
    return ok({ shotPoint: points });
  } catch (err) {
    return fail("ASSEMBLE_ERROR", err.message);
  }
}

async function videoRender(message, sender, signal) {
  if (!message.videoPath) return fail("BAD_REQUEST", "videoPath required");
  if (!message.shotPoint) return fail("BAD_REQUEST", "shotPoint required");
  const pipeline = createPipeline(message);
  pipeline.on("event", (ev) => {
    if (signal?.aborted) return;
    sender({ type: "stream.event", event: ev });
  });
  try {
    const outPath = await pipeline.render(message.shotPoint, message.assetDir);
    return ok({ outputPath: outPath });
  } catch (err) {
    return fail("RENDER_ERROR", err.message);
  }
}

async function videoEdit(message, sender, signal) {
  if (!message.videoPath) return fail("BAD_REQUEST", "videoPath required");
  const pipeline = createPipeline(message);
  pipeline.on("event", (ev) => {
    if (signal?.aborted) return;
    sender({ type: "stream.event", event: ev });
  });
  try {
    const result = await pipeline.run();
    return ok({
      assetDir: result.assetDir,
      shotPlan: result.shotPlan,
      shotPoints: result.shotPoints,
      outputPath: result.outputPath,
    });
  } catch (err) {
    return fail("EDIT_ERROR", err.message);
  }
}

// ── Exports ───────────────────────────────────────────────────

export const VIDEO_STREAMING_HANDLERS = {
  "video.deconstruct": videoDeconstruct,
  "video.plan": videoPlan,
  "video.assemble": videoAssemble,
  "video.render": videoRender,
  "video.edit": videoEdit,
};

export const VIDEO_HANDLERS = {
  "video.assets.list": videoAssetsList,
};

/**
 * Attach video routes to the dispatcher's routes object.
 * Same pattern as attachSessionCoreRoutes.
 */
export function attachVideoRoutes(routes, server) {
  for (const [type, handler] of Object.entries(VIDEO_HANDLERS)) {
    routes[type] = async (message, ws) => {
      try {
        const result = await handler(message);
        server._send(ws, {
          id: message.id,
          type: `${type}.response`,
          ...result,
        });
      } catch (err) {
        server._send(ws, {
          id: message.id,
          type: "error",
          code: "VIDEO_ERROR",
          message: err?.message || String(err),
        });
      }
    };
  }

  for (const [type, handler] of Object.entries(VIDEO_STREAMING_HANDLERS)) {
    routes[type] = async (message, ws) => {
      const ac = new AbortController();
      const cancelKey = message.id;
      if (cancelKey) {
        const cancelHandler = (msg) => {
          if (msg.type === "cancel" && msg.id === cancelKey) ac.abort();
        };
        server._cancelHandlers?.set(cancelKey, cancelHandler);
      }
      const sender = (ev) => {
        server._send(ws, { id: message.id, ...ev });
      };
      try {
        const result = await handler(message, sender, ac.signal);
        server._send(ws, {
          id: message.id,
          type: `${type}.end`,
          ...result,
        });
      } catch (err) {
        server._send(ws, {
          id: message.id,
          type: `${type}.end`,
          ok: false,
          error: { code: "STREAM_ERROR", message: err?.message || String(err) },
        });
      } finally {
        server._cancelHandlers?.delete(cancelKey);
      }
    };
  }

  return routes;
}
