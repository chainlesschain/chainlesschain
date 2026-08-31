#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function freezeGraphProductionInput(file) {
  const resolved = path.resolve(file);
  const before = fs.lstatSync(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    fs.realpathSync(resolved) !== resolved ||
    (process.platform !== "win32" &&
      typeof process.getuid === "function" &&
      before.uid !== process.getuid())
  ) {
    throw new Error(`${file} is not a canonical runner-owned regular file`);
  }
  const fd = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fs.fstatSync(fd);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.nlink !== 1
    ) {
      throw new Error(`${file} changed before it could be frozen`);
    }
    if (process.platform !== "win32") fs.fchmodSync(fd, 0o400);
    const after = fs.lstatSync(resolved);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.nlink !== 1 ||
      (process.platform !== "win32" && (after.mode & 0o222) !== 0)
    ) {
      throw new Error(`${file} changed while it was being frozen`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return resolved;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const files = process.argv.slice(2);
    if (files.length < 1 || files.some((file) => file.startsWith("--"))) {
      throw new Error("one or more trust input files are required");
    }
    for (const file of files) freezeGraphProductionInput(file);
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
