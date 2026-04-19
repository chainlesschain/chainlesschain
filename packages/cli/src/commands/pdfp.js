/**
 * PDF Parser V2 governance commands — `cc pdfp ...`
 * 在内存中治理 PDFP profile (pending/active/stale/archived) + parse 生命周期。
 */
import {
  PDFP_PROFILE_MATURITY_V2,
  PDFP_PARSE_LIFECYCLE_V2,
  registerPdfpProfileV2,
  activatePdfpProfileV2,
  stalePdfpProfileV2,
  archivePdfpProfileV2,
  touchPdfpProfileV2,
  getPdfpProfileV2,
  listPdfpProfilesV2,
  createPdfpParseV2,
  parsingPdfpParseV2,
  parsePdfpParseV2,
  failPdfpParseV2,
  cancelPdfpParseV2,
  getPdfpParseV2,
  listPdfpParsesV2,
  setMaxActivePdfpProfilesPerOwnerV2,
  getMaxActivePdfpProfilesPerOwnerV2,
  setMaxPendingPdfpParsesPerProfileV2,
  getMaxPendingPdfpParsesPerProfileV2,
  setPdfpProfileIdleMsV2,
  getPdfpProfileIdleMsV2,
  setPdfpParseStuckMsV2,
  getPdfpParseStuckMsV2,
  autoStaleIdlePdfpProfilesV2,
  autoFailStuckPdfpParsesV2,
  getPdfParserGovStatsV2,
} from "../lib/pdf-parser.js";

export function registerPdfpCommand(program) {
  const p = program
    .command("pdfp")
    .description("PDF Parser V2 governance (in-memory, CLI v0.143.0)");

  p.command("enums-v2").action(() => console.log(JSON.stringify({ PDFP_PROFILE_MATURITY_V2, PDFP_PARSE_LIFECYCLE_V2 }, null, 2)));
  p.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--encoding <encoding>", "encoding", "utf-8")
    .action((o) => console.log(JSON.stringify(registerPdfpProfileV2(o), null, 2)));
  p.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activatePdfpProfileV2(id), null, 2)));
  p.command("stale-profile-v2 <id>").action((id) => console.log(JSON.stringify(stalePdfpProfileV2(id), null, 2)));
  p.command("archive-profile-v2 <id>").action((id) => console.log(JSON.stringify(archivePdfpProfileV2(id), null, 2)));
  p.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchPdfpProfileV2(id), null, 2)));
  p.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getPdfpProfileV2(id), null, 2)));
  p.command("list-profiles-v2").action(() => console.log(JSON.stringify(listPdfpProfilesV2(), null, 2)));

  p.command("create-parse-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--path <path>", "pdf path", "")
    .action((o) => console.log(JSON.stringify(createPdfpParseV2(o), null, 2)));
  p.command("parsing-parse-v2 <id>").action((id) => console.log(JSON.stringify(parsingPdfpParseV2(id), null, 2)));
  p.command("parse-parse-v2 <id>").action((id) => console.log(JSON.stringify(parsePdfpParseV2(id), null, 2)));
  p.command("fail-parse-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(failPdfpParseV2(id, o.reason), null, 2)));
  p.command("cancel-parse-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(cancelPdfpParseV2(id, o.reason), null, 2)));
  p.command("get-parse-v2 <id>").action((id) => console.log(JSON.stringify(getPdfpParseV2(id), null, 2)));
  p.command("list-parses-v2").action(() => console.log(JSON.stringify(listPdfpParsesV2(), null, 2)));

  p.command("config-v2").action(() => console.log(JSON.stringify({
    maxActivePdfpProfilesPerOwner: getMaxActivePdfpProfilesPerOwnerV2(),
    maxPendingPdfpParsesPerProfile: getMaxPendingPdfpParsesPerProfileV2(),
    pdfpProfileIdleMs: getPdfpProfileIdleMsV2(),
    pdfpParseStuckMs: getPdfpParseStuckMsV2(),
  }, null, 2)));
  p.command("set-max-active-profiles-v2 <n>").action((n) => { setMaxActivePdfpProfilesPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActivePdfpProfilesPerOwner: getMaxActivePdfpProfilesPerOwnerV2() }, null, 2)); });
  p.command("set-max-pending-parses-v2 <n>").action((n) => { setMaxPendingPdfpParsesPerProfileV2(Number(n)); console.log(JSON.stringify({ maxPendingPdfpParsesPerProfile: getMaxPendingPdfpParsesPerProfileV2() }, null, 2)); });
  p.command("set-profile-idle-ms-v2 <ms>").action((ms) => { setPdfpProfileIdleMsV2(Number(ms)); console.log(JSON.stringify({ pdfpProfileIdleMs: getPdfpProfileIdleMsV2() }, null, 2)); });
  p.command("set-parse-stuck-ms-v2 <ms>").action((ms) => { setPdfpParseStuckMsV2(Number(ms)); console.log(JSON.stringify({ pdfpParseStuckMs: getPdfpParseStuckMsV2() }, null, 2)); });
  p.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdlePdfpProfilesV2(), null, 2)));
  p.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckPdfpParsesV2(), null, 2)));
  p.command("gov-stats-v2").action(() => console.log(JSON.stringify(getPdfParserGovStatsV2(), null, 2)));
}
