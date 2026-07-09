"use strict";
/**
 * Browser-safe entry — protocol types, NDJSON framing, and the bg-* frame
 * helpers used by web-panel. No Node imports.
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
exports.encodeNdjson = exports.createNdjsonDecoder = void 0;
exports.bgRequest = bgRequest;
exports.isBgPushFrame = isBgPushFrame;
__exportStar(require("./protocol.js"), exports);
var ndjson_js_1 = require("./ndjson.js");
Object.defineProperty(exports, "createNdjsonDecoder", { enumerable: true, get: function () { return ndjson_js_1.createNdjsonDecoder; } });
Object.defineProperty(exports, "encodeNdjson", { enumerable: true, get: function () { return ndjson_js_1.encodeNdjson; } });
/** Build a typed bg-* request frame for the WS gateway. */
function bgRequest(type, fields = {}) {
    return { type, ...fields };
}
function isBgPushFrame(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const frame = value;
    return ((frame.type === "bg-event" || frame.type === "bg-log") &&
        typeof frame.bgId === "string");
}
