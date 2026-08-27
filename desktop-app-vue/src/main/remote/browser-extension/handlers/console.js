/**
 * Bounded Runtime/Log capture for console.* and page.getConsole commands.
 */

/* eslint-disable no-undef */
/* global chrome */

import { ConsoleCaptureRegistry } from "./console-capture-registry.js";

export const CONSOLE_SANITIZATION_LIMITS = Object.freeze({
  maxTextChars: 512,
  maxArgs: 32,
  maxStackFrames: 32,
});

const consoleCaptures = new ConsoleCaptureRegistry();

function truncate(value) {
  if (typeof value === "string") {
    return value.slice(0, CONSOLE_SANITIZATION_LIMITS.maxTextChars);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}

function sanitizeRemoteObject(remoteObject) {
  if (!remoteObject || typeof remoteObject !== "object") {
    return truncate(remoteObject);
  }
  const value =
    remoteObject.value !== undefined
      ? truncate(remoteObject.value)
      : truncate(remoteObject.description) || truncate(remoteObject.type);
  return value;
}

function sanitizeStackTrace(stackTrace) {
  if (!stackTrace || !Array.isArray(stackTrace.callFrames)) {
    return undefined;
  }
  return {
    description: truncate(stackTrace.description),
    callFrames: stackTrace.callFrames
      .slice(0, CONSOLE_SANITIZATION_LIMITS.maxStackFrames)
      .map((frame) => ({
        functionName: truncate(frame.functionName),
        url: truncate(frame.url),
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      })),
  };
}

export function sanitizeConsoleEvent(method, params = {}) {
  if (method === "Runtime.consoleAPICalled") {
    return {
      type: truncate(params.type),
      args: (Array.isArray(params.args) ? params.args : [])
        .slice(0, CONSOLE_SANITIZATION_LIMITS.maxArgs)
        .map(sanitizeRemoteObject),
      timestamp: params.timestamp,
      stackTrace: sanitizeStackTrace(params.stackTrace),
    };
  }
  if (method === "Log.entryAdded") {
    const entry = params.entry || {};
    return {
      type: truncate(entry.level),
      text: truncate(entry.text),
      url: truncate(entry.url),
      lineNumber: entry.lineNumber,
      timestamp: entry.timestamp,
    };
  }
  if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails || {};
    return {
      type: "error",
      text: truncate(details.text),
      exception: sanitizeRemoteObject(details.exception),
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
      url: truncate(details.url),
      timestamp: params.timestamp,
      stackTrace: sanitizeStackTrace(details.stackTrace),
    };
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
  } catch (error) {
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
  } catch (error) {
    removeCaptureListeners(resources);
    if (debuggerAttached) {
      await detachDebugger(tabId);
    }
    consoleCaptures.failStart(admission.lease);
    return { error: error.message };
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
    return { error: (commandError || detachError).message };
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
