import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MCPSettings from "@renderer/components/MCPSettings.vue";

const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@ant-design/icons-vue", () => ({
  CheckCircleOutlined: { name: "CheckCircleOutlined", template: "<span>check</span>" },
  MinusCircleOutlined: { name: "MinusCircleOutlined", template: "<span>minus</span>" },
  LockOutlined: { name: "LockOutlined", template: "<span>lock</span>" },
  CodeOutlined: { name: "CodeOutlined", template: "<span>code</span>" },
  ReloadOutlined: { name: "ReloadOutlined", template: "<span>reload</span>" },
  CopyOutlined: { name: "CopyOutlined", template: "<span>copy</span>" },
  DeleteOutlined: { name: "DeleteOutlined", template: "<span>delete</span>" },
}));

const globalStubs = {
  "a-card": {
    template: '<div class="a-card"><slot /></div>',
    props: ["title", "loading"],
  },
  "a-row": {
    template: '<div class="a-row"><slot /></div>',
    props: ["gutter"],
  },
  "a-col": {
    template: '<div class="a-col"><slot /></div>',
    props: ["span"],
  },
  "a-statistic": {
    template:
      '<div class="a-statistic"><span class="stat-title">{{ title }}</span><span class="stat-value">{{ value }}</span></div>',
    props: ["title", "value", "valueStyle"],
  },
  "a-form": {
    template: '<form class="a-form"><slot /></form>',
    props: ["layout"],
  },
  "a-form-item": {
    template:
      '<div class="a-form-item"><label v-if="label">{{ label }}</label><slot /></div>',
    props: ["label", "required"],
  },
  "a-switch": {
    template:
      '<input class="a-switch" type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked); $emit(\'change\', $event.target.checked)" />',
    props: ["checked", "size"],
    emits: ["update:checked", "change"],
  },
  "a-alert": {
    template:
      '<div class="a-alert"><span v-if="message">{{ message }}</span><span v-if="description">{{ description }}</span><slot /><slot name="description" /></div>',
    props: ["message", "description", "type", "showIcon", "closable"],
    emits: ["close"],
  },
  "a-divider": {
    template: '<div class="a-divider"><slot /></div>',
    props: ["orientation"],
  },
  "a-space": {
    template: '<div class="a-space"><slot /></div>',
    props: ["wrap", "size"],
  },
  "a-button": {
    template:
      '<button class="a-button" @click="$emit(\'click\')"><slot /></button>',
    props: ["type", "size", "danger", "loading", "disabled", "title"],
    emits: ["click"],
  },
  "a-table": {
    template: `
      <div class="a-table">
        <div
          v-for="record in dataSource"
          :key="typeof rowKey === 'function' ? rowKey(record) : record[rowKey || 'id'] || record.name"
          class="a-table-row"
        >
          <div
            v-for="column in columns"
            :key="column.key || column.dataIndex"
            class="a-table-cell"
          >
            <slot
              name="bodyCell"
              :column="column"
              :record="record"
            >
              {{ record[column.dataIndex] }}
            </slot>
          </div>
        </div>
      </div>
    `,
    props: ["columns", "dataSource", "pagination", "loading", "rowKey"],
  },
  "a-tag": {
    template:
      '<span class="a-tag" :data-color="color"><slot /></span>',
    props: ["color"],
  },
  "a-descriptions": {
    template: '<div class="a-descriptions"><slot /></div>',
    props: ["bordered", "column"],
  },
  "a-descriptions-item": {
    template:
      '<div class="a-descriptions-item"><span class="label">{{ label }}</span><slot /></div>',
    props: ["label"],
  },
  "a-modal": {
    template:
      '<div v-if="open" class="a-modal"><div class="modal-title">{{ title }}</div><slot /><slot name="footer" /></div>',
    props: ["open", "title", "width", "footer", "confirmLoading", "okText", "cancelText"],
    emits: ["update:open", "ok"],
  },
  "a-radio-group": {
    template: '<div class="a-radio-group"><slot /></div>',
    props: ["value", "buttonStyle"],
    emits: ["update:value"],
  },
  "a-radio-button": {
    template: '<button class="a-radio-button"><slot /></button>',
    props: ["value"],
  },
  "a-radio": {
    template: '<label class="a-radio"><slot /></label>',
    props: ["value"],
  },
  "a-input": {
    template:
      '<input class="a-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
    props: ["value", "placeholder", "disabled"],
    emits: ["update:value"],
  },
  "a-input-password": {
    template:
      '<input class="a-input-password" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
    props: ["value", "placeholder"],
    emits: ["update:value"],
  },
  "a-textarea": {
    template:
      '<textarea class="a-textarea" :value="value" @input="$emit(\'update:value\', $event.target.value)"></textarea>',
    props: ["value", "rows", "placeholder"],
    emits: ["update:value"],
  },
  "a-input-number": {
    template:
      '<input class="a-input-number" type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />',
    props: ["value", "min", "max", "step"],
    emits: ["update:value"],
  },
  "a-select": {
    template: '<div class="a-select"><slot /></div>',
    props: ["value", "mode", "placeholder"],
    emits: ["update:value", "change"],
  },
  "a-select-option": {
    template: '<div class="a-select-option"><slot /></div>',
    props: ["value"],
  },
  "a-checkbox-group": {
    template: '<div class="a-checkbox-group"><slot /></div>',
    props: ["value"],
    emits: ["update:value"],
  },
  "a-checkbox": {
    template: '<label class="a-checkbox"><slot /></label>',
    props: ["value"],
  },
  "a-empty": {
    template: '<div class="a-empty">{{ description }}</div>',
    props: ["description"],
  },
};

const createInvokeMock = (overrides = {}) => {
  const handlers = {
    "system:get-path": ({ args }) => {
      const target = args[0];
      if (target === "userData") {
        return { success: true, path: "C:/Users/test/AppData/Roaming/ChainlessChain" };
      }
      if (target === "exe") {
        return { success: true, path: "C:/code/chainlesschain/desktop-app-vue/app.exe" };
      }
      return { success: true, path: "C:/code/chainlesschain" };
    },
    "mcp:get-config": () => ({
      success: true,
      config: { enabled: true },
    }),
    "mcp:list-servers": () => ({
      success: true,
      servers: [
        {
          id: "filesystem",
          name: "Filesystem",
          vendor: "@modelcontextprotocol",
          description: "Local file access",
          securityLevel: "medium",
        },
      ],
    }),
    "mcp:get-connected-servers": () => ({
      success: true,
      servers: [{ name: "filesystem", state: "connected", tools: 1 }],
    }),
    "mcp:get-metrics": () => ({
      success: true,
      metrics: {
        totalCalls: 3,
        successfulCalls: 2,
        toolCallLatencies: new Map(),
      },
    }),
    "mcp:list-tools": () => ({
      success: true,
      tools: [],
    }),
    "mcp:call-tool": () => ({
      success: true,
      result: { content: [{ type: "text", text: "ok" }] },
    }),
  };

  const invoke = vi.fn(async (channel, ...args) => {
    if (overrides[channel]) {
      return overrides[channel](...args);
    }

    const handler = handlers[channel];
    if (!handler) {
      return { success: true };
    }

    return handler({ args });
  });

  return invoke;
};

const mountComponent = async (invoke) => {
  window.electronAPI = { invoke };

  const wrapper = mount(MCPSettings, {
    global: {
      stubs: globalStubs,
    },
  });

  await flushPromises();
  return wrapper;
};

describe("MCPSettings.vue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete window.electronAPI;
  });

  it("renders canonical MCP tool metadata in the tools modal", async () => {
    const invoke = createInvokeMock({
      "mcp:list-tools": () => ({
        success: true,
        tools: [
          {
            name: "fs_search",
            title: "Filesystem Search",
            description: "Search files in the workspace",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string", description: "Start path" },
              },
              required: ["path"],
            },
            category: "filesystem",
            riskLevel: "high",
            isReadOnly: false,
          },
        ],
      }),
    });

    const wrapper = await mountComponent(invoke);

    await wrapper.vm.showServerTools({ id: "filesystem", name: "Filesystem" });
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith("mcp:list-tools", {
      serverName: "filesystem",
    });
    expect(wrapper.vm.serverTools).toHaveLength(1);
    expect(wrapper.vm.serverTools[0].inputSchema).toEqual(
      wrapper.vm.serverTools[0].parameters,
    );
    expect(wrapper.html()).toContain("Filesystem Search");
    expect(wrapper.html()).toContain("Filesystem");
    expect(wrapper.html()).toContain("High");
  });

  it("builds tool test parameters from inputSchema-only descriptors", async () => {
    const invoke = createInvokeMock({
      "mcp:list-tools": () => ({
        success: true,
        tools: [
          {
            name: "read_note",
            description: "Read a note",
            inputSchema: {
              type: "object",
              properties: {
                noteId: {
                  type: "string",
                  description: "Note identifier",
                },
              },
              required: ["noteId"],
            },
            isReadOnly: true,
          },
        ],
      }),
    });

    const wrapper = await mountComponent(invoke);

    await wrapper.vm.showServerTools({ id: "filesystem", name: "Filesystem" });
    wrapper.vm.testTool(wrapper.vm.serverTools[0]);
    await flushPromises();

    expect(wrapper.vm.selectedTool.category).toBe("read");
    expect(wrapper.vm.selectedTool.riskLevel).toBe("low");
    expect(wrapper.vm.toolParameters).toEqual([
      {
        name: "noteId",
        type: "string",
        description: "Note identifier",
        required: true,
        enum: null,
        default: undefined,
        multiline: false,
      },
    ]);
    expect(wrapper.html()).toContain("Read");
    expect(wrapper.html()).toContain("Low");
    expect(wrapper.html()).toContain("Read a note");
  });
});
