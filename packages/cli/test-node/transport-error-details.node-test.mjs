import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { transportErrorDetails } from "../src/lib/transport-error-details.js";

test("projects only known data fields without exposing error or request content", () => {
  const error = new TypeError("secret URL", {
    cause: Object.assign(new Error("secret body"), {
      code: "ECONNREFUSED",
      host: "secret",
    }),
  });
  assert.deepEqual(transportErrorDetails(error), {
    kind: "transport",
    name: "TypeError",
    causeCode: "ECONNREFUSED",
  });
  assert.equal(error.message, "secret URL");
  assert.equal(
    transportErrorDetails({
      name: "secret",
      code: "secret",
      cause: { code: "secret" },
    }),
    undefined,
  );
  assert.equal(transportErrorDetails(new Error("ordinary")), undefined);
  assert.deepEqual(
    transportErrorDetails({ name: "SocketError", code: "UND_ERR_SOCKET" }),
    { kind: "transport", name: "SocketError", code: "UND_ERR_SOCKET" },
  );
});

test("never invokes hostile accessors, coercions, proxies, or cyclic/deep causes", () => {
  let calls = 0;
  const hostile = {};
  for (const key of [
    "name",
    "code",
    "cause",
    "message",
    "stack",
    "toJSON",
    "toString",
  ])
    Object.defineProperty(hostile, key, {
      get() {
        calls++;
        throw Error("secret");
      },
    });
  assert.equal(transportErrorDetails(hostile), undefined);
  const proxy = new Proxy(
    {},
    {
      get() {
        calls++;
        throw Error();
      },
      getOwnPropertyDescriptor() {
        calls++;
        throw Error();
      },
      getPrototypeOf() {
        calls++;
        throw Error();
      },
    },
  );
  assert.equal(transportErrorDetails(proxy), undefined);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(transportErrorDetails(revoked.proxy), undefined);
  const cycle = {};
  cycle.cause = cycle;
  assert.equal(transportErrorDetails(cycle), undefined);
  let deep = { code: "ECONNRESET" };
  for (let i = 0; i < 100; i++) deep = { cause: deep };
  assert.equal(transportErrorDetails(deep), undefined);
  assert.equal(calls, 0);
  const withProxyPrototype = Object.create(proxy);
  assert.equal(transportErrorDetails(withProxyPrototype), undefined);
  assert.equal(calls, 0);
});

test("real local fetch failure retains original error and one physical request", async () => {
  let requests = 0;
  const server = http.createServer((request) => {
    requests++;
    request.socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    let original;
    try {
      await fetch(`http://127.0.0.1:${server.address().port}/`);
    } catch (error) {
      original = error;
    }
    assert.ok(original instanceof TypeError);
    const message = original.message,
      cause = original.cause;
    assert.deepEqual(transportErrorDetails(original), {
      kind: "transport",
      name: "TypeError",
      causeCode: "UND_ERR_SOCKET",
    });
    assert.equal(original.message, message);
    assert.equal(original.cause, cause);
    assert.equal(requests, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
