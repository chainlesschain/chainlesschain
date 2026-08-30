const assert = require("node:assert/strict");
const test = require("node:test");

function overview({
  extensionVersion = "0.37.76",
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

function manifests({ recommended = "0.166.10", source = "0.166.14" } = {}) {
  return {
    extensionManifest: {
      name: "chainlesschain-ide",
      version: "0.37.76",
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
  assert.equal(result.sourceCliVersion, "0.166.14");
});

test("rejects a recommendation newer than the checked-out source candidate", async () => {
  const { verifyMarketplaceOverview } = await verifier();

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests({ recommended: "0.166.15", source: "0.166.14" }),
        readme: overview({ cliVersion: "0.166.15" }),
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
