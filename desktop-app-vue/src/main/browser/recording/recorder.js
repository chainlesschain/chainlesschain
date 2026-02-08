/**
 * Browser Recorder - Record user actions for playback
 *
 * @module browser/recording/recorder
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../utils/logger");

/**
 * Recordable event types
 */
const EventType = {
  CLICK: "click",
  TYPE: "type",
  SCROLL: "scroll",
  NAVIGATE: "navigate",
  KEY: "key",
  SELECT: "select",
  HOVER: "hover",
  FOCUS: "focus",
  BLUR: "blur",
  SUBMIT: "submit",
  DRAG: "drag",
  DROP: "drop",
  WAIT: "wait",
};

/**
 * Recording state
 */
const RecordingState = {
  IDLE: "idle",
  RECORDING: "recording",
  PAUSED: "paused",
};

/**
 * Browser Recorder
 * Captures user interactions for later playback
 */
class BrowserRecorder extends EventEmitter {
  constructor(browserEngine) {
    super();
    this.browserEngine = browserEngine;
    this.recordings = new Map(); // targetId => recording session
  }

  /**
   * Start recording user actions
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Recording options
   * @returns {Promise<Object>} Recording info
   */
  async startRecording(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);

    // Stop existing recording if any
    if (this.recordings.has(targetId)) {
      await this.stopRecording(targetId);
    }

    const recordingId = uuidv4();
    const {
      includeScrolls = true,
      includeHovers = false,
      captureScreenshots = false,
      screenshotInterval = 5000,
      minTimeBetweenEvents = 50,
    } = options;

    const session = {
      id: recordingId,
      targetId,
      state: RecordingState.RECORDING,
      startTime: Date.now(),
      startUrl: page.url(),
      events: [],
      screenshots: [],
      options,
      lastEventTime: 0,
    };

    this.recordings.set(targetId, session);

    try {
      // Inject recording scripts into page
      await page.evaluate(
        ({ config }) => {
          window.__recorder = {
            events: [],
            lastEventTime: 0,
            config,
          };

          // Helper to get element selector
          function getSelector(el) {
            if (!el || el === document) {
              return null;
            }

            if (el.id) {
              return `#${el.id}`;
            }

            if (el.getAttribute("data-testid")) {
              return `[data-testid="${el.getAttribute("data-testid")}"]`;
            }

            // Build path
            const path = [];
            let current = el;

            while (current && current !== document.body) {
              let selector = current.tagName.toLowerCase();

              if (current.id) {
                path.unshift(`#${current.id}`);
                break;
              }

              const siblings = Array.from(
                current.parentElement?.children || [],
              ).filter((s) => s.tagName === current.tagName);

              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
              }

              path.unshift(selector);
              current = current.parentElement;
            }

            return path.join(" > ");
          }

          // Helper to get element info
          function getElementInfo(el) {
            if (!el) {
              return null;
            }

            const rect = el.getBoundingClientRect();
            return {
              selector: getSelector(el),
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className || null,
              text: el.textContent?.substring(0, 50) || null,
              position: {
                x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + rect.height / 2),
              },
              attributes: {
                type: el.getAttribute("type"),
                name: el.getAttribute("name"),
                placeholder: el.getAttribute("placeholder"),
                role: el.getAttribute("role"),
              },
            };
          }

          // Record event helper
          function recordEvent(type, data) {
            const now = Date.now();
            if (
              now - window.__recorder.lastEventTime <
              config.minTimeBetweenEvents
            ) {
              return; // Debounce
            }

            const event = {
              type,
              timestamp: now,
              timeSinceStart: now - window.__recorder.startTime,
              ...data,
            };

            window.__recorder.events.push(event);
            window.__recorder.lastEventTime = now;

            // Notify main process
            window.dispatchEvent(
              new CustomEvent("recorder:event", { detail: event }),
            );
          }

          window.__recorder.startTime = Date.now();

          // Click handler
          document.addEventListener(
            "click",
            (e) => {
              recordEvent("click", {
                element: getElementInfo(e.target),
                button: e.button,
                clientX: e.clientX,
                clientY: e.clientY,
              });
            },
            true,
          );

          // Input handler
          document.addEventListener(
            "input",
            (e) => {
              if (
                e.target.tagName === "INPUT" ||
                e.target.tagName === "TEXTAREA"
              ) {
                // Debounce typing - handled by coalescing in post-processing
                recordEvent("type", {
                  element: getElementInfo(e.target),
                  value: e.target.value,
                  inputType: e.inputType,
                });
              }
            },
            true,
          );

          // Change handler (for select)
          document.addEventListener(
            "change",
            (e) => {
              if (e.target.tagName === "SELECT") {
                recordEvent("select", {
                  element: getElementInfo(e.target),
                  value: e.target.value,
                  selectedText: e.target.options[e.target.selectedIndex]?.text,
                });
              }
            },
            true,
          );

          // Key handler
          document.addEventListener(
            "keydown",
            (e) => {
              // Only record special keys
              const specialKeys = [
                "Enter",
                "Escape",
                "Tab",
                "Backspace",
                "Delete",
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
              ];
              const hasModifier = e.ctrlKey || e.altKey || e.metaKey;

              if (specialKeys.includes(e.key) || hasModifier) {
                recordEvent("key", {
                  element: getElementInfo(e.target),
                  key: e.key,
                  code: e.code,
                  ctrlKey: e.ctrlKey,
                  altKey: e.altKey,
                  shiftKey: e.shiftKey,
                  metaKey: e.metaKey,
                });
              }
            },
            true,
          );

          // Scroll handler
          if (config.includeScrolls) {
            let scrollTimeout;
            window.addEventListener(
              "scroll",
              () => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                  recordEvent("scroll", {
                    scrollX: window.scrollX,
                    scrollY: window.scrollY,
                    scrollPercentage: Math.round(
                      (window.scrollY /
                        (document.body.scrollHeight - window.innerHeight)) *
                        100,
                    ),
                  });
                }, 150);
              },
              true,
            );
          }

          // Hover handler (optional)
          if (config.includeHovers) {
            let lastHoverTarget = null;
            document.addEventListener(
              "mouseover",
              (e) => {
                if (
                  e.target !== lastHoverTarget &&
                  e.target.matches('a, button, [role="button"]')
                ) {
                  lastHoverTarget = e.target;
                  recordEvent("hover", {
                    element: getElementInfo(e.target),
                  });
                }
              },
              true,
            );
          }

          // Form submit
          document.addEventListener(
            "submit",
            (e) => {
              recordEvent("submit", {
                element: getElementInfo(e.target),
                formAction: e.target.action,
              });
            },
            true,
          );

          // Navigation detection
          const originalPushState = history.pushState;
          history.pushState = function (...args) {
            originalPushState.apply(this, args);
            recordEvent("navigate", {
              url: window.location.href,
              type: "pushState",
            });
          };

          window.addEventListener("popstate", () => {
            recordEvent("navigate", {
              url: window.location.href,
              type: "popstate",
            });
          });

          return true;
        },
        {
          config: {
            includeScrolls,
            includeHovers,
            minTimeBetweenEvents,
          },
        },
      );

      // Listen for events from page
      await page.exposeFunction("__recorderEvent", (event) => {
        const recording = this.recordings.get(targetId);
        if (recording && recording.state === RecordingState.RECORDING) {
          recording.events.push(event);
          this.emit("event", { targetId, event });
        }
      });

      await page.evaluate(() => {
        window.addEventListener("recorder:event", (e) => {
          window.__recorderEvent(e.detail);
        });
      });

      // Screenshot capture (optional)
      if (captureScreenshots) {
        session.screenshotTimer = setInterval(async () => {
          try {
            const screenshot = await page.screenshot({
              type: "jpeg",
              quality: 60,
            });
            session.screenshots.push({
              timestamp: Date.now(),
              data: screenshot.toString("base64"),
            });
          } catch (e) {
            // Page might be navigating
          }
        }, screenshotInterval);
      }

      logger.info("[BrowserRecorder] Recording started", {
        recordingId,
        targetId,
        url: session.startUrl,
      });

      this.emit("recording:started", { recordingId, targetId });

      return {
        success: true,
        recordingId,
        targetId,
        startUrl: session.startUrl,
      };
    } catch (error) {
      this.recordings.delete(targetId);
      logger.error("[BrowserRecorder] Failed to start recording", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Stop recording
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<Object>} Recording data
   */
  async stopRecording(targetId) {
    const session = this.recordings.get(targetId);
    if (!session) {
      throw new Error(`No recording found for tab ${targetId}`);
    }

    try {
      const page = this.browserEngine.getPage(targetId);

      // Get final events from page
      const pageEvents = await page.evaluate(() => {
        const events = window.__recorder?.events || [];
        window.__recorder = null;
        return events;
      });

      // Merge any remaining events
      const allEvents = [...session.events];
      for (const event of pageEvents) {
        if (!allEvents.some((e) => e.timestamp === event.timestamp)) {
          allEvents.push(event);
        }
      }

      // Sort by timestamp
      allEvents.sort((a, b) => a.timestamp - b.timestamp);

      // Clear screenshot timer
      if (session.screenshotTimer) {
        clearInterval(session.screenshotTimer);
      }

      const endTime = Date.now();
      const recording = {
        id: session.id,
        name: `Recording ${new Date().toLocaleString()}`,
        startUrl: session.startUrl,
        endUrl: page.url(),
        events: this._processEvents(allEvents),
        screenshots: session.screenshots,
        duration: endTime - session.startTime,
        eventCount: allEvents.length,
        startTime: session.startTime,
        endTime,
        options: session.options,
      };

      this.recordings.delete(targetId);

      logger.info("[BrowserRecorder] Recording stopped", {
        recordingId: recording.id,
        eventCount: recording.eventCount,
        duration: recording.duration,
      });

      this.emit("recording:stopped", { recording });

      return recording;
    } catch (error) {
      this.recordings.delete(targetId);
      logger.error("[BrowserRecorder] Failed to stop recording", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Pause recording
   * @param {string} targetId - Browser tab ID
   * @returns {boolean}
   */
  pauseRecording(targetId) {
    const session = this.recordings.get(targetId);
    if (!session) {
      return false;
    }

    session.state = RecordingState.PAUSED;
    session.pausedAt = Date.now();

    this.emit("recording:paused", { targetId });
    return true;
  }

  /**
   * Resume recording
   * @param {string} targetId - Browser tab ID
   * @returns {boolean}
   */
  resumeRecording(targetId) {
    const session = this.recordings.get(targetId);
    if (!session || session.state !== RecordingState.PAUSED) {
      return false;
    }

    session.state = RecordingState.RECORDING;
    delete session.pausedAt;

    this.emit("recording:resumed", { targetId });
    return true;
  }

  /**
   * Get recording status
   * @param {string} targetId - Browser tab ID
   * @returns {Object|null}
   */
  getStatus(targetId) {
    const session = this.recordings.get(targetId);
    if (!session) {
      return null;
    }

    return {
      recordingId: session.id,
      state: session.state,
      eventCount: session.events.length,
      duration: Date.now() - session.startTime,
      startUrl: session.startUrl,
    };
  }

  /**
   * Check if recording
   * @param {string} targetId - Browser tab ID
   * @returns {boolean}
   */
  isRecording(targetId) {
    const session = this.recordings.get(targetId);
    return session?.state === RecordingState.RECORDING;
  }

  /**
   * Process events (coalesce typing, etc.)
   * @private
   */
  _processEvents(events) {
    const processed = [];
    let currentTyping = null;

    for (const event of events) {
      if (event.type === "type") {
        // Coalesce consecutive typing on same element
        if (
          currentTyping &&
          currentTyping.element?.selector === event.element?.selector &&
          event.timestamp - currentTyping.timestamp < 2000
        ) {
          currentTyping.value = event.value;
          currentTyping.endTimestamp = event.timestamp;
          continue;
        }

        // Start new typing sequence
        if (currentTyping) {
          processed.push(currentTyping);
        }
        currentTyping = { ...event };
      } else {
        // Non-typing event
        if (currentTyping) {
          processed.push(currentTyping);
          currentTyping = null;
        }
        processed.push(event);
      }
    }

    // Don't forget last typing event
    if (currentTyping) {
      processed.push(currentTyping);
    }

    return processed;
  }

  /**
   * Convert recording to workflow
   * @param {Object} recording - Recording data
   * @returns {Object} Workflow definition
   */
  toWorkflow(recording) {
    const { createWorkflow } = require("../workflow/workflow-builder");

    const builder = createWorkflow(recording.name || "Recorded Workflow")
      .description(`Recorded from ${recording.startUrl}`)
      .tags("recorded", "automation");

    // Navigate to start URL
    builder.navigate(recording.startUrl);

    // Convert events to workflow steps
    for (const event of recording.events) {
      switch (event.type) {
        case EventType.CLICK:
          if (event.element?.selector) {
            builder.step({
              type: "action",
              action: "click",
              selector: event.element.selector,
              description: `Click ${event.element.text || event.element.tag}`,
            });
          }
          break;

        case EventType.TYPE:
          if (event.element?.selector && event.value) {
            builder.step({
              type: "action",
              action: "type",
              selector: event.element.selector,
              text: event.value,
              description: `Type in ${event.element.tag}`,
            });
          }
          break;

        case EventType.SELECT:
          if (event.element?.selector) {
            builder.step({
              type: "action",
              action: "select",
              selector: event.element.selector,
              value: event.value,
              description: `Select "${event.selectedText}"`,
            });
          }
          break;

        case EventType.KEY:
          if (event.key) {
            const modifiers = [];
            if (event.ctrlKey) {
              modifiers.push("Control");
            }
            if (event.altKey) {
              modifiers.push("Alt");
            }
            if (event.shiftKey) {
              modifiers.push("Shift");
            }
            if (event.metaKey) {
              modifiers.push("Meta");
            }

            builder.step({
              type: "action",
              action: "keyboard",
              keys: event.key,
              modifiers,
              description: `Press ${[...modifiers, event.key].join("+")}`,
            });
          }
          break;

        case EventType.NAVIGATE:
          builder.step({
            type: "action",
            action: "navigate",
            url: event.url,
            description: `Navigate to ${event.url}`,
          });
          break;

        case EventType.SCROLL:
          builder.step({
            type: "action",
            action: "scroll",
            direction: "down",
            toPosition: { x: event.scrollX, y: event.scrollY },
            description: `Scroll to ${event.scrollPercentage}%`,
          });
          break;
      }
    }

    return builder.build();
  }
}

module.exports = {
  BrowserRecorder,
  EventType,
  RecordingState,
};
