import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { linuxSubreaperTargetArchitectures } from "../../src/lib/packer/pkg-targets.js";

const require = createRequire(import.meta.url);
const { parseTargets } = require("@yao-pkg/pkg/lib-es5/config.js");
const targetSets = [
  ["host"],
  ["linux"],
  ["node22-linux"],
  ["linux-x64", "linux-arm64", "linux-x64"],
  ["node22-linux-x64", "node22-alpine-arm64", "linuxstatic-x64"],
  ["lin-x86_64", "latest-linux-arm64", "node22--linux--x64"],
  ["darwin-x64", "mac-arm64", "osx", "win32", "windows-ia32"],
  ["freebsd-x64", "node22"],
  ["node22-linux-win-x64", "node22-win-linux-arm64"],
  ["linux-x64-arm64", "linux-arm64-x64"],
];

describe("standalone helper target admission", () => {
  it("keeps the oracle pinned to the lockfile's pkg parser version", () => {
    expect(require("@yao-pkg/pkg/package.json").version).toBe("6.21.0");
  });

  it.each(
    [undefined, null, [], [""], [" "], ["--"], ["host", ""], [null]].map(
      (targets) => [targets],
    ),
  )("rejects an empty or malformed target specification %j", (targets) => {
    expect(() => linuxSubreaperTargetArchitectures(targets)).toThrow(
      /explicit nonempty pkg targets/,
    );
  });

  it.each(["linux", "alpine", "win32", "darwin"])(
    "uses the running ABI on %s for partial targets without host probes",
    (platform) => {
      for (const arch of ["x64", "arm64"]) {
        const expected = ["linux", "alpine"].includes(platform) ? [arch] : [];
        expect(
          linuxSubreaperTargetArchitectures(["host", "node22"], {
            platform,
            arch,
          }),
        ).toEqual(expected);
        expect(
          linuxSubreaperTargetArchitectures(["linux"], { platform, arch }),
        ).toEqual([arch]);
      }
    },
  );

  it("requires an explicit supported architecture on an ARM32 host", () => {
    expect(() =>
      linuxSubreaperTargetArchitectures(["host"], {
        platform: "linux",
        arch: "arm",
      }),
    ).toThrow(/Unsupported/);
    expect(
      linuxSubreaperTargetArchitectures(["linux-arm64"], {
        platform: "linux",
        arch: "arm",
      }),
    ).toEqual(["arm64"]);
  });

  it.each(targetSets.map((targets) => [targets]))(
    "matches installed pkg platform/architecture resolution for %j",
    (targets) => {
      const expected = [
        ...new Set(
          parseTargets(targets)
            .filter(({ platform }) =>
              ["linux", "alpine", "linuxstatic"].includes(platform),
            )
            .map(({ arch }) => arch),
        ),
      ];
      expect(linuxSubreaperTargetArchitectures(targets)).toEqual(expected);
    },
  );

  it.each(["x86", "ia32", "armv7", "ppc64", "s390x", "riscv64", "loong64"])(
    "rejects unsupported Linux helper architecture %s",
    (arch) => {
      expect(() =>
        linuxSubreaperTargetArchitectures([`linux-${arch}`]),
      ).toThrow(
        /Unsupported standalone Linux process supervision architecture/,
      );
    },
  );

  it("rejects unknown tokens instead of silently omitting helper assets", () => {
    expect(() => linuxSubreaperTargetArchitectures(["linux-mystery"])).toThrow(
      /Unknown token/,
    );
  });

  it("admits Linux host targets without any host-probe subprocess", () => {
    const moduleUrl = new URL(
      "../../src/lib/packer/pkg-targets.js",
      import.meta.url,
    );
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      childProcess.spawnSync = () => { throw new Error('unexpected host probe'); };
      syncBuiltinESMExports();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { linuxSubreaperTargetArchitectures } = await import(${JSON.stringify(moduleUrl.href)});
      console.log(JSON.stringify(linuxSubreaperTargetArchitectures(['host', 'linux-arm64'], {platform:'linux',arch:'x64'})));
    `,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(["x64", "arm64"]);
  });
});
