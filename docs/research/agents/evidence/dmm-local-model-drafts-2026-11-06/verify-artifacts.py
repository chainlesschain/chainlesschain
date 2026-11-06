import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parents[5]
archive_path = Path(sys.argv[1])
matched = []
with tempfile.TemporaryDirectory(prefix="dmm-goal-model-core-") as temp:
    staging = Path(temp)
    target = staging / "node_modules" / "@chainlesschain" / "session-core"
    with tarfile.open(str(archive_path), "r:gz") as archive:
        for file in ["lib/project-goal-memory.js", "lib/goal-usage-ledger.js", "lib/project-goal-extension-queue.js", "lib/goal-draft-connection-contract.js", "README.md", "package.json"]:
            assert (root / "packages/session-core" / file).read_bytes() == archive.extractfile("package/" + file).read(), file
            matched.append(file)
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts
            assert parts[0] == "package" and ".." not in parts
            if member.isfile():
                dest = target.joinpath(*parts[1:])
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(archive.extractfile(member).read())
    script = staging / "public.cjs"
    script.write_text('''
const assert = require("node:assert/strict");
const name = "@chainlesschain/session-core/project-goal-memory";
const cjs = require(name);
assert.equal(typeof cjs.ProjectGoalMemoryService.prototype.revalidateOutputInTransaction, "function");
assert.equal(typeof cjs.ProjectGoalMemoryService.prototype.revalidateOutput, "function");
(async () => {
  const esm = await import(name);
  assert.equal(esm.ProjectGoalMemoryService, cjs.ProjectGoalMemoryService);
  console.log("Core public CJS/ESM output guard verified");
})().catch(error => { console.error(error); process.exitCode = 1; });
''', encoding="utf-8")
    subprocess.run(["node", str(script)], cwd=str(staging), check=True)
result = {"state": "verified-local-core-package", "matchedFiles": matched,
          "sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
          "publicCjsEsmOutputGuard": True, "fullElectronPackageBuilt": False,
          "published": False, "versionsChanged": False}
(Path(__file__).parent / "artifacts.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"matchedFiles": len(matched), "publicCjsEsmOutputGuard": True}))
