import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createWindowsNativeEvaluator,
  createWindowsNativeCapsuleEvaluator,
} from "../src/lib/process-execution-broker/windows-native-evaluator.js";
import { evalDigest } from "../src/lib/eval/evidence.js";

for (const mutation of ["tampered-file", "unlisted-entry"]) {
  test(
    `native v2 rejects ${mutation} before creating its target`,
    { skip: process.platform !== "win32", timeout: 240000 },
    async () => {
      const sourceRoot = fs.mkdtempSync(
        path.join(fs.realpathSync.native(os.tmpdir()), "cc-capsule-negative-"),
      );
      const identity = fs.lstatSync(sourceRoot, { bigint: true });
      const bytes = Buffer.from("original bytes\n");
      fs.writeFileSync(path.join(sourceRoot, "source.txt"), bytes);
      const binding = {
        inventoryDigest: "sha256:" + "1".repeat(64),
        lockDigest: "sha256:" + "2".repeat(64),
        planDigest: "sha256:" + "3".repeat(64),
        projectCommit: "4".repeat(40),
        runtime: {
          platform: process.platform,
          architecture: process.arch,
          nodeVersion: process.version,
          modulesAbi: process.versions.modules,
          executableDigest: evalDigest(fs.readFileSync(process.execPath)),
        },
      };
      let evaluator;
      const entry = {
        kind: mutation,
        formalSample: false,
        fullReviewPackReady: false,
        registryContentVerified: false,
      };
      try {
        evaluator = createWindowsNativeCapsuleEvaluator({
          sourceRoot,
          snapshots: [
            {
              path: "source.txt",
              bytes: bytes.length,
              digest: evalDigest(bytes),
            },
          ],
          binding,
          checkSource: "console.log('TARGET_MUST_NOT_RUN')",
          wallTimeMs: 10000,
        });
        const target = path.join(
          evaluator.manifest.workspace,
          mutation === "tampered-file" ? "source.txt" : "unlisted.txt",
        );
        fs.writeFileSync(target, "tampered\n");
        entry.manifestDigest = `sha256:${evaluator.manifestDigest}`;
        const { result, receipt } = await evaluator.execute();
        entry.execution = {
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        };
        entry.settlement = receipt;
        assert.equal(result.status, 125, result.stderr);
        assert.match(
          result.stderr,
          mutation === "tampered-file"
            ? /Native evaluator file (?:digest|identity)/
            : /Native evaluator tree has an unlisted entry/,
        );
        assert.equal(receipt.targetPid, 0);
        assert.equal(receipt.cleanupConfirmed, true);
        assert.equal(receipt.executionFailed, true);
        assert.ok(!result.stdout.includes("TARGET_MUST_NOT_RUN"));
        evaluator.dispose();
        entry.passed = true;
      } catch (error) {
        entry.error = error.message;
        if (error.nativeEvaluator) entry.failure = error.nativeEvaluator;
        throw error;
      } finally {
        const output = process.env.CC_NATIVE_CAPSULE_TRANSPORT_EVIDENCE;
        if (output)
          fs.writeFileSync(
            output + "." + mutation + ".json",
            JSON.stringify(entry, null, 2) + "\n",
            { flag: "wx" },
          );
        const current = fs.lstatSync(sourceRoot, { bigint: true });
        assert.equal(current.ino, identity.ino);
        assert.equal(current.dev, identity.dev);
        fs.rmSync(sourceRoot, { recursive: true });
      }
    },
  );
}

test(
  "v2 really transports more than 64 files and 8 MiB while keeping v1 limits and native guards",
  { skip: process.platform !== "win32", timeout: 240000 },
  async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-capsule-live-source-"),
    );
    const sourceIdentity = fs.lstatSync(sourceRoot, { bigint: true });
    const snapshots = [];
    for (let index = 0; index < 80; index++) {
      const relative = `node_modules/@capsule/f${index}/index.txt`;
      const bytes = Buffer.alloc(128 * 1024, index);
      fs.mkdirSync(path.dirname(path.join(sourceRoot, relative)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(sourceRoot, relative), bytes);
      snapshots.push({
        path: relative,
        bytes: bytes.length,
        digest: evalDigest(bytes),
      });
    }
    const large = Buffer.alloc(2 * 1024 * 1024, 83);
    fs.writeFileSync(path.join(sourceRoot, "large.bin"), large);
    snapshots.push({
      path: "large.bin",
      bytes: large.length,
      digest: evalDigest(large),
    });
    const binding = {
      inventoryDigest: "sha256:" + "1".repeat(64),
      lockDigest: "sha256:" + "2".repeat(64),
      planDigest: "sha256:" + "3".repeat(64),
      projectCommit: "4".repeat(40),
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        modulesAbi: process.versions.modules,
        executableDigest: evalDigest(fs.readFileSync(process.execPath)),
      },
    };
    const defaults = {
      sourceRoot,
      snapshots,
      binding,
      checkSource: `
    const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
    const workspace=process.argv[2],scratch=process.argv[3];
    assert.equal(fs.readFileSync(path.join(workspace,'large.bin')).length,2097152);
    for(let i=0;i<80;i++)assert.equal(fs.readFileSync(path.join(workspace,'node_modules/@capsule/f'+i+'/index.txt'))[0],i);
    for(const file of [__filename,path.join(workspace,'large.bin')])assert.throws(()=>fs.writeFileSync(file,'tamper'));
    assert.throws(()=>fs.writeFileSync(path.join(workspace,'unlisted.txt'),'tamper'));
    fs.writeFileSync(path.join(scratch,'output.txt'),'allowed');
    console.log(JSON.stringify({pid:process.pid,appContainerSid:process.env.CC_WINDOWS_APPCONTAINER_SID,files:81,largeBytes:2097152,readOnly:true,scratchWritable:true}));
  `,
      wallTimeMs: 10000,
    };
    let evaluator;
    const entry = {
      schema: "chainlesschain.windows-native-capsule-transport-live/v1",
      startedAt: new Date().toISOString(),
      formalSample: false,
      providerAssessed: false,
      registryContentVerified: false,
      fullReviewPackReady: false,
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      nodeVersion: process.version,
      modulesAbi: process.versions.modules,
      sourceFiles: snapshots.length,
      sourceBytes: snapshots.reduce((sum, item) => sum + item.bytes, 0),
    };
    try {
      assert.throws(
        () =>
          createWindowsNativeEvaluator({
            sourceRoot,
            files: snapshots.map((item) => item.path),
            checkSource: defaults.checkSource,
          }),
        /1\.\.64/,
      );
      evaluator = createWindowsNativeCapsuleEvaluator(defaults);
      assert.equal(evaluator.manifest.version, 2);
      assert.ok(Object.isFrozen(evaluator.manifest.capsuleBinding.runtime));
      assert.throws(() => {
        evaluator.manifest.capsuleBinding.runtime.modulesAbi = "wrong";
      }, TypeError);
      binding.runtime.modulesAbi = "mutated caller";
      assert.equal(
        evaluator.manifest.capsuleBinding.runtime.modulesAbi,
        process.versions.modules,
      );
      entry.stage = evaluator.root;
      entry.manifest = evaluator.manifest;
      entry.manifestDigest = `sha256:${evaluator.manifestDigest}`;
      const { result, receipt } = await evaluator.execute();
      entry.execution = {
        status: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      entry.settlement = receipt;
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim());
      assert.equal(payload.pid, receipt.targetPid);
      assert.equal(payload.appContainerSid, receipt.appContainerSid);
      assert.equal(payload.files, 81);
      assert.equal(receipt.cleanupConfirmed, true);
      assert.equal(receipt.capabilityCount, 0);
      assert.equal(receipt.loopbackExemptionAbsent, true);
      await assert.rejects(evaluator.execute(), /already consumed/);
      entry.passed = true;
      evaluator.dispose();
    } catch (error) {
      entry.error = error.message;
      if (error.nativeEvaluator) entry.failure = error.nativeEvaluator;
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
      const output = process.env.CC_NATIVE_CAPSULE_TRANSPORT_EVIDENCE;
      if (output)
        fs.writeFileSync(output, JSON.stringify(entry, null, 2) + "\n", {
          flag: "wx",
        });
      const current = fs.lstatSync(sourceRoot, { bigint: true });
      assert.equal(current.ino, sourceIdentity.ino);
      assert.equal(current.dev, sourceIdentity.dev);
      fs.rmSync(sourceRoot, { recursive: true });
    }
  },
);
