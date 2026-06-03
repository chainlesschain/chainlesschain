/**
 * v1.3+ #21 P1 — `cc project` CLI surface.
 *
 * 子命令:
 *   cc project init <name>           Create a new project in desktop DB
 *     --description <text>           Optional description
 *     --type <type>                  web|document|data|app|presentation|
 *                                    spreadsheet|design|code|workflow|knowledge
 *                                    (default: document)
 *     --user <userId>                User ID (default: "default")
 *     --root <path>                  Optional root_path on filesystem
 *     --json                         JSON output
 *
 *   cc project list [--user <id>] [--status <s>] [--limit <n>] [--json]
 *   cc project show <id> [--json]
 *   cc project delete <id> [--hard] [--json]
 *
 * 设计 (per #21 v1.2 GA 反馈 "目标在手机端做ai项目的交互要像在电脑端那样丝滑"):
 *   CLI 直接读写 desktop chainlesschain.db, 立刻在 desktop UI 出现,
 *   Phase 3d sync 同步到手机端 — 桌面/CLI/手机 三端零延迟一致。
 */

import chalk from "chalk";
import {
  openProjectsDb,
  defaultProjectDbPath,
  newProjectId,
  VALID_PROJECT_TYPES,
  VALID_PROJECT_STATUSES,
} from "../lib/project-runtime.js";

const DEFAULT_USER = "default";

function _now() {
  return Date.now();
}

function _formatProjectTable(p) {
  return [
    `${chalk.bold("ID")}        ${p.id}`,
    `${chalk.bold("Name")}      ${p.name}`,
    `${chalk.bold("Type")}      ${p.project_type}`,
    `${chalk.bold("Status")}    ${_colorStatus(p.status)}`,
    `${chalk.bold("User")}      ${p.user_id}`,
    `${chalk.bold("Root")}      ${p.root_path || "(none)"}`,
    `${chalk.bold("Files")}     ${p.file_count || 0}`,
    `${chalk.bold("Created")}   ${new Date(p.created_at).toISOString()}`,
    `${chalk.bold("Updated")}   ${new Date(p.updated_at).toISOString()}`,
    p.description ? `${chalk.bold("Desc")}      ${p.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function _colorStatus(s) {
  switch (s) {
    case "draft":
      return chalk.gray(s);
    case "active":
      return chalk.cyan(s);
    case "completed":
      return chalk.green(s);
    case "archived":
      return chalk.yellow(s);
    default:
      return s;
  }
}

export function registerProjectCommand(program) {
  const cmd = program
    .command("project")
    .description(
      "Manage desktop projects (shared SQLite, syncs to mobile via Phase 3d)",
    );

  // ===== init =====
  cmd
    .command("init <name>")
    .description("Create a new project in desktop DB")
    .option("--description <text>", "Project description")
    .option(
      "--type <type>",
      `Project type (${VALID_PROJECT_TYPES.join("|")})`,
      "document",
    )
    .option("--user <userId>", "Owner user ID", DEFAULT_USER)
    .option("--root <path>", "Root filesystem path")
    .option("--db <path>", "DB path override", defaultProjectDbPath())
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      if (!VALID_PROJECT_TYPES.includes(options.type)) {
        console.error(
          chalk.red(
            `Invalid type "${options.type}". Must be one of: ${VALID_PROJECT_TYPES.join(", ")}`,
          ),
        );
        process.exit(2);
      }
      const { db, close } = await openProjectsDb(options.db);
      try {
        const id = newProjectId();
        const now = _now();
        db.prepare(
          `INSERT INTO projects (
            id, user_id, name, description, project_type, status,
            root_path, created_at, updated_at, sync_status, deleted
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending', 0)`,
        ).run(
          id,
          options.user,
          name,
          options.description || null,
          options.type,
          options.root || null,
          now,
          now,
        );
        const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          console.log(chalk.green("✓ Project created"));
          console.log(_formatProjectTable(p));
          console.log(
            chalk.gray(
              `\n  桌面 UI 会立刻看到此项目。Phase 3d sync 自动同步到手机端。`,
            ),
          );
        }
      } finally {
        close();
      }
    });

  // ===== list =====
  cmd
    .command("list")
    .description("List projects")
    .option("--user <userId>", "Filter by user ID", DEFAULT_USER)
    .option(
      "--status <s>",
      `Filter by status (${VALID_PROJECT_STATUSES.join("|")})`,
    )
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--db <path>", "DB path override", defaultProjectDbPath())
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { db, close } = await openProjectsDb(options.db);
      try {
        let sql = `SELECT id, user_id, name, description, project_type, status,
          root_path, file_count, created_at, updated_at, sync_status
          FROM projects WHERE user_id = ? AND deleted = 0`;
        const params = [options.user];
        if (options.status) {
          if (!VALID_PROJECT_STATUSES.includes(options.status)) {
            console.error(
              chalk.red(
                `Invalid status "${options.status}". Must be: ${VALID_PROJECT_STATUSES.join(", ")}`,
              ),
            );
            process.exit(2);
          }
          sql += " AND status = ?";
          params.push(options.status);
        }
        sql += " ORDER BY updated_at DESC LIMIT ?";
        params.push(options.limit);
        const rows = db.prepare(sql).all(...params);
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          if (rows.length === 0) {
            console.log(chalk.gray("(no projects)"));
            return;
          }
          for (const p of rows) {
            console.log(
              `${chalk.gray(p.id.slice(0, 8))}…  ${_colorStatus(p.status.padEnd(10))} ${chalk.bold(
                p.name.padEnd(28),
              )} ${chalk.gray(p.project_type.padEnd(12))} ${new Date(p.updated_at).toISOString()}`,
            );
          }
        }
      } finally {
        close();
      }
    });

  // ===== show =====
  cmd
    .command("show <id>")
    .description("Show project details")
    .option("--db <path>", "DB path override", defaultProjectDbPath())
    .option("--json", "Output JSON")
    .action(async (id, options) => {
      const { db, close } = await openProjectsDb(options.db);
      try {
        const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
        if (!p) {
          console.error(chalk.red(`Project not found: ${id}`));
          process.exit(2);
        }
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          console.log(_formatProjectTable(p));
        }
      } finally {
        close();
      }
    });

  // ===== delete =====
  cmd
    .command("delete <id>")
    .description("Delete a project (soft by default; --hard to truly remove)")
    .option("--hard", "Hard delete (also removes project_files cascade)", false)
    .option("--db <path>", "DB path override", defaultProjectDbPath())
    .option("--json", "Output JSON")
    .action(async (id, options) => {
      const { db, close } = await openProjectsDb(options.db);
      try {
        const existing = db
          .prepare("SELECT id FROM projects WHERE id = ?")
          .get(id);
        if (!existing) {
          console.error(chalk.red(`Project not found: ${id}`));
          process.exit(2);
        }
        if (options.hard) {
          db.prepare("DELETE FROM projects WHERE id = ?").run(id);
        } else {
          db.prepare(
            "UPDATE projects SET deleted = 1, sync_status = 'pending', updated_at = ? WHERE id = ?",
          ).run(_now(), id);
        }
        if (options.json) {
          console.log(
            JSON.stringify({ ok: true, id, hard: !!options.hard }, null, 2),
          );
        } else {
          console.log(
            chalk.green(
              `✓ Project ${options.hard ? "hard-deleted" : "deleted"}: ${id}`,
            ),
          );
        }
      } finally {
        close();
      }
    });
}

// 暴露给单测
export const _projectInternals = {
  defaultProjectDbPath,
};
