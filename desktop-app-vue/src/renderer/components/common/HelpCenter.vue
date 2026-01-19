<template>
  <div class="help-center">
    <!-- 帮助按钮 -->
    <a-button
      v-if="!visible"
      class="help-trigger"
      type="primary"
      shape="circle"
      size="large"
      @click="visible = true"
    >
      <template #icon>
        <QuestionCircleOutlined />
      </template>
    </a-button>

    <!-- 帮助面板 -->
    <a-drawer
      v-model:open="modalVisible"
      title="帮助中心"
      placement="right"
      :width="480"
      :body-style="{ padding: 0 }"
    >
      <template #extra>
        <a-space>
          <a-input-search
            v-model:value="searchQuery"
            placeholder="搜索帮助..."
            style="width: 200px"
            @search="handleSearch"
          />
        </a-space>
      </template>

      <div class="help-content">
        <!-- 快速链接 -->
        <div
          v-if="!searchQuery && !selectedTopic"
          class="quick-links"
        >
          <h3>快速开始</h3>
          <a-space
            direction="vertical"
            style="width: 100%"
          >
            <a-card
              size="small"
              hoverable
              class="link-card"
              @click="showTopic('quickstart')"
            >
              <template #title>
                <RocketOutlined /> 5分钟快速上手
              </template>
              <p>新手？从这里开始</p>
            </a-card>

            <a-card
              size="small"
              hoverable
              class="link-card"
              @click="showTopic('skills')"
            >
              <template #title>
                <AppstoreOutlined /> 技能管理
              </template>
              <p>如何管理和创建技能</p>
            </a-card>

            <a-card
              size="small"
              hoverable
              class="link-card"
              @click="showTopic('tools')"
            >
              <template #title>
                <ToolOutlined /> 工具管理
              </template>
              <p>如何使用和测试工具</p>
            </a-card>

            <a-card
              size="small"
              hoverable
              class="link-card"
              @click="showTopic('batch')"
            >
              <template #title>
                <CheckSquareOutlined /> 批量操作
              </template>
              <p>批量管理技能和工具</p>
            </a-card>
          </a-space>
        </div>

        <!-- 常见问题 -->
        <div
          v-if="!searchQuery && !selectedTopic"
          class="faq-section"
        >
          <h3>常见问题</h3>
          <a-collapse accordion>
            <a-collapse-panel
              v-for="(faq, index) in faqs"
              :key="index"
              :header="faq.question"
            >
              <p v-html="faq.answer" />
            </a-collapse-panel>
          </a-collapse>
        </div>

        <!-- 搜索结果 -->
        <div
          v-if="searchQuery && !selectedTopic"
          class="search-results"
        >
          <h3>搜索结果</h3>
          <div
            v-if="searchResults.length === 0"
            class="no-results"
          >
            <a-empty description="未找到相关内容" />
            <a-button
              type="link"
              @click="searchQuery = ''"
            >
              清空搜索
            </a-button>
          </div>
          <a-list
            v-else
            :data-source="searchResults"
          >
            <template #renderItem="{ item }">
              <a-list-item @click="showTopic(item.id)">
                <a-list-item-meta>
                  <template #title>
                    <a>{{ item.title }}</a>
                  </template>
                  <template #description>
                    {{ item.description }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </div>

        <!-- 主题详情 -->
        <div
          v-if="selectedTopic"
          class="topic-detail"
        >
          <a-button
            type="link"
            style="margin-bottom: 16px"
            @click="selectedTopic = null"
          >
            <template #icon>
              <ArrowLeftOutlined />
            </template>
            返回
          </a-button>
          <div
            class="topic-content"
            v-html="topicContent"
          />
        </div>

        <!-- 联系支持 -->
        <div
          v-if="!selectedTopic"
          class="contact-section"
        >
          <a-divider />
          <h3>需要更多帮助？</h3>
          <a-space
            direction="vertical"
            style="width: 100%"
          >
            <a-button
              block
              @click="openUserManual"
            >
              <template #icon>
                <BookOutlined />
              </template>
              查看完整用户手册
            </a-button>
            <a-button
              block
              @click="openCommunity"
            >
              <template #icon>
                <CommentOutlined />
              </template>
              访问社区论坛
            </a-button>
            <a-button
              block
              @click="contactSupport"
            >
              <template #icon>
                <MailOutlined />
              </template>
              联系技术支持
            </a-button>
          </a-space>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  QuestionCircleOutlined,
  RocketOutlined,
  AppstoreOutlined,
  ToolOutlined,
  CheckSquareOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  CommentOutlined,
  MailOutlined,
} from '@ant-design/icons-vue';

const visible = ref(false);
const searchQuery = ref('');
const selectedTopic = ref(null);

// 常见问题数据
const faqs = ref([
  {
    question: '如何创建一个新技能？',
    answer: '点击技能管理页面右上角的<strong>"创建技能"</strong>按钮，填写技能名称、描述等基本信息，选择关联的工具，最后点击保存即可。',
  },
  {
    question: '批量操作后如何撤销？',
    answer: '批量操作<strong>无法撤销</strong>，特别是删除操作。建议在批量删除前先使用批量禁用功能，确认无误后再删除。',
  },
  {
    question: '为什么搜索没有结果？',
    answer: '请检查：1) 关键词拼写是否正确 2) 是否设置了过滤条件 3) 尝试使用部分关键词搜索。',
  },
  {
    question: '如何查看技能的依赖关系？',
    answer: '点击<strong>"依赖关系图"</strong>按钮，可以查看技能和工具之间的依赖关系图。使用鼠标滚轮可以缩放，拖拽可以移动节点。',
  },
  {
    question: '工具测试失败怎么办？',
    answer: '检查：1) 参数格式是否正确 2) 是否有必要的权限 3) 工具是否已启用 4) 查看错误信息进行排查。',
  },
]);

// 帮助主题数据
const topics = {
  quickstart: {
    title: '5分钟快速上手',
    description: '新手快速入门指南',
    content: `
      <h2>欢迎使用 Skill-Tool System!</h2>
      <p>按照以下步骤快速上手：</p>

      <h3>Step 1: 浏览技能列表</h3>
      <p>在技能管理页面查看系统内置的15个技能，了解技能的基本结构。</p>

      <h3>Step 2: 搜索和筛选</h3>
      <p>尝试使用搜索框和分类筛选功能，快速找到需要的技能。</p>

      <h3>Step 3: 查看详情</h3>
      <p>点击技能卡片的"详情"按钮，查看技能的完整信息和关联的工具。</p>

      <h3>Step 4: 创建技能</h3>
      <p>点击"创建技能"按钮，填写基本信息，保存你的第一个技能。</p>

      <h3>Step 5: 批量操作</h3>
      <p>选择多个技能，尝试批量启用/禁用功能。</p>

      <p style="margin-top: 20px;"><strong>恭喜！你已经掌握了基本操作！</strong></p>
    `,
  },
  skills: {
    title: '技能管理',
    description: '如何管理和创建技能',
    content: `
      <h2>技能管理完全指南</h2>

      <h3>什么是技能？</h3>
      <p>技能是高级功能组合，由多个工具组成，用于完成复杂任务。</p>

      <h3>查看技能列表</h3>
      <ul>
        <li>技能以卡片形式展示</li>
        <li>显示名称、分类、描述、标签</li>
        <li>显示使用统计和状态</li>
      </ul>

      <h3>创建技能</h3>
      <ol>
        <li>点击"创建技能"按钮</li>
        <li>填写基本信息（名称、描述、分类）</li>
        <li>添加标签</li>
        <li>选择关联的工具</li>
        <li>保存创建</li>
      </ol>

      <h3>编辑技能</h3>
      <p>点击详情页的"编辑"按钮，修改技能信息后保存。</p>

      <h3>删除技能</h3>
      <p><strong style="color: red;">注意：删除操作不可恢复！</strong></p>
      <p>建议先禁用，确认无误后再删除。</p>
    `,
  },
  tools: {
    title: '工具管理',
    description: '如何使用和测试工具',
    content: `
      <h2>工具管理完全指南</h2>

      <h3>什么是工具？</h3>
      <p>工具是基础操作单元，执行具体任务，如文件读写、代码生成等。</p>

      <h3>查看工具列表</h3>
      <ul>
        <li>工具以表格形式展示</li>
        <li>显示名称、类型、分类、风险等级</li>
        <li>显示使用情况和来源</li>
      </ul>

      <h3>测试工具</h3>
      <ol>
        <li>点击工具行的"测试"按钮</li>
        <li>输入JSON格式的参数</li>
        <li>点击"执行"运行工具</li>
        <li>查看执行结果和日志</li>
      </ol>

      <h3>创建工具</h3>
      <ol>
        <li>点击"创建工具"按钮</li>
        <li>填写基本信息（Tab 1）</li>
        <li>配置参数Schema（Tab 2）</li>
        <li>设置高级选项（Tab 3）</li>
        <li>保存创建</li>
      </ol>

      <h3>查看文档</h3>
      <p>点击"文档"按钮查看工具的详细使用说明、参数说明和示例。</p>
    `,
  },
  batch: {
    title: '批量操作',
    description: '批量管理技能和工具',
    content: `
      <h2>批量操作指南</h2>

      <h3>批量选择</h3>
      <p><strong>技能：</strong>勾选卡片左上角的复选框</p>
      <p><strong>工具：</strong>勾选表格行的复选框</p>
      <p><strong>全选：</strong>点击批量操作栏的复选框</p>

      <h3>批量启用/禁用</h3>
      <ol>
        <li>选择需要操作的项目</li>
        <li>点击"批量启用"或"批量禁用"</li>
        <li>确认操作</li>
        <li>查看结果</li>
      </ol>

      <h3>批量删除</h3>
      <p><strong style="color: red;">警告：批量删除不可恢复！</strong></p>
      <ol>
        <li>选择需要删除的项目</li>
        <li>点击"批量删除"按钮</li>
        <li>仔细查看删除列表</li>
        <li>确认删除</li>
      </ol>

      <h3>最佳实践</h3>
      <ul>
        <li>删除前先检查依赖关系</li>
        <li>建议先禁用再删除</li>
        <li>重要数据先备份</li>
        <li>一次选择不要太多（建议<50项）</li>
      </ul>
    `,
  },
};

// 搜索结果
const searchResults = computed(() => {
  if (!searchQuery.value) {return [];}

  const query = searchQuery.value.toLowerCase();
  const results = [];

  // 搜索主题
  Object.entries(topics).forEach(([id, topic]) => {
    if (
      topic.title.toLowerCase().includes(query) ||
      topic.description.toLowerCase().includes(query) ||
      topic.content.toLowerCase().includes(query)
    ) {
      results.push({ id, ...topic });
    }
  });

  // 搜索FAQ
  faqs.value.forEach((faq, index) => {
    if (
      faq.question.toLowerCase().includes(query) ||
      faq.answer.toLowerCase().includes(query)
    ) {
      results.push({
        id: `faq-${index}`,
        title: faq.question,
        description: faq.answer.replace(/<[^>]+>/g, ''),
      });
    }
  });

  return results;
});

// 当前主题内容
const topicContent = computed(() => {
  if (!selectedTopic.value) {return '';}
  const topic = topics[selectedTopic.value];
  return topic ? topic.content : '';
});

// 显示主题
const showTopic = (topicId) => {
  selectedTopic.value = topicId;
  searchQuery.value = '';
};

// 搜索处理
const handleSearch = () => {
  selectedTopic.value = null;
};

// 打开用户手册
const openUserManual = () => {
  window.open('/docs/USER_MANUAL.md', '_blank');
};

// 打开社区
const openCommunity = () => {
  window.open('https://community.chainlesschain.com', '_blank');
};

// 联系支持
const contactSupport = () => {
  message.info('邮箱: support@chainlesschain.com');
};

// 监听F1快捷键
const handleKeyPress = (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    visible.value = true;
  }
};

// 生命周期
onMounted(() => {
  window.addEventListener('keydown', handleKeyPress);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyPress);
});
</script>

<script>
import { onMounted, onBeforeUnmount } from 'vue';
export default {
  name: 'HelpCenter',
};
</script>

<style scoped lang="scss">
.help-center {
  .help-trigger {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

    &:hover {
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }
  }

  .help-content {
    padding: 24px;

    h3 {
      margin: 16px 0 12px;
      font-size: 16px;
      font-weight: 600;
    }

    .quick-links {
      .link-card {
        cursor: pointer;
        transition: all 0.3s ease;

        &:hover {
          border-color: #1890ff;
        }

        p {
          margin: 0;
          color: #8c8c8c;
          font-size: 12px;
        }
      }
    }

    .faq-section {
      margin-top: 24px;

      :deep(.ant-collapse-header) {
        font-weight: 500;
      }
    }

    .search-results {
      .no-results {
        text-align: center;
        padding: 40px 0;
      }

      :deep(.ant-list-item) {
        cursor: pointer;

        &:hover {
          background: #f5f5f5;
        }
      }
    }

    .topic-detail {
      .topic-content {
        :deep(h2) {
          font-size: 20px;
          margin-bottom: 16px;
        }

        :deep(h3) {
          font-size: 16px;
          margin: 20px 0 12px;
        }

        :deep(p) {
          margin-bottom: 12px;
          line-height: 1.6;
        }

        :deep(ul), :deep(ol) {
          margin: 12px 0;
          padding-left: 24px;

          li {
            margin: 8px 0;
          }
        }

        :deep(strong) {
          font-weight: 600;
        }
      }
    }

    .contact-section {
      margin-top: 24px;

      .ant-btn {
        text-align: left;
        height: auto;
        padding: 12px 16px;

        :deep(.anticon) {
          margin-right: 8px;
        }
      }
    }
  }
}
</style>
