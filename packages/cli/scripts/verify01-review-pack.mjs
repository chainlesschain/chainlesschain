#!/usr/bin/env node
/** Generate digest-bound, self-contained operator evaluators. Never runs a task,
 * calls a provider, signs a review, or marks a frozen sample as observed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import {
  validateVerify01Bundle,
  validateVerify01Review,
} from "../src/lib/eval/verify01-contracts.js";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";
import {
  assertNativeReviewReady,
  readNativeReviewBundle,
} from "./verify01-native-review-admission.mjs";

const defaultPlan = fileURLToPath(
  new URL(
    "../../../docs/research/cli/verify01-plan-2026-10-04/",
    import.meta.url,
  ),
);
const runtime = fs.readFileSync(
  new URL("./verify01-review-runtime.mjs", import.meta.url),
  "utf8",
);
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function generateReviewPack({
  outputDir,
  planDir = defaultPlan,
  imageId,
  backend = "linux-docker",
  nativeAdmission,
}) {
  if (!["linux-docker", "windows-native"].includes(backend))
    throw new Error(
      "unsupported review backend; explicit platform review is required",
    );
  if (backend === "windows-native") {
    if (imageId !== undefined)
      throw new Error(
        "Windows native review cannot accept a Docker image binding",
      );
    assertNativeReviewReady(readNativeReviewBundle(planDir), nativeAdmission);
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(imageId || ""))
    throw new Error(
      "--image-id must be an independently pinned Docker sha256 image ID",
    );
  const root = path.resolve(outputDir);
  if (fs.existsSync(root))
    throw new Error(
      "review output directory must be new; do not overwrite a locked review",
    );
  const bundle = {
    plan: json(path.join(planDir, "plan.json")),
    catalog: json(path.join(planDir, "tasks.json")),
    bindings: json(path.join(planDir, "comparison-bindings.json")),
    expectedPlanDigest: fs
      .readFileSync(path.join(planDir, "plan.sha256"), "utf8")
      .trim(),
  };
  validateVerify01Bundle(bundle);
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const testSupport = [
    [
      "globalSetup",
      "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
    ],
    ["setup", "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js"],
    ["setup", "packages/cli/test/setup/agent-evolution-test-boundary.js"],
  ].map(([kind, file]) => ({
    kind,
    path: file,
    digest: evalDigest(
      execFileSync(
        "git",
        ["-C", repository, "show", `${bundle.catalog.projectCommit}:${file}`],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
      ),
    ),
  }));
  const specs = new Map(
    VERIFY01_REVIEW_SPECS.map((spec) => [spec.taskId, spec]),
  );
  if (
    specs.size !== 36 ||
    VERIFY01_REVIEW_SPECS.length !== 36 ||
    bundle.catalog.tasks.some((task) => !specs.has(task.id))
  )
    throw new Error(
      "all 36 distinct reviewed task specifications are required",
    );
  const files = new Map();
  const review = {
    planDigest: bundle.expectedPlanDigest,
    catalogDigest: outcomeDigest(bundle.catalog),
    projectCommit: bundle.catalog.projectCommit,
    tasks: [],
  };
  for (const task of bundle.catalog.tasks) {
    const spec = {
      ...specs.get(task.id),
      expectedFiles: task.expectedFiles,
      imageId,
      testSupport,
      ...(specs.get(task.id).doc ? { frozenPlan: bundle.plan } : {}),
    };
    if (
      !Array.isArray(spec.baselineTests) ||
      (!spec.doc && (!spec.mutants?.length || !spec.sourcePath))
    )
      throw new Error(`${task.id} has an incomplete behavioral specification`);
    const entry = {
      taskId: task.id,
      allowedChangedPaths: [...task.expectedFiles, ...task.sourcePaths],
    };
    for (const stage of ["setup", "check"]) {
      const relative = `${task.id}-${stage}.mjs`;
      // No imports from this repository or a mutable review helper. Only Node
      // builtins are used by the runtime, inlined and pinned in each artifact.
      const script =
        `${runtime}\nconst spec = ${JSON.stringify(spec)};\n` +
        `const receipt = runReviewStage(process.argv[1], spec, ${JSON.stringify(stage)}, {deadline:process.argv[2] === undefined ? undefined : Number(process.argv[2])});\n` +
        `const evidenceDir = path.join(process.cwd(), "acceptance-evidence");\n` +
        `fs.mkdirSync(evidenceDir, {recursive:true, mode:0o700});\n` +
        `const evidenceName = spec.taskId + "-${stage}-" + randomUUID() + ".json";\n` +
        `const bytes = JSON.stringify(receipt, null, 2) + "\\n";\n` +
        `fs.writeFileSync(path.join(evidenceDir,evidenceName),bytes,{flag:"wx",mode:0o600});\n` +
        `console.log(JSON.stringify({pass:receipt.pass,detail:receipt.detail,receipt:evidenceName,receiptDigest:"sha256:"+hash(bytes)}));\n` +
        (stage === "setup" ? `if(!receipt.pass) process.exitCode=1;\n` : "");
      const bytes = Buffer.from(script);
      files.set(relative, bytes);
      entry[stage] = { path: relative, digest: evalDigest(bytes) };
    }
    review.tasks.push(entry);
  }
  const reviewDigest = outcomeDigest(review);
  validateVerify01Review(bundle, {
    review,
    expectedReviewDigest: reviewDigest,
    projectCommit: review.projectCommit,
    readReviewedFile: (file) => files.get(file),
  });
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const [file, bytes] of files)
    fs.writeFileSync(path.join(root, file), bytes, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(
    path.join(root, "review.json"),
    JSON.stringify(review, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  fs.writeFileSync(path.join(root, "review.sha256"), reviewDigest + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const metadata = {
    scope: "verify01-operator-review-pack",
    tasks: 36,
    generatedArtifacts: files.size,
    reviewDigest,
    runtimeDigest: evalDigest(Buffer.from(runtime)),
    specsDigest: outcomeDigest(VERIFY01_REVIEW_SPECS),
    planDigest: review.planDigest,
    executionStatus: "NOT_RUN",
    independentHumanReview: false,
    productionAttested: false,
    supportedAcceptancePlatform: "linux",
    acceptanceBackend: "docker",
    providerAssessed: false,
    acceptanceImageId: imageId,
    trust:
      "AI-reviewed operator configuration; pin the digest independently before execution",
  };
  fs.writeFileSync(
    path.join(root, "pack.json"),
    JSON.stringify(metadata, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return { ...metadata, outputDir: root };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "output-dir": { type: "string" },
        "plan-dir": { type: "string" },
        "image-id": { type: "string" },
        backend: { type: "string", default: "linux-docker" },
        capabilities: { type: "string" },
        "capabilities-digest": { type: "string" },
        pool: { type: "string", default: "forks" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Generate all 36 self-contained operator evaluators; no task/model execution.\n--backend linux-docker --output-dir NEW_EXTERNAL_DIR --image-id sha256:IMAGE_ID [--plan-dir DIR]\nWindows native admission: --backend windows-native [--capabilities FILE --capabilities-digest sha256:BYTES --pool forks|threads]; incomplete prerequisites reject before generating scripts. Generation is not independent human approval.",
      );
    else {
      if (values.backend === "linux-docker" && !values["output-dir"])
        throw new Error("--output-dir is required");
      console.log(
        JSON.stringify(
          generateReviewPack({
            outputDir: values["output-dir"],
            planDir: values["plan-dir"],
            imageId: values["image-id"],
            backend: values.backend,
            nativeAdmission: {
              pool: values.pool,
              capabilityBytes: values.capabilities
                ? fs.readFileSync(values.capabilities)
                : undefined,
              capabilityDigest: values["capabilities-digest"],
            },
          }),
          null,
          2,
        ),
      );
    }
  } catch (error) {
    if (error.code === "VERIFY01_NATIVE_REVIEW_NOT_READY")
      console.log(JSON.stringify(error.admission, null, 2));
    console.error(`VERIFY-01 review pack rejected: ${error.message}`);
    process.exitCode =
      error.code === "VERIFY01_NATIVE_REVIEW_NOT_READY" ? 2 : 1;
  }
}
