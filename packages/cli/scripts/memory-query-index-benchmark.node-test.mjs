import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("./memory-query-index-benchmark.mjs", import.meta.url),
);
const root = path.resolve(path.dirname(script), "../../..");
for (const injectFailure of [false, true]) {
  test(`query measurement publishes completion only after cleanup (${injectFailure ? "failure" : "success"})`, () => {
    const temporaryRoot = fs.realpathSync.native(os.tmpdir());
    const directory = fs.mkdtempSync(
      path.join(temporaryRoot, "cc-query-completion-test-"),
    );
    try {
      const output = path.join(directory, "report.json");
      const program = `
        import fs from 'node:fs';
        import path from 'node:path';
        import { syncBuiltinESMExports } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const script = ${JSON.stringify(script)};
        process.argv = [process.execPath, script, '--counts', '1000', '--samples', '1', '--modes', 'hot', '--output', ${JSON.stringify(output)}];
        if (${injectFailure}) {
          const remove = fs.rmSync;
          fs.rmSync = function(target, options) {
            const result = remove.call(this, target, options);
            if (path.basename(String(target)).startsWith('cc-memory-query-benchmark-')) {
              throw new Error('injected final cleanup failure');
            }
            return result;
          };
          syncBuiltinESMExports();
        }
        await import(pathToFileURL(script).href);
      `;
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", program],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 60000,
          windowsHide: true,
        },
      );
      assert.equal(child.error, undefined);
      const report = JSON.parse(fs.readFileSync(output, "utf8"));
      assert.equal(report.tiers[0].groups.hot.complete, true);
      if (injectFailure) {
        assert.notEqual(child.status, 0);
        assert.match(child.stderr, /injected final cleanup failure/);
        assert.equal(
          report.complete,
          false,
          "failed cleanup must not publish overall completion",
        );
      } else {
        assert.equal(child.status, 0, child.stderr);
        assert.equal(report.complete, true);
      }
    } finally {
      assert.equal(path.dirname(directory), temporaryRoot);
      assert.ok(
        path.basename(directory).startsWith("cc-query-completion-test-"),
      );
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
