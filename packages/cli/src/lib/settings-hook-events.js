import { runHooks } from "./hook-runner.js";
import events from "./settings-hook-events.cjs";

events._deps.runHooks = runHooks;

export const {
  withDeliveryId,
  runUserPromptSubmitHooks,
  runSessionStartHooks,
  runCwdChangedHooks,
  runWorktreeCreateHooks,
  runWorktreeRemoveHooks,
  runInstructionsLoadedHooks,
  runObserveHooks,
  aggregateContext,
  partitionAsyncHooks,
  dispatchAsyncHooks,
} = events;

export default events;
