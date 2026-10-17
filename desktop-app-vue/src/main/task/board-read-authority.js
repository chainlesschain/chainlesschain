"use strict";

function deny() {
  const error = new Error("BOARD_READ_NOT_FOUND_OR_DENIED");
  error.code = "BOARD_READ_NOT_FOUND_OR_DENIED";
  throw error;
}

const SOURCES = Object.freeze({
  orgId: "SELECT org_id AS orgId FROM organization_info WHERE org_id=?",
  boardId: "SELECT org_id AS orgId FROM task_boards WHERE id=?",
  taskId:
    "SELECT b.org_id AS orgId FROM team_tasks t JOIN task_boards b ON b.id=t.board_id WHERE t.id=?",
  sprintId:
    "SELECT b.org_id AS orgId FROM task_sprints s JOIN task_boards b ON b.id=s.board_id WHERE s.id=?",
  attachmentId:
    "SELECT b.org_id AS orgId FROM task_attachments a JOIN team_tasks t ON t.id=a.task_id JOIN task_boards b ON b.id=t.board_id WHERE a.id=?",
  reportId: "SELECT org_id AS orgId FROM team_reports WHERE id=?",
});

function createBoardReadCheck(database, event, reference, dependencies = {}) {
  const validateSender =
    dependencies.validateSender ||
    require("../ipc/ipc-sender-guard").validateSender;
  const getActor =
    dependencies.getActor ||
    require("./project-goal-auth-session").getProjectGoalActor;
  const getGeneration =
    dependencies.getGeneration ||
    require("./project-goal-auth-session").getProjectGoalAuthGeneration;
  const entries = Object.entries(reference || {});
  if (
    entries.length !== 1 ||
    !Object.hasOwn(SOURCES, entries[0][0]) ||
    typeof entries[0][1] !== "string" ||
    !entries[0][1]
  )
    deny();
  const [kind, id] = entries[0];
  const db = database?.getDatabase ? database.getDatabase() : database;
  const actor = getActor();
  const generation = getGeneration();
  const frame = event?.senderFrame;
  const frameUrl = frame?.url;
  if (
    !db?.prepare ||
    typeof actor !== "string" ||
    !actor.startsWith("did:") ||
    !Number.isSafeInteger(generation) ||
    validateSender(event)?.trusted !== true ||
    !frame
  )
    deny();

  function check() {
    if (
      validateSender(event)?.trusted !== true ||
      event?.senderFrame !== frame ||
      frame?.url !== frameUrl ||
      (database?.getDatabase ? database.getDatabase() : database) !== db ||
      getActor() !== actor ||
      getGeneration() !== generation
    )
      deny();
    const orgId = db.prepare(SOURCES[kind]).get(id)?.orgId;
    if (
      typeof orgId !== "string" ||
      !db
        .prepare(
          "SELECT 1 FROM organization_info o JOIN organization_members m ON m.org_id=o.org_id WHERE o.org_id=? AND m.member_did=? AND m.status='active' LIMIT 1",
        )
        .get(orgId, actor)
    )
      deny();
  }
  check();
  return check;
}

async function withBoardReadAccess(
  database,
  event,
  reference,
  operation,
  dependencies,
) {
  const check = createBoardReadCheck(database, event, reference, dependencies);
  const result = await operation();
  check();
  return result;
}

module.exports = { createBoardReadCheck, withBoardReadAccess };
