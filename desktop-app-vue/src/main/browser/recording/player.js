/**
 * Recording Player - Play back recorded user actions
 *
 * @module browser/recording/player
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../utils/logger");
const { EventType } = require("./recorder");

/**
 * Playback state
 */
const PlaybackState = {
  IDLE: "idle",
  PLAYING: "playing",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * Playback speed presets
 */
const PlaybackSpeed = {
  SLOW: 0.5,
  NORMAL: 1,
  FAST: 2,
  FASTEST: 4,
};

/**
 * Recording Player
 * Plays back recorded interactions
 */
class RecordingPlayer extends EventEmitter {
  constructor(browserEngine) {
    super();
    this.browserEngine = browserEngine;
    this.playbacks = new Map(); // playbackId => playback session
  }

  /**
   * Play a recording
   * @param {Object} recording - Recording data
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Playback options
   * @returns {Promise<Object>} Playback result
   */
  async play(recording, targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const playbackId = uuidv4();

    const {
      speed = PlaybackSpeed.NORMAL,
      stepMode = false, // Pause after each step
      visualFeedback = true, // Highlight elements
      skipNavigations = false, // Skip navigation events
      timeout = 30000, // Step timeout
      startFromEvent = 0, // Start from specific event index
    } = options;

    const session = {
      id: playbackId,
      recordingId: recording.id,
      targetId,
      state: PlaybackState.PLAYING,
      currentEventIndex: startFromEvent,
      totalEvents: recording.events.length,
      speed,
      stepMode,
      startTime: Date.now(),
      results: [],
      pauseRequested: false,
      cancelRequested: false,
      resumeResolve: null,
    };

    this.playbacks.set(playbackId, session);

    try {
      // Inject visual feedback helper if enabled
      if (visualFeedback) {
        await this._injectVisualFeedback(page);
      }

      // Navigate to start URL if needed
      if (
        !skipNavigations &&
        recording.startUrl &&
        page.url() !== recording.startUrl
      ) {
        await page.goto(recording.startUrl, {
          waitUntil: "domcontentloaded",
          timeout,
        });
      }

      this.emit("playback:started", { playbackId, recordingId: recording.id });

      // Play events
      for (let i = startFromEvent; i < recording.events.length; i++) {
        session.currentEventIndex = i;

        // Check for pause/cancel
        await this._checkPauseCancel(session);

        const event = recording.events[i];
        const prevEvent = recording.events[i - 1];

        // Calculate delay based on original timing and speed
        if (prevEvent && i > startFromEvent) {
          const originalDelay = event.timestamp - prevEvent.timestamp;
          const adjustedDelay = Math.max(50, originalDelay / speed);
          await this._delay(adjustedDelay);
        }

        // Execute event
        try {
          const result = await this._playEvent(page, targetId, event, {
            visualFeedback,
            timeout,
          });

          session.results.push({
            eventIndex: i,
            event: event.type,
            success: true,
            result,
          });

          this.emit("playback:event", {
            playbackId,
            eventIndex: i,
            total: recording.events.length,
            event: event.type,
            success: true,
          });
        } catch (error) {
          session.results.push({
            eventIndex: i,
            event: event.type,
            success: false,
            error: error.message,
          });

          this.emit("playback:event", {
            playbackId,
            eventIndex: i,
            event: event.type,
            success: false,
            error: error.message,
          });

          // Continue or stop based on event criticality
          if (event.critical !== false && !options.continueOnError) {
            throw error;
          }
        }

        // Step mode: pause after each step
        if (stepMode && i < recording.events.length - 1) {
          session.pauseRequested = true;
          await this._checkPauseCancel(session);
        }
      }

      session.state = PlaybackState.COMPLETED;
      session.endTime = Date.now();

      const result = {
        playbackId,
        state: PlaybackState.COMPLETED,
        eventsPlayed: session.results.length,
        successCount: session.results.filter((r) => r.success).length,
        failCount: session.results.filter((r) => !r.success).length,
        duration: session.endTime - session.startTime,
        results: session.results,
      };

      this.emit("playback:completed", result);

      return result;
    } catch (error) {
      session.state = PlaybackState.FAILED;
      session.error = error.message;

      this.emit("playback:failed", {
        playbackId,
        error: error.message,
        eventIndex: session.currentEventIndex,
      });

      throw error;
    } finally {
      this.playbacks.delete(playbackId);

      // Clean up visual feedback
      if (visualFeedback) {
        await page
          .evaluate(() => {
            const overlay = document.getElementById("__playbackOverlay");
            if (overlay) {
              overlay.remove();
            }
          })
          .catch(() => {});
      }
    }
  }

  /**
   * Play a single event
   * @private
   */
  async _playEvent(page, targetId, event, options = {}) {
    const { visualFeedback, timeout } = options;

    // Highlight element if visual feedback enabled
    if (visualFeedback && event.element?.selector) {
      await this._highlightElement(page, event.element.selector);
    }

    switch (event.type) {
      case EventType.CLICK:
        return this._playClick(page, targetId, event, timeout);

      case EventType.TYPE:
        return this._playType(page, targetId, event, timeout);

      case EventType.SELECT:
        return this._playSelect(page, targetId, event, timeout);

      case EventType.KEY:
        return this._playKey(page, event);

      case EventType.NAVIGATE:
        return this._playNavigate(page, event, timeout);

      case EventType.SCROLL:
        return this._playScroll(page, event);

      case EventType.HOVER:
        return this._playHover(page, targetId, event, timeout);

      default:
        logger.warn("[RecordingPlayer] Unknown event type", {
          type: event.type,
        });
        return { skipped: true, type: event.type };
    }
  }

  /**
   * Play click event
   */
  async _playClick(page, targetId, event, timeout) {
    const selector = event.element?.selector;
    if (!selector) {
      throw new Error("Click event missing element selector");
    }

    // Try to locate element
    const locator = page.locator(selector);
    await locator.waitFor({ state: "visible", timeout });
    await locator.click({
      button: event.button === 2 ? "right" : "left",
    });

    return { clicked: selector };
  }

  /**
   * Play type event
   */
  async _playType(page, targetId, event, timeout) {
    const selector = event.element?.selector;
    if (!selector) {
      throw new Error("Type event missing element selector");
    }

    const locator = page.locator(selector);
    await locator.waitFor({ state: "visible", timeout });

    // Clear and type
    await locator.fill(event.value || "");

    return { typed: event.value };
  }

  /**
   * Play select event
   */
  async _playSelect(page, targetId, event, timeout) {
    const selector = event.element?.selector;
    if (!selector) {
      throw new Error("Select event missing element selector");
    }

    const locator = page.locator(selector);
    await locator.waitFor({ state: "visible", timeout });
    await locator.selectOption(event.value);

    return { selected: event.value };
  }

  /**
   * Play key event
   */
  async _playKey(page, event) {
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

    const keyCombo = [...modifiers, event.key].join("+");
    await page.keyboard.press(keyCombo);

    return { pressed: keyCombo };
  }

  /**
   * Play navigate event
   */
  async _playNavigate(page, event, timeout) {
    await page.goto(event.url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    return { navigated: event.url };
  }

  /**
   * Play scroll event
   */
  async _playScroll(page, event) {
    await page.evaluate(
      ({ x, y }) => {
        window.scrollTo({ left: x, top: y, behavior: "smooth" });
      },
      { x: event.scrollX, y: event.scrollY },
    );

    return { scrolled: { x: event.scrollX, y: event.scrollY } };
  }

  /**
   * Play hover event
   */
  async _playHover(page, targetId, event, timeout) {
    const selector = event.element?.selector;
    if (!selector) {
      return { skipped: true };
    }

    const locator = page.locator(selector);
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      await locator.hover();
      return { hovered: selector };
    } catch {
      return { skipped: true };
    }
  }

  /**
   * Pause playback
   * @param {string} playbackId - Playback ID
   * @returns {boolean}
   */
  pause(playbackId) {
    const session = this.playbacks.get(playbackId);
    if (!session || session.state !== PlaybackState.PLAYING) {
      return false;
    }

    session.pauseRequested = true;
    return true;
  }

  /**
   * Resume playback
   * @param {string} playbackId - Playback ID
   * @returns {boolean}
   */
  resume(playbackId) {
    const session = this.playbacks.get(playbackId);
    if (!session || session.state !== PlaybackState.PAUSED) {
      return false;
    }

    session.pauseRequested = false;
    session.state = PlaybackState.PLAYING;

    if (session.resumeResolve) {
      session.resumeResolve();
      session.resumeResolve = null;
    }

    return true;
  }

  /**
   * Stop playback
   * @param {string} playbackId - Playback ID
   * @returns {boolean}
   */
  stop(playbackId) {
    const session = this.playbacks.get(playbackId);
    if (!session) {
      return false;
    }

    session.cancelRequested = true;

    if (session.resumeResolve) {
      session.resumeResolve();
      session.resumeResolve = null;
    }

    return true;
  }

  /**
   * Get playback status
   * @param {string} playbackId - Playback ID
   * @returns {Object|null}
   */
  getStatus(playbackId) {
    const session = this.playbacks.get(playbackId);
    if (!session) {
      return null;
    }

    return {
      playbackId: session.id,
      state: session.state,
      currentEvent: session.currentEventIndex,
      totalEvents: session.totalEvents,
      progress: Math.round(
        (session.currentEventIndex / session.totalEvents) * 100,
      ),
      duration: Date.now() - session.startTime,
    };
  }

  /**
   * Check for pause/cancel requests
   * @private
   */
  async _checkPauseCancel(session) {
    if (session.cancelRequested) {
      session.state = PlaybackState.COMPLETED;
      throw new Error("Playback cancelled");
    }

    if (session.pauseRequested) {
      session.state = PlaybackState.PAUSED;
      this.emit("playback:paused", { playbackId: session.id });

      await new Promise((resolve) => {
        session.resumeResolve = resolve;
      });

      if (session.cancelRequested) {
        throw new Error("Playback cancelled");
      }
    }
  }

  /**
   * Inject visual feedback helpers
   * @private
   */
  async _injectVisualFeedback(page) {
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "__playbackStyles";
      style.textContent = `
        .__playback-highlight {
          outline: 3px solid #4CAF50 !important;
          outline-offset: 2px !important;
          transition: outline 0.3s ease !important;
        }
        #__playbackOverlay {
          position: fixed;
          top: 10px;
          right: 10px;
          background: rgba(0,0,0,0.8);
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          font-family: sans-serif;
          font-size: 14px;
          z-index: 999999;
        }
      `;
      document.head.appendChild(style);

      const overlay = document.createElement("div");
      overlay.id = "__playbackOverlay";
      overlay.textContent = "Playback in progress...";
      document.body.appendChild(overlay);
    });
  }

  /**
   * Highlight element during playback
   * @private
   */
  async _highlightElement(page, selector) {
    await page.evaluate((sel) => {
      // Remove previous highlight
      document.querySelectorAll(".__playback-highlight").forEach((el) => {
        el.classList.remove("__playback-highlight");
      });

      // Add highlight to current element
      const el = document.querySelector(sel);
      if (el) {
        el.classList.add("__playback-highlight");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, selector);

    // Brief delay to show highlight
    await this._delay(200);
  }

  /**
   * Delay helper
   * @private
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = {
  RecordingPlayer,
  PlaybackState,
  PlaybackSpeed,
};
