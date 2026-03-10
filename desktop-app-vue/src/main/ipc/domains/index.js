/**
 * @module ipc/domains
 * Domain registry - aggregates all IPC domain registrations
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

const domains = {
  core: () => require("./core").registerCoreDomain,
  ai: () => require("./ai").registerAIDomain,
  enterprise: () => require("./enterprise").registerEnterpriseDomain,
  social: () => require("./social").registerSocialDomain,
  security: () => require("./security").registerSecurityDomain,
  p2p: () => require("./p2p").registerP2PDomain,
  infrastructure: () =>
    require("./infrastructure").registerInfrastructureDomain,
  marketplace: () => require("./marketplace").registerMarketplaceDomain,
  autonomous: () => require("./autonomous").registerAutonomousDomain,
  evomap: () => require("./evomap").registerEvomapDomain,
};

function registerAllDomains(deps) {
  const results = {};
  for (const [name, getRegister] of Object.entries(domains)) {
    try {
      const register = getRegister();
      register(deps);
      results[name] = { success: true };
    } catch (error) {
      logger.error(`[IPC:Domains] Failed to register ${name}:`, error.message);
      results[name] = { success: false, error: error.message };
    }
  }
  return results;
}

module.exports = { registerAllDomains, domains };
