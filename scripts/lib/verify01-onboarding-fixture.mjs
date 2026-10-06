import fs from "node:fs";
import path from "node:path";

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

/** Private command identity fixtures; never installation or provider evidence. */
export function createOnboardingFixture({
  root,
  dirs,
  version,
  platform = process.platform,
  node = process.execPath,
  systemRoot = process.env.SystemRoot || "C:\\Windows",
}) {
  if (!/^\d+\.\d+\.\d+$/u.test(version))
    throw new Error("A bare fixture CLI version is required");
  const windows = platform === "win32";
  const fixture = path.join(root, "identity-peer.cjs");
  const trace = path.join(root, "identity-trace.jsonl");
  const mode = path.join(dirs.capture, "version-mode.txt");
  fs.writeFileSync(mode, "valid", { flag: "wx" });
  fs.writeFileSync(trace, "", { flag: "wx" });
  fs.writeFileSync(
    fixture,
    `const fs=require('node:fs');
const identity=process.argv[2],args=process.argv.slice(3);
const mode=identity==='managed'?'valid':fs.readFileSync(${JSON.stringify(mode)},'utf8');
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({at:new Date().toISOString(),pid:process.pid,identity,args,mode})+'\\n');
if(args.includes('--version'))console.log(mode==='gcc'?'cc (GCC) 12.2.0':${JSON.stringify(version)});
else if(args[0]==='agent'){console.error('Agent invocation forbidden in identity diagnostic');process.exitCode=98;}
else if(args[0]==='config'&&args[1]==='get')console.log('');
else console.log('{}');
`,
    { flag: "wx" },
  );
  const shim = (file, identity) => {
    fs.writeFileSync(
      file,
      windows
        ? `@echo off\r\n"${node}" "${fixture}" "${identity}" %*\r\n`
        : `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(fixture)} ${shellQuote(identity)} "$@"\n`,
      { flag: "wx", mode: 0o700 },
    );
    if (!windows) fs.chmodSync(file, 0o700);
  };
  const goodCommand = path.join(root, windows ? "good.cmd" : "good");
  const globalCommand = path.join(dirs.bin, windows ? "cc.cmd" : "cc");
  shim(goodCommand, "explicit");
  shim(globalCommand, "global");
  const managed = path.join(
    dirs.home,
    ".chainlesschain",
    "ide",
    "managed-cli-jetbrains",
  );
  const managedPackage = path.join(managed, version, "package");
  fs.mkdirSync(managedPackage, { recursive: true });
  fs.writeFileSync(
    path.join(managedPackage, "package.json"),
    JSON.stringify({
      name: "chainlesschain",
      version,
      bin: { cc: "entry.cjs" },
    }),
  );
  fs.writeFileSync(
    path.join(managedPackage, "entry.cjs"),
    "// Local fixture.\n",
  );
  fs.writeFileSync(
    path.join(managed, "current.json"),
    JSON.stringify({ version, previousVersion: null }),
  );
  const managedCommand = path.join(
    managed,
    windows ? "cc-managed.cmd" : "cc-managed",
  );
  shim(managedCommand, "managed");
  return {
    fixture,
    trace,
    mode,
    goodCommand,
    globalCommand,
    managedCommand,
    missingCommand: path.join(
      root,
      windows ? "not-installed.cmd" : "not-installed",
    ),
    // Only the IDE receives this PATH. Gradle retains its build tools. On POSIX
    // absolute /bin/sh and node in our shims work without exposing system cc.
    idePath: windows
      ? `${dirs.bin};${path.win32.join(systemRoot, "System32")}`
      : dirs.bin,
  };
}
