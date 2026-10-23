// Explicit real-Windows policy differential check; never a release gate alone.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const sourceHashesNow = () =>
  Object.fromEntries(
    [
      "private-storage.js",
      "private-storage-windows-native.cjs",
      "private-storage-windows-api.cjs",
      "private-storage-windows-worker.cjs",
    ].map((name) => [
      name,
      createHash("sha256")
        .update(fs.readFileSync(path.join(__dirname, "../lib", name)))
        .digest("hex"),
    ]),
  );
const sourceHashes = sourceHashesNow();
const koffiEntry = require.resolve("koffi");
const koffiRoot = path.dirname(koffiEntry);
const koffiVersion = JSON.parse(
  fs.readFileSync(path.join(koffiRoot, "package.json")),
).version;
assert.equal(
  koffiVersion,
  "2.16.3",
  "Use the declared, verified Koffi version for this receipt",
);
const dependency = {
  name: "koffi",
  version: koffiVersion,
  realEntry: fs.realpathSync.native(koffiEntry),
  entrySha256: createHash("sha256")
    .update(fs.readFileSync(koffiEntry))
    .digest("hex"),
  nativeSha256: createHash("sha256")
    .update(
      fs.readFileSync(
        path.join(
          koffiRoot,
          "build/koffi",
          `win32_${process.arch}`,
          "koffi.node",
        ),
      ),
    )
    .digest("hex"),
};
const storage = require("../lib/private-storage.js");
const { createWindowsApi } = require("../lib/private-storage-windows-api.cjs");
const {
  mutexName,
  executeRequest,
} = require("../lib/private-storage-windows-native.cjs");
if (process.platform !== "win32" || process.versions.electron)
  throw Error("Real Node Windows is required");
const api = createWindowsApi();
const base = fs.mkdtempSync(
  path.join(fs.realpathSync.native(os.tmpdir()), "cc-native-policy-"),
);
const worker = path.join(
  __dirname,
  "../lib/private-storage-windows-worker.cjs",
);
const legacy = { deps: { fs, spawnSync }, platform: "win32" };
const tests = [];
const capabilities = {};
const request = (targets, extra = {}) => ({
  operation: "repair",
  targets: targets.map(storage._windowsExtendedPath),
  timeoutMs: 30000,
  ...extra,
});
const spawnWorker = (input, extra = {}) =>
  spawnSync(process.execPath, [worker], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/iu.test(key),
      ),
    ),
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    ...extra,
  });
function ps(script, input) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " +
        script,
    ],
    {
      input: input === undefined ? undefined : JSON.stringify(input),
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(
    result.status,
    0,
    "PowerShell policy setup/reference must succeed: " + result.stderr,
  );
  return result.stdout.trim();
}
function test(name, action) {
  const start = performance.now();
  try {
    const details = action();
    tests.push({
      name,
      pass: true,
      elapsedMs: performance.now() - start,
      ...(details ? { details } : {}),
    });
  } catch (error) {
    tests.push({
      name,
      pass: false,
      elapsedMs: performance.now() - start,
      error: error.code || error.name,
    });
    throw error;
  }
}
const fields = (rows) =>
  rows.map((row) => ({
    ok: row.ok,
    exists: row.exists,
    isDirectory: row.details?.isDirectory,
    ownerSid: row.details?.ownerSid,
    currentSid: row.details?.currentSid,
    tokenOwnerSid: row.details?.tokenOwnerSid,
    protected: row.details?.protected,
    aceCount: row.details?.aceCount,
  }));
function inspectEqual(targets) {
  const native = storage.inspectPrivatePaths(targets);
  const powershell = storage.inspectPrivatePaths(targets, legacy);
  assert.deepEqual(fields(native), fields(powershell));
  return native;
}
function broaden(target) {
  ps(
    "$p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path; $d=[IO.Directory]::Exists($p); $sections=[Security.AccessControl.AccessControlSections]::Access; if($d){$a=[IO.Directory]::GetAccessControl($p,$sections)}else{$a=[IO.File]::GetAccessControl($p,$sections)}; $s=[Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $r=[Security.AccessControl.FileSystemAccessRule]::new($s,'ReadAndExecute','Allow'); $a.AddAccessRule($r); if($d){[IO.Directory]::SetAccessControl($p,$a)}else{[IO.File]::SetAccessControl($p,$a)}",
    { path: target },
  );
}
function fileRights(target, rights) {
  ps(
    "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; $s=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a=[IO.File]::GetAccessControl($r.path,[Security.AccessControl.AccessControlSections]::Access); $a.SetAccessRuleProtection($true,$false); foreach($old in @($a.Access)){$a.RemoveAccessRuleSpecific($old)}; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,$r.rights,'Allow')); [IO.File]::SetAccessControl($r.path,$a)",
    { path: target, rights },
  );
}
function securityAt(target) {
  const handle = api.open(target, 0x20080);
  try {
    return api.security(handle);
  } finally {
    api.close(handle);
  }
}
let failed = false;
try {
  test("real directory/file repair agrees with fresh PowerShell policy readback", () => {
    fs.mkdirSync(path.join(base, "data"));
    fs.writeFileSync(path.join(base, "data", "one.txt"), "fixture");
    const targets = [
      base,
      path.join(base, "data"),
      path.join(base, "data", "one.txt"),
    ];
    assert(storage.repairPrivatePaths(targets).every((r) => r.ok));
    assert(inspectEqual(targets).every((r) => r.ok));
    const token = api.token();
    capabilities.distinctTokenOwner = token.ownerSid !== token.userSid;
  });
  test("valid directory and inherited file DACLs remain idempotent", () => {
    const targets = [
      path.join(base, "data"),
      path.join(base, "data", "one.txt"),
    ];
    const before = targets.map(
      (p) => fs.lstatSync(p, { bigint: true }).ctimeNs,
    );
    assert(storage.repairPrivatePaths(targets).every((r) => r.ok));
    assert.deepEqual(
      targets.map((p) => fs.lstatSync(p, { bigint: true }).ctimeNs),
      before,
    );
    assert(storage.repairPrivatePaths(targets, legacy).every((r) => r.ok));
    assert.deepEqual(
      targets.map((p) => fs.lstatSync(p, { bigint: true }).ctimeNs),
      before,
    );
  });
  test("both engines reject broad ACL and native repairs to the same policy", () => {
    const file = path.join(base, "data", "one.txt");
    broaden(file);
    assert.equal(inspectEqual([file])[0].ok, false);
    assert.equal(storage.repairPrivatePaths([file])[0].ok, true);
    assert.equal(inspectEqual([file])[0].ok, true);
  });
  test("both engines reject weak directory inheritance/protection", () => {
    const directory = path.join(base, "data");
    broaden(directory);
    assert.equal(inspectEqual([directory])[0].ok, false);
    assert.equal(storage.repairPrivatePaths([directory], legacy)[0].ok, true);
    assert.equal(inspectEqual([directory])[0].ok, true);
  });
  test("directory TRAVERSE pin refuses ancestor rename without LIST right", () => {
    const file = path.join(base, "traverse-only"),
      renamed = path.join(base, "replaced-directory");
    fs.mkdirSync(file);
    ps(
      "$p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path; $s=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a=[IO.Directory]::GetAccessControl($p,[Security.AccessControl.AccessControlSections]::Access); $a.SetAccessRuleProtection($true,$false); foreach($old in @($a.Access)){$a.RemoveAccessRuleSpecific($old)}; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,'Traverse,ReadAttributes,ReadPermissions,ChangePermissions,Delete','Allow')); [IO.Directory]::SetAccessControl($p,$a)",
      { path: file },
    );
    const handle = api.open(file, 0xa0);
    try {
      const child = spawnSync(
        process.execPath,
        [
          "-e",
          "try{require('node:fs').renameSync(process.argv[1],process.argv[2]);process.exit(2)}catch(e){process.exit(['EPERM','EACCES','EBUSY'].includes(e.code)?0:3)}",
          file,
          renamed,
        ],
        { windowsHide: true, timeout: 5000 },
      );
      assert.equal(child.status, 0);
      assert(fs.existsSync(file));
      assert(!fs.existsSync(renamed));
    } finally {
      api.close(handle);
    }
    fs.renameSync(file, renamed);
    fs.renameSync(renamed, file);
    assert(storage.repairPrivatePaths([file])[0].ok);
  });
  test("owner files with no data-read or execute rights repair like PowerShell", () => {
    const file = path.join(base, "no-data-read.txt");
    fs.writeFileSync(file, "fixture");
    try {
      fileRights(file, "ReadPermissions,ChangePermissions");
      assert(storage.repairPrivatePaths([file])[0].ok);
      assert(inspectEqual([file])[0].ok);
      fileRights(file, "ReadPermissions,ChangePermissions");
      assert(storage.repairPrivatePaths([file], legacy)[0].ok);
      assert(inspectEqual([file])[0].ok);
    } finally {
      fileRights(file, "FullControl");
    }
  });
  test("batch ancestor junction rejection precedes every ACL mutation", () => {
    const outside = path.join(base, "outside"),
      link = path.join(base, "link");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "target.txt"), "fixture");
    fs.symlinkSync(outside, link, "junction");
    const first = path.join(base, "data", "one.txt");
    broaden(first);
    const before = fields(storage.inspectPrivatePaths([first]));
    const result = spawnWorker(request([first, path.join(link, "target.txt")]));
    assert.equal(result.status, 4);
    assert(JSON.parse(result.stdout).every((r) => r.ok === false));
    assert.deepEqual(fields(storage.inspectPrivatePaths([first])), before);
    assert.throws(() =>
      storage.repairPrivatePaths(
        [first, path.join(link, "target.txt")],
        legacy,
      ),
    );
    fs.unlinkSync(link);
    assert(storage.repairPrivatePaths([first])[0].ok);
  });
  for (const stage of ["before-prewrite", "after-prewrite"])
    test(`real file replacement ${stage} never modifies the replacement`, () => {
      const directory = path.join(base, stage);
      fs.mkdirSync(directory);
      const target = path.join(directory, "target"),
        moved = path.join(directory, "moved"),
        replacement = path.join(directory, "replacement");
      fs.writeFileSync(target, "original");
      fs.writeFileSync(replacement, "replacement");
      broaden(target);
      broaden(replacement);
      const originalBefore = securityAt(target);
      const replacementBefore = securityAt(replacement);
      let swapped = false,
        writes = 0;
      const swap = () => {
        assert(!swapped);
        fs.renameSync(target, moved);
        fs.renameSync(replacement, target);
        swapped = true;
      };
      const wrapped = {
        ...api,
        open(name, access) {
          const h = api.open(name, access);
          if (stage === "before-prewrite" && access & 0x40000) swap();
          return h;
        },
        writeSecurity(...args) {
          if (stage === "after-prewrite") swap();
          writes++;
          return api.writeSecurity(...args);
        },
      };
      assert.throws(
        () =>
          executeRequest(request([target]), wrapped, {
            guard: storage.assertSafeOwnerOnlyPath,
          }),
        /PATH_IDENTITY_CHANGED/u,
      );
      assert(swapped);
      assert.equal(writes, stage === "before-prewrite" ? 0 : 1);
      assert.equal(inspectEqual([target])[0].ok, false);
      assert.equal(inspectEqual([moved])[0].ok, stage === "after-prewrite");
      assert.deepEqual(securityAt(target), replacementBefore);
      if (stage === "before-prewrite")
        assert.deepEqual(securityAt(moved), originalBefore);
      return {
        replacementMutated: false,
        authorizedOriginalMutated: stage === "after-prewrite",
        finalAdmissionRejected: true,
      };
    });
  test("case-sensitive NTFS cache isolation when supported", () => {
    const directory = path.join(base, "case-sensitive");
    fs.mkdirSync(directory);
    const enabled = spawnSync(
      "fsutil.exe",
      ["file", "setCaseSensitiveInfo", directory, "enable"],
      { windowsHide: true, timeout: 5000 },
    );
    capabilities.caseSensitiveDirectory = enabled.status === 0;
    if (!capabilities.caseSensitiveDirectory)
      return { capabilityUnavailable: true };
    fs.mkdirSync(path.join(directory, "safe"));
    fs.writeFileSync(path.join(directory, "safe", "a.txt"), "a");
    fs.symlinkSync(
      path.join(base, "outside"),
      path.join(directory, "SAFE"),
      "junction",
    );
    const result = spawnWorker(
      request([
        path.join(directory, "safe", "a.txt"),
        path.join(directory, "SAFE", "target.txt"),
      ]),
    );
    assert.equal(result.status, 4);
    assert(JSON.parse(result.stdout).every((r) => r.ok === false));
    fs.unlinkSync(path.join(directory, "SAFE"));
  });
  test("invariant uppercase agrees with Windows PowerShell over BMP and astral probes", () => {
    const source = Array.from({ length: 65536 }, (_, n) => n)
      .filter((n) => n < 0xd800 || n > 0xdfff)
      .map((n) => String.fromCharCode(n))
      .join("");
    let native = "";
    for (let i = 0; i < source.length; i += 2048)
      native += api.invariantUpper(source.slice(i, i + 2048));
    const baseline = ps(
      "$b=[Text.StringBuilder]::new(); for($n=0;$n -le 65535;$n++){if($n -lt 55296 -or $n -gt 57343){[void]$b.Append([char]$n)}}; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($b.ToString().ToUpperInvariant())))",
    );
    assert.equal(Buffer.from(native, "utf16le").toString("base64"), baseline);
    const astral = [0x10428, 0x1044f, 0x1e922, 0x1e943]
      .map((n) => String.fromCodePoint(n))
      .join("");
    const reference = ps(
      "$s=([Console]::In.ReadToEnd()|ConvertFrom-Json).text; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($s.ToUpperInvariant())))",
      { text: astral },
    );
    assert.equal(
      Buffer.from(api.invariantUpper(astral), "utf16le").toString("base64"),
      reference,
    );
    return {
      bmpCodeUnits: source.length,
      astralCodePoints: 4,
      mappingSha256: createHash("sha256")
        .update(native, "utf16le")
        .digest("hex"),
    };
  });
  test("mutex hashes match old .NET full-path invariant mapping for actual extended inputs", () => {
    const suffix = String.fromCodePoint(
      0xdf,
      0x131,
      0x17f,
      0xb5,
      0x3c3,
      0x3c2,
      0xfb01,
      0x10428,
    );
    const targets = [
      path.join(base, "mixed", "..", suffix),
      "C:\\fixture\\" + suffix,
      "\\\\server\\share\\" + suffix,
    ].map(storage._windowsExtendedPath);
    const sid = api.token().userSid;
    const reference = JSON.parse(
      ps(
        "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; $v=@($r.paths | ForEach-Object {$s=$r.sid+':'+[IO.Path]::GetFullPath($_).ToUpperInvariant(); $h=[Security.Cryptography.SHA256]::Create(); try{'Global\\ChainlessChain.PrivateAcl.'+[BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace('-','')}finally{$h.Dispose()}}); [Console]::Write((ConvertTo-Json -InputObject $v -Compress))",
        { sid, paths: targets },
      ),
    );
    assert.deepEqual(
      targets.map((target) =>
        mutexName(sid, api.fullPath(target), api.invariantUpper),
      ),
      reference,
    );
    return {
      extendedDriveCases: 2,
      extendedUncCases: 1,
      unicodeProbeCodePoints: 8,
    };
  });
  test("worker rejects malformed, oversized, duplicate and alternate-stream requests", () => {
    const file = path.join(base, "data", "one.txt");
    const cases = [
      "{invalid",
      " ".repeat(4 * 1024 * 1024 + 1),
      request([file, file]),
      request([file], { operation: "execute" }),
      request([file + ":stream"]),
    ];
    for (const input of cases) {
      const result = spawnWorker(input);
      assert.equal(result.status, 4);
      assert(!result.stderr.includes("\n    at "));
      assert(!result.stderr.includes(base));
    }
  });
  test("supervisor kills a worker under a held mutex and the next operation recovers", () => {
    const file = path.join(base, "data", "one.txt"),
      sid = api.token().userSid;
    const mutex = api.createMutex(
      mutexName(
        sid,
        api.fullPath(storage._windowsExtendedPath(file)),
        api.invariantUpper,
      ),
    );
    assert(api.waitMutex(mutex, 1000));
    let result;
    try {
      result = spawnWorker(request([file]), { timeout: 250 });
    } finally {
      api.releaseMutex(mutex);
      api.close(mutex);
    }
    assert.equal(result.error?.code, "ETIMEDOUT");
    assert(result.pid > 0);
    assert.throws(
      () => process.kill(result.pid, 0),
      (error) => error.code === "ESRCH",
    );
    assert.equal(storage.repairPrivatePaths([file])[0].ok, true);
    return {
      timedOutWorkerExited: true,
      recoveryVerified: true,
      workerLockEntryObserved: false,
      testSupervisorTimeoutMs: 250,
      productionTimeoutsUnchanged: [15000, 30000],
    };
  });
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  assert.equal(
    path.dirname(fs.realpathSync.native(base)),
    fs.realpathSync.native(os.tmpdir()),
  );
  assert(path.basename(base).startsWith("cc-native-policy-"));
  fs.rmSync(base, { recursive: true, force: true });
  const sourceUnchanged =
    JSON.stringify(sourceHashesNow()) === JSON.stringify(sourceHashes);
  if (!sourceUnchanged) failed = true;
  const report = {
    schema: "chainlesschain.windows-native-policy-differential/v1",
    sourceHashes,
    sourceUnchanged,
    dependency,
    node: process.version,
    platform: process.platform,
    tests,
    capabilities,
    pass: !failed,
    qualification: false,
    electron: "legacy PowerShell backend retained",
    fileRaceBoundary:
      "Files can move after the prewrite path check. Only the held authorized object is mutated; a replacement is never mutated and final path identity changes reject admission. Failure does not imply no original-object mutation.",
  };
  if (process.env.CC_NATIVE_POLICY_RECEIPT)
    fs.writeFileSync(
      process.env.CC_NATIVE_POLICY_RECEIPT,
      JSON.stringify(report, null, 2),
    );
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exitCode = 1;
}
