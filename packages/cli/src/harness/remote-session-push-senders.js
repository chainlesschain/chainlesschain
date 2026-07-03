// Remote Session vendor push — provider dispatch.
//
// Picks a concrete `sender` implementation by CHAINLESSCHAIN_REMOTE_SESSION_
// PUSH_PROVIDER (default "fcm"). Each provider factory returns a bound sender
// or null when unconfigured; unknown/unimplemented providers yield null so the
// dispatcher stays a no-op. Adding a provider (HMS / Xiaomi / …) is one import
// + one case here.

import { createFcmPushSender } from "./remote-session-push-fcm.js";
import { createApnsPushSender } from "./remote-session-push-apns.js";
import { createWebPushSender } from "./remote-session-push-web.js";

export function createRemoteSessionPushSender(env = {}, options = {}) {
  const provider = (
    env.CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER || "fcm"
  ).toLowerCase();
  switch (provider) {
    case "fcm":
      return createFcmPushSender(env, options);
    case "apns":
      return createApnsPushSender(env, options);
    case "web":
      return createWebPushSender(env, options);
    default:
      return null;
  }
}
