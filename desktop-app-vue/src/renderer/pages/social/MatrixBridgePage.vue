<template>
  <div class="matrix-bridge-page">
    <a-page-header
      title="Matrix Bridge"
      sub-title="E2EE messaging via Matrix protocol"
    >
      <template #extra>
        <a-space>
          <a-tag v-if="store.isLoggedIn" color="green">
            {{ store.userId }}
          </a-tag>
          <a-button
            v-if="!store.isLoggedIn"
            type="primary"
            @click="showLoginModal = true"
          >
            Login
          </a-button>
          <a-button v-else @click="showJoinModal = true"> Join Room </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Rooms" :value="store.roomCount" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Encrypted Rooms"
          :value="store.encryptedRooms.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Status" :value="store.loginState" />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="rooms" tab="Rooms">
        <a-empty
          v-if="store.rooms.length === 0"
          description="No rooms joined"
        />
        <a-list v-else :data-source="store.rooms" item-layout="horizontal">
          <template #renderItem="{ item }">
            <a-list-item @click="selectRoom(item.room_id)">
              <a-list-item-meta
                :title="item.name || item.room_id"
                :description="item.topic || 'No topic'"
              />
              <template #actions>
                <a-tag v-if="item.is_encrypted" color="green"> E2EE </a-tag>
                <span>{{ item.member_count }} members</span>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="chat" tab="Chat">
        <a-card v-if="selectedRoom" size="small">
          <template #title>
            {{ selectedRoom }}
          </template>
          <div
            class="messages-container"
            style="max-height: 400px; overflow-y: auto; margin-bottom: 16px"
          >
            <a-empty
              v-if="store.messages.length === 0"
              description="No messages"
            />
            <div
              v-for="msg in store.messages"
              :key="msg.id"
              style="margin-bottom: 8px"
            >
              <strong>{{ msg.sender }}:</strong>
              {{
                msg.decrypted_content?.body ||
                msg.content?.body ||
                "[encrypted]"
              }}
            </div>
          </div>
          <a-input-search
            v-model:value="newMessage"
            placeholder="Type a message..."
            enter-button="Send"
            :loading="store.loading"
            @search="handleSendMessage"
          />
        </a-card>
        <a-empty v-else description="Select a room to chat" />
      </a-tab-pane>
    </a-tabs>

    <!-- Login Modal -->
    <a-modal
      v-model:open="showLoginModal"
      title="Matrix Login"
      :confirm-loading="store.loading"
      @ok="handleLogin"
    >
      <a-form layout="vertical">
        <a-form-item label="Homeserver">
          <a-input
            v-model:value="loginForm.homeserver"
            placeholder="https://matrix.org"
          />
        </a-form-item>
        <a-form-item label="User ID">
          <a-input
            v-model:value="loginForm.userId"
            placeholder="@user:matrix.org"
          />
        </a-form-item>
        <a-form-item label="Password">
          <a-input-password v-model:value="loginForm.password" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Join Room Modal -->
    <a-modal
      v-model:open="showJoinModal"
      title="Join Room"
      :confirm-loading="store.loading"
      @ok="handleJoinRoom"
    >
      <a-form layout="vertical">
        <a-form-item label="Room ID or Alias">
          <a-input
            v-model:value="joinRoomId"
            placeholder="#room:matrix.org or !roomid:matrix.org"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useMatrixBridgeStore } from "../../stores/matrixBridge";

const store = useMatrixBridgeStore();
const activeTab = ref("rooms");
const showLoginModal = ref(false);
const showJoinModal = ref(false);
const selectedRoom = ref<string | null>(null);
const newMessage = ref("");
const joinRoomId = ref("");
const loginForm = ref({
  homeserver: "https://matrix.org",
  userId: "",
  password: "",
});

function selectRoom(roomId: string) {
  selectedRoom.value = roomId;
  activeTab.value = "chat";
  store.fetchMessages(roomId);
}

async function handleLogin() {
  if (!loginForm.value.userId || !loginForm.value.password) {
    message.warning("User ID and password are required");
    return;
  }
  const { homeserver, userId, password } = loginForm.value;
  const result = await store.login(homeserver, userId, password);
  if (result.success) {
    message.success("Logged in");
    showLoginModal.value = false;
    await store.fetchRooms();
  } else {
    message.error(result.error || "Login failed");
  }
}

async function handleJoinRoom() {
  if (!joinRoomId.value) {
    message.warning("Room ID is required");
    return;
  }
  const result = await store.joinRoom(joinRoomId.value);
  if (result.success) {
    message.success("Joined room");
    showJoinModal.value = false;
    joinRoomId.value = "";
  } else {
    message.error(result.error || "Join failed");
  }
}

async function handleSendMessage() {
  if (!newMessage.value || !selectedRoom.value) {
    return;
  }
  const result = await store.sendMessage(selectedRoom.value, newMessage.value);
  if (result.success) {
    newMessage.value = "";
  } else {
    message.error(result.error || "Send failed");
  }
}

onMounted(async () => {
  if (store.isLoggedIn) {
    await store.fetchRooms();
  }
});
</script>

<style lang="less" scoped>
.matrix-bridge-page {
  padding: 24px;
}
</style>
