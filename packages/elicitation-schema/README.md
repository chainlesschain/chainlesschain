# MCP form elicitation schema core

This package is the canonical form model and submission validator shared by the
Desktop and VS Code clients. The JetBrains native adapter is checked against
the package's conformance fixture.

Supported vocabulary is intentionally the restricted, flat MCP form subset:

- top-level `type: "object"`, `properties`, and `required`;
- boolean fields with `title`, `description`, and `default`;
- string fields with `minLength`, `maxLength`, `email`, `uri`, `date`, and
  `date-time` formats;
- number/integer fields with `minimum` and `maximum`;
- string `enum`, legacy `enumNames`, titled `oneOf` choices;
- multi-select arrays using `items.enum` or titled `items.anyOf`, plus
  `minItems` and `maxItems`.

It does not implement nested object schemas, arbitrary arrays, `$ref`, remote
schema loading, or the full JSON Schema Draft 2020-12 meta-vocabulary.
