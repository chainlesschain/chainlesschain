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

<!-- release79-status -->

Open VSX version **${extensionVersion}** pairs with public CLI \`${cliVersion}\`.

| VS Code extension         | **${extensionVersion}**; immutable release |
| Recommended CLI           | **\`chainlesschain@${cliVersion}\`** public npm release |

CLI \`${cliVersion}\` is the recommended public release.

Tag ide-vscode-v${extensionVersion}
Download ${vsixUrl}
Install npm i -g chainlesschain@${cliVersion}
Using \`@${cliVersion}\`
Artifact chainlesschain-ide-${extensionVersion}.vsix

## Highlights
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

function manifests({
  extensionVersion = "0.37.79",
  recommended = "0.166.10",
  source = "0.166.16",
} = {}) {
  return {
    extensionManifest: {
      name: "chainlesschain-ide",
      version: extensionVersion,
      description: "Canonical extension description.",
      chainlesschain: { recommendedCliVersion: recommended },
    },
    cliManifest: { name: "chainlesschain", version: source },
  };
}

function candidateOverview({
  extensionVersion = "0.37.80",
  cliVersion = "0.166.11",
} = {}) {
  return overview().replace(
    "## Current release",
    "## Next release candidate\n\n" +
      `Source candidate **${extensionVersion}** recommends CLI **${cliVersion}**. ` +
      "The extension has not been published; CLI 0.166.11 is available on npm.\n\n" +
      "## Current release",
  );
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

test("checks an unpublished IDE candidate separately from the current public pairing", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const result = verifyMarketplaceOverview({
    ...manifests({ extensionVersion: "0.37.80", recommended: "0.166.11" }),
    readme: candidateOverview(),
  });

  assert.equal(result.extensionVersion, "0.37.80");
  assert.equal(result.cliVersion, "0.166.11");
  assert.equal(result.publicExtensionVersion, "0.37.79");
  assert.equal(result.publicCliVersion, "0.166.10");
});

test("accepts an already published CLI for an unpublished IDE candidate", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const readme = candidateOverview({ cliVersion: "0.166.16" });

  assert.equal(
    verifyMarketplaceOverview({
      ...manifests({ extensionVersion: "0.37.80", recommended: "0.166.16" }),
      readme,
    }).publicExtensionVersion,
    "0.37.79",
  );
});

test("rejects a candidate whose versions differ from the extension manifest", async () => {
  const { verifyMarketplaceOverview } = await verifier();

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests({ extensionVersion: "0.37.81", recommended: "0.166.11" }),
        readme: candidateOverview(),
      }),
    /candidate VS Code version must match/u,
  );
});

test("rejects a candidate recommendation that differs from the extension manifest", async () => {
  const { verifyMarketplaceOverview } = await verifier();

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests({ extensionVersion: "0.37.80", recommended: "0.166.12" }),
        readme: candidateOverview(),
      }),
    /candidate CLI version must match/u,
  );
});

test("rejects a candidate section that claims the IDE is already published", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const readme = candidateOverview().replace(
    "The extension has not been published",
    "The extension has been published",
  );

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...manifests({ extensionVersion: "0.37.80", recommended: "0.166.11" }),
        readme,
      }),
    /has not been published/u,
  );
});

test("rejects a candidate heading duplicated, moved after Current release, or hidden in a fence", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const args = {
    ...manifests({ extensionVersion: "0.37.80", recommended: "0.166.11" }),
    readme: candidateOverview(),
  };

  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...args,
        readme: `${args.readme}\n## Next release candidate\n`,
      }),
    /at most one/u,
  );
  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...args,
        readme:
          overview() +
          "\n## Next release candidate\n\nSource candidate **0.37.80** recommends CLI **0.166.11**. The extension has not been published.\n",
      }),
    /must appear before Current release/u,
  );
  assert.throws(
    () =>
      verifyMarketplaceOverview({
        ...args,
        readme: overview().replace(
          "## Highlights",
          "```md\n## Next release candidate\nSource candidate **0.37.80** recommends CLI **0.166.11**.\n```\n\n## Highlights",
        ),
      }),
    /manifest must match the current public release/u,
  );
});

test("requires the current public pair to agree with its release metadata", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const readme = overview().replace(
    "Open VSX version **0.37.79** pairs with public CLI `0.166.10`.",
    "Open VSX version **0.37.78** pairs with public CLI `0.166.9`.",
  );

  assert.throws(
    () => verifyMarketplaceOverview({ ...manifests(), readme }),
    /Without a candidate section, the extension manifest must match the current public release/u,
  );
});

test("does not infer the current public pair from a historical release", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const readme = overview()
    .replace(
      "Open VSX version **0.37.79** pairs with public CLI `0.166.10`.\n\n",
      "",
    )
    .replace(
      "## Highlights",
      "### Previous verified release\n\n" +
        "Open VSX version **0.37.79** pairs with public CLI `0.166.10`.\n\n" +
        "## Highlights",
    );

  assert.throws(
    () => verifyMarketplaceOverview({ ...manifests(), readme }),
    /must declare its published Open VSX and CLI versions/u,
  );
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
    /Without a candidate section, the recommended CLI must match the current public release/u,
  );
});

test("allows historical release references outside the current overview", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const historicalReadme = overview().replace(
    "\n## Highlights\n",
    "\n### Previous verified release (historical)\n\n" +
      "Tag ide-vscode-v0.37.78.\n" +
      "Artifact https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.78/file/chainlesschain.chainlesschain-ide-0.37.78.vsix.\n" +
      "Install chainlesschain@0.166.9.\n\n" +
      "## Highlights\n",
  );

  verifyMarketplaceOverview({
    ...manifests(),
    readme: historicalReadme,
  });
});

test("rejects historical tags inside the current status block", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const readme = overview().replace(
    "Tag ide-vscode-v0.37.79",
    "Tag ide-vscode-v0.37.79; previous tag ide-vscode-v0.37.78",
  );

  assert.throws(
    () => verifyMarketplaceOverview({ ...manifests(), readme }),
    /stale VS Code release metadata/u,
  );
});

test("requires a nonempty current release status marker", async () => {
  const { verifyMarketplaceOverview } = await verifier();
  const readme = overview().replace("<!-- release79-status -->\n\n", "");

  assert.throws(
    () => verifyMarketplaceOverview({ ...manifests(), readme }),
    /current release status marker/u,
  );
});
