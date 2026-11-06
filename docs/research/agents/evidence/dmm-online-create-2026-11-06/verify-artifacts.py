import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parents[5]
evidence = Path(__file__).parent
matched = []
hashes = {}
packages = [
    ("cli", Path(sys.argv[1]), [
        "src/commands/goal.js", "src/command-help-index.json",
        "src/lib/project-goal-connection.js", "src/lib/project-goal-draft-connection.js",
        "src/lib/plugin-runtime/cli-goal-drafts.js",
        "src/lib/plugin-runtime/examples/goal-task-creator/plugin.json",
        "src/lib/plugin-runtime/examples/goal-task-creator/README.md",
        "src/lib/plugin-runtime/examples/project-delivery-assistant/plugin.json",
        "src/lib/plugin-runtime/examples/project-delivery-assistant/README.md", "README.md",
    ]),
    ("session-core", Path(sys.argv[2]), [
        "lib/goal-draft-connection-contract.js", "lib/project-goal-external-drafts.js",
        "lib/project-goal-extension-queue.js", "package.json", "README.md",
    ]),
]
with tempfile.TemporaryDirectory(prefix="dmm-v6-pack-") as temp:
    staging = Path(temp)
    for package, archive_path, files in packages:
        hashes[package] = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        with tarfile.open(str(archive_path), "r:gz") as archive:
            for file in files:
                assert (root / "packages" / package / file).read_bytes() == archive.extractfile("package/" + file).read(), file
                matched.append(package + ":" + file)
            if package == "session-core":
                target = staging / "node_modules" / "@chainlesschain" / "session-core"
                for member in archive.getmembers():
                    parts = PurePosixPath(member.name).parts
                    assert parts[0] == "package" and ".." not in parts
                    if member.isfile():
                        dest = target.joinpath(*parts[1:])
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(archive.extractfile(member).read())
    smoke = staging / "smoke.cjs"
    smoke.write_text('''
const assert = require("node:assert/strict");
const name = "@chainlesschain/session-core/goal-draft-connection-contract";
const cjs = require(name);
assert.equal(cjs.CREATE_CONNECTION_SCHEMA, "chainlesschain.project-goal-connection/v6");
assert.equal(cjs.CREATE_ACCESS_SCHEMA, "chainlesschain.goal-create-draft-access/v1");
const access = { schema: cjs.CREATE_ACCESS_SCHEMA, plugin: { name: "creator", scope: "project", version: "1.0.0" }, declarationDigest: "sha256:" + "a".repeat(64) };
assert.deepEqual(cjs.validateGoalCreateDraftAccess(access), access);
assert.throws(() => cjs.validateGoalDraftAccess(access));
assert.equal(typeof require("@chainlesschain/session-core/project-goal-external-drafts").ProjectGoalExternalDrafts, "function");
(async () => {
  const esm = await import(name);
  assert.equal(esm.validateGoalCreateDraftProposal, cjs.validateGoalCreateDraftProposal);
  assert.equal(esm.validateGoalCreateDraftDescriptor, cjs.validateGoalCreateDraftDescriptor);
  console.log("Core public CJS/ESM creation exports verified");
})().catch(error => { console.error(error); process.exitCode = 1; });
''', encoding="utf-8")
    subprocess.run(["node", str(smoke)], cwd=str(staging), check=True)

result = {"state": "verified-local-artifacts", "matchedFiles": matched,
          "sha256": hashes, "corePublicCjsEsmExports": True,
          "fullIsolatedCliInstall": False, "published": False}
(evidence / "artifacts.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"matchedFiles": len(matched), "corePublicCjsEsmExports": True, "published": False}))
