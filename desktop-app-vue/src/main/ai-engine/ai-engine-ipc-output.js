"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { resolveProjectChildPath } = require("../project/project-root-path");

const WINDOWS_RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const ALLOWED_EXTENSIONS = new Set([".pptx", ".docx"]);

function outputError() {
  const error = new Error("AI Engine output target is unavailable");
  error.code = "CC_AI_ENGINE_OUTPUT_UNAVAILABLE";
  return error;
}

function sanitizeBaseName(value, fallback) {
  const baseName = String(value || fallback)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/g, "")
    .replace(/[. ]+$/g, "");
  const normalized = (baseName || fallback).slice(0, 96).replace(/[. ]+$/g, "");
  const windowsStem = normalized.split(".", 1)[0].toUpperCase();
  const safeName = WINDOWS_RESERVED_FILE_NAMES.has(windowsStem)
    ? `_${normalized}`
    : normalized;
  return safeName.slice(0, 96).replace(/[. ]+$/g, "") || fallback;
}

async function loadProject(database, projectId) {
  if (typeof database?.getProjectById === "function") {
    return await database.getProjectById(projectId);
  }
  if (typeof database?.db?.prepare === "function") {
    return database.db
      .prepare(
        `SELECT id, user_id, root_path, root_path_local_attested, deleted
         FROM projects WHERE id = ? LIMIT 1`,
      )
      .get(projectId);
  }
  throw outputError();
}

function canonicalPath(pathModule, value) {
  const resolved = pathModule.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function assertRealProjectRoot(fs, pathModule, project) {
  if (
    !project ||
    Number(project.deleted || 0) !== 0 ||
    Number(project.root_path_local_attested) !== 1 ||
    typeof project.root_path !== "string" ||
    project.root_path.trim() === "" ||
    !pathModule.isAbsolute(project.root_path)
  ) {
    throw outputError();
  }

  let rootStats;
  let realRoot;
  try {
    rootStats = await fs.lstat(project.root_path);
    realRoot = await fs.realpath(project.root_path);
  } catch {
    throw outputError();
  }
  if (
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink() ||
    canonicalPath(pathModule, realRoot) !==
      canonicalPath(pathModule, project.root_path)
  ) {
    throw outputError();
  }
  return realRoot;
}

async function assertProjectAuthority(
  authorizeProjectOutput,
  context,
  project,
) {
  if (!authorizeProjectOutput) {
    return;
  }
  let decision;
  try {
    decision = await authorizeProjectOutput(
      Object.freeze({
        actorDid: context.actorDid,
        operation: context.operation,
        projectId: project.id,
        projectUserId:
          typeof project.user_id === "string" ? project.user_id : null,
        purpose: context.purpose,
        senderId: context.senderId,
        tenantId: context.tenantId,
      }),
    );
  } catch {
    throw outputError();
  }
  if (decision !== true && decision?.authorized !== true) {
    throw outputError();
  }
}

function createAIEngineOutputResolver({
  database,
  authorizeProjectOutput,
  fs = nodeFs.promises,
  path = nodePath,
} = {}) {
  if (!database) {
    throw new TypeError("AI Engine output resolver requires a database");
  }
  if (
    authorizeProjectOutput !== undefined &&
    typeof authorizeProjectOutput !== "function"
  ) {
    throw new TypeError("AI Engine project authority must be a function");
  }

  return Object.freeze({
    async reserve(context, { projectId, title, extension }) {
      if (
        !context ||
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(projectId) ||
        !ALLOWED_EXTENSIONS.has(extension)
      ) {
        throw outputError();
      }

      let project;
      try {
        project = await loadProject(database, projectId);
      } catch {
        throw outputError();
      }
      if (!project || project.id !== projectId) {
        throw outputError();
      }
      await assertProjectAuthority(authorizeProjectOutput, context, project);
      const projectRoot = await assertRealProjectRoot(fs, path, project);
      const fallback = extension === ".pptx" ? "presentation" : "document";
      const baseName = sanitizeBaseName(title, fallback);

      let outputPath;
      let fileName;
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        fileName = `${baseName}${suffix}${extension}`;
        outputPath = resolveProjectChildPath(projectRoot, fileName);
        try {
          const handle = await fs.open(outputPath, "wx", 0o600);
          try {
            await handle.close();
          } catch {
            try {
              await handle.close();
            } catch {
              // Best effort: the handle may already have closed.
            }
            try {
              await fs.unlink(outputPath);
            } catch {
              // The fixed public error below deliberately hides filesystem state.
            }
            throw outputError();
          }
          break;
        } catch (error) {
          if (error?.code !== "EEXIST") {
            throw outputError();
          }
          outputPath = null;
          fileName = null;
        }
      }
      if (!outputPath || !fileName) {
        throw outputError();
      }

      let committed = false;
      return Object.freeze({
        fileName,
        outputPath,
        async commit() {
          let stats;
          try {
            stats = await fs.lstat(outputPath);
          } catch {
            throw outputError();
          }
          if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1) {
            throw outputError();
          }
          committed = true;
          return Object.freeze({ fileSize: stats.size });
        },
        async cleanup() {
          if (committed) {
            return;
          }
          try {
            await fs.unlink(outputPath);
          } catch (error) {
            if (error?.code !== "ENOENT") {
              throw outputError();
            }
          }
        },
      });
    },
  });
}

module.exports = {
  createAIEngineOutputResolver,
  sanitizeBaseName,
};
