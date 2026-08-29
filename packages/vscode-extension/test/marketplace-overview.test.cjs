const assert = require("node:assert/strict");
const test = require("node:test");

function overview({
  extensionVersion = "0.37.73",
  cliVersion = "0.166.9",
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

function manifests({ recommended = "0.166.9", source = "0.166.9" } = {}) {
  return {
    extensionManifest: {
      name: "chainlesschain-ide",
      version: "0.37.73",
      description: "Canonical extension description.",
      chainlesschain: { recommendedCliVersion: recommended },
    },
    cliManifest: { name: "chainlesschain", version: source },
  };
}

test("keeps the public recommendation aligned with the release candidate", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const result = verifyMarketplaceOverview({
    ...manifests(),
    readme: overview(),
  });

  assert.equal(result.cliVersion, "0.166.9");
  assert.equal(result.sourceCliVersion, "0.166.9");
});

test("rejects a recommendation newer than the checked-out source candidate", async () => {
  const { verifyMarketplaceOverview } = await verifier();

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests({ recommended: "0.166.10", source: "0.166.9" }),
        readme: overview({ cliVersion: "0.166.10" }),
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
        readme: overview({ cliVersion: "0.166.7" }),
      }),
    /missing current release metadata/u,
  );
});
