import fs from "node:fs";
import path from "node:path";
import {
  createLedgerV2FixtureBackend,
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
} from "../../fixtures/evolution-ledger-v2-store.js";

const [root, mode = "read"] = process.argv.slice(2);
if (mode === "manifest-only") {
  const request = JSON.parse(
    fs.readFileSync(path.join(root, "manifest-request.json"), "utf8"),
  );
  const { backend } = createLedgerV2FixtureBackend(root, request);
  process.stdout.write(JSON.stringify(backend.readEvents()));
  process.exit(0);
}
let witnessed = 0;
let armed = false;
const fixture = openLedgerV2Fixture(root, {
  ...(mode === "read-slash"
    ? {
        tenantId: "tenant/compat",
        artifactTenantId: "artifacts/compat",
        audience: "evolution/runtime",
      }
    : {}),
  crashHook(phase) {
    if (phase !== "after-witness") return;
    witnessed++;
    if (
      (mode === "crash-intent" && witnessed === 1) ||
      (mode === "crash-completed" && witnessed === 2) ||
      (mode === "crash-live-wal" && armed)
    )
      process.exit(73);
  },
  fault(phase) {
    if (armed && mode === "crash-live-manifest" && phase === "after-witness")
      process.exit(74);
  },
});
armed = true;
if (mode.startsWith("crash-live-")) {
  fixture.journal.finalizeDomainEventBatch([
    v2FixtureDomainEvent(fixture, "child-live-one"),
    v2FixtureDomainEvent(fixture, "child-live-two"),
  ]);
  throw new Error("expected injected process exit");
}
process.stdout.write(
  JSON.stringify({
    events: fixture.journal.read(),
    checkpoint: fixture.manifest.backend.read(),
  }),
);
