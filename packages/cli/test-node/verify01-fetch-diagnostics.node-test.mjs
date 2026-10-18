import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  nativeFetchDiagnosticLaunch,
  runNativeCampaign,
} from "../scripts/verify01-native-task-campaign.mjs";
const preload = fileURLToPath(
  new URL("../scripts/verify01-fetch-diagnostics-preload.cjs", import.meta.url),
);
function stub(t, source, { enabled = true, badSink = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-passive-fetch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, "events.jsonl");
  const env = { ...process.env };
  delete env.CC_VERIFY01_FETCH_DIAGNOSTICS_FILE;
  delete env.CC_VERIFY01_FETCH_BROKER_ORIGIN;
  if (enabled) {
    env.CC_VERIFY01_FETCH_DIAGNOSTICS_FILE = badSink ? root : log;
    env.CC_VERIFY01_FETCH_BROKER_ORIGIN = "http://127.0.0.1:12345";
  }
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const assert=require('node:assert/strict');const before=globalThis.fetch;require(${JSON.stringify(preload)});assert.equal(globalThis.fetch,before);${source}`,
    ],
    { env, encoding: "utf8", timeout: 15000 },
  );
  assert.ifError(result.error);
  const raw = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  return {
    ...result,
    raw,
    records: raw.trim() ? raw.trim().split("\n").map(JSON.parse) : [],
  };
}

test("fetch diagnostics are default off and affect only actual model child launch", async () => {
  const args = ["cli.js", "agent", "--max-turns", "20"],
    env = { TEST: "kept" };
  const config = {
    preloadPath: preload,
    logPath: "test.jsonl",
    brokerBaseUrl: "http://127.0.0.1:12345/api/v3",
  };
  assert.deepEqual(nativeFetchDiagnosticLaunch("model", args, env), {
    args,
    env,
  });
  for (const name of ["cli-identity", "config-readback", "config-provider"])
    assert.deepEqual(nativeFetchDiagnosticLaunch(name, args, env, config), {
      args,
      env,
    });
  const selected = nativeFetchDiagnosticLaunch("model", args, env, config);
  assert.deepEqual(selected.args, ["--require", preload, ...args]);
  assert.equal(
    selected.env.CC_VERIFY01_FETCH_BROKER_ORIGIN,
    "http://127.0.0.1:12345",
  );
  assert.deepEqual(env, { TEST: "kept" });
  await assert.rejects(
    runNativeCampaign({ entry: "vscode", fetchDiagnostics: true }),
    /require CLI entry/,
  );
});

test("startup marker proves enabled observation without modifying stdout or exit", (t) => {
  const source =
    "process.stdout.write('original stdout');process.stderr.write('original stderr');process.exitCode=17;";
  const on = stub(t, source),
    off = stub(t, source, { enabled: false });
  assert.equal(on.stdout, off.stdout);
  assert.equal(on.stderr, off.stderr);
  assert.equal(on.status, off.status);
  assert.equal(on.status, 17);
  assert.equal(off.raw, "");
  assert.equal(on.records.length, 1);
  assert.equal(on.records[0].event, "enabled");
  assert.equal(on.records[0].passive, true);
});

test("only allowlisted fields persist, hostile errors cannot leak data, and records are bounded", (t) => {
  const result = stub(
    t,
    `const channel=require('node:diagnostics_channel').channel('undici:request:error');
    channel.publish({request:{origin:'http://127.0.0.1:12345',headers:'secret-credential',body:'secret-body'},error:{name:'TypeError',code:'UND_ERR_SOCKET',cause:{code:'ECONNRESET'},message:'secret-message',stack:'secret-path'}});
    let reads=0;channel.publish({request:{origin:'https://secret-host.invalid/private'},error:{name:'secret-name',get code(){return reads++===0?'ECONNRESET':'secret-switch'},cause:{code:'secret-code'}}});
    channel.publish({get error(){throw new Error('secret-getter')}});
    for(let i=0;i<300;i++)channel.publish({error:{name:'Error',code:'ENOTFOUND'}});
    process.stdout.write('unchanged');process.exitCode=9;`,
  );
  assert.equal(result.status, 9);
  assert.equal(result.stdout, "unchanged");
  assert.equal(result.stderr, "");
  assert.ok(!result.raw.includes("secret"));
  assert.ok(Buffer.byteLength(result.raw) <= 65536);
  assert.equal(result.records.length, 128);
  assert.equal(result.records[1].endpoint, "loopback-broker");
  assert.deepEqual(result.records[1].error, {
    name: "TypeError",
    code: "UND_ERR_SOCKET",
    causeCode: "ECONNRESET",
  });
  assert.equal(result.records[2].endpoint, "other");
  assert.equal(result.records[2].error.name, null);
  assert.equal(result.records[2].error.code, "ECONNRESET");
  assert.equal(result.records.at(-1).event, "truncated");
  result.records.forEach((r, i) => assert.equal(r.sequence, i));
});

test("sink open and write failure cannot replace application errors", (t) => {
  const source =
    "require('node:diagnostics_channel').channel('undici:client:connectError').publish({error:{name:'Error',code:'ECONNREFUSED'}});process.stdout.write('original');process.exitCode=11;";
  const badOpen = stub(t, source, { badSink: true });
  assert.equal(badOpen.status, 11);
  assert.equal(badOpen.stdout, "original");
  assert.equal(badOpen.stderr, "");
  assert.equal(badOpen.raw, "");
  const badWrite = stub(
    t,
    "require('node:fs').writeSync=()=>{throw new Error('secret sink failure')};" +
      source,
  );
  assert.equal(badWrite.status, 11);
  assert.equal(badWrite.stdout, "original");
  assert.equal(badWrite.stderr, "");
  assert.equal(badWrite.records.length, 1);
});

test("actual local fetch rejection remains one request with unchanged original cause", (t) => {
  const source = `const http=require('node:http');let requests=0;const server=http.createServer((req,res)=>{requests++;req.socket.destroy();});server.listen(0,'127.0.0.1',async()=>{try{await fetch('http://127.0.0.1:'+server.address().port+'/test')}catch(error){process.stdout.write(JSON.stringify({name:error.name,code:error.cause?.code,requests}));process.exitCode=7;}finally{server.close();}});`;
  const on = stub(t, source),
    off = stub(t, source, { enabled: false });
  assert.equal(on.status, 7);
  assert.equal(on.stdout, off.stdout);
  assert.equal(JSON.parse(on.stdout).requests, 1);
  assert.equal(on.stderr, off.stderr);
  assert.ok(
    on.records.some(
      (r) =>
        r.event === "undici:request:error" && r.error.code === "UND_ERR_SOCKET",
    ),
  );
});
