<template>
  <div class="asset-create">
    <a-modal
      :visible="visible"
      :title="editing ? '编辑资产' : '创建资产'"
      width="700px"
      :confirm-loading="creating"
      @ok="handleCreate"
      @cancel="handleCancel"
    >
      <a-form layout="vertical">
        <!-- 资产类型 -->
        <a-form-item label="资产类型" required>
          <a-radio-group v-model:value="form.type" button-style="solid">
            <a-radio-button value="token">
              <trophy-outlined /> Token（通证）
            </a-radio-button>
            <a-radio-button value="nft">
              <picture-outlined /> NFT
            </a-radio-button>
            <a-radio-button value="knowledge">
              <book-outlined /> 知识产品
            </a-radio-button>
            <a-radio-button value="service">
              <tool-outlined /> 服务凭证
            </a-radio-button>
          </a-radio-group>

          <!-- 类型说明 -->
          <a-alert
            :message="assetTypeHints.title"
            :description="`${assetTypeHints.description} ${assetTypeHints.examples}`"
            type="info"
            show-icon
            style="margin-top: 12px"
          />
        </a-form-item>

        <!-- 资产名称 -->
        <a-form-item label="资产名称" required>
          <a-input
            v-model:value="form.name"
            placeholder="例如：ChainCoin、音乐 NFT、编程课程等"
            :maxlength="50"
            show-count
          />
        </a-form-item>

        <!-- 资产符号（仅 Token 需要） -->
        <a-form-item v-if="form.type === 'token'" label="资产符号" required>
          <a-input
            v-model:value="form.symbol"
            placeholder="例如：CC、BTC、ETH"
            :maxlength="10"
            style="text-transform: uppercase"
          />
          <template #extra>
            通证的简称，建议 2-5 个大写字母
          </template>
        </a-form-item>

        <!-- 描述 -->
        <a-form-item label="资产描述">
          <a-textarea
            v-model:value="form.description"
            placeholder="描述这个资产的用途、特点等..."
            :rows="4"
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <!-- 总供应量（Token 需要） -->
        <a-form-item v-if="form.type === 'token'" label="初始供应量" required>
          <a-input-number
            v-model:value="form.totalSupply"
            :min="0"
            :max="1000000000000"
            style="width: 100%"
            placeholder="资产的总发行量"
          />
          <template #extra>
            初始铸造数量，后续可以追加铸造
          </template>
        </a-form-item>

        <!-- 小数位数（Token 需要） -->
        <a-form-item v-if="form.type === 'token'" label="小数位数">
          <a-input-number
            v-model:value="form.decimals"
            :min="0"
            :max="18"
            style="width: 100%"
            placeholder="0-18"
          />
          <template #extra>
            例如：0 表示不可分割，2 表示可以精确到 0.01
          </template>
        </a-form-item>

        <!-- 元数据 -->
        <a-collapse ghost>
          <a-collapse-panel key="metadata" header="高级设置（可选）">
            <a-form-item label="资产图片 URL">
              <a-input v-model:value="form.metadata.imageUrl" placeholder="https://..." />
            </a-form-item>

            <a-form-item label="外部链接">
              <a-input v-model:value="form.metadata.externalUrl" placeholder="https://..." />
            </a-form-item>

            <a-form-item v-if="form.type === 'nft'" label="NFT 属性">
              <a-button @click="addAttribute" size="small" style="margin-bottom: 8px">
                <plus-outlined /> 添加属性
              </a-button>
              <div v-for="(attr, index) in form.metadata.attributes" :key="index" class="attribute-row">
                <a-input
                  v-model:value="attr.trait_type"
                  placeholder="属性名"
                  style="width: 40%"
                />
                <a-input
                  v-model:value="attr.value"
                  placeholder="属性值"
                  style="width: 40%; margin-left: 8px"
                />
                <a-button
                  type="text"
                  danger
                  @click="removeAttribute(index)"
                  style="margin-left: 8px"
                >
                  <delete-outlined />
                </a-button>
              </div>
            </a-form-item>

            <a-form-item label="自定义数据（JSON）">
              <a-textarea
                v-model:value="customDataStr"
                placeholder='{"key": "value"}'
                :rows="3"
              />
            </a-form-item>
          </a-collapse-panel>
        </a-collapse>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  TrophyOutlined,
  PictureOutlined,
  BookOutlined,
  ToolOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  editing: {
    type: Boolean,
    default: false,
  },
  initialData: {
    type: Object,
    default: () => ({}),
  },
});

// Emits
const emit = defineEmits(['created', 'cancel', 'update:visible']);

// Store
const tradeStore = useTradeStore();

// 状态
const creating = computed(() => tradeStore.asset.creating);
const form = reactive({
  type: 'token',
  name: '',
  symbol: '',
  description: '',
  totalSupply: 1000000,
  decimals: 2,
  metadata: {
    imageUrl: '',
    externalUrl: '',
    attributes: [],
  },
});

const customDataStr = ref('');

// 资产类型提示
const assetTypeHints = computed(() => {
  const hints = {
    token: {
      title: 'Token（通证）',
      description: '可分割、可交易的数字资产，适合作为积分、货币等',
      examples: '例如：社区积分、游戏代币、会员权益等',
    },
    nft: {
      title: 'NFT（非同质化代币）',
      description: '独一无二的数字资产，适合艺术品、收藏品等',
      examples: '例如：数字艺术、音乐作品、虚拟土地等',
    },
    knowledge: {
      title: '知识产品',
      description: '知识付费类资产，适合课程、文章、教程等',
      examples: '例如：在线课程、电子书、专业咨询等',
    },
    service: {
      title: '服务凭证',
      description: '服务权益凭证，适合预约、会员等',
      examples: '例如：预约券、服务套餐、会员卡等',
    },
  };
  return hints[form.type] || hints.token;
});

// 添加 NFT 属性
const addAttribute = () => {
  form.metadata.attributes.push({
    trait_type: '',
    value: '',
  });
};

// 移除 NFT 属性
const removeAttribute = (index) => {
  form.metadata.attributes.splice(index, 1);
};

// 表单验证
const validateForm = () => {
  if (!form.name || form.name.trim().length === 0) {
    antMessage.warning('请输入资产名称');
    return false;
  }

  if (form.type === 'token') {
    if (!form.symbol || form.symbol.trim().length === 0) {
      antMessage.warning('Token 资产必须指定符号');
      return false;
    }

    if (form.symbol.length < 2 || form.symbol.length > 10) {
      antMessage.warning('资产符号长度应在 2-10 个字符之间');
      return false;
    }

    if (form.totalSupply <= 0) {
      antMessage.warning('初始供应量必须大于 0');
      return false;
    }

    if (form.decimals < 0 || form.decimals > 18) {
      antMessage.warning('小数位数应在 0-18 之间');
      return false;
    }
  }

  // 验证自定义数据 JSON 格式
  if (customDataStr.value) {
    try {
      JSON.parse(customDataStr.value);
    } catch (error) {
      antMessage.warning('自定义数据格式错误，请输入有效的 JSON');
      return false;
    }
  }

  return true;
};

// 创建资产
const handleCreate = async () => {
  try {
    // 验证表单
    if (!validateForm()) {
      return;
    }

    // 合并元数据
    const metadata = { ...form.metadata };

    // 添加自定义数据
    if (customDataStr.value) {
      const customData = JSON.parse(customDataStr.value);
      metadata.custom = customData;
    }

    // 清理空属性
    if (form.type === 'nft') {
      metadata.attributes = metadata.attributes.filter(
        attr => attr.trait_type && attr.value
      );
    }

    const options = {
      type: form.type,
      name: form.name.trim(),
      symbol: form.type === 'token' ? form.symbol.trim().toUpperCase() : null,
      description: form.description.trim(),
      metadata,
      totalSupply: form.type === 'token' ? form.totalSupply : 1,
      decimals: form.type === 'token' ? form.decimals : 0,
    };

    // 使用 store action 创建资产
    const asset = await tradeStore.createAsset(options);

    antMessage.success(`资产 ${asset.name} 创建成功！`);

    // 通知父组件
    emit('created', asset);

    // 关闭对话框
    emit('update:visible', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('[AssetCreate] 创建资产失败:', error);
    antMessage.error(error.message || '创建资产失败');
  }
};

// 取消
const handleCancel = () => {
  emit('cancel');
  emit('update:visible', false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.type = 'token';
  form.name = '';
  form.symbol = '';
  form.description = '';
  form.totalSupply = 1000000;
  form.decimals = 2;
  form.metadata = {
    imageUrl: '',
    externalUrl: '',
    attributes: [],
  };
  customDataStr.value = '';
};

// 监听类型变化，调整默认值
watch(() => form.type, (newType) => {
  if (newType === 'nft') {
    form.totalSupply = 1;
    form.decimals = 0;
  } else if (newType === 'token') {
    if (form.totalSupply === 1) {
      form.totalSupply = 1000000;
    }
    if (form.decimals === 0) {
      form.decimals = 2;
    }
  }
});
</script>

<style scoped>
.asset-create {
  /* 样式 */
}

.attribute-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
</style>
