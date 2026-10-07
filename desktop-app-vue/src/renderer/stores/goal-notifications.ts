import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useAppStore } from "./app";
import { useIdentityStore } from "./identity";

const SCHEMA = "chainlesschain.goal-notice-ref/v1";
interface GoalNotice {
  id: string;
  isRead: boolean;
  createdAt: number;
  sourceVersion: string;
}
interface GoalNoticeTarget {
  goalId: string;
  projectId: string;
  storeId: string;
  sourceVersion: string;
}
const api = () => (window as any).electronAPI?.notification;

// SQLite is canonical; no localStorage, copied Goal text or OS notifications.
export const useGoalNotificationsStore = defineStore(
  "goalNotifications",
  () => {
    const app = useAppStore();
    const identity = useIdentityStore();
    const notices = ref<GoalNotice[]>([]);
    const loading = ref(false);
    const error = ref("");
    const unreadCount = computed(
      () => notices.value.filter((item) => !item.isRead).length,
    );
    let epoch = 0,
      readEpoch = 0,
      mutationEpoch = 0;
    let users = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | undefined;

    function reset() {
      epoch++;
      readEpoch++;
      mutationEpoch++;
      notices.value = [];
      loading.value = false;
      error.value = "";
    }
    let authentication = app.isAuthenticated,
      deviceId = app.deviceId;
    // Observe option-store mutations through Pinia's own subscription boundary.
    // A logout/login in one turn must advance the epoch even when the final DID
    // and device match the old session. Reading state only after await is too late.
    app.$subscribe(
      (_mutation, state) => {
        if (
          state.isAuthenticated !== authentication ||
          state.deviceId !== deviceId
        ) {
          authentication = state.isAuthenticated;
          deviceId = state.deviceId;
          reset();
        }
      },
      { flush: "sync" },
    );
    watch(
      () => [
        identity.primaryDID,
        identity.currentContext,
        identity.currentIdentity.localDB,
      ],
      reset,
      { flush: "sync" },
    );
    const current = (stamp: number) => stamp === epoch && app.isAuthenticated;

    async function load() {
      if (!app.isAuthenticated || !api()?.getGoals) {
        reset();
        return;
      }
      const stamp = epoch,
        read = ++readEpoch;
      loading.value = true;
      error.value = "";
      notices.value = [];
      try {
        const result = await api().getGoals({ limit: 50 });
        if (!current(stamp) || read !== readEpoch) return;
        if (result?.success !== true || !Array.isArray(result.notifications))
          throw new Error("GOAL_NOTICE_READ_FAILED");
        const next = result.notifications.map((row: any): GoalNotice => {
          const data =
            typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (
            data?.schema !== SCHEMA ||
            data.eventId !== row.id ||
            typeof row.id !== "string" ||
            !Number.isSafeInteger(row.created_at) ||
            ![0, 1].includes(row.is_read) ||
            typeof data.sourceVersion !== "string"
          )
            throw new Error("GOAL_NOTICE_INVALID_PROJECTION");
          return {
            id: row.id,
            isRead: row.is_read === 1,
            createdAt: row.created_at,
            sourceVersion: data.sourceVersion,
          };
        });
        notices.value = next;
      } catch {
        if (!current(stamp) || read !== readEpoch) return;
        reset();
        error.value = "目标通知暂不可读取，已清除旧通知。";
      } finally {
        if (current(stamp) && read === readEpoch) loading.value = false;
      }
    }
    async function markRead(id: string): Promise<boolean> {
      if (!app.isAuthenticated) {
        reset();
        return false;
      }
      const stamp = epoch,
        mutation = ++mutationEpoch;
      readEpoch++;
      loading.value = false;
      try {
        const result = await api()?.markRead(id);
        if (!current(stamp) || mutation !== mutationEpoch) return false;
        if (result?.success !== true)
          throw new Error("GOAL_NOTICE_MARK_FAILED");
        const notice = notices.value.find((item) => item.id === id);
        if (notice) notice.isRead = true;
        return true;
      } catch {
        if (current(stamp) && mutation === mutationEpoch) {
          reset();
          error.value = "目标通知已失效或权限已变化，请刷新。";
        }
        return false;
      }
    }
    async function open(id: string): Promise<GoalNoticeTarget | null> {
      if (!app.isAuthenticated) {
        reset();
        return null;
      }
      const stamp = epoch;
      try {
        const result = await api()?.openGoal(id);
        if (!current(stamp)) return null;
        const target = result?.target;
        if (
          result?.success !== true ||
          !target ||
          ![
            target.goalId,
            target.projectId,
            target.storeId,
            target.sourceVersion,
          ].every((item) => typeof item === "string" && item.length > 0)
        )
          throw new Error("GOAL_NOTICE_OPEN_FAILED");
        if (!(await markRead(id)) || !current(stamp)) return null;
        const checked = await api().openGoal(id);
        if (
          !current(stamp) ||
          checked?.success !== true ||
          JSON.stringify(checked.target) !== JSON.stringify(target)
        ) {
          if (current(stamp)) {
            reset();
            error.value = "通知来源已变化，请刷新后重试。";
          }
          return null;
        }
        return target;
      } catch {
        if (current(stamp)) {
          reset();
          error.value = "目标通知已失效或权限已变化，请刷新。";
        }
        return null;
      }
    }
    function attach() {
      if (++users === 1) {
        unsubscribe = api()?.onInvalidated?.(() => reset());
        timer = setInterval(() => {
          void load();
        }, 5000);
        void load();
      }
      return () => {
        if (--users === 0) {
          if (timer) clearInterval(timer);
          timer = null;
          unsubscribe?.();
          unsubscribe = undefined;
          reset();
        }
      };
    }
    return {
      notices,
      loading,
      error,
      unreadCount,
      reset,
      load,
      markRead,
      open,
      attach,
    };
  },
);
