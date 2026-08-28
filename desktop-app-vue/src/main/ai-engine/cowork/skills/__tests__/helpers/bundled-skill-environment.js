import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createBundledSkillEnvironmentBroker,
} = require("../../bundled-skill-environment-broker.js");

export function createEnvironmentContext(skillId, values = {}) {
  return {
    environmentBroker: createBundledSkillEnvironmentBroker(
      {
        skillId,
        authorityId: `test:${skillId}`,
      },
      {
        resolveValue: ({ key }) => values[key] ?? null,
        auditSink: () => {},
      },
    ),
  };
}
