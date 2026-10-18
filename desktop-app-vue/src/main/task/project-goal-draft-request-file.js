"use strict";
const fs = require("node:fs");
const {
  MAX_REQUEST_BYTES,
  validateGoalDraftRequest,
} = require("@chainlesschain/session-core/goal-draft-request-contract");
function readBoundedGoalJsonFile(file, maxBytes, validator) {
  const before = fs.lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > maxBytes
  )
    throw new Error("GOAL_DRAFT_REQUEST_FILE_INVALID");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fs.fstatSync(fd),
      buffer = Buffer.alloc(maxBytes + 1),
      length = fs.readSync(fd, buffer, 0, buffer.length, 0),
      after = fs.fstatSync(fd),
      current = fs.lstatSync(file);
    if (
      length > maxBytes ||
      [opened, after, current].some(
        (stat) =>
          stat.dev !== before.dev ||
          stat.ino !== before.ino ||
          stat.size !== before.size ||
          stat.mtimeMs !== before.mtimeMs ||
          stat.ctimeMs !== before.ctimeMs,
      )
    )
      throw new Error("GOAL_DRAFT_REQUEST_FILE_INVALID");
    return validator(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        ),
      ),
    );
  } finally {
    fs.closeSync(fd);
  }
}
function readGoalDraftRequestFile(file) {
  return readBoundedGoalJsonFile(
    file,
    MAX_REQUEST_BYTES,
    validateGoalDraftRequest,
  );
}
function readGoalDraftAccessFile(file) {
  return readBoundedGoalJsonFile(
    file,
    4096,
    require("@chainlesschain/session-core/goal-draft-connection-contract")
      .validateGoalDraftAccess,
  );
}
module.exports = { readGoalDraftRequestFile, readGoalDraftAccessFile };
