function compareJson(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function eventNode(event) {
  if (event.type === "system" && event.subtype === "init") {
    return `session:${event.session_id}:initialized`;
  }
  if (event.type === "approval_request") {
    return `approval:${event.id}:requested`;
  }
  if (event.type === "approval_resolved") {
    return `approval:${event.id}:resolved`;
  }
  if (event.type === "tool_use") {
    return `tool:${event.id}:started`;
  }
  if (event.type === "tool_result") {
    return `tool:${event.id}:completed`;
  }
  if (event.type === "result") {
    return `turn:${event.session_id}:${event.turn}:terminal`;
  }
  throw new TypeError(`Unsupported causal fixture event: ${event.type}`);
}

export function projectCausalAgentStream(events) {
  const nodes = new Set(events.map(eventNode));
  if (nodes.size !== events.length) {
    throw new TypeError("Causal fixture contains duplicate semantic nodes");
  }

  const initialized = events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  const approvalRequest = events.find(
    (event) => event.type === "approval_request",
  );
  const approvalResolved = events.find(
    (event) => event.type === "approval_resolved",
  );
  const terminal = events.find((event) => event.type === "result");
  const toolUses = events.filter((event) => event.type === "tool_use");
  const toolResults = events.filter((event) => event.type === "tool_result");

  if (!initialized || !approvalRequest || !approvalResolved || !terminal) {
    throw new TypeError("Causal fixture is missing a required boundary event");
  }

  const edges = [
    [eventNode(initialized), eventNode(approvalRequest)],
    [eventNode(approvalRequest), eventNode(approvalResolved)],
    ...toolUses.map((event) => [eventNode(approvalResolved), eventNode(event)]),
    ...toolUses.map((event) => {
      const result = toolResults.find((candidate) => candidate.id === event.id);
      if (!result) throw new TypeError(`Missing tool_result for ${event.id}`);
      return [eventNode(event), eventNode(result)];
    }),
    ...toolResults.map((event) => [eventNode(event), eventNode(terminal)]),
  ].sort(compareJson);

  return {
    nodes: [...nodes].sort(),
    partialOrder: edges,
    approvalBinding: {
      id: approvalRequest.id,
      binding: approvalRequest.binding,
    },
    terminal: {
      subtype: terminal.subtype,
      isError: terminal.is_error === true,
      result: terminal.result,
      sessionId: terminal.session_id,
      turn: terminal.turn,
      toolCalls: terminal.tool_calls,
    },
  };
}

export function assertDeclaredEquivalenceClasses(projection, classes) {
  const edges = new Set(
    projection.partialOrder.map(([from, to]) => `${from}\u0000${to}`),
  );
  const adjacency = new Map(
    projection.nodes.map((node) => [node, new Set()]),
  );
  for (const edge of edges) {
    const [from, to] = edge.split("\u0000");
    adjacency.get(from)?.add(to);
  }

  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(adjacency.get(from) || [])].some((next) =>
      reaches(next, target, seen),
    );
  };

  for (const equivalenceClass of classes) {
    for (let index = 0; index < equivalenceClass.length; index += 1) {
      for (let other = index + 1; other < equivalenceClass.length; other += 1) {
        const left = equivalenceClass[index];
        const right = equivalenceClass[other];
        if (!adjacency.has(left) || !adjacency.has(right)) {
          throw new TypeError("Equivalence class references an unknown node");
        }
        if (reaches(left, right) || reaches(right, left)) {
          throw new TypeError(`${left} and ${right} are causally ordered`);
        }
      }
    }
  }
  return true;
}
