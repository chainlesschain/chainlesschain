"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

const HOSTS = new WeakSet();

async function createDesktopGovernedSkillMarketplaceHost(
  host,
  {
    isPackaged = false,
    resourcesPath,
    importHostModule = (url) => import(url),
  } = {},
) {
  if (isPackaged && (typeof resourcesPath !== "string" || !resourcesPath)) {
    throw new Error("packaged marketplace requires resourcesPath");
  }
  const modulePath = isPackaged
    ? path.join(
        resourcesPath,
        "packages/cli/src/lib/evolution/governed-skill-marketplace-cli-host.js",
      )
    : path.resolve(
        __dirname,
        "../../../../packages/cli/src/lib/evolution/governed-skill-marketplace-cli-host.js",
      );
  const { isGovernedSkillMarketplaceCliHost } = await importHostModule(
    pathToFileURL(modulePath).href,
  );
  if (
    !isGovernedSkillMarketplaceCliHost(host) ||
    host.target.tool !== "desktop"
  ) {
    throw new TypeError(
      "Desktop marketplace requires a branded host with a fixed desktop target",
    );
  }
  const methods = {};
  for (const name of [
    "inspect",
    "install",
    "state",
    "list",
    "rollout",
    "revoke",
  ]) {
    methods[name] = host[name].bind(host);
  }
  const facade = Object.freeze({
    tenantId: host.tenantId,
    target: host.target,
    ...methods,
  });
  HOSTS.add(facade);
  return facade;
}

function isDesktopGovernedSkillMarketplaceHost(value) {
  return HOSTS.has(value);
}

module.exports = {
  createDesktopGovernedSkillMarketplaceHost,
  isDesktopGovernedSkillMarketplaceHost,
};
