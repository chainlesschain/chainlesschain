// Read-only Windows native diagnostic; reflection selects an existing session.
// Does not initiate an IDE task or satisfy Gradle/release gates.
"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const cp = require("node:child_process"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
assert.equal(
  process.platform,
  "win32",
  "This native diagnostic requires Windows",
);
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  assert(
    ["--sdk", "--jdk", "--classes", "--session-config"].includes(
      process.argv[index],
    ),
  );
  options[process.argv[index]] = process.argv[index + 1];
}
for (const key of ["--sdk", "--jdk", "--classes", "--session-config"])
  assert(path.isAbsolute(options[key] || ""));
const sdk = options["--sdk"],
  jdk = options["--jdk"],
  classes = options["--classes"];
assert(fs.existsSync(path.join(sdk, "bin/idea64.exe")));
assert(fs.existsSync(path.join(jdk, "bin/javac.exe")));
const plugin = path.resolve(__dirname, ".."),
  repository = path.resolve(plugin, "../..");
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-model-input-jetbrains-host-"),
);

const hashFile = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const buildRoot = path.dirname(classes);
const provenance = JSON.parse(
  fs.readFileSync(path.join(buildRoot, "compile-provenance.json"), "utf8"),
);
const walk = (p) =>
  fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)],
    );
assert.equal(provenance.schema, "chainlesschain.jetbrains-direct-build/v1");
for (const name of [
  "kotlin-result",
  "java-result",
  "jdk-version",
  "runtime-version",
  "kotlin-version",
])
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(buildRoot, name + ".json"), "utf8"))
      .exitCode,
    0,
    "Required compiler/version result must pass",
  );
const sourceFiles = [
  ...walk(path.join(plugin, "src/main/java")).filter((p) =>
    p.endsWith(".java"),
  ),
  ...walk(path.join(plugin, "src/main/kotlin")).filter((p) =>
    p.endsWith(".kt"),
  ),
  ...walk(
    path.join(repository, "packages/agent-protocol/generated/kotlin"),
  ).filter((p) => p.endsWith(".kt")),
  ...walk(path.join(plugin, "src/main/resources")),
]
  .map((p) => path.relative(repository, p))
  .sort();
assert.deepEqual(
  sourceFiles,
  provenance.sources.map((e) => e.path).sort(),
  "Source inventory changed",
);
const compiledInventory = JSON.parse(
  fs.readFileSync(path.join(buildRoot, "compiled-classes.json"), "utf8"),
);
assert.deepEqual(
  walk(classes)
    .map((p) => path.relative(classes, p))
    .sort(),
  compiledInventory.map((e) => e.path).sort(),
  "Compiled output inventory changed",
);
for (const entry of provenance.sources)
  assert.equal(
    hashFile(path.join(repository, entry.path)),
    entry.sha256,
    "Current source differs from compiled source",
  );
for (const entry of [...provenance.sdkJars, ...provenance.compilerLibraries])
  assert.equal(
    hashFile(path.join(sdk, entry.name)),
    entry.sha256,
    "Cached SDK dependency changed",
  );
for (const [key, file] of [
  ["javac", path.join(jdk, "bin/javac.exe")],
  ["java", path.join(jdk, "bin/java.exe")],
  ["runtime", path.join(sdk, "jbr/bin/java.exe")],
  ["ide", path.join(sdk, "bin/idea64.exe")],
])
  assert.equal(hashFile(file), provenance[key]);
for (const entry of JSON.parse(
  fs.readFileSync(path.join(buildRoot, "compiled-classes.json"), "utf8"),
))
  assert.equal(
    hashFile(path.join(classes, entry.path)),
    entry.sha256,
    "Compiled class changed",
  );
fs.copyFileSync(
  path.join(buildRoot, "compile-provenance.json"),
  path.join(root, "compile-provenance.json"),
);

const contract = require(
  path.join(
    repository,
    "packages/vscode-extension/test/extension-host/canonical-model-input-contract.cjs",
  ),
);
const configData = contract.validateSessionConfig(
  JSON.parse(fs.readFileSync(options["--session-config"], "utf8")),
);
const home = configData.sessionHome,
  anchor = configData.securityAnchorHome,
  session = configData.sessionId;
const expected = path.join(root, "expected-report.json");
const journal = configData.journalPath;
const digest = () =>
  crypto.createHash("sha256").update(fs.readFileSync(journal)).digest("hex");
assert.equal(digest(), configData.expectedJournalDigest);
fs.writeFileSync(path.join(root, "journal-before.sha256"), digest());
fs.writeFileSync(path.join(root, "session-id.txt"), session);
const run = (command, args, name, cwd = plugin) => {
  const r = cp.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(root, name + ".stdout.log"), r.stdout || "");
  fs.writeFileSync(path.join(root, name + ".stderr.log"), r.stderr || "");
  fs.writeFileSync(
    path.join(root, name + "-result.json"),
    JSON.stringify({
      exitCode: r.status,
      signal: r.signal,
      error: r.error?.message || null,
    }),
  );
  assert.equal(r.status, 0, name + ": " + (r.stderr || r.error || ""));
};
const cliEntry = path.join(repository, "packages/cli/bin/chainlesschain.js");
const guarded = contract.createCanonicalReadCli({
  directory: root,
  node: process.execPath,
  cli: cliEntry,
  sessionId: session,
  tracePath: path.join(root, "cli-invocations.jsonl"),
});
const cli = path.join(root, "cc-canonical.cmd");
fs.copyFileSync(guarded.command, cli);
const read = cp.spawnSync(
  process.execPath,
  [guarded.script, "session", "show", session, "--json", "--model-inputs"],
  {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    env: {
      ...process.env,
      CHAINLESSCHAIN_HOME: home,
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: anchor,
    },
  },
);
assert.equal(read.status, 0);
JSON.parse(read.stdout);
fs.writeFileSync(expected, read.stdout);
// Separate the outer preflight from all calls made by the actual IDE process.
fs.renameSync(
  path.join(root, "cli-invocations.jsonl"),
  path.join(root, "preflight-cli-invocations.jsonl"),
);
const plugins = path.join(root, "plugins");
const targetLib = path.join(plugins, "chainlesschain-ide-bridge/lib"),
  driverLib = path.join(plugins, "cc-source-test/lib");
fs.mkdirSync(targetLib, { recursive: true });
fs.mkdirSync(driverLib, { recursive: true });
const jar = path.join(jdk, "bin/jar.exe"),
  javac = path.join(jdk, "bin/javac.exe");
run(
  jar,
  [
    "--create",
    "--file",
    path.join(targetLib, "chainlesschain-ide-bridge.jar"),
    "-C",
    classes,
    ".",
    "-C",
    path.join(plugin, "src/main/resources"),
    ".",
  ],
  "package-development-plugin",
);
const driverClasses = path.join(root, "probe-classes");
fs.mkdirSync(path.join(driverClasses, "META-INF"), { recursive: true });
fs.writeFileSync(
  path.join(driverClasses, "META-INF/plugin.xml"),
  "<idea-plugin><id>cc.source.model-input-test</id><name>Canonical Model Input Readback Driver</name><version>1.0</version>" +
    '<idea-version since-build="242"/><depends>com.intellij.modules.platform</depends><depends>com.chainlesschain.ide</depends>' +
    '<extensions defaultExtensionNs="com.intellij"><postStartupActivity implementation="com.chainlesschain.ide.modelinputtest.ModelInputProbe"/></extensions></idea-plugin>',
);
const sdkJars = ["lib", "plugins/java/lib", "plugins/terminal/lib"].flatMap(
  (folder) =>
    fs
      .readdirSync(path.join(sdk, folder))
      .filter((name) => name.endsWith(".jar"))
      .map((name) => path.join(sdk, folder, name)),
);
const classpath = [classes, ...sdkJars].join(path.delimiter);
const compileArgs = [
  "-encoding",
  "UTF-8",
  "--release",
  "21",
  "-proc:none",
  "-cp",
  classpath,
  "-d",
  driverClasses,
  path.join(
    plugin,
    "src/modelInputHost/java/com/chainlesschain/ide/modelinputtest/ModelInputProbe.java",
  ),
];
const argfile = path.join(root, "compile.args");
fs.writeFileSync(
  argfile,
  compileArgs
    .map((arg) => JSON.stringify(arg.replaceAll("\\", "/")))
    .join("\n"),
);
run(javac, ["-J-Duser.language=en", "@" + argfile], "compile-native-probe");
run(
  jar,
  [
    "--create",
    "--file",
    path.join(driverLib, "model-input-probe.jar"),
    "-C",
    driverClasses,
    ".",
  ],
  "package-native-probe",
);
const forward = (value) => value.replaceAll("\\", "/");
const config = path.join(root, "config");
fs.mkdirSync(path.join(config, "options"), { recursive: true });
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
fs.writeFileSync(
  path.join(config, "options/chainlesschain-ide.xml"),
  '<application><component name="ChainlessChainIdeSettings">' +
    '<option name="ccPath" value="' +
    xml(cli) +
    '"/><option name="managedCliEnabled" value="false"/>' +
    '<option name="contextIndicator" value="false"/><option name="automaticCompletionEnabled" value="false"/></component></application>',
);
const properties = path.join(root, "idea.properties");
fs.writeFileSync(
  properties,
  [
    "idea.config.path=" + forward(config),
    "idea.system.path=" + forward(path.join(root, "system")),
    "idea.plugins.path=" + forward(plugins),
    "idea.log.path=" + forward(path.join(root, "logs")),
  ].join("\n") + "\n",
);
const vm = path.join(root, "idea.vmoptions");
fs.writeFileSync(
  vm,
  fs.readFileSync(path.join(sdk, "bin/idea64.exe.vmoptions"), "utf8") +
    "\n" +
    [
      "-Dcc.modelInputs.testRoot=" + forward(root),
      "-Duser.home=" + forward(path.join(root, "user-home")),
      "-Didea.trust.all.projects=true",
      "-Djb.privacy.policy.text=<!--999.999-->",
      "-Djb.consents.confirmation.enabled=false",
      "-Dide.show.tips.on.startup.default.value=false",
      "-Didea.initially.ask.config=false",
    ].join("\n") +
    "\n",
);
const workspace = path.join(root, "workspace");
fs.mkdirSync(workspace);
fs.writeFileSync(
  path.join(workspace, "README.md"),
  "# Read-only canonical session diagnostic host\n",
);
const env = {
  ...process.env,
  IDEA_PROPERTIES: properties,
  IDEA_VM_OPTIONS: vm,
  IDEA_JDK: path.join(sdk, "jbr"),
  CHAINLESSCHAIN_HOME: home,
  CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: anchor,
};
for (const key of Object.keys(env))
  if (/API_KEY|TOKEN|SECRET|AUTH|NODE_OPTIONS|ELECTRON_RUN_AS_NODE/i.test(key))
    delete env[key];
const log = fs.openSync(path.join(root, "idea-console.log"), "wx");
const child = cp.spawn(path.join(sdk, "bin/idea64.exe"), [workspace], {
  env,
  windowsHide: false,
  stdio: ["ignore", log, log],
});
console.log(
  JSON.stringify({
    root,
    pid: child.pid,
    scope: "development-plugin-target-sdk-2024.2",
  }),
);

const timeout = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
  console.error("Native JetBrains deadline exceeded");
}, 180000);
child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  fs.closeSync(log);
  assert.equal(digest(), configData.expectedJournalDigest);
  const invocations = fs
    .readFileSync(path.join(root, "cli-invocations.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert(
    invocations.every(
      (call) =>
        call.allowed === true &&
        contract.isAllowedCanonicalRead(call.args, session),
    ),
    "IDE attempted a disallowed command",
  );
  assert(
    invocations.some((call) => call.args.includes("--model-inputs")),
    "Production IDE model-input query missing",
  );
  fs.writeFileSync(
    path.join(root, "process-result.json"),
    JSON.stringify({
      code,
      signal,
      journalUnchanged: true,
      productionModelInputQueryVerified: true,
      guardedReadInvocationCount: invocations.length,
    }) + "\n",
  );
  const report = path.join(root, "host-result.json");
  console.log(
    JSON.stringify({ root, code, signal, resultExists: fs.existsSync(report) }),
  );
  if (fs.existsSync(report)) {
    const data = JSON.parse(fs.readFileSync(report, "utf8"));
    console.log(JSON.stringify(data, null, 2));
    if (data.status !== "passed" || code !== 0) process.exitCode = 1;
  } else {
    process.exitCode = 1;
    console.error(
      fs.readFileSync(path.join(root, "idea-console.log"), "utf8").slice(-2500),
    );
  }
});
