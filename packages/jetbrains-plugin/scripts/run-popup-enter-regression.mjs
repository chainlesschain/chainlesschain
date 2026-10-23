// Uses the host's existing robot-server Rhino JAR; no new build dependency.
// Example: node scripts/run-popup-enter-regression.mjs --rhino-jar <robot-server/lib/rhino-1.7.15.jar>
// Requires a GUI desktop (or xvfb-run on Linux). Test windows remain off screen.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "rhino-jar": { type: "string" },
    "java-home": { type: "string", default: process.env.JAVA_HOME },
    output: { type: "string" },
  },
});
if (!values["rhino-jar"])
  throw new Error("--rhino-jar must name the robot-server Rhino JAR");
const base = fileURLToPath(new URL("../", import.meta.url));
const output = values.output
  ? resolve(values.output)
  : mkdtempSync(join(tmpdir(), "cc-popup-enter-"));
mkdirSync(output, { recursive: true });
const rhino = resolve(values["rhino-jar"]);
const executable = (name) =>
  values["java-home"]
    ? join(
        values["java-home"],
        "bin",
        `${name}${process.platform === "win32" ? ".exe" : ""}`,
      )
    : name;
function run(name, args) {
  const result = spawnSync(executable(name), args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${name} failed: status=${result.status}, signal=${result.signal}`,
    );
}
run("javac", [
  "-encoding",
  "UTF-8",
  "-cp",
  rhino,
  "-d",
  output,
  join(
    base,
    "src/uiTest/java/com/chainlesschain/ide/uitest/PopupEnterScripts.java",
  ),
  join(
    base,
    "scripts/fixtures/popup-enter/com/intellij/openapi/application/ApplicationManager.java",
  ),
  join(
    base,
    "scripts/fixtures/popup-enter/com/intellij/ui/components/JBList.java",
  ),
  join(
    base,
    "scripts/fixtures/popup-enter/com/chainlesschain/ide/uitest/PopupEnterRegression.java",
  ),
]);
run("java", [
  "-cp",
  [output, rhino].join(delimiter),
  "com.chainlesschain.ide.uitest.PopupEnterRegression",
]);
