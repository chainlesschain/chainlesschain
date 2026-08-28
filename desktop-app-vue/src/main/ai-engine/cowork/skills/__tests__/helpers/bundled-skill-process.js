import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createBundledSkillProcessBroker,
} = require("../../bundled-skill-process-broker.js");

export function createTestProcessContext(
  skillId,
  executeFileSync,
  options = {},
) {
  const allowedRoots = options.allowedRoots || [process.cwd()];
  const processBroker = createBundledSkillProcessBroker(
    {
      skillId,
      authorityId: options.authorityId || `test:${skillId}:process`,
      allowedRoots,
      allowedEntrypoints: options.allowedEntrypoints || [],
      approvedInvocations: options.approvedInvocations || [],
    },
    {
      executeFileSync,
      auditSink: options.auditSink || (() => {}),
    },
  );
  return { processBroker };
}
