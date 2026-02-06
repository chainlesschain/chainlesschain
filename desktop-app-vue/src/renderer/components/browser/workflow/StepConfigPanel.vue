<template>
  <div class="step-config-panel">
    <div class="panel-content">
      <!-- Common Settings -->
      <a-form layout="vertical" size="small">
        <!-- Action-specific config -->
        <template v-if="step.type === 'action'">
          <!-- Navigate -->
          <template v-if="step.action === 'navigate'">
            <a-form-item label="URL">
              <a-input
                v-model:value="localConfig.url"
                placeholder="https://example.com"
                @change="emitUpdate"
              >
                <template #prefix><GlobalOutlined /></template>
              </a-input>
            </a-form-item>
            <a-form-item label="Wait Until">
              <a-select v-model:value="localConfig.waitUntil" @change="emitUpdate">
                <a-select-option value="load">Page Load</a-select-option>
                <a-select-option value="domcontentloaded">DOM Content Loaded</a-select-option>
                <a-select-option value="networkidle">Network Idle</a-select-option>
              </a-select>
            </a-form-item>
          </template>

          <!-- Click -->
          <template v-else-if="step.action === 'click'">
            <a-form-item label="Element Selector">
              <a-input
                v-model:value="localConfig.selector"
                placeholder="#button, .btn-submit"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Click Count">
              <a-input-number
                v-model:value="localConfig.clickCount"
                :min="1"
                :max="3"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Button">
              <a-select v-model:value="localConfig.button" @change="emitUpdate">
                <a-select-option value="left">Left</a-select-option>
                <a-select-option value="right">Right</a-select-option>
                <a-select-option value="middle">Middle</a-select-option>
              </a-select>
            </a-form-item>
          </template>

          <!-- Type -->
          <template v-else-if="step.action === 'type'">
            <a-form-item label="Element Selector">
              <a-input
                v-model:value="localConfig.selector"
                placeholder="#input, input[name='email']"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Text to Type">
              <a-textarea
                v-model:value="localConfig.text"
                placeholder="Enter text or use {{variable}}"
                :rows="3"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="localConfig.clearFirst" @change="emitUpdate">
                Clear field first
              </a-checkbox>
            </a-form-item>
            <a-form-item label="Typing Delay (ms)">
              <a-input-number
                v-model:value="localConfig.delay"
                :min="0"
                :max="500"
                @change="emitUpdate"
              />
            </a-form-item>
          </template>

          <!-- Select -->
          <template v-else-if="step.action === 'select'">
            <a-form-item label="Element Selector">
              <a-input
                v-model:value="localConfig.selector"
                placeholder="select#country"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Value">
              <a-input
                v-model:value="localConfig.value"
                placeholder="Option value"
                @change="emitUpdate"
              />
            </a-form-item>
          </template>

          <!-- Scroll -->
          <template v-else-if="step.action === 'scroll'">
            <a-form-item label="Direction">
              <a-select v-model:value="localConfig.direction" @change="emitUpdate">
                <a-select-option value="up">Up</a-select-option>
                <a-select-option value="down">Down</a-select-option>
                <a-select-option value="left">Left</a-select-option>
                <a-select-option value="right">Right</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="Distance (px)">
              <a-input-number
                v-model:value="localConfig.distance"
                :min="0"
                :max="10000"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Element (optional)">
              <a-input
                v-model:value="localConfig.element"
                placeholder="Scroll within element"
                @change="emitUpdate"
              />
            </a-form-item>
          </template>

          <!-- Keyboard -->
          <template v-else-if="step.action === 'keyboard'">
            <a-form-item label="Keys">
              <a-select
                v-model:value="localConfig.keys"
                mode="tags"
                placeholder="Enter keys"
                @change="emitUpdate"
              >
                <a-select-option v-for="key in commonKeys" :key="key" :value="key">
                  {{ key }}
                </a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="Modifiers">
              <a-checkbox-group v-model:value="localConfig.modifiers" @change="emitUpdate">
                <a-checkbox value="Control">Ctrl</a-checkbox>
                <a-checkbox value="Shift">Shift</a-checkbox>
                <a-checkbox value="Alt">Alt</a-checkbox>
                <a-checkbox value="Meta">Meta</a-checkbox>
              </a-checkbox-group>
            </a-form-item>
            <a-form-item label="Preset Shortcuts">
              <a-select placeholder="Select preset" @change="applyKeyboardPreset">
                <a-select-option value="copy">Copy (Ctrl+C)</a-select-option>
                <a-select-option value="paste">Paste (Ctrl+V)</a-select-option>
                <a-select-option value="selectAll">Select All (Ctrl+A)</a-select-option>
                <a-select-option value="undo">Undo (Ctrl+Z)</a-select-option>
                <a-select-option value="redo">Redo (Ctrl+Shift+Z)</a-select-option>
                <a-select-option value="save">Save (Ctrl+S)</a-select-option>
              </a-select>
            </a-form-item>
          </template>

          <!-- Extract -->
          <template v-else-if="step.action === 'extract'">
            <a-form-item label="Element Selector">
              <a-input
                v-model:value="localConfig.selector"
                placeholder=".product-price"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Extract Type">
              <a-select v-model:value="localConfig.extractType" @change="emitUpdate">
                <a-select-option value="text">Text Content</a-select-option>
                <a-select-option value="html">Inner HTML</a-select-option>
                <a-select-option value="attribute">Attribute</a-select-option>
                <a-select-option value="value">Input Value</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item v-if="localConfig.extractType === 'attribute'" label="Attribute Name">
              <a-input
                v-model:value="localConfig.attribute"
                placeholder="href, src, data-id"
                @change="emitUpdate"
              />
            </a-form-item>
            <a-form-item label="Save to Variable">
              <a-input
                v-model:value="localConfig.variable"
                placeholder="extractedValue"
                @change="emitUpdate"
              >
                <template #prefix>$</template>
              </a-input>
            </a-form-item>
          </template>

          <!-- Screenshot -->
          <template v-else-if="step.action === 'screenshot'">
            <a-form-item>
              <a-checkbox v-model:checked="localConfig.fullPage" @change="emitUpdate">
                Full page screenshot
              </a-checkbox>
            </a-form-item>
            <a-form-item label="Element (optional)">
              <a-input
                v-model:value="localConfig.element"
                placeholder="Capture specific element"
                @change="emitUpdate"
              />
            </a-form-item>
          </template>

          <!-- Evaluate -->
          <template v-else-if="step.action === 'evaluate'">
            <a-form-item label="JavaScript Code">
              <a-textarea
                v-model:value="localConfig.script"
                placeholder="return document.title;"
                :rows="6"
                @change="emitUpdate"
                class="code-input"
              />
            </a-form-item>
            <a-form-item label="Save Result to Variable">
              <a-input
                v-model:value="localConfig.variable"
                placeholder="result"
                @change="emitUpdate"
              >
                <template #prefix>$</template>
              </a-input>
            </a-form-item>
          </template>
        </template>

        <!-- Wait -->
        <template v-else-if="step.type === 'wait'">
          <a-form-item label="Wait Type">
            <a-select v-model:value="localConfig.waitType" @change="emitUpdate">
              <a-select-option value="time">Fixed Time</a-select-option>
              <a-select-option value="selector">Element Appears</a-select-option>
              <a-select-option value="hidden">Element Hidden</a-select-option>
              <a-select-option value="navigation">Navigation</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item v-if="localConfig.waitType === 'time'" label="Duration (ms)">
            <a-input-number
              v-model:value="localConfig.duration"
              :min="0"
              :max="60000"
              :step="100"
              @change="emitUpdate"
            />
          </a-form-item>
          <a-form-item v-if="['selector', 'hidden'].includes(localConfig.waitType)" label="Element Selector">
            <a-input
              v-model:value="localConfig.selector"
              placeholder=".loading, #modal"
              @change="emitUpdate"
            />
          </a-form-item>
        </template>

        <!-- Variable -->
        <template v-else-if="step.type === 'variable'">
          <a-form-item label="Variable Name">
            <a-input
              v-model:value="localConfig.name"
              placeholder="myVariable"
              @change="emitUpdate"
            >
              <template #prefix>$</template>
            </a-input>
          </a-form-item>
          <a-form-item label="Value">
            <a-textarea
              v-model:value="localConfig.value"
              placeholder="Value or expression"
              :rows="2"
              @change="emitUpdate"
            />
          </a-form-item>
        </template>

        <!-- Condition -->
        <template v-else-if="step.type === 'condition'">
          <a-form-item label="Condition">
            <div class="condition-builder">
              <a-input
                v-model:value="localConfig.condition.left"
                placeholder="{{variable}}"
                @change="emitUpdate"
              />
              <a-select v-model:value="localConfig.condition.operator" @change="emitUpdate">
                <a-select-option value="==">equals</a-select-option>
                <a-select-option value="!=">not equals</a-select-option>
                <a-select-option value=">">greater than</a-select-option>
                <a-select-option value="<">less than</a-select-option>
                <a-select-option value="contains">contains</a-select-option>
                <a-select-option value="matches">matches</a-select-option>
              </a-select>
              <a-input
                v-model:value="localConfig.condition.right"
                placeholder="value"
                @change="emitUpdate"
              />
            </div>
          </a-form-item>
          <a-alert type="info" show-icon>
            <template #message>
              Configure nested steps in the canvas by expanding this condition block.
            </template>
          </a-alert>
        </template>

        <!-- Loop -->
        <template v-else-if="step.type === 'loop'">
          <a-form-item label="Loop Type">
            <a-select v-model:value="localConfig.loopType" @change="emitUpdate">
              <a-select-option value="for">Fixed Count</a-select-option>
              <a-select-option value="while">While Condition</a-select-option>
              <a-select-option value="forEach">For Each Item</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item v-if="localConfig.loopType === 'for'" label="Repeat Count">
            <a-input-number
              v-model:value="localConfig.count"
              :min="1"
              :max="1000"
              @change="emitUpdate"
            />
          </a-form-item>
          <a-form-item v-if="localConfig.loopType === 'forEach'" label="Items Variable">
            <a-input
              v-model:value="localConfig.itemsVariable"
              placeholder="items"
              @change="emitUpdate"
            />
          </a-form-item>
          <a-form-item v-if="localConfig.loopType === 'forEach'" label="Item Variable">
            <a-input
              v-model:value="localConfig.itemVariable"
              placeholder="item"
              @change="emitUpdate"
            />
          </a-form-item>
        </template>

        <!-- Common: Timeout -->
        <a-divider>Advanced</a-divider>
        <a-form-item label="Timeout (ms)">
          <a-input-number
            v-model:value="localConfig.timeout"
            :min="1000"
            :max="120000"
            :step="1000"
            @change="emitUpdate"
          />
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="localConfig.optional" @change="emitUpdate">
            Optional (continue on failure)
          </a-checkbox>
        </a-form-item>
        <a-form-item label="Description">
          <a-input
            v-model:value="localConfig.description"
            placeholder="Step description"
            @change="emitUpdate"
          />
        </a-form-item>
      </a-form>

      <!-- Variable Hints -->
      <div class="variable-hints" v-if="Object.keys(variables).length > 0">
        <a-divider>Available Variables</a-divider>
        <div class="variable-list">
          <a-tag
            v-for="(value, name) in variables"
            :key="name"
            @click="insertVariable(name)"
            class="variable-tag"
          >
            {{ '{{' + name + '}}' }}
          </a-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { GlobalOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  step: {
    type: Object,
    required: true
  },
  variables: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update-step']);

const localConfig = ref({ ...props.step.config });

const commonKeys = [
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
];

watch(() => props.step, (newStep) => {
  localConfig.value = { ...newStep.config };
}, { deep: true });

const emitUpdate = () => {
  emit('update-step', {
    ...props.step,
    config: { ...localConfig.value }
  });
};

const applyKeyboardPreset = (preset) => {
  const presets = {
    copy: { keys: ['c'], modifiers: ['Control'] },
    paste: { keys: ['v'], modifiers: ['Control'] },
    selectAll: { keys: ['a'], modifiers: ['Control'] },
    undo: { keys: ['z'], modifiers: ['Control'] },
    redo: { keys: ['z'], modifiers: ['Control', 'Shift'] },
    save: { keys: ['s'], modifiers: ['Control'] },
  };

  if (presets[preset]) {
    localConfig.value.keys = presets[preset].keys;
    localConfig.value.modifiers = presets[preset].modifiers;
    emitUpdate();
  }
};

const insertVariable = (name) => {
  // This would insert the variable into the currently focused input
  const varText = `{{${name}}}`;
  navigator.clipboard.writeText(varText);
};
</script>

<style scoped>
.step-config-panel {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 12px;
}

.condition-builder {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.code-input {
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
}

.variable-hints {
  margin-top: 16px;
}

.variable-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.variable-tag {
  cursor: pointer;
  font-family: monospace;
}

.variable-tag:hover {
  color: #1890ff;
  border-color: #1890ff;
}
</style>
