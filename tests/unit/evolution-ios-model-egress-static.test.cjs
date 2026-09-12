const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const ios = (...parts) =>
  path.join(root, "ios-app", "ChainlessChain", ...parts);
const guard = "throw LLMError.evolutionIngressRequired";
const auditedSources = new Set();

function source(...parts) {
  auditedSources.add(`ios-app/ChainlessChain/${parts.join("/")}`);
  return fs.readFileSync(ios(...parts), "utf8");
}

function assertGuardIsFirst(sourceText, signature, label, from = 0) {
  const start = sourceText.indexOf(signature, from);
  assert.notEqual(start, -1, `${label}: missing function signature`);
  const brace = sourceText.indexOf("{", start);
  assert.notEqual(brace, -1, `${label}: missing function body`);
  const following = sourceText.slice(brace + 1).trimStart();
  assert.ok(
    following.startsWith(guard),
    `${label}: Evolution ingress guard must be the first executable statement`,
  );
}

function assertTerminalToolGuard(sourceText, signature, label) {
  const start = sourceText.indexOf(signature);
  assert.notEqual(start, -1, `${label}: missing executor`);
  const brace = sourceText.indexOf("{", start);
  const bodyStart = sourceText.indexOf("\n", brace) + 1;
  assert.notEqual(bodyStart, 0, `${label}: missing executor body`);
  const following = sourceText.slice(bodyStart).trimStart();
  assert.ok(
    following.startsWith("return .failure(error: \"CC_AGENT_EVOLUTION_INGRESS_FAILED"),
    `${label}: must default-deny before building a request`,
  );
}

test("iOS LLM provider and embedding exits fail before transport", () => {
  for (const filename of ["OpenAIClient.swift", "OllamaClient.swift", "AnthropicClient.swift"]) {
    const text = source("Features", "AI", "Services", filename);
    assertGuardIsFirst(text, "func chat(", `${filename} chat`);
    assertGuardIsFirst(text, "func chatStream(", `${filename} chatStream`);
  }

  const manager = source("Features", "AI", "Services", "LLMManager.swift");
  assertGuardIsFirst(
    manager,
    "func generateEmbedding(_ text: String)",
    "LLMManager generic embedding",
  );
  assertGuardIsFirst(
    manager,
    "func generateOllamaEmbedding(",
    "LLMManager Ollama embedding",
  );

  const knowledgeEmbeddings = source(
    "Features",
    "Knowledge",
    "Services",
    "EmbeddingsService.swift",
  );
  assert.match(
    knowledgeEmbeddings,
    /catch LLMError\.evolutionIngressRequired \{\s*throw LLMError\.evolutionIngressRequired/s,
    "Knowledge EmbeddingsService must preserve the terminal ingress denial",
  );
  const smartPlanCache = source("Features", "AI", "Advanced", "SmartPlanCache.swift");
  assert.match(
    smartPlanCache,
    /catch LLMError\.evolutionIngressRequired \{\s*throw LLMError\.evolutionIngressRequired/s,
    "SmartPlanCache must preserve the terminal ingress denial",
  );

  const webEngine = source("Features", "AI", "Engines", "WebEngine.swift");
  assertGuardIsFirst(
    webEngine,
    "private func httpRequest(parameters: [String: Any])",
    "WebEngine generic HTTP egress",
  );

  const tts = source("Features", "Voice", "Services", "TTSClient.swift");
  assertGuardIsFirst(
    tts,
    "private func synthesizeWithOpenAI(_ request: TTSRequest)",
    "TTSClient OpenAI synthesis",
  );
  assertGuardIsFirst(
    tts,
    "private func synthesizeWithElevenLabs(_ request: TTSRequest)",
    "TTSClient ElevenLabs synthesis",
  );

  assertTerminalToolGuard(
    source("Features", "AI", "SkillToolSystem", "BuiltinTools.swift"),
    "private static let httpRequestExecutor: ToolExecutor =",
    "BuiltinTools generic HTTP egress",
  );
  const networkTools = source(
    "Features",
    "AI",
    "SkillToolSystem",
    "NetworkDatabaseTools.swift",
  );
  for (const [signature, label] of [
    ["private static let httpGetExecutor: ToolExecutor =", "HTTP GET"],
    ["private static let httpPostExecutor: ToolExecutor =", "HTTP POST"],
    ["private static let downloadFileExecutor: ToolExecutor =", "HTTP download"],
    ["private static let checkUrlExecutor: ToolExecutor =", "HTTP check"],
    ["private static let pingExecutor: ToolExecutor =", "HTTP ping"],
  ]) {
    assertTerminalToolGuard(networkTools, signature, `NetworkDatabaseTools ${label} egress`);
  }
});

test("iOS ImageGen exits fail before provider selection or URLSession", () => {
  const text = source("Features", "ImageGen", "Services", "ImageGenManager.swift");
  for (const [signature, label] of [
    ["func generate(_ request: ImageGenRequest) async throws -> ImageGenResult", "manager generate"],
    ["func generateVariations(_ variationRequest: ImageVariationRequest)", "manager variations"],
    ["func editImage(image: Data, mask: Data, prompt: String)", "manager edit"],
  ]) {
    assertGuardIsFirst(text, signature, label);
  }

  const providerGenerates = text.matchAll(
    /func generate\(_ request: ImageGenRequest\) async throws -> \[GeneratedImage\] \{/g,
  );
  const indices = [...providerGenerates].map((match) => match.index);
  assert.equal(indices.length, 3, "expected OpenAI, Stability, and Replicate provider exits");
  for (const [index, label] of indices.entries()) {
    const following = text.slice(text.indexOf("{", label) + 1).trimStart();
    assert.ok(following.startsWith(guard), `ImageGen provider ${index} must fail closed`);
  }
  assertGuardIsFirst(
    text,
    "func generateVariations(_ request: ImageVariationRequest)",
    "OpenAI variations",
    text.indexOf("class OpenAIImageClient"),
  );
});

test("iOS system Vision and Speech model exits fail before reading user media", () => {
  const engineAssertions = [
    ["AudioEngine.swift", ["speech_to_text", "text_to_speech", "transcribe_summarize"]],
    ["DocumentEngine.swift", ["parse_structure", "ocr", "summarize", "translate"]],
    ["ImageEngine.swift", ["ocr", "object_detection", "face_detection", "classify", "describe"]],
  ];
  for (const [filename, tasks] of engineAssertions) {
    const text = source("Features", "AI", "Engines", filename);
    const taskSet = tasks.map((task) => `\"${task}\"`).join(", ");
    assert.match(
      text,
      new RegExp(
        `public override func execute\\(task: String, parameters: \\[String: Any\\]\\) async throws -> Any \\{\\s*if \\[${taskSet}\\]\\.contains\\(task\\) \\{\\s*${guard}`,
      ),
      `${filename} must reject every system-model task before dispatch`,
    );
  }

  const visionTools = source("Features", "AI", "ExtendedTools", "VisionTools.swift");
  for (const [signature, label] of [
    ["func recognizeText(", "Vision OCR"],
    ["func classifyImage(imagePath: String)", "Vision classification"],
    ["func detectFaces(imagePath: String, detectLandmarks: Bool = false)", "Vision face detection"],
    ["func detectBarcodes(imagePath: String)", "Vision barcode detection"],
  ]) {
    assertGuardIsFirst(visionTools, signature, label);
  }

  const utilityTools = source("Features", "AI", "SkillToolSystem", "UtilityTools.swift");
  for (const [signature, label] of [
    ["private static let qrScanExecutor: ToolExecutor =", "QR scanner"],
    ["private static let barcodeScanExecutor: ToolExecutor =", "barcode scanner"],
  ]) {
    assertTerminalToolGuard(utilityTools, signature, `UtilityTools ${label}`);
  }

  for (const [filename, signature, label] of [
    ["VoiceManager.swift", "func startListening() async throws", "VoiceManager recognition"],
    ["RealtimeVoiceInput.swift", "func startListening() async throws", "RealtimeVoiceInput recognition"],
  ]) {
    assertGuardIsFirst(
      source("Features", "Voice", "Services", filename),
      signature,
      label,
    );
  }
});

test("iOS Computer Use preserves terminal denial instead of successful fallback", () => {
  const text = source("Features", "ComputerUse", "Services", "VisionAction.swift");
  assert.match(
    text,
    /catch LLMError\.evolutionIngressRequired \{[\s\S]*?throw LLMError\.evolutionIngressRequired\s*\} catch \{/,
  );
  assert.equal(
    [...text.matchAll(/= try await performLLMAnalysis\(/g)].length,
    2,
    "analyze and locateElement must propagate the denial before any success fallback",
  );
});

test("shipped iOS LLM sources remain linked to the actual app Sources phase", (t) => {
  const project = fs.readFileSync(
    path.join(root, "ios-app", "ChainlessChain.xcodeproj", "project.pbxproj"),
    "utf8",
  );
  const appTarget = project.match(
    /\b[A-F0-9]{24} \/\* ChainlessChain \*\/ = \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\t\t\};/,
  );
  assert.ok(appTarget, "missing ChainlessChain app target");
  const phaseId = appTarget[1].match(/\b([A-F0-9]{24}) \/\* Sources \*\//)?.[1];
  assert.ok(phaseId, "app target has no Sources phase");
  const phase = project.match(
    new RegExp(`${phaseId} /\\* Sources \\*/ = \\{\\s*isa = PBXSourcesBuildPhase;([\\s\\S]*?)\\n\\t\\t\\};`),
  )?.[1];
  assert.ok(phase, "missing referenced app Sources phase");
  for (const filename of [
    "OpenAIClient.swift",
    "OllamaClient.swift",
    "AnthropicClient.swift",
    "LLMManager.swift",
  ]) {
    const escapedName = filename.replaceAll(".", "\\.");
    const buildFile = project.match(
      new RegExp(`([A-F0-9]{24}) /\\* ${escapedName} in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ([A-F0-9]{24})`),
    );
    assert.ok(buildFile, `${filename} missing build file`);
    assert.ok(phase.includes(buildFile[1]), `${filename} must be linked in the app Sources phase`);
    assert.match(
      project,
      new RegExp(`${buildFile[2]} /\\* ${escapedName} \\*/ = \\{isa = PBXFileReference;[^\\n]*path = \\./ChainlessChain/Features/AI/Services/${escapedName};`),
      `${filename} must refer to the guarded production source, not a copy`,
    );
  }

  const sourceOnly = [...auditedSources].filter(
    (relativePath) => !phase.includes(`${path.basename(relativePath)} in Sources`),
  );
  t.diagnostic(`Guarded sources outside the app compile phase (source evidence only): ${sourceOnly.join(", ")}`);
});

test("iOS exact-commit workflow covers every audited source and executes real Swift guards", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ios-app-target-test.yml"), "utf8");
  for (const event of ["pull_request", "push"]) {
    const block = workflow.match(new RegExp(`^  ${event}:\\r?\\n([\\s\\S]*?)(?=^  [a-z_]+:)`, "m"))?.[1];
    assert.ok(block, `${event} trigger missing`);
    const patterns = [...block.matchAll(/^      - "([^"]+)"/gm)].map((match) => match[1]);
    for (const relativePath of [
      ...auditedSources,
      "ios-app/Tests/EvolutionModelEgressTests/EvolutionModelEgressTests.swift",
    ]) {
      assert.ok(
        patterns.some((pattern) => pattern === relativePath || (pattern.endsWith("/**") && relativePath.startsWith(pattern.slice(0, -2)))),
        `${event} must trigger for ${relativePath}`,
      );
    }
  }
  assert.ok(workflow.includes("CC_IOS_MODEL_EGRESS_TESTS_ONLY=1 swift test --filter EvolutionModelEgressTests"));
  assert.ok(workflow.includes("ios-app/build-model-egress-test.log"));
  assert.ok(workflow.includes("generic/platform=iOS Simulator"));
  const manifest = fs.readFileSync(path.join(root, "ios-app/Package.swift"), "utf8");
  assert.match(manifest, /name: "EvolutionModelEgress",\s*dependencies: \["CoreCommon"\],\s*path: "ChainlessChain\/Features\/AI\/Services",/);
  for (const filename of ["LLMManager.swift", "OpenAIClient.swift", "OllamaClient.swift", "AnthropicClient.swift"]) {
    assert.ok(manifest.includes(`"${filename}"`), `${filename} must be compiled in the behavioral test target`);
  }
});
