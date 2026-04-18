/**
 * Organization & team commands
 * chainlesschain org create|list|show|update|delete|invite|members|team|approval
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createOrg,
  getOrg,
  listOrgs,
  updateOrg,
  deleteOrg,
  inviteMember,
  acceptInvite,
  getMembers,
  updateMemberRole,
  removeMember,
  createTeam,
  listTeams,
  addTeamMember,
  getTeamMembers,
  removeTeamMember,
  deleteTeam,
  submitApproval,
  approveRequest,
  rejectRequest,
  getApprovals,
  getOrgSummary,
  ORG_MATURITY_V2,
  MEMBER_LIFECYCLE_V2,
  getMaxActiveOrgsPerOwnerV2,
  setMaxActiveOrgsPerOwnerV2,
  getMaxActiveMembersPerOrgV2,
  setMaxActiveMembersPerOrgV2,
  getOrgIdleMsV2,
  setOrgIdleMsV2,
  getInviteStaleMsV2,
  setInviteStaleMsV2,
  getActiveOrgCountV2,
  getActiveMemberCountV2,
  registerOrgV2,
  getOrgV2,
  listOrgsV2,
  setOrgMaturityV2,
  activateOrgV2,
  suspendOrgV2,
  archiveOrgV2,
  touchOrgV2,
  inviteMemberV2,
  getMemberV2,
  listMembersV2,
  setMemberStatusV2,
  activateMemberV2,
  suspendMemberV2,
  revokeMemberV2,
  departMemberV2,
  autoArchiveIdleOrgsV2,
  autoRevokeStaleInvitesV2,
  getOrgManagerStatsV2,
} from "../lib/org-manager.js";

export function registerOrgCommand(program) {
  const org = program
    .command("org")
    .description("Organization, team, and approval management");

  // org create
  org
    .command("create")
    .description("Create a new organization")
    .argument("<name>", "Organization name")
    .option("--owner <id>", "Owner user ID", "cli-user")
    .option("--description <desc>", "Organization description")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = createOrg(db, name, options.owner, options.description);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Organization created");
          logger.log(`  ${chalk.bold("ID:")}    ${chalk.cyan(result.id)}`);
          logger.log(`  ${chalk.bold("Name:")}  ${result.name}`);
          logger.log(`  ${chalk.bold("Owner:")} ${result.ownerId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org list
  org
    .command("list", { isDefault: true })
    .description("List all organizations")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const orgs = listOrgs(db);

        if (options.json) {
          console.log(JSON.stringify(orgs, null, 2));
        } else if (orgs.length === 0) {
          logger.info(
            'No organizations. Create one with "chainlesschain org create <name>"',
          );
        } else {
          logger.log(chalk.bold(`Organizations (${orgs.length}):\n`));
          for (const o of orgs) {
            const status =
              o.status === "active"
                ? chalk.green("active")
                : chalk.gray(o.status);
            logger.log(`  ${chalk.cyan(o.id)} - ${o.name} [${status}]`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org show
  org
    .command("show")
    .description("Show organization details")
    .argument("<org-id>", "Organization ID")
    .option("--json", "Output as JSON")
    .action(async (orgId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const orgData = getOrg(db, orgId);

        if (!orgData) {
          logger.error(`Organization not found: ${orgId}`);
          process.exit(1);
        }

        const summary = getOrgSummary(db, orgId);

        if (options.json) {
          console.log(JSON.stringify({ ...orgData, ...summary }, null, 2));
        } else {
          logger.log(chalk.bold("Organization:\n"));
          logger.log(
            `  ${chalk.bold("ID:")}          ${chalk.cyan(orgData.id)}`,
          );
          logger.log(`  ${chalk.bold("Name:")}        ${orgData.name}`);
          logger.log(
            `  ${chalk.bold("Description:")} ${orgData.description || chalk.gray("(none)")}`,
          );
          logger.log(`  ${chalk.bold("Owner:")}       ${orgData.owner_id}`);
          logger.log(`  ${chalk.bold("Members:")}     ${summary.memberCount}`);
          logger.log(`  ${chalk.bold("Teams:")}       ${summary.teamCount}`);
          logger.log(
            `  ${chalk.bold("Pending:")}     ${summary.pendingApprovals}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org delete
  org
    .command("delete")
    .description("Delete an organization")
    .argument("<org-id>", "Organization ID")
    .option("--force", "Skip confirmation")
    .action(async (orgId, options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Delete this organization and all its data?",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = deleteOrg(db, orgId);

        if (ok) {
          logger.success("Organization deleted");
        } else {
          logger.error(`Organization not found: ${orgId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org invite
  org
    .command("invite")
    .description("Invite a member to an organization")
    .argument("<org-id>", "Organization ID")
    .argument("<user-id>", "User ID to invite")
    .option("--name <name>", "Display name")
    .option("--role <role>", "Role (admin/member/viewer)", "member")
    .action(async (orgId, userId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = inviteMember(
          db,
          orgId,
          userId,
          options.name,
          options.role,
        );
        logger.success(`Invited ${userId} as ${result.role}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org members
  org
    .command("members")
    .description("List organization members")
    .argument("<org-id>", "Organization ID")
    .option("--json", "Output as JSON")
    .action(async (orgId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const members = getMembers(db, orgId);

        if (options.json) {
          console.log(JSON.stringify(members, null, 2));
        } else if (members.length === 0) {
          logger.info("No members");
        } else {
          logger.log(chalk.bold(`Members (${members.length}):\n`));
          for (const m of members) {
            const role =
              m.role === "admin" ? chalk.yellow(m.role) : chalk.gray(m.role);
            const status =
              m.status === "active"
                ? chalk.green("active")
                : chalk.gray(m.status);
            logger.log(`  ${m.user_id} [${role}] ${status}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org team create
  org
    .command("team-create")
    .description("Create a team")
    .argument("<org-id>", "Organization ID")
    .argument("<team-name>", "Team name")
    .option("--description <desc>", "Team description")
    .option("--lead <id>", "Team lead user ID")
    .option("--json", "Output as JSON")
    .action(async (orgId, teamName, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const team = createTeam(
          db,
          orgId,
          teamName,
          options.description,
          options.lead,
        );

        if (options.json) {
          console.log(JSON.stringify(team, null, 2));
        } else {
          logger.success("Team created");
          logger.log(`  ${chalk.bold("ID:")}   ${chalk.cyan(team.id)}`);
          logger.log(`  ${chalk.bold("Name:")} ${team.name}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org teams
  org
    .command("teams")
    .description("List teams in an organization")
    .argument("<org-id>", "Organization ID")
    .option("--json", "Output as JSON")
    .action(async (orgId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const teams = listTeams(db, orgId);

        if (options.json) {
          console.log(JSON.stringify(teams, null, 2));
        } else if (teams.length === 0) {
          logger.info("No teams");
        } else {
          logger.log(chalk.bold(`Teams (${teams.length}):\n`));
          for (const t of teams) {
            logger.log(`  ${chalk.cyan(t.id)} - ${t.name}`);
            if (t.description) logger.log(`    ${chalk.gray(t.description)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org approval submit
  org
    .command("approval-submit")
    .description("Submit an approval request")
    .argument("<org-id>", "Organization ID")
    .argument("<title>", "Request title")
    .option("--type <type>", "Request type", "general")
    .option("--description <desc>", "Request description")
    .option("--requester <id>", "Requester ID", "cli-user")
    .option("--json", "Output as JSON")
    .action(async (orgId, title, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = submitApproval(
          db,
          orgId,
          options.requester,
          options.type,
          title,
          options.description,
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Approval request submitted");
          logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(result.id)}`);
          logger.log(
            `  ${chalk.bold("Status:")} ${chalk.yellow(result.status)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org approval list
  org
    .command("approvals")
    .description("List approval requests")
    .option("--org <id>", "Filter by organization")
    .option("--status <status>", "Filter by status (pending/approved/rejected)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const approvals = getApprovals(db, {
          orgId: options.org,
          status: options.status,
        });

        if (options.json) {
          console.log(JSON.stringify(approvals, null, 2));
        } else if (approvals.length === 0) {
          logger.info("No approval requests");
        } else {
          logger.log(chalk.bold(`Approvals (${approvals.length}):\n`));
          for (const a of approvals) {
            const statusColor =
              a.status === "approved"
                ? chalk.green
                : a.status === "rejected"
                  ? chalk.red
                  : chalk.yellow;
            logger.log(
              `  ${chalk.cyan(a.id)} ${a.title} [${statusColor(a.status)}]`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org approval approve
  org
    .command("approve")
    .description("Approve a request")
    .argument("<approval-id>", "Approval request ID")
    .option("--approver <id>", "Approver ID", "cli-user")
    .option("--note <note>", "Decision note")
    .action(async (approvalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = approveRequest(
          db,
          approvalId,
          options.approver,
          options.note,
        );

        if (ok) {
          logger.success("Request approved");
        } else {
          logger.error(`Request not found: ${approvalId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // org approval reject
  org
    .command("reject")
    .description("Reject a request")
    .argument("<approval-id>", "Approval request ID")
    .option("--approver <id>", "Approver ID", "cli-user")
    .option("--note <note>", "Decision note")
    .action(async (approvalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = rejectRequest(
          db,
          approvalId,
          options.approver,
          options.note,
        );

        if (ok) {
          logger.success("Request rejected");
        } else {
          logger.error(`Request not found: ${approvalId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ═══ Org V2 — in-memory maturity + member lifecycle ═══ */

  org
    .command("maturities-v2")
    .description("List org maturity states (V2)")
    .action(() => {
      for (const v of Object.values(ORG_MATURITY_V2)) console.log(`  ${v}`);
    });

  org
    .command("member-lifecycles-v2")
    .description("List member lifecycle states (V2)")
    .action(() => {
      for (const v of Object.values(MEMBER_LIFECYCLE_V2)) console.log(`  ${v}`);
    });

  org
    .command("stats-v2")
    .description("Show V2 org/member stats")
    .action(() => {
      console.log(JSON.stringify(getOrgManagerStatsV2(), null, 2));
    });

  org
    .command("max-active-orgs-per-owner")
    .argument("[n]", "New cap")
    .description("Get/set max active orgs per owner (V2)")
    .action((n) => {
      if (n !== undefined) setMaxActiveOrgsPerOwnerV2(n);
      console.log(getMaxActiveOrgsPerOwnerV2());
    });

  org
    .command("max-active-members-per-org")
    .argument("[n]", "New cap")
    .description("Get/set max active members per org (V2)")
    .action((n) => {
      if (n !== undefined) setMaxActiveMembersPerOrgV2(n);
      console.log(getMaxActiveMembersPerOrgV2());
    });

  org
    .command("org-idle-ms")
    .argument("[ms]", "New idle window")
    .description("Get/set org idle window ms (V2)")
    .action((ms) => {
      if (ms !== undefined) setOrgIdleMsV2(ms);
      console.log(getOrgIdleMsV2());
    });

  org
    .command("invite-stale-ms")
    .argument("[ms]", "New invite stale window")
    .description("Get/set invite stale window ms (V2)")
    .action((ms) => {
      if (ms !== undefined) setInviteStaleMsV2(ms);
      console.log(getInviteStaleMsV2());
    });

  org
    .command("active-org-count-v2 <owner>")
    .description("Count active orgs for owner (V2)")
    .action((owner) => {
      console.log(getActiveOrgCountV2(owner));
    });

  org
    .command("active-member-count-v2 <orgId>")
    .description("Count active members for org (V2)")
    .action((orgId) => {
      console.log(getActiveMemberCountV2(orgId));
    });

  org
    .command("register-org-v2 <id>")
    .requiredOption("-o, --owner <owner>", "Owner")
    .requiredOption("-n, --name <name>", "Org name")
    .description("Register a new provisional org (V2)")
    .action((id, opts) => {
      console.log(
        JSON.stringify(
          registerOrgV2(id, { owner: opts.owner, name: opts.name }),
          null,
          2,
        ),
      );
    });

  org
    .command("org-v2 <id>")
    .description("Show org by id (V2)")
    .action((id) => {
      const o = getOrgV2(id);
      if (!o) {
        console.error(`org ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(o, null, 2));
    });

  org
    .command("list-orgs-v2")
    .option("-o, --owner <owner>", "Filter by owner")
    .option("-m, --maturity <m>", "Filter by maturity")
    .description("List orgs (V2)")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listOrgsV2({ owner: opts.owner, maturity: opts.maturity }),
          null,
          2,
        ),
      );
    });

  org
    .command("set-org-maturity-v2 <id> <next>")
    .description("Transition org maturity (V2)")
    .action((id, next) => {
      console.log(JSON.stringify(setOrgMaturityV2(id, next), null, 2));
    });

  org
    .command("activate-org-v2 <id>")
    .description("Activate org (V2)")
    .action((id) => {
      console.log(JSON.stringify(activateOrgV2(id), null, 2));
    });

  org
    .command("suspend-org-v2 <id>")
    .description("Suspend org (V2)")
    .action((id) => {
      console.log(JSON.stringify(suspendOrgV2(id), null, 2));
    });

  org
    .command("archive-org-v2 <id>")
    .description("Archive org terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(archiveOrgV2(id), null, 2));
    });

  org
    .command("touch-org-v2 <id>")
    .description("Update org lastSeenAt (V2)")
    .action((id) => {
      console.log(JSON.stringify(touchOrgV2(id), null, 2));
    });

  org
    .command("invite-member-v2 <id>")
    .requiredOption("-o, --org <orgId>", "Org id")
    .requiredOption("-u, --user <userId>", "User id")
    .option("-r, --role <role>", "Role", "member")
    .description("Invite a member to an org (V2)")
    .action((id, opts) => {
      console.log(
        JSON.stringify(
          inviteMemberV2(id, {
            orgId: opts.org,
            userId: opts.user,
            role: opts.role,
          }),
          null,
          2,
        ),
      );
    });

  org
    .command("member-v2 <id>")
    .description("Show member by id (V2)")
    .action((id) => {
      const m = getMemberV2(id);
      if (!m) {
        console.error(`member ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(m, null, 2));
    });

  org
    .command("list-members-v2")
    .option("-o, --org <orgId>", "Filter by orgId")
    .option("-s, --status <s>", "Filter by status")
    .description("List members (V2)")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listMembersV2({ orgId: opts.org, status: opts.status }),
          null,
          2,
        ),
      );
    });

  org
    .command("set-member-status-v2 <id> <next>")
    .description("Transition member status (V2)")
    .action((id, next) => {
      console.log(JSON.stringify(setMemberStatusV2(id, next), null, 2));
    });

  org
    .command("activate-member-v2 <id>")
    .description("Activate member (V2)")
    .action((id) => {
      console.log(JSON.stringify(activateMemberV2(id), null, 2));
    });

  org
    .command("suspend-member-v2 <id>")
    .description("Suspend member (V2)")
    .action((id) => {
      console.log(JSON.stringify(suspendMemberV2(id), null, 2));
    });

  org
    .command("revoke-member-v2 <id>")
    .description("Revoke member terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(revokeMemberV2(id), null, 2));
    });

  org
    .command("depart-member-v2 <id>")
    .description("Depart member terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(departMemberV2(id), null, 2));
    });

  org
    .command("auto-archive-idle-orgs")
    .description("Auto-archive non-provisional orgs idle past window (V2)")
    .action(() => {
      console.log(JSON.stringify(autoArchiveIdleOrgsV2(), null, 2));
    });

  org
    .command("auto-revoke-stale-invites")
    .description("Auto-revoke invited members stale past window (V2)")
    .action(() => {
      console.log(JSON.stringify(autoRevokeStaleInvitesV2(), null, 2));
    });
}
