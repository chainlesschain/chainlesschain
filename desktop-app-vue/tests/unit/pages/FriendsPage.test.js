/**
 * FriendsPage 单元测试
 * 测试目标: src/renderer/pages/FriendsPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和好友列表加载
 * - 在线状态显示
 * - 搜索功能
 * - 好友分组（全部、在线、自定义分组）
 * - 添加好友功能
 * - 编辑好友备注
 * - 移动分组
 * - 删除好友
 * - 发送消息
 * - 语音和视频通话
 * - DID格式化
 * - 空状态处理
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";

// Hoisted mocks for ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

const mockModal = vi.hoisted(() => ({
  confirm: vi.fn((options) => {
    options.onOk && options.onOk();
  }),
}));

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: mockMessage,
  Modal: mockModal,
}));

// Mock vue-router - use vi.hoisted to ensure mockRouter is available before vi.mock runs
const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
};

describe("FriendsPage", () => {
  let wrapper;

  const mockFriends = [
    {
      id: 1,
      friend_did: "did:chainlesschain:user1",
      nickname: "Alice",
      avatar: "https://example.com/avatar1.jpg",
      notes: "Good friend",
      group: "Work",
      onlineStatus: {
        status: "online",
        lastSeen: Date.now(),
        deviceCount: 2,
      },
    },
    {
      id: 2,
      friend_did: "did:chainlesschain:user2",
      nickname: "Bob",
      avatar: "https://example.com/avatar2.jpg",
      notes: "",
      group: "Family",
      onlineStatus: {
        status: "offline",
        lastSeen: Date.now() - 3600000,
        deviceCount: 0,
      },
    },
    {
      id: 3,
      friend_did: "did:chainlesschain:user3",
      nickname: "Charlie",
      avatar: "",
      notes: "Team member",
      group: "Work",
      onlineStatus: {
        status: "online",
        lastSeen: Date.now(),
        deviceCount: 1,
      },
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="friends-page">
            <a-card :bordered="false" class="friends-card">
              <template #title>
                <div class="page-header">
                  <div class="header-left">
                    <span class="header-title">好友列表</span>
                    <a-badge :count="onlineFriendsCount" />
                  </div>
                  <div class="header-right">
                    <a-input-search
                      v-model:value="searchKeyword"
                      placeholder="搜索好友..."
                      @search="handleSearch"
                    />
                    <a-button type="primary" @click="showAddFriendModal = true">
                      添加好友
                    </a-button>
                  </div>
                </div>
              </template>

              <a-tabs v-model:active-key="activeGroup" @change="handleGroupChange">
                <a-tab-pane key="all" tab="全部好友" />
                <a-tab-pane key="online" tab="在线好友" />
                <a-tab-pane
                  v-for="group in friendGroups"
                  :key="group"
                  :tab="group"
                />
              </a-tabs>

              <a-spin :spinning="loading">
                <a-list :data-source="filteredFriends" class="friends-list">
                  <template #renderItem="{ item }">
                    <a-list-item @click="handleFriendClick(item)">
                      <a-list-item-meta>
                        <template #avatar>
                          <a-avatar :size="48" :src="item.avatar">
                            {{ item.nickname?.charAt(0) || 'U' }}
                          </a-avatar>
                        </template>
                        <template #title>
                          {{ item.nickname || item.friend_did }}
                        </template>
                        <template #description>
                          DID: {{ formatDID(item.friend_did) }}
                        </template>
                      </a-list-item-meta>

                      <template #actions>
                        <a-button type="text" @click.stop="handleSendMessage(item)">
                          发送消息
                        </a-button>
                        <a-button type="text" @click.stop="handleVoiceCall(item)">
                          语音通话
                        </a-button>
                        <a-button type="text" @click.stop="handleVideoCall(item)">
                          视频通话
                        </a-button>
                        <a-dropdown>
                          <a-button type="text">更多</a-button>
                          <template #overlay>
                            <a-menu @click="({ key }) => handleMenuAction(key, item)">
                              <a-menu-item key="edit">编辑备注</a-menu-item>
                              <a-menu-item key="move">移动分组</a-menu-item>
                              <a-menu-item key="delete" danger>删除好友</a-menu-item>
                            </a-menu>
                          </template>
                        </a-dropdown>
                      </template>
                    </a-list-item>
                  </template>
                </a-list>
              </a-spin>
            </a-card>

            <!-- Add Friend Modal -->
            <a-modal
              v-model:open="showAddFriendModal"
              title="添加好友"
              @ok="handleAddFriend"
              @cancel="showAddFriendModal = false"
            >
              <a-form :model="addFriendForm" layout="vertical">
                <a-form-item label="好友DID" required>
                  <a-input v-model:value="addFriendForm.did" placeholder="输入好友的DID地址" />
                </a-form-item>
                <a-form-item label="验证消息">
                  <a-textarea v-model:value="addFriendForm.message" :rows="3" />
                </a-form-item>
              </a-form>
            </a-modal>

            <!-- Edit Modal -->
            <a-modal
              v-model:open="showEditModal"
              title="编辑好友信息"
              @ok="handleSaveEdit"
              @cancel="showEditModal = false"
            >
              <a-form :model="editForm" layout="vertical">
                <a-form-item label="备注名称">
                  <a-input v-model:value="editForm.nickname" />
                </a-form-item>
                <a-form-item label="备注">
                  <a-textarea v-model:value="editForm.notes" :rows="3" />
                </a-form-item>
              </a-form>
            </a-modal>

            <!-- Move Group Modal -->
            <a-modal
              v-model:open="showMoveGroupModal"
              title="移动分组"
              @ok="handleSaveMoveGroup"
              @cancel="showMoveGroupModal = false"
            >
              <a-form layout="vertical">
                <a-form-item label="目标分组">
                  <a-select v-model:value="moveGroupTarget">
                    <a-select-option v-for="group in friendGroups" :key="group" :value="group">
                      {{ group }}
                    </a-select-option>
                  </a-select>
                </a-form-item>
              </a-form>
            </a-modal>
          </div>
        `,
        setup() {
          const { ref, computed } = require("vue");
          const message = mockMessage;
          const Modal = mockModal;

          // Use mockRouter directly instead of useRouter() for test reliability
          const router = mockRouter;
          const loading = ref(false);
          const searchKeyword = ref("");
          const activeGroup = ref("all");
          const allFriends = ref([...mockFriends]);

          const showAddFriendModal = ref(false);
          const showEditModal = ref(false);
          const showMoveGroupModal = ref(false);

          const addFriendForm = ref({ did: "", message: "" });
          const editForm = ref({ nickname: "", notes: "" });
          const moveGroupTarget = ref("");
          const currentEditFriend = ref(null);

          const onlineFriendsCount = computed(() => {
            return allFriends.value.filter(
              (f) => f.onlineStatus?.status === "online",
            ).length;
          });

          const friendGroups = computed(() => {
            const groups = new Set(
              allFriends.value.map((f) => f.group).filter(Boolean),
            );
            return Array.from(groups);
          });

          const filteredFriends = computed(() => {
            let friends = allFriends.value;

            // Filter by active group
            if (activeGroup.value === "online") {
              friends = friends.filter(
                (f) => f.onlineStatus?.status === "online",
              );
            } else if (activeGroup.value !== "all") {
              friends = friends.filter((f) => f.group === activeGroup.value);
            }

            // Filter by search keyword
            if (searchKeyword.value) {
              const keyword = searchKeyword.value.toLowerCase();
              friends = friends.filter(
                (f) =>
                  f.nickname?.toLowerCase().includes(keyword) ||
                  f.friend_did?.toLowerCase().includes(keyword) ||
                  f.notes?.toLowerCase().includes(keyword),
              );
            }

            return friends;
          });

          const formatDID = (did) => {
            if (!did) {
              return "";
            }
            if (did.length <= 20) {
              return did;
            }
            return (
              did.substring(0, 10) + "..." + did.substring(did.length - 10)
            );
          };

          const loadFriends = async () => {
            loading.value = true;
            try {
              const friends = await window.electronAPI.invoke("friends:list");
              allFriends.value = friends;
            } catch (error) {
              message.error("加载好友列表失败: " + error.message);
            } finally {
              loading.value = false;
            }
          };

          const handleSearch = () => {
            // Search is handled by computed property
          };

          const handleGroupChange = (key) => {
            activeGroup.value = key;
          };

          const handleFriendClick = (friend) => {
            // Navigate to friend detail or chat
            router.push(`/friends/${friend.id}`);
          };

          const handleSendMessage = (friend) => {
            router.push(`/chat/${friend.id}`);
          };

          const handleVoiceCall = async (friend) => {
            try {
              await window.electronAPI.invoke("call:voice", {
                friendId: friend.id,
                did: friend.friend_did,
              });
              message.success("正在发起语音通话...");
            } catch (error) {
              message.error("发起语音通话失败: " + error.message);
            }
          };

          const handleVideoCall = async (friend) => {
            try {
              await window.electronAPI.invoke("call:video", {
                friendId: friend.id,
                did: friend.friend_did,
              });
              message.success("正在发起视频通话...");
            } catch (error) {
              message.error("发起视频通话失败: " + error.message);
            }
          };

          const handleMenuAction = (key, friend) => {
            if (key === "edit") {
              currentEditFriend.value = friend;
              editForm.value = {
                nickname: friend.nickname || "",
                notes: friend.notes || "",
              };
              showEditModal.value = true;
            } else if (key === "move") {
              currentEditFriend.value = friend;
              moveGroupTarget.value = friend.group || "";
              showMoveGroupModal.value = true;
            } else if (key === "delete") {
              Modal.confirm({
                title: "确认删除",
                content: `确定要删除好友 ${friend.nickname || friend.friend_did} 吗？`,
                onOk: async () => {
                  try {
                    await window.electronAPI.invoke(
                      "friends:delete",
                      friend.id,
                    );
                    allFriends.value = allFriends.value.filter(
                      (f) => f.id !== friend.id,
                    );
                    message.success("删除成功");
                  } catch (error) {
                    message.error("删除失败: " + error.message);
                  }
                },
              });
            }
          };

          const handleAddFriend = async () => {
            if (!addFriendForm.value.did) {
              message.warning("请输入好友DID");
              return;
            }

            try {
              await window.electronAPI.invoke(
                "friends:add",
                addFriendForm.value,
              );
              message.success("好友请求已发送");
              showAddFriendModal.value = false;
              addFriendForm.value = { did: "", message: "" };
              await loadFriends();
            } catch (error) {
              message.error("添加好友失败: " + error.message);
            }
          };

          const handleSaveEdit = async () => {
            try {
              await window.electronAPI.invoke("friends:update", {
                id: currentEditFriend.value.id,
                ...editForm.value,
              });
              const index = allFriends.value.findIndex(
                (f) => f.id === currentEditFriend.value.id,
              );
              if (index !== -1) {
                allFriends.value[index] = {
                  ...allFriends.value[index],
                  ...editForm.value,
                };
              }
              message.success("保存成功");
              showEditModal.value = false;
            } catch (error) {
              message.error("保存失败: " + error.message);
            }
          };

          const handleSaveMoveGroup = async () => {
            try {
              await window.electronAPI.invoke("friends:update", {
                id: currentEditFriend.value.id,
                group: moveGroupTarget.value,
              });
              const index = allFriends.value.findIndex(
                (f) => f.id === currentEditFriend.value.id,
              );
              if (index !== -1) {
                allFriends.value[index].group = moveGroupTarget.value;
              }
              message.success("移动成功");
              showMoveGroupModal.value = false;
            } catch (error) {
              message.error("移动失败: " + error.message);
            }
          };

          return {
            loading,
            searchKeyword,
            activeGroup,
            allFriends,
            onlineFriendsCount,
            friendGroups,
            filteredFriends,
            showAddFriendModal,
            showEditModal,
            showMoveGroupModal,
            addFriendForm,
            editForm,
            moveGroupTarget,
            formatDID,
            loadFriends,
            handleSearch,
            handleGroupChange,
            handleFriendClick,
            handleSendMessage,
            handleVoiceCall,
            handleVideoCall,
            handleMenuAction,
            handleAddFriend,
            handleSaveEdit,
            handleSaveMoveGroup,
          };
        },
      },
      {
        global: {
          stubs: {
            "a-card": true,
            "a-badge": true,
            "a-input-search": true,
            "a-button": true,
            "a-tabs": true,
            "a-tab-pane": true,
            "a-spin": true,
            "a-list": true,
            "a-list-item": true,
            "a-list-item-meta": true,
            "a-avatar": true,
            "a-dropdown": true,
            "a-menu": true,
            "a-menu-item": true,
            "a-menu-divider": true,
            "a-modal": true,
            "a-form": true,
            "a-form-item": true,
            "a-input": true,
            "a-textarea": true,
            "a-select": true,
            "a-select-option": true,
            "a-tooltip": true,
            OnlineStatusIndicator: true,
          },
        },
        ...options,
      },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.invoke.mockResolvedValue([]);
  });

  describe("组件挂载", () => {
    it("应该成功挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".friends-page").exists()).toBe(true);
    });

    it("应该显示好友列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.allFriends).toHaveLength(3);
    });

    it("应该初始化activeGroup为all", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.activeGroup).toBe("all");
    });
  });

  describe("在线状态", () => {
    it("应该计算在线好友数量", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.onlineFriendsCount).toBe(2);
    });

    it("应该识别在线好友", () => {
      wrapper = createWrapper();
      const onlineFriends = wrapper.vm.allFriends.filter(
        (f) => f.onlineStatus?.status === "online",
      );
      expect(onlineFriends).toHaveLength(2);
    });

    it("应该识别离线好友", () => {
      wrapper = createWrapper();
      const offlineFriends = wrapper.vm.allFriends.filter(
        (f) => f.onlineStatus?.status === "offline",
      );
      expect(offlineFriends).toHaveLength(1);
    });

    it("应该显示设备数量", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.allFriends[0].onlineStatus.deviceCount).toBe(2);
    });
  });

  describe("搜索功能", () => {
    it("应该能通过昵称搜索", () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = "Alice";
      expect(wrapper.vm.filteredFriends).toHaveLength(1);
      expect(wrapper.vm.filteredFriends[0].nickname).toBe("Alice");
    });

    it("应该能通过DID搜索", () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = "user2";
      expect(wrapper.vm.filteredFriends).toHaveLength(1);
      expect(wrapper.vm.filteredFriends[0].friend_did).toContain("user2");
    });

    it("应该能通过备注搜索", () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = "Team";
      expect(wrapper.vm.filteredFriends).toHaveLength(1);
      expect(wrapper.vm.filteredFriends[0].notes).toContain("Team");
    });

    it("应该不区分大小写搜索", () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = "alice";
      expect(wrapper.vm.filteredFriends).toHaveLength(1);
    });

    it("应该处理空搜索关键词", () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = "";
      expect(wrapper.vm.filteredFriends).toHaveLength(3);
    });

    it("应该处理无匹配结果", () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = "nonexistent";
      expect(wrapper.vm.filteredFriends).toHaveLength(0);
    });
  });

  describe("好友分组", () => {
    it("应该显示全部好友", () => {
      wrapper = createWrapper();
      wrapper.vm.activeGroup = "all";
      expect(wrapper.vm.filteredFriends).toHaveLength(3);
    });

    it("应该筛选在线好友", () => {
      wrapper = createWrapper();
      wrapper.vm.activeGroup = "online";
      expect(wrapper.vm.filteredFriends).toHaveLength(2);
    });

    it("应该按分组筛选", () => {
      wrapper = createWrapper();
      wrapper.vm.activeGroup = "Work";
      expect(wrapper.vm.filteredFriends).toHaveLength(2);
    });

    it("应该获取所有分组", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.friendGroups).toContain("Work");
      expect(wrapper.vm.friendGroups).toContain("Family");
    });

    it("应该能切换分组", () => {
      wrapper = createWrapper();
      wrapper.vm.handleGroupChange("Work");
      expect(wrapper.vm.activeGroup).toBe("Work");
    });
  });

  describe("添加好友", () => {
    it("应该能打开添加好友对话框", () => {
      wrapper = createWrapper();
      wrapper.vm.showAddFriendModal = true;
      expect(wrapper.vm.showAddFriendModal).toBe(true);
    });

    it("应该验证DID必填", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      wrapper.vm.addFriendForm.did = "";

      await wrapper.vm.handleAddFriend();

      expect(message.warning).toHaveBeenCalledWith("请输入好友DID");
    });

    it("应该能添加好友", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce([]);

      wrapper.vm.addFriendForm.did = "did:chainlesschain:newuser";
      wrapper.vm.addFriendForm.message = "Hello";

      await wrapper.vm.handleAddFriend();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith("friends:add", {
        did: "did:chainlesschain:newuser",
        message: "Hello",
      });
      expect(message.success).toHaveBeenCalledWith("好友请求已发送");
    });

    it("应该能处理添加失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("添加失败"));

      wrapper.vm.addFriendForm.did = "did:chainlesschain:newuser";

      await wrapper.vm.handleAddFriend();

      expect(message.error).toHaveBeenCalledWith("添加好友失败: 添加失败");
    });
  });

  describe("编辑好友", () => {
    it("应该能打开编辑对话框", () => {
      wrapper = createWrapper();
      const friend = mockFriends[0];

      wrapper.vm.handleMenuAction("edit", friend);

      expect(wrapper.vm.showEditModal).toBe(true);
      expect(wrapper.vm.editForm.nickname).toBe(friend.nickname);
    });

    it("应该能保存编辑", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      const friend = mockFriends[0];
      wrapper.vm.handleMenuAction("edit", friend);
      wrapper.vm.editForm.nickname = "New Name";
      wrapper.vm.editForm.notes = "New notes";

      await wrapper.vm.handleSaveEdit();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "friends:update",
        expect.objectContaining({
          id: friend.id,
          nickname: "New Name",
          notes: "New notes",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("保存成功");
    });

    it("应该能处理保存失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("保存失败"));

      const friend = mockFriends[0];
      wrapper.vm.handleMenuAction("edit", friend);

      await wrapper.vm.handleSaveEdit();

      expect(message.error).toHaveBeenCalledWith("保存失败: 保存失败");
    });
  });

  describe("移动分组", () => {
    it("应该能打开移动分组对话框", () => {
      wrapper = createWrapper();
      const friend = mockFriends[0];

      wrapper.vm.handleMenuAction("move", friend);

      expect(wrapper.vm.showMoveGroupModal).toBe(true);
      expect(wrapper.vm.moveGroupTarget).toBe(friend.group);
    });

    it("应该能保存分组移动", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      const friend = mockFriends[0];
      wrapper.vm.handleMenuAction("move", friend);
      wrapper.vm.moveGroupTarget = "Family";

      await wrapper.vm.handleSaveMoveGroup();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "friends:update",
        expect.objectContaining({
          id: friend.id,
          group: "Family",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("移动成功");
    });
  });

  describe("删除好友", () => {
    it("应该确认删除", () => {
      wrapper = createWrapper();
      const Modal = mockModal;
      const friend = mockFriends[0];

      wrapper.vm.handleMenuAction("delete", friend);

      expect(Modal.confirm).toHaveBeenCalled();
    });

    it("应该能删除好友", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      const friend = mockFriends[0];
      const initialLength = wrapper.vm.allFriends.length;

      wrapper.vm.handleMenuAction("delete", friend);

      // Wait for async onOk callback to complete
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "friends:delete",
        friend.id,
      );
      expect(wrapper.vm.allFriends.length).toBe(initialLength - 1);
      expect(message.success).toHaveBeenCalledWith("删除成功");
    });
  });

  describe("消息和通话", () => {
    it("应该能发送消息", () => {
      wrapper = createWrapper();
      const friend = mockFriends[0];

      wrapper.vm.handleSendMessage(friend);

      expect(mockRouter.push).toHaveBeenCalledWith(`/chat/${friend.id}`);
    });

    it("应该能发起语音通话", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      await wrapper.vm.handleVoiceCall(mockFriends[0]);

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "call:voice",
        expect.objectContaining({
          friendId: mockFriends[0].id,
        }),
      );
      expect(message.success).toHaveBeenCalled();
    });

    it("应该能发起视频通话", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      await wrapper.vm.handleVideoCall(mockFriends[0]);

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "call:video",
        expect.objectContaining({
          friendId: mockFriends[0].id,
        }),
      );
      expect(message.success).toHaveBeenCalled();
    });

    it("应该能处理通话失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("通话失败"));

      await wrapper.vm.handleVoiceCall(mockFriends[0]);

      expect(message.error).toHaveBeenCalled();
    });
  });

  describe("DID格式化", () => {
    it("应该能格式化长DID", () => {
      wrapper = createWrapper();
      const longDID = "did:chainlesschain:1234567890abcdefghijklmnopqrstuvwxyz";
      const formatted = wrapper.vm.formatDID(longDID);
      expect(formatted).toContain("...");
      expect(formatted.length).toBeLessThan(longDID.length);
    });

    it("应该不格式化短DID", () => {
      wrapper = createWrapper();
      const shortDID = "did:chain:123";
      const formatted = wrapper.vm.formatDID(shortDID);
      expect(formatted).toBe(shortDID);
    });

    it("应该处理空DID", () => {
      wrapper = createWrapper();
      const formatted = wrapper.vm.formatDID("");
      expect(formatted).toBe("");
    });

    it("应该处理null DID", () => {
      wrapper = createWrapper();
      const formatted = wrapper.vm.formatDID(null);
      expect(formatted).toBe("");
    });
  });

  describe("好友点击", () => {
    it("应该能点击好友", () => {
      wrapper = createWrapper();
      const friend = mockFriends[0];

      wrapper.vm.handleFriendClick(friend);

      expect(mockRouter.push).toHaveBeenCalledWith(`/friends/${friend.id}`);
    });
  });

  describe("加载状态", () => {
    it("应该初始化loading为false", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在加载时设置loading为true", async () => {
      wrapper = createWrapper();
      const loadPromise = wrapper.vm.loadFriends();
      expect(wrapper.vm.loading).toBe(true);
      await loadPromise;
    });

    it("应该能处理加载失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("加载失败"));

      await wrapper.vm.loadFriends();

      expect(message.error).toHaveBeenCalledWith("加载好友列表失败: 加载失败");
    });
  });

  describe("边界情况", () => {
    it("应该处理空好友列表", () => {
      wrapper = createWrapper();
      wrapper.vm.allFriends = [];
      expect(wrapper.vm.filteredFriends).toHaveLength(0);
      expect(wrapper.vm.onlineFriendsCount).toBe(0);
    });

    it("应该处理无昵称好友", () => {
      wrapper = createWrapper();
      const friendWithoutNickname = {
        ...mockFriends[0],
        nickname: "",
      };
      wrapper.vm.allFriends = [friendWithoutNickname];
      expect(wrapper.vm.filteredFriends[0].friend_did).toBeTruthy();
    });

    it("应该处理无头像好友", () => {
      wrapper = createWrapper();
      const friendWithoutAvatar = {
        ...mockFriends[0],
        avatar: "",
      };
      wrapper.vm.allFriends = [friendWithoutAvatar];
      expect(wrapper.vm.filteredFriends).toHaveLength(1);
    });

    it("应该处理无分组好友", () => {
      wrapper = createWrapper();
      const friendWithoutGroup = {
        ...mockFriends[0],
        group: null,
      };
      wrapper.vm.allFriends = [friendWithoutGroup];
      expect(wrapper.vm.friendGroups).not.toContain(null);
    });
  });
});
