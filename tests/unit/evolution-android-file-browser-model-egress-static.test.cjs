const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const sourceRoot = path.join(
  root,
  "android-app",
  "feature-file-browser",
  "src",
  "main",
  "java",
  "com",
  "chainlesschain",
  "android",
  "feature",
  "filebrowser",
  "ml",
);
const guard = "throw ModelEgressGovernanceException()";

function source(filename) {
  return fs.readFileSync(path.join(sourceRoot, filename), "utf8");
}

function assertGuardPrecedesWork(text, signature, firstWork, label) {
  const start = text.indexOf(signature);
  assert.notEqual(start, -1, `${label}: missing public entry point`);
  const body = text.indexOf("{", start);
  const guardAt = text.indexOf(guard, body);
  const workAt = text.indexOf(firstWork, body);
  assert.notEqual(guardAt, -1, `${label}: missing terminal ingress guard`);
  assert.notEqual(workAt, -1, `${label}: missing protected work marker`);
  assert.ok(
    guardAt < workAt,
    `${label}: guard must precede URI enumeration, content access, and ML Kit work`,
  );
}

test("Android file-browser ML Kit entry points fail closed before user content access", () => {
  const textRecognizer = source("TextRecognizer.kt");
  assert.match(
    textRecognizer,
    /import com\.chainlesschain\.android\.feature\.ai\.data\.llm\.ModelEgressGovernanceException/,
  );
  assertGuardPrecedesWork(
    textRecognizer,
    "suspend fun recognizeText(",
    "loadAndScaleImage(contentResolver, uri)",
    "TextRecognizer single image",
  );
  assertGuardPrecedesWork(
    textRecognizer,
    "suspend fun batchRecognize(",
    "uris.associate",
    "TextRecognizer batch",
  );

  const classifier = source("FileClassifier.kt");
  assert.match(
    classifier,
    /import com\.chainlesschain\.android\.feature\.ai\.data\.llm\.ModelEgressGovernanceException/,
  );
  assertGuardPrecedesWork(
    classifier,
    "suspend fun classifyFile(",
    "when (currentCategory)",
    "FileClassifier single file",
  );
  assertGuardPrecedesWork(
    classifier,
    "suspend fun batchClassify(",
    "files.associate",
    "FileClassifier batch",
  );
});
