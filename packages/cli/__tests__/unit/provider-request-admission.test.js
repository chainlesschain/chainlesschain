import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertProviderRequestAdmission,
  dispatchProviderRequest,
  hasProviderRequestAdmission,
  withProviderRequestAdmission,
} from "../../src/lib/provider-request-admission.js";
import { providerFetch } from "../../src/lib/formal-budget-provider-scope.js";

afterEach(() => vi.restoreAllMocks());
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const target = { provider: "fixture" };

describe("provider request admission async authority", () => {
  it("retains the unscoped transport behavior", async () => {
    const fetch = vi.fn(async () => "response");
    expect(hasProviderRequestAdmission()).toBe(false);
    await assertProviderRequestAdmission();
    expect(await providerFetch("https://fixture.invalid", {}, fetch)).toBe(
      "response",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a validator rejection and never invokes the operation", async () => {
    const error = Object.assign(new Error("admission rejected"), {
      noReplay: true,
    });
    const operation = vi.fn();
    await expect(
      withProviderRequestAdmission(
        {
          target,
          validate: async () => {
            throw error;
          },
        },
        operation,
      ),
    ).rejects.toBe(error);
    expect(operation).not.toHaveBeenCalled();
    expect(hasProviderRequestAdmission()).toBe(false);
  });

  it("revalidates at each real providerFetch without replaying a rejection", async () => {
    let allowed = true;
    const error = Object.assign(new Error("authority revoked"), {
      code: "revision_conflict",
      noReplay: true,
    });
    const fetch = vi.fn(async () => "response");
    await withProviderRequestAdmission(
      {
        target,
        validate: async () => {
          if (!allowed) throw error;
        },
      },
      async () => {
        await providerFetch("https://fixture.invalid", {}, fetch);
        allowed = false;
        await expect(
          providerFetch("https://fixture.invalid", {}, fetch),
        ).rejects.toBe(error);
      },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent scopes isolated across asynchronous validation", async () => {
    const rendezvous = deferred();
    const seen = [];
    let count = 0;
    const run = (provider) =>
      withProviderRequestAdmission(
        {
          target: { provider },
          validate: async (destination) => {
            if (++count === 2) rendezvous.resolve();
            await rendezvous.promise;
            seen.push([provider, destination.provider]);
          },
        },
        async () => {
          await new Promise((resolve) => setImmediate(resolve));
          await assertProviderRequestAdmission();
        },
      );
    await Promise.all([run("first"), run("second")]);
    expect(seen).toHaveLength(4);
    expect(seen.every(([scope, destination]) => scope === destination)).toBe(
      true,
    );
  });

  it("inherits outer restrictions and validates the actual nested destination", async () => {
    const destinations = [];
    await withProviderRequestAdmission(
      {
        target: { provider: "outer" },
        validate: async (destination) => {
          destinations.push(destination.provider);
        },
      },
      () =>
        withProviderRequestAdmission(
          {
            target: () => ({ provider: "inner" }),
            validate: async () => undefined,
          },
          () => assertProviderRequestAdmission({ provider: "physical" }),
        ),
    );
    expect(destinations).toEqual(["outer", "inner", "physical"]);
  });

  it("rejects a detached request after its admission has closed", async () => {
    const gate = deferred();
    const fetch = vi.fn();
    let detached;
    await withProviderRequestAdmission(
      { target, validate: async () => undefined },
      async () => {
        detached = gate.promise
          .then(() => providerFetch("https://fixture.invalid", {}, fetch))
          .then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
      },
    );
    gate.resolve();
    expect((await detached).error).toMatchObject({
      code: "CC_PROVIDER_REQUEST_ADMISSION_CLOSED",
      noReplay: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechecks a closed inner scope after an outer validator resumes", async () => {
    const entered = deferred();
    const gate = deferred();
    const fetch = vi.fn(async () => "must not dispatch");
    let blockOuter = false,
      detached;
    await withProviderRequestAdmission(
      {
        target,
        validate: async () => {
          if (blockOuter) {
            entered.resolve();
            await gate.promise;
          }
        },
      },
      async () => {
        await withProviderRequestAdmission(
          { target, validate: async () => undefined },
          async () => {
            blockOuter = true;
            detached = providerFetch("https://fixture.invalid", {}, fetch).then(
              (value) => ({ value }),
              (error) => ({ error }),
            );
            await entered.promise;
            // Return while the detached request is awaiting its OUTER validator.
          },
        );
        gate.resolve();
        const outcome = await detached;
        expect({
          providerCalls: fetch.mock.calls.length,
          code: outcome.error?.code ?? null,
          noReplay: outcome.error?.noReplay ?? false,
        }).toEqual({
          providerCalls: 0,
          code: "CC_PROVIDER_REQUEST_ADMISSION_CLOSED",
          noReplay: true,
        });
      },
    );
  });
});

it("rejects closure in the microtask between async validation and physical fetch", async () => {
  const operationDone = deferred();
  let validations = 0,
    detached;
  const fetch = vi.fn(async () => "must not dispatch");
  await withProviderRequestAdmission(
    {
      target,
      validate: () => {
        // Entry validation happens first. The physical validation releases the
        // operation which is ALREADY waiting; scope finally closes before fetch.
        if (++validations === 2) operationDone.resolve();
      },
    },
    async () => {
      detached = Promise.resolve()
        .then(() => providerFetch("https://fixture.invalid", {}, fetch))
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await operationDone.promise;
    },
  );
  const outcome = await detached;
  expect({
    providerCalls: fetch.mock.calls.length,
    code: outcome.error?.code ?? null,
  }).toEqual({
    providerCalls: 0,
    code: "CC_PROVIDER_REQUEST_ADMISSION_CLOSED",
  });
});

it("orders distinct resource locks, deduplicates equal revisions and releases before HTTP", async () => {
  const http = deferred();
  const held = [];
  const acquired = [];
  const released = [];
  let duplicateLockCalls = 0;
  const resource = (key, revision = 1) => ({
    key,
    revision,
    async withLock(operation) {
      held.push(key);
      acquired.push(key);
      try {
        return await operation();
      } finally {
        expect(held.pop()).toBe(key);
        released.push(key);
      }
    },
  });
  const checks = [vi.fn(), vi.fn(), vi.fn()];
  const enter = (value, check, operation) =>
    withProviderRequestAdmission(
      {
        target,
        resource: value,
        check,
        validate: async () => undefined,
      },
      operation,
    );
  const duplicate = resource("z");
  duplicate.withLock = async (operation) => {
    duplicateLockCalls += 1;
    return resource("z").withLock(operation);
  };
  const box = await enter(resource("z"), checks[0], () =>
    enter(resource("a"), checks[1], () =>
      enter(duplicate, checks[2], () =>
        dispatchProviderRequest(() => {
          expect(held).toEqual(["a", "z"]);
          return http.promise;
        }),
      ),
    ),
  );
  expect(acquired).toEqual(["a", "z"]);
  expect(released).toEqual(["z", "a"]);
  expect(duplicateLockCalls).toBe(1);
  expect(checks.every((check) => check.mock.calls.length > 0)).toBe(true);
  expect(held).toEqual([]);
  expect(box.value).toBe(http.promise);
  http.resolve("response");
  expect(await box.value).toBe("response");
});

it("rejects different revisions of one authority without acquiring a lock or dispatching", async () => {
  const withLock = vi.fn(async (operation) => operation());
  const physical = vi.fn();
  const enter = (revision, operation) =>
    withProviderRequestAdmission(
      {
        target,
        validate: async () => undefined,
        resource: { key: "same-authority", revision, withLock },
      },
      operation,
    );
  await expect(
    enter(1, () => enter(2, () => dispatchProviderRequest(physical))),
  ).rejects.toMatchObject({ code: "revision_conflict", noReplay: true });
  expect(withLock).not.toHaveBeenCalled();
  expect(physical).not.toHaveBeenCalled();
});

describe("provider dispatch errors after the physical call starts", () => {
  it("marks a resource-release failure non-replayable after one physical fetch", async () => {
    const cause = new Error("synthetic lock cleanup cause");
    const original = Object.assign(
      new Error("lock release timed out", { cause }),
      {
        code: "ETIMEDOUT",
      },
    );
    const fetch = vi.fn(async () => "physical response");
    const outcome = await withProviderRequestAdmission(
      {
        target,
        validate: async () => undefined,
        resource: {
          key: "synthetic-release-failure",
          revision: 1,
          async withLock(operation) {
            await operation();
            throw original;
          },
        },
      },
      () => providerFetch("https://fixture.invalid", {}, fetch),
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome.error).toBe(original);
    expect(outcome.error.cause).toBe(cause);
    expect(
      outcome.error.noReplay,
      JSON.stringify({
        stage: "resource-release-after-physical-fetch",
        providerCalls: fetch.mock.calls.length,
        originalErrorPreserved: outcome.error === original,
        causePreserved: outcome.error.cause === cause,
        noReplay: outcome.error.noReplay ?? false,
      }),
    ).toBe(true);
  });

  it("marks a synchronous physical-fetch throw non-replayable without replacing its cause", async () => {
    const cause = new Error("synthetic socket cause");
    const original = Object.assign(
      new Error("synchronous fetch reset", { cause }),
      {
        code: "ECONNRESET",
      },
    );
    const fetch = vi.fn(() => {
      throw original;
    });
    const outcome = await withProviderRequestAdmission(
      {
        target,
        validate: async () => undefined,
      },
      () => providerFetch("https://fixture.invalid", {}, fetch),
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome.error).toBe(original);
    expect(outcome.error.cause).toBe(cause);
    expect(
      outcome.error.noReplay,
      JSON.stringify({
        stage: "synchronous-physical-fetch-throw",
        providerCalls: fetch.mock.calls.length,
        originalErrorPreserved: outcome.error === original,
        causePreserved: outcome.error.cause === cause,
        noReplay: outcome.error.noReplay ?? false,
      }),
    ).toBe(true);
  });
});

describe("inactive provider admission compatibility", () => {
  it("preserves a synchronous fetch error and retry metadata in a disabled scope", async () => {
    const cause = new Error("synthetic inactive transport cause");
    const original = Object.assign(
      new Error("inactive fetch reset", { cause }),
      {
        code: "ECONNRESET",
      },
    );
    const fetch = vi.fn(() => {
      throw original;
    });
    let activeAtFetch;
    const outcome = await withProviderRequestAdmission(
      {
        target,
        enabled: false,
        validate: async () => undefined,
      },
      () => {
        activeAtFetch = hasProviderRequestAdmission();
        return providerFetch("https://fixture.invalid", {}, fetch);
      },
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome.error).toBe(original);
    expect(outcome.error.cause).toBe(cause);
    expect({
      activeAtFetch,
      noReplay: outcome.error.noReplay ?? false,
    }).toEqual({ activeAtFetch: false, noReplay: false });
  });

  it("does not let a disabled child scope withdraw an active parent constraint", async () => {
    const original = Object.assign(new Error("parent authority revoked"), {
      code: "revision_conflict",
      noReplay: true,
    });
    const fetch = vi.fn();
    let revoked = false;
    const outcome = await withProviderRequestAdmission(
      {
        target,
        validate: async () => {
          if (revoked) throw original;
        },
      },
      () =>
        withProviderRequestAdmission(
          {
            target,
            enabled: false,
            validate: async () => undefined,
          },
          async () => {
            expect(hasProviderRequestAdmission()).toBe(true);
            revoked = true;
            return providerFetch("https://fixture.invalid", {}, fetch);
          },
        ),
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    expect(outcome.error).toBe(original);
    expect(outcome.error.noReplay).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
