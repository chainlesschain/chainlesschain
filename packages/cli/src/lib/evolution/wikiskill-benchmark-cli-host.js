import { types as utilTypes } from "node:util";

import {
  projectWikiSkillBenchmarkClaim,
  verifyWikiSkillBenchmarkPlan,
} from "./wikiskill-benchmark.js";
import {
  executeWikiSkillBenchmarkProduction,
  isWikiSkillBenchmarkDatasetProvider,
  isWikiSkillBenchmarkGrader,
  isWikiSkillBenchmarkReportAttestor,
  isWikiSkillBenchmarkRunner,
  verifyWikiSkillBenchmarkExecutionBinding,
} from "./wikiskill-benchmark-execution-host.js";
import { isWikiSkillBenchmarkLedgerAdapter } from "./wikiskill-benchmark-ledger-adapter.js";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function" ||
    utilTypes.isProxy(owner[method])
  ) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return owner[method].bind(owner);
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function timestamp(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} is required`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new TypeError(`${label} must be a canonical timestamp`);
  return value;
}

export class WikiSkillBenchmarkCliHost {
  constructor({
    datasetProvider,
    runner,
    grader,
    reportAttestor,
    ledgerAdapter,
    now = () => Date.now(),
  } = {}) {
    if (!isWikiSkillBenchmarkLedgerAdapter(ledgerAdapter))
      throw new TypeError("WikiSkillBenchmarkLedgerAdapter is required");
    if (
      !isWikiSkillBenchmarkDatasetProvider(datasetProvider) ||
      !isWikiSkillBenchmarkRunner(runner) ||
      !isWikiSkillBenchmarkGrader(grader) ||
      !isWikiSkillBenchmarkReportAttestor(reportAttestor)
    )
      throw new TypeError(
        "all branded WikiSkill Benchmark providers are required",
      );
    if (typeof now !== "function" || utilTypes.isProxy(now))
      throw new TypeError("benchmark trusted clock is required");
    this._datasetProvider = datasetProvider;
    this._runner = runner;
    this._grader = grader;
    this._reportAttestor = reportAttestor;
    this._load = capture(ledgerAdapter, "load", "ledgerAdapter");
    this._commit = capture(ledgerAdapter, "commit", "ledgerAdapter");
    this._verifyReportAttestation = capture(
      reportAttestor,
      "verifyAttestation",
      "reportAttestor",
    );
    this._now = now;
    HOSTS.add(this);
    Object.freeze(this);
  }

  async run(input = {}) {
    exact(
      input,
      ["plan", "executionManifest", "effectiveAt"],
      "benchmark run request",
    );
    const { plan, executionManifest, effectiveAt } = input;
    const binding = verifyWikiSkillBenchmarkExecutionBinding({
      plan,
      executionManifest,
    });
    const timestampValue = timestamp(
      effectiveAt ?? new Date(this._now()).toISOString(),
      "effectiveAt",
    );
    const produced = await executeWikiSkillBenchmarkProduction({
      plan: binding.plan,
      executionManifest: binding.executionManifest,
      datasetProvider: this._datasetProvider,
      runner: this._runner,
      grader: this._grader,
      reportAttestor: this._reportAttestor,
    });
    const committed = await this._commit({
      plan: binding.plan,
      executionManifest: binding.executionManifest,
      envelope: produced.envelope,
      effectiveAt: timestampValue,
    });
    const durable = await this._load(produced.report.reportDigest);
    if (
      durable?.plan?.planDigest !== binding.plan.planDigest ||
      durable.executionManifest?.manifestDigest !==
        binding.executionManifest.manifestDigest ||
      durable.envelope?.report?.reportDigest !== produced.report.reportDigest
    ) {
      throw new Error("benchmark bundle was not durably recoverable");
    }
    const claim = await projectWikiSkillBenchmarkClaim({
      envelope: durable.envelope,
      verifyAttestation: this._verifyReportAttestation,
    });
    return Object.freeze({
      status: claim.status,
      provenance: claim.provenance,
      planDigest: binding.plan.planDigest,
      executionManifestDigest: binding.executionManifest.manifestDigest,
      reportDigest: claim.reportDigest,
      metrics: claim.metrics,
      committed: committed.committed === true,
      recovered: committed.recovered === true,
    });
  }

  async show(reportDigest) {
    if (!DIGEST.test(reportDigest ?? ""))
      throw new TypeError("reportDigest must be a sha256 digest");
    const durable = await this._load(reportDigest);
    if (!durable) return null;
    const plan = verifyWikiSkillBenchmarkPlan(durable.plan);
    verifyWikiSkillBenchmarkExecutionBinding({
      plan,
      executionManifest: durable.executionManifest,
    });
    const claim = await projectWikiSkillBenchmarkClaim({
      envelope: durable.envelope,
      verifyAttestation: this._verifyReportAttestation,
    });
    return Object.freeze({
      status: claim.status,
      provenance: claim.provenance,
      planDigest: plan.planDigest,
      executionManifestDigest: durable.executionManifest.manifestDigest,
      reportDigest: claim.reportDigest,
      metrics: claim.metrics,
      effectiveAt: durable.effectiveAt,
    });
  }
}

export function createWikiSkillBenchmarkCliHost(options) {
  return new WikiSkillBenchmarkCliHost(options);
}

export function isWikiSkillBenchmarkCliHost(value) {
  return Boolean(value && HOSTS.has(value));
}
