// TEST ONLY: independent original-journal writer and fresh prefix reconstruction.
import {
  openObservedTextFixture,
  openObservedTextIndex,
} from "./rrsi-observed-text.js";
import { v2FixtureDomainEvent } from "./evolution-ledger-v2-store.js";
import { verifyRrsiTenantIndexAnchorHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
try {
  const value = openObservedTextFixture(process.argv[2]);
  if (process.argv[3] === "append") {
    value.store.journal.appendDomainEvent(
      v2FixtureDomainEvent(value.store, "independent-prefix-writer"),
    );
    process.stdout.write(JSON.stringify(value.store.journal.verify()));
  } else {
    const packets = JSON.parse(process.argv[4]);
    const index = openObservedTextIndex(value);
    process.stdout.write(
      JSON.stringify(
        verifyRrsiTenantIndexAnchorHistory({
          observedTextIndex: index,
          previous: packets.previous,
          current: packets.current,
        }),
      ),
    );
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      causeCode: error.cause?.code,
    }),
  );
  process.exitCode = 2;
}
