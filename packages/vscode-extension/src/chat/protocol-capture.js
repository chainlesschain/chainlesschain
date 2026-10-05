"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { AgentChatSession } = require("./agent-session");

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

/** Explicit host-driver capture. Normal activation never enables this writer.
 * Keep an open exclusive descriptor: replacing a pathname must not redirect
 * subsequent records. Failed writes invalidate capture, never product input.
 */
function createProtocolCapture(directory) {
  if (!path.isAbsolute(directory))
    throw new Error("protocol capture directory must be absolute");
  let current = path.parse(directory).root;
  for (const segment of path.relative(current, directory).split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("protocol capture directory must not traverse links");
  }
  const captures = new Map();
  const errors = [];
  const record = (value) => {
    let capture;
    try {
      if (!/^[a-f0-9-]{36}$/u.test(value.generation))
        throw new Error("invalid capture generation");
      capture = captures.get(value.generation);
      if (!capture) {
        const file = path.join(directory, `${value.generation}.ndjson`);
        capture = {
          file,
          fd: fs.openSync(file, "wx", 0o600),
          bytes: 0,
          sequence: 0,
          exited: false,
        };
        captures.set(value.generation, capture);
      }
      if (
        capture.failed ||
        capture.exited ||
        value.sequence !== capture.sequence + 1
      )
        throw new Error("incomplete or closed protocol capture");
      const bytes = Buffer.from(JSON.stringify(value) + "\n");
      if (capture.bytes + bytes.length > MAX_CAPTURE_BYTES)
        throw new Error("protocol capture exceeds 16 MiB");
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(capture.fd, bytes, offset);
        if (!written)
          throw new Error("protocol capture write made no progress");
        offset += written;
      }
      capture.bytes += bytes.length;
      capture.sequence = value.sequence;
      if (value.direction === "exit") {
        fs.fsyncSync(capture.fd);
        fs.closeSync(capture.fd);
        capture.fd = null;
        capture.exited = true;
      }
    } catch (error) {
      if (capture) {
        capture.failed = true;
        if (capture.fd !== null) {
          try {
            fs.closeSync(capture.fd);
          } catch {
            /* preserve original failure */
          }
          capture.fd = null;
        }
      }
      if (errors.length < 32) errors.push(String(error.message));
      throw error;
    }
  };
  return {
    createSession: (config) =>
      new AgentChatSession({
        ...config,
        onProtocolRecord: (value) => {
          record(value);
          config.onProtocolRecord?.(value);
        },
      }).start(),
    status: () => ({
      files: [...captures.values()].map(
        ({ file, sequence, exited, failed }) => ({
          file,
          sequence,
          exited,
          failed: Boolean(failed),
        }),
      ),
      errors: [...errors],
    }),
    dispose: () => {
      for (const capture of captures.values()) {
        if (capture.fd !== null) {
          fs.closeSync(capture.fd);
          capture.fd = null;
          capture.failed = true;
        }
      }
    },
  };
}

module.exports = { createProtocolCapture, MAX_CAPTURE_BYTES };
