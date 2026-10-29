import { getDurableSystemMessageProvenance } from "./session-message-provenance.js";

// A live host grants this capability only after validating and rendering its
// own base. Neither serialized fields nor a cloned message carry authority.
const LIVE_HOST_BASES = new WeakSet();

export function markCompactionHostBase(message) {
  if (
    !message ||
    message.role !== "system" ||
    getDurableSystemMessageProvenance(message)
  )
    throw new TypeError("Compaction host base must be a live system message");
  LIVE_HOST_BASES.add(message);
  return message;
}

export function isCompactionHostBase(message) {
  return (
    LIVE_HOST_BASES.has(message) &&
    message.role === "system" &&
    !getDurableSystemMessageProvenance(message)
  );
}
