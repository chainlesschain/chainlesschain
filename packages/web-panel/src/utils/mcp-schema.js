/**
 * mcp-schema — pure helpers for rendering an MCP tool's `inputSchema` as a
 * form. Used by `McpToolForm.vue` (the schema-form mode of McpTools.vue's
 * run modal). Lives in utils/ so vitest can drive it without mounting Vue.
 *
 * Supported widget mappings:
 *
 *   string                → text input    (or select if .enum is present)
 *   string + format=long  → textarea      (heuristic; also long maxLength
 *                                          / long description)
 *   integer / number      → number input
 *   boolean               → switch
 *   array of string       → tags input (newline / comma split)
 *   nested object         → recursive flatten with dotted path; widget
 *                           per leaf, group rendered with indent + parent
 *                           label in McpToolForm.vue
 *   array of object       → 'objectList' widget — items[] of sub-forms
 *                           with add/remove. Sub-fields extracted
 *                           recursively from items.properties.
 *   anything else         → 'raw' widget that stores a JSON string the
 *                           user edits directly (re-parsed at submit time)
 *
 * The 'raw' escape hatch keeps the form usable for tools whose schema we
 * don't fully understand yet — better than throwing.
 */

/**
 * @typedef {Object} Field
 * @property {string} name        - dotted property path ('a.b.c') for leaves;
 *                                  also used as a stable key.
 * @property {string[]} path      - parsed path (['a','b','c']) for nested
 *                                  setters / display indent.
 * @property {string} type        - normalised JSON Schema type
 * @property {string} widget      - 'text' | 'textarea' | 'number' | 'boolean'
 *                                  | 'select' | 'tags' | 'raw' | 'objectList'
 * @property {string} label
 * @property {string} description
 * @property {boolean} required
 * @property {any} [default]
 * @property {Array<string|number>} [enum]
 * @property {string} [itemsType]      - element type for arrays of strings
 * @property {Field[]} [itemFields]    - sub-fields for objectList items
 */

/**
 * Extract a flat list of fields from a JSON Schema-shaped `inputSchema`.
 * Returns `[]` when the schema isn't a `type: "object"` with `properties` —
 * the caller should fall back to the raw-JSON UI in that case.
 *
 * Nested object properties are flattened: `{a: {type:'object', properties:
 * {b: {type:'string'}}}}` becomes a single field `name='a.b'`, `path=['a','b']`.
 * Required is computed per leaf using the parent's required[] for the
 * immediate parent path; deeper required arrays are honoured.
 *
 * @param {any} schema
 * @returns {Field[]}
 */
export function extractFields(schema) {
  if (!schema || typeof schema !== "object") return []
  if (
    schema.type !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object"
  ) {
    return []
  }
  return walkObject(schema, [])
}

/**
 * Walk a `type:"object"` node, returning a flat field list. Each property
 * is either:
 *  - a leaf (primitive / array / objectList) — emits one field
 *  - a nested object — recursively walked, fields prefixed with the path
 */
function walkObject(objectSchema, parentPath) {
  const required = new Set(
    Array.isArray(objectSchema.required) ? objectSchema.required : [],
  )
  const out = []
  const props = objectSchema.properties || {}
  for (const [key, raw] of Object.entries(props)) {
    if (!raw || typeof raw !== "object") continue
    const path = [...parentPath, key]
    const isRequired = required.has(key)
    const type = normaliseType(raw.type)

    // Nested object → recurse. Parent's required[] only governs whether the
    // PARENT key as a whole is required; required[] of the nested object
    // governs its own children.
    if (type === "object" && raw.properties && typeof raw.properties === "object") {
      const childFields = walkObject(raw, path)
      // If the nested object had no walkable children, fall back to raw.
      if (childFields.length === 0) {
        out.push(toLeaf(path, raw, isRequired, "raw"))
      } else {
        out.push(...childFields)
      }
      continue
    }

    out.push(toLeaf(path, raw, isRequired))
  }
  return out
}

/**
 * Build a leaf Field from a property schema. `forceWidget` is used by
 * caller paths that already decided the widget (e.g. recursion fallback).
 */
function toLeaf(path, prop, required, forceWidget) {
  const type = normaliseType(prop.type)
  const description = typeof prop.description === "string" ? prop.description : ""
  const name = path.join(".")
  const label = prop.title || path[path.length - 1]
  const hasEnum = Array.isArray(prop.enum) && prop.enum.length > 0

  let widget = "raw"
  let itemsType = null
  let itemFields = undefined

  if (forceWidget) {
    widget = forceWidget
  } else if (hasEnum) {
    widget = "select"
  } else if (type === "string") {
    widget = isLongText(prop, description) ? "textarea" : "text"
  } else if (type === "integer" || type === "number") {
    widget = "number"
  } else if (type === "boolean") {
    widget = "boolean"
  } else if (type === "array") {
    const itemsSchema =
      prop.items && typeof prop.items === "object" ? prop.items : null
    const itemType = itemsSchema ? normaliseType(itemsSchema.type) : null
    if (itemType === "string") {
      widget = "tags"
      itemsType = "string"
    } else if (
      itemType === "object" &&
      itemsSchema.properties &&
      typeof itemsSchema.properties === "object"
    ) {
      widget = "objectList"
      // Sub-fields are extracted at root-level paths so the rendered form
      // for each item looks just like the top-level form.
      itemFields = walkObject(itemsSchema, [])
      // If items.properties yielded nothing useful, fall back to raw JSON.
      if (itemFields.length === 0) {
        widget = "raw"
        itemFields = undefined
      }
    }
    // arrays of numbers / mixed / unknown fall through to 'raw'.
  }

  return {
    name,
    path,
    type,
    widget,
    label,
    description,
    required,
    default: prop.default,
    enum: hasEnum ? prop.enum.slice() : undefined,
    itemsType,
    ...(itemFields ? { itemFields } : {}),
  }
}

export function normaliseType(t) {
  if (typeof t === "string") return t
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
 * Build a fresh values object keyed by Field.name (the dotted path string,
 * e.g. 'a.b.c'). Top-level driver — for nested fields the dotted-name keys
 * compose into the final params via setByPath() at validate time.
 *
 * objectList fields default to []; if the list has a default array we
 * deep-copy it so the form can mutate freely.
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
    } else if (f.widget === "objectList") {
      out[f.name] = []
    } else {
      out[f.name] = ""
    }
  }
  return out
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone)
  if (v && typeof v === "object") {
    const o = {}
    for (const [k, vv] of Object.entries(v)) o[k] = clone(vv)
    return o
  }
  return v
}

/**
 * Validate + normalise form values into the params object MCP wants.
 *
 * For nested fields (Field.path.length > 1), the resulting params is set
 * via the path so {a: {b: 1}} is built from `values['a.b'] = 1`.
 *
 * For objectList fields, `values[name]` is an array of plain objects whose
 * keys match the dotted-name keys of itemFields (so a single item is
 * itself a values map). Each item is validated via validateValues
 * recursively; per-item errors are flattened with `<name>[<i>].<sub>` keys.
 *
 * @param {Field[]} fields
 * @param {Record<string, any>} values
 * @returns {{ ok: true, params: object } | { ok: false, errors: Record<string, string> }}
 */
export function validateValues(fields, values) {
  const errors = {}
  const params = {}
  for (const f of fields) {
    // Hand-built tests / external callers may pass fields without `path`.
    // Fall back to splitting the dotted name. Top-level callers built via
    // extractFields always have path set.
    const path = Array.isArray(f.path) ? f.path : String(f.name).split(".")
    const v = values?.[f.name]
    const empty = isEmpty(v, f.widget)

    if (empty) {
      if (f.required) {
        errors[f.name] = "必填"
      }
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
      setByPath(params, path, n)
      continue
    }

    if (f.widget === "boolean") {
      setByPath(params, path, Boolean(v))
      continue
    }

    if (f.widget === "tags") {
      const arr = Array.isArray(v)
        ? v
        : String(v)
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean)
      setByPath(params, path, arr)
      continue
    }

    if (f.widget === "select") {
      if (Array.isArray(f.enum) && !f.enum.includes(v)) {
        errors[f.name] = "值不在允许的选项内"
        continue
      }
      setByPath(params, path, v)
      continue
    }

    if (f.widget === "raw") {
      try {
        setByPath(params, path, JSON.parse(v))
      } catch (err) {
        errors[f.name] = `JSON 解析失败：${err.message}`
      }
      continue
    }

    if (f.widget === "objectList") {
      if (!Array.isArray(v)) {
        errors[f.name] = "必须是列表"
        continue
      }
      if (v.length === 0) {
        // Empty optional list — omit from params (matches the "drops empty
        // optional fields" pattern). isEmpty for objectList treats only
        // null/undefined as empty so we get to this branch with [].
        continue
      }
      const built = []
      let itemHadError = false
      for (let i = 0; i < v.length; i++) {
        const item = v[i]
        if (!item || typeof item !== "object") {
          errors[`${f.name}[${i}]`] = "必须是对象"
          itemHadError = true
          continue
        }
        const sub = validateValues(f.itemFields || [], item)
        if (!sub.ok) {
          itemHadError = true
          for (const [k, msg] of Object.entries(sub.errors)) {
            errors[`${f.name}[${i}].${k}`] = msg
          }
          continue
        }
        built.push(sub.params)
      }
      if (!itemHadError) {
        setByPath(params, path, built)
      }
      continue
    }

    // text / textarea: pass through
    setByPath(params, path, v)
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, params }
}

/** Write `value` into `obj` at `path` (creating intermediate objects). */
function setByPath(obj, path, value) {
  if (path.length === 1) {
    obj[path[0]] = value
    return
  }
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (cur[k] === undefined || typeof cur[k] !== "object" || Array.isArray(cur[k])) {
      cur[k] = {}
    }
    cur = cur[k]
  }
  cur[path[path.length - 1]] = value
}

function isEmpty(v, widget) {
  if (v === null || v === undefined) return true
  if (widget === "boolean") return false
  if (widget === "number") return v === "" || v === null
  if (widget === "tags") {
    if (Array.isArray(v)) return v.length === 0
    return String(v).trim() === ""
  }
  if (widget === "objectList") {
    // null/undefined → empty (caught by required check). Non-array shapes
    // are NOT treated as empty — they fall through to the main objectList
    // branch which flags them as 必须是列表. Empty arrays also fall through
    // and are omitted from params via the explicit length===0 check.
    return v === null || v === undefined
  }
  if (typeof v === "string") return v.trim() === ""
  return false
}
