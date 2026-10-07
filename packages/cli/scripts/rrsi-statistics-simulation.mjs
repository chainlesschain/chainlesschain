import {
  buildRrsiStatisticsSimulationPlan,
  runRrsiStatisticsSimulation,
} from "../src/lib/evolution/rrsi-statistics-simulation.js";
import { rrsiHash } from "../src/lib/evolution/rrsi-data.js";
import {
  RRSI_BOUNDED_CLUSTER_METHOD,
  RRSI_CLUSTER_ENVELOPE_METHOD,
} from "../src/lib/evolution/rrsi-group-statistics.js";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (
  args[0] !== "--demo" ||
  ![1, 3].includes(args.length) ||
  (args.length === 3 && (args[1] !== "--output" || !args[2]))
) {
  process.stderr.write(
    "Usage: rrsi-statistics-simulation.mjs --demo [--output path]\n",
  );
  process.exitCode = 1;
} else {
  const shared = {
    comparisonCount: 2,
    familyAlpha: 0.05,
    qualityThreshold: 0.05,
    targetPower: 0.8,
    randomnessSeedDigest: rrsiHash(
      "rrsi-synthetic-coverage-seed/v1",
      "TEST ONLY fixed development grid",
    ),
  };
  const plans = [
    buildRrsiStatisticsSimulationPlan({
      ...shared,
      intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
      bootstrapSamples: 2000,
      trialCount: 100,
      clusterCounts: [20, 100],
    }),
    buildRrsiStatisticsSimulationPlan({
      ...shared,
      intervalMethod: RRSI_BOUNDED_CLUSTER_METHOD,
      bootstrapSamples: null,
      trialCount: 2000,
      clusterCounts: [20, 40, 100, 400],
    }),
  ];
  const result = {
    scope: "TEST ONLY synthetic development grids",
    simulations: plans.map((plan) => ({
      plan,
      report: runRrsiStatisticsSimulation(plan),
    })),
  };
  if (args.length === 3) {
    writeFileSync(args[2], `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(
      `${JSON.stringify(result.simulations.map(({ plan, report }) => ({ method: plan.intervalMethod, operations: plan.operations, status: report.status, planDigest: plan.simulationPlanDigest, reportDigest: report.simulationReportDigest })))}\n`,
    );
  } else process.stdout.write(`${JSON.stringify(result)}\n`);
}
