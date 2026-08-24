const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function pointer(parts) {
  return `#/${parts.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareNode(previous, next, path, changes, seen) {
  if (previous === next || sameJson(previous, next)) return;
  if (!previous || typeof previous !== "object") {
    changes.push({
      path: pointer(path),
      kind: "constraint_changed",
      breaking: true,
    });
    return;
  }
  if (!next || typeof next !== "object") {
    changes.push({
      path: pointer(path),
      kind: "schema_removed",
      breaking: true,
    });
    return;
  }
  const pair = `${path.join("/")}\0${JSON.stringify(previous)}\0${JSON.stringify(next)}`;
  if (seen.has(pair)) return;
  seen.add(pair);

  if (own(previous, "type") && !sameJson(previous.type, next.type)) {
    changes.push({
      path: pointer([...path, "type"]),
      kind: "type_changed",
      breaking: true,
    });
  }
  if (own(previous, "const") && !sameJson(previous.const, next.const)) {
    changes.push({
      path: pointer([...path, "const"]),
      kind: "const_changed",
      breaking: true,
    });
  }
  if (Array.isArray(previous.enum)) {
    const nextValues = new Set(
      Array.isArray(next.enum) ? next.enum.map(JSON.stringify) : [],
    );
    for (const value of previous.enum) {
      if (!nextValues.has(JSON.stringify(value))) {
        changes.push({
          path: pointer([...path, "enum"]),
          kind: "enum_value_removed",
          value,
          breaking: true,
        });
      }
    }
    if (Array.isArray(next.enum)) {
      const priorValues = new Set(previous.enum.map(JSON.stringify));
      for (const value of next.enum) {
        if (!priorValues.has(JSON.stringify(value))) {
          changes.push({
            path: pointer([...path, "enum"]),
            kind: "enum_value_added",
            value,
            breaking: false,
          });
        }
      }
    }
  }

  const previousRequired = new Set(previous.required || []);
  const nextRequired = new Set(next.required || []);
  for (const name of previousRequired) {
    if (!nextRequired.has(name)) {
      changes.push({
        path: pointer([...path, "required", name]),
        kind: "required_relaxed",
        breaking: false,
      });
    }
  }
  for (const name of nextRequired) {
    if (!previousRequired.has(name)) {
      changes.push({
        path: pointer([...path, "required", name]),
        kind: "required_added",
        breaking: true,
      });
    }
  }

  const previousProperties = previous.properties || {};
  const nextProperties = next.properties || {};
  for (const [name, schema] of Object.entries(previousProperties)) {
    if (!own(nextProperties, name)) {
      changes.push({
        path: pointer([...path, "properties", name]),
        kind: "property_removed",
        breaking: true,
      });
    } else {
      compareNode(
        schema,
        nextProperties[name],
        [...path, "properties", name],
        changes,
        seen,
      );
    }
  }
  for (const name of Object.keys(nextProperties)) {
    if (!own(previousProperties, name)) {
      changes.push({
        path: pointer([...path, "properties", name]),
        kind: nextRequired.has(name)
          ? "required_property_added"
          : "optional_property_added",
        breaking: nextRequired.has(name),
      });
    }
  }

  if (
    previous.additionalProperties !== false &&
    next.additionalProperties === false
  ) {
    changes.push({
      path: pointer([...path, "additionalProperties"]),
      kind: "additional_properties_closed",
      breaking: true,
    });
  }

  for (const keyword of ["minimum", "minLength", "minItems"]) {
    if (
      own(next, keyword) &&
      (!own(previous, keyword) || next[keyword] > previous[keyword])
    ) {
      changes.push({
        path: pointer([...path, keyword]),
        kind: "minimum_tightened",
        breaking: true,
      });
    }
  }
  for (const keyword of ["maximum", "maxLength", "maxItems"]) {
    if (
      own(next, keyword) &&
      (!own(previous, keyword) || next[keyword] < previous[keyword])
    ) {
      changes.push({
        path: pointer([...path, keyword]),
        kind: "maximum_tightened",
        breaking: true,
      });
    }
  }
  if (own(previous, "pattern") && previous.pattern !== next.pattern) {
    changes.push({
      path: pointer([...path, "pattern"]),
      kind: "pattern_changed",
      breaking: true,
    });
  }

  for (const keyword of ["items", "additionalProperties"]) {
    if (
      previous[keyword] &&
      typeof previous[keyword] === "object" &&
      next[keyword] &&
      typeof next[keyword] === "object"
    ) {
      compareNode(
        previous[keyword],
        next[keyword],
        [...path, keyword],
        changes,
        seen,
      );
    }
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    if (!Array.isArray(previous[keyword])) continue;
    if (
      !Array.isArray(next[keyword]) ||
      next[keyword].length < previous[keyword].length
    ) {
      changes.push({
        path: pointer([...path, keyword]),
        kind: "variant_removed",
        breaking: true,
      });
      continue;
    }
    previous[keyword].forEach((schema, index) => {
      compareNode(
        schema,
        next[keyword][index],
        [...path, keyword, index],
        changes,
        seen,
      );
    });
    for (
      let index = previous[keyword].length;
      index < next[keyword].length;
      index += 1
    ) {
      changes.push({
        path: pointer([...path, keyword, index]),
        kind: "variant_added",
        breaking: false,
      });
    }
  }
}

export function compareProtocolSchemas(previous, next) {
  const changes = [];
  compareNode(previous, next, [], changes, new Set());
  const previousDefinitions = previous?.$defs || {};
  const nextDefinitions = next?.$defs || {};
  for (const [name, schema] of Object.entries(previousDefinitions)) {
    if (!own(nextDefinitions, name)) {
      changes.push({
        path: pointer(["$defs", name]),
        kind: "definition_removed",
        breaking: true,
      });
    } else {
      compareNode(
        schema,
        nextDefinitions[name],
        ["$defs", name],
        changes,
        new Set(),
      );
    }
  }
  for (const name of Object.keys(nextDefinitions)) {
    if (!own(previousDefinitions, name)) {
      changes.push({
        path: pointer(["$defs", name]),
        kind: "definition_added",
        breaking: false,
      });
    }
  }
  return Object.freeze({
    compatible: !changes.some((change) => change.breaking),
    changes: Object.freeze(changes.map(Object.freeze)),
  });
}

export function assertProtocolCompatible(previous, next) {
  const report = compareProtocolSchemas(previous, next);
  if (!report.compatible) {
    const details = report.changes
      .filter((change) => change.breaking)
      .map((change) => `${change.kind} at ${change.path}`)
      .join("; ");
    const error = new Error(`Breaking protocol change: ${details}`);
    error.code = "CC_PROTOCOL_BREAKING_CHANGE";
    error.report = report;
    throw error;
  }
  return report;
}
