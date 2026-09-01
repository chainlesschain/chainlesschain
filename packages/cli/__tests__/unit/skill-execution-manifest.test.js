import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SKILL_MUTATION_REQUEST_INVALID_CODE,
  SkillMutationAuthorityError,
  digestSkillMutationDependencyLock as authorityDependencyDigest,
} from "../../src/lib/evolution/skill-mutation-authority.js";
import {
  SKILL_DEPENDENCY_LOCK_SCHEMA,
  SKILL_EXECUTION_MANIFEST_INVALID_CODE,
  SKILL_RUNTIME_MANIFEST_SCHEMA,
  SKILL_TARGET_MATRIX_SCHEMA,
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
  digestSkillDependencyLock,
  digestSkillMutationDependencyLock,
  digestSkillRuntimeManifest,
  digestSkillTargetMatrix,
  verifySkillDependencyLock,
  verifySkillRuntimeManifest,
  verifySkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";

const TENANT_ID = "tenant:alpha";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function dependencyInput(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    lock: {
      generation: 3,
      packages: {
        vitest: "4.1.10",
        zod: "4.0.0",
      },
    },
    ...overrides,
  };
}

function runtimeInput(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    runtimes: [
      {
        runtimeId: "desktop",
        descriptor: {
          platform: "win32-x64",
          runtime: "electron-39",
          sandboxPolicyDigest: sha256("sandbox:desktop"),
        },
      },
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: sha256("sandbox:cli"),
        },
      },
    ],
    ...overrides,
  };
}

function matrixInput(overrides = {}) {
  const dependencyLock = buildSkillDependencyLock(dependencyInput());
  const runtimeManifest = buildSkillRuntimeManifest(runtimeInput());
  return {
    tenantId: TENANT_ID,
    dependencyLock,
    runtimeManifest,
    cells: [
      {
        cellId: "desktop-win32-x64",
        runtimeId: "desktop",
        targetEnvironmentRef: "environment:desktop-win32-x64",
        environmentDigest: sha256("environment:desktop-win32-x64"),
      },
      {
        cellId: "cli-linux-x64",
        runtimeId: "cli",
        targetEnvironmentRef: "environment:cli-linux-x64",
        environmentDigest: sha256("environment:cli-linux-x64"),
      },
    ],
    ...overrides,
  };
}

function environmentBindings(cells) {
  return cells.map(
    ({ cellId, runtimeId, targetEnvironmentRef, environmentDigest }) => ({
      cellId,
      runtimeId,
      targetEnvironmentRef,
      environmentDigest,
    }),
  );
}

function matrixVerificationContext(matrix, input) {
  return {
    dependencyLock: input.dependencyLock,
    expectedEnvironmentBindings: environmentBindings(input.cells),
    expectedTargetMatrixRoot: matrix.targetMatrixRoot,
    runtimeManifest: input.runtimeManifest,
  };
}

function capturedError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

describe("skill execution manifest contracts", () => {
  it("exports versioned schemas and the mutation authority compatibility binding", () => {
    expect(SKILL_DEPENDENCY_LOCK_SCHEMA).toBe(
      "chainlesschain.skill-dependency-lock/v2",
    );
    expect(SKILL_RUNTIME_MANIFEST_SCHEMA).toBe(
      "chainlesschain.skill-runtime-manifest/v1",
    );
    expect(SKILL_TARGET_MATRIX_SCHEMA).toBe(
      "chainlesschain.skill-target-matrix/v1",
    );
    expect(authorityDependencyDigest(dependencyInput().lock)).toBe(
      digestSkillMutationDependencyLock(dependencyInput().lock),
    );
  });

  it("preserves the legacy dependency-lock digest while canonicalizing key order", () => {
    const first = digestSkillMutationDependencyLock({
      packages: { vitest: "4.1.10", zod: "4.0.0" },
      generation: 3,
    });
    const reordered = digestSkillMutationDependencyLock({
      generation: 3,
      packages: { zod: "4.0.0", vitest: "4.1.10" },
    });
    const prototypeNamedLock = {};
    Object.defineProperty(prototypeNamedLock, "__proto__", {
      value: { pinned: "1.0.0" },
      enumerable: true,
    });

    expect(first).toBe(
      "sha256:77d12b929d00e6be972cac726803948c091d563d2cd5bdb4caf88a36b67a641c",
    );
    expect(reordered).toBe(first);
    expect(authorityDependencyDigest(dependencyInput().lock)).toBe(first);
    expect(digestSkillMutationDependencyLock(prototypeNamedLock)).not.toBe(
      digestSkillMutationDependencyLock({}),
    );
  });

  it("preserves the legacy authority error type, code, and primary message", () => {
    const error = capturedError(() =>
      authorityDependencyDigest({ generation: -1 }),
    );

    expect(error).toBeInstanceOf(SkillMutationAuthorityError);
    expect(error).toMatchObject({
      name: "SkillMutationAuthorityError",
      code: SKILL_MUTATION_REQUEST_INVALID_CODE,
      message:
        "dependencyLock.generation numbers must be non-negative safe integers",
    });
    expect(error.cause).toBeUndefined();
  });

  it("builds tenant-bound immutable dependency locks", () => {
    const first = buildSkillDependencyLock(dependencyInput());
    const reordered = buildSkillDependencyLock(
      dependencyInput({
        lock: {
          packages: { zod: "4.0.0", vitest: "4.1.10" },
          generation: 3,
        },
      }),
    );
    const otherTenant = buildSkillDependencyLock(
      dependencyInput({ tenantId: "tenant:beta" }),
    );

    expect(first.schema).toBe(SKILL_DEPENDENCY_LOCK_SCHEMA);
    expect(first.lockDigest).toBe(
      digestSkillMutationDependencyLock(dependencyInput().lock),
    );
    expect(first.dependencyLockDigest).toBe(reordered.dependencyLockDigest);
    expect(first.dependencyLockDigest).not.toBe(
      otherTenant.dependencyLockDigest,
    );
    expect(digestSkillDependencyLock(dependencyInput())).toBe(
      first.dependencyLockDigest,
    );
    expect(verifySkillDependencyLock(first)).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.lock)).toBe(true);
    expect(Object.isFrozen(first.lock.packages)).toBe(true);
  });

  it("rejects dependency-lock schema drift, digest tampering, and unsafe JSON", () => {
    expect(
      capturedError(() =>
        buildSkillDependencyLock({ ...dependencyInput(), extra: true }),
      ),
    ).toMatchObject({ code: SKILL_EXECUTION_MANIFEST_INVALID_CODE });

    const artifact = structuredClone(
      buildSkillDependencyLock(dependencyInput()),
    );
    artifact.dependencyLockDigest = sha256("tampered");
    expect(() => verifySkillDependencyLock(artifact)).toThrow(
      /digest verification failed/u,
    );

    const cyclic = {};
    cyclic.self = cyclic;
    expect(() =>
      buildSkillDependencyLock(dependencyInput({ lock: cyclic })),
    ).toThrow(/cycles/u);
    expect(() =>
      buildSkillDependencyLock(dependencyInput({ lock: { confidence: 0.5 } })),
    ).toThrow(/safe integers/u);
    expect(() =>
      buildSkillDependencyLock(dependencyInput({ lock: { generation: -0 } })),
    ).toThrow(/safe integers/u);
  });

  it("enforces the escaped UTF-8 canonical byte budget incrementally", () => {
    const escapedValue = "\\".repeat(16_384);
    const lockWithFieldCount = (fieldCount) =>
      Object.fromEntries(
        Array.from({ length: fieldCount }, (_, index) => [
          `field-${String(index).padStart(2, "0")}`,
          escapedValue,
        ]),
      );

    expect(digestSkillMutationDependencyLock(lockWithFieldCount(31))).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(() =>
      digestSkillMutationDependencyLock(lockWithFieldCount(32)),
    ).toThrow(/canonical byte budget/u);
    expect(() =>
      buildSkillRuntimeManifest(
        runtimeInput({
          runtimes: Array.from({ length: 32 }, (_, index) => ({
            runtimeId: `runtime-${String(index).padStart(2, "0")}`,
            descriptor: { payload: escapedValue },
          })),
        }),
      ),
    ).toThrow(/canonical byte budget/u);
  });

  it("builds deterministic runtime manifests with unique sorted runtimes", () => {
    const first = buildSkillRuntimeManifest(runtimeInput());
    const reordered = buildSkillRuntimeManifest(
      runtimeInput({
        runtimes: [...runtimeInput().runtimes].reverse().map((entry) => ({
          runtimeId: entry.runtimeId,
          descriptor: Object.fromEntries(
            Object.entries(entry.descriptor).reverse(),
          ),
        })),
      }),
    );

    expect(first.schema).toBe(SKILL_RUNTIME_MANIFEST_SCHEMA);
    expect(first.runtimes.map((entry) => entry.runtimeId)).toEqual([
      "cli",
      "desktop",
    ]);
    expect(reordered.runtimeManifestDigest).toBe(first.runtimeManifestDigest);
    expect(digestSkillRuntimeManifest(runtimeInput())).toBe(
      first.runtimeManifestDigest,
    );
    expect(verifySkillRuntimeManifest(first)).toEqual(first);
    expect(Object.isFrozen(first.runtimes)).toBe(true);
    expect(Object.isFrozen(first.runtimes[0].descriptor)).toBe(true);
  });

  it("rejects empty, duplicate, malformed, and tampered runtime manifests", () => {
    expect(() =>
      buildSkillRuntimeManifest(runtimeInput({ runtimes: [] })),
    ).toThrow(/from 1 to 64/u);
    expect(() =>
      buildSkillRuntimeManifest(
        runtimeInput({
          runtimes: [runtimeInput().runtimes[0], runtimeInput().runtimes[0]],
        }),
      ),
    ).toThrow(/runtimeId values must be unique/u);
    expect(() =>
      buildSkillRuntimeManifest(
        runtimeInput({
          runtimes: [
            {
              ...runtimeInput().runtimes[0],
              unsupported: true,
            },
          ],
        }),
      ),
    ).toThrow(/exactly the supported fields/u);

    const artifact = structuredClone(buildSkillRuntimeManifest(runtimeInput()));
    artifact.runtimeManifestDigest = sha256("tampered-runtime-manifest");
    expect(() => verifySkillRuntimeManifest(artifact)).toThrow(
      /digest verification failed/u,
    );
  });

  it("builds a stable full target-matrix root and strictly derives targetRuntimes", () => {
    const baseInput = matrixInput();
    const firstInput = {
      ...baseInput,
      cells: [
        ...baseInput.cells,
        {
          cellId: "cli-linux-arm64",
          runtimeId: "cli",
          targetEnvironmentRef: "environment:cli-linux-arm64",
          environmentDigest: sha256("environment:cli-linux-arm64"),
        },
      ],
    };
    const first = buildSkillTargetMatrix(firstInput);
    const reorderedManifest = buildSkillRuntimeManifest(
      runtimeInput({ runtimes: [...runtimeInput().runtimes].reverse() }),
    );
    const reordered = buildSkillTargetMatrix({
      ...firstInput,
      runtimeManifest: reorderedManifest,
      cells: [...firstInput.cells].reverse(),
    });

    expect(first.schema).toBe(SKILL_TARGET_MATRIX_SCHEMA);
    expect(first.cells.map((cell) => cell.cellId)).toEqual([
      "cli-linux-arm64",
      "cli-linux-x64",
      "desktop-win32-x64",
    ]);
    expect(first.targetRuntimes).toEqual(["cli", "desktop"]);
    expect(reordered.targetMatrixRoot).toBe(first.targetMatrixRoot);
    expect(digestSkillTargetMatrix(firstInput)).toBe(first.targetMatrixRoot);
    expect(
      verifySkillTargetMatrix(
        first,
        matrixVerificationContext(first, firstInput),
      ),
    ).toEqual(first);
    expect(Object.isFrozen(first.cells)).toBe(true);
    expect(Object.isFrozen(first.targetRuntimes)).toBe(true);
  });

  it("binds the target matrix to tenant, dependency lock, runtime manifest, refs, and environment digests", () => {
    const input = matrixInput();
    const first = buildSkillTargetMatrix(input);
    const changedRuntime = buildSkillRuntimeManifest(
      runtimeInput({
        runtimes: runtimeInput().runtimes.map((entry) =>
          entry.runtimeId === "cli"
            ? {
                ...entry,
                descriptor: { ...entry.descriptor, runtime: "node-24.0.0" },
              }
            : entry,
        ),
      }),
    );
    const changedDependencyLock = buildSkillDependencyLock(
      dependencyInput({ lock: { generation: 4 } }),
    );
    const variants = [
      { tenantId: "tenant:beta" },
      { dependencyLock: changedDependencyLock },
      { runtimeManifest: changedRuntime },
      {
        cells: input.cells.map((cell) =>
          cell.runtimeId === "cli"
            ? { ...cell, targetEnvironmentRef: "environment:cli-linux-arm64" }
            : cell,
        ),
      },
      {
        cells: input.cells.map((cell) =>
          cell.runtimeId === "cli"
            ? { ...cell, environmentDigest: sha256("other-environment") }
            : cell,
        ),
      },
    ];

    for (const overrides of variants) {
      if (overrides.tenantId) {
        expect(() =>
          buildSkillTargetMatrix({ ...input, ...overrides }),
        ).toThrow();
      } else {
        expect(
          buildSkillTargetMatrix({ ...input, ...overrides }).targetMatrixRoot,
        ).not.toBe(first.targetMatrixRoot);
      }
    }
  });

  it("rejects cross-tenant locks and incomplete, duplicate, unknown, or malformed cells", () => {
    const input = matrixInput();
    expect(() => buildSkillTargetMatrix({ ...input, cells: [] })).toThrow(
      /from 1 to 64/u,
    );
    expect(() =>
      buildSkillTargetMatrix({
        ...input,
        cells: [
          input.cells[0],
          { ...input.cells[1], cellId: input.cells[0].cellId },
        ],
      }),
    ).toThrow(/cellId values must be unique/u);
    expect(() =>
      buildSkillTargetMatrix({
        ...input,
        dependencyLock: buildSkillDependencyLock(
          dependencyInput({ tenantId: "tenant:beta" }),
        ),
      }),
    ).toThrow(/same tenant/u);
    expect(() =>
      buildSkillTargetMatrix({
        ...input,
        cells: [
          {
            ...input.cells[0],
            runtimeId: "mobile",
          },
        ],
      }),
    ).toThrow(/absent from the runtime manifest/u);
    expect(() =>
      buildSkillTargetMatrix({
        ...input,
        cells: [
          {
            ...input.cells[0],
            environmentDigest: `sha256:${"A".repeat(64)}`,
          },
        ],
      }),
    ).toThrow(/lowercase SHA-256/u);
    expect(() =>
      buildSkillTargetMatrix({
        ...input,
        cells: [
          {
            ...input.cells[0],
            targetEnvironmentRef: "../other-tenant",
          },
        ],
      }),
    ).toThrow(/canonical identifier/u);
  });

  it("rejects forged matrix roots, caller-derived authority, and the wrong runtime context", () => {
    const input = matrixInput();
    const matrix = structuredClone(buildSkillTargetMatrix(input));
    matrix.targetRuntimes.reverse();
    expect(() =>
      verifySkillTargetMatrix(
        matrix,
        matrixVerificationContext(buildSkillTargetMatrix(input), input),
      ),
    ).toThrow(/targetRuntimes/u);

    const extra = {
      ...matrixInput(),
      targetRuntimes: ["attacker-selected"],
    };
    expect(() => buildSkillTargetMatrix(extra)).toThrow(
      /exactly the supported fields/u,
    );

    expect(() =>
      verifySkillTargetMatrix(buildSkillTargetMatrix(input), {
        runtimeManifest: input.runtimeManifest,
      }),
    ).toThrow(/exactly the supported fields/u);

    const otherManifest = buildSkillRuntimeManifest(
      runtimeInput({ tenantId: "tenant:beta" }),
    );
    const trustedMatrix = buildSkillTargetMatrix(input);
    expect(() =>
      verifySkillTargetMatrix(trustedMatrix, {
        ...matrixVerificationContext(trustedMatrix, input),
        runtimeManifest: otherManifest,
      }),
    ).toThrow(/same tenant/u);
  });

  it("rejects self-consistent dependency, runtime, and environment substitutions", () => {
    const input = matrixInput();
    const trustedMatrix = buildSkillTargetMatrix(input);
    const trustedContext = matrixVerificationContext(trustedMatrix, input);

    const substitutedLock = buildSkillDependencyLock(
      dependencyInput({ lock: { generation: 99 } }),
    );
    const lockSubstitution = buildSkillTargetMatrix({
      ...input,
      dependencyLock: substitutedLock,
    });
    expect(() =>
      verifySkillTargetMatrix(lockSubstitution, trustedContext),
    ).toThrow(/dependency or runtime manifest binding/u);

    const substitutedRuntime = buildSkillRuntimeManifest(
      runtimeInput({
        runtimes: runtimeInput().runtimes.map((entry) =>
          entry.runtimeId === "cli"
            ? {
                ...entry,
                descriptor: { ...entry.descriptor, runtime: "node-24.0.0" },
              }
            : entry,
        ),
      }),
    );
    const runtimeSubstitution = buildSkillTargetMatrix({
      ...input,
      runtimeManifest: substitutedRuntime,
    });
    expect(() =>
      verifySkillTargetMatrix(runtimeSubstitution, trustedContext),
    ).toThrow(/dependency or runtime manifest binding/u);

    const swappedCells = input.cells.map((cell, index) => ({
      ...cell,
      targetEnvironmentRef:
        input.cells[(index + 1) % input.cells.length].targetEnvironmentRef,
      environmentDigest:
        input.cells[(index + 1) % input.cells.length].environmentDigest,
    }));
    const environmentSubstitution = buildSkillTargetMatrix({
      ...input,
      cells: swappedCells,
    });
    expect(() =>
      verifySkillTargetMatrix(environmentSubstitution, trustedContext),
    ).toThrow(/environment bindings differ/u);
  });

  it("requires the exact trusted environment-binding set and target root", () => {
    const input = matrixInput();
    const matrix = buildSkillTargetMatrix(input);
    const context = matrixVerificationContext(matrix, input);
    const additionalBinding = {
      cellId: "cli-linux-arm64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-arm64",
      environmentDigest: sha256("environment:cli-linux-arm64"),
    };

    expect(() =>
      verifySkillTargetMatrix(matrix, {
        ...context,
        expectedEnvironmentBindings: context.expectedEnvironmentBindings.slice(
          0,
          -1,
        ),
      }),
    ).toThrow(/environment bindings differ/u);
    expect(() =>
      verifySkillTargetMatrix(matrix, {
        ...context,
        expectedEnvironmentBindings: [
          ...context.expectedEnvironmentBindings,
          additionalBinding,
        ],
      }),
    ).toThrow(/environment bindings differ/u);
    expect(() =>
      verifySkillTargetMatrix(matrix, {
        ...context,
        expectedTargetMatrixRoot: sha256("attacker-recomputed-root"),
      }),
    ).toThrow(/trusted expectation/u);
  });

  it("rejects Proxies before invoking traps at every contract boundary", () => {
    const trap = vi.fn(() => {
      throw new Error("proxy trap must not run");
    });
    const proxy = new Proxy(
      {},
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      },
    );

    expect(() => buildSkillDependencyLock(proxy)).toThrow(
      /must not be a Proxy/u,
    );
    expect(() =>
      buildSkillDependencyLock(dependencyInput({ lock: proxy })),
    ).toThrow(/must not be a Proxy/u);
    expect(() =>
      buildSkillRuntimeManifest(runtimeInput({ runtimes: proxy })),
    ).toThrow(/must not be a Proxy/u);
    expect(() =>
      buildSkillRuntimeManifest(
        runtimeInput({
          runtimes: [
            {
              runtimeId: "cli",
              descriptor: proxy,
            },
          ],
        }),
      ),
    ).toThrow(/must not be a Proxy/u);
    expect(() => buildSkillTargetMatrix(matrixInput({ cells: proxy }))).toThrow(
      /must not be a Proxy/u,
    );
    const input = matrixInput();
    const matrix = structuredClone(buildSkillTargetMatrix(input));
    matrix.targetRuntimes = proxy;
    expect(() =>
      verifySkillTargetMatrix(matrix, {
        ...matrixVerificationContext(buildSkillTargetMatrix(input), input),
      }),
    ).toThrow(/must not be a Proxy/u);
    expect(trap).not.toHaveBeenCalled();
  });

  it("rejects accessors and non-standard arrays without invoking getters", () => {
    const getter = vi.fn(() => dependencyInput().lock);
    const input = { tenantId: TENANT_ID };
    Object.defineProperty(input, "lock", {
      get: getter,
      enumerable: true,
    });
    expect(() => buildSkillDependencyLock(input)).toThrow(/own data property/u);
    expect(getter).not.toHaveBeenCalled();

    class RuntimeList extends Array {}
    expect(() =>
      buildSkillRuntimeManifest(
        runtimeInput({ runtimes: new RuntimeList(...runtimeInput().runtimes) }),
      ),
    ).toThrow(/standard array/u);
  });
});
