/**
 * Input Recording command handlers (Phase 18) for the ChainlessChain Browser
 * Bridge.
 *
 * Records DOM input events (click/key/input/focus/...) in page context, then
 * replays them: start/stop/get/replay/clear. Keeps per-tab inputRecordingState.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency. inputRecordingState moves with the handlers (verified no external
 * refs).
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, window, document, Date, MouseEvent, KeyboardEvent, Event, setTimeout, Promise */

const inputRecordingState = new Map();

export async function startInputRecording(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        window.__chainlessInputRecording = {
          startTime: Date.now(),
          events: [],
          options: opts,
        };

        const recordEvent = (event) => {
          const rec = window.__chainlessInputRecording;
          if (!rec) return;

          rec.events.push({
            type: event.type,
            timestamp: Date.now() - rec.startTime,
            target: {
              tagName: event.target.tagName,
              id: event.target.id,
              className: event.target.className,
              selector: event.target.id
                ? `#${event.target.id}`
                : event.target.className
                  ? `.${event.target.className.split(" ")[0]}`
                  : event.target.tagName.toLowerCase(),
            },
            data: {
              key: event.key,
              code: event.code,
              keyCode: event.keyCode,
              button: event.button,
              clientX: event.clientX,
              clientY: event.clientY,
              value: event.target.value,
              checked: event.target.checked,
            },
          });
        };

        const eventTypes = opts.eventTypes || [
          "click",
          "dblclick",
          "keydown",
          "keyup",
          "input",
          "change",
          "focus",
          "blur",
        ];
        window.__chainlessInputHandlers = [];

        eventTypes.forEach((type) => {
          document.addEventListener(type, recordEvent, true);
          window.__chainlessInputHandlers.push({ type, handler: recordEvent });
        });

        return {
          success: true,
          startTime: window.__chainlessInputRecording.startTime,
        };
      },
      args: [options],
    });

    inputRecordingState.set(tabId, { started: Date.now() });
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
          duration: rec?.duration || 0,
        };
      },
    });

    inputRecordingState.delete(tabId);
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
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (rec, opts) => {
        const speed = opts.speed || 1;
        const events = rec.events || [];
        let replayed = 0;

        for (const event of events) {
          const delay = event.timestamp / speed;
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              delay - (events[replayed - 1]?.timestamp || 0) / speed,
            ),
          );

          const target =
            document.querySelector(event.target.selector) ||
            document.querySelector(
              event.target.id ? `#${event.target.id}` : event.target.tagName,
            );

          if (target) {
            if (event.type === "click" || event.type === "dblclick") {
              target.dispatchEvent(
                new MouseEvent(event.type, {
                  bubbles: true,
                  cancelable: true,
                  clientX: event.data.clientX,
                  clientY: event.data.clientY,
                  button: event.data.button,
                }),
              );
            } else if (event.type === "keydown" || event.type === "keyup") {
              target.dispatchEvent(
                new KeyboardEvent(event.type, {
                  bubbles: true,
                  cancelable: true,
                  key: event.data.key,
                  code: event.data.code,
                  keyCode: event.data.keyCode,
                }),
              );
            } else if (event.type === "input" || event.type === "change") {
              if (event.data.value !== undefined) {
                target.value = event.data.value;
              }
              if (event.data.checked !== undefined) {
                target.checked = event.data.checked;
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
      args: [recording, options],
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
