/**
 * Input Recording command handlers (Phase 18) for the ChainlessChain Browser
 * Bridge.
 *
 * Records DOM input events (click/key/input/focus/...) in page context, then
 * replays them: start/stop/get/replay/clear. Recording data stays in the page.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, window, document, Date, MouseEvent, KeyboardEvent, Event, setTimeout, Promise */

const ALLOWED_INPUT_EVENT_TYPES = Object.freeze([
  "click",
  "dblclick",
  "keydown",
  "keyup",
  "input",
  "change",
  "focus",
  "blur",
]);

export const DEFAULT_INPUT_RECORDING_LIMITS = Object.freeze({
  maxEvents: 1000,
  maxTextChars: 2048,
});

export const HARD_INPUT_RECORDING_LIMITS = Object.freeze({
  maxEvents: 10_000,
  maxTextChars: 16_384,
});

export const DEFAULT_INPUT_REPLAY_LIMITS = Object.freeze({
  maxEvents: 1000,
  maxDurationMs: 60_000,
  maxStepDelayMs: 5000,
});

export const HARD_INPUT_REPLAY_LIMITS = Object.freeze({
  maxEvents: 10_000,
  maxDurationMs: 5 * 60 * 1000,
  maxStepDelayMs: 30_000,
});

function normalizePositiveInteger(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

export function normalizeInputRecordingOptions(options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const requestedTypes = Array.isArray(safeOptions.eventTypes)
    ? safeOptions.eventTypes
    : ALLOWED_INPUT_EVENT_TYPES;
  const eventTypes = Object.freeze([
    ...new Set(
      requestedTypes.filter((type) => ALLOWED_INPUT_EVENT_TYPES.includes(type)),
    ),
  ]);

  return Object.freeze({
    eventTypes,
    maxEvents: normalizePositiveInteger(
      safeOptions.maxEvents,
      DEFAULT_INPUT_RECORDING_LIMITS.maxEvents,
      HARD_INPUT_RECORDING_LIMITS.maxEvents,
    ),
    maxTextChars: normalizePositiveInteger(
      safeOptions.maxTextChars,
      DEFAULT_INPUT_RECORDING_LIMITS.maxTextChars,
      HARD_INPUT_RECORDING_LIMITS.maxTextChars,
    ),
  });
}

export function normalizeInputReplayOptions(options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  let speed;
  try {
    speed = Number(safeOptions.speed);
  } catch {
    speed = 1;
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    speed = 1;
  }

  return Object.freeze({
    speed: Math.min(Math.max(speed, 0.1), 100),
    maxEvents: normalizePositiveInteger(
      safeOptions.maxEvents,
      DEFAULT_INPUT_REPLAY_LIMITS.maxEvents,
      HARD_INPUT_REPLAY_LIMITS.maxEvents,
    ),
    maxDurationMs: normalizePositiveInteger(
      safeOptions.maxDurationMs,
      DEFAULT_INPUT_REPLAY_LIMITS.maxDurationMs,
      HARD_INPUT_REPLAY_LIMITS.maxDurationMs,
    ),
    maxStepDelayMs: normalizePositiveInteger(
      safeOptions.maxStepDelayMs,
      DEFAULT_INPUT_REPLAY_LIMITS.maxStepDelayMs,
      HARD_INPUT_REPLAY_LIMITS.maxStepDelayMs,
    ),
  });
}

export async function startInputRecording(tabId, options = {}) {
  const normalizedOptions = normalizeInputRecordingOptions(options);
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        if (window.__chainlessInputHandlers) {
          window.__chainlessInputHandlers.forEach(({ type, handler }) => {
            document.removeEventListener(type, handler, true);
          });
        }

        window.__chainlessInputRecording = {
          startTime: Date.now(),
          events: [],
          droppedEvents: 0,
          totalEvents: 0,
          overflowed: false,
          options: opts,
        };

        const recordEvent = (event) => {
          const rec = window.__chainlessInputRecording;
          if (!rec) return;

          rec.totalEvents += 1;
          if (rec.events.length >= rec.options.maxEvents) {
            rec.droppedEvents += 1;
            rec.overflowed = true;
            return;
          }

          const truncate = (value) =>
            typeof value === "string"
              ? value.slice(0, rec.options.maxTextChars)
              : typeof value === "number" || typeof value === "boolean"
                ? value
                : undefined;
          const target = event.target || {};
          const tagName =
            typeof target.tagName === "string" ? target.tagName : "UNKNOWN";
          const id = truncate(typeof target.id === "string" ? target.id : "");
          const className = truncate(
            typeof target.className === "string" ? target.className : "",
          );
          const selector = id
            ? `#${id}`
            : className
              ? `.${className.split(" ")[0]}`
              : tagName.toLowerCase();

          rec.events.push({
            type: event.type,
            timestamp: Date.now() - rec.startTime,
            target: {
              tagName,
              id,
              className,
              selector,
            },
            data: {
              key: truncate(event.key),
              code: truncate(event.code),
              keyCode: event.keyCode,
              button: event.button,
              clientX: event.clientX,
              clientY: event.clientY,
              value: truncate(target.value),
              checked: target.checked,
            },
          });
        };

        window.__chainlessInputHandlers = [];

        opts.eventTypes.forEach((type) => {
          document.addEventListener(type, recordEvent, true);
          window.__chainlessInputHandlers.push({ type, handler: recordEvent });
        });

        return {
          success: true,
          startTime: window.__chainlessInputRecording.startTime,
          limits: {
            maxEvents: opts.maxEvents,
            maxTextChars: opts.maxTextChars,
            eventTypes: opts.eventTypes.length,
          },
        };
      },
      args: [normalizedOptions],
    });

    return result[0]?.result || { error: "Failed to start recording" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopInputRecording(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessInputHandlers) {
          window.__chainlessInputHandlers.forEach(({ type, handler }) => {
            document.removeEventListener(type, handler, true);
          });
          window.__chainlessInputHandlers = null;
        }

        const rec = window.__chainlessInputRecording;
        if (rec) {
          rec.endTime = Date.now();
          rec.duration = rec.endTime - rec.startTime;
        }

        return {
          success: true,
          eventCount: rec?.events?.length || 0,
          droppedEvents: rec?.droppedEvents || 0,
          overflowed: rec?.overflowed || false,
          duration: rec?.duration || 0,
        };
      },
    });

    return result[0]?.result || { error: "Failed to stop recording" };
  } catch (error) {
    return { error: error.message };
  }
}

export function getInputRecording(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => window.__chainlessInputRecording || null,
    })
    .then((result) => result[0]?.result || null);
}

export async function replayInputs(tabId, recording, options = {}) {
  const normalizedOptions = normalizeInputReplayOptions(options);
  const events = Array.isArray(recording?.events) ? recording.events : null;
  if (!events) {
    return {
      error: "Input recording must contain an events array",
      code: "INVALID_INPUT_RECORDING",
    };
  }
  if (events.length > normalizedOptions.maxEvents) {
    return {
      error: "Input replay event limit exceeded",
      code: "INPUT_REPLAY_LIMIT_EXCEEDED",
      limit: { maxEvents: normalizedOptions.maxEvents },
      received: { events: events.length },
    };
  }

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (rec, opts) => {
        const events = rec.events || [];
        const replayStartedAt = Date.now();
        let replayed = 0;

        for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
          const event = events[eventIndex];
          if (!event || typeof event !== "object") {
            continue;
          }
          const elapsed = Date.now() - replayStartedAt;
          const remaining = opts.maxDurationMs - elapsed;
          if (remaining <= 0) {
            return {
              success: false,
              error: "Input replay deadline exceeded",
              code: "INPUT_REPLAY_DEADLINE_EXCEEDED",
              replayed,
              total: events.length,
              limit: { maxDurationMs: opts.maxDurationMs },
            };
          }

          const previousTimestamp = events[eventIndex - 1]?.timestamp;
          const currentTimestamp =
            typeof event.timestamp === "number" &&
            Number.isFinite(event.timestamp)
              ? event.timestamp
              : 0;
          const safePreviousTimestamp =
            typeof previousTimestamp === "number" &&
            Number.isFinite(previousTimestamp)
              ? previousTimestamp
              : 0;
          const rawDelay =
            (currentTimestamp - safePreviousTimestamp) / opts.speed;
          const delay = Math.min(
            Math.max(Number.isFinite(rawDelay) ? rawDelay : 0, 0),
            opts.maxStepDelayMs,
            remaining,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));

          const targetDescriptor = event.target || {};
          const eventData = event.data || {};
          const target =
            document.querySelector(targetDescriptor.selector) ||
            document.querySelector(
              targetDescriptor.id
                ? `#${targetDescriptor.id}`
                : targetDescriptor.tagName,
            );

          if (target) {
            if (event.type === "click" || event.type === "dblclick") {
              target.dispatchEvent(
                new MouseEvent(event.type, {
                  bubbles: true,
                  cancelable: true,
                  clientX: eventData.clientX,
                  clientY: eventData.clientY,
                  button: eventData.button,
                }),
              );
            } else if (event.type === "keydown" || event.type === "keyup") {
              target.dispatchEvent(
                new KeyboardEvent(event.type, {
                  bubbles: true,
                  cancelable: true,
                  key: eventData.key,
                  code: eventData.code,
                  keyCode: eventData.keyCode,
                }),
              );
            } else if (event.type === "input" || event.type === "change") {
              if (eventData.value !== undefined) {
                target.value = eventData.value;
              }
              if (eventData.checked !== undefined) {
                target.checked = eventData.checked;
              }
              target.dispatchEvent(new Event(event.type, { bubbles: true }));
            } else if (event.type === "focus") {
              target.focus();
            } else if (event.type === "blur") {
              target.blur();
            }
            replayed++;
          }
        }

        return { success: true, replayed, total: events.length };
      },
      args: [recording, normalizedOptions],
    });
    return result[0]?.result || { error: "Failed to replay" };
  } catch (error) {
    return { error: error.message };
  }
}

export function clearInputRecording(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessInputHandlers) {
          window.__chainlessInputHandlers.forEach(({ type, handler }) => {
            document.removeEventListener(type, handler, true);
          });
          window.__chainlessInputHandlers = null;
        }
        window.__chainlessInputRecording = null;
        return { success: true };
      },
    })
    .then((result) => result[0]?.result || { success: false });
}

export const inputHandlers = {
  "input.startRecording": ({ tabId, options }) =>
    startInputRecording(tabId, options),
  "input.stopRecording": ({ tabId }) => stopInputRecording(tabId),
  "input.getRecording": ({ tabId }) => getInputRecording(tabId),
  "input.replay": ({ tabId, recording, options }) =>
    replayInputs(tabId, recording, options),
  "input.clearRecording": ({ tabId }) => clearInputRecording(tabId),
};
