<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <GlobalOutlined class="cc-preview-widget__icon" />
      <h3>去中心化社交</h3>
      <p>
        DID 身份 + ActivityPub / Nostr 联邦协议，消息 / 关系 /
        帖子存在本机，账户不可被平台封禁。
      </p>
    </section>

    <dl class="cc-preview-widget__kv">
      <div>
        <dt>身份 DID</dt>
        <dd>{{ hasIdentity ? "已绑定" : "未绑定" }}</dd>
      </div>
      <div>
        <dt>关注 / 粉丝</dt>
        <dd>{{ following }} / {{ followers }}</dd>
      </div>
      <div>
        <dt>协议</dt>
        <dd>ActivityPub + Nostr</dd>
      </div>
    </dl>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openChat"> 打开聊天 </a-button>
      <a-button block @click="openSocialCollab"> 协作文档 </a-button>
      <a-button block @click="openInsights"> 社交洞察 </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { GlobalOutlined } from "@ant-design/icons-vue";

const router = useRouter();
const hasIdentity = ref(false);
const following = ref(0);
const followers = ref(0);

function openChat() {
  router.push({ name: "Chat" }).catch(() => {});
}

function openSocialCollab() {
  router.push("/main/social-collab").catch(() => {});
}

function openInsights() {
  router.push({ name: "SocialInsights" }).catch(() => {});
}
</script>

<style scoped>
.cc-preview-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cc-preview-widget__hero {
  text-align: center;
  padding: 16px 8px 4px;
}

.cc-preview-widget__icon {
  font-size: 32px;
  color: var(--cc-preview-accent);
  margin-bottom: 8px;
}

.cc-preview-widget__hero h3 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-widget__hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cc-preview-text-secondary);
}

.cc-preview-widget__kv {
  margin: 0;
  padding: 10px 12px;
  background: var(--cc-preview-bg-hover);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__kv > div {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.cc-preview-widget__kv dt {
  color: var(--cc-preview-text-secondary);
  margin: 0;
}

.cc-preview-widget__kv dd {
  margin: 0;
  color: var(--cc-preview-text-primary);
  font-weight: 500;
}

.cc-preview-widget__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
