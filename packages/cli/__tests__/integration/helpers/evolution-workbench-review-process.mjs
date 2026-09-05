import {
  openWorkbenchReviewStore,
  responseFor,
  NOW,
} from "../../fixtures/evolution-workbench-review.js";
import {
  buildWorkbenchBatchItemRequest,
  buildWorkbenchExecutionItem,
} from "../../../src/lib/evolution/evolution-workbench-review-protocol.js";
const [root, mode, phase] = process.argv.slice(2);
const h = openWorkbenchReviewStore(root, {
  now: () => (mode === "seed" || phase === "prepared" ? NOW : NOW + 700_000),
});
let resumed = [];
if (mode === "seed") {
  const { plan, packets } = await h.seed(phase === "first-committed" ? 2 : 1);
  const packet = packets.find(
    (value) => value.packetDigest === plan.packetDigests[0],
  );
  const request = buildWorkbenchBatchItemRequest(plan, packet);
  const response = responseFor(packet, request);
  await h.adapter.prepareDecision({ plan, request, response });
  if (phase !== "prepared")
    await h.adapter.retainDecision({
      plan,
      request,
      response,
      packetDigest: packet.packetDigest,
      decision: response.decision,
    });
  if (phase === "first-committed")
    await h.adapter.commitExecutionItem({
      plan,
      request,
      response,
      item: buildWorkbenchExecutionItem(request, response),
    });
  await new Promise((resolve) =>
    process.stdout.write(
      JSON.stringify({ pid: process.pid, checkpoint: phase }),
      resolve,
    ),
  );
  // Abrupt process death after the selected durable boundary: no finally or
  // normal adapter shutdown. Recovery gets only the independent store files.
  process.kill(process.pid, "SIGKILL");
} else if (mode === "resume") resumed = await h.adapter.resume();
else if (mode !== "inspect") throw new Error("unknown test mode");
if (mode !== "seed") {
  const events = h.backend.ledger.read();
  const count = (type) => events.filter((event) => event.type === type).length;
  const reviews = await h.reviewAdapter.listReviews();
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      sequence: h.backend.ledger.verify().sequence,
      asks: h.asks.length,
      resumed: resumed.length,
      items: resumed[0]?.items.length ?? 0,
      prepared: count("evolution.workbench.review.prepared"),
      decisions: count("skill.promotion-review.decided"),
      committed: count("evolution.workbench.review.committed"),
      decisionDigests: reviews.map(
        ({ decision }) => decision?.receiptDigest ?? null,
      ),
    }),
  );
}
