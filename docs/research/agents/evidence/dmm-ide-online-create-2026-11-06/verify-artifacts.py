import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[5]
vsix, ide_zip = map(Path, sys.argv[1:3])
matched = []
with zipfile.ZipFile(vsix) as archive:
    for file in ["src/goal-drafts.js", "src/ui/plugin-manager-view.js", "src/chat/introspect-commands.js"]:
        assert (root / "packages/vscode-extension" / file).read_bytes() == archive.read("extension/" + file), file
        matched.append("vsix:" + file)
    # vsce rewrites relative links, so validate the new README section separately.
    readme = archive.read("extension/readme.md").decode("utf-8")
    assert "Online pending task creation (source-only)" in readme
    assert "Look up creation receipt" in readme

classes = root / "packages/jetbrains-plugin/build/classes/java/main"
with zipfile.ZipFile(ide_zip) as archive:
    own_jar = None
    for entry in archive.namelist():
        if entry.endswith(".jar"):
            candidate = zipfile.ZipFile(io.BytesIO(archive.read(entry)))
            if "com/chainlesschain/ide/GoalTaskCreateExport.class" in candidate.namelist():
                own_jar = candidate
                break
    assert own_jar is not None
    for prefix in ["com/chainlesschain/ide/PluginManager", "com/chainlesschain/ide/GoalTaskCreateExport", "com/chainlesschain/ide/intellij/PluginManagerAction"]:
        base = classes / prefix
        for source in [base.with_suffix(".class")] + sorted(base.parent.glob(base.name + "$*.class")):
            name = source.relative_to(classes).as_posix()
            assert source.read_bytes() == own_jar.read(name), name
            matched.append("jetbrains:" + name)

result = {"state": "verified-local-artifacts", "matchedFiles": matched,
          "sha256": {"vsix": hashlib.sha256(vsix.read_bytes()).hexdigest(), "jetbrainsZip": hashlib.sha256(ide_zip.read_bytes()).hexdigest()},
          "vsixReadmeOnlineCreationSection": True, "published": False, "versionsChanged": False}
(Path(__file__).parent / "artifacts.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"matchedFiles": len(matched), "published": False}))
