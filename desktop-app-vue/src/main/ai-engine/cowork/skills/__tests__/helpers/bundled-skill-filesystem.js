"use strict";

const nativeFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SUPPORTED_OPERATIONS,
  createBundledSkillFilesystemBroker,
} = require("../../bundled-skill-filesystem-broker.js");

function createTestFilesystemContext(skillId, options = {}) {
  const allowedRoots = options.allowedRoots || [process.cwd(), os.tmpdir()];
  const broker = createBundledSkillFilesystemBroker(
    {
      skillId,
      authorityId: `test-filesystem:${skillId}`,
      allowedRoots,
      allowedOperations: options.allowedOperations || [...SUPPORTED_OPERATIONS],
      cwd: options.cwd || allowedRoots[0],
      ...(options.maxReadBytes ? { maxReadBytes: options.maxReadBytes } : {}),
      ...(options.maxWriteBytes
        ? { maxWriteBytes: options.maxWriteBytes }
        : {}),
      ...(options.maxDirectoryEntries
        ? { maxDirectoryEntries: options.maxDirectoryEntries }
        : {}),
    },
    {
      invoke: ({ operation, args }) => nativeFs[operation](...args),
      auditSink: options.auditSink || (() => {}),
    },
  );
  return {
    host: {
      filesystem: broker,
    },
  };
}

function withTestFilesystemHandler(handler, skillId, options = {}) {
  return {
    ...handler,
    execute(task, context = {}, skill) {
      const contextualRoots = [
        context.projectRoot,
        context.workspaceRoot,
        context.workspacePath,
        context.cwd,
      ].filter(
        (candidate) =>
          typeof candidate === "string" && nativeFs.existsSync(candidate),
      );
      const allowedRoots = [
        ...(options.allowedRoots || [process.cwd(), os.tmpdir()]),
        ...contextualRoots,
      ].map((candidate) => path.resolve(candidate));
      const filesystemContext = createTestFilesystemContext(skillId, {
        ...options,
        allowedRoots,
        cwd:
          contextualRoots[0] || options.cwd || allowedRoots[0] || process.cwd(),
      });
      return handler.execute(
        task,
        {
          ...context,
          host: {
            ...(context.host || {}),
            ...filesystemContext.host,
          },
        },
        skill,
      );
    },
  };
}

module.exports = {
  createTestFilesystemContext,
  withTestFilesystemHandler,
};
