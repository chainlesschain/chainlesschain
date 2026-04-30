/**
 * mcp-schema — pure helpers for rendering an MCP tool's `inputSchema` as a
 * form. Used by `McpToolForm.vue` (the schema-form mode of McpTools.vue's
 * run modal). Lives in utils/ so vitest can drive it without mounting Vue.
 *
 * Scope of supported types (MCP tools' inputSchema is a subset of JSON Schema
 * draft-07; in practice tools use a small fraction of the spec):
 *
 *   string                → text input    (or select if .enum is present)
 *   string + format=long  → textarea      (heuristic; falls back to text)
 *   integer / number      → number input
 *   boolean               → switch
 *   array of string       → tag input (newline / comma split)
 *   anything more complex → "raw" widget that stores a JSON string the user
 *                           edits directly (and we re-parse at submit time)
 *
 * The "raw" escape hatch keeps the form usable for tools whose schema we
 * don't fully understand yet — better than throwing.
 */

/**
 * @typedef {Object} Field
 * @property {string} name        - property key
 * @property {string} type        - normalised JSON Schema type
 * @property {string} widget      - 'text' | 'textarea' | 'number' | 'boolean'
 *                                  | 'select' | 'tags' | 'raw'
 * @property {string} label
 * @property {string} description
 * @property {boolean} required
 * @property {any} [default]
 * @property {Array<string|number>} [enum]
 * @property {string} [itemsType] - element type for arrays (string only)
 */

/**
 * Extract a flat list of fields from a JSON Schema-shaped `inputSchema`.
 * Returns `[]` when the schema isn't a `type: "object"` with `properties` —
 * the caller should fall back to the raw-JSON UI in that case.
 *
 * @param {any} schema
 * @returns {Field[]}
 */
export function extractFields(schema) {
  if (!schema || typeof schema !== "object") return []
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    return []
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields = []
  for (const [name, raw] of Object.entries(schema.properties)) {
    if (!raw || typeof raw !== "object") continue
    fields.push(toField(name, raw, required.has(name)))
  }
  return fields
}

function toField(name, prop, required) {
  const type = normaliseType(prop.type)
  const description = typeof prop.description === "string" ? prop.description : ""
  const label = prop.title || name
  const hasEnum = Array.isArray(prop.enum) && prop.enum.length > 0

  let widget = "raw"
  let itemsType = null
  if (hasEnum) {
    widget = "select"
  } else if (type === "string") {
    widget = isLongText(prop, description) ? "textarea" : "text"
  } else if (type === "integer" || type === "number") {
    widget = "number"
  } else if (type === "boolean") {
    widget = "boolean"
  } else if (type === "array") {
    const itemType = prop.items && typeof prop.items === "object" ? prop.items.type : null
    if (itemType === "string") {
      widget = "tags"
      itemsType = "string"
    }
    // arrays of objects / numbers fall through to "raw" — non-trivial UX.
  }

  return {
    name,
    type,
    widget,
    label,
    description,
    required,
    default: prop.default,
    enum: hasEnum ? prop.enum.slice() : undefined,
    itemsType,
  }
}

export function normaliseType(t) {
  if (typeof t === "string") return t
  // JSON Schema allows arrays of types (e.g. ["string", "null"]). Pick the
  // first non-null one — best-effort.
  if (Array.isArray(t)) {
    const first = t.find((x) => x && x !== "null")
    return first || "any"
  }
  return "any"
}

export function isLongText(prop, description) {
  if (prop.format === "long-text" || prop.format === "textarea") return true
  if (typeof prop.maxLength === "number" && prop.maxLength > 200) return true
  if (description.length > 120) return true
  return false
}

/**
 * Build a fresh values object from a list of fields. Required fields with no
 * default get an empty placeholder so the form renders something editable.
 *
 * @param {Field[]} fields
 * @returns {Record<string, any>}
 */
export function defaultValues(fields) {
  const out = {}
  for (const f of fields) {
    if (f.default !== undefined) {
      out[f.name] = clone(f.default)
      continue
    }
    if (f.widget === "boolean") {
      out[f.name] = false
    } else if (f.widget === "tags") {
      out[f.name] = []
    } else if (f.widget === "number") {
      out[f.name] = null
    } else if (f.widget === "raw") {
      out[f.name] = ""
    } else {
      out[f.name] = ""
    }
  }
  return out
}

function clone(v) {
  if (Array.isArray(v)) return v.slice()
  if (v && typeof v === "object") return { ...v }
  return v
}

/**
 * Validate + normalise form values into the params object MCP wants.
 * Returns `{ok: true, params}` on success, `{ok: false, errors}` on failure
 * where errors is `{ <fieldName>: <message> }`. Consumers show errors
 * inline next to each field.
 *
 * @param {Field[]} fields
 * @param {Record<string, any>} values
 * @returns {{ ok: true, params: Record<string, any> } | { ok: false, errors: Record<string, string> }}
 */
export function validateValues(fields, values) {
  const errors = {}
  const params = {}
  for (const f of fields) {
    const v = values?.[f.name]
    const empty = isEmpty(v, f.widget)

    if (empty) {
      if (f.required) {
        errors[f.name] = "必填"
      }
      // Skip empty optional fields — don't include them in the params,
      // so the tool sees an actual omission instead of an empty string.
      continue
    }

    if (f.widget === "number") {
      const n = typeof v === "number" ? v : Number(v)
      if (Number.isNaN(n)) {
        errors[f.name] = "必须是数字"
        continue
      }
      if (f.type === "integer" && !Number.isInteger(n)) {
        errors[f.name] = "必须是整数"
        continue
      }
      params[f.name] = n
      continue
    }

    if (f.widget === "boolean") {
      params[f.name] = Boolean(v)
      continue
    }

    if (f.widget === "tags") {
      const arr = Array.isArray(v)
        ? v
        : String(v)
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean)
      params[f.name] = arr
      continue
    }

    if (f.widget === "select") {
      if (Array.isArray(f.enum) && !f.enum.includes(v)) {
        errors[f.name] = "值不在允许的选项内"
        continue
      }
      params[f.name] = v
      continue
    }

    if (f.widget === "raw") {
      // The raw widget stores a JSON string. Empty was already handled.
      try {
        params[f.name] = JSON.parse(v)
      } catch (err) {
        errors[f.name] = `JSON 解析失败：${err.message}`
      }
      continue
    }

    // text / textarea: pass through
    params[f.name] = v
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, params }
}

function isEmpty(v, widget) {
  if (v === null || v === undefined) return true
  if (widget === "boolean") return false  // boolean is never "empty"
  if (widget === "number") return v === "" || v === null
  if (widget === "tags") {
    if (Array.isArray(v)) return v.length === 0
    return String(v).trim() === ""
  }
  if (typeof v === "string") return v.trim() === ""
  return false
}

