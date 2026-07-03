// Shared error types for Remote Session vendor push senders.

/**
 * A device token the vendor reports as no longer valid (uninstalled app, token
 * rotated). The caller should prune it so it is never retried. Raised by every
 * provider (FCM UNREGISTERED, APNs 410/BadDeviceToken, …) so the dispatcher and
 * ws-server pruning logic can key off a single `code`.
 */
export class PushTokenUnregisteredError extends Error {
  constructor(message) {
    super(message);
    this.name = "PushTokenUnregisteredError";
    this.code = "PUSH_TOKEN_UNREGISTERED";
  }
}
