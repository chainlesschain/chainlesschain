class BoundedLineReader {
  constructor(maxLineBytes) {
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
      throw new TypeError("maxLineBytes must be a positive safe integer");
    }
    this.maxLineBytes = maxLineBytes;
    this.parts = [];
    this.lineBytes = 0;
  }

  push(chunk, onLine) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const lines = [];
    let offset = 0;
    let newline;

    while ((newline = bytes.indexOf(0x0a, offset)) !== -1) {
      this._append(bytes.subarray(offset, newline));
      const line = this._consumeLine();
      if (onLine) {
        if (onLine(line) === false) return lines;
      } else {
        lines.push(line);
      }
      offset = newline + 1;
    }
    this._append(bytes.subarray(offset));
    return lines;
  }

  finish() {
    if (this.lineBytes === 0) return [];
    return [this._consumeLine()];
  }

  reset() {
    this.parts = [];
    this.lineBytes = 0;
  }

  _append(bytes) {
    if (bytes.length === 0) return;
    if (this.lineBytes + bytes.length > this.maxLineBytes) {
      this.reset();
      const error = new Error("MCP stdio input line exceeds configured limit");
      error.code = "CC_MCP_STDIO_LINE_TOO_LARGE";
      error.maxLineBytes = this.maxLineBytes;
      throw error;
    }
    // Copy the slice so a short trailing fragment cannot retain an arbitrarily
    // large parent chunk through Buffer.subarray's shared backing store.
    this.parts.push(Buffer.from(bytes));
    this.lineBytes += bytes.length;
  }

  _consumeLine() {
    let line = Buffer.concat(this.parts, this.lineBytes);
    if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
    const value = line.toString("utf8");
    this.reset();
    return value;
  }
}

module.exports = { BoundedLineReader };
