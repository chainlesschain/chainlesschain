"use strict";

// CI-only recovery for the observed Ubuntu repository DNS outage. Package
// sources, archive signatures and HTTPS certificate validation stay unchanged.
// https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
const assert = require("node:assert/strict");
const { lookup } = require("node:dns/promises");
const fs = require("node:fs");
const { isIPv4 } = require("node:net");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

async function curlDohFetch(url, options, execute = promisify(execFile)) {
  assert.equal(url.origin, "https://cloudflare-dns.com");
  assert.equal(url.pathname, "/dns-query");
  assert.ok(APT_HOSTS.includes(url.searchParams.get("name")));
  assert.equal(url.searchParams.get("type"), "A");
  assert.equal(url.searchParams.get("cd"), "false");
  assert.equal(url.username + url.password + url.hash, "");
  let stdout;
  try {
    ({ stdout } = await execute(
      "curl",
      [
        "--proto",
        "=https",
        "--fail",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "4",
        "--max-time",
        "8",
        "--max-filesize",
        "65536",
        // Bootstrap the documented resolver without requiring that broken DNS
        // first resolve its name. TLS still authenticates cloudflare-dns.com.
        // https://developers.cloudflare.com/1.1.1.1/ip-addresses/
        "--resolve",
        "cloudflare-dns.com:443:1.1.1.1",
        "--header",
        "accept: application/dns-json",
        "--write-out",
        "\n%{content_type}\n%{http_code}",
        url.href,
      ],
      {
        encoding: "utf8",
        maxBuffer: 66048,
        timeout: 9000,
        windowsHide: true,
        signal: options.signal,
      },
    ));
  } catch (error) {
    const code =
      Number.isInteger(error.code) && error.code >= 0 && error.code <= 255
        ? error.code
        : [
              "ENOENT",
              "ABORT_ERR",
              "ETIMEDOUT",
              "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            ].includes(error.code)
          ? error.code
          : "unknown";
    throw new Error(`Ubuntu HTTPS DNS transport failed (${code})`);
  }
  const last = stdout.lastIndexOf("\n");
  const previous = stdout.lastIndexOf("\n", last - 1);
  assert.ok(
    previous >= 0 && stdout.slice(last + 1) === "200",
    "Ubuntu HTTPS DNS transport did not return HTTP 200",
  );
  const body = stdout.slice(0, previous);
  assert.ok(
    Buffer.byteLength(body) <= 65536,
    "Ubuntu HTTPS DNS transport exceeds 64 KiB",
  );
  return new Response(body, {
    headers: { "content-type": stdout.slice(previous + 1, last) },
  });
}

const APT_HOSTS = Object.freeze([
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "azure.archive.ubuntu.com",
  // Canonical's ARM64/other-ports archive; x64's main archive is separate.
  "ports.ubuntu.com",
]);
const MARKER = "# chainlesschain CI Ubuntu apt DNS";

function assertPublicAddress(address) {
  assert.ok(isIPv4(address), "Ubuntu DNS answer must be an IPv4 address");
  const [a, b, c] = address.split(".").map(Number);
  assert.ok(
    !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    ),
    "Ubuntu DNS answer must be a public unicast address",
  );
  return address;
}

function dnsName(name) {
  assert.equal(typeof name, "string");
  const value = name.toLowerCase().replace(/\.$/u, "");
  assert.ok(
    value.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/u.test(
        value,
      ),
    "Invalid DNS owner",
  );
  return value;
}

function parseDohAnswer(hostname, answer) {
  assert.ok(APT_HOSTS.includes(hostname), "Unexpected Ubuntu repository host");
  assert.equal(answer.Status, 0, "Ubuntu DoH lookup did not succeed");
  assert.equal(answer.TC, false, "Truncated Ubuntu DoH answer");
  assert.equal(answer.CD, false, "Ubuntu DNS validation must remain enabled");
  assert.deepEqual(
    answer.Question?.map((q) => ({ name: dnsName(q.name), type: q.type })),
    [{ name: hostname, type: 1 }],
    "Ubuntu DoH question mismatch",
  );
  assert.ok(
    Array.isArray(answer.Answer) && answer.Answer.length <= 64,
    "Missing or oversized Ubuntu DoH answer",
  );
  const owners = new Set([hostname]);
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const row of answer.Answer) {
      if (row.type === 5 && owners.has(dnsName(row.name))) {
        const target = dnsName(row.data);
        if (!owners.has(target)) {
          owners.add(target);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const addresses = [
    ...new Set(
      answer.Answer.filter(
        (row) => row.type === 1 && owners.has(dnsName(row.name)),
      ).map((row) => {
        assert.ok(
          Number.isInteger(row.TTL) && row.TTL > 0,
          "Expired Ubuntu DoH answer",
        );
        return assertPublicAddress(row.data);
      }),
    ),
  ];
  assert.ok(
    addresses.length > 0 && addresses.length <= 32,
    "No bounded Ubuntu IPv4 answer",
  );
  return addresses;
}

async function readDohAnswer(hostname, fetchImpl = curlDohFetch) {
  assert.ok(APT_HOSTS.includes(hostname), "Unexpected Ubuntu repository host");
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", "A");
  url.searchParams.set("cd", "false");
  const response = await fetchImpl(url, {
    headers: { accept: "application/dns-json" },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.ok, true, "Ubuntu DoH HTTPS request failed");
  assert.match(
    response.headers.get("content-type") || "",
    /^application\/(?:dns-)?json\b/iu,
    "Unexpected Ubuntu DoH response type",
  );
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      assert.ok(length <= 65536, "Ubuntu DoH response exceeds 64 KiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseDohAnswer(
    hostname,
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
}

async function boundedLookup(hostname, lookupImpl) {
  let timer;
  try {
    return await Promise.race([
      lookupImpl(hostname, { family: 4, all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error("Ubuntu OS DNS deadline"), {
                code: "ETIMEOUT",
              }),
            ),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveUbuntuAptHosts({
  lookupImpl = lookup,
  fetchImpl = curlDohFetch,
} = {}) {
  return Promise.all(
    APT_HOSTS.map(async (hostname) => {
      let rows;
      try {
        rows = await boundedLookup(hostname, lookupImpl);
      } catch (error) {
        if (
          !["EAI_AGAIN", "ENOTFOUND", "EAI_FAIL", "ETIMEOUT"].includes(
            error.code,
          )
        )
          throw error;
        return {
          hostname,
          source: "doh",
          addresses: await readDohAnswer(hostname, fetchImpl),
        };
      }
      assert.ok(
        Array.isArray(rows) && rows.length > 0 && rows.length <= 32,
        "Invalid Ubuntu OS DNS answer",
      );
      return {
        hostname,
        source: "system",
        addresses: [
          ...new Set(rows.map((row) => assertPublicAddress(row.address))),
        ],
      };
    }),
  );
}

function validateRecords(records) {
  assert.deepEqual(
    records.map((row) => row.hostname).sort(),
    [...APT_HOSTS].sort(),
    "Exactly the fixed Ubuntu repository hosts are required",
  );
  for (const row of records) {
    assert.ok(["system", "doh"].includes(row.source));
    assert.ok(
      Array.isArray(row.addresses) &&
        row.addresses.length > 0 &&
        row.addresses.length <= 32,
    );
    row.addresses.forEach(assertPublicAddress);
  }
}

function ubuntuAptDockerArgs(records) {
  validateRecords(records);
  return records.flatMap((row) =>
    row.addresses.flatMap((address) => [
      "--add-host",
      `${row.hostname}:${address}`,
    ]),
  );
}

function assertCiRoot({
  platform = process.platform,
  env = process.env,
  uid = process.getuid?.(),
} = {}) {
  assert.equal(platform, "linux", "Ubuntu DNS changes are CI Linux only");
  assert.equal(
    env.GITHUB_ACTIONS,
    "true",
    "Ubuntu DNS changes require GitHub Actions",
  );
  assert.equal(env.RUNNER_OS, "Linux");
  assert.equal(uid, 0, "Ubuntu DNS changes require the CI root step");
}

async function applyUbuntuAptDnsFromStdin({
  input = process.stdin,
  ...options
} = {}) {
  assertCiRoot(options);
  const chunks = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    assert.ok(length <= 65536, "Ubuntu DNS handoff exceeds 64 KiB");
    chunks.push(bytes);
  }
  const records = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const changed = applyUbuntuAptDns(records, options);
  return { ubuntuAptDns: records, hostsFileChanged: changed };
}

function applyUbuntuAptDns(
  records,
  {
    readFile = fs.readFileSync,
    appendFile = fs.appendFileSync,
    ...options
  } = {},
) {
  assertCiRoot(options);
  validateRecords(records);
  const fallback = records.filter((row) => row.source === "doh");
  if (fallback.length === 0) return false;
  const block = `\n${MARKER}\n${fallback.flatMap((row) => row.addresses.map((address) => `${address} ${row.hostname}`)).join("\n")}\n`;
  const original = readFile("/etc/hosts", "utf8");
  if (original.endsWith(block)) return false;
  assert.ok(
    !original.includes(MARKER),
    "Existing Ubuntu DNS recovery must not be silently replaced",
  );
  appendFile("/etc/hosts", block, "utf8");
  return true;
}

module.exports = {
  APT_HOSTS,
  assertPublicAddress,
  parseDohAnswer,
  readDohAnswer,
  resolveUbuntuAptHosts,
  ubuntuAptDockerArgs,
  applyUbuntuAptDns,
  applyUbuntuAptDnsFromStdin,
  curlDohFetch,
};

if (require.main === module) {
  (async () => {
    assert.ok(
      process.argv.length === 3 &&
        ["--probe", "--resolve", "--apply-stdin"].includes(process.argv[2]),
      "Use --probe, --resolve or --apply-stdin",
    );
    if (process.argv[2] === "--apply-stdin") {
      console.log(JSON.stringify(await applyUbuntuAptDnsFromStdin()));
      return;
    }
    const records = await resolveUbuntuAptHosts();
    console.log(
      JSON.stringify(
        process.argv[2] === "--resolve"
          ? records
          : { ubuntuAptDns: records, hostsFileChanged: false },
      ),
    );
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
