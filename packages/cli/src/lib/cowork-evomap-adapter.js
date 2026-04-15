/**
 * Cowork ↔ EvoMap adapter — publish Cowork templates as EvoMap "genes" and
 * pull them back for local install. Thin wrapper over `evomap-client.js`
 * that fixes `kind = "cowork-template"` and carries N4 signatures through.
 *
 * Pure glue: all I/O is delegated to EvoMapClient (network) and the
 * marketplace/share modules (disk). Injectable via `_deps.createClient`.
 *
 * @module cowork-evomap-adapter
 */

import { EvoMapClient } from "./evomap-client.js";
import {
  toShareableTemplate,
  saveUserTemplate,
} from "./cowork-template-marketplace.js";
import { buildPacket } from "./cowork-share.js";

export const _deps = {
  createClient: (opts) => new EvoMapClient(opts),
};

const KIND = "cowork-template";

function _wrapGene(template, signer) {
  const payload = toShareableTemplate(template);
  // Reuse share-packet builder so signed genes land on the hub with the same
  // canonical shape as file-based packets (checksum + optional signature).
  const packet = buildPacket({
    kind: "template",
    payload,
    author: signer?.did || "anonymous",
    cliVersion: undefined,
    signer: signer || undefined,
  });
  return {
    id: payload.id,
    name: payload.name || payload.id,
    description: payload.description || "",
    kind: KIND,
    version: payload.version || "1.0.0",
    packet,
  };
}

/**
 * Publish a template to a hub. Requires API key on the client.
 * @returns {Promise<object>} hub response (typically { id, ... })
 */
export async function publishTemplateToHub(
  template,
  { hubUrl, apiKey, signer } = {},
) {
  if (!template || !template.id) {
    throw new Error("template.id required");
  }
  const client = _deps.createClient({ hubUrl, apiKey });
  const gene = _wrapGene(template, signer);
  return client.publish(gene);
}

/**
 * Search templates on a hub. Degrades to [] on network error unless
 * `strict: true` is passed.
 * @returns {Promise<Array>} annotated with `_hubMeta`
 */
export async function searchTemplatesInHub(
  query,
  { hubUrl, limit = 20, strict = false } = {},
) {
  const client = _deps.createClient({ hubUrl });
  try {
    const results = await client.search(query || "", {
      category: KIND,
      limit,
    });
    return (results || []).map((r) => ({
      ...r,
      _hubMeta: {
        hubUrl: client.hubUrl,
        downloads: r.downloads || 0,
        rating: r.rating || null,
      },
    }));
  } catch (err) {
    if (strict) throw err;
    return [];
  }
}

/**
 * Fetch a gene by id and install its template into the local marketplace.
 * Returns the saved template object.
 */
export async function installTemplateFromHub(
  cwd,
  geneId,
  { hubUrl, requireSigned = false, trustedDids = null } = {},
) {
  const client = _deps.createClient({ hubUrl });
  const data = await client.download(geneId);
  // Hub may return { gene: { packet } } or { packet } directly
  const gene = data?.gene || data;
  const packet = gene?.packet || data?.packet;
  if (!packet || packet.kind !== "template" || !packet.payload) {
    throw new Error("Hub response missing template packet");
  }
  if (requireSigned && !packet.signature) {
    throw new Error("Gene is not signed and --require-signed was set");
  }
  if (
    Array.isArray(trustedDids) &&
    trustedDids.length > 0 &&
    (!packet.signature || !trustedDids.includes(packet.signature.did))
  ) {
    throw new Error(
      `Gene signer not in trusted list${packet.signature ? ` (${packet.signature.did})` : ""}`,
    );
  }
  return saveUserTemplate(cwd, packet.payload);
}
