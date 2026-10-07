const Database = require("better-sqlite3");
const { EventEmitter } = require("node:events");
const {
  createOrganizationProjectHost,
} = require("../../organization-project-ipc");
const identities = {
  owner: "did:owner",
  requester: "did:requester",
  first: "did:first",
  second: "did:second",
};
function organizationProjectFixture(dialog, overrides = {}) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT,name TEXT);
    CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT,display_name TEXT);
    CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT,name TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,name TEXT);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,sync_status TEXT,deleted INTEGER DEFAULT 0,org_id TEXT,workspace_id TEXT,result_data TEXT,due_date INTEGER,blocked_by TEXT);
    CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
    CREATE TABLE approval_workflows(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,trigger_resource_type TEXT,trigger_action TEXT,trigger_conditions TEXT,approval_type TEXT,approvers TEXT,timeout_hours REAL,on_timeout TEXT,enabled INTEGER,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE approval_requests(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES approval_workflows(id),org_id TEXT,requester_did TEXT,requester_name TEXT,resource_type TEXT,resource_id TEXT,action TEXT,request_data TEXT,status TEXT,current_step INTEGER,total_steps INTEGER,created_at INTEGER,updated_at INTEGER,completed_at INTEGER);
    CREATE TABLE approval_responses(id TEXT PRIMARY KEY,request_id TEXT REFERENCES approval_requests(id),approver_did TEXT,approver_name TEXT,step INTEGER,decision TEXT,delegated_to TEXT,comment TEXT,created_at INTEGER);
    INSERT INTO organization_info VALUES('org1','did:org:1','${identities.owner}','Test organization');
    INSERT INTO organization_projects VALUES('op1','org1','${identities.owner}','Organization project');
    INSERT INTO projects VALUES('p1','${identities.owner}','active',10,0,'Canonical project');
    INSERT INTO project_tasks(id,project_id,task_type,description,status,created_at,updated_at,sync_status) VALUES('t1','p1','query_info','Original task','pending',10,10,'synced');
  `);
  for (const [name, did] of Object.entries(identities))
    db.prepare(
      "INSERT INTO organization_members VALUES(?,'org1',?,?,'active',?)",
    ).run(name, did, name === "owner" ? "owner" : "member", name);
  let actor = identities.owner,
    generation = 1,
    now = 1000,
    trusted = true;
  const parent = { isDestroyed: () => false };
  const event = {
    sender: new EventEmitter(),
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  event.sender.mainFrame = event.senderFrame;
  const electron = {
    BrowserWindow: { fromWebContents: () => parent },
    dialog: { showMessageBox: dialog },
    ipcMain: { handle() {} },
  };
  const host = createOrganizationProjectHost({
    database: { getDatabase: () => db },
    electron,
    clock: () => now,
    getCurrentUserDid: () => actor,
    getAuthenticationGeneration: () => generation,
    validateSender: () => ({ trusted }),
    ...overrides,
  });
  async function setup({ bind = true } = {}) {
    host.context(event, { projectId: "p1" });
    const workflowIds = [];
    for (const actionType of ["task.update-description", "task.create"]) {
      const source = host.setup(event, { projectId: "p1", orgId: "org1" });
      const result = await host.configureWorkflow(event, {
        orgId: "org1",
        name: actionType,
        actionType,
        steps: [[identities.first], [identities.second]],
        approvalType: "sequential",
        timeoutHours: 24,
        expectedSourceDigest: source.sourceDigest,
      });
      workflowIds.push(result.workflowId);
    }
    const permissions = Object.entries(identities).map(([name, actorDid]) => ({
      actorDid,
      projectId: "p1",
      permissions:
        name === "owner" || name === "requester"
          ? ["task.read", "task.create", "task.update-description"]
          : ["task.read", "task.approve"],
      expiresAt: 100000000,
    }));
    const policy = { orgId: "org1", permissions, workflowIds };
    await host.attestPolicy(event, {
      ...policy,
      expectedDigest: host.previewPolicy(event, policy).digest,
    });
    const binding = {
      projectId: "p1",
      organizationProjectId: "op1",
      orgId: "org1",
    };
    if (bind)
      await host.bindProject(event, {
        ...binding,
        expectedDigest: host.previewBinding(event, binding).digest,
      });
    return { workflowIds, permissions };
  }
  return {
    db,
    host,
    event,
    electron,
    parent,
    identities,
    setup,
    setActor(value) {
      actor = value;
      generation++;
    },
    getActor: () => actor,
    setTrusted(value) {
      trusted = value;
    },
    setNow(value) {
      now = value;
    },
    getNow: () => now,
  };
}
module.exports = { organizationProjectFixture, identities };
