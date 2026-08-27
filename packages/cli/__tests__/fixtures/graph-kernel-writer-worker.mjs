import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";
import { createGraphAuthorityBinding } from "../../src/lib/graph-kernel/authority.js";
import { JsonlRolloutStore } from "../../src/lib/app-server/rollout-store.js";

const [directory, runId, writerId, writerLeaseId, generationText] =
  process.argv.slice(2);
const authorityGeneration = Number(generationText);

try {
  const eventStore = new GraphEventStore({
    rolloutStore: new JsonlRolloutStore({ directory }),
  });
  const events = eventStore.read(runId);
  const latest = events.at(-1);
  const previous = [...events]
    .reverse()
    .find((event) => event.payload?.state?.authority)?.payload
    ?.state?.authority;
  const now = Date.now;
  const kernel = new GraphKernel({
    eventStore,
    now,
    writerId,
    writerLeaseId,
    authoritySource: previous.authoritySource,
    authorityGeneration,
  });
  const projection = kernel.recoverRun(runId, {
    authority: createGraphAuthorityBinding({
      ...previous,
      authorityGeneration,
      writerId,
      writerLeaseId,
      writerLeaseExpiresAt: new Date(now() + 60_000).toISOString(),
      eventHead: latest.hash,
    }),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      writerId,
      generation: projection.authorityGeneration,
      eventHead: projection.eventHead,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      writerId,
      code: error?.code || error?.name || "ERROR",
      message: error?.message || String(error),
    })}\n`,
  );
}
