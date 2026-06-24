"""Text utilities for cleaning up LLM output."""

import re

# Opening fence: ``` optionally followed by a language tag (word chars + a few
# symbols like c++, c#). Stops at the first newline or non-tag char (e.g. "<"),
# so it never eats content even when everything is on one line.
_OPENING_FENCE_RE = re.compile(r"^```[a-zA-Z0-9+#.\-]*\n?")
# Closing fence: a trailing ``` at the very end (optionally preceded by a newline
# and followed by whitespace).
_CLOSING_FENCE_RE = re.compile(r"\n?```\s*$")


def strip_code_fences(text: str) -> str:
    """Strip a leading ```<lang> fence and a trailing ``` from LLM output.

    Robust against any language tag (``` ```html ```, ``` ```HTML ```,
    ``` ```xml ```, bare ``` ``` ```), unlike a naive
    ``text.replace("```html", "").replace("```", "")`` which:
      (a) leaks a non-matching tag — ``` ```HTML\n<x> ``` would yield
          ``"HTML\n<x>"`` because only the lowercase literal is removed; and
      (b) strips legitimate *inner* ``` ``` ``` that appear inside the content
          (e.g. a code sample embedded in generated HTML).

    Only the outermost opening/closing fences are removed; inner fences and
    fence-less text are left untouched.
    """
    if not text:
        return text
    s = text.strip()
    s = _OPENING_FENCE_RE.sub("", s, count=1)
    s = _CLOSING_FENCE_RE.sub("", s, count=1)
    return s.strip()
