import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLinuxSubreaper } from "../../scripts/build-linux-subreaper.mjs";

describe.skipIf(process.platform !== "linux")(
  "installed static Linux subreaper",
  () => {
    let root;
    let manifest;
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const sourceRoot = fileURLToPath(
      new URL("../../src/lib/process-execution-broker/", import.meta.url),
    );
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-subr-package-test-"));
      manifest = buildLinuxSubreaper({
        output: path.join(root, "build"),
        commit,
      });
    }, 40000);
    afterAll(() => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    function stage() {
      const directory = fs.mkdtempSync(path.join(root, "package-"));
      fs.writeFileSync(
        path.join(directory, "package.json"),
        '{"type":"module"}\n',
      );
      const modules = path.join(directory, "src/lib/process-execution-broker");
      fs.mkdirSync(modules, { recursive: true });
      for (const name of [
        "linux-subreaper-helper.js",
        "linux-subreaper-process.js",
        "linux-subreaper-artifact.js",
        "linux-subreaper-supervisor.c",
      ])
        fs.copyFileSync(path.join(sourceRoot, name), path.join(modules, name));
      const payload = path.join(directory, "src/assets/linux-subreaper");
      fs.cpSync(path.join(root, "build"), payload, { recursive: true });
      return {
        directory,
        payload: path.join(payload, `linux-${process.arch}`),
      };
    }

    it("runs the packaged detached-tree cleanup without invoking any compiler", ({
      task,
    }) => {
      const { directory } = stage();
      const smoke = fileURLToPath(
        new URL(
          "../../scripts/linux-subreaper-package-smoke.mjs",
          import.meta.url,
        ),
      );
      const result = spawnSync(
        process.execPath,
        [smoke, "--package-root", directory, "--commit", commit],
        { encoding: "utf8", timeout: 12000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const evidence = JSON.parse(result.stdout);
      expect(evidence.compilerCalls).toBe(0);
      expect(evidence.receipt.helper.distribution).toBe("packaged-static");
      expect(evidence.receipt.helper.imageDigest).toBe(manifest.imageDigest);
      expect(evidence.receipt.cleanup.confirmed).toBe(true);
      task.meta.packagedSubreaper = evidence;
    });

    it.each(["missing", "corrupt", "source", "manifest", "symlink"])(
      "fails closed for a %s packaged payload without trying a compiler",
      (kind) => {
        const { directory, payload } = stage();
        const image = path.join(payload, "supervisor");
        if (kind === "missing") fs.unlinkSync(image);
        if (kind === "corrupt") fs.appendFileSync(image, "changed");
        if (kind === "source")
          fs.appendFileSync(
            path.join(
              directory,
              "src/lib/process-execution-broker/linux-subreaper-supervisor.c",
            ),
            "changed",
          );
        if (kind === "manifest")
          fs.writeFileSync(path.join(payload, "manifest.json"), "{}");
        if (kind === "symlink") {
          fs.renameSync(image, image + ".real");
          fs.symlinkSync(image + ".real", image);
        }
        const probe = path.join(directory, "reject.mjs");
        fs.writeFileSync(
          probe,
          `
      import fs from 'node:fs';
      import {acquireLinuxSubreaperHelper} from './src/lib/process-execution-broker/linux-subreaper-helper.js';
      let calls=0;const before=fs.readdirSync('/proc/self/fd');let code=null;
      try{acquireLinuxSubreaperHelper({spawnSync(){calls++;throw new Error('forbidden')}})}catch(error){code=error.code}
      const after=fs.readdirSync('/proc/self/fd');console.log(JSON.stringify({code,calls,before,after}));
    `,
        );
        const result = spawnSync(process.execPath, [probe], {
          encoding: "utf8",
          timeout: 10000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        const evidence = JSON.parse(result.stdout);
        expect(evidence.code).toBe("EXTERNAL_AGENT_HELPER_UNAVAILABLE");
        expect(evidence.calls).toBe(0);
        expect(evidence.after).toEqual(evidence.before);
      },
    );

    it("executes the pinned image after the installed pathname is replaced", () => {
      const { directory, payload } = stage();
      const probe = path.join(directory, "replace.mjs");
      fs.writeFileSync(
        probe,
        `
      import fs from 'node:fs';import {spawn} from 'node:child_process';
      import {acquireLinuxSubreaperHelper} from './src/lib/process-execution-broker/linux-subreaper-helper.js';
      import {spawnLinuxSubreaperChild} from './src/lib/process-execution-broker/linux-subreaper-process.js';
      const helper=acquireLinuxSubreaperHelper({spawnSync(){throw new Error('forbidden')}});
      fs.writeFileSync(${JSON.stringify(path.join(payload, "supervisor"))},'replacement');
      const child=spawnLinuxSubreaperChild(process.execPath,['-e','process.exit(0)'],{helper,cwd:process.cwd(),env:{}},{spawn});
      child.on('error',()=>{});child.stdout.resume();child.stderr.resume();
      console.log(JSON.stringify(await child.ownedProcessTreeClosed));
    `,
      );
      const result = spawnSync(process.execPath, [probe], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const receipt = JSON.parse(result.stdout);
      expect(receipt.cleanup.confirmed).toBe(true);
      expect(receipt.target.code).toBe(0);
      expect(receipt.helper.imageDigest).toBe(manifest.imageDigest);
    });
  },
);
