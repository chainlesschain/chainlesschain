// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CodingAgentElicitationPanel from "../CodingAgentElicitationPanel.vue";

const stubs = {
  "a-card": {
    template:
      "<section><header><slot name='title' /></header><slot /><slot name='extra' /></section>",
  },
  "a-textarea": {
    props: ["value"],
    emits: ["update:value"],
    template:
      "<textarea class='answer-input' :value='value' @input=\"$emit('update:value', $event.target.value)\" />",
  },
  "a-button": {
    props: ["disabled"],
    emits: ["click"],
    template:
      "<button :disabled='disabled' @click=\"$emit('click')\"><slot /></button>",
  },
  "a-form": { template: "<form><slot /></form>" },
  "a-form-item": {
    props: ["label"],
    template: "<label><span>{{ label }}</span><slot /></label>",
  },
  "a-input": {
    props: ["value", "type"],
    emits: ["update:value"],
    template:
      "<input class='schema-input' :type='type || \"text\"' :data-input-type='type || \"text\"' :value='value' @input=\"$emit('update:value', $event.target.value)\" />",
  },
  "a-input-number": {
    props: ["value"],
    emits: ["update:value"],
    template:
      "<input class='schema-number' type='number' :value='value' @input=\"$emit('update:value', $event.target.value)\" />",
  },
  "a-switch": {
    props: ["checked"],
    emits: ["update:checked"],
    template:
      "<input class='schema-boolean' type='checkbox' :checked='checked' @change=\"$emit('update:checked', $event.target.checked)\" />",
  },
  "a-select": {
    props: ["value", "options", "mode"],
    emits: ["update:value"],
    methods: {
      update(event: Event) {
        const select = event.target as HTMLSelectElement;
        const value =
          this.mode === "multiple"
            ? [...select.selectedOptions].map((option) => option.value)
            : select.value;
        this.$emit("update:value", value);
      },
    },
    template:
      "<select class='schema-select' :multiple='mode === \"multiple\"' :value='value' @change='update'><option v-for='option in options' :key='option.value' :value='option.value'>{{ option.label }}</option></select>",
  },
  "a-checkbox-group": { template: "<div><slot /></div>" },
  "a-checkbox": { template: "<label><slot /></label>" },
  "a-radio-group": { template: "<div><slot /></div>" },
  "a-radio": { template: "<label><slot /></label>" },
};

describe("CodingAgentElicitationPanel", () => {
  it("renders a free-text AskUserQuestion and emits the submitted answer", async () => {
    const wrapper = mount(CodingAgentElicitationPanel, {
      props: {
        request: {
          id: "event-question-1",
          type: "question_request",
          sessionId: "session-1",
          requestId: "question-1",
          payload: {
            id: "question-1",
            question: "What should the release note say?",
            turnId: "turn-1",
            toolUseId: "tool-use-1",
          },
        },
      },
      global: { stubs },
    });

    expect(wrapper.text()).toContain("Agent needs your input");
    expect(wrapper.text()).toContain("What should the release note say?");

    await wrapper.get("textarea.answer-input").setValue("Ship the fix");
    const submit = wrapper
      .findAll("button")
      .find((button) => button.text() === "Submit");
    expect(submit).toBeDefined();
    await submit!.trigger("click");

    expect(wrapper.emitted("accept")).toEqual([["Ship the fix"]]);
  });

  it("renders and validates the shared MCP form vocabulary", async () => {
    const wrapper = mount(CodingAgentElicitationPanel, {
      props: {
        request: {
          id: "event-elicitation-1",
          sessionId: "session-1",
          requestId: "mcp-question-1",
          payload: {
            id: "mcp-question-1",
            question: "Configure the release",
            metadata: {
              kind: "mcp_elicitation",
              server: "release-server",
            },
            requestedSchema: {
              type: "object",
              properties: {
                email: {
                  type: "string",
                  title: "Contact email",
                  description: "Used for release notices",
                  format: "email",
                },
                channel: {
                  type: "string",
                  title: "Release channel",
                  oneOf: [
                    { const: "stable", title: "Stable" },
                    { const: "preview", title: "Preview" },
                  ],
                },
                rating: {
                  type: "integer",
                  title: "Rating",
                  minimum: 1,
                  maximum: 5,
                },
              },
              required: ["email", "channel", "rating"],
            },
          },
        },
      },
      global: { stubs },
    });

    expect(wrapper.text()).toContain("MCP input required");
    expect(wrapper.text()).toContain("release-server");
    expect(wrapper.text()).toContain("Contact email");
    expect(wrapper.text()).toContain("Used for release notices");
    expect(wrapper.text()).toContain("Preview");

    await wrapper.get('input[data-input-type="email"]').setValue("invalid");
    await wrapper.get("select.schema-select").setValue("preview");
    await wrapper.get("input.schema-number").setValue("8");
    const submit = wrapper
      .findAll("button")
      .find((button) => button.text() === "Submit");
    await submit!.trigger("click");

    expect(wrapper.emitted("accept")).toBeUndefined();
    expect(wrapper.text()).toContain("must be a valid email");
    expect(wrapper.text()).toContain("must be at most 5");

    await wrapper
      .get('input[data-input-type="email"]')
      .setValue("dev@example.com");
    await wrapper.get("input.schema-number").setValue("5");
    await submit!.trigger("click");

    expect(wrapper.emitted("accept")).toEqual([
      [
        {
          email: "dev@example.com",
          channel: "preview",
          rating: 5,
        },
      ],
    ]);
  });
});
