import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import { addSchedule } from "../../src/lib/cowork-cron.js";
import { RoutineStore } from "../../src/lib/routine-store.js";
import {
  buildAgendaSchedulerJob,
  migrateAgendaSchedulerEntry,
} from "../../src/lib/scheduler-kernel/agenda-adapter.js";
import {
  buildCoworkCronSchedulerJob,
  migrateCoworkCronSchedule,
} from "../../src/lib/scheduler-kernel/cowork-cron-adapter.js";
import {
  buildLoopSchedulerJob,
  migrateSavedLoopSession,
} from "../../src/lib/scheduler-kernel/loop-adapter.js";
import {
  ROUTINE_SCHEDULER_CHANNELS,
  buildRoutineSchedulerJob,
  migrateRoutineSchedule,
} from "../../src/lib/scheduler-kernel/routine-adapter.js";
import { canonicalSchedulerSourcePath } from "../../src/lib/scheduler-kernel/source-locator-path.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler migration multi-entry locator guard", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture(name) {
    const root = mkdtempSync(join(tmpdir(), `cc-scheduler-${name}-guard-`));
    const schedulerStore = openSchedulerStore({
      file: join(root, "scheduler.db"),
      Database,
      clock: () => Date.UTC(2026, 7, 13, 8, 0, 0),
    });
    cleanups.push(() => {
      schedulerStore.close();
      rmSync(root, { recursive: true, force: true });
    });
    return { root, schedulerStore };
  }

  function prepareMultiEntryMigration({
    schedulerStore,
    domain,
    sourceId,
    sourceScope,
    targetJob,
  }) {
    const secondTarget = structuredClone(targetJob);
    secondTarget.id = `${targetJob.id}:guard-other`;
    return schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain,
          sourceId,
          sourceScope,
          source: { id: sourceId, definition: "guard-primary" },
          targetJob,
          rollbackStrategy: "disable",
        },
        {
          domain,
          sourceId: `${sourceId}-guard-other`,
          sourceScope,
          source: { id: `${sourceId}-guard-other`, definition: "guard-other" },
          targetJob: secondTarget,
          rollbackStrategy: "disable",
        },
      ],
    });
  }

  function expectGuardedBeforeLocatorBind({
    schedulerStore,
    prepared,
    run,
    errorCode,
  }) {
    const bind = vi.spyOn(schedulerStore, "bindDomainMigrationSourceLocator");
    expect(run).toThrow(expect.objectContaining({ code: errorCode }));
    expect(bind).not.toHaveBeenCalled();
    expect(
      schedulerStore
        .getDomainMigration(prepared.id)
        .entries.map((entry) => entry.sourceLocator),
    ).toEqual([null, null]);
  }

  it("fails Agenda multi-entry resumes before persisting a source locator", () => {
    const { root, schedulerStore } = fixture("agenda-multi-entry");
    const agendaStore = new AgentScheduleStore({
      dir: join(root, "agenda"),
      now: () => Date.UTC(2026, 7, 13, 8, 0, 0),
    });
    const entry = agendaStore.createCron({
      prompt: "guard Agenda migration",
      cron: "0 * * * *",
    });
    const prepared = prepareMultiEntryMigration({
      schedulerStore,
      domain: "agenda",
      sourceId: entry.id,
      sourceScope: {
        store: "agent-schedule",
        directory: canonicalSchedulerSourcePath(agendaStore.dir),
      },
      targetJob: buildAgendaSchedulerJob(entry),
    });

    expectGuardedBeforeLocatorBind({
      schedulerStore,
      prepared,
      run: () =>
        migrateAgendaSchedulerEntry({ agendaStore, schedulerStore, entry }),
      errorCode: "AGENDA_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
    });
  });

  it("fails Cowork multi-entry resumes before persisting a source locator", () => {
    const { root, schedulerStore } = fixture("cowork-multi-entry");
    const cwd = join(root, "workspace");
    const schedule = addSchedule(cwd, {
      cron: "0 * * * * *",
      templateId: "doc-convert",
      userMessage: "guard Cowork migration",
      files: [],
    });
    const workspace = canonicalSchedulerSourcePath(cwd);
    const prepared = prepareMultiEntryMigration({
      schedulerStore,
      domain: "cowork-cron",
      sourceId: schedule.id,
      sourceScope: { store: "cowork-schedules", workspace },
      targetJob: buildCoworkCronSchedulerJob(workspace, schedule),
    });

    expectGuardedBeforeLocatorBind({
      schedulerStore,
      prepared,
      run: () => migrateCoworkCronSchedule({ cwd, schedulerStore, schedule }),
      errorCode: "COWORK_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
    });
  });

  it("fails Routine multi-entry resumes before persisting a source locator", () => {
    const { root, schedulerStore } = fixture("routine-multi-entry");
    const routineStore = new RoutineStore({
      dir: join(root, "routines"),
      now: () => Date.UTC(2026, 7, 13, 8, 0, 0),
    });
    const routine = routineStore.create({
      name: "guard routine migration",
      prompt: "guard routine migration",
      trigger: { kind: "cron", cron: "0 * * * *" },
    });
    const prepared = prepareMultiEntryMigration({
      schedulerStore,
      domain: "routine",
      sourceId: routine.id,
      sourceScope: {
        store: "routines",
        directory: canonicalSchedulerSourcePath(routineStore.dir),
      },
      targetJob: buildRoutineSchedulerJob(routine, {
        channel: ROUTINE_SCHEDULER_CHANNELS.SCHEDULED,
      }),
    });

    expectGuardedBeforeLocatorBind({
      schedulerStore,
      prepared,
      run: () =>
        migrateRoutineSchedule({ routineStore, schedulerStore, routine }),
      errorCode: "SCHEDULER_ROUTINE_MIGRATION_DOMAIN_MISMATCH",
    });
  });

  it("fails Loop multi-entry resumes before persisting a source locator", () => {
    const { root, schedulerStore } = fixture("loop-multi-entry");
    const sessionId = "loop-multi-entry-session";
    const config = {
      execMode: true,
      operands: ["npm", "test"],
      dynamic: false,
      every: "1s",
      maxIterations: 3,
      untilExitZero: false,
      until: null,
      cwd: root,
    };
    const definition = {
      executionId: sessionId,
      cwd: root,
      execMode: true,
      operands: ["npm", "test"],
      dynamic: false,
    };
    const prepared = prepareMultiEntryMigration({
      schedulerStore,
      domain: "loop-iteration",
      sourceId: sessionId,
      sourceScope: { store: "jsonl-session", sessionId },
      targetJob: buildLoopSchedulerJob(definition),
    });

    expectGuardedBeforeLocatorBind({
      schedulerStore,
      prepared,
      run: () =>
        migrateSavedLoopSession({
          schedulerStore,
          sessionId,
          config,
          definition,
          readEvents: () => [
            { type: "loop_config", data: config, hash: "head-0" },
          ],
          appendEventIfHead: vi.fn(),
          sessionFilePath: (id) => join(root, "sessions", `${id}.jsonl`),
        }),
      errorCode: "LOOP_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
    });
  });
});
