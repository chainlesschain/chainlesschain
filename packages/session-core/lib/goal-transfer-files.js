"use strict";
const fs = require("node:fs");
const { goalError } = require("./goal-contract.js");
const { MAX_TRANSFER_BYTES } = require("./goal-transfer-contract.js");

function readTransferTextFile(file, maxBytes = MAX_TRANSFER_BYTES) {
  const before = fs.lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > maxBytes
  )
    throw goalError("GOAL_TRANSFER_FILE_INVALID");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fs.fstatSync(fd),
      buffer = Buffer.alloc(maxBytes + 1);
    const n = fs.readSync(fd, buffer, 0, buffer.length, 0),
      after = fs.fstatSync(fd),
      current = fs.lstatSync(file);
    if (
      n > maxBytes ||
      n !== before.size ||
      [opened, after, current].some(
        (s) =>
          !s.isFile() ||
          s.nlink !== 1 ||
          s.dev !== before.dev ||
          s.ino !== before.ino ||
          s.size !== before.size ||
          s.mtimeMs !== before.mtimeMs ||
          s.ctimeMs !== before.ctimeMs,
      )
    )
      throw goalError("GOAL_TRANSFER_FILE_INVALID");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, n),
    );
  } finally {
    fs.closeSync(fd);
  }
}
function readTransferJsonFile(file, validate, maxBytes = MAX_TRANSFER_BYTES) {
  return validate(JSON.parse(readTransferTextFile(file, maxBytes)));
}
function writeTransferJsonFile(file, value) {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text, "utf8") > MAX_TRANSFER_BYTES)
    throw goalError("GOAL_TRANSFER_FILE_INVALID");
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}
module.exports = {
  readTransferTextFile,
  readTransferJsonFile,
  writeTransferJsonFile,
};
