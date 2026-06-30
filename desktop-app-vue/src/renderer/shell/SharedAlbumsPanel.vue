<template>
  <a-modal
    :open="open"
    :width="1040"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="共享相册"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <PictureOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="page-header">
      <a-radio-group v-model:value="activeFilter" button-style="solid">
        <a-radio-button value="all">全部</a-radio-button>
        <a-radio-button value="my">我的相册</a-radio-button>
        <a-radio-button value="shared">分享给我</a-radio-button>
      </a-radio-group>
      <a-space>
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索相册..."
          style="width: 220px"
          allow-clear
        />
        <a-button type="primary" size="small" @click="showCreateModal">
          <template #icon><PlusOutlined /></template>
          创建相册
        </a-button>
      </a-space>
    </div>

    <a-spin :spinning="albumsStore.loading">
      <a-empty
        v-if="filteredAlbums.length === 0 && !albumsStore.loading"
        description="未找到相册"
      >
        <template #image>
          <PictureOutlined style="font-size: 64px; color: #d9d9d9" />
        </template>
        <a-button type="primary" @click="showCreateModal">
          创建你的第一个相册
        </a-button>
      </a-empty>

      <a-row v-if="filteredAlbums.length > 0" :gutter="[16, 16]">
        <a-col
          v-for="album in filteredAlbums"
          :key="album.id"
          :xs="24"
          :sm="12"
          :md="8"
        >
          <a-card hoverable class="album-card" @click="openAlbum(album)">
            <template #cover>
              <div class="album-cover">
                <img
                  v-if="album.cover_url"
                  :src="album.cover_url"
                  :alt="album.name"
                />
                <div v-else class="album-cover-placeholder">
                  <PictureOutlined />
                </div>
                <div class="album-visibility-badge">
                  <a-tag :color="getVisibilityColor(album.visibility)">
                    <LockOutlined v-if="album.visibility === 'private'" />
                    <TeamOutlined v-else-if="album.visibility === 'friends'" />
                    <GlobalOutlined v-else />
                    {{ getVisibilityLabel(album.visibility) }}
                  </a-tag>
                </div>
              </div>
            </template>

            <a-card-meta :title="album.name">
              <template #description>
                <div class="album-meta">
                  <span
                    ><CameraOutlined /> {{ album.photo_count || 0 }} 照片</span
                  >
                  <span
                    ><UserOutlined /> {{ album.member_count || 0 }} 成员</span
                  >
                </div>
                <div v-if="album.description" class="album-description">
                  {{ truncateText(album.description, 60) }}
                </div>
                <div class="album-time">{{ formatTime(album.updated_at) }}</div>
              </template>
            </a-card-meta>

            <template #actions>
              <a-tooltip title="分享">
                <ShareAltOutlined @click.stop="handleShareAlbum(album)" />
              </a-tooltip>
              <a-tooltip title="成员">
                <TeamOutlined @click.stop="handleManageMembers(album)" />
              </a-tooltip>
              <a-dropdown @click.stop>
                <MoreOutlined />
                <template #overlay>
                  <a-menu>
                    <a-menu-item @click="handleEditAlbum(album)">
                      <EditOutlined /> 编辑
                    </a-menu-item>
                    <a-menu-item
                      v-if="album.member_role === 'owner'"
                      danger
                      @click="handleDeleteAlbum(album)"
                    >
                      <DeleteOutlined /> 删除
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </template>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <a-modal
      v-model:open="createModalVisible"
      :title="editingAlbum ? '编辑相册' : '创建相册'"
      :confirm-loading="creating"
      @ok="handleCreateOrUpdate"
      @cancel="resetCreateForm"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="相册名称" required>
          <a-input
            v-model:value="createForm.name"
            placeholder="输入相册名称"
            :maxlength="100"
            show-count
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="createForm.description"
            :rows="3"
            placeholder="描述你的相册..."
            :maxlength="500"
            show-count
          />
        </a-form-item>
        <a-form-item label="可见性">
          <a-select v-model:value="createForm.visibility" style="width: 100%">
            <a-select-option value="private">
              <LockOutlined /> 私密 - 仅成员
            </a-select-option>
            <a-select-option value="friends">
              <TeamOutlined /> 好友 - 好友可见
            </a-select-option>
            <a-select-option value="public">
              <GlobalOutlined /> 公开 - 所有人可见
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="membersModalVisible"
      title="管理成员"
      :footer="null"
      width="600px"
    >
      <div class="members-section">
        <div class="members-invite">
          <a-input-search
            v-model:value="inviteDid"
            placeholder="输入要邀请的 DID"
            enter-button="邀请"
            @search="handleInviteMember"
          />
          <div class="invite-role" style="margin-top: 8px">
            <span>角色: </span>
            <a-radio-group v-model:value="inviteRole" size="small">
              <a-radio-button value="viewer">查看者</a-radio-button>
              <a-radio-button value="editor">编辑者</a-radio-button>
            </a-radio-group>
          </div>
        </div>

        <a-divider />

        <a-list :data-source="albumsStore.members" item-layout="horizontal">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-avatar>
                    <template #icon><UserOutlined /></template>
                  </a-avatar>
                </template>
                <template #title>{{ shortenDid(item.member_did) }}</template>
                <template #description>
                  <a-tag :color="getRoleColor(item.role)">
                    {{ item.role }}
                  </a-tag>
                  <span class="member-joined">
                    加入于 {{ formatTime(item.joined_at) }}
                  </span>
                </template>
              </a-list-item-meta>
              <template #actions>
                <a-button
                  v-if="
                    item.role !== 'owner' && albumsStore.isCurrentAlbumOwner
                  "
                  type="text"
                  danger
                  size="small"
                  @click="handleRemoveMember(item)"
                >
                  移除
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-modal>

    <a-drawer
      v-model:open="albumDrawerVisible"
      :title="albumsStore.currentAlbum?.name || '相册'"
      placement="right"
      :width="760"
      @close="handleCloseAlbum"
    >
      <template #extra>
        <a-space>
          <a-upload
            v-if="albumsStore.canEditCurrentAlbum"
            :before-upload="handleBeforeUpload"
            :show-upload-list="false"
            accept="image/*"
            :multiple="true"
          >
            <a-button type="primary" size="small">
              <UploadOutlined /> 上传照片
            </a-button>
          </a-upload>
        </a-space>
      </template>

      <a-progress
        v-if="
          albumsStore.uploadProgress > 0 && albumsStore.uploadProgress < 100
        "
        :percent="albumsStore.uploadProgress"
        status="active"
        style="margin-bottom: 16px"
      />

      <a-empty
        v-if="albumsStore.currentPhotos.length === 0"
        description="暂无照片"
      >
        <a-upload
          v-if="albumsStore.canEditCurrentAlbum"
          :before-upload="handleBeforeUpload"
          :show-upload-list="false"
          accept="image/*"
        >
          <a-button type="primary">上传第一张照片</a-button>
        </a-upload>
      </a-empty>

      <div v-if="albumsStore.currentPhotos.length > 0" class="photo-grid">
        <div
          v-for="(photo, index) in albumsStore.currentPhotos"
          :key="photo.id"
          class="photo-item"
          @click="openPhotoViewer(index)"
        >
          <img
            :src="photo.thumbnail_path || photo.file_path"
            :alt="photo.caption || 'Photo'"
          />
          <div class="photo-overlay">
            <div v-if="photo.caption" class="photo-caption">
              {{ photo.caption }}
            </div>
            <a-button
              v-if="albumsStore.canEditCurrentAlbum"
              type="text"
              danger
              size="small"
              class="photo-delete-btn"
              @click.stop="handleRemovePhoto(photo)"
            >
              <DeleteOutlined />
            </a-button>
          </div>
        </div>
      </div>
    </a-drawer>

    <PhotoViewer
      v-if="viewerVisible"
      :photos="albumsStore.currentPhotos"
      :initial-index="viewerIndex"
      @close="viewerVisible = false"
    />
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from "vue";
import { message as antMessage, Modal } from "ant-design-vue";
import {
  PlusOutlined,
  PictureOutlined,
  LockOutlined,
  TeamOutlined,
  GlobalOutlined,
  CameraOutlined,
  UserOutlined,
  ShareAltOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { useAlbumsStore } from "../stores/albums";
import PhotoViewer from "../components/social/PhotoViewer.vue";
import { logger } from "@/utils/logger";

const props = defineProps({
  open: { type: Boolean, default: false },
  prefillText: { type: String, default: "" },
});
defineEmits(["update:open"]);

const albumsStore = useAlbumsStore();

const searchQuery = ref("");
const activeFilter = ref("all");
const createModalVisible = ref(false);
const membersModalVisible = ref(false);
const albumDrawerVisible = ref(false);
const creating = ref(false);
const editingAlbum = ref(null);
const viewerVisible = ref(false);
const viewerIndex = ref(0);
const inviteDid = ref("");
const inviteRole = ref("viewer");

const createForm = reactive({
  name: "",
  description: "",
  visibility: "friends",
});

const filteredAlbums = computed(() => {
  let albums = albumsStore.albums;

  if (activeFilter.value === "my") {
    albums = albumsStore.myAlbums;
  } else if (activeFilter.value === "shared") {
    albums = albumsStore.sharedWithMe;
  }

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    albums = albums.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        (a.description && a.description.toLowerCase().includes(query)),
    );
  }

  return albums;
});

function showCreateModal() {
  editingAlbum.value = null;
  createForm.name = "";
  createForm.description = "";
  createForm.visibility = "friends";
  createModalVisible.value = true;
}

function resetCreateForm() {
  editingAlbum.value = null;
  createForm.name = "";
  createForm.description = "";
  createForm.visibility = "friends";
}

async function handleCreateOrUpdate() {
  if (!createForm.name.trim()) {
    antMessage.warning("请输入相册名称");
    return;
  }
  try {
    creating.value = true;
    if (editingAlbum.value) {
      await albumsStore.updateAlbum(editingAlbum.value.id, {
        name: createForm.name,
        description: createForm.description,
        visibility: createForm.visibility,
      });
      antMessage.success("相册已更新");
    } else {
      await albumsStore.createAlbum({
        name: createForm.name,
        description: createForm.description,
        visibility: createForm.visibility,
      });
      antMessage.success("相册已创建");
    }
    createModalVisible.value = false;
    resetCreateForm();
  } catch (error) {
    logger.error("Failed to create/update album:", error);
    antMessage.error(editingAlbum.value ? "更新相册失败" : "创建相册失败");
  } finally {
    creating.value = false;
  }
}

function handleEditAlbum(album) {
  editingAlbum.value = album;
  createForm.name = album.name;
  createForm.description = album.description || "";
  createForm.visibility = album.visibility;
  createModalVisible.value = true;
}

function handleDeleteAlbum(album) {
  Modal.confirm({
    title: "删除相册",
    content: `确定要删除"${album.name}"吗？此操作不可撤销。`,
    okText: "删除",
    okType: "danger",
    async onOk() {
      try {
        await albumsStore.deleteAlbum(album.id);
        antMessage.success("相册已删除");
      } catch (error) {
        logger.error("Failed to delete album:", error);
        antMessage.error("删除相册失败");
      }
    },
  });
}

async function openAlbum(album) {
  await albumsStore.selectAlbum(album.id);
  albumDrawerVisible.value = true;
}

function handleCloseAlbum() {
  albumDrawerVisible.value = false;
  albumsStore.clearSelection();
}

async function handleBeforeUpload(file) {
  if (!albumsStore.currentAlbum) {
    antMessage.error("未选择相册");
    return false;
  }
  const isImage = file.type.startsWith("image/");
  if (!isImage) {
    antMessage.error("仅接受图片文件");
    return false;
  }
  const isLt20M = file.size / 1024 / 1024 < 20;
  if (!isLt20M) {
    antMessage.error("图片必须小于 20MB");
    return false;
  }
  try {
    await albumsStore.addPhoto({
      albumId: albumsStore.currentAlbum.id,
      rawFilePath: file.path,
      caption: "",
    });
    antMessage.success("照片已添加");
  } catch (error) {
    logger.error("Failed to upload photo:", error);
    antMessage.error("上传照片失败");
  }
  return false;
}

function handleRemovePhoto(photo) {
  Modal.confirm({
    title: "移除照片",
    content: "确定要移除这张照片吗？",
    okText: "移除",
    okType: "danger",
    async onOk() {
      try {
        await albumsStore.removePhoto(photo.id);
        antMessage.success("照片已移除");
      } catch (error) {
        logger.error("Failed to remove photo:", error);
        antMessage.error("移除照片失败");
      }
    },
  });
}

function openPhotoViewer(index) {
  viewerIndex.value = index;
  viewerVisible.value = true;
}

async function handleManageMembers(album) {
  await albumsStore.selectAlbum(album.id);
  membersModalVisible.value = true;
}

async function handleInviteMember() {
  if (!inviteDid.value.trim()) {
    antMessage.warning("请输入 DID");
    return;
  }
  if (!albumsStore.currentAlbum) {
    antMessage.error("未选择相册");
    return;
  }
  try {
    await albumsStore.addMember(
      albumsStore.currentAlbum.id,
      inviteDid.value.trim(),
      inviteRole.value,
    );
    antMessage.success("成员已邀请");
    inviteDid.value = "";
  } catch (error) {
    logger.error("Failed to invite member:", error);
    antMessage.error("邀请成员失败");
  }
}

function handleRemoveMember(member) {
  if (!albumsStore.currentAlbum) {
    return;
  }
  Modal.confirm({
    title: "移除成员",
    content: `将 ${shortenDid(member.member_did)} 从此相册移除？`,
    okText: "移除",
    okType: "danger",
    async onOk() {
      try {
        await albumsStore.removeMember(
          albumsStore.currentAlbum.id,
          member.member_did,
        );
        antMessage.success("成员已移除");
      } catch (error) {
        logger.error("Failed to remove member:", error);
        antMessage.error("移除成员失败");
      }
    },
  });
}

async function handleShareAlbum(album) {
  try {
    const result = await albumsStore.shareAlbum(album.id);
    if (result.sharedTo > 0) {
      antMessage.success(`相册已分享给 ${result.sharedTo} 个节点`);
    } else {
      antMessage.info("没有可分享的节点");
    }
  } catch (error) {
    logger.error("Failed to share album:", error);
    antMessage.error("分享相册失败");
  }
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) {
    return "刚刚";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  }
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}天前`;
  }
  return date.toLocaleDateString();
}

function shortenDid(did) {
  if (!did) {
    return "";
  }
  return `${did.slice(0, 8)}...${did.slice(-6)}`;
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + "...";
}

function getVisibilityColor(visibility) {
  const colors = { private: "red", friends: "blue", public: "green" };
  return colors[visibility] || "default";
}

function getVisibilityLabel(visibility) {
  const labels = { private: "私密", friends: "好友", public: "公开" };
  return labels[visibility] || visibility;
}

function getRoleColor(role) {
  const colors = { owner: "gold", editor: "blue", viewer: "default" };
  return colors[role] || "default";
}

// Load albums on open; clear selection on close.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      albumsStore.loadAlbums();
    } else {
      albumsStore.clearSelection();
    }
  },
  { immediate: true },
);
</script>

<style scoped lang="scss">
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.album-card {
  border-radius: 8px;
  overflow: hidden;
  transition:
    transform 0.2s,
    box-shadow 0.2s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.album-cover {
  position: relative;
  height: 160px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.album-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #e8e8e8 0%, #d9d9d9 100%);
  font-size: 48px;
  color: #bfbfbf;
}

.album-visibility-badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

.album-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 4px;
}

.album-description {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
  line-height: 1.4;
}

.album-time {
  font-size: 11px;
  color: #bfbfbf;
  margin-top: 4px;
}

.members-section {
  .members-invite {
    margin-bottom: 8px;
  }

  .member-joined {
    font-size: 12px;
    color: #8c8c8c;
    margin-left: 8px;
  }
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.photo-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.02);

    .photo-overlay {
      opacity: 1;
    }
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.photo-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
  opacity: 0;
  transition: opacity 0.2s;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.photo-caption {
  color: white;
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.photo-delete-btn {
  color: white !important;
  flex-shrink: 0;
}
</style>
