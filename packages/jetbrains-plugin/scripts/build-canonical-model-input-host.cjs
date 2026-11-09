// Windows-only direct SDK diagnostic build; not a Gradle or release gate.
"use strict";
const fs = require("fs"),
  path = require("path"),
  cp = require("child_process"),
  crypto = require("crypto");
const assert = require("node:assert/strict");
assert.equal(
  process.platform,
  "win32",
  "This native diagnostic requires Windows",
);
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert(["--sdk", "--jdk", "--output"].includes(process.argv[i]));
  options[process.argv[i]] = process.argv[i + 1];
}
for (const key of ["--sdk", "--jdk", "--output"])
  assert(path.isAbsolute(options[key] || ""));
const root = options["--output"],
  sdk = options["--sdk"],
  jdk = options["--jdk"],
  repo = path.resolve(__dirname, "../../..");
assert(
  !fs.existsSync(root),
  "Use a fresh output directory to avoid stale classes",
);
fs.mkdirSync(root, { recursive: true });
const walk = (p) =>
  fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)],
    );
const java = walk(repo + "/packages/jetbrains-plugin/src/main/java").filter(
  (p) => p.endsWith(".java"),
);
const kotlin = [
  ...walk(repo + "/packages/jetbrains-plugin/src/main/kotlin"),
  ...walk(repo + "/packages/agent-protocol/generated/kotlin"),
].filter((p) => p.endsWith(".kt"));
const jars = ["lib", "plugins/java/lib", "plugins/terminal/lib"].flatMap((p) =>
  fs
    .readdirSync(sdk + "/" + p)
    .filter((n) => n.endsWith(".jar"))
    .map((n) => sdk + "/" + p + "/" + n),
);
const classes = root + "/classes";
fs.mkdirSync(classes, { recursive: true });
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
fs.writeFileSync(
  root + "/compile-provenance.json",
  JSON.stringify(
    {
      schema: "chainlesschain.jetbrains-direct-build/v1",
      sources: [
        ...java,
        ...kotlin,
        ...walk(repo + "/packages/jetbrains-plugin/src/main/resources"),
      ].map((p) => ({
        path: path.relative(repo, p),
        sha256: hash(p),
      })),
      sdkJars: jars.map((p) => ({
        name: path.relative(sdk, p),
        sha256: hash(p),
      })),
      compiler: hash(sdk + "/plugins/Kotlin/kotlinc/lib/kotlin-compiler.jar"),
      compilerLibraries: walk(sdk + "/plugins/Kotlin/kotlinc/lib")
        .filter((p) => p.endsWith(".jar"))
        .map((p) => ({ name: path.relative(sdk, p), sha256: hash(p) })),
      javac: hash(jdk + "/bin/javac.exe"),
      java: hash(jdk + "/bin/java.exe"),
      runtime: hash(sdk + "/jbr/bin/java.exe"),
      ide: hash(sdk + "/bin/idea64.exe"),
    },
    null,
    2,
  ),
);
function run(exe, args, name) {
  const af = root + "/" + name + ".args";
  fs.writeFileSync(
    af,
    args.map((x) => JSON.stringify(x.replaceAll("\\", "/"))).join("\n"),
  );
  const r = cp.spawnSync(jdk + "/bin/" + exe, ["@" + af], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 20e6,
  });
  fs.writeFileSync(
    root + "/" + name + ".log",
    (r.stdout || "") + (r.stderr || ""),
  );
  fs.writeFileSync(
    root + "/" + name + "-result.json",
    JSON.stringify({
      exitCode: r.status,
      signal: r.signal,
      error: r.error?.message || null,
    }) + "\n",
  );
  console.log(name, r.status);
  if (r.status !== 0) {
    console.log(r.stderr);
    process.exit(1);
  }
}
run(
  "java.exe",
  [
    "-cp",
    sdk + "/plugins/Kotlin/kotlinc/lib/*",
    "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
    "-no-stdlib",
    "-no-reflect",
    "-jvm-target",
    "21",
    "-classpath",
    jars.join(";"),
    "-d",
    classes,
    ...kotlin,
    ...java,
  ],
  "kotlin",
);
run(
  "javac.exe",
  [
    "-encoding",
    "UTF-8",
    "--release",
    "21",
    "-proc:none",
    "-cp",
    [classes, ...jars].join(";"),
    "-d",
    classes,
    ...java,
  ],
  "java",
);
fs.writeFileSync(
  root + "/build-options.json",
  JSON.stringify({ sdk, jdk, classes }),
);

fs.writeFileSync(
  root + "/compiled-classes.json",
  JSON.stringify(
    walk(classes).map((p) => ({
      path: path.relative(classes, p),
      sha256: hash(p),
    })),
    null,
    2,
  ),
);
for (const [name, executable, args] of [
  ["jdk-version", jdk + "/bin/java.exe", ["-version"]],
  ["runtime-version", sdk + "/jbr/bin/java.exe", ["-version"]],
  [
    "kotlin-version",
    jdk + "/bin/java.exe",
    [
      "-cp",
      sdk + "/plugins/Kotlin/kotlinc/lib/*",
      "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
      "-version",
    ],
  ],
]) {
  const result = cp.spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  assert.equal(result.status, 0, name + " failed");
  fs.writeFileSync(
    root + "/" + name + ".json",
    JSON.stringify(
      { exitCode: result.status, stdout: result.stdout, stderr: result.stderr },
      null,
      2,
    ),
  );
}
