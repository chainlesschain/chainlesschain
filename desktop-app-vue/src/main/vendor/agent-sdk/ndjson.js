"use strict";
/**
 * NDJSON line framing with a carry buffer.
 *
 * A chunk boundary can split a line, so the remainder must carry into the
 * next chunk instead of being parsed (and dropped) as its own line — the
 * classic streaming-parse bug this repo has fixed more than once. Mirrors
 * packages/cli/src/lib/background-session-transport.js createNdjsonReader.
 *
 * Browser-safe: accepts strings or Uint8Array (decoded as UTF-8).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNdjsonDecoder = createNdjsonDecoder;
exports.encodeNdjson = encodeNdjson;
const DEFAULT_MAX_LINE = 1024 * 1024;
function createNdjsonDecoder(onMessage, options = {}) {
    const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE;
    const onError = options.onError ?? (() => { });
    let carry = "";
    let decoder = null;
    const emitLine = (line) => {
        if (!line.trim())
            return;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch (error) {
            onError(error, line);
            return;
        }
        onMessage(message);
    };
    const decode = ((chunk) => {
        if (typeof chunk === "string") {
            carry += chunk;
        }
        else {
            decoder ??= new TextDecoder("utf-8");
            carry += decoder.decode(chunk, { stream: true });
        }
        if (carry.length > maxLineLength) {
            carry = "";
            onError(new Error("NDJSON line exceeds maximum length"));
            return;
        }
        let index;
        while ((index = carry.indexOf("\n")) !== -1) {
            const line = carry.slice(0, index).replace(/\r$/, "");
            carry = carry.slice(index + 1);
            emitLine(line);
        }
    });
    decode.flush = () => {
        const rest = carry.replace(/\r$/, "");
        carry = "";
        if (decoder) {
            // Finalize any dangling multi-byte sequence.
            const tail = decoder.decode();
            if (tail)
                emitLine(rest + tail);
            else
                emitLine(rest);
            decoder = null;
            return;
        }
        emitLine(rest);
    };
    return decode;
}
function encodeNdjson(message) {
    return `${JSON.stringify(message)}\n`;
}
