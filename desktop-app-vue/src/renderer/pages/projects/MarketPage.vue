<template>
  <div class="market-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <ShopOutlined />
            项目市场
          </h1>
          <p>基于区块链的去中心化项目交易市场，智能合约保障交易安全</p>
        </div>
        <div class="header-right">
          <a-button
            type="primary"
            @click="handleSellProject"
          >
            <DollarOutlined />
            出售项目
          </a-button>
          <a-button @click="handleBackToProjects">
            <ArrowLeftOutlined />
            返回我的项目
          </a-button>
        </div>
      </div>
    </div>

    <!-- 分类标签 -->
    <div class="categories-bar">
      <a-tag
        v-for="category in categories"
        :key="category.value"
        :color="selectedCategory === category.value ? 'blue' : 'default'"
        :style="{ cursor: 'pointer' }"
        @click="handleCategoryChange(category.value)"
      >
        <component :is="category.icon" />
        {{ category.label }}
      </a-tag>
    </div>

    <!-- 筛选和排序栏 -->
    <div class="filter-bar">
      <div class="filter-left">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索项目..."
          style="width: 300px"
          @search="handleSearch"
          @change="debouncedSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>

        <a-select
          v-model:value="priceRange"
          placeholder="价格范围"
          style="width: 150px"
          @change="handlePriceRangeChange"
        >
          <a-select-option value="">
            全部价格
          </a-select-option>
          <a-select-option value="0-100">
            0-100 Token
          </a-select-option>
          <a-select-option value="100-500">
            100-500 Token
          </a-select-option>
          <a-select-option value="500-1000">
            500-1000 Token
          </a-select-option>
          <a-select-option value="1000+">
            1000+ Token
          </a-select-option>
        </a-select>

        <a-select
          v-model:value="sortConfig"
          placeholder="排序"
          style="width: 150px"
          @change="handleSortChange"
        >
          <a-select-option value="latest">
            最新上架
          </a-select-option>
          <a-select-option value="popular">
            最受欢迎
          </a-select-option>
          <a-select-option value="price-asc">
            价格从低到高
          </a-select-option>
          <a-select-option value="price-desc">
            价格从高到低
          </a-select-option>
          <a-select-option value="rating">
            评分最高
          </a-select-option>
        </a-select>
      </div>

      <div class="filter-right">
        <a-button
          :loading="loading"
          @click="handleRefresh"
        >
          <ReloadOutlined :spin="loading" />
          刷新
        </a-button>

        <a-radio-group
          v-model:value="viewMode"
          button-style="solid"
          @change="handleViewModeChange"
        >
          <a-radio-button value="grid">
            <AppstoreOutlined />
          </a-radio-button>
          <a-radio-button value="list">
            <UnorderedListOutlined />
          </a-radio-button>
        </a-radio-group>
      </div>
    </div>

    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="loading-container"
    >
      <a-spin
        size="large"
        tip="加载中..."
      />
    </div>

    <!-- 市场项目列表 -->
    <div
      v-else-if="filteredProjects.length > 0"
      class="projects-container"
    >
      <!-- 网格视图 -->
      <div
        v-if="viewMode === 'grid'"
        class="projects-grid"
      >
        <div
          v-for="project in paginatedProjects"
          :key="project.id"
          class="market-project-card"
        >
          <!-- 项目缩略图 -->
          <div class="card-image">
            <div
              v-if="project.thumbnail"
              class="image-wrapper"
            >
              <img
                :src="project.thumbnail"
                :alt="project.name"
                @error="handleImageError"
              >
            </div>
            <div
              v-else
              class="image-placeholder"
            >
              <component
                :is="getCategoryIcon(project.category)"
                :style="{ fontSize: '64px' }"
              />
              <span>{{ getCategoryName(project.category) }}</span>
            </div>
            <div class="card-overlay">
              <a-button
                type="primary"
                @click="handleViewDetail(project.id)"
              >
                <EyeOutlined />
                查看详情
              </a-button>
            </div>
            <a-tag
              v-if="project.featured"
              color="gold"
              class="featured-tag"
            >
              <StarFilled />
              精选
            </a-tag>
          </div>

          <!-- 项目信息 -->
          <div class="card-body">
            <div class="card-header-info">
              <h3>{{ project.name }}</h3>
              <a-tag :color="getCategoryColor(project.category)">
                {{ getCategoryName(project.category) }}
              </a-tag>
            </div>

            <p class="description">
              {{ project.description || '暂无描述' }}
            </p>

            <!-- 卖家信息 -->
            <div class="seller-info">
              <a-avatar
                :size="24"
                :style="{ backgroundColor: getAvatarColor(project.seller.did) }"
              >
                {{ project.seller.name?.charAt(0) || 'U' }}
              </a-avatar>
              <span class="seller-name">{{ project.seller.name }}</span>
              <a-rate
                :value="project.seller.rating"
                disabled
                :count="5"
                :style="{ fontSize: '12px' }"
              />
            </div>

            <!-- 统计信息 -->
            <div class="stats-row">
              <div class="stat-item">
                <EyeOutlined />
                {{ project.views }}
              </div>
              <div class="stat-item">
                <ShoppingCartOutlined />
                {{ project.sales }}
              </div>
              <div class="stat-item">
                <StarOutlined />
                {{ project.rating }}
              </div>
            </div>

            <!-- 价格和购买 -->
            <div class="card-footer-info">
              <div class="price">
                <span class="price-label">价格:</span>
                <span class="price-value">{{ project.price }} Token</span>
              </div>
              <a-button
                type="primary"
                @click="handleBuyProject(project)"
              >
                <ShoppingCartOutlined />
                购买
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div
        v-else
        class="projects-list"
      >
        <div
          v-for="project in paginatedProjects"
          :key="project.id"
          class="market-project-item"
        >
          <div class="item-image">
            <div
              v-if="project.thumbnail"
              class="image-wrapper"
            >
              <img
                :src="project.thumbnail"
                :alt="project.name"
                @error="handleImageError"
              >
            </div>
            <div
              v-else
              class="image-placeholder"
            >
              <component
                :is="getCategoryIcon(project.category)"
                :style="{ fontSize: '48px' }"
              />
            </div>
            <a-tag
              v-if="project.featured"
              color="gold"
              class="featured-badge"
            >
              <StarFilled />
              精选
            </a-tag>
          </div>

          <div class="item-content">
            <div class="item-header">
              <h4>{{ project.name }}</h4>
              <a-tag :color="getCategoryColor(project.category)">
                {{ getCategoryName(project.category) }}
              </a-tag>
            </div>

            <p>{{ project.description || '暂无描述' }}</p>

            <div class="item-meta">
              <div class="seller-info-inline">
                <a-avatar
                  :size="20"
                  :style="{ backgroundColor: getAvatarColor(project.seller.did) }"
                >
                  {{ project.seller.name?.charAt(0) || 'U' }}
                </a-avatar>
                <span>{{ project.seller.name }}</span>
                <a-rate
                  :value="project.seller.rating"
                  disabled
                  :count="5"
                  :style="{ fontSize: '12px' }"
                />
              </div>

              <div class="stats-inline">
                <span><EyeOutlined /> {{ project.views }}</span>
                <span><ShoppingCartOutlined /> {{ project.sales }} 销量</span>
                <span><StarOutlined /> {{ project.rating }}</span>
              </div>
            </div>
          </div>

          <div class="item-actions">
            <div class="price-large">
              <div class="price-label">
                价格
              </div>
              <div class="price-value">
                {{ project.price }} Token
              </div>
            </div>
            <a-button
              type="primary"
              size="large"
              @click="handleBuyProject(project)"
            >
              <ShoppingCartOutlined />
              购买
            </a-button>
            <a-button @click="handleViewDetail(project.id)">
              <EyeOutlined />
              详情
            </a-button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination-container">
        <a-pagination
          v-model:current="currentPage"
          v-model:page-size="pageSize"
          :total="filteredProjects.length"
          :show-total="total => `共 ${total} 个项目`"
          :show-size-changer="true"
          :page-size-options="['12', '24', '48', '96']"
          @change="handlePageChange"
          @show-size-change="handlePageSizeChange"
        />
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="empty-state"
    >
      <div class="empty-icon">
        <ShopOutlined />
      </div>
      <h3>{{ searchKeyword || selectedCategory ? '没有找到匹配的项目' : '市场暂无项目' }}</h3>
      <p>{{ searchKeyword || selectedCategory ? '尝试调整筛选条件' : '成为第一个出售项目的人' }}</p>
      <a-button
        v-if="!searchKeyword && !selectedCategory"
        type="primary"
        @click="handleSellProject"
      >
        <DollarOutlined />
        出售我的项目
      </a-button>
    </div>

    <!-- 购买确认Modal -->
    <a-modal
      v-model:open="showBuyModal"
      title="购买项目"
      :confirm-loading="purchasing"
      @ok="handleConfirmPurchase"
    >
      <div
        v-if="selectedProject"
        class="purchase-modal"
      >
        <div class="project-preview">
          <div class="preview-image">
            <div
              v-if="selectedProject.thumbnail"
              class="image-wrapper"
            >
              <img
                :src="selectedProject.thumbnail"
                :alt="selectedProject.name"
                @error="handleImageError"
              >
            </div>
            <div
              v-else
              class="image-placeholder-small"
            >
              <component
                :is="getCategoryIcon(selectedProject.category)"
                :style="{ fontSize: '32px' }"
              />
            </div>
          </div>
          <div class="project-info-modal">
            <h3>{{ selectedProject.name }}</h3>
            <p>{{ selectedProject.description }}</p>
          </div>
        </div>

        <a-divider />

        <div class="purchase-details">
          <div class="detail-row">
            <span>卖家:</span>
            <span>{{ selectedProject.seller.name }}</span>
          </div>
          <div class="detail-row">
            <span>价格:</span>
            <span class="price-highlight">{{ selectedProject.price }} Token</span>
          </div>
          <div class="detail-row">
            <span>支付方式:</span>
            <a-tag color="blue">
              智能合约
            </a-tag>
          </div>
          <div class="detail-row">
            <span>你的余额:</span>
            <span :class="walletBalance >= selectedProject.price ? 'balance-ok' : 'balance-low'">
              {{ walletBalance }} Token
            </span>
          </div>
        </div>

        <a-alert
          v-if="walletBalance < selectedProject.price"
          message="余额不足"
          description="你的Token余额不足以购买此项目，请先充值"
          type="error"
          show-icon
          :style="{ marginTop: '16px' }"
        />

        <a-alert
          v-else
          message="安全提示"
          description="交易将通过智能合约执行，确保双方权益。购买后项目文件将自动发送到你的账户。"
          type="info"
          show-icon
          :style="{ marginTop: '16px' }"
        />
      </div>
    </a-modal>

    <!-- 出售项目Modal -->
    <a-modal
      v-model:open="showSellModal"
      title="出售项目"
      width="600px"
      :confirm-loading="selling"
      @ok="handleConfirmSell"
    >
      <a-form layout="vertical">
        <a-form-item
          label="选择项目"
          required
        >
          <a-select
            v-model:value="sellForm.projectId"
            placeholder="选择要出售的项目"
          >
            <a-select-option
              v-for="project in myProjects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          label="项目分类"
          required
        >
          <a-select
            v-model:value="sellForm.category"
            placeholder="选择分类"
          >
            <a-select-option value="web">
              Web开发
            </a-select-option>
            <a-select-option value="document">
              文档模板
            </a-select-option>
            <a-select-option value="data">
              数据分析
            </a-select-option>
            <a-select-option value="app">
              应用开发
            </a-select-option>
            <a-select-option value="other">
              其他
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          label="售价 (Token)"
          required
        >
          <a-input-number
            v-model:value="sellForm.price"
            :min="1"
            :max="10000"
            :style="{ width: '100%' }"
            placeholder="设置价格"
          />
          <div class="price-suggestion">
            建议价格范围: 100-1000 Token
          </div>
        </a-form-item>

        <a-form-item
          label="项目描述"
          required
        >
          <a-textarea
            v-model:value="sellForm.description"
            placeholder="详细描述你的项目，包括功能特点、技术栈等..."
            :rows="4"
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <a-form-item label="项目缩略图">
          <a-upload
            :before-upload="handleBeforeUpload"
            :show-upload-list="false"
          >
            <a-button>
              <UploadOutlined />
              上传图片
            </a-button>
          </a-upload>
          <div
            v-if="sellForm.thumbnail"
            class="thumbnail-preview"
          >
            <img
              :src="sellForm.thumbnail"
              alt="缩略图"
            >
          </div>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import {
  ShopOutlined,
  DollarOutlined,
  ArrowLeftOutlined,
  SearchOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  EyeOutlined,
  ShoppingCartOutlined,
  StarOutlined,
  StarFilled,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreAddOutlined,
  UploadOutlined,
  SafetyOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();

// 响应式状态
const loading = ref(false);
const purchasing = ref(false);
const selling = ref(false);
const searchKeyword = ref('');
const selectedCategory = ref('');
const priceRange = ref('');
const sortConfig = ref('latest');
const viewMode = ref('grid');
const currentPage = ref(1);
const pageSize = ref(12);
const showBuyModal = ref(false);
const showSellModal = ref(false);
const selectedProject = ref(null);
const walletBalance = ref(1500); // 模拟钱包余额

// 分类列表
const categories = [
  { value: '', label: '全部', icon: AppstoreOutlined },
  { value: 'web', label: 'Web开发', icon: CodeOutlined },
  { value: 'document', label: '文档模板', icon: FileTextOutlined },
  { value: 'data', label: '数据分析', icon: BarChartOutlined },
  { value: 'app', label: '应用开发', icon: AppstoreAddOutlined },
];

// 出售表单
const sellForm = ref({
  projectId: null,
  category: '',
  price: 100,
  description: '',
  thumbnail: '',
});

// 模拟市场项目数据
const marketProjects = ref([]);
const myProjects = ref([]);

// 计算属性
const filteredProjects = computed(() => {
  let result = [...marketProjects.value];

  // 分类筛选
  if (selectedCategory.value) {
    result = result.filter(p => p.category === selectedCategory.value);
  }

  // 价格筛选
  if (priceRange.value) {
    const [min, max] = priceRange.value.split('-').map(v => v.replace('+', ''));
    result = result.filter(p => {
      if (max) {
        return p.price >= parseInt(min) && p.price <= parseInt(max);
      } else {
        return p.price >= parseInt(min);
      }
    });
  }

  // 搜索筛选
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(p =>
      p.name.toLowerCase().includes(keyword) ||
      (p.description && p.description.toLowerCase().includes(keyword))
    );
  }

  // 排序
  switch (sortConfig.value) {
    case 'latest':
      result.sort((a, b) => b.listedAt - a.listedAt);
      break;
    case 'popular':
      result.sort((a, b) => b.sales - a.sales);
      break;
    case 'price-asc':
      result.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      result.sort((a, b) => b.price - a.price);
      break;
    case 'rating':
      result.sort((a, b) => b.rating - a.rating);
      break;
  }

  return result;
});

const paginatedProjects = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredProjects.value.slice(start, end);
});

// 分类颜色
const getCategoryColor = (category) => {
  const colorMap = {
    web: 'blue',
    document: 'green',
    data: 'orange',
    app: 'purple',
    other: 'default',
  };
  return colorMap[category] || 'default';
};

// 分类名称
const getCategoryName = (category) => {
  const nameMap = {
    web: 'Web开发',
    document: '文档模板',
    data: '数据分析',
    app: '应用开发',
    other: '其他',
  };
  return nameMap[category] || category;
};

// 分类图标
const getCategoryIcon = (category) => {
  const iconMap = {
    web: CodeOutlined,
    document: FileTextOutlined,
    data: BarChartOutlined,
    app: AppstoreAddOutlined,
    other: AppstoreOutlined,
  };
  return iconMap[category] || AppstoreOutlined;
};

// 处理图片加载错误
const handleImageError = (e) => {
  logger.warn('Image load failed:', e.target.src);
  e.target.style.display = 'none';
};

// 头像颜色
const getAvatarColor = (did) => {
  const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068'];
  const hash = did?.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
  return colors[hash % colors.length];
};

// 防抖搜索
let searchTimeout;
const debouncedSearch = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    handleSearch();
  }, 300);
};

// 处理搜索
const handleSearch = () => {
  currentPage.value = 1;
};

// 处理分类变化
const handleCategoryChange = (category) => {
  selectedCategory.value = category;
  currentPage.value = 1;
};

// 处理价格范围变化
const handlePriceRangeChange = () => {
  currentPage.value = 1;
};

// 处理排序变化
const handleSortChange = () => {
  currentPage.value = 1;
};

// 处理视图模式切换
const handleViewModeChange = () => {
  localStorage.setItem('market_view_mode', viewMode.value);
};

// 刷新
const handleRefresh = async () => {
  loading.value = true;
  try {
    await loadMarketProjects();
    message.success('刷新成功');
  } catch (error) {
    logger.error('Refresh failed:', error);
    message.error('刷新失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 处理分页
const handlePageChange = (page) => {
  currentPage.value = page;
};

const handlePageSizeChange = (current, size) => {
  pageSize.value = size;
  currentPage.value = 1;
};

// 返回我的项目
const handleBackToProjects = () => {
  router.push('/projects');
};

// 查看详情
const handleViewDetail = (projectId) => {
  message.info('项目详情页开发中...');
  // TODO: 跳转到项目详情页
};

// 购买项目
const handleBuyProject = (project) => {
  selectedProject.value = project;
  showBuyModal.value = true;
};

// 确认购买
const handleConfirmPurchase = async () => {
  if (walletBalance.value < selectedProject.value.price) {
    message.error('余额不足，无法购买');
    return;
  }

  purchasing.value = true;
  try {
    // TODO: 调用智能合约执行购买
    await new Promise(resolve => setTimeout(resolve, 2000));

    walletBalance.value -= selectedProject.value.price;
    message.success('购买成功！项目已添加到你的账户');
    showBuyModal.value = false;
    selectedProject.value = null;
  } catch (error) {
    logger.error('Purchase failed:', error);
    message.error('购买失败：' + error.message);
  } finally {
    purchasing.value = false;
  }
};

// 出售项目
const handleSellProject = () => {
  if (myProjects.value.length === 0) {
    message.warning('你还没有可以出售的项目');
    return;
  }
  showSellModal.value = true;
};

// 确认出售
const handleConfirmSell = async () => {
  if (!sellForm.value.projectId) {
    message.warning('请选择项目');
    return;
  }
  if (!sellForm.value.category) {
    message.warning('请选择分类');
    return;
  }
  if (!sellForm.value.price || sellForm.value.price < 1) {
    message.warning('请设置正确的价格');
    return;
  }
  if (!sellForm.value.description) {
    message.warning('请填写项目描述');
    return;
  }

  selling.value = true;
  try {
    // TODO: 调用后端API上架项目
    await new Promise(resolve => setTimeout(resolve, 1500));

    message.success('项目已成功上架到市场！');
    showSellModal.value = false;
    sellForm.value = {
      projectId: null,
      category: '',
      price: 100,
      description: '',
      thumbnail: '',
    };
    await loadMarketProjects();
  } catch (error) {
    logger.error('Sell failed:', error);
    message.error('上架失败：' + error.message);
  } finally {
    selling.value = false;
  }
};

// 处理图片上传
const handleBeforeUpload = (file) => {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    message.error('只能上传图片文件');
    return false;
  }

  const isLt2M = file.size / 1024 / 1024 < 2;
  if (!isLt2M) {
    message.error('图片大小不能超过2MB');
    return false;
  }

  // TODO: 实际上传到IPFS或其他存储
  const reader = new FileReader();
  reader.onload = (e) => {
    sellForm.value.thumbnail = e.target.result;
  };
  reader.readAsDataURL(file);

  return false;
};

// 加载市场项目
const loadMarketProjects = async () => {
  // TODO: 从后端API获取实际数据
  // 模拟数据 - 不使用外部图片，改用图标占位
  marketProjects.value = [
    {
      id: 'market-1',
      name: 'React电商后台管理系统',
      description: '完整的电商后台管理系统，包含商品管理、订单管理、用户管理等功能',
      category: 'web',
      price: 299,
      thumbnail: '', // 留空使用图标占位
      seller: {
        did: 'did:chainless:seller1',
        name: '前端大师',
        rating: 4.8,
      },
      views: 1250,
      sales: 86,
      rating: 4.7,
      featured: true,
      listedAt: Date.now() - 86400000,
    },
    {
      id: 'market-2',
      name: 'Vue3企业级项目模板',
      description: 'Vue3 + TypeScript + Vite企业级项目模板，包含完整的工程化配置',
      category: 'web',
      price: 199,
      thumbnail: '', // 留空使用图标占位
      seller: {
        did: 'did:chainless:seller2',
        name: 'Vue开发者',
        rating: 4.9,
      },
      views: 980,
      sales: 124,
      rating: 4.9,
      featured: false,
      listedAt: Date.now() - 172800000,
    },
    {
      id: 'market-3',
      name: 'Python数据分析工具包',
      description: '包含数据清洗、可视化、机器学习等常用工具的Python包',
      category: 'data',
      price: 399,
      thumbnail: '', // 留空使用图标占位
      seller: {
        did: 'did:chainless:seller3',
        name: '数据科学家',
        rating: 5.0,
      },
      views: 756,
      sales: 45,
      rating: 5.0,
      featured: true,
      listedAt: Date.now() - 259200000,
    },
    {
      id: 'market-4',
      name: '技术文档Markdown模板',
      description: '专业的技术文档模板，适用于API文档、技术方案等',
      category: 'document',
      price: 49,
      thumbnail: '', // 留空使用图标占位
      seller: {
        did: 'did:chainless:seller4',
        name: '文档专家',
        rating: 4.6,
      },
      views: 2100,
      sales: 312,
      rating: 4.5,
      featured: false,
      listedAt: Date.now() - 345600000,
    },
  ];

  // 模拟我的项目
  myProjects.value = projectStore.projects.filter(p => p.status === 'completed').slice(0, 3);
};

// 组件挂载
onMounted(async () => {
  loading.value = true;
  try {
    // 从localStorage恢复视图模式
    const savedViewMode = localStorage.getItem('market_view_mode');
    if (savedViewMode) {
      viewMode.value = savedViewMode;
    }

    // 加载市场项目
    await loadMarketProjects();
  } catch (error) {
    logger.error('Failed to load market projects:', error);
    message.error('加载失败：' + error.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.market-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

/* 页面头部 */
.page-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  padding: 32px 24px;
  margin-bottom: 24px;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: white;
}

.header-left p {
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
}

.header-right {
  display: flex;
  gap: 12px;
}

/* 分类栏 */
.categories-bar {
  background: white;
  border-radius: 8px;
  padding: 16px 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.categories-bar :deep(.ant-tag) {
  font-size: 14px;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.3s;
}

.categories-bar :deep(.ant-tag:hover) {
  transform: translateY(-2px);
}

/* 筛选栏 */
.filter-bar {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-left {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* 加载状态 */
.loading-container {
  background: white;
  border-radius: 8px;
  padding: 80px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 项目容器 */
.projects-container {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 网格视图 */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.market-project-card {
  border-radius: 8px;
  border: 2px solid #e5e7eb;
  overflow: hidden;
  transition: all 0.3s;
  background: white;
}

.market-project-card:hover {
  border-color: #667eea;
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.2);
  transform: translateY(-4px);
}

.card-image {
  position: relative;
  height: 200px;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.card-image .image-wrapper {
  width: 100%;
  height: 100%;
}

.card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.9);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.image-placeholder span {
  font-size: 16px;
  font-weight: 500;
}

.market-project-card:hover .card-image img {
  transform: scale(1.05);
}

.card-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s;
}

.market-project-card:hover .card-overlay {
  opacity: 1;
}

.featured-tag {
  position: absolute;
  top: 12px;
  right: 12px;
  font-weight: 600;
}

.card-body {
  padding: 20px;
}

.card-header-info {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.card-header-info h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 16px 0;
  height: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.seller-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.seller-name {
  font-size: 13px;
  color: #374151;
  font-weight: 500;
  flex: 1;
}

.stats-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
}

.card-footer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.price {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.price-label {
  font-size: 12px;
  color: #6b7280;
}

.price-value {
  font-size: 20px;
  font-weight: 700;
  color: #667eea;
}

/* 列表视图 */
.projects-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.market-project-item {
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  gap: 20px;
  transition: all 0.3s;
  background: white;
}

.market-project-item:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
}

.item-image {
  position: relative;
  width: 200px;
  height: 150px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.item-image .image-wrapper {
  width: 100%;
  height: 100%;
}

.item-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-image .image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
}

.featured-badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.item-header h4 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.item-content p {
  margin: 0 0 16px 0;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.6;
}

.item-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.seller-info-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #374151;
}

.stats-inline {
  display: flex;
  gap: 24px;
  font-size: 13px;
  color: #6b7280;
}

.stats-inline span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.item-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
  justify-content: center;
}

.price-large {
  text-align: right;
}

.price-large .price-label {
  font-size: 12px;
  color: #6b7280;
  display: block;
  margin-bottom: 4px;
}

.price-large .price-value {
  font-size: 24px;
  font-weight: 700;
  color: #667eea;
}

/* 分页 */
.pagination-container {
  display: flex;
  justify-content: center;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

/* 空状态 */
.empty-state {
  background: white;
  border-radius: 8px;
  padding: 80px 40px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.empty-icon {
  font-size: 80px;
  color: #d1d5db;
  margin-bottom: 24px;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: #6b7280;
  margin: 0 0 24px 0;
}

/* 购买Modal */
.purchase-modal {
  padding: 8px 0;
}

.project-preview {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.preview-image {
  width: 120px;
  height: 90px;
  border-radius: 6px;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  flex-shrink: 0;
}

.preview-image .image-wrapper {
  width: 100%;
  height: 100%;
}

.preview-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder-small {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
}

.project-info-modal h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.project-info-modal p {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
}

.purchase-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.detail-row span:first-child {
  color: #6b7280;
}

.detail-row span:last-child {
  font-weight: 500;
  color: #1f2937;
}

.price-highlight {
  font-size: 18px !important;
  font-weight: 700 !important;
  color: #667eea !important;
}

.balance-ok {
  color: #10b981 !important;
}

.balance-low {
  color: #ef4444 !important;
}

/* 出售表单 */
.price-suggestion {
  margin-top: 8px;
  font-size: 12px;
  color: #9ca3af;
}

.thumbnail-preview {
  margin-top: 12px;
}

.thumbnail-preview img {
  max-width: 200px;
  max-height: 150px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}
</style>
