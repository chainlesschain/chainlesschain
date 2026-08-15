import crypto from "node:crypto";

const DECLARATIONS =
  'const fs=require("node:fs");const Module=require("node:module");const filename="/chainlesschain/mcp-capsule.cjs";';
const COMPILE_PREFIX =
  "process.argv.splice(1,0,filename);const target=new Module(filename,module);target.filename=filename;target.paths=[];target._compile(source,filename);";

/**
 * Keep the inherited-entry bootstrap in one source of truth. Linux consumes
 * the compatibility form; the signed macOS root launcher consumes the gated
 * form, which proves the actual Node image is running before the root watchdog
 * removes its protected runtime snapshot and releases untrusted entry bytes.
 */
export function createMcpStdioFdEntryBootstrap({ gated = false } = {}) {
  if (!gated) {
    return `${DECLARATIONS}const source=fs.readFileSync(4,"utf8");${COMPILE_PREFIX}`;
  }
  return (
    DECLARATIONS +
    'fs.writeSync(7,Buffer.from("R"));for(const fd of [3,5,7]){try{fs.closeSync(fd)}catch{}}' +
    "const gate=Buffer.alloc(1);if(fs.readSync(6,gate,0,1,null)!==1||gate[0]!==71)process.exit(126);fs.closeSync(6);" +
    'const source=fs.readFileSync(4,"utf8");fs.closeSync(4);' +
    COMPILE_PREFIX
  );
}

export const MCP_STDIO_FD_ENTRY_BOOTSTRAP = createMcpStdioFdEntryBootstrap();
export const MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256 = crypto
  .createHash("sha256")
  .update(MCP_STDIO_FD_ENTRY_BOOTSTRAP)
  .digest("hex");
export const MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP =
  createMcpStdioFdEntryBootstrap({ gated: true });
export const MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256 = crypto
  .createHash("sha256")
  .update(MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP)
  .digest("hex");
