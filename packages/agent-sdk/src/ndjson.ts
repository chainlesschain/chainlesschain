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

export interface NdjsonDecoderOptions {
  /** Reject a single line longer than this many characters (default 1 MiB). */
  maxLineLength?: number;
  onError?: (error: Error, line?: string) => void;
}

const DEFAULT_MAX_LINE = 1024 * 1024;

export interface NdjsonDecode<T = unknown> {
  (chunk: string | Uint8Array): void;
  /**
   * Parse any buffered remainder as a final (unterminated) line. Call on
   * stream close — error output often lacks the trailing \n and would
   * otherwise be dropped silently.
   */
  flush(): void;
}

export function createNdjsonDecoder<T = unknown>(
  onMessage: (message: T) => void,
  options: NdjsonDecoderOptions = {},
): NdjsonDecode<T> {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE;
  const onError = options.onError ?? (() => {});
  let carry = "";
  let droppingOversizedLine = false;
  let decoder: TextDecoder | null = null;

  const emitLine = (line: string): void => {
    if (!line.trim()) return;
    let message: T;
    try {
      message = JSON.parse(line) as T;
    } catch (error) {
      onError(error as Error, line);
      return;
    }
    onMessage(message);
  };

  const lineTooLong = (): void => {
    onError(new Error("NDJSON line exceeds maximum length"));
  };

  const append = (text: string): void => {
    if (droppingOversizedLine) {
      const end = text.indexOf("\n");
      if (end < 0) return;
      droppingOversizedLine = false;
      text = text.slice(end + 1);
    }
    let offset = 0;
    let end: number;
    while ((end = text.indexOf("\n", offset)) >= 0) {
      const segment = text.slice(offset, end);
      if (carry.length + segment.length > maxLineLength) {
        lineTooLong();
      } else {
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
    } else {
      carry += tail;
    }
  };

  const decode = ((chunk: string | Uint8Array): void => {
    if (typeof chunk === "string") {
      append(chunk);
    } else {
      decoder ??= new TextDecoder("utf-8");
      append(decoder.decode(chunk, { stream: true }));
    }
  }) as NdjsonDecode<T>;

  decode.flush = (): void => {
    const tail = decoder?.decode() ?? "";
    decoder = null;
    if (droppingOversizedLine) {
      carry = "";
      droppingOversizedLine = false;
      return;
    }
    const rest = (carry + tail).replace(/\r$/, "");
    carry = "";
    if (rest.length > maxLineLength) lineTooLong();
    else emitLine(rest);
  };

  return decode;
}

export function encodeNdjson(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
