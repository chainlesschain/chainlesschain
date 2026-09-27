// Synthetic receipts for the ordinary control journey. Canonical recovery uses
// canonical-transcript-peer.mjs and the production store instead.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function inputReceiptPeer(statePath) {
  if (!statePath) return null;
  const directory = `${path.resolve(statePath)}.receipts`;
  const file = (sessionId, clientMessageId) =>
    path.join(directory, `${hash([sessionId, clientMessageId])}.json`);
  function read(sessionId, clientMessageId) {
    try {
      return JSON.parse(readFileSync(file(sessionId, clientMessageId), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return {
    query(sessionId, clientMessageId) {
      const receipt = read(sessionId, clientMessageId);
      return {
        schema: "chainlesschain.input-receipt/v1",
        sessionId,
        clientMessageId,
        accepted: receipt !== null,
        receipt,
      };
    },
    accept(sessionId, event, emit) {
      const clientMessageId = event.client_message_id;
      if (!clientMessageId) return null;
      if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(clientMessageId))
        throw new Error("Invalid fixture client message ID");
      const inputDigest = hash({
        text: String(event.text || ""),
        images: event.images || [],
      });
      let receipt = read(sessionId, clientMessageId);
      const duplicate = receipt !== null;
      if (receipt && receipt.inputDigest !== inputDigest)
        throw new Error("Fixture input ID was reused with different content");
      if (!receipt) {
        receipt = {
          sessionId,
          clientMessageId,
          inputDigest,
          eventHash: hash([
            "synthetic-host-input",
            sessionId,
            clientMessageId,
            inputDigest,
          ]),
        };
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(
          file(sessionId, clientMessageId),
          `${JSON.stringify(receipt)}\n`,
          { flag: "wx", mode: 0o600 },
        );
      }
      emit({
        type: "system",
        subtype: "input_accepted",
        session_id: sessionId,
        client_message_id: clientMessageId,
        receipt: { ...receipt, duplicate },
      });
      return { duplicate };
    },
  };
}
