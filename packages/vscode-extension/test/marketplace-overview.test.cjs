const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

function overview({
  extensionVersion = "0.37.79",
  cliVersion = "0.166.10",
} = {}) {
  const vsixUrl =
    `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/${extensionVersion}` +
    `/file/chainlesschain.chainlesschain-ide-${extensionVersion}.vsix`;

  return `# ChainlessChain IDE Bridge for VS Code

Canonical extension description.

## Current release

| VS Code extension         | **${extensionVersion}**; immutable release |
| Recommended CLI           | **\`chainlesschain@${cliVersion}\`** public npm release |

CLI \`${cliVersion}\` is the recommended public release.

## Highlights

Tag ide-vscode-v${extensionVersion}
Download ${vsixUrl}
Install npm i -g chainlesschain@${cliVersion}
Using \`@${cliVersion}\`
Artifact chainlesschain-ide-${extensionVersion}.vsix
`;
}

async function verifier() {
  return import("../scripts/verify-marketplace-overview.mjs");
}

test("keeps the checked-in Marketplace overview coherent with the release manifests", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const read = (path) => readFileSync(resolve(__dirname, path), "utf8");

  verifyMarketplaceOverview({
    extensionManifest: JSON.parse(read("../package.json")),
    cliManifest: JSON.parse(read("../../cli/package.json")),
    readme: read("../README.md"),
  });
});

function manifests({ recommended = "0.166.10", source = "0.166.16" } = {}) {
  return {
    extensionManifest: {
      name: "chainlesschain-ide",
      version: "0.37.79",
      description: "Canonical extension description.",
      chainlesschain: { recommendedCliVersion: recommended },
    },
    cliManifest: { name: "chainlesschain", version: source },
  };
}

test("keeps the public recommendation independent from a newer source candidate", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const result = verifyMarketplaceOverview({
    ...manifests(),
    readme: overview(),
  });

  assert.equal(result.cliVersion, "0.166.10");
  assert.equal(result.sourceCliVersion, "0.166.16");
});

test("rejects a recommendation newer than the checked-out source candidate", async () => {
  const { verifyMarketplaceOverview } = await verifier();

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests({ recommended: "0.166.17", source: "0.166.16" }),
        readme: overview({ cliVersion: "0.166.17" }),
      }),
    /cannot be newer/u,
  );
});

test("rejects README metadata that drifts from the declared recommendation", async () => {
  const { verifyMarketplaceOverview } = await verifier();

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests(),
        readme: overview({ cliVersion: "0.166.6" }),
      }),
    /missing current release metadata/u,
  );
});
