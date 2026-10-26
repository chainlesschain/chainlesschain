// Read-only Remote Robot probe. Strip only known UI wrappers, never body text.
function transcriptRowBody(rendered, role, ordinal, truncated, promoted) {
  if (promoted) {
    // Older public plugins promoted an unwrapped body. Accessible turn headings
    // are now part of the live span, outside its rendered Markdown body.
    if (role === "assistant" && rendered.indexOf("Turn ") === 0) {
      var heading = /^Turn [1-9][0-9]*, Assistant response\n/.exec(rendered);
      if (heading === null) throw new Error("Malformed live row wrapper");
      return rendered.slice(heading[0].length);
    }
    return rendered;
  }
  var labels = {
    user: "User message",
    assistant: "Assistant response",
    tool: "Tool result",
  };
  if (!Object.prototype.hasOwnProperty.call(labels, role))
    throw new Error("Unsupported saved row role");
  var prefix = "\nMessage " + (ordinal + 1) + ", ";
  var legacy = prefix + role + " (saved)\n";
  var accessible = prefix + labels[role] + "\n";
  var heading = rendered.indexOf(legacy) === 0 ? legacy : accessible;
  var suffix = truncated
    ? "\n[Message shortened for display; the saved session retains its original content.]\n"
    : "\n";
  if (
    rendered.indexOf(heading) !== 0 ||
    rendered.slice(-suffix.length) !== suffix ||
    rendered.length < heading.length + suffix.length
  )
    throw new Error("Malformed saved row wrapper");
  return rendered.slice(heading.length, rendered.length - suffix.length);
}
