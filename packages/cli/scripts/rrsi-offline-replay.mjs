#!/usr/bin/env node
// Repository-only synthetic replay. Does not load a deployment or provider.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { readBoundedDescriptor } from "../src/lib/evolution/bounded-descriptor-read.js";
import { verifyRrsiCampaign } from "../src/lib/evolution/rrsi-contracts.js";
import { replayRrsiSelection } from "../src/lib/evolution/rrsi-selector.js";

const HELP = `RRSI offline synthetic replay (repository checkout only).
node packages/cli/scripts/rrsi-offline-replay.mjs --demo
node packages/cli/scripts/rrsi-offline-replay.mjs --input replay.json --campaign-digest sha256:...

Inputs are bounded UTF-8 JSON, at most 2 MiB. JSON is written to stdout.
Save the campaign digest independently before collecting replay inputs.
All aggregate observations are synthetic; consistency is not authentication.
Exit 0: shadow-selected. Exit 2: HOLD. Exit 1: invalid input.
No exit code grants model execution, Pilot, or promotion authority.`;

function readInput(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1)
      throw new Error("input must be a regular file");
    const bytes = readBoundedDescriptor(
      fs,
      descriptor,
      stat.size,
      2 * 1024 * 1024,
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    fs.closeSync(descriptor);
  }
}

try {
  const { values, tokens } = parseArgs({
    tokens: true,
    options: {
      help: { type: "boolean" },
      demo: { type: "boolean" },
      input: { type: "string" },
      "campaign-digest": { type: "string" },
    },
  });
  const names = tokens.map((token) => token.name);
  if (new Set(names).size !== names.length) throw new Error("duplicate option");
  if (values.help && names.length === 1) process.stdout.write(`${HELP}\n`);
  else {
    let input;
    if (values.demo && names.length === 1) {
      const { createRrsiShadowFixture } =
        await import("../__tests__/fixtures/rrsi-shadow-fixture.js");
      input = createRrsiShadowFixture();
    } else if (
      values.input &&
      values["campaign-digest"] &&
      names.length === 2
    ) {
      input = readInput(values.input);
      const campaign = verifyRrsiCampaign(input.campaign);
      if (campaign.campaignDigest !== values["campaign-digest"])
        throw new Error("independently supplied campaign digest mismatch");
    } else throw new Error("use --demo or --input with --campaign-digest");
    const report = replayRrsiSelection(input);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === "shadow-selected" ? 0 : 2;
  }
} catch (error) {
  // Inputs can be private; do not echo filenames, task content or provider text.
  process.stderr.write(
    `${JSON.stringify({ code: error.code ?? "CC_RRSI_REPLAY_INVALID", message: "RRSI replay input is invalid" })}\n`,
  );
  process.exitCode = 1;
}
