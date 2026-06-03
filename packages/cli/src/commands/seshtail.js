/**
 * `cc seshtail` — Session Tail V2 governance overlay (in-memory, atop lib/session-tail.js).
 */
import {
  STAIL_SUB_MATURITY_V2,
  STAIL_EVENT_LIFECYCLE_V2,
  setMaxActiveStailSubsPerOwnerV2,
  getMaxActiveStailSubsPerOwnerV2,
  setMaxPendingStailEventsPerSubV2,
  getMaxPendingStailEventsPerSubV2,
  setStailSubIdleMsV2,
  getStailSubIdleMsV2,
  setStailEventStuckMsV2,
  getStailEventStuckMsV2,
  registerStailSubV2,
  activateStailSubV2,
  pauseStailSubV2,
  closeStailSubV2,
  touchStailSubV2,
  getStailSubV2,
  listStailSubsV2,
  createStailEventV2,
  tailingStailEventV2,
  completeStailEventV2,
  failStailEventV2,
  cancelStailEventV2,
  getStailEventV2,
  listStailEventsV2,
  autoPauseIdleStailSubsV2,
  autoFailStuckStailEventsV2,
  getSessionTailGovStatsV2,
  _resetStateSessionTailV2,
} from "../lib/session-tail.js";

export function registerSeshtailCommand(program) {
  const st = program
    .command("seshtail")
    .description("Session Tail V2 governance");
  st.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          subMaturity: STAIL_SUB_MATURITY_V2,
          eventLifecycle: STAIL_EVENT_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  st.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveStailSubsPerOwner: getMaxActiveStailSubsPerOwnerV2(),
          maxPendingStailEventsPerSub: getMaxPendingStailEventsPerSubV2(),
          stailSubIdleMs: getStailSubIdleMsV2(),
          stailEventStuckMs: getStailEventStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  st.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveStailSubsPerOwnerV2(Number(n));
    console.log("ok");
  });
  st.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingStailEventsPerSubV2(Number(n));
    console.log("ok");
  });
  st.command("set-idle-ms-v2 <n>").action((n) => {
    setStailSubIdleMsV2(Number(n));
    console.log("ok");
  });
  st.command("set-stuck-ms-v2 <n>").action((n) => {
    setStailEventStuckMsV2(Number(n));
    console.log("ok");
  });
  st.command("register-sub-v2 <id> <owner>")
    .option("--sessionId <s>", "sessionId")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerStailSubV2({ id, owner, sessionId: o.sessionId }),
          null,
          2,
        ),
      ),
    );
  st.command("activate-sub-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateStailSubV2(id), null, 2)),
  );
  st.command("pause-sub-v2 <id>").action((id) =>
    console.log(JSON.stringify(pauseStailSubV2(id), null, 2)),
  );
  st.command("close-sub-v2 <id>").action((id) =>
    console.log(JSON.stringify(closeStailSubV2(id), null, 2)),
  );
  st.command("touch-sub-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchStailSubV2(id), null, 2)),
  );
  st.command("get-sub-v2 <id>").action((id) =>
    console.log(JSON.stringify(getStailSubV2(id), null, 2)),
  );
  st.command("list-subs-v2").action(() =>
    console.log(JSON.stringify(listStailSubsV2(), null, 2)),
  );
  st.command("create-event-v2 <id> <subId>")
    .option("--cursor <c>", "cursor")
    .action((id, subId, o) =>
      console.log(
        JSON.stringify(
          createStailEventV2({ id, subId, cursor: o.cursor }),
          null,
          2,
        ),
      ),
    );
  st.command("tailing-event-v2 <id>").action((id) =>
    console.log(JSON.stringify(tailingStailEventV2(id), null, 2)),
  );
  st.command("complete-event-v2 <id>").action((id) =>
    console.log(JSON.stringify(completeStailEventV2(id), null, 2)),
  );
  st.command("fail-event-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failStailEventV2(id, reason), null, 2)),
  );
  st.command("cancel-event-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelStailEventV2(id, reason), null, 2)),
  );
  st.command("get-event-v2 <id>").action((id) =>
    console.log(JSON.stringify(getStailEventV2(id), null, 2)),
  );
  st.command("list-events-v2").action(() =>
    console.log(JSON.stringify(listStailEventsV2(), null, 2)),
  );
  st.command("auto-pause-idle-v2").action(() =>
    console.log(JSON.stringify(autoPauseIdleStailSubsV2(), null, 2)),
  );
  st.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckStailEventsV2(), null, 2)),
  );
  st.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getSessionTailGovStatsV2(), null, 2)),
  );
  st.command("reset-state-v2").action(() => {
    _resetStateSessionTailV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
