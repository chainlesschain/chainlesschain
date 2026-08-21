/**
 * Canonicalize the part of a tool request that is classified and shown to the
 * user for approval. Keeping this in one place prevents the safety classifier
 * and the permission prompt from silently reasoning about different inputs.
 */

function quoteArgvToken(value) {
  const token = String(value);
  if (token && !/[\s|;&"'\\]/u.test(token)) return token;
  return `"${token.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

export function normalizePermissionRequest({ tool, args } = {}) {
  const normalizedArgs = args && typeof args === "object" ? args : {};
  const command =
    typeof normalizedArgs.command === "string"
      ? normalizedArgs.command
      : Array.isArray(normalizedArgs.argv)
        ? normalizedArgs.argv.map(quoteArgvToken).join(" ")
        : "";
  const source = String(
    normalizedArgs.path ??
      normalizedArgs.file_path ??
      normalizedArgs.source ??
      normalizedArgs.from ??
      "",
  );
  const destination = String(
    normalizedArgs.destination ??
      normalizedArgs.new_path ??
      normalizedArgs.to ??
      "",
  );
  const detail =
    command ||
    (source && destination
      ? `${source} -> ${destination}`
      : source || destination);

  return Object.freeze({
    tool: String(tool || "unknown").trim() || "unknown",
    args: normalizedArgs,
    command,
    source,
    destination,
    detail,
  });
}
