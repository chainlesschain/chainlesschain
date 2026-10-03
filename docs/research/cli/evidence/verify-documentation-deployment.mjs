// Offline, read-only receipt verification. Never executes receipt commands or URLs.
// Usage: node docs/research/cli/evidence/verify-documentation-deployment.mjs
//   --receipt docs/research/cli/evidence/documentation-deployment-2026-10-03-4d22.json
//   [--cache .work/gap-validation/deployed-STAMP] [--self-test]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const SITES = {
  docs: "docs-site/docs/.vitepress/dist",
  design: "docs-site-design/docs/.vitepress/dist",
  www: "docs-website-v2/dist",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const own = (object, key) => Object.hasOwn(object, key);

function relativePath(value) {
  assert.equal(typeof value, "string", "Path must be a string");
  assert(
    value.length > 0 && !/[\\:\x00-\x1f\x7f?#]/.test(value),
    "Unsafe path",
  );
  assert(!path.posix.isAbsolute(value), "Absolute path rejected");
  assert(
    value.split("/").every((part) => part && part !== "." && part !== ".."),
    "Path traversal rejected",
  );
  return value;
}

function contained(root, relative) {
  relativePath(relative);
  const actualRoot = fs.realpathSync(root);
  const actual = fs.realpathSync(path.join(actualRoot, relative));
  const remainder = path.relative(actualRoot, actual);
  assert(
    remainder &&
      !path.isAbsolute(remainder) &&
      remainder !== ".." &&
      !remainder.startsWith(`..${path.sep}`),
    "Path escapes root",
  );
  return actual;
}

function read(root, relative) {
  const file = contained(root, relative);
  assert(fs.statSync(file).isFile(), "Expected a regular file");
  return fs.readFileSync(file);
}

function digestRecord(record) {
  assert(record && typeof record === "object", "Missing digest record");
  relativePath(record.path);
  assert(
    Number.isSafeInteger(record.bytes) && record.bytes >= 0,
    "Invalid byte count",
  );
  assert.match(record.sha256, /^[a-f0-9]{64}$/, "Invalid SHA-256");
}

function matchBytes(bytes, record, label) {
  assert.equal(bytes.length, record.bytes, `${label}: byte count differs`);
  assert.equal(sha256(bytes), record.sha256, `${label}: SHA-256 differs`);
}

function validate(receipt) {
  assert.equal(receipt.schema, "chainlesschain.documentation-deployment/v1");
  assert.equal(receipt.status, "verified");
  assert.match(receipt.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(receipt.stamp, /^[A-Za-z0-9][A-Za-z0-9-]{0,119}$/);
  assert(
    Number.isFinite(Date.parse(receipt.checkedAt)),
    "Invalid observation date",
  );
  assert.deepEqual(
    Object.keys(receipt.builds).sort(),
    Object.keys(SITES).sort(),
  );
  for (const [site, build] of Object.entries(receipt.builds)) {
    assert.equal(build.status, "success");
    assert.equal(
      build.sourceCommit,
      receipt.sourceCommit,
      `${site}: build commit differs`,
    );
    assert.equal(build.command, "npm run build");
    assert(Number.isSafeInteger(build.htmlPages) && build.htmlPages > 0);
    assert(Number.isFinite(build.seconds) && build.seconds > 0);
    digestRecord(build.buildLog);
    assert(
      build.buildLog.path.startsWith(".work/gap-validation/"),
      "Build log outside evidence directory",
    );
  }
  assert(
    Array.isArray(receipt.sourceInputs) &&
      receipt.sourceInputs.length > 0 &&
      receipt.sourceInputs.length <= 1000,
  );
  assert(
    Array.isArray(receipt.checks) &&
      receipt.checks.length > 0 &&
      receipt.checks.length <= 10000,
  );
  const inputs = new Set();
  for (const input of receipt.sourceInputs) {
    digestRecord(input);
    assert(!inputs.has(input.path), "Duplicate source input");
    inputs.add(input.path);
  }
  const checks = new Set();
  const sites = new Set();
  for (const check of receipt.checks) {
    digestRecord(check);
    assert(own(SITES, check.site), "Unknown site");
    assert(/\.(?:html|js)$/.test(check.path), "Unexpected public file type");
    const key = `${check.site}/${check.path}`;
    assert(!checks.has(key), "Duplicate public check");
    checks.add(key);
    sites.add(check.site);
    assert.equal(check.httpStatus, 200);
    assert.equal(check.matchesLocalBuild, true);
    const url = new URL(check.url);
    assert.equal(url.origin, `https://${check.site}.chainlesschain.com`);
    assert.equal(url.username + url.password + url.hash, "");
    assert.equal(decodeURIComponent(url.pathname), `/${check.path}`);
    assert.deepEqual([...url.searchParams], [["audit", receipt.stamp]]);
  }
  assert.deepEqual(
    [...sites].sort(),
    Object.keys(SITES).sort(),
    "Missing site checks",
  );
}

function countHtml(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Symlink in local build tree");
    if (entry.isDirectory())
      count += countHtml(path.join(directory, entry.name));
    else if (entry.isFile() && entry.name.endsWith(".html")) count++;
  }
  return count;
}

export function verifyReceipt(receipt, cacheRelative) {
  validate(receipt);
  const cachePath =
    cacheRelative ?? `.work/gap-validation/deployed-${receipt.stamp}`;
  relativePath(cachePath);
  assert(
    cachePath.startsWith(".work/gap-validation/"),
    "Cache outside evidence directory",
  );
  const cache = contained(ROOT, cachePath);
  const git = (args) =>
    execFileSync("git", ["-C", ROOT, ...args], {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  assert.equal(
    git(["rev-parse", "--verify", `${receipt.sourceCommit}^{commit}`])
      .toString("utf8")
      .trim(),
    receipt.sourceCommit,
  );
  for (const input of receipt.sourceInputs) {
    // Read exact Git bytes; do not decode/re-encode Unicode or normalize CRLF.
    matchBytes(
      git(["cat-file", "blob", `${receipt.sourceCommit}:${input.path}`]),
      input,
      `Git input ${input.path}`,
    );
  }
  const htmlPages = {};
  for (const [site, build] of Object.entries(receipt.builds)) {
    const bytes = read(ROOT, build.buildLog.path);
    matchBytes(bytes, build.buildLog, `${site} build log`);
    const text =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? bytes.toString("utf16le")
        : bytes.toString("utf8");
    const footer =
      site === "www"
        ? text.match(/(\d+) page\(s\) built in ([\d.]+)s/)
        : text.match(/build complete in ([\d.]+)s/);
    assert(footer, `${site}: missing successful build footer`);
    assert.equal(
      Number(footer[site === "www" ? 2 : 1]),
      build.seconds,
      `${site}: duration differs`,
    );
    if (site === "www") assert.equal(Number(footer[1]), build.htmlPages);
    htmlPages[site] = countHtml(contained(ROOT, SITES[site]));
    assert.equal(
      htmlPages[site],
      build.htmlPages,
      `${site}: page count differs`,
    );
  }
  for (const [index, check] of receipt.checks.entries()) {
    const cached = read(cache, `${index + 1}.bin`);
    const built = read(contained(ROOT, SITES[check.site]), check.path);
    matchBytes(cached, check, `Cached check ${index + 1}`);
    matchBytes(built, check, `Local check ${index + 1}`);
    assert(
      cached.equals(built),
      `Check ${index + 1}: cache/build bytes differ`,
    );
  }
  return {
    status: "offline-verified",
    sourceCommit: receipt.sourceCommit,
    sourceInputs: receipt.sourceInputs.length,
    cachedChecks: receipt.checks.length,
    buildLogs: Object.keys(SITES).length,
    htmlPages,
    releaseAuthority: false,
    limitations: [
      "Local cached bytes are verified; HTTP status, retrieval time, origin and current availability are not independently authenticated offline.",
      "Only listed source inputs and public files are bound; this is not a complete build dependency inventory or a reproducible-build attestation.",
      "Build log bytes, completion footers and local page counts are checked; deployment operations, backups, structure-check claims and release-state metadata are not independently verified.",
      "Documentation deployment supplies no npm or IDE publication authority.",
    ],
  };
}

function selfTest(receipt) {
  const cases = [
    (r) => {
      r.schema = "unknown";
    },
    (r) => {
      r.sourceCommit = "HEAD";
    },
    (r) => {
      r.stamp = "../escape";
    },
    (r) => {
      r.sourceInputs[0].path = "../README.md";
    },
    (r) => {
      r.sourceInputs[0].path = "C:/README.md";
    },
    (r) => {
      r.sourceInputs.push(r.sourceInputs[0]);
    },
    (r) => {
      r.sourceInputs[0].sha256 = "bad";
    },
    (r) => {
      r.sourceInputs[0].bytes = -1;
    },
    (r) => {
      delete r.builds.docs.buildLog;
    },
    (r) => {
      r.builds.docs.sourceCommit = "0".repeat(40);
    },
    (r) => {
      r.checks[0].site = "constructor";
    },
    (r) => {
      r.checks.push(r.checks[0]);
    },
    (r) => {
      r.checks[0].url = r.checks[0].url.replace("https:", "http:");
    },
    (r) => {
      r.checks[0].url += "&audit=other";
    },
    (r) => {
      r.checks[0].httpStatus = 404;
    },
    (r) => {
      r.checks[0].matchesLocalBuild = false;
    },
    (r) => {
      r.checks[0].path = "../escape.html";
    },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(() => validate(copy), "Invalid receipt accepted");
  }
  const bytes = Buffer.from("original");
  const record = { bytes: bytes.length, sha256: sha256(bytes) };
  assert.throws(() => matchBytes(Buffer.from("tampered"), record, "test"));
  assert.throws(() => matchBytes(Buffer.from("short"), record, "test"));
  return cases.length + 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      assert(
        ["--receipt", "--cache", "--self-test"].includes(key) &&
          !own(options, key),
        "Unknown or repeated option",
      );
      if (key === "--self-test") options[key] = true;
      else {
        const value = process.argv[++i];
        assert(value && !value.startsWith("--"), "Missing option value");
        options[key] = value;
      }
    }
    assert(
      options["--receipt"],
      "Required: --receipt repository-relative-path",
    );
    const receiptBytes = read(ROOT, options["--receipt"]);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    const result = verifyReceipt(receipt, options["--cache"]);
    if (options["--self-test"]) result.negativeChecks = selfTest(receipt);
    result.receiptSha256 = sha256(receiptBytes);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      `Documentation receipt verification failed: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
