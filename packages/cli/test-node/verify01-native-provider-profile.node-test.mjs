import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeProviderProfile } from "../scripts/verify01-native-provider-profile.mjs";
import { nativeEnvironment } from "../scripts/verify01-native-task-campaign.mjs";

test("OpenAI selection binds the model, endpoint and key slot without changing the original provider", () => {
  const original = nativeProviderProfile();
  assert.equal(original.provider, "volcengine");
  assert.equal(original.keyEnvironment, "VOLCENGINE_API_KEY");
  const selected = nativeProviderProfile("openai");
  assert.equal(selected.provider, "openai");
  assert.equal(selected.model, "gpt-6.1-sol");
  assert.equal(selected.keyEnvironment, "OPENAI_API_KEY");
  assert.equal(selected.policy.endpoint, "https://api.openai.com/v1/responses");
  assert.equal(selected.policy.formalSample, false);
  assert.equal(selected.defaultThinkingPreserved, true);
  assert.equal(nativeProviderProfile().provider, "volcengine");
  assert.throws(
    () => nativeProviderProfile("custom"),
    /unsupported diagnostic provider/u,
  );
});

test("isolated OpenAI children receive only their broker capability in the correct provider slot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-openai-env-"));
  try {
    const home = path.join(root, "home");
    const profile = path.join(home, ".chainlesschain");
    fs.mkdirSync(profile, { recursive: true });
    const env = nativeEnvironment(
      root,
      home,
      profile,
      ["test/fixture.test.js"],
      "scoped-offline-capability",
      "openai",
    );
    assert.equal(env.OPENAI_API_KEY, "scoped-offline-capability");
    assert.equal(env.VOLCENGINE_API_KEY, undefined);
    assert.equal(env.CC_FORMAL_QUALITY_EVAL_PROVIDER, "openai");
    assert.equal(
      env.CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES,
      '["test/fixture.test.js"]',
    );
    assert.equal(env.CHAINLESSCHAIN_HOME, profile);
    assert.equal(env.CC_MAX_RETRIES, "0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
