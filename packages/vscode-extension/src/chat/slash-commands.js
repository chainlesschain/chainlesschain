/**
 * Single source of truth for the chat panel's slash-command surface.
 *
 * This file is shared by Node tests and embedded verbatim in the webview.
 * Names, descriptions, aliases and routes therefore cannot drift between the
 * autocomplete menu, /help and execution.
 */
(function (global) {
  var COMMAND_DEFS = [
    {
      name: "/new",
      description: "start a new conversation",
      route: "message",
      message: { type: "new" },
    },
    {
      name: "/clear",
      description: "clear this conversation and start fresh",
      route: "message",
      message: { type: "new" },
    },
    {
      name: "/sessions",
      aliases: ["/resume"],
      description: "resume a saved session",
      route: "message",
      message: { type: "pickSession" },
    },
    {
      name: "/plan",
      description: "enter plan mode",
      route: "message",
      message: { type: "plan", action: "enter" },
    },
    {
      name: "/approve",
      description: "approve the current plan",
      route: "message",
      message: { type: "plan", action: "approve" },
    },
    {
      name: "/reject",
      description: "reject the current plan",
      route: "message",
      message: { type: "plan", action: "reject" },
    },
    {
      name: "/auto",
      description: "auto-accept file edits",
      route: "message",
      message: { type: "mode", mode: "acceptEdits" },
    },
    {
      name: "/bypass",
      description: "bypass all approvals",
      route: "message",
      message: { type: "mode", mode: "bypassPermissions" },
    },
    {
      name: "/normal",
      description: "normal approvals (default)",
      route: "message",
      message: { type: "mode", mode: "default" },
    },
    {
      name: "/think",
      description: "extended thinking on (Anthropic)",
      route: "message",
      message: { type: "think", level: "on" },
    },
    {
      name: "/ultrathink",
      description: "extended thinking, max budget",
      route: "message",
      message: { type: "think", level: "ultra" },
    },
    {
      name: "/think-off",
      description: "extended thinking off",
      route: "message",
      message: { type: "think", level: "off" },
    },
    {
      name: "/stop",
      description: "interrupt the running turn",
      route: "message",
      message: { type: "interrupt" },
    },
    {
      name: "/compact",
      description: "compact the conversation history",
      route: "message",
      message: { type: "compact" },
    },
    {
      name: "/cost",
      description: "token cost for this session",
      route: "message",
      message: { type: "cost" },
    },
    {
      name: "/context",
      description: "context-window usage",
      route: "message",
      message: { type: "context" },
    },
    {
      name: "/rewind",
      description: "restore a checkpoint",
      route: "message",
      message: { type: "rewind" },
    },
    {
      name: "/retry",
      description: "regenerate the last prompt",
      route: "local",
    },
    {
      name: "/handoff",
      description: "hand off to a background agent (web/mobile)",
      route: "message",
      message: { type: "handoff" },
    },
    {
      name: "/review",
      description: "review the current git diff",
      route: "local",
    },
    {
      name: "/goal",
      description: "set or show the session completion goal",
      route: "message",
      message: { type: "goal" },
      argField: "spec",
    },
    {
      name: "/loop",
      description: "repeat a prompt on an interval (use /loop stop to stop)",
      route: "message",
      message: { type: "loop" },
      argField: "spec",
    },
    {
      name: "/status",
      description: "show CLI, model, session, IDE and MCP status",
      route: "session",
      command: "status",
    },
    {
      name: "/doctor",
      description: "diagnose this live session",
      route: "session",
      command: "doctor",
    },
    {
      name: "/init",
      description: "initialize project instructions",
      route: "cli",
      command: "init",
    },
    {
      name: "/mcp",
      description: "show MCP servers connected to this session",
      route: "session",
      command: "mcp",
    },
    {
      name: "/hooks",
      description: "show hooks loaded in this session",
      route: "session",
      command: "hooks",
    },
    {
      name: "/permissions",
      description: "show effective session permissions",
      route: "session",
      command: "permissions",
    },
    {
      name: "/agents",
      description: "show configured agent definitions",
      route: "session",
      command: "agents",
    },
    {
      name: "/tasks",
      description: "show background shell tasks in this session",
      route: "session",
      command: "tasks",
    },
    {
      name: "/memory",
      description: "show project memory loaded in this session",
      route: "session",
      command: "memory",
    },
    {
      name: "/plugin",
      description: "show installed plugin information",
      route: "cli",
      command: "plugin",
    },
    {
      name: "/release-notes",
      description: "show CLI release notes",
      route: "cli",
      command: "changelog",
    },
    {
      name: "/expand",
      description: "expand or collapse all reasoning blocks",
      route: "local",
    },
    {
      name: "/help",
      description: "list panel commands",
      route: "help",
    },
  ];

  var SLASH_COMMANDS = COMMAND_DEFS.map(function (def) {
    return [def.name, def.description];
  });

  /**
   * Detect an in-progress slash command. Hyphenated commands such as
   * /release-notes remain completable after the user types the hyphen.
   */
  function detectSlashToken(textBeforeCaret) {
    var s = String(textBeforeCaret == null ? "" : textBeforeCaret);
    var m = /^\s*\/([a-z-]*)$/i.exec(s);
    return m ? { prefix: m[1].toLowerCase() } : null;
  }

  function filterSlashCommands(prefix) {
    var q = String(prefix == null ? "" : prefix).toLowerCase();
    return SLASH_COMMANDS.filter(function (row) {
      return row[0].slice(1).indexOf(q) === 0;
    });
  }

  function findSlashCommand(name) {
    var key = String(name == null ? "" : name).toLowerCase();
    for (var i = 0; i < COMMAND_DEFS.length; i += 1) {
      var def = COMMAND_DEFS[i];
      if (def.name === key) return def;
      if (Array.isArray(def.aliases) && def.aliases.indexOf(key) >= 0) {
        return def;
      }
    }
    return null;
  }

  /**
   * Resolve a slash command into either a host message or a local/help action.
   * Free-form arguments remain text here; the trusted extension host tokenizes
   * CLI argv so quoted values and Windows paths survive safely.
   */
  function routeSlashCommand(name, rawArgs) {
    var def = findSlashCommand(name);
    if (!def) return null;
    var argText = String(rawArgs == null ? "" : rawArgs).trim();
    if (def.route === "local" || def.route === "help") {
      return { kind: def.route, command: def.name, args: argText };
    }
    if (def.route === "session") {
      return {
        kind: "message",
        message: {
          type: "sessionSlashCommand",
          command: def.command,
          args: argText,
        },
      };
    }
    if (def.route === "cli") {
      return {
        kind: "message",
        message: {
          type: "cliCommand",
          command: def.command,
          args: argText,
        },
      };
    }
    if (def.route === "message") {
      var message = {};
      var source = def.message || {};
      Object.keys(source).forEach(function (key) {
        message[key] = source[key];
      });
      if (def.argField) message[def.argField] = argText;
      return { kind: "message", message: message };
    }
    return null;
  }

  function formatSlashHelp() {
    var lines = ["panel commands:"];
    COMMAND_DEFS.forEach(function (def) {
      var names = [def.name].concat(def.aliases || []).join(", ");
      lines.push("  " + names + " - " + def.description);
    });
    return lines.join("\n");
  }

  /**
   * Small argv tokenizer for host-side CLI routes. It intentionally does not
   * interpret shell operators; each token is later escaped and passed as argv.
   * Backslashes remain literal so Windows paths are not corrupted.
   */
  function splitSlashArgs(raw) {
    var text = String(raw == null ? "" : raw);
    var args = [];
    var token = "";
    var quote = null;
    var started = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (quote) {
        if (ch === quote) {
          quote = null;
          started = true;
        } else if (
          ch === "\\" &&
          i + 1 < text.length &&
          text[i + 1] === quote
        ) {
          token += text[i + 1];
          i += 1;
          started = true;
        } else {
          token += ch;
          started = true;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        started = true;
      } else if (/\s/.test(ch)) {
        if (started) {
          args.push(token);
          token = "";
          started = false;
        }
      } else {
        token += ch;
        started = true;
      }
    }
    if (quote) {
      return { args: [], error: "unterminated quoted argument" };
    }
    if (started) args.push(token);
    return { args: args, error: null };
  }

  var api = {
    COMMAND_DEFS: COMMAND_DEFS,
    SLASH_COMMANDS: SLASH_COMMANDS,
    detectSlashToken: detectSlashToken,
    filterSlashCommands: filterSlashCommands,
    findSlashCommand: findSlashCommand,
    routeSlashCommand: routeSlashCommand,
    formatSlashHelp: formatSlashHelp,
    splitSlashArgs: splitSlashArgs,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.ccSlash = api;
})(typeof window !== "undefined" ? window : globalThis);
