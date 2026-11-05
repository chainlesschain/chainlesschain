import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_EXCEPTION,
  REVIEW_EXCEPTIONS,
  allowsReviewException,
  verifyUploadAuthority,
} from "../verify-product-jetbrains-upload.mjs";

function fixture(exception = REVIEW_EXCEPTION) {
  return {
    productVersion: exception.productVersion,
    version: exception.version,
    cliVersion: exception.cliVersion,
    tagSha: exception.source,
    run: {
      id: exception.runId,
      repository: { full_name: exception.repository },
      path: ".github/workflows/ide-extensions.yml",
      event: "push",
      head_branch: exception.tag,
      head_sha: exception.source,
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
    },
    jobs: [
      {
        id: 123,
        run_id: exception.runId,
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
      f.productVersion = "v5.0.3.146";
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
