"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const {
  createEvolvableArtifactRuntimeComposition,
  isEvolvableArtifactRuntimeComposition,
  getEvolvableArtifactRuntimeDependencies,
} = require("@chainlesschain/session-core/evolvable-artifact");

const DEV_LOADER_REL =
  "../../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js";

function resolveLoaderPath({ isPackaged = false, resourcesPath } = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error("packaged evolution deployment requires resourcesPath");
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/evolution-deployment-loader.js",
    );
  }
  return path.resolve(__dirname, DEV_LOADER_REL);
}

async function loadDesktopEvolutionDependencies({
  isPackaged = false,
  resourcesPath,
  importLoader = (url) => import(url),
  loaderOptions = {},
} = {}) {
  const loaderPath = resolveLoaderPath({ isPackaged, resourcesPath });
  const loader = await importLoader(pathToFileURL(loaderPath).href);
  if (typeof loader.loadEvolutionDeploymentCommandDependencies !== "function") {
    throw new Error("evolution deployment loader is invalid");
  }
  const result = await loader.loadEvolutionDeploymentCommandDependencies(
    "desktop",
    {
      ...loaderOptions,
      additionalFactories: Object.freeze({
        createEvolvableArtifactRuntimeComposition,
      }),
    },
  );
  if (result === null) {
    return Object.freeze({});
  }

  const composition = result.evolvableArtifactRuntimeComposition;
  if (!isEvolvableArtifactRuntimeComposition(composition)) {
    throw new Error(
      "desktop evolution deployment must return a branded runtime composition",
    );
  }
  const dependencies = getEvolvableArtifactRuntimeDependencies(composition);
  for (const type of ["Skill", "Prompt", "Hook"]) {
    if (!dependencies[`evolvableArtifact${type}ActiveReleaseReader`]) {
      throw new Error(
        `desktop evolution deployment is missing ${type} runtime`,
      );
    }
  }
  return dependencies;
}

module.exports = {
  loadDesktopEvolutionDependencies,
  resolveLoaderPath,
};
