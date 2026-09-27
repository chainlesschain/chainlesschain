#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  LINUX_SUBREAPER_ARCHITECTURES,
  LINUX_SUBREAPER_SOURCE_DIGEST,
  subreaperDigest,
  validateLinuxSubreaperArtifact,
} from "../src/lib/process-execution-broker/linux-subreaper-artifact.js";

export function buildLinuxSubreaper({ output, commit }) {
  if (
    process.platform !== "linux" ||
    !LINUX_SUBREAPER_ARCHITECTURES.includes(process.arch)
  )
    throw new Error("Build requires native Linux x64 or ARM64");
  if (!output || !/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Output and exact source commit are required");
  const source = Buffer.from(
    fs
      .readFileSync(
        new URL(
          "../src/lib/process-execution-broker/linux-subreaper-supervisor.c",
          import.meta.url,
        ),
        "utf8",
      )
      .replace(/\r\n/g, "\n"),
  );
  if (subreaperDigest(source) !== LINUX_SUBREAPER_SOURCE_DIGEST)
    throw new Error("Subreaper source digest mismatch");
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-subreaper-static-build-"),
  );
  fs.chmodSync(temporaryRoot, 0o700);
  const directoryFd = fs.openSync(
    temporaryRoot,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    const build = spawnSync(
      "/usr/bin/cc",
      [
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O2",
        "-static",
        "-no-pie",
        "-fstack-protector-strong",
        "-D_FORTIFY_SOURCE=2",
        "-Wl,--build-id=none",
        "-x",
        "c",
        "-",
        "-o",
        "/proc/self/fd/3/supervisor",
      ],
      {
        cwd: temporaryRoot,
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C", SOURCE_DATE_EPOCH: "0" },
        shell: false,
        input: source,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe", directoryFd],
      },
    );
    if (build.error || build.status !== 0 || build.signal)
      throw new Error("Static subreaper build failed");
    const image = fs.readFileSync(path.join(temporaryRoot, "supervisor"));
    const manifest = {
      schema: "chainlesschain.linux-subreaper-artifact/v1",
      platform: "linux",
      arch: process.arch,
      sourceDigest: LINUX_SUBREAPER_SOURCE_DIGEST,
      imageDigest: subreaperDigest(image),
      bytes: image.length,
      linkage: "static",
      commit,
    };
    const encoded = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    validateLinuxSubreaperArtifact(encoded, image, {
      arch: process.arch,
      commit,
    });
    fs.mkdirSync(output, { recursive: true });
    const destination = path.join(output, `linux-${process.arch}`);
    // Never merge into a stale architecture directory from a previous build.
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "supervisor"), image, {
      flag: "wx",
      mode: 0o755,
    });
    fs.writeFileSync(path.join(destination, "manifest.json"), encoded, {
      flag: "wx",
      mode: 0o644,
    });
    return manifest;
  } finally {
    fs.closeSync(directoryFd);
    fs.rmSync(path.join(temporaryRoot, "supervisor"), { force: true });
    fs.rmdirSync(temporaryRoot);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [outFlag, output, commitFlag, commit, ...extra] =
      process.argv.slice(2);
    if (outFlag !== "--out" || commitFlag !== "--commit" || extra.length)
      throw new Error(
        "Usage: build-linux-subreaper.mjs --out <directory> --commit <sha>",
      );
    process.stdout.write(
      JSON.stringify(buildLinuxSubreaper({ output, commit })) + "\n",
    );
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
