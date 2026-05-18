/**
 * video-editing-ipc.js — CutClaw-inspired video editing Agent IPC channels
 *
 * 7 channels reusing CLI pipeline logic:
 *   video-edit:deconstruct   — extract frames + ASR + beats
 *   video-edit:plan          — generate shot_plan
 *   video-edit:assemble      — Editor ReAct loop → shot_point
 *   video-edit:render        — ffmpeg render final video
 *   video-edit:edit          — full pipeline (deconstruct→plan→assemble→render)
 *   video-edit:assets-list   — list cached deconstructed assets
 *   video-edit:cancel        — abort running pipeline
 *
 * Progress events pushed via mainWindow.webContents.send("video-edit:event", ev)
 */

const { logger } = require("../utils/logger.js");

const CHANNELS = [
  "video-edit:deconstruct",
  "video-edit:plan",
  "video-edit:assemble",
  "video-edit:render",
  "video-edit:edit",
  "video-edit:assets-list",
  "video-edit:cancel",
];

// Active pipeline AbortControllers keyed by requestId
const _activePipelines = new Map();

function registerVideoEditingIPC(ipcMain, { mainWindow, llmManager } = {}) {
  logger.info("[Video-Editing IPC] Registering 7 channels...");

  function sendEvent(ev) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("video-edit:event", ev);
      }
    } catch (_e) {
      /* window may be closing */
    }
  }

  async function loadPipeline() {
    const mod = await import(
      /* webpackIgnore: true */
      "../../../../packages/cli/src/skills/video-editing/pipeline.js"
    );
    return mod;
  }

  function makeLlmCall(llmMgr) {
    if (!llmMgr) {
      return null;
    }
    return async (req) => {
      try {
        const messages = [
          {
            role: "system",
            content: `You are a video editing assistant. Task type: ${req.type}`,
          },
          { role: "user", content: JSON.stringify(req) },
        ];
        const resp = await llmMgr.chat(messages, { responseFormat: "json" });
        return typeof resp === "string" ? JSON.parse(resp) : resp;
      } catch (e) {
        logger.warn(
          `[Video-Editing IPC] llmCall(${req.type}) failed: ${e.message}`,
        );
        return null;
      }
    };
  }

  function createPipeline(options, pipelineMod) {
    const { VideoPipeline } = pipelineMod;
    const pipeline = new VideoPipeline({
      ...options,
      llmCall: makeLlmCall(llmManager),
    });
    pipeline.on("event", sendEvent);
    return pipeline;
  }

  // ── video-edit:deconstruct ──────────────────────────────
  ipcMain.handle("video-edit:deconstruct", async (_event, options) => {
    try {
      const mod = await loadPipeline();
      const pipeline = createPipeline(options, mod);
      const dir = await pipeline.deconstruct();
      return { ok: true, assetDir: dir };
    } catch (e) {
      logger.error("[Video-Editing IPC] deconstruct failed:", e);
      return { ok: false, error: e.message };
    }
  });

  // ── video-edit:plan ─────────────────────────────────────
  ipcMain.handle("video-edit:plan", async (_event, options) => {
    try {
      const mod = await loadPipeline();
      const pipeline = createPipeline(options, mod);
      const plan = await pipeline.plan(options.assetDir);
      return { ok: true, shotPlan: plan };
    } catch (e) {
      logger.error("[Video-Editing IPC] plan failed:", e);
      return { ok: false, error: e.message };
    }
  });

  // ── video-edit:assemble ─────────────────────────────────
  ipcMain.handle("video-edit:assemble", async (_event, options) => {
    try {
      const mod = await loadPipeline();
      const pipeline = createPipeline(options, mod);
      const shotPlan = options.shotPlan;
      if (!shotPlan) {
        return { ok: false, error: "shotPlan required" };
      }

      let points;
      if (options.parallel) {
        points = await pipeline.assembleParallel(
          shotPlan,
          options.assetDir,
          options,
        );
      } else {
        points = await pipeline.assemble(shotPlan, options.assetDir);
      }

      if (options.review) {
        const { approved } = await pipeline.review(
          points,
          options.assetDir,
          options,
        );
        points = approved;
      }

      return { ok: true, shotPoints: points };
    } catch (e) {
      logger.error("[Video-Editing IPC] assemble failed:", e);
      return { ok: false, error: e.message };
    }
  });

  // ── video-edit:render ───────────────────────────────────
  ipcMain.handle("video-edit:render", async (_event, options) => {
    try {
      const mod = await loadPipeline();
      const pipeline = createPipeline(options, mod);
      const shotPoints = options.shotPoints;
      if (!shotPoints) {
        return { ok: false, error: "shotPoints required" };
      }
      const outPath = await pipeline.render(shotPoints, options.assetDir);
      return { ok: true, outputPath: outPath };
    } catch (e) {
      logger.error("[Video-Editing IPC] render failed:", e);
      return { ok: false, error: e.message };
    }
  });

  // ── video-edit:edit (full pipeline) ─────────────────────
  ipcMain.handle("video-edit:edit", async (_event, options) => {
    const requestId = options.requestId || `ve_${Date.now()}`;
    const ac = new AbortController();
    _activePipelines.set(requestId, ac);

    try {
      const mod = await loadPipeline();
      const pipeline = createPipeline(options, mod);

      const runOpts = {
        parallel: !!options.parallel,
        maxConcurrency: options.maxConcurrency || 4,
      };

      let result;
      if (options.review) {
        result = await pipeline.runWithReview(runOpts);
      } else {
        result = await pipeline.run(runOpts);
      }

      return { ok: true, requestId, ...result };
    } catch (e) {
      if (ac.signal.aborted) {
        return { ok: false, requestId, error: "Cancelled" };
      }
      logger.error("[Video-Editing IPC] edit failed:", e);
      return { ok: false, requestId, error: e.message };
    } finally {
      _activePipelines.delete(requestId);
    }
  });

  // ── video-edit:assets-list ──────────────────────────────
  ipcMain.handle("video-edit:assets-list", async () => {
    try {
      const fs = require("fs").promises;
      const path = require("path");
      const base = process.env.APPDATA
        ? path.join(
            process.env.APPDATA,
            "chainlesschain-desktop-vue",
            ".chainlesschain",
            "video-editing",
          )
        : path.join(
            process.env.HOME || "~",
            ".chainlesschain",
            "video-editing",
          );

      const assets = [];
      try {
        const dirs = await fs.readdir(base);
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
          } catch (_e) {
            /* skip invalid */
          }
        }
      } catch (_e) {
        /* dir doesn't exist */
      }

      return { ok: true, assets };
    } catch (e) {
      return { ok: false, error: e.message, assets: [] };
    }
  });

  // ── video-edit:cancel ───────────────────────────────────
  ipcMain.handle("video-edit:cancel", async (_event, requestId) => {
    const ac = _activePipelines.get(requestId);
    if (ac) {
      ac.abort();
      _activePipelines.delete(requestId);
      return { ok: true, cancelled: true };
    }
    return { ok: false, error: "No active pipeline with that requestId" };
  });

  logger.info("[Video-Editing IPC] ✓ 7 channels registered");
  return { channels: CHANNELS };
}

module.exports = { registerVideoEditingIPC, CHANNELS };
