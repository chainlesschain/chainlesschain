/**
 * Shared MCP form-elicitation schema core.
 *
 * This deliberately implements the restricted, flat vocabulary accepted by
 * MCP form elicitation. It is not a general JSON Schema implementation:
 * nested objects/arbitrary arrays, $ref, and the Draft 2020-12 meta-vocabulary
 * are outside this package's contract.
 *
 * The UMD wrapper lets Desktop/Node require the exact same executable module
 * that VS Code embeds in its CSP-isolated Webview.
 */
(function attachElicitationSchema(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CcElicitationSchema = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createElicitationSchemaApi() {
    "use strict";

    const VOCABULARY_VERSION = "mcp-restricted-form-v1";
    const STRING_FORMATS = new Set(["email", "uri", "date", "date-time"]);

    function isRecord(value) {
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
    }

    function hasOwn(value, key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    }

    function cloneJsonValue(value) {
      if (Array.isArray(value)) {
        return value.map(cloneJsonValue);
      }
      if (isRecord(value)) {
        const copy = {};
        for (const [key, child] of Object.entries(value)) {
          copy[key] = cloneJsonValue(child);
        }
        return copy;
      }
      return value;
    }

    function issue(path, code, message) {
      return { path, code, message };
    }

    function finiteNumber(value) {
      return typeof value === "number" && Number.isFinite(value);
    }

    function nonNegativeInteger(value) {
      return Number.isInteger(value) && value >= 0;
    }

    function titledOptions(entries, path, errors) {
      if (!Array.isArray(entries) || entries.length === 0) {
        errors.push(
          issue(path, "invalid_options", "at least one option is required"),
        );
        return [];
      }
      const options = [];
      entries.forEach((entry, index) => {
        const optionPath = `${path}/${index}`;
        if (
          !isRecord(entry) ||
          typeof entry.const !== "string" ||
          typeof entry.title !== "string"
        ) {
          errors.push(
            issue(
              optionPath,
              "invalid_option",
              "titled options require string const and title values",
            ),
          );
          return;
        }
        options.push({ value: entry.const, label: entry.title });
      });
      return options;
    }

    function enumOptions(values, names, path, errors) {
      if (
        !Array.isArray(values) ||
        values.length === 0 ||
        values.some((value) => typeof value !== "string")
      ) {
        errors.push(
          issue(path, "invalid_enum", "enum must contain one or more strings"),
        );
        return [];
      }
      const labels =
        Array.isArray(names) && names.every((name) => typeof name === "string")
          ? names
          : [];
      return values.map((value, index) => ({
        value,
        label: labels[index] === undefined ? value : labels[index],
      }));
    }

    function validateRange(
      spec,
      minimumKey,
      maximumKey,
      integerOnly,
      path,
      errors,
    ) {
      const minimum = spec[minimumKey];
      const maximum = spec[maximumKey];
      if (
        minimum !== undefined &&
        !(integerOnly ? nonNegativeInteger(minimum) : finiteNumber(minimum))
      ) {
        errors.push(
          issue(
            `${path}/${minimumKey}`,
            "invalid_constraint",
            `${minimumKey} must be ${integerOnly ? "a non-negative integer" : "a finite number"}`,
          ),
        );
      }
      if (
        maximum !== undefined &&
        !(integerOnly ? nonNegativeInteger(maximum) : finiteNumber(maximum))
      ) {
        errors.push(
          issue(
            `${path}/${maximumKey}`,
            "invalid_constraint",
            `${maximumKey} must be ${integerOnly ? "a non-negative integer" : "a finite number"}`,
          ),
        );
      }
      if (
        typeof minimum === "number" &&
        typeof maximum === "number" &&
        minimum > maximum
      ) {
        errors.push(
          issue(
            path,
            "invalid_range",
            `${minimumKey} cannot exceed ${maximumKey}`,
          ),
        );
      }
    }

    function normalizeField(name, spec, required, path, errors) {
      if (!isRecord(spec)) {
        errors.push(
          issue(path, "invalid_field_schema", "field schema must be an object"),
        );
        return null;
      }

      const type = spec.type;
      const common = {
        name,
        type,
        title: typeof spec.title === "string" ? spec.title : name,
        description:
          typeof spec.description === "string" ? spec.description : "",
        required,
        hasDefault: hasOwn(spec, "default"),
        default: hasOwn(spec, "default")
          ? cloneJsonValue(spec.default)
          : undefined,
      };

      if (type === "string" && Array.isArray(spec.enum)) {
        return {
          ...common,
          kind: "single-select",
          options: enumOptions(
            spec.enum,
            spec.enumNames,
            `${path}/enum`,
            errors,
          ),
        };
      }

      if (type === "string" && Array.isArray(spec.oneOf)) {
        return {
          ...common,
          kind: "single-select",
          options: titledOptions(spec.oneOf, `${path}/oneOf`, errors),
        };
      }

      if (type === "array") {
        if (!isRecord(spec.items)) {
          errors.push(
            issue(
              `${path}/items`,
              "unsupported_array",
              "multi-select arrays require an items schema",
            ),
          );
          return null;
        }
        let options = [];
        if (Array.isArray(spec.items.enum)) {
          options = enumOptions(
            spec.items.enum,
            null,
            `${path}/items/enum`,
            errors,
          );
        } else if (Array.isArray(spec.items.anyOf)) {
          options = titledOptions(
            spec.items.anyOf,
            `${path}/items/anyOf`,
            errors,
          );
        } else {
          errors.push(
            issue(
              `${path}/items`,
              "unsupported_array",
              "only MCP string multi-select arrays are supported",
            ),
          );
        }
        validateRange(spec, "minItems", "maxItems", true, path, errors);
        return {
          ...common,
          kind: "multi-select",
          options,
          minItems: spec.minItems,
          maxItems: spec.maxItems,
        };
      }

      if (type === "boolean") {
        return { ...common, kind: "boolean" };
      }

      if (type === "string") {
        validateRange(spec, "minLength", "maxLength", true, path, errors);
        if (spec.format !== undefined && !STRING_FORMATS.has(spec.format)) {
          errors.push(
            issue(
              `${path}/format`,
              "unsupported_format",
              `unsupported MCP string format: ${String(spec.format)}`,
            ),
          );
        }
        return {
          ...common,
          kind: "text",
          format: STRING_FORMATS.has(spec.format) ? spec.format : null,
          inputType:
            spec.format === "email"
              ? "email"
              : spec.format === "uri"
                ? "url"
                : spec.format === "date"
                  ? "date"
                  : "text",
          minLength: spec.minLength,
          maxLength: spec.maxLength,
        };
      }

      if (type === "number" || type === "integer") {
        validateRange(spec, "minimum", "maximum", false, path, errors);
        return {
          ...common,
          kind: type,
          minimum: spec.minimum,
          maximum: spec.maximum,
          step: type === "integer" ? 1 : "any",
        };
      }

      errors.push(
        issue(
          `${path}/type`,
          "unsupported_type",
          `unsupported MCP elicitation field type: ${String(type)}`,
        ),
      );
      return null;
    }

    function compileElicitationSchema(schema) {
      const errors = [];
      if (!isRecord(schema)) {
        return {
          version: VOCABULARY_VERSION,
          supported: false,
          fields: [],
          required: [],
          errors: [
            issue("", "invalid_schema", "requestedSchema must be an object"),
          ],
        };
      }
      if (schema.type !== "object") {
        errors.push(
          issue(
            "/type",
            "unsupported_root",
            'MCP form requestedSchema must have type "object"',
          ),
        );
      }
      if (!isRecord(schema.properties)) {
        errors.push(
          issue(
            "/properties",
            "invalid_properties",
            "requestedSchema.properties must be an object",
          ),
        );
      }

      const propertyNames = isRecord(schema.properties)
        ? Object.keys(schema.properties)
        : [];
      const required = [];
      if (schema.required !== undefined) {
        if (
          !Array.isArray(schema.required) ||
          schema.required.some((name) => typeof name !== "string")
        ) {
          errors.push(
            issue(
              "/required",
              "invalid_required",
              "required must be an array of property names",
            ),
          );
        } else {
          for (const name of schema.required) {
            if (!propertyNames.includes(name)) {
              errors.push(
                issue(
                  "/required",
                  "unknown_required",
                  `required property is not declared: ${name}`,
                ),
              );
            } else if (!required.includes(name)) {
              required.push(name);
            }
          }
        }
      }

      const fields = [];
      if (isRecord(schema.properties)) {
        for (const [name, spec] of Object.entries(schema.properties)) {
          const field = normalizeField(
            name,
            spec,
            required.includes(name),
            `/properties/${name}`,
            errors,
          );
          if (field) {
            fields.push(field);
          }
        }
      }

      const model = {
        version: VOCABULARY_VERSION,
        supported: errors.length === 0,
        fields,
        required,
        errors,
      };

      if (model.supported) {
        for (const field of fields) {
          if (!field.hasDefault) continue;
          const defaultResult = validateField(field, field.default);
          if (defaultResult) {
            model.errors.push(
              issue(
                `/properties/${field.name}/default`,
                "invalid_default",
                defaultResult.message,
              ),
            );
          }
        }
        model.supported = model.errors.length === 0;
      }
      return model;
    }

    function initialElicitationValues(modelOrSchema) {
      const model =
        modelOrSchema &&
        Array.isArray(modelOrSchema.fields) &&
        typeof modelOrSchema.supported === "boolean"
          ? modelOrSchema
          : compileElicitationSchema(modelOrSchema);
      const values = {};
      for (const field of model.fields) {
        if (field.hasDefault) {
          values[field.name] = cloneJsonValue(field.default);
        } else if (field.kind === "boolean") {
          values[field.name] = false;
        } else if (field.kind === "multi-select") {
          values[field.name] = [];
        } else {
          values[field.name] = undefined;
        }
      }
      return values;
    }

    function isAbsent(value) {
      return value === undefined || value === null;
    }

    function coerceField(field, value) {
      if (field.kind === "boolean") {
        if (typeof value === "boolean") return value;
        if (value === "true" || value === "1" || value === 1) return true;
        if (value === "false" || value === "0" || value === 0) return false;
        return value;
      }
      if (field.kind === "number" || field.kind === "integer") {
        if (typeof value === "number") return value;
        if (typeof value === "string" && value.trim() !== "") {
          return Number(value);
        }
        return value;
      }
      if (field.kind === "multi-select") {
        return Array.isArray(value)
          ? value.map((entry) => String(entry))
          : value;
      }
      if (field.kind === "single-select" || field.kind === "text") {
        return typeof value === "string" ? value : String(value);
      }
      return value;
    }

    function coerceElicitationAnswer(modelOrSchema, rawValues) {
      const model =
        modelOrSchema &&
        Array.isArray(modelOrSchema.fields) &&
        typeof modelOrSchema.supported === "boolean"
          ? modelOrSchema
          : compileElicitationSchema(modelOrSchema);
      const source = isRecord(rawValues) ? rawValues : {};
      const answer = {};
      for (const field of model.fields) {
        if (!hasOwn(source, field.name) || isAbsent(source[field.name])) {
          continue;
        }
        const raw = source[field.name];
        if (
          raw === "" &&
          !field.required &&
          (field.kind === "number" ||
            field.kind === "integer" ||
            field.kind === "single-select")
        ) {
          continue;
        }
        answer[field.name] = coerceField(field, raw);
      }
      return answer;
    }

    function unicodeLength(value) {
      return Array.from(value).length;
    }

    function validDate(value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return false;
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }

    function validFormat(format, value) {
      if (!format) return true;
      if (format === "email") {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      }
      if (format === "uri") {
        try {
          const parsed = new URL(value);
          return (
            typeof parsed.protocol === "string" && parsed.protocol.length > 1
          );
        } catch {
          return false;
        }
      }
      if (format === "date") {
        return validDate(value);
      }
      if (format === "date-time") {
        return (
          /^\d{4}-\d{2}-\d{2}T/.test(value) &&
          /(Z|[+-]\d{2}:\d{2})$/.test(value) &&
          Number.isFinite(Date.parse(value))
        );
      }
      return true;
    }

    function validateField(field, value) {
      if (field.kind === "boolean") {
        return typeof value === "boolean"
          ? null
          : { code: "type", message: `${field.title} must be a boolean` };
      }

      if (field.kind === "text" || field.kind === "single-select") {
        if (typeof value !== "string") {
          return { code: "type", message: `${field.title} must be a string` };
        }
        if (
          field.kind === "single-select" &&
          !field.options.some((option) => option.value === value)
        ) {
          return {
            code: "enum",
            message: `${field.title} must be one of the available options`,
          };
        }
        if (
          field.minLength !== undefined &&
          unicodeLength(value) < field.minLength
        ) {
          return {
            code: "minLength",
            message: `${field.title} must contain at least ${field.minLength} characters`,
          };
        }
        if (
          field.maxLength !== undefined &&
          unicodeLength(value) > field.maxLength
        ) {
          return {
            code: "maxLength",
            message: `${field.title} must contain at most ${field.maxLength} characters`,
          };
        }
        if (!validFormat(field.format, value)) {
          return {
            code: "format",
            message: `${field.title} must be a valid ${field.format}`,
          };
        }
        return null;
      }

      if (field.kind === "number" || field.kind === "integer") {
        if (!finiteNumber(value)) {
          return {
            code: "type",
            message: `${field.title} must be a finite number`,
          };
        }
        if (field.kind === "integer" && !Number.isInteger(value)) {
          return {
            code: "type",
            message: `${field.title} must be an integer`,
          };
        }
        if (field.minimum !== undefined && value < field.minimum) {
          return {
            code: "minimum",
            message: `${field.title} must be at least ${field.minimum}`,
          };
        }
        if (field.maximum !== undefined && value > field.maximum) {
          return {
            code: "maximum",
            message: `${field.title} must be at most ${field.maximum}`,
          };
        }
        return null;
      }

      if (field.kind === "multi-select") {
        if (!Array.isArray(value)) {
          return {
            code: "type",
            message: `${field.title} must be an array`,
          };
        }
        const allowed = new Set(field.options.map((option) => option.value));
        if (
          value.some(
            (entry) => typeof entry !== "string" || !allowed.has(entry),
          )
        ) {
          return {
            code: "enum",
            message: `${field.title} contains an unavailable option`,
          };
        }
        if (field.minItems !== undefined && value.length < field.minItems) {
          return {
            code: "minItems",
            message: `${field.title} requires at least ${field.minItems} selections`,
          };
        }
        if (field.maxItems !== undefined && value.length > field.maxItems) {
          return {
            code: "maxItems",
            message: `${field.title} allows at most ${field.maxItems} selections`,
          };
        }
        return null;
      }

      return {
        code: "unsupported_type",
        message: `${field.title} uses an unsupported field type`,
      };
    }

    function validateElicitationAnswer(modelOrSchema, answer) {
      const model =
        modelOrSchema &&
        Array.isArray(modelOrSchema.fields) &&
        typeof modelOrSchema.supported === "boolean"
          ? modelOrSchema
          : compileElicitationSchema(modelOrSchema);
      if (!model.supported) {
        return {
          valid: false,
          errors: model.errors.length
            ? model.errors.map((entry) => ({ ...entry }))
            : [
                issue(
                  "",
                  "unsupported_schema",
                  "requestedSchema is not supported",
                ),
              ],
        };
      }
      if (!isRecord(answer)) {
        return {
          valid: false,
          errors: [
            issue("", "type", "elicitation answer content must be an object"),
          ],
        };
      }

      const errors = [];
      for (const field of model.fields) {
        if (!hasOwn(answer, field.name)) {
          if (field.required) {
            errors.push(
              issue(`/${field.name}`, "required", `${field.title} is required`),
            );
          }
          continue;
        }
        const fieldError = validateField(field, answer[field.name]);
        if (fieldError) {
          errors.push(
            issue(`/${field.name}`, fieldError.code, fieldError.message),
          );
        }
      }
      return { valid: errors.length === 0, errors };
    }

    function prepareElicitationSubmission(schemaOrModel, rawValues) {
      const model =
        schemaOrModel &&
        Array.isArray(schemaOrModel.fields) &&
        typeof schemaOrModel.supported === "boolean"
          ? schemaOrModel
          : compileElicitationSchema(schemaOrModel);
      const value = coerceElicitationAnswer(model, rawValues);
      const validation = validateElicitationAnswer(model, value);
      return {
        valid: validation.valid,
        value,
        errors: validation.errors,
        model,
      };
    }

    return Object.freeze({
      VOCABULARY_VERSION,
      compileElicitationSchema,
      initialElicitationValues,
      coerceElicitationAnswer,
      validateElicitationAnswer,
      prepareElicitationSubmission,
    });
  },
);
