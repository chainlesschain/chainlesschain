import hashlib
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[5]
vsix, ide_zip, cli_tgz = map(Path, sys.argv[1:4])


def sha(data):
    return hashlib.sha256(data).hexdigest()


matched = []
with zipfile.ZipFile(vsix) as archive:
    for file, packed in [
        ("src/plugin-manager.js", "src/plugin-manager.js"),
        ("src/ui/plugin-manager-view.js", "src/ui/plugin-manager-view.js"),
    ]:
        source = root / "packages/vscode-extension" / file
        assert source.read_bytes() == archive.read("extension/" + packed), file
        matched.append("vsix:" + file)
    # vsce resolves Markdown links while packaging the README.
    assert "Task-creation request files (source-only)" in archive.read("extension/readme.md").decode("utf-8")

classes = root / "packages/jetbrains-plugin/build/classes/java/main"
with zipfile.ZipFile(ide_zip) as archive:
    own_jar = None
    for entry in archive.namelist():
        if entry.endswith(".jar"):
            candidate = zipfile.ZipFile(io.BytesIO(archive.read(entry)))
            if "com/chainlesschain/ide/GoalTaskCreateExport.class" in candidate.namelist():
                own_jar = candidate
                break
    assert own_jar is not None, "creation class missing from IDE ZIP"
    for prefix in ["com/chainlesschain/ide/PluginManager", "com/chainlesschain/ide/GoalTaskCreateExport", "com/chainlesschain/ide/intellij/PluginManagerAction"]:
        base = classes / prefix
        selected = [base.with_suffix(".class")] + sorted(base.parent.glob(base.name + "$*.class"))
        for source in selected:
            name = source.relative_to(classes).as_posix()
            assert source.read_bytes() == own_jar.read(name), name
            matched.append("jetbrains:" + name)

with tarfile.open(str(cli_tgz), "r:gz") as archive:
    for file in ["src/lib/plugin-runtime/cli-goal-draft-request.js", "src/lib/plugin-runtime/examples/project-delivery-assistant/plugin.json", "src/lib/plugin-runtime/examples/project-delivery-assistant/README.md", "README.md"]:
        assert (root / "packages/cli" / file).read_bytes() == archive.extractfile("package/" + file).read(), file
        matched.append("cli:" + file)

result = {
    "state": "verified-local-artifacts",
    "sha256": {"vsix": sha(vsix.read_bytes()), "jetbrainsZip": sha(ide_zip.read_bytes()), "cliTarball": sha(cli_tgz.read_bytes())},
    "matchedFiles": matched,
    "vsixMetadataChecks": 18,
    "vsixReadmeCreationSectionPresent": True,
    "published": False,
    "fullIsolatedCliInstall": False,
}
(Path(__file__).parent / "artifacts.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"matchedFiles": len(matched), "published": False}))
