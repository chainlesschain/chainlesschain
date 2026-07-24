/**
 * CSP-safe MCP form renderer for the VS Code Webview.
 *
 * Schema semantics live in packages/elicitation-schema. This DOM adapter is
 * UMD so its exact source is embedded in the Webview and exercised in tests.
 */
(function attachElicitationForm(root, factory) {
  const core =
    typeof module === "object" && module.exports
      ? require("../../../elicitation-schema")
      : root.CcElicitationSchema;
  const api = factory(core);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CcElicitationForm = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createElicitationFormApi(core) {
    "use strict";

    function appendText(document, parent, className, text) {
      const element = document.createElement("div");
      element.className = className;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    }

    function renderElicitationForm({
      document,
      container,
      actions,
      schema,
      onSubmit,
    }) {
      if (!core || typeof core.compileElicitationSchema !== "function") {
        throw new Error("MCP elicitation schema core is unavailable");
      }
      const model = core.compileElicitationSchema(schema);
      if (!model.supported) {
        return { rendered: false, model };
      }

      const initial = core.initialElicitationValues(model);
      const controls = [];
      const errorsByName = new Map();
      const globalError = appendText(
        document,
        container,
        "elicitation-error",
        "",
      );
      globalError.hidden = true;

      for (const field of model.fields) {
        const row = document.createElement("div");
        row.className = "elicitation-field";

        const label = document.createElement("label");
        label.textContent = `${field.title}${field.required ? " *" : ""}`;
        row.appendChild(label);
        if (field.description) {
          appendText(
            document,
            row,
            "elicitation-description",
            field.description,
          );
        }

        let read;
        if (field.kind === "single-select") {
          const select = document.createElement("select");
          if (!field.required && !field.hasDefault) {
            const empty = document.createElement("option");
            empty.value = "";
            empty.textContent = "—";
            select.appendChild(empty);
          }
          for (const choice of field.options) {
            const option = document.createElement("option");
            option.value = choice.value;
            option.textContent = choice.label;
            option.selected = initial[field.name] === choice.value;
            select.appendChild(option);
          }
          row.appendChild(select);
          read = () => select.value;
        } else if (field.kind === "multi-select") {
          const group = document.createElement("div");
          group.className = "elicitation-multi";
          const boxes = [];
          const selected = new Set(
            Array.isArray(initial[field.name]) ? initial[field.name] : [],
          );
          for (const choice of field.options) {
            const optionLabel = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = choice.value;
            checkbox.checked = selected.has(choice.value);
            boxes.push(checkbox);
            optionLabel.appendChild(checkbox);
            optionLabel.appendChild(
              document.createTextNode(` ${choice.label}`),
            );
            group.appendChild(optionLabel);
          }
          row.appendChild(group);
          read = () =>
            boxes
              .filter((checkbox) => checkbox.checked)
              .map((box) => box.value);
        } else if (field.kind === "boolean") {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = initial[field.name] === true;
          row.appendChild(checkbox);
          read = () => checkbox.checked;
        } else {
          const input = document.createElement("input");
          if (field.kind === "number" || field.kind === "integer") {
            input.type = "number";
            if (field.minimum !== undefined) input.min = String(field.minimum);
            if (field.maximum !== undefined) input.max = String(field.maximum);
            input.step = String(field.step);
          } else {
            input.type = field.inputType || "text";
            if (field.minLength !== undefined) {
              input.minLength = field.minLength;
            }
            if (field.maxLength !== undefined) {
              input.maxLength = field.maxLength;
            }
          }
          if (initial[field.name] !== undefined) {
            input.value = String(initial[field.name]);
          }
          row.appendChild(input);
          read = () => input.value;
        }

        const error = appendText(document, row, "elicitation-error", "");
        error.setAttribute("role", "alert");
        error.hidden = true;
        errorsByName.set(field.name, error);
        controls.push({ field, read });
        container.appendChild(row);
      }

      const submit = document.createElement("button");
      submit.textContent = "Submit";
      submit.addEventListener("click", () => {
        for (const error of errorsByName.values()) {
          error.textContent = "";
          error.hidden = true;
        }
        globalError.textContent = "";
        globalError.hidden = true;

        const raw = {};
        for (const control of controls) {
          raw[control.field.name] = control.read();
        }
        const submission = core.prepareElicitationSubmission(model, raw);
        if (!submission.valid) {
          for (const problem of submission.errors) {
            const name =
              typeof problem.path === "string" && problem.path.startsWith("/")
                ? problem.path.slice(1)
                : "";
            const target = errorsByName.get(name) || globalError;
            target.textContent = problem.message;
            target.hidden = false;
          }
          return;
        }
        onSubmit(submission.value);
      });
      actions.appendChild(submit);

      return { rendered: true, model, controls, submit };
    }

    return Object.freeze({ renderElicitationForm });
  },
);
