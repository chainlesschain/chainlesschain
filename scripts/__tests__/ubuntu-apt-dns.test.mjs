import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import helper from "../lib/ubuntu-apt-dns.cjs";

const {
  APT_HOSTS,
  assertPublicAddress,
  parseDohAnswer,
  readDohAnswer,
  resolveUbuntuAptHosts,
  ubuntuAptDockerArgs,
  applyUbuntuAptDns,
  applyUbuntuAptDnsFromStdin,
  curlDohFetch,
} = helper;
const address = "91.189.91.81";
const answer = (hostname) => ({
  Status: 0,
  TC: false,
  CD: false,
  Question: [{ name: hostname + ".", type: 1 }],
  Answer: [{ name: hostname + ".", type: 1, TTL: 60, data: address }],
});
const records = (source = "doh") =>
  APT_HOSTS.map((hostname) => ({ hostname, source, addresses: [address] }));
const dnsFailure = () => {
  throw Object.assign(new Error("Temporary DNS failure"), {
    code: "EAI_AGAIN",
  });
};
const jsonResponse = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

function dohUrl() {
  return new URL(
    "https://cloudflare-dns.com/dns-query?name=archive.ubuntu.com&type=A&cd=false",
  );
}

test("real curl argument handoff retains proxy inheritance, certificate checks, bootstrap address and transport deadlines", async () => {
  const response = await curlDohFetch(
    dohUrl(),
    { signal: AbortSignal.timeout(8000) },
    async (binary, args, options) => {
      assert.equal(binary, "curl");
      assert.ok(
        !Object.hasOwn(options, "env"),
        "runner proxy/CA environment must be inherited",
      );
      assert.equal(options.maxBuffer, 66048);
      assert.equal(options.timeout, 9000);
      for (const flag of ["--insecure", "-k", "--location", "--noproxy"])
        assert.ok(!args.includes(flag));
      assert.equal(
        args[args.indexOf("--resolve") + 1],
        "cloudflare-dns.com:443:1.1.1.1",
      );
      assert.equal(args[args.indexOf("--max-time") + 1], "8");
      assert.equal(args[args.indexOf("--max-filesize") + 1], "65536");
      assert.equal(args.at(-1), dohUrl().href);
      return {
        stdout:
          JSON.stringify(answer(APT_HOSTS[0])) + "\napplication/dns-json\n200",
      };
    },
  );
  assert.deepEqual(await response.json(), answer(APT_HOSTS[0]));
});

test("curl failures and redirects stay failed without exposing proxy diagnostics", async () => {
  await assert.rejects(
    curlDohFetch(dohUrl(), {}, async () => {
      throw Object.assign(new Error("private proxy credential"), {
        code: 28,
        stderr: "private proxy credential",
      });
    }),
    (error) => error.message === "Ubuntu HTTPS DNS transport failed (28)",
  );
  await assert.rejects(
    curlDohFetch(dohUrl(), {}, async () => ({
      stdout: "redirect\napplication/json\n302",
    })),
    /HTTP 200/u,
  );
  await assert.rejects(
    curlDohFetch(
      new URL(
        "https://other.example.net/dns-query?name=archive.ubuntu.com&type=A&cd=false",
      ),
      {},
      () => assert.fail("unexpected transport"),
    ),
  );
});

test("privileged stdin consumer accepts fragmented bounded JSON and only appends validated hosts", async () => {
  const bytes = JSON.stringify(records());
  let appended = "";
  const result = await applyUbuntuAptDnsFromStdin({
    platform: "linux",
    env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" },
    uid: 0,
    input: Readable.from([bytes.slice(0, 13), bytes.slice(13)]),
    readFile: () => "127.0.0.1 localhost\n",
    appendFile: (file, text) => {
      assert.equal(file, "/etc/hosts");
      appended += text;
    },
  });
  assert.equal(result.hostsFileChanged, true);
  assert.deepEqual(result.ubuntuAptDns, records());
  assert.match(appended, /archive\.ubuntu\.com/u);
});

test("failed/oversized/invalid resolver handoff cannot reach hosts writes", async () => {
  const options = {
    platform: "linux",
    env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" },
    uid: 0,
    readFile: () => assert.fail("invalid handoff must not read hosts"),
    appendFile: () => assert.fail("invalid handoff must not write hosts"),
  };
  for (const text of [
    "",
    "not-json",
    " ".repeat(65537),
    JSON.stringify(records().slice(1)),
    JSON.stringify([
      { hostname: "github.com", source: "doh", addresses: [address] },
    ]),
  ])
    await assert.rejects(
      applyUbuntuAptDnsFromStdin({ ...options, input: Readable.from([text]) }),
    );
  let consumed = false;
  const input = {
    async *[Symbol.asyncIterator]() {
      consumed = true;
      yield JSON.stringify(records());
    },
  };
  await assert.rejects(
    applyUbuntuAptDnsFromStdin({ ...options, uid: 1001, input }),
  );
  assert.equal(consumed, false);
});

test("healthy OS DNS requires no HTTPS recovery or hosts-file change", async () => {
  let fetched = false;
  const rows = await resolveUbuntuAptHosts({
    lookupImpl: async (_host, options) => {
      assert.deepEqual(options, { family: 4, all: true });
      return [{ address, family: 4 }];
    },
    fetchImpl: async () => {
      fetched = true;
      throw new Error("unexpected recovery");
    },
  });
  assert.deepEqual(rows, records("system"));
  assert.equal(fetched, false);
  assert.equal(
    applyUbuntuAptDns(rows, {
      platform: "linux",
      env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" },
      uid: 0,
      readFile: () => assert.fail("healthy DNS must not read hosts"),
      appendFile: () => assert.fail("healthy DNS must not write hosts"),
    }),
    false,
  );
});

test("transient OS DNS failure uses authenticated bounded HTTPS for only fixed Ubuntu hosts", async () => {
  const requested = [];
  const rows = await resolveUbuntuAptHosts({
    lookupImpl: dnsFailure,
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, "https://cloudflare-dns.com");
      assert.equal(url.pathname, "/dns-query");
      assert.equal(url.searchParams.get("type"), "A");
      assert.equal(url.searchParams.get("cd"), "false");
      assert.equal(options.headers.accept, "application/dns-json");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      const hostname = url.searchParams.get("name");
      requested.push(hostname);
      return jsonResponse(answer(hostname));
    },
  });
  assert.deepEqual(requested.sort(), [...APT_HOSTS].sort());
  assert.deepEqual(rows, records());
});

test("permission and invalid OS answers do not silently trigger another resolver", async () => {
  for (const lookupImpl of [
    async () => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    },
    async () => [{ address: "127.0.0.1" }],
    async () => [],
  ])
    await assert.rejects(
      resolveUbuntuAptHosts({
        lookupImpl,
        fetchImpl: () => assert.fail("unexpected fallback"),
      }),
    );
});

test("DNS CNAME answers must connect to the original question", () => {
  const response = answer(APT_HOSTS[0]);
  response.Answer = [
    {
      name: "archive.ubuntu.com.",
      type: 5,
      TTL: 30,
      data: "mirror.example.net.",
    },
    { name: "mirror.example.net.", type: 1, TTL: 30, data: address },
    { name: "unrelated.example.net.", type: 1, TTL: 30, data: "127.0.0.1" },
  ];
  assert.deepEqual(parseDohAnswer(APT_HOSTS[0], response), [address]);
  response.Answer.shift();
  assert.throws(() => parseDohAnswer(APT_HOSTS[0], response), /No bounded/u);
});

for (const value of [
  "0.0.0.0",
  "10.1.2.3",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.1.1",
  "192.168.1.1",
  "192.0.2.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "91.189.91.81\n127.0.0.1 evil",
  "91.189.91.81 --privileged",
]) {
  test(`non-public or injected address is rejected: ${JSON.stringify(value)}`, () =>
    assert.throws(() => assertPublicAddress(value)));
}

test("mismatched, expired, truncated, empty and failed DNS responses cannot supply hosts entries", () => {
  for (const mutate of [
    (value) => {
      value.Status = 3;
    },
    (value) => {
      value.TC = true;
    },
    (value) => {
      value.CD = true;
    },
    (value) => {
      value.Question[0].name = "other.example.net.";
    },
    (value) => {
      value.Question[0].type = 28;
    },
    (value) => {
      value.Answer[0].TTL = 0;
    },
    (value) => {
      value.Answer[0].data = "169.254.169.254";
    },
    (value) => {
      value.Answer = [];
    },
    (value) => {
      value.Answer[0].name = "archive.ubuntu.com\nlocalhost";
    },
  ]) {
    const value = answer(APT_HOSTS[0]);
    mutate(value);
    assert.throws(() => parseDohAnswer(APT_HOSTS[0], value));
  }
  assert.throws(() =>
    parseDohAnswer("arbitrary.example.net", answer("arbitrary.example.net")),
  );
});

test("failed HTTPS, malformed JSON, timeout and oversized bodies remain failures", async () => {
  for (const fetchImpl of [
    async () => new Response("denied", { status: 403 }),
    async () =>
      new Response("<html>proxy</html>", {
        headers: { "content-type": "text/html" },
      }),
    async () =>
      new Response("not-json", {
        headers: { "content-type": "application/json" },
      }),
    async () =>
      new Response(" ".repeat(65537), {
        headers: { "content-type": "application/json" },
      }),
    async () => {
      throw new Error("TLS timeout");
    },
  ])
    await assert.rejects(readDohAnswer(APT_HOSTS[0], fetchImpl));
});

test("container arguments include only validated Ubuntu host entries, keeping the image and SSH options separate", () => {
  assert.deepEqual(
    ubuntuAptDockerArgs(records()),
    APT_HOSTS.flatMap((host) => ["--add-host", `${host}:${address}`]),
  );
  for (const mutate of [
    (value) => value.pop(),
    (value) => {
      value[0].hostname = "github.com";
    },
    (value) => {
      value[0].addresses = ["127.0.0.1"];
    },
    (value) => {
      value[0].addresses = [];
    },
  ]) {
    const value = records();
    mutate(value);
    assert.throws(() => ubuntuAptDockerArgs(value));
  }
});

test("hosts recovery appends only failed names and preserves existing hosts bytes", () => {
  const original = "127.0.0.1 localhost\n::1 localhost\n";
  const rows = records();
  rows[1].source = "system";
  let current = original;
  let written = 0;
  const options = {
    platform: "linux",
    env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" },
    uid: 0,
    readFile: (file) => {
      assert.equal(file, "/etc/hosts");
      return current;
    },
    appendFile: (file, text) => {
      assert.equal(file, "/etc/hosts");
      current += text;
      written++;
    },
  };
  assert.equal(applyUbuntuAptDns(rows, options), true);
  assert.ok(current.startsWith(original));
  assert.match(current, /91\.189\.91\.81 archive\.ubuntu\.com/u);
  assert.doesNotMatch(current, /91\.189\.91\.81 security\.ubuntu\.com/u);
  assert.equal(applyUbuntuAptDns(rows, options), false);
  assert.equal(written, 1);
  rows[0].addresses = ["91.189.91.82"];
  assert.throws(
    () => applyUbuntuAptDns(rows, options),
    /must not be silently replaced/u,
  );
});

test("hosts modification refuses local/non-Linux/non-root execution before filesystem access", () => {
  const good = {
    platform: "linux",
    env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" },
    uid: 0,
    readFile: () => assert.fail("forbidden filesystem access"),
    appendFile: () => assert.fail("forbidden filesystem access"),
  };
  for (const bad of [
    { platform: "win32" },
    { env: {} },
    { env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows" } },
    { uid: 1001 },
  ])
    assert.throws(() => applyUbuntuAptDns(records(), { ...good, ...bad }));
});
