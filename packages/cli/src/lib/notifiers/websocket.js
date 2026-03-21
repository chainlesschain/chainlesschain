/**
 * WebSocket Notifier — pushes orchestration events back over the active WS connection.
 *
 * When `cc orchestrate` is triggered via the WebSocket interface, notifications
 * are sent to the originating client in real-time instead of (or in addition to)
 * external channels.
 *
 * The caller passes a `sendFn` bound to the specific WS client:
 *   const wsNotifier = new WebSocketNotifier({ send: (data) => _send(ws, data) });
 */

export class WebSocketNotifier {
  /**
   * @param {object} options
   * @param {Function} options.send - (data: object) => void  — bound to one WS client
   * @param {string}  [options.taskId] - correlate events to the originating request
   */
  constructor(options = {}) {
    this._send = options.send || (() => {});
    this.requestId = options.requestId || null;
  }

  get isConfigured() {
    return typeof this._send === "function";
  }

  /** Send a typed orchestration event to the WebSocket client. */
  send(event, payload = {}) {
    this._send({
      type: "orchestrate:event",
      event,
      requestId: this.requestId,
      ...payload,
      ts: Date.now(),
    });
  }

  async notifyStart(summary) {
    this.send("start", summary);
    return { ok: true };
  }

  async notifySuccess(summary) {
    this.send("ci:pass", summary);
    return { ok: true };
  }

  async notifyFailure(summary) {
    this.send("ci:fail", summary);
    return { ok: true };
  }

  /** Forward real-time agent output chunk to the client. */
  sendAgentOutput({ agentId, taskId, chunk }) {
    this.send("agent:output", { agentId, taskId, chunk });
  }

  /** Forward task status update. */
  sendStatus(task) {
    this.send("task:status", {
      taskId: task.id,
      status: task.status,
      retries: task.retries,
      subtasks: task.subtasks?.length,
    });
  }
}
