import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import { FormalBudgetLineageRegistry } from "../src/lib/formal-budget-lineage-registry.js";
import { NOW, body, verifyFixtureEvidence } from "./formal-budget-fixture.mjs";

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// Synthetic test sink only: sharing a temporary directory does not establish
// independent production storage, authentication or rollback protection.
if (input.checkpointFile) {
  input.registry.checkpointHost = {
    id: input.registry.checkpointHostId,
    load() {
      return JSON.parse(fs.readFileSync(input.checkpointFile, "utf8"));
    },
    publish(checkpoint, checkpointDigest) {
      const heads = this.load().filter(
        (c) => c.head.lineage_id !== checkpoint.head.lineage_id,
      );
      heads.push(checkpoint);
      // Readers in a second process must see a whole synthetic checkpoint.
      const temporary = `${input.checkpointFile}.${process.pid}.${randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify(heads));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, input.checkpointFile);
      return { durable: true, checkpointDigest };
    },
  };
}
let registry, authority;
try {
  registry = new FormalBudgetLineageRegistry(input.registry);
  authority = new FormalBudgetAuthority({
    ...input.authority,
    lineageRegistry: registry,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
  });
  if (input.pause) {
    const coordinate = registry.coordinate.bind(registry);
    registry.coordinate = (binding, operation) =>
      coordinate(binding, (lease) => {
        const advance = lease.advance;
        lease.advance = (digest) => {
          if (input.pause === "after-head") advance(digest);
          process.send({ stage: input.pause });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
          throw new Error("Fault fixture was not terminated");
        };
        return operation(lease);
      });
  }
  authority.reserve({ runId: "initial", callId: process.argv[3], body });
  process.send?.({ ok: true });
} catch (error) {
  process.send?.({ ok: false, code: error.code || error.name });
} finally {
  authority?.close();
  registry?.close();
}
