<template>
  <a-modal
    v-model:open="visible"
    title="Create Organization"
    :width="600"
    :confirm-loading="loading"
    @ok="handleCreate"
    @cancel="handleCancel"
  >
    <a-form
      ref="formRef"
      :model="formState"
      :rules="rules"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
    >
      <a-form-item
        label="Organization Name"
        name="name"
      >
        <a-input
          v-model:value="formState.name"
          placeholder="Enter organization name"
          :maxlength="50"
          show-count
        />
      </a-form-item>

      <a-form-item
        label="Organization Type"
        name="type"
      >
        <a-select
          v-model:value="formState.type"
          placeholder="Select organization type"
        >
          <a-select-option value="startup">
            <ShopOutlined /> Startup
          </a-select-option>
          <a-select-option value="company">
            <BankOutlined /> Company
          </a-select-option>
          <a-select-option value="community">
            <GlobalOutlined /> Community
          </a-select-option>
          <a-select-option value="opensource">
            <BookOutlined /> Open Source
          </a-select-option>
          <a-select-option value="education">
            <BookOutlined /> Education
          </a-select-option>
        </a-select>
      </a-form-item>

      <a-form-item
        label="Description"
        name="description"
      >
        <a-textarea
          v-model:value="formState.description"
          placeholder="Enter organization description"
          :rows="4"
          :maxlength="500"
          show-count
        />
      </a-form-item>

      <a-form-item
        label="Privacy"
        name="isPublic"
      >
        <a-radio-group v-model:value="formState.isPublic">
          <a-radio :value="true">
            <GlobalOutlined /> Public
            <div class="radio-description">
              Anyone can discover and request to join
            </div>
          </a-radio>
          <a-radio :value="false">
            <LockOutlined /> Private
            <div class="radio-description">
              Only invited members can join
            </div>
          </a-radio>
        </a-radio-group>
      </a-form-item>

      <a-form-item
        label="Features"
        name="features"
      >
        <a-checkbox-group v-model:value="formState.features">
          <a-checkbox value="knowledge">
            <FileTextOutlined /> Knowledge Base
          </a-checkbox>
          <a-checkbox value="projects">
            <ProjectOutlined /> Projects
          </a-checkbox>
          <a-checkbox value="collaboration">
            <TeamOutlined /> Real-time Collaboration
          </a-checkbox>
          <a-checkbox value="p2p">
            <ApiOutlined /> P2P Network
          </a-checkbox>
        </a-checkbox-group>
      </a-form-item>

      <a-form-item
        label="Storage Limit"
        name="storageLimit"
      >
        <a-select
          v-model:value="formState.storageLimit"
          placeholder="Select storage limit"
        >
          <a-select-option :value="1 * 1024 * 1024 * 1024">
            1 GB
          </a-select-option>
          <a-select-option :value="5 * 1024 * 1024 * 1024">
            5 GB
          </a-select-option>
          <a-select-option :value="10 * 1024 * 1024 * 1024">
            10 GB
          </a-select-option>
          <a-select-option :value="50 * 1024 * 1024 * 1024">
            50 GB
          </a-select-option>
          <a-select-option :value="100 * 1024 * 1024 * 1024">
            100 GB
          </a-select-option>
        </a-select>
      </a-form-item>

      <a-form-item
        label="Member Limit"
        name="memberLimit"
      >
        <a-input-number
          v-model:value="formState.memberLimit"
          :min="1"
          :max="1000"
          style="width: 100%"
        />
      </a-form-item>

      <a-divider />

      <a-alert
        message="Organization DID"
        description="A unique decentralized identifier (DID) will be automatically generated for this organization."
        type="info"
        show-icon
      />
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  ShopOutlined,
  BankOutlined,
  GlobalOutlined,
  BookOutlined,
  LockOutlined,
  FileTextOutlined,
  ProjectOutlined,
  TeamOutlined,
  ApiOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:open', 'created']);

// State
const visible = ref(props.open);
const loading = ref(false);
const formRef = ref(null);

const formState = reactive({
  name: '',
  type: 'startup',
  description: '',
  isPublic: false,
  features: ['knowledge', 'projects', 'collaboration', 'p2p'],
  storageLimit: 10 * 1024 * 1024 * 1024, // 10GB
  memberLimit: 50
});

// Validation rules
const rules = {
  name: [
    { required: true, message: 'Please enter organization name', trigger: 'blur' },
    { min: 2, max: 50, message: 'Name must be between 2 and 50 characters', trigger: 'blur' }
  ],
  type: [
    { required: true, message: 'Please select organization type', trigger: 'change' }
  ],
  description: [
    { max: 500, message: 'Description cannot exceed 500 characters', trigger: 'blur' }
  ],
  storageLimit: [
    { required: true, message: 'Please select storage limit', trigger: 'change' }
  ],
  memberLimit: [
    { required: true, message: 'Please enter member limit', trigger: 'blur' },
    { type: 'number', min: 1, max: 1000, message: 'Member limit must be between 1 and 1000', trigger: 'blur' }
  ]
};

// Watch props
watch(() => props.open, (newVal) => {
  visible.value = newVal;
});

watch(visible, (newVal) => {
  emit('update:open', newVal);
  if (!newVal) {
    resetForm();
  }
});

// Methods
async function handleCreate() {
  try {
    await formRef.value.validate();
    loading.value = true;

    const result = await window.electron.ipcRenderer.invoke('organization:create', {
      name: formState.name,
      type: formState.type,
      description: formState.description,
      isPublic: formState.isPublic,
      features: formState.features,
      storageLimit: formState.storageLimit,
      memberLimit: formState.memberLimit
    });

    if (result.success) {
      message.success('Organization created successfully');
      emit('created', result.organization);
      visible.value = false;
    } else {
      message.error(result.error || 'Failed to create organization');
    }
  } catch (error) {
    console.error('Error creating organization:', error);
    if (error.errorFields) {
      // Validation error
      return;
    }
    message.error('Failed to create organization');
  } finally {
    loading.value = false;
  }
}

function handleCancel() {
  visible.value = false;
}

function resetForm() {
  formRef.value?.resetFields();
  Object.assign(formState, {
    name: '',
    type: 'startup',
    description: '',
    isPublic: false,
    features: ['knowledge', 'projects', 'collaboration', 'p2p'],
    storageLimit: 10 * 1024 * 1024 * 1024,
    memberLimit: 50
  });
}
</script>

<style scoped lang="scss">
.radio-description {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}

:deep(.ant-checkbox-group) {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .ant-checkbox-wrapper {
    margin-left: 0;
  }
}
</style>
