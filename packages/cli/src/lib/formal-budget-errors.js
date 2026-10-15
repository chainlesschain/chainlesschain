// Dependency-free so ordinary model transports do not load the formal eval
// specification merely to recognize an authoritative budget failure.
export function budgetError(code, message) {
  return Object.assign(new Error(message), { code, noReplay: true });
}

export function isFormalBudgetError(error) {
  const visited = new Set();
  for (let current = error; current; current = current.cause) {
    if (visited.has(current) || visited.size >= 32) break;
    visited.add(current);
    if (
      typeof current.code === "string" &&
      current.code.startsWith("CC_BUDGET_")
    )
      return true;
  }
  return false;
}

export function requireBudget(condition, message, code = "CC_BUDGET_INVALID") {
  if (!condition) throw budgetError(code, message);
}

export function label(value, name) {
  requireBudget(
    typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value),
    `Invalid ${name}`,
  );
  return value;
}
