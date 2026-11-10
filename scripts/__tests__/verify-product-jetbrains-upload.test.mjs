import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_EXCEPTION,
  REVIEW_EXCEPTIONS,
  allowsReviewException,
  verifyUploadAuthority,
  selectOfficialUploadRun,
  verifyUploadAttempts,
} from "../verify-product-jetbrains-upload.mjs";

function fixture(exception = REVIEW_EXCEPTION) {
  const source = exception.source || "b".repeat(40);
  const runId = exception.runId || 42699999999;
  return {
    productVersion: exception.productVersion,
    version: exception.version,
    cliVersion: exception.cliVersion,
    tagSha: source,
    ...(exception.sourceTag ? { npmTagSha: source } : {}),
    run: {
      id: runId,
      repository: { full_name: exception.repository },
      path: ".github/workflows/ide-extensions.yml",
      event: "push",
      head_branch: exception.tag,
      head_sha: source,
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
    },
    jobs: [
      {
        id: 123,
        run_id: runId,
        head_sha: source,
        run_attempt: 1,
        name: "JetBrains plugin (build + publish)",
        status: "completed",
        conclusion: "success",
        steps: [
          {
            name: "Publish to JetBrains Marketplace",
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    ],
  };
}

test("accepts the completed official immutable upload for the authorized pairing", () => {
  const result = verifyUploadAuthority(fixture());
  assert.equal(result.uploadVerified, true);
  assert.equal(result.source, REVIEW_EXCEPTION.source);
});

test("accepts product145 only with its own verified .195 upload", () => {
  const exception = REVIEW_EXCEPTIONS.find(
    (entry) => entry.productVersion === "v5.0.3.145",
  );
  const result = verifyUploadAuthority(fixture(exception));
  assert.equal(result.uploadVerified, true);
  assert.equal(result.runId, 41950791667);
  assert.equal(result.source, "b78cf0af8c8b0491189465773b148ac77c332222");
  const reused = fixture(exception);
  reused.run = fixture().run;
  assert.throws(() => verifyUploadAuthority(reused));
});

for (const [name, mutate] of [
  [
    "another product",
    (f) => {
      f.productVersion = "v5.0.3.147";
    },
  ],
  [
    "another IDE version",
    (f) => {
      f.version = "0.4.193";
    },
  ],
  [
    "another CLI pairing",
    (f) => {
      f.cliVersion = "0.166.140";
    },
  ],
  [
    "moved tag",
    (f) => {
      f.tagSha = "a".repeat(40);
    },
  ],
  [
    "wrong source",
    (f) => {
      f.run.head_sha = "a".repeat(40);
    },
  ],
  [
    "wrong repository",
    (f) => {
      f.run.repository.full_name = "other/repository";
    },
  ],
  [
    "different workflow",
    (f) => {
      f.run.path = ".github/workflows/release.yml";
    },
  ],
  [
    "manual build without tag publication",
    (f) => {
      f.run.event = "workflow_dispatch";
    },
  ],
  [
    "different release tag",
    (f) => {
      f.run.head_branch = "main";
    },
  ],
  [
    "failed release",
    (f) => {
      f.run.conclusion = "failure";
    },
  ],
  [
    "running release",
    (f) => {
      f.run.status = "in_progress";
    },
  ],
  [
    "missing upload job",
    (f) => {
      f.jobs = [];
    },
  ],
  [
    "job from another run",
    (f) => {
      f.jobs[0].run_id += 1;
    },
  ],
  [
    "failed upload job",
    (f) => {
      f.jobs[0].conclusion = "failure";
    },
  ],
  [
    "missing publish step",
    (f) => {
      f.jobs[0].steps = [];
    },
  ],
  [
    "skipped publish step",
    (f) => {
      f.jobs[0].steps[0].conclusion = "skipped";
    },
  ],
]) {
  for (const exception of REVIEW_EXCEPTIONS) {
    test(`${exception.productVersion} rejects ${name}`, () => {
      const f = fixture(exception);
      mutate(f);
      assert.throws(() => verifyUploadAuthority(f));
    });
  }
}

test("keeps all other product releases on the normal public verification path", () => {
  assert.equal(
    allowsReviewException("v5.0.3.145", "0.4.192", "0.166.139"),
    false,
  );
  assert.equal(
    allowsReviewException("v5.0.3.144", "0.4.193", "0.166.139"),
    false,
  );
});

const product146 = REVIEW_EXCEPTIONS.find(
  (entry) => entry.productVersion === "v5.0.3.146",
);
test("product146 binds its official upload to the immutable npm and IDE tag source", () => {
  const f = fixture(product146);
  assert.equal(selectOfficialUploadRun({ ...f, runs: [f.run] }).id, f.run.id);
  const result = verifyUploadAuthority(f);
  assert.equal(result.uploadVerified, true);
  assert.equal(result.tag, "ide-jetbrains-v0.4.199");
  for (const npmTagSha of [undefined, "a".repeat(40)]) {
    assert.throws(() =>
      selectOfficialUploadRun({ ...f, npmTagSha, runs: [f.run] }),
    );
    assert.throws(() => verifyUploadAuthority({ ...f, npmTagSha }));
  }
});

for (const [field, value] of [
  ["event", "pull_request"],
  ["event", "workflow_dispatch"],
  ["path", ".github/workflows/cli-ci.yml"],
  ["head_branch", "main"],
  ["head_sha", "a".repeat(40)],
  ["status", "in_progress"],
  ["conclusion", "failure"],
]) {
  test(`product146 cannot discover a run with ${field}=${value}`, () => {
    const f = fixture(product146);
    f.run[field] = value;
    assert.throws(() => selectOfficialUploadRun({ ...f, runs: [f.run] }));
  });
}
test("product146 refuses absent or ambiguous uploads and listing-only success", () => {
  const f = fixture(product146);
  for (const runs of [[], [f.run, { ...f.run, id: f.run.id + 1 }]])
    assert.throws(() => selectOfficialUploadRun({ ...f, runs }));
  f.jobs[0].name = "JetBrains Marketplace (post-publish verification)";
  assert.throws(() => verifyUploadAuthority(f));
});

test("product146 retains attempt1 upload proof after attempt2 reruns only the listing", async () => {
  const f = fixture(product146);
  f.run.run_attempt = 2;
  const requested = [];
  const result = await verifyUploadAttempts(f, async (attempt) => {
    requested.push(attempt);
    return attempt === 1
      ? f.jobs
      : [
          {
            name: "JetBrains Marketplace (post-publish verification)",
            status: "completed",
            conclusion: "success",
          },
        ];
  });
  assert.deepEqual(requested, [2, 1]);
  assert.equal(result.runId, f.run.id);
  assert.equal(result.runAttempt, 2);
  assert.equal(result.uploadAttempt, 1);
});

for (const [name, mutate] of [
  [
    "wrong run",
    (job) => {
      job.run_id++;
    },
  ],
  [
    "wrong source",
    (job) => {
      job.head_sha = "a".repeat(40);
    },
  ],
  [
    "wrong attempt",
    (job) => {
      job.run_attempt = 2;
    },
  ],
  [
    "failed upload",
    (job) => {
      job.conclusion = "failure";
    },
  ],
  [
    "skipped upload",
    (job) => {
      job.conclusion = "skipped";
    },
  ],
  [
    "failed publish",
    (job) => {
      job.steps[0].conclusion = "failure";
    },
  ],
  [
    "skipped publish",
    (job) => {
      job.steps[0].conclusion = "skipped";
    },
  ],
]) {
  test(`product146 rejects historical proof with ${name}`, async () => {
    const f = fixture(product146);
    f.run.run_attempt = 2;
    mutate(f.jobs[0]);
    await assert.rejects(
      verifyUploadAttempts(f, async (attempt) => (attempt === 1 ? f.jobs : [])),
    );
  });
}
test("product146 cannot stitch attempts or skip a later failed upload", async () => {
  const f = fixture(product146);
  f.run.run_attempt = 2;
  const later = structuredClone(f.jobs);
  later[0].run_attempt = 2;
  later[0].steps[0].conclusion = "skipped";
  const requested = [];
  await assert.rejects(
    verifyUploadAttempts(f, async (attempt) => {
      requested.push(attempt);
      return attempt === 2 ? later : f.jobs;
    }),
  );
  assert.deepEqual(requested, [2]);
  await assert.rejects(verifyUploadAttempts(f, async () => []));
});
test("historical product144 and145 remain restricted to the current pinned attempt", async () => {
  for (const exception of REVIEW_EXCEPTIONS.filter(
    (entry) => !entry.sourceTag,
  )) {
    const f = fixture(exception);
    f.run.run_attempt = 2;
    const requested = [];
    await assert.rejects(
      verifyUploadAttempts(f, async (attempt) => {
        requested.push(attempt);
        return [];
      }),
    );
    assert.deepEqual(requested, [2]);
  }
});
