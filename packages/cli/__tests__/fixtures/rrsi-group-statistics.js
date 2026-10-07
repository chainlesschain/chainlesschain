/** Synthetic outcome claims, not authenticated execution or billing evidence. */
import { buildRrsiCampaign } from "../../src/lib/evolution/rrsi-contracts.js";
import { buildRrsiGroupStatisticsPlan } from "../../src/lib/evolution/rrsi-group-statistics.js";
import { rrsiCampaignInput, rrsiFixtureDigest } from "./rrsi-shadow-fixture.js";

export function rrsiStatisticsFixture({
  stage = "selection",
  campaignInput = null,
  passed = null,
} = {}) {
  const campaign = buildRrsiCampaign(campaignInput ?? rrsiCampaignInput());
  const versions = Object.fromEntries(
    campaign.experiment.arms.map((arm) => [
      arm,
      rrsiFixtureDigest(`TEST ONLY frozen ${arm} artifact`),
    ]),
  );
  const plan = buildRrsiGroupStatisticsPlan({ campaign, stage, versions });
  const rows = plan.pools.flatMap((pool) =>
    pool.components.flatMap((group) =>
      group.taskIds.flatMap((taskId) =>
        plan.seeds.flatMap((seed) =>
          Object.keys(versions).flatMap((arm) =>
            plan.variants.map((variant) => ({
              taskId,
              seed,
              arm,
              versionDigest: versions[arm],
              variant,
              outcome: "succeeded",
              passed: passed
                ? passed({ taskId, seed, arm, variant })
                : arm === "rrsi",
              manualRemediation: false,
              resultDigest: rrsiFixtureDigest(
                `TEST ONLY result ${taskId}/${seed}/${arm}/${variant}`,
              ),
            })),
          ),
        ),
      ),
    ),
  );
  return { campaign, plan, rows, versions };
}
