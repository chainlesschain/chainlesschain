import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createWindowsNativeEvaluator,
  createWindowsNativeNullEvaluator,
} from "../src/lib/process-execution-broker/windows-native-evaluator.js";

test(
  "Null profile is a separate integrity-bound factory and leaves ordinary v1 unchanged",
  {
    skip: process.platform !== "win32" || process.arch !== "x64",
  },
  () => {
    const parent = fs.realpathSync.native(os.tmpdir());
    const sourceRoot = fs.mkdtempSync(
      path.join(parent, "cc-null-factory-test-"),
    );
    fs.writeFileSync(
      path.join(sourceRoot, "fixture.cjs"),
      "module.exports = 1;\n",
    );
    const options = {
      sourceRoot,
      files: ["fixture.cjs"],
      checkSource: "process.exitCode = 0;\n",
    };
    const stages = [];
    try {
      for (const factory of [
        createWindowsNativeEvaluator,
        createWindowsNativeNullEvaluator,
      ]) {
        const evaluator = factory(options);
        stages.push(evaluator);
        assert.equal(evaluator.manifest.version, 1);
        assert.equal(
          evaluator.manifest.experimentalNullDeviceProfile,
          factory === createWindowsNativeNullEvaluator
            ? "chainlesschain/windows-node-runtime-adapter@3"
            : undefined,
        );
        assert.equal(
          evaluator.manifestDigest,
          createHash("sha256")
            .update(JSON.stringify(evaluator.manifest))
            .digest("hex"),
        );
        assert.equal(evaluator.manifest.capsuleBinding, undefined);
        assert.equal(Object.isFrozen(evaluator.manifest), true);
      }
      for (const factory of [
        createWindowsNativeEvaluator,
        createWindowsNativeNullEvaluator,
      ]) {
        for (const key of [
          "experimentalNullDeviceProfile",
          "nullRead",
          "nullWrite",
          "inheritedHandles",
          "capabilities",
          "env",
        ]) {
          assert.throws(
            () => factory({ ...options, [key]: "caller supplied" }),
            /unknown factory option/,
          );
        }
      }
    } finally {
      for (const stage of stages) stage.dispose();
      assert.equal(path.dirname(fs.realpathSync.native(sourceRoot)), parent);
      assert.ok(path.basename(sourceRoot).startsWith("cc-null-factory-test-"));
      fs.rmSync(sourceRoot, { recursive: true });
    }
  },
);
