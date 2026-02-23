<template>
  <div class="shared-albums-page">
    <!-- Header -->
    <div class="page-header">
      <h2>Shared Albums</h2>
      <a-space>
        <a-input-search
          v-model:value="searchQuery"
          placeholder="Search albums..."
          style="width: 240px"
          allow-clear
        />
        <a-button type="primary" @click="showCreateModal">
          <PlusOutlined /> Create Album
        </a-button>
      </a-space>
    </div>

    <!-- Filter tabs -->
    <div class="filter-tabs">
      <a-radio-group v-model:value="activeFilter" button-style="solid">
        <a-radio-button value="all">All</a-radio-button>
        <a-radio-button value="my">My Albums</a-radio-button>
        <a-radio-button value="shared">Shared With Me</a-radio-button>
      </a-radio-group>
    </div>

    <!-- Album Grid -->
    <a-spin :spinning="albumsStore.loading">
      <a-empty
        v-if="filteredAlbums.length === 0 && !albumsStore.loading"
        description="No albums found"
      >
        <template #image>
          <PictureOutlined style="font-size: 64px; color: #d9d9d9" />
        </template>
        <a-button type="primary" @click="showCreateModal">
          Create Your First Album
        </a-button>
      </a-empty>

      <a-row :gutter="[16, 16]" v-if="filteredAlbums.length > 0">
        <a-col
          v-for="album in filteredAlbums"
          :key="album.id"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
        >
          <a-card
            hoverable
            class="album-card"
            @click="openAlbum(album)"
          >
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
                  <a-tag
                    :color="getVisibilityColor(album.visibility)"
                    size="small"
                  >
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
                  <span>
                    <CameraOutlined /> {{ album.photo_count || 0 }} photos
                  </span>
                  <span>
                    <UserOutlined /> {{ album.member_count || 0 }} members
                  </span>
                </div>
                <div class="album-description" v-if="album.description">
                  {{ truncateText(album.description, 60) }}
                </div>
                <div class="album-time">
                  {{ formatTime(album.updated_at) }}
                </div>
              </template>
            </a-card-meta>

            <template #actions>
              <a-tooltip title="Share">
                <ShareAltOutlined
                  @click.stop="handleShareAlbum(album)"
                />
              </a-tooltip>
              <a-tooltip title="Members">
                <TeamOutlined @click.stop="handleManageMembers(album)" />
              </a-tooltip>
              <a-dropdown @click.stop>
                <MoreOutlined />
                <template #overlay>
                  <a-menu>
                    <a-menu-item @click="handleEditAlbum(album)">
                      <EditOutlined /> Edit
                    </a-menu-item>
                    <a-menu-item
                      danger
                      @click="handleDeleteAlbum(album)"
                      v-if="album.member_role === 'owner'"
                    >
                      <DeleteOutlined /> Delete
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </template>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <!-- Create Album Modal -->
    <a-modal
      v-model:open="createModalVisible"
      :title="editingAlbum ? 'Edit Album' : 'Create Album'"
      :confirm-loading="creating"
      @ok="handleCreateOrUpdate"
      @cancel="resetCreateForm"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="Album Name" required>
          <a-input
            v-model:value="createForm.name"
            placeholder="Enter album name"
            :maxlength="100"
            show-count
          />
        </a-form-item>

        <a-form-item label="Description">
          <a-textarea
            v-model:value="createForm.description"
            :rows="3"
            placeholder="Describe your album..."
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <a-form-item label="Visibility">
          <a-select v-model:value="createForm.visibility" style="width: 100%">
            <a-select-option value="private">
              <LockOutlined /> Private - Only members
            </a-select-option>
            <a-select-option value="friends">
              <TeamOutlined /> Friends - Visible to friends
            </a-select-option>
            <a-select-option value="public">
              <GlobalOutlined /> Public - Visible to everyone
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Manage Members Modal -->
    <a-modal
      v-model:open="membersModalVisible"
      title="Manage Members"
      :footer="null"
      width="600px"
    >
      <div class="members-section">
        <div class="members-invite">
          <a-input-search
            v-model:value="inviteDid"
            placeholder="Enter DID to invite"
            enter-button="Invite"
            @search="handleInviteMember"
          />
          <div class="invite-role" style="margin-top: 8px">
            <span>Role: </span>
            <a-radio-group v-model:value="inviteRole" size="small">
              <a-radio-button value="viewer">Viewer</a-radio-button>
              <a-radio-button value="editor">Editor</a-radio-button>
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
                    <template #icon>
                      <UserOutlined />
                    </template>
                  </a-avatar>
                </template>
                <template #title>
                  {{ shortenDid(item.member_did) }}
                </template>
                <template #description>
                  <a-tag
                    :color="getRoleColor(item.role)"
                  >
                    {{ item.role }}
                  </a-tag>
                  <span class="member-joined">
                    Joined {{ formatTime(item.joined_at) }}
                  </span>
                </template>
              </a-list-item-meta>
              <template #actions>
                <a-button
                  v-if="item.role !== 'owner' && albumsStore.isCurrentAlbumOwner"
                  type="text"
                  danger
                  size="small"
                  @click="handleRemoveMember(item)"
                >
                  Remove
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-modal>

    <!-- Album Detail / Photo Grid (shown when an album is selected) -->
    <a-drawer
      v-model:open="albumDrawerVisible"
      :title="albumsStore.currentAlbum?.name || 'Album'"
      placement="right"
      :width="800"
      @close="handleCloseAlbum"
    >
      <template #extra>
        <a-space>
          <a-upload
            :before-upload="handleBeforeUpload"
            :show-upload-list="false"
            accept="image/*"
            :multiple="true"
            v-if="albumsStore.canEditCurrentAlbum"
          >
            <a-button type="primary" size="small">
              <UploadOutlined /> Upload Photos
            </a-button>
          </a-upload>
        </a-space>
      </template>

      <!-- Upload progress -->
      <a-progress
        v-if="albumsStore.uploadProgress > 0 && albumsStore.uploadProgress < 100"
        :percent="albumsStore.uploadProgress"
        status="active"
        style="margin-bottom: 16px"
      />

      <!-- Photo Grid -->
      <a-empty
        v-if="albumsStore.currentPhotos.length === 0"
        description="No photos yet"
      >
        <a-upload
          :before-upload="handleBeforeUpload"
          :show-upload-list="false"
          accept="image/*"
          v-if="albumsStore.canEditCurrentAlbum"
        >
          <a-button type="primary">Upload First Photo</a-button>
        </a-upload>
      </a-empty>

      <div class="photo-grid" v-if="albumsStore.currentPhotos.length > 0">
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
            <div class="photo-caption" v-if="photo.caption">
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

    <!-- Photo Viewer -->
    <PhotoViewer
      v-if="viewerVisible"
      :photos="albumsStore.currentPhotos"
      :initial-index="viewerIndex"
      @close="viewerVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { message as antMessage, Modal } from 'ant-design-vue';
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
} from '@ant-design/icons-vue';
import { useAlbumsStore } from '../stores/albums';
import PhotoViewer from '../components/social/PhotoViewer.vue';
import { logger } from '@/utils/logger';

const albumsStore = useAlbumsStore();

// UI state
const searchQuery = ref('');
const activeFilter = ref('all');
const createModalVisible = ref(false);
const membersModalVisible = ref(false);
const albumDrawerVisible = ref(false);
const creating = ref(false);
const editingAlbum = ref(null);
const viewerVisible = ref(false);
const viewerIndex = ref(0);
const inviteDid = ref('');
const inviteRole = ref('viewer');

// Create form
const createForm = reactive({
  name: '',
  description: '',
  visibility: 'friends',
});

// Computed
const filteredAlbums = computed(() => {
  let albums = albumsStore.albums;

  // Filter by tab
  if (activeFilter.value === 'my') {
    albums = albumsStore.myAlbums;
  } else if (activeFilter.value === 'shared') {
    albums = albumsStore.sharedWithMe;
  }

  // Filter by search
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

// ========== Album Actions ==========

const showCreateModal = () => {
  editingAlbum.value = null;
  createForm.name = '';
  createForm.description = '';
  createForm.visibility = 'friends';
  createModalVisible.value = true;
};

const resetCreateForm = () => {
  editingAlbum.value = null;
  createForm.name = '';
  createForm.description = '';
  createForm.visibility = 'friends';
};

const handleCreateOrUpdate = async () => {
  if (!createForm.name.trim()) {
    antMessage.warning('Please enter an album name');
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
      antMessage.success('Album updated successfully');
    } else {
      await albumsStore.createAlbum({
        name: createForm.name,
        description: createForm.description,
        visibility: createForm.visibility,
      });
      antMessage.success('Album created successfully');
    }

    createModalVisible.value = false;
    resetCreateForm();
  } catch (error) {
    logger.error('Failed to create/update album:', error);
    antMessage.error(editingAlbum.value ? 'Failed to update album' : 'Failed to create album');
  } finally {
    creating.value = false;
  }
};

const handleEditAlbum = (album) => {
  editingAlbum.value = album;
  createForm.name = album.name;
  createForm.description = album.description || '';
  createForm.visibility = album.visibility;
  createModalVisible.value = true;
};

const handleDeleteAlbum = (album) => {
  Modal.confirm({
    title: 'Delete Album',
    content: `Are you sure you want to delete "${album.name}"? This action cannot be undone.`,
    okText: 'Delete',
    okType: 'danger',
    async onOk() {
      try {
        await albumsStore.deleteAlbum(album.id);
        antMessage.success('Album deleted');
      } catch (error) {
        logger.error('Failed to delete album:', error);
        antMessage.error('Failed to delete album');
      }
    },
  });
};

const openAlbum = async (album) => {
  await albumsStore.selectAlbum(album.id);
  albumDrawerVisible.value = true;
};

const handleCloseAlbum = () => {
  albumDrawerVisible.value = false;
  albumsStore.clearSelection();
};

// ========== Photo Actions ==========

const handleBeforeUpload = async (file) => {
  if (!albumsStore.currentAlbum) {
    antMessage.error('No album selected');
    return false;
  }

  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    antMessage.error('Only image files are accepted');
    return false;
  }

  const isLt20M = file.size / 1024 / 1024 < 20;
  if (!isLt20M) {
    antMessage.error('Image must be smaller than 20MB');
    return false;
  }

  try {
    await albumsStore.addPhoto({
      albumId: albumsStore.currentAlbum.id,
      rawFilePath: file.path,
      caption: '',
    });
    antMessage.success('Photo added successfully');
  } catch (error) {
    logger.error('Failed to upload photo:', error);
    antMessage.error('Failed to upload photo');
  }

  return false; // Prevent default upload behavior
};

const handleRemovePhoto = (photo) => {
  Modal.confirm({
    title: 'Remove Photo',
    content: 'Are you sure you want to remove this photo?',
    okText: 'Remove',
    okType: 'danger',
    async onOk() {
      try {
        await albumsStore.removePhoto(photo.id);
        antMessage.success('Photo removed');
      } catch (error) {
        logger.error('Failed to remove photo:', error);
        antMessage.error('Failed to remove photo');
      }
    },
  });
};

const openPhotoViewer = (index) => {
  viewerIndex.value = index;
  viewerVisible.value = true;
};

// ========== Member Actions ==========

const handleManageMembers = async (album) => {
  await albumsStore.selectAlbum(album.id);
  membersModalVisible.value = true;
};

const handleInviteMember = async () => {
  if (!inviteDid.value.trim()) {
    antMessage.warning('Please enter a DID');
    return;
  }

  if (!albumsStore.currentAlbum) {
    antMessage.error('No album selected');
    return;
  }

  try {
    await albumsStore.addMember(
      albumsStore.currentAlbum.id,
      inviteDid.value.trim(),
      inviteRole.value,
    );
    antMessage.success('Member invited successfully');
    inviteDid.value = '';
  } catch (error) {
    logger.error('Failed to invite member:', error);
    antMessage.error('Failed to invite member');
  }
};

const handleRemoveMember = (member) => {
  if (!albumsStore.currentAlbum) {
    return;
  }

  Modal.confirm({
    title: 'Remove Member',
    content: `Remove ${shortenDid(member.member_did)} from this album?`,
    okText: 'Remove',
    okType: 'danger',
    async onOk() {
      try {
        await albumsStore.removeMember(
          albumsStore.currentAlbum.id,
          member.member_did,
        );
        antMessage.success('Member removed');
      } catch (error) {
        logger.error('Failed to remove member:', error);
        antMessage.error('Failed to remove member');
      }
    },
  });
};

// ========== Share Actions ==========

const handleShareAlbum = async (album) => {
  try {
    const result = await albumsStore.shareAlbum(album.id);
    if (result.sharedTo > 0) {
      antMessage.success(`Album shared with ${result.sharedTo} peers`);
    } else {
      antMessage.info('No peers available for sharing');
    }
  } catch (error) {
    logger.error('Failed to share album:', error);
    antMessage.error('Failed to share album');
  }
};

// ========== Utility Functions ==========

const formatTime = (timestamp) => {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    return 'just now';
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}d ago`;
  }
  return date.toLocaleDateString();
};

const shortenDid = (did) => {
  if (!did) {
    return '';
  }
  return `${did.slice(0, 8)}...${did.slice(-6)}`;
};

const truncateText = (text, maxLength) => {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
};

const getVisibilityColor = (visibility) => {
  const colors = {
    private: 'red',
    friends: 'blue',
    public: 'green',
  };
  return colors[visibility] || 'default';
};

const getVisibilityLabel = (visibility) => {
  const labels = {
    private: 'Private',
    friends: 'Friends',
    public: 'Public',
  };
  return labels[visibility] || visibility;
};

const getRoleColor = (role) => {
  const colors = {
    owner: 'gold',
    editor: 'blue',
    viewer: 'default',
  };
  return colors[role] || 'default';
};

// ========== Lifecycle ==========

onMounted(() => {
  albumsStore.loadAlbums();
});

onUnmounted(() => {
  albumsStore.clearSelection();
});
</script>

<style scoped lang="scss">
.shared-albums-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  padding: 24px;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
}

.filter-tabs {
  margin-bottom: 16px;
}

// Album card styles
.album-card {
  border-radius: 8px;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.album-cover {
  position: relative;
  height: 180px;
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

// Members section
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

// Photo grid
.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
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
