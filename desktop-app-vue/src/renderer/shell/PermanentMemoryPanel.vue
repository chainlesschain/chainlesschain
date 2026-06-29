<template>
  <a-modal
    :open="open"
    :width="980"
    :footer="null"
    :mask-closable="true"
    :body-style="{ padding: '0' }"
    title="永久记忆"
    destroy-on-close
    @update:open="(v) => $emit('update:open', v)"
  >
    <div class="pm-host">
      <PermanentMemoryContent />
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { PermanentMemoryPanel as PermanentMemoryContent } from "@/components/memory";

// prefillText accepted for shell-panel consistency; the hosted component owns
// its full UI and self-loads on mount, so it is not rendered here.
defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();
</script>

<style scoped>
.pm-host {
  height: 72vh;
  overflow: hidden;
}
</style>
