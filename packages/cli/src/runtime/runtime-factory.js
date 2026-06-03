import { loadConfig } from "../lib/config-manager.js";
import { AgentRuntime } from "./agent-runtime.js";
import {
  resolveAgentPolicy,
  resolveServerPolicy,
  resolveUiPolicy,
} from "./policies/agent-policy.js";

export function createAgentRuntimeFactory({
  config = loadConfig(),
  deps = {},
} = {}) {
  return {
    createAgentRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "agent",
        policy: resolveAgentPolicy({ config, overrides }),
        config,
        deps,
      });
    },

    createChatRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "chat",
        policy: resolveAgentPolicy({ config, overrides }),
        config,
        deps,
      });
    },

    createServerRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "server",
        policy: resolveServerPolicy(overrides),
        config,
        deps,
      });
    },

    createUiRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "ui",
        policy: resolveUiPolicy(overrides),
        config,
        deps,
      });
    },
  };
}
