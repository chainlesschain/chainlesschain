// TEST ONLY: genuine files and test HMAC retained v2 authorities; no production
// key custody, WORM guarantee or physical power-loss claim.
import fs from "node:fs";
import path from "node:path";
import { openLedgerV2Fixture } from "./evolution-ledger-v2-store.js";
import { createRrsiRegistryStorePolicy } from "../../src/lib/evolution/rrsi-registry-store-policy.js";

const [root, mode, operationId] = process.argv.slice(2);
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
const store = openLedgerV2Fixture(path.join(root, "store"), scope);
const policy = createRrsiRegistryStorePolicy({
  backend: store.backend,
  artifactPorts: store.artifactPorts,
  ledgerArtifactResolver: store.resolver,
  descriptor: { ...scope, purpose: "evolution-ledger" },
});
if (mode === "hold-second-marker") {
  const link = fs.linkSync;
  fs.linkSync = (source, target) => {
    if (
      path.basename(target) === "_tenant.json" &&
      target.includes(`${path.sep}release${path.sep}`)
    ) {
      fs.writeFileSync(
        path.join(root, "ready.json"),
        JSON.stringify({ pid: process.pid, source, target }),
      );
      const deadline = Date.now() + 30_000;
      const waitWord = new Int32Array(new SharedArrayBuffer(4));
      while (!fs.existsSync(path.join(root, "release-owner"))) {
        if (Date.now() > deadline)
          throw new Error("TEST ONLY owner release timed out");
        Atomics.wait(waitWord, 0, 0, 20);
      }
    }
    return link(source, target);
  };
}
try {
  const result = ["provision", "hold-second-marker"].includes(mode)
    ? policy.provisionFresh({
        parentDir: path.join(root, "provisioned"),
        operationId,
      })
    : mode === "recover"
      ? policy.recover(operationId)
      : policy.read(operationId);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(
    JSON.stringify({ code: error.code, message: error.message }),
  );
  process.exitCode = 2;
}
