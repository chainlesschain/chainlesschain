/** Live exclusion of participating Registry writers; no legacy drain or origin admission. */
import { types as utilTypes } from "node:util";
import { captureSkillCandidateRegistryWriterControl } from "./skill-candidate-registry.js";
import { captureSkillReleaseRegistryWriterControl } from "./skill-release-registry.js";

export async function withSkillRegistryMaintenance(input, operation) {
  const names = ["candidateRegistry", "releaseRegistry"];
  if (
    !input ||
    utilTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length ||
    typeof operation !== "function" ||
    utilTypes.isProxy(operation)
  )
    throw new TypeError(
      "Registry maintenance requires plain own registries and an operation",
    );
  const registries = Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        throw new TypeError("Registry maintenance cannot use option accessors");
      return [name, field.value];
    }),
  );
  const candidate = captureSkillCandidateRegistryWriterControl(
    registries.candidateRegistry,
  );
  const release = captureSkillReleaseRegistryWriterControl(
    registries.releaseRegistry,
  );
  if (
    candidate.descriptor.tenantId !== release.descriptor.tenantId ||
    candidate.orderKey === release.orderKey
  )
    throw new TypeError(
      "Registry maintenance requires independent stores for the same tenant",
    );
  const ordered = [candidate, release].sort((left, right) =>
    left.orderKey < right.orderKey ? -1 : 1,
  );
  return ordered[0].maintainAsync(() =>
    ordered[1].maintainAsync(async () => {
      let open = true;
      const assertCurrent = () => {
        if (!open)
          throw Object.assign(
            new Error("Registry maintenance capability is no longer live"),
            { code: "CC_SKILL_REGISTRY_MAINTENANCE_EXPIRED" },
          );
        candidate.assertIfWriting();
        release.assertIfWriting();
        return true;
      };
      const context = Object.freeze({
        descriptor: Object.freeze({
          schema: "chainlesschain.skill-registry-maintenance/v1",
          tenantId: candidate.descriptor.tenantId,
          candidateWriter: candidate.descriptor,
          releaseWriter: release.descriptor,
          participatingWriterExclusionVerified: true,
          preTransitionBinaryWritersExcluded: false,
          persistentStoreIdentityAuthenticated: false,
          originCutoverAuthenticated: false,
          qualifiesForPromotion: false,
        }),
        assertCurrent,
      });
      try {
        assertCurrent();
        const result = await operation(context);
        assertCurrent();
        return result;
      } finally {
        open = false;
      }
    }),
  );
}
