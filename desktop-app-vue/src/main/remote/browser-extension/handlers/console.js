/**
 * Bounded Runtime/Log capture for console.* and page.getConsole commands.
 */

/* eslint-disable no-undef */
/* global chrome */

import { ConsoleCaptureRegistry } from "./console-capture-registry.js";
import { utf8ByteLength } from "./heap-snapshot-boundary.js";

export const CONSOLE_SANITIZATION_LIMITS = Object.freeze({
  maxTextChars: 512,
  maxArgs: 32,
  maxStackFrames: 32,
});

const consoleCaptures = new ConsoleCaptureRegistry();

const CONSOLE_TYPES = new Set([
  "log",
  "debug",
  "info",
  "error",
  "warning",
  "warn",
  "dir",
  "dirxml",
  "table",
  "trace",
  "clear",
  "startGroup",
  "startGroupCollapsed",
  "endGroup",
  "assert",
  "profile",
  "profileEnd",
  "count",
  "timeEnd",
  "verbose",
]);
const REMOTE_TYPES = new Set([
  "object",
  "function",
  "undefined",
  "string",
  "number",
  "boolean",
  "symbol",
  "bigint",
]);

function normalizeType(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function redactText(value) {
  let text = "";
  let supported = false;
  if (typeof value === "string") {
    text = value;
    supported = true;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    text = String(value);
    supported = true;
  }
  const truncated = text.length > CONSOLE_SANITIZATION_LIMITS.maxTextChars;
  const bounded = text.slice(0, CONSOLE_SANITIZATION_LIMITS.maxTextChars);
  return Object.freeze({
    redacted: true,
    byteLength: supported ? utf8ByteLength(bounded) : null,
    truncated,
  });
}

function sanitizeRemoteObject(remoteObject) {
  if (!remoteObject || typeof remoteObject !== "object") {
    return redactText(remoteObject);
  }
  const value =
    remoteObject.value !== undefined
      ? remoteObject.value
      : remoteObject.description;
  return Object.freeze({
    ...redactText(value),
    remoteType: normalizeType(remoteObject.type, REMOTE_TYPES),
  });
}

function sanitizeStackTrace(stackTrace) {
  if (!stackTrace || !Array.isArray(stackTrace.callFrames)) {
    return undefined;
  }
  return Object.freeze({
    description: redactText(stackTrace.description),
    callFrames: Object.freeze(
      stackTrace.callFrames
        .slice(0, CONSOLE_SANITIZATION_LIMITS.maxStackFrames)
        .map((frame) =>
          Object.freeze({
            functionName: redactText(frame.functionName),
            url: redactText(frame.url),
            lineNumber: finiteNumber(frame.lineNumber),
            columnNumber: finiteNumber(frame.columnNumber),
          }),
        ),
    ),
  });
}

export function sanitizeConsoleEvent(method, params = {}) {
  if (method === "Runtime.consoleAPICalled") {
    return Object.freeze({
      type: normalizeType(params.type, CONSOLE_TYPES),
      args: Object.freeze(
        (Array.isArray(params.args) ? params.args : [])
          .slice(0, CONSOLE_SANITIZATION_LIMITS.maxArgs)
          .map(sanitizeRemoteObject),
      ),
      timestamp: finiteNumber(params.timestamp),
      stackTrace: sanitizeStackTrace(params.stackTrace),
    });
  }
  if (method === "Log.entryAdded") {
    const entry = params.entry || {};
    return Object.freeze({
      type: normalizeType(entry.level, CONSOLE_TYPES),
      text: redactText(entry.text),
      url: redactText(entry.url),
      lineNumber: finiteNumber(entry.lineNumber),
      timestamp: finiteNumber(entry.timestamp),
    });
  }
  if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails || {};
    return Object.freeze({
      type: "error",
      text: redactText(details.text),
      exception: sanitizeRemoteObject(details.exception),
      lineNumber: finiteNumber(details.lineNumber),
      columnNumber: finiteNumber(details.columnNumber),
      url: redactText(details.url),
      timestamp: finiteNumber(params.timestamp),
      stackTrace: sanitizeStackTrace(details.stackTrace),
    });
  }
  return null;
}

function removeCaptureListeners(resources) {
  if (!resources) {
    return;
  }
  try {
    chrome.debugger.onEvent.removeListener(resources.eventListener);
  } catch {
    // The event target may already be gone after a tab closes.
  }
  try {
    chrome.debugger.onDetach.removeListener(resources.detachListener);
  } catch {
    // The event target may already be gone after a tab closes.
  }
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    return null;
  } catch {
    return error;
  }
}

export async function enableConsoleCapture(tabId) {
  const admission = consoleCaptures.admit(tabId);
  if (!admission.accepted) {
    return admission;
  }

  let debuggerAttached = false;
  let resources = null;
  const eventListener = (source, method, params) => {
    if (source?.tabId !== tabId) {
      return;
    }
    const entry = sanitizeConsoleEvent(method, params);
    if (entry) {
      consoleCaptures.append(admission.lease, entry);
    }
  };
  const detachListener = (source) => {
    if (source?.tabId !== tabId) {
      return;
    }
    removeCaptureListeners(resources);
    consoleCaptures.complete(admission.lease);
  };

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerAttached = true;
    resources = { eventListener, detachListener };
    chrome.debugger.onEvent.addListener(eventListener);
    chrome.debugger.onDetach.addListener(detachListener);
    consoleCaptures.bindResources(admission.lease, resources);

    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");
    if (!consoleCaptures.markActive(admission.lease)) {
      throw new Error("Console capture detached before startup completed");
    }

    return {
      success: true,
      limits: consoleCaptures.getStats().limits,
    };
  } catch {
    removeCaptureListeners(resources);
    if (debuggerAttached) {
      await detachDebugger(tabId);
    }
    consoleCaptures.failStart(admission.lease);
    return {
      error: "Console capture failed",
      code: "CONSOLE_CAPTURE_FAILED",
    };
  }
}

export async function disableConsoleCapture(tabId) {
  const stopAdmission = consoleCaptures.beginStop(tabId);
  if (!stopAdmission.accepted) {
    return {
      error: stopAdmission.error,
      code: stopAdmission.code,
      ...(stopAdmission.retryAfterMs
        ? { retryAfterMs: stopAdmission.retryAfterMs }
        : {}),
    };
  }

  const { capture } = stopAdmission;
  let commandError = null;
  for (const method of ["Runtime.disable", "Log.disable"]) {
    try {
      await chrome.debugger.sendCommand({ tabId }, method);
    } catch (error) {
      commandError ||= error;
    }
  }
  const detachError = await detachDebugger(tabId);
  removeCaptureListeners(capture.resources);
  consoleCaptures.complete(capture.lease);

  if (commandError || detachError) {
    return {
      error: "Console capture shutdown failed",
      code: "CONSOLE_CAPTURE_SHUTDOWN_FAILED",
    };
  }
  return { success: true };
}

export function getConsoleLogs(tabId) {
  return consoleCaptures.getLogs(tabId);
}

export function clearConsoleLogs(tabId) {
  consoleCaptures.clear(tabId);
  return { success: true };
}

export const consoleHandlers = {
  "page.getConsole": ({ tabId }) => getConsoleLogs(tabId),
  "console.enable": ({ tabId }) => enableConsoleCapture(tabId),
  "console.disable": ({ tabId }) => disableConsoleCapture(tabId),
  "console.getLogs": ({ tabId }) => getConsoleLogs(tabId),
  "console.clear": ({ tabId }) => clearConsoleLogs(tabId),
};
