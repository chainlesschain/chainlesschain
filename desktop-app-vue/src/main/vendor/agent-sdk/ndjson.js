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
    let droppingOversizedLine = false;
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
    const lineTooLong = () => {
        onError(new Error("NDJSON line exceeds maximum length"));
    };
    const append = (text) => {
        if (droppingOversizedLine) {
            const end = text.indexOf("\n");
            if (end < 0)
                return;
            droppingOversizedLine = false;
            text = text.slice(end + 1);
        }
        let offset = 0;
        let end;
        while ((end = text.indexOf("\n", offset)) >= 0) {
            const segment = text.slice(offset, end);
            if (carry.length + segment.length > maxLineLength) {
                lineTooLong();
            }
            else {
                emitLine((carry + segment).replace(/\r$/, ""));
            }
            carry = "";
            offset = end + 1;
        }
        const tail = text.slice(offset);
        if (carry.length + tail.length > maxLineLength) {
            carry = "";
            droppingOversizedLine = true;
            lineTooLong();
        }
        else {
            carry += tail;
        }
    };
    const decode = ((chunk) => {
        if (typeof chunk === "string") {
            append(chunk);
        }
        else {
            decoder ??= new TextDecoder("utf-8");
            append(decoder.decode(chunk, { stream: true }));
        }
    });
    decode.flush = () => {
        const tail = decoder?.decode() ?? "";
        decoder = null;
        if (droppingOversizedLine) {
            carry = "";
            droppingOversizedLine = false;
            return;
        }
        const rest = (carry + tail).replace(/\r$/, "");
        carry = "";
        if (rest.length > maxLineLength)
            lineTooLong();
        else
            emitLine(rest);
    };
    return decode;
}
function encodeNdjson(message) {
    return `${JSON.stringify(message)}\n`;
}
