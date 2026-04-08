/**
 * WebSocket Agent Handler
 *
 * Handles agent session messages over WebSocket. Consumes agent-core's
 * agentLoop generator and routes events to the client via the interaction
 * adapter.
 */

import { agentLoop, formatToolArgs } from "./agent-core.js";
import { detectTaskType, selectModelForTask } from "./task-model-selector.js";
import { PlanState } from "./plan-mode.js";
import { CLISlotFiller } from "./slot-filler.js";
import { createAbortError, isAbortError } from "./abort-utils.js";

export class WSAgentHandler {
  /**
   * @param {object} options
   * @param {import("./ws-session-manager.js").Session} options.session
   * @param {import("./interaction-adapter.js").WebSocketInteractionAdapter} options.interaction
   * @param {object} [options.db]
   */
  constructor({ session, interaction, db }) {
    this.session = session;
    this.interaction = interaction;
    this.db = db || null;
    this._processing = false;
    this._abortController = null;
    this._activeRequestId = null;
  }

  /**
   * Handle a user message — one turn of the agentic loop.
   *
   * @param {string} userMessage
   * @param {string} [requestId] - id from ws message for response correlation
   */
  async handleMessage(userMessage, requestId) {
    if (this._processing) {
      this.interaction.emit("error", {
        requestId,
        code: "BUSY",
        message: "Session is currently processing a message",
      });
      return;
    }

    this._processing = true;
    const abortController = new AbortController();
    this._abortController = abortController;
    this._activeRequestId = requestId || null;

    try {
      const { session } = this;

      // Add user message
      session.messages.push({ role: "user", content: userMessage });

      // Auto-select model based on task type
      let activeModel = session.model;
      const taskDetection = detectTaskType(userMessage);
      if (taskDetection.confidence > 0.3) {
        const recommended = selectModelForTask(
          session.provider,
          taskDetection.taskType,
        );
        if (recommended && recommended !== activeModel) {
          activeModel = recommended;
          this.interaction.emit("model-switch", {
            requestId,
            from: session.model,
            to: activeModel,
            reason: taskDetection.name,
          });
        }
      }

      // Create slot filler for interactive parameter collection
      const slotFiller = new CLISlotFiller({
        interaction: this.interaction,
        db: this.db,
      });

      // Run agent loop
      const loopOptions = {
        provider: session.provider,
        model: activeModel,
        baseUrl: session.baseUrl || "http://localhost:11434",
        apiKey: session.apiKey,
        contextEngine: session.contextEngine,
        hookDb: this.db,
        cwd: session.projectRoot,
        sessionId: session.id,
        planManager: session.planManager,
        enabledToolNames: session.enabledToolNames || null,
        hostManagedToolPolicy: session.hostManagedToolPolicy || null,
        extraToolDefinitions: session.externalToolDefinitions || [],
        externalToolDescriptors: session.externalToolDescriptors || {},
        externalToolExecutors: session.externalToolExecutors || {},
        mcpClient: session.mcpClient || null,
        slotFiller,
        interaction: this.interaction,
        signal: abortController.signal,
      };

      for await (const event of agentLoop(session.messages, loopOptions)) {
        switch (event.type) {
          case "slot-filling":
            this.interaction.emit("slot-filling", {
              requestId,
              slot: event.slot,
              question: event.question,
            });
            break;

          case "tool-executing":
            this.interaction.emit("tool-executing", {
              requestId,
              tool: event.tool,
              args: event.args,
              display: formatToolArgs(event.tool, event.args),
            });
            break;

          case "tool-result":
            this.interaction.emit("tool-result", {
              requestId,
              tool: event.tool,
              result: event.result,
              error: event.error,
            });
            break;

          case "response-complete":
            if (event.content) {
              session.messages.push({
                role: "assistant",
                content: event.content,
              });
            }
            this.interaction.emit("response-complete", {
              requestId,
              content: event.content,
            });
            break;
        }
      }

      // Update last activity
      session.lastActivity = new Date().toISOString();
    } catch (err) {
      if (isAbortError(err) || abortController.signal.aborted) {
        return;
      }

      this.interaction.emit("error", {
        requestId,
        code: "AGENT_ERROR",
        message: err.message,
      });

      // Record error in context engine
      if (this.session.contextEngine) {
        this.session.contextEngine.recordError({
          step: "ws-agent-loop",
          message: err.message,
        });
      }
    } finally {
      this._processing = false;
      if (this._abortController === abortController) {
        this._abortController = null;
      }
      if (this._activeRequestId === requestId) {
        this._activeRequestId = null;
      }
    }
  }

  async interrupt() {
    const wasProcessing = this._processing;
    const interruptedRequestId = this._activeRequestId || null;
    const reason = createAbortError("Session interrupted by client");

    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }

    if (typeof this.interaction?.rejectAllPending === "function") {
      this.interaction.rejectAllPending(reason);
    }

    return {
      sessionId: this.session?.id || null,
      interrupted: true,
      wasProcessing,
      interruptedRequestId,
    };
  }

  destroy() {
    const reason = createAbortError("Session closed");
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }
    if (typeof this.interaction?.rejectAllPending === "function") {
      this.interaction.rejectAllPending(reason);
    }
  }

  /**
   * Handle slash commands within the session.
   *
   * @param {string} command - e.g. "/plan enter", "/model qwen2:7b"
   * @param {string} [requestId]
   */
  async handleSlashCommand(command, requestId) {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const arg = args.join(" ").trim();
    const { session } = this;

    switch (cmd) {
      case "/model":
        if (arg) {
          session.model = arg;
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { model: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { model: session.model },
          });
        }
        break;

      case "/provider": {
        const supported = [
          "ollama",
          "anthropic",
          "openai",
          "deepseek",
          "dashscope",
          "mistral",
          "gemini",
          "volcengine",
        ];
        if (arg && supported.includes(arg)) {
          session.provider = arg;
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { provider: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { provider: session.provider, available: supported },
          });
        }
        break;
      }

      case "/clear":
        session.messages.length = 1; // Keep system prompt
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { cleared: true },
        });
        break;

      case "/compact":
        if (session.contextEngine && session.messages.length > 5) {
          const compacted = session.contextEngine.smartCompact(
            session.messages,
          );
          session.messages.length = 0;
          session.messages.push(...compacted);
        } else if (session.messages.length > 5) {
          const systemMsg = session.messages[0];
          const recent = session.messages.slice(-4);
          session.messages.length = 0;
          session.messages.push(systemMsg, ...recent);
        }
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { messageCount: session.messages.length },
        });
        break;

      case "/task":
        if (arg === "clear") {
          if (session.contextEngine) session.contextEngine.clearTask();
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { cleared: true },
          });
        } else if (arg) {
          if (session.contextEngine) session.contextEngine.setTask(arg);
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { task: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: {
              task: session.contextEngine?.taskContext?.objective || null,
            },
          });
        }
        break;

      case "/stats":
        if (session.contextEngine) {
          const stats = session.contextEngine.getStats();
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: stats,
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { error: "Context engine not available" },
          });
        }
        break;

      case "/session":
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: {
            id: session.id,
            type: session.type,
            provider: session.provider,
            model: session.model,
            messageCount: session.messages.length,
            projectRoot: session.projectRoot,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
          },
        });
        break;

      case "/plan":
        this._handlePlanCommand(arg, requestId);
        break;

      default:
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { error: `Unknown command: ${cmd}` },
        });
    }
  }

  /**
   * Handle /plan sub-commands.
   */
  _handlePlanCommand(subCmd, requestId) {
    const planManager = this.session.planManager;

    if (!subCmd || subCmd === "enter") {
      if (planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan",
          result: { error: "Already in plan mode" },
        });
      } else {
        planManager.enterPlanMode({ title: "Agent Plan" });
        this.session.messages.push({
          role: "system",
          content:
            "[PLAN MODE ACTIVE] You are now in plan mode. You can read files, search, and analyze — but write/execute tools are blocked. Any blocked tool calls will be recorded as plan items. Analyze the task thoroughly, then the user will approve your plan.",
        });
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan",
          result: { state: "analyzing", message: "Entered plan mode" },
        });
      }
    } else if (subCmd === "show") {
      if (!planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan show",
          result: { error: "Not in plan mode" },
        });
      } else {
        this.interaction.emit("plan-ready", {
          requestId,
          summary: planManager.generatePlanSummary(),
          risk: planManager.getRiskAssessment(),
          items: planManager.currentPlan?.items || [],
        });
      }
    } else if (subCmd === "approve" || subCmd === "yes") {
      if (!planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: { error: "No plan to approve" },
        });
      } else if (
        !planManager.currentPlan ||
        planManager.currentPlan.items.length === 0
      ) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: { error: "Plan has no items" },
        });
      } else {
        planManager.approvePlan();
        this.session.messages.push({
          role: "system",
          content: `[PLAN APPROVED] The user has approved your plan with ${planManager.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, git, and run_skill. Execute the plan items in order.`,
        });
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: {
            state: PlanState.APPROVED,
            itemCount: planManager.currentPlan.items.length,
          },
        });
      }
    } else if (subCmd === "reject" || subCmd === "no") {
      if (planManager.isActive()) {
        planManager.rejectPlan("User rejected");
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan reject",
          result: { state: PlanState.REJECTED },
        });
      } else {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan reject",
          result: { error: "No plan to reject" },
        });
      }
    } else if (subCmd === "exit") {
      if (planManager.isActive()) {
        planManager.exitPlanMode({ savePlan: true });
      }
      this.interaction.emit("command-response", {
        requestId,
        command: "/plan exit",
        result: { state: PlanState.INACTIVE },
      });
    } else {
      this.interaction.emit("command-response", {
        requestId,
        command: "/plan",
        result: {
          error: `Unknown /plan subcommand: ${subCmd}`,
          available: ["enter", "show", "approve", "reject", "exit"],
        },
      });
    }
  }
}
