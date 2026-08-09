/**
 * Capture the Commander option grammar needed to safely transform a parsed
 * command's original argv. Keeping option arity is important: an option value
 * can be byte-for-byte identical to a prompt token or another option name.
 */
/** Keep untrusted prompt text inside one argv token, even when it starts `-`. */
export function agentPrintArgument(prompt) {
  return `--print=${String(prompt)}`;
}

export function captureCommandArgvGrammar(command) {
  const hierarchy = [];
  for (let cursor = command; cursor; cursor = cursor.parent) {
    hierarchy.unshift(cursor);
  }
  const optionSpecs = hierarchy.flatMap((owner) =>
    (owner?.options || []).map((option) => ({
      short: option.short || null,
      long: option.long || null,
      required: option.required === true,
      optional: option.optional === true,
      variadic: option.variadic === true,
    })),
  );
  const commandNames = [
    command?.name?.(),
    ...(command?.aliases?.() || []),
  ].filter(Boolean);
  return { optionSpecs, commandNames };
}

export function captureCommandOptionSpecs(command) {
  return captureCommandArgvGrammar(command).optionSpecs;
}

function normalizedOptionSpecs(optionSpecs) {
  return (optionSpecs || [])
    .map((spec) => ({
      short: spec?.short || null,
      long: spec?.long || null,
      required: spec?.required === true,
      optional: spec?.optional === true,
      variadic: spec?.variadic === true,
    }))
    .filter((spec) => spec.short || spec.long);
}

function consumesValue(spec) {
  return spec?.required === true || spec?.optional === true;
}

function looksLikeOption(value) {
  return typeof value === "string" && value.length > 1 && value[0] === "-";
}

function consumedValueCount(argv, start, spec) {
  if (!consumesValue(spec) || start >= argv.length || argv[start] === "--") {
    return 0;
  }
  if (spec.optional && looksLikeOption(argv[start])) return 0;
  if (!spec.variadic) return 1;
  let count = 0;
  for (let index = start; index < argv.length; index++) {
    if (argv[index] === "--" || looksLikeOption(argv[index])) break;
    count += 1;
  }
  return count;
}

function optionGrammar(optionSpecs) {
  const specs = normalizedOptionSpecs(optionSpecs);
  const aliases = new Map();
  for (const spec of specs) {
    if (spec.short) aliases.set(spec.short, spec);
    if (spec.long) aliases.set(spec.long, spec);
  }
  return { specs, aliases };
}

function parseShortCluster(token, aliases, argv, index) {
  if (!/^-[^-].+/.test(token)) return null;
  const body = token.slice(1);
  const parts = [];
  for (let offset = 0; offset < body.length; offset++) {
    const alias = `-${body[offset]}`;
    const spec = aliases.get(alias);
    if (!spec) return null;
    if (!consumesValue(spec)) {
      parts.push({ alias, spec, attachedValue: null });
      continue;
    }
    const attachedValue = body.slice(offset + 1);
    parts.push({
      alias,
      spec,
      attachedValue: attachedValue || null,
    });
    const valueCount = attachedValue
      ? 0
      : consumedValueCount(argv, index + 1, spec);
    return {
      kind: "short-cluster",
      parts,
      values: argv.slice(index + 1, index + 1 + valueCount),
      consumed: 1 + valueCount,
    };
  }
  return {
    kind: "short-cluster",
    parts,
    values: [],
    consumed: 1,
  };
}

function parseOption(argv, index, aliases) {
  const token = argv[index];
  const equalsIndex = token.startsWith("--") ? token.indexOf("=") : -1;
  const name = equalsIndex > 0 ? token.slice(0, equalsIndex) : token;
  const spec = aliases.get(name);
  if (spec) {
    const inlineValue = equalsIndex > 0 ? token.slice(equalsIndex + 1) : null;
    const valueCount =
      inlineValue !== null ? 0 : consumedValueCount(argv, index + 1, spec);
    return {
      kind: "option",
      spec,
      token,
      inlineValue,
      values: argv.slice(index + 1, index + 1 + valueCount),
      consumed: 1 + valueCount,
    };
  }
  return parseShortCluster(token, aliases, argv, index);
}

function parseCommandArgv(argv, optionSpecs, commandNames) {
  const source = [...(argv || [])];
  const { aliases } = optionGrammar(optionSpecs);
  const segments = [];
  let index = 0;
  const names = new Set(commandNames || []);
  let foundCommand = names.size === 0;
  if (foundCommand && source.length > 0) {
    // The background launcher always receives process.argv.slice(2), whose
    // first token is the command name (`agent`/`a`). It is not an operand.
    segments.push({ kind: "command", tokens: [source[0]] });
    index = 1;
  }
  while (index < source.length) {
    if (foundCommand && source[index] === "--") {
      segments.push({ kind: "terminator", tokens: source.slice(index) });
      break;
    }
    const option = parseOption(source, index, aliases);
    if (option) {
      segments.push(option);
      index += option.consumed;
      continue;
    }
    if (!foundCommand && names.has(source[index])) {
      foundCommand = true;
      segments.push({ kind: "command", tokens: [source[index]] });
    } else {
      // Unknown pre-command tokens are preserved fail-closed. A successfully
      // parsed Commander invocation should only reach this for the command
      // token itself, but retaining an unexpected prefix is safer than
      // silently launching a different command.
      segments.push({
        kind: foundCommand ? "operand" : "prefix",
        tokens: [source[index]],
      });
    }
    index += 1;
  }
  return segments;
}

function renderShortCluster(segment, keepPart) {
  const kept = segment.parts.filter(keepPart);
  if (kept.length === 0) return [];
  let token = "-";
  let keepValues = false;
  for (const part of kept) {
    token += part.alias.slice(1);
    if (consumesValue(part.spec)) {
      if (part.attachedValue !== null) token += part.attachedValue;
      else keepValues = true;
      break;
    }
  }
  return [token, ...(keepValues ? segment.values : [])];
}

const BACKGROUND_PARENT_OPTIONS = new Set([
  "--background",
  "--worktree",
  "--no-worktree",
]);

/**
 * Remove parent-only background/worktree decisions and replace every parsed
 * --add-dir occurrence with the already validated canonical roots. A token is
 * changed only when the command grammar identifies it as that option; equal
 * values belonging to another option stay byte-for-byte intact.
 */
export function transformBackgroundLaunchArgv(
  argv,
  { directories = [], optionSpecs, commandNames } = {},
) {
  const out = [];
  let positionalTail = [];
  for (const segment of parseCommandArgv(argv, optionSpecs, commandNames)) {
    if (segment.kind === "option") {
      if (
        segment.spec?.long !== "--add-dir" &&
        !BACKGROUND_PARENT_OPTIONS.has(segment.spec?.long)
      ) {
        out.push(segment.token, ...segment.values);
      }
    } else if (segment.kind === "short-cluster") {
      out.push(
        ...renderShortCluster(
          segment,
          (part) =>
            part.spec?.long !== "--add-dir" &&
            !BACKGROUND_PARENT_OPTIONS.has(part.spec?.long),
        ),
      );
    } else if (segment.kind === "terminator") {
      positionalTail = segment.tokens;
    } else {
      out.push(...segment.tokens);
    }
  }
  for (const directory of directories || []) {
    out.push("--add-dir", directory);
  }
  return [...out, ...positionalTail];
}

const SESSION_PARENT_OPTIONS = new Set([
  "--session",
  "--continue",
  "--resume",
  "--fork-session",
  "--fork-request-id",
]);

function isParentSessionOption(spec) {
  return SESSION_PARENT_OPTIONS.has(spec?.long);
}

/**
 * Remove every parent-owned resume/fork spelling and insert one resolved
 * session id. Literal prompt tokens after `--`, and values belonging to other
 * options, are preserved exactly.
 */
export function canonicalizeBackgroundSessionArgv(
  argv,
  { sessionId, optionSpecs, commandNames } = {},
) {
  if (!sessionId) {
    throw new Error("Cannot launch background agent without a session id");
  }
  const out = [];
  let positionalTail = [];
  for (const segment of parseCommandArgv(argv, optionSpecs, commandNames)) {
    if (segment.kind === "option") {
      if (!isParentSessionOption(segment.spec)) {
        out.push(segment.token, ...segment.values);
      }
    } else if (segment.kind === "short-cluster") {
      out.push(
        ...renderShortCluster(
          segment,
          (part) => !isParentSessionOption(part.spec),
        ),
      );
    } else if (segment.kind === "terminator") {
      positionalTail = segment.tokens;
    } else {
      out.push(...segment.tokens);
    }
  }
  return [...out, "--session", String(sessionId), ...positionalTail];
}

function isPrintOption(spec) {
  return spec?.long === "--print";
}

/**
 * Build the reusable argv for an attached follow-up turn. Option grammar, not
 * token equality, distinguishes option values from first-turn operands.
 */
export function stripFirstTurnPromptArgv(
  argv,
  { optionSpecs, commandNames } = {},
) {
  const out = [];
  for (const segment of parseCommandArgv(argv, optionSpecs, commandNames)) {
    if (segment.kind === "command" || segment.kind === "prefix") {
      out.push(...segment.tokens);
    } else if (segment.kind === "option") {
      if (!isPrintOption(segment.spec)) {
        out.push(segment.token, ...segment.values);
      }
    } else if (segment.kind === "short-cluster") {
      out.push(
        ...renderShortCluster(segment, (part) => !isPrintOption(part.spec)),
      );
    }
    // All operands, the option terminator, and its literal tail belong to the
    // first turn and are intentionally omitted.
  }
  return out;
}
