"use strict";
/**
 * @chainlesschain/agent-sdk — Node entry.
 *
 * The protocol contract lives in ./protocol.ts (browser-safe re-export at
 * "@chainlesschain/agent-sdk/browser"). This entry adds the Node
 * transports: the stream-json spawn client, the background-session pipe
 * client, and the one-shot `--json` command wrappers.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.showSession = exports.showCheckpoint = exports.runCliJson = exports.restoreCheckpoint = exports.listSessions = exports.listCheckpoints = exports.createCheckpoint = exports.readBackgroundAgentState = exports.backgroundAgentsDir = exports.attachBackgroundSession = exports.buildSpawnCommand = exports.buildAgentArgs = exports.AgentSession = exports.encodeNdjson = exports.createNdjsonDecoder = void 0;
__exportStar(require("./protocol.js"), exports);
var ndjson_js_1 = require("./ndjson.js");
Object.defineProperty(exports, "createNdjsonDecoder", { enumerable: true, get: function () { return ndjson_js_1.createNdjsonDecoder; } });
Object.defineProperty(exports, "encodeNdjson", { enumerable: true, get: function () { return ndjson_js_1.encodeNdjson; } });
var agent_session_js_1 = require("./agent-session.js");
Object.defineProperty(exports, "AgentSession", { enumerable: true, get: function () { return agent_session_js_1.AgentSession; } });
Object.defineProperty(exports, "buildAgentArgs", { enumerable: true, get: function () { return agent_session_js_1.buildAgentArgs; } });
Object.defineProperty(exports, "buildSpawnCommand", { enumerable: true, get: function () { return agent_session_js_1.buildSpawnCommand; } });
var background_js_1 = require("./background.js");
Object.defineProperty(exports, "attachBackgroundSession", { enumerable: true, get: function () { return background_js_1.attachBackgroundSession; } });
Object.defineProperty(exports, "backgroundAgentsDir", { enumerable: true, get: function () { return background_js_1.backgroundAgentsDir; } });
Object.defineProperty(exports, "readBackgroundAgentState", { enumerable: true, get: function () { return background_js_1.readBackgroundAgentState; } });
var cli_json_js_1 = require("./cli-json.js");
Object.defineProperty(exports, "createCheckpoint", { enumerable: true, get: function () { return cli_json_js_1.createCheckpoint; } });
Object.defineProperty(exports, "listCheckpoints", { enumerable: true, get: function () { return cli_json_js_1.listCheckpoints; } });
Object.defineProperty(exports, "listSessions", { enumerable: true, get: function () { return cli_json_js_1.listSessions; } });
Object.defineProperty(exports, "restoreCheckpoint", { enumerable: true, get: function () { return cli_json_js_1.restoreCheckpoint; } });
Object.defineProperty(exports, "runCliJson", { enumerable: true, get: function () { return cli_json_js_1.runCliJson; } });
Object.defineProperty(exports, "showCheckpoint", { enumerable: true, get: function () { return cli_json_js_1.showCheckpoint; } });
Object.defineProperty(exports, "showSession", { enumerable: true, get: function () { return cli_json_js_1.showSession; } });
