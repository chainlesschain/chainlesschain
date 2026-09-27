import { expect, it } from "vitest";
import { artifactPhysicalIdentity } from "../../src/lib/evolution/evolution-artifact-identity.js";

const stat = {
  dev: 2n,
  ino: 9007199254740993n,
  birthtimeMs: 100,
  ctimeMs: 100,
};
const wsl1 = { platform: "linux", kernelRelease: "4.4.0-19041-Microsoft" };
it("WSL1 ctime fallback can change without changing device/inode identity", () => {
  const identity = artifactPhysicalIdentity(stat, wsl1);
  expect(identity).toEqual({
    dev: "2",
    ino: "9007199254740993",
    birthtimeMs: null,
  });
  expect(
    artifactPhysicalIdentity({ ...stat, birthtimeMs: 200, ctimeMs: 200 }, wsl1),
  ).toEqual(identity);
  for (const changed of [{ dev: 3n }, { ino: 9007199254740994n }])
    expect(artifactPhysicalIdentity({ ...stat, ...changed }, wsl1)).not.toEqual(
      identity,
    );
});
it.each([
  { platform: "linux", kernelRelease: "6.6.87.2-microsoft-standard-WSL2" },
  { platform: "linux", kernelRelease: "6.8.0-71-generic" },
  { platform: "win32", kernelRelease: "10.0.26100" },
  { platform: "darwin", kernelRelease: "24.0.0" },
])(
  "retains birthtime outside the observed WSL1 fallback ($platform $kernelRelease)",
  (runtime) => {
    const identity = artifactPhysicalIdentity(stat, runtime);
    expect(identity.birthtimeMs).toBe(100);
    expect(
      artifactPhysicalIdentity(
        { ...stat, birthtimeMs: 200, ctimeMs: 200 },
        runtime,
      ),
    ).not.toEqual(identity);
  },
);
it("retains an independently reported creation time even on WSL1", () => {
  expect(
    artifactPhysicalIdentity({ ...stat, ctimeMs: 200 }, wsl1).birthtimeMs,
  ).toBe(100);
});
