"use strict";

const fs = require("node:fs");
const path = require("node:path");

function validateSessionConfig(value) {
  if (
    !value ||
    typeof value.sessionId !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(value.sessionId)
  )
    throw new Error("Invalid canonical session identity");
  for (const key of [
    "sessionHome",
    "securityAnchorHome",
    "workspaceDir",
    "journalPath",
  ])
    if (typeof value[key] !== "string" || !path.isAbsolute(value[key]))
      throw new Error(`Canonical ${key} must be absolute`);
  const expected = path.join(
    value.sessionHome,
    "sessions",
    value.sessionId + ".jsonl",
  );
  if (fs.realpathSync(value.journalPath) !== fs.realpathSync(expected))
    throw new Error("Canonical journal is not the selected session");
  if (!/^[a-f0-9]{64}$/.test(value.expectedJournalDigest || ""))
    throw new Error("Missing canonical journal commitment");
  return Object.fromEntries(
    [
      "sessionId",
      "sessionHome",
      "securityAnchorHome",
      "workspaceDir",
      "journalPath",
      "expectedJournalDigest",
    ].map((key) => [key, value[key]]),
  );
}

// Every process launched by this native readback target is restricted to one
// session. In particular, an accidental agent/resume request cannot infer.
function isAllowedCanonicalRead(args, sessionId) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string"))
    return false;
  if (args.length === 1 && args[0] === "--version") return true;
  if (
    args.length === 3 &&
    args[0] === "llm" &&
    args[1] === "capabilities" &&
    args[2] === "--json"
  )
    return true;
  if (args[0] !== "session" || args[1] !== "show") return false;
  const delimiter = args.indexOf("--");
  let tail;
  if (delimiter !== -1) {
    if (delimiter !== args.length - 2 || args[delimiter + 1] !== sessionId)
      return false;
    tail = args.slice(2, delimiter);
  } else {
    if (args[2] !== sessionId) return false;
    tail = args.slice(3);
  }
  const flags = new Set();
  const values = new Set(["--limit", "--page-size", "--before", "--after"]);
  for (let i = 0; i < tail.length; i++) {
    const flag = tail[i];
    if (flags.has(flag)) return false;
    flags.add(flag);
    if (["--json", "--model-inputs", "--history"].includes(flag)) continue;
    if (!values.has(flag)) return false;
    const value = tail[++i];
    if (
      typeof value !== "string" ||
      !value ||
      value.startsWith("--") ||
      value.length > 8192
    )
      return false;
    if (["--limit", "--page-size"].includes(flag) && !/^\d{1,3}$/.test(value))
      return false;
  }
  if (!flags.has("--json")) return false;
  if (flags.has("--model-inputs"))
    return !["--history", "--page-size", "--before", "--after"].some((f) =>
      flags.has(f),
    );
  return flags.has("--history") && !flags.has("--limit");
}

function createCanonicalReadCli({
  directory,
  node,
  cli,
  sessionId,
  tracePath,
}) {
  fs.mkdirSync(directory, { recursive: true });
  const script = path.join(directory, "read-canonical-session.cjs");
  fs.writeFileSync(
    script,
    `"use strict";
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const {isAllowedCanonicalRead}=require(${JSON.stringify(__filename)});
const args=process.argv.slice(2);
if(!isAllowedCanonicalRead(args,${JSON.stringify(sessionId)})) {
  fs.appendFileSync(${JSON.stringify(tracePath)},JSON.stringify({allowed:false,command:args[0]||null})+'\\n');
  process.stderr.write('Native diagnostic permits only selected-session read commands\\n');
  process.exit(73);
}
fs.appendFileSync(${JSON.stringify(tracePath)},JSON.stringify({allowed:true,args})+'\\n');
const result=spawnSync(process.execPath,[${JSON.stringify(cli)},...args],{env:process.env,windowsHide:true,stdio:'inherit',timeout:30000});
process.exit(result.status===0?0:1);
`,
    { flag: "wx", mode: 0o600 },
  );
  const wrapper = path.join(
    directory,
    process.platform === "win32"
      ? "cc-read-canonical.cmd"
      : "cc-read-canonical",
  );
  const quote = (s) => `'${s.replaceAll("'", `'"'"'`)}'`;
  fs.writeFileSync(
    wrapper,
    process.platform === "win32"
      ? `@echo off\r\n"${node}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(node)} ${quote(script)} "$@"\n`,
    { flag: "wx", mode: 0o700 },
  );
  return { command: wrapper, script };
}

module.exports = {
  validateSessionConfig,
  isAllowedCanonicalRead,
  createCanonicalReadCli,
};
