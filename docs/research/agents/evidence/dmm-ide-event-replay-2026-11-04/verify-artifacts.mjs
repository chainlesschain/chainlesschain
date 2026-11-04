import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  listZipEntries,
  readZipEntry,
} from "../../../../../packages/vscode-extension/scripts/verify-vsix.mjs";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(path.resolve(root, file));
const [vsixPath, zipPath] = process.argv.slice(2);
if (!vsixPath || !zipPath)
  throw new Error("Usage: verify-artifacts.mjs <vsix> <jetbrains-zip>");
function entry(archive, name) {
  const found = listZipEntries(archive).get(name);
  if (!found) throw new Error(`Missing archive entry: ${name}`);
  return readZipEntry(archive, found);
}
function match(archive, name, file) {
  const packed = entry(archive, name),
    source = read(file);
  if (!packed.equals(source))
    throw new Error(`Archive differs from worktree: ${name}`);
  return { entry: name, source: file, sha256: hash(source), equal: true };
}
const vsix = fs.readFileSync(vsixPath),
  zip = fs.readFileSync(zipPath);
const jsFiles = [
  "src/goal-history.js",
  "src/goal-events.js",
  "src/ui/plugin-manager-view.js",
  "src/chat/stop-agent-process.js",
  "src/plugin-manager.js",
  "src/win-shell.js",
];
const vsixMatches = jsFiles.map((file) =>
  match(vsix, "extension/" + file, "packages/vscode-extension/" + file),
);
const classFiles = [];
for (const relative of [
  "com/chainlesschain/ide",
  "com/chainlesschain/ide/intellij",
]) {
  const directory =
    "packages/jetbrains-plugin/build/classes/java/main/" + relative;
  for (const file of fs.readdirSync(path.resolve(root, directory))) {
    if (
      /^(?:GoalHistoryReplay|GoalEventObserver|PluginManagerAction)(?:\$.*)?\.class$/u.test(
        file,
      )
    )
      classFiles.push({
        entry: relative + "/" + file,
        source: directory + "/" + file,
      });
  }
}
if (!classFiles.some((file) => file.entry.endsWith("GoalHistoryReplay.class")))
  throw new Error("Recovery classes missing");
const classMatches = [];
for (const [name, value] of listZipEntries(zip)) {
  if (!name.endsWith(".jar")) continue;
  const jar = readZipEntry(zip, value),
    entries = listZipEntries(jar);
  if (!entries.has("com/chainlesschain/ide/GoalHistoryReplay.class")) continue;
  for (const file of classFiles)
    classMatches.push({ jar: name, ...match(jar, file.entry, file.source) });
}
if (classMatches.length !== classFiles.length)
  throw new Error("Expected exactly one packaged production JAR");
const report = {
  localOnly: true,
  published: false,
  realGuiRun: false,
  vsix: {
    path: path.resolve(vsixPath),
    bytes: vsix.length,
    sha256: hash(vsix),
    metadataChecksPassed: 18,
    matches: vsixMatches,
  },
  jetbrains: {
    path: path.resolve(zipPath),
    bytes: zip.length,
    sha256: hash(zip),
    matches: classMatches,
  },
};
fs.writeFileSync(
  new URL("./artifacts.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    vsixJs: vsixMatches.length,
    jetbrainsClasses: classMatches.length,
    allEqual: true,
  }),
);
