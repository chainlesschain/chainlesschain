"use strict";

const MODEL_EGRESS_INGRESS_FAILED = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
const authenticatedEvolutionClients = new WeakSet();

function ingressError(message) {
  const error = new Error(message);
  error.code = MODEL_EGRESS_INGRESS_FAILED;
  return error;
}

function rejectLegacyModelEgress() {
  throw ingressError(
    "Personal Data Hub model egress requires an authenticated Evolution ingress",
  );
}

/**
 * Create the only PDH client shape admitted at model-owning call sites.
 *
 * This is deliberately a constructor, not a rebranding API: the returned
 * client owns the full prepare -> transport -> complete sequence and the raw
 * transport is never exposed. The CLI supplies a prepare function backed by
 * its branded Evolution composition; ordinary `{ chat() }` clients remain
 * fail-closed.
 */
function createAuthenticatedEvolutionModelClient(options) {
  if (!options || typeof options !== "object") {
    throw ingressError(
      "Authenticated Evolution model client options are required",
    );
  }
  for (const name of ["getName", "getIsLocal", "prepare", "transport"]) {
    if (typeof options[name] !== "function") {
      throw ingressError(
        `Authenticated Evolution model client ${name} is required`,
      );
    }
  }
  if (options.onFailure != null && typeof options.onFailure !== "function") {
    throw ingressError(
      "Authenticated Evolution model client onFailure must be a function",
    );
  }

  // Snapshot every capability before publishing the client. Mutating the
  // caller's options object later must not be able to replace authorization
  // or transport inside an already branded instance.
  const getName = options.getName;
  const getIsLocal = options.getIsLocal;
  const prepare = options.prepare;
  const transport = options.transport;
  const onFailure = options.onFailure || null;

  const client = Object.freeze({
    get name() {
      return getName();
    },
    get isLocal() {
      const value = getIsLocal();
      if (typeof value !== "boolean") {
        throw ingressError(
          "Authenticated Evolution model locality must be declared",
        );
      }
      return value;
    },
    async chat(messages, chatOptions = {}) {
      try {
        const turn = await prepare(messages, chatOptions);
        if (
          !turn ||
          !Array.isArray(turn.messages) ||
          typeof turn.complete !== "function"
        ) {
          throw ingressError(
            "Authenticated Evolution model preparation returned an invalid turn",
          );
        }
        const response = await transport(turn.messages, chatOptions);
        if (!response || typeof response.text !== "string") {
          throw ingressError(
            "Authenticated Evolution model response must contain text",
          );
        }
        await turn.complete(response.text);
        return response;
      } catch (error) {
        try {
          onFailure?.(error);
        } catch (_error) {
          // Observability cannot replace the original governance failure.
        }
        throw error;
      }
    },
  });
  authenticatedEvolutionClients.add(client);
  return client;
}

function assertAuthenticatedEvolutionModelEgress(client) {
  if (!client || !authenticatedEvolutionClients.has(client)) {
    rejectLegacyModelEgress();
  }
  return client;
}

module.exports = {
  MODEL_EGRESS_INGRESS_FAILED,
  createAuthenticatedEvolutionModelClient,
  assertAuthenticatedEvolutionModelEgress,
  rejectLegacyModelEgress,
};
