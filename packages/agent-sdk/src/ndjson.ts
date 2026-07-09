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

  const decode = ((chunk: string | Uint8Array): void => {
    if (typeof chunk === "string") {
      carry += chunk;
    } else {
      decoder ??= new TextDecoder("utf-8");
      carry += decoder.decode(chunk, { stream: true });
    }
    if (carry.length > maxLineLength) {
      carry = "";
      onError(new Error("NDJSON line exceeds maximum length"));
      return;
    }
    let index: number;
    while ((index = carry.indexOf("\n")) !== -1) {
      const line = carry.slice(0, index).replace(/\r$/, "");
      carry = carry.slice(index + 1);
      emitLine(line);
    }
  }) as NdjsonDecode<T>;

  decode.flush = (): void => {
    const rest = carry.replace(/\r$/, "");
    carry = "";
    if (decoder) {
      // Finalize any dangling multi-byte sequence.
      const tail = decoder.decode();
      if (tail) emitLine(rest + tail);
      else emitLine(rest);
      decoder = null;
      return;
    }
    emitLine(rest);
  };

  return decode;
}

export function encodeNdjson(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
