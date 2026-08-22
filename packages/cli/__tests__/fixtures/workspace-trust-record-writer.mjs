import { recordWorkspaceTrustConsent } from "../../src/lib/workspace-trust.js";

const [workspaceRoot, storePath, subject] = process.argv.slice(2);

recordWorkspaceTrustConsent({
  workspaceRoot,
  storePath,
  source: "fixture",
  subject,
  evidenceFingerprint: `fixture:${subject}`,
  consent: "explicit",
});
