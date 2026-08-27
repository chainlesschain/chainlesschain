/**
 * Bounded BroadcastChannel handlers.
 */

/* eslint-disable no-undef */
/* global chrome, window, BroadcastChannel, TextEncoder, Array, JSON */

const KIB = 1024;
const RETRY_AFTER_MS = 1000;

export const DEFAULT_BROADCAST_LIMITS = Object.freeze({
  maxChannelsPerPage: 16,
  maxChannelNameBytes: 128,
  maxMessagesPerChannel: 100,
  maxMessageBytes: 64 * KIB,
  maxRetainedBytesPerChannel: 256 * KIB,
});

export const HARD_BROADCAST_LIMITS = Object.freeze({
  maxChannelsPerPage: 64,
  maxChannelNameBytes: KIB,
  maxMessagesPerChannel: 1000,
  maxMessageBytes: 256 * KIB,
  maxRetainedBytesPerChannel: 2 * 1024 * KIB,
});

function normalizeLimit(value, fallback, hardLimit) {
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

function overloaded(error, scope, limit) {
  return {
    accepted: false,
    error,
    code: "OVERLOADED",
    scope,
    retryAfterMs: RETRY_AFTER_MS,
    limit,
  };
}

export function createBroadcastLimits(options = {}) {
  const maxRetainedBytesPerChannel = normalizeLimit(
    options.maxRetainedBytesPerChannel,
    DEFAULT_BROADCAST_LIMITS.maxRetainedBytesPerChannel,
    HARD_BROADCAST_LIMITS.maxRetainedBytesPerChannel,
  );
  return Object.freeze({
    maxChannelsPerPage: normalizeLimit(
      options.maxChannelsPerPage,
      DEFAULT_BROADCAST_LIMITS.maxChannelsPerPage,
      HARD_BROADCAST_LIMITS.maxChannelsPerPage,
    ),
    maxChannelNameBytes: normalizeLimit(
      options.maxChannelNameBytes,
      DEFAULT_BROADCAST_LIMITS.maxChannelNameBytes,
      HARD_BROADCAST_LIMITS.maxChannelNameBytes,
    ),
    maxMessagesPerChannel: normalizeLimit(
      options.maxMessagesPerChannel,
      DEFAULT_BROADCAST_LIMITS.maxMessagesPerChannel,
      HARD_BROADCAST_LIMITS.maxMessagesPerChannel,
    ),
    maxMessageBytes: Math.min(
      maxRetainedBytesPerChannel,
      normalizeLimit(
        options.maxMessageBytes,
        DEFAULT_BROADCAST_LIMITS.maxMessageBytes,
        HARD_BROADCAST_LIMITS.maxMessageBytes,
      ),
    ),
    maxRetainedBytesPerChannel,
  });
}

export function validateBroadcastChannelName(name, maxChannelNameBytes) {
  if (typeof name !== "string" || name.length === 0) {
    return {
      accepted: false,
      error: "Broadcast channel name must be a non-empty string",
      code: "INVALID_ARGUMENT",
    };
  }
  const bytes = new TextEncoder().encode(name).byteLength;
  if (bytes > maxChannelNameBytes) {
    return overloaded("Broadcast channel name is too large", "broadcast_name", {
      maxChannelNameBytes,
    });
  }
  return { accepted: true, name, bytes };
}

export function validateBroadcastMessage(message, maxMessageBytes) {
  try {
    const serialized = JSON.stringify(message);
    if (typeof serialized !== "string") {
      return {
        accepted: false,
        error: "Broadcast message must be JSON-serializable",
        code: "INVALID_ARGUMENT",
      };
    }
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > maxMessageBytes) {
      return overloaded("Broadcast message is too large", "broadcast_message", {
        maxMessageBytes,
      });
    }
    return { accepted: true, message: JSON.parse(serialized), bytes };
  } catch {
    return {
      accepted: false,
      error: "Broadcast message must be JSON-serializable",
      code: "INVALID_ARGUMENT",
    };
  }
}

export function createBroadcastChannelInPage(name, limits) {
  const nameBytes = new TextEncoder().encode(
    typeof name === "string" ? name : "",
  ).byteLength;
  if (!name || nameBytes > limits.maxChannelNameBytes) {
    return {
      error: "Invalid broadcast channel name",
      code: "INVALID_ARGUMENT",
    };
  }
  if (!(window.__chainlessBroadcastChannels instanceof Map)) {
    window.__chainlessBroadcastChannels = new Map();
  }
  const channels = window.__chainlessBroadcastChannels;
  if (channels.has(name)) {
    return { error: "Channel already exists", code: "ALREADY_EXISTS" };
  }
  if (channels.size >= limits.maxChannelsPerPage) {
    return {
      accepted: false,
      error: "Broadcast channel capacity exceeded",
      code: "OVERLOADED",
      scope: "broadcast_channels",
      retryAfterMs: 1000,
      limit: { maxChannelsPerPage: limits.maxChannelsPerPage },
    };
  }

  const channel = new BroadcastChannel(name);
  const entry = {
    channel,
    messages: [],
    messageBytes: [],
    retainedBytes: 0,
    droppedMessages: 0,
  };
  channels.set(name, entry);
  channel.onmessage = (event) => {
    let serialized;
    try {
      serialized = JSON.stringify(event.data);
    } catch {
      entry.droppedMessages += 1;
      return;
    }
    if (typeof serialized !== "string") {
      entry.droppedMessages += 1;
      return;
    }
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > limits.maxMessageBytes) {
      entry.droppedMessages += 1;
      return;
    }
    while (
      entry.messages.length >= limits.maxMessagesPerChannel ||
      entry.retainedBytes + bytes > limits.maxRetainedBytesPerChannel
    ) {
      if (entry.messages.length === 0) {
        entry.droppedMessages += 1;
        return;
      }
      entry.messages.shift();
      entry.retainedBytes -= entry.messageBytes.shift();
      entry.droppedMessages += 1;
    }
    entry.messages.push({
      data: JSON.parse(serialized),
      timestamp: Date.now(),
    });
    entry.messageBytes.push(bytes);
    entry.retainedBytes += bytes;
  };
  return { success: true, channelName: name, limits };
}

export function postBroadcastMessageInPage(name, message) {
  const channels = window.__chainlessBroadcastChannels;
  const entry = channels instanceof Map ? channels.get(name) : null;
  if (!entry) {
    return { error: "Channel not found" };
  }
  entry.channel.postMessage(message);
  return { success: true };
}

export function closeBroadcastChannelInPage(name) {
  const channels = window.__chainlessBroadcastChannels;
  const entry = channels instanceof Map ? channels.get(name) : null;
  if (!entry) {
    return { error: "Channel not found" };
  }
  entry.channel.onmessage = null;
  entry.channel.close();
  entry.messages.length = 0;
  entry.messageBytes.length = 0;
  entry.retainedBytes = 0;
  channels.delete(name);
  return { success: true };
}

export function listBroadcastChannelsInPage() {
  const channels = window.__chainlessBroadcastChannels;
  if (!(channels instanceof Map)) {
    return { channels: [] };
  }
  return {
    channels: Array.from(channels.entries()).map(([name, entry]) => ({
      name,
      messageCount: entry.messages.length,
      retainedBytes: entry.retainedBytes,
      droppedMessages: entry.droppedMessages,
    })),
  };
}

const broadcastLimits = createBroadcastLimits();

export async function createBroadcastChannel(tabId, channelName) {
  const validation = validateBroadcastChannelName(
    channelName,
    broadcastLimits.maxChannelNameBytes,
  );
  if (!validation.accepted) {
    return validation;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: createBroadcastChannelInPage,
      args: [validation.name, broadcastLimits],
    });
    return result[0]?.result || { error: "Failed to create channel" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function broadcastMessage(tabId, channelName, message) {
  const nameValidation = validateBroadcastChannelName(
    channelName,
    broadcastLimits.maxChannelNameBytes,
  );
  if (!nameValidation.accepted) {
    return nameValidation;
  }
  const messageValidation = validateBroadcastMessage(
    message,
    broadcastLimits.maxMessageBytes,
  );
  if (!messageValidation.accepted) {
    return messageValidation;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: postBroadcastMessageInPage,
      args: [nameValidation.name, messageValidation.message],
    });
    return result[0]?.result || { error: "Failed to broadcast" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function closeBroadcastChannel(tabId, channelName) {
  const validation = validateBroadcastChannelName(
    channelName,
    broadcastLimits.maxChannelNameBytes,
  );
  if (!validation.accepted) {
    return validation;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: closeBroadcastChannelInPage,
      args: [validation.name],
    });
    return result[0]?.result || { error: "Failed to close channel" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function listBroadcastChannels(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: listBroadcastChannelsInPage,
    });
    return result[0]?.result || { channels: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export const broadcastHandlers = {
  "broadcast.create": ({ tabId, channelName }) =>
    createBroadcastChannel(tabId, channelName),
  "broadcast.postMessage": ({ tabId, channelName, message }) =>
    broadcastMessage(tabId, channelName, message),
  "broadcast.close": ({ tabId, channelName }) =>
    closeBroadcastChannel(tabId, channelName),
  "broadcast.list": ({ tabId }) => listBroadcastChannels(tabId),
};
