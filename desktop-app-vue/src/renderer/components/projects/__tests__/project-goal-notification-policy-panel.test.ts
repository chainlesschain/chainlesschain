import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectGoalNotificationPolicyPanel.vue";
const goal = {
  id: "g1",
  revision: 4,
  notificationPolicy: {
    channel: "in-app" as const,
    mode: "changes-only" as const,
    quietHours: null,
  },
};
function deferred() {
  let resolve!: (value: any) => void, reject!: (value: unknown) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("personal goal notification policy editing", () => {
  let wrapper: VueWrapper, reviseGoal: ReturnType<typeof vi.fn>;
  const get = (id: string) =>
    wrapper.get(`[data-testid="goal-notification-${id}"]`);
  async function submit() {
    await wrapper.get("form").trigger("submit");
    await flushPromises();
  }
  async function quiet(
    timeZone = "Asia/Shanghai",
    start = "22:30",
    end = "08:15",
  ) {
    await get("quiet-enabled").setValue(true);
    await get("time-zone").setValue(timeZone);
    await get("start").setValue(start);
    await get("end").setValue(end);
  }
  beforeEach(() => {
    reviseGoal = vi.fn(async (input) => ({
      ...goal,
      revision: 5,
      notificationPolicy: input.patch.notificationPolicy,
    }));
    (window as any).electronAPI = { project: { reviseGoal } };
    wrapper = mount(Panel, { props: { goal, identityKey: "owner" } });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  it("loads the saved policy without a write and only saves explicitly", async () => {
    expect((get("mode").element as HTMLSelectElement).value).toBe(
      "changes-only",
    );
    await get("mode").setValue("silent");
    expect(reviseGoal).not.toHaveBeenCalled();
    await submit();
    expect(reviseGoal).toHaveBeenCalledExactlyOnceWith({
      id: "g1",
      expectedRevision: 4,
      patch: {
        notificationPolicy: {
          channel: "in-app",
          mode: "silent",
          quietHours: null,
        },
      },
    });
    expect(wrapper.emitted("goal-changed")).toHaveLength(1);
    expect(wrapper.text()).toContain("通知设置已保存");
    await submit();
    expect(reviseGoal).toHaveBeenCalledTimes(1);
  });
  it("saves a named-zone overnight quiet period as minutes", async () => {
    await quiet();
    await submit();
    expect(reviseGoal.mock.calls[0][0].patch.notificationPolicy).toEqual({
      channel: "in-app",
      mode: "changes-only",
      quietHours: {
        timeZone: "Asia/Shanghai",
        startMinute: 1350,
        endMinute: 495,
      },
    });
  });
  it("accepts DST-observing zones without converting wall-clock minutes into offsets", async () => {
    await quiet("America/New_York", "01:30", "03:30");
    await submit();
    expect(
      reviseGoal.mock.calls[0][0].patch.notificationPolicy.quietHours,
    ).toEqual({
      timeZone: "America/New_York",
      startMinute: 90,
      endMinute: 210,
    });
  });
  it("loads saved quiet hours and removes them explicitly", async () => {
    await wrapper.setProps({
      goal: {
        ...goal,
        revision: 5,
        notificationPolicy: {
          channel: "in-app",
          mode: "silent",
          quietHours: {
            timeZone: "Europe/London",
            startMinute: 5,
            endMinute: 1439,
          },
        },
      },
    });
    expect((get("time-zone").element as HTMLInputElement).value).toBe(
      "Europe/London",
    );
    expect((get("start").element as HTMLInputElement).value).toBe("00:05");
    expect((get("end").element as HTMLInputElement).value).toBe("23:59");
    await get("quiet-enabled").setValue(false);
    await get("mode").setValue("changes-only");
    await submit();
    expect(reviseGoal.mock.calls[0][0]).toEqual({
      id: "g1",
      expectedRevision: 5,
      patch: {
        notificationPolicy: {
          channel: "in-app",
          mode: "changes-only",
          quietHours: null,
        },
      },
    });
  });
  it.each(["Not/A_Zone", "UTC+08:00", "", "Asia/Shanghai<script>"])(
    "rejects invalid IANA timezone %s locally",
    async (zone) => {
      await quiet(zone);
      await submit();
      expect(reviseGoal).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("请填写有效的时区和时间");
    },
  );
  it.each([
    ["08:00", "08:00"],
    ["", "08:00"],
    ["22:00", ""],
  ])("rejects invalid quiet interval %s–%s", async (start, end) => {
    await quiet("UTC", start, end);
    await submit();
    expect(reviseGoal).not.toHaveBeenCalled();
  });
  it("keeps optional quiet hours when saving silent mode", async () => {
    await quiet();
    await get("mode").setValue("silent");
    await submit();
    expect(reviseGoal.mock.calls[0][0].patch.notificationPolicy).toMatchObject({
      mode: "silent",
      quietHours: { timeZone: "Asia/Shanghai" },
    });
  });
  it("prevents double submits while awaiting the native revision result", async () => {
    const pending = deferred();
    reviseGoal.mockReturnValue(pending.promise);
    await submit();
    await submit();
    expect(reviseGoal).toHaveBeenCalledTimes(1);
    expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
    pending.resolve({ ...goal, revision: 5 });
    await flushPromises();
  });
  it.each(["identity", "revision", "goal"])(
    "clears the draft and discards late success after %s changes",
    async (change) => {
      const pending = deferred();
      reviseGoal.mockReturnValue(pending.promise);
      await quiet("Pacific/Auckland");
      await get("mode").setValue("silent");
      await submit();
      await wrapper.setProps(
        change === "identity"
          ? { identityKey: "other" }
          : {
              goal: {
                ...goal,
                ...(change === "revision" ? { revision: 5 } : { id: "g2" }),
              },
            },
      );
      expect((get("mode").element as HTMLSelectElement).value).toBe(
        "changes-only",
      );
      expect(
        wrapper.find('[data-testid="goal-notification-time-zone"]').exists(),
      ).toBe(false);
      pending.resolve({ ...goal, revision: 5 });
      await flushPromises();
      expect(wrapper.emitted("goal-changed")).toBeUndefined();
      expect(wrapper.text()).not.toContain("通知设置已保存");
      expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined();
    },
  );
  it("discards late authority errors after identity changes", async () => {
    const pending = deferred();
    reviseGoal.mockReturnValue(pending.promise);
    await submit();
    await wrapper.setProps({ identityKey: "other" });
    pending.reject(new Error("GOAL_NOT_FOUND_OR_DENIED"));
    await flushPromises();
    expect(wrapper.emitted("authority-error")).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("clears and disables drafts on an authoritative denial", async () => {
    reviseGoal.mockRejectedValue(new Error("GOAL_NOT_FOUND_OR_DENIED"));
    await quiet();
    await submit();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(
      wrapper.find('[data-testid="goal-notification-time-zone"]').exists(),
    ).toBe(false);
    expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
    await submit();
    expect(reviseGoal).toHaveBeenCalledTimes(1);
  });
  it.each(["GOAL_REVISION_CONFLICT", "transport timeout"])(
    "requests refreshed state after %s and does not blindly retry",
    async (reason) => {
      reviseGoal.mockRejectedValue(new Error(reason));
      await submit();
      expect(wrapper.emitted("goal-changed")).toHaveLength(1);
      expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
      await submit();
      expect(reviseGoal).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ goal: { ...goal, revision: 5 } });
      expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    },
  );
  it("never claims success for another goal or an unchanged version", async () => {
    reviseGoal.mockResolvedValue({ ...goal, id: "other-goal", revision: 5 });
    await submit();
    expect(wrapper.text()).toContain("保存结果待核对");
    expect(wrapper.text()).not.toContain("通知设置已保存");
  });
  it("never claims success when the returned policy differs from the submitted policy", async () => {
    reviseGoal.mockResolvedValue({ ...goal, revision: 5 });
    await get("mode").setValue("silent");
    await submit();
    expect(wrapper.text()).toContain("保存结果待核对");
    expect(wrapper.text()).not.toContain("通知设置已保存");
  });
  it("unlocks after an authoritative same-version refresh following a failed save", async () => {
    reviseGoal.mockRejectedValue(new Error("transport timeout"));
    await submit();
    expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
    await wrapper.setProps({ goal: { ...goal } });
    expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined();
  });
  it("does not emit a completion after unmount", async () => {
    const pending = deferred();
    reviseGoal.mockReturnValue(pending.promise);
    await submit();
    wrapper.unmount();
    pending.resolve({ ...goal, revision: 5 });
    await flushPromises();
    expect(wrapper.emitted("goal-changed")).toBeUndefined();
  });
  it("explains missing native support without issuing a write", async () => {
    wrapper.unmount();
    (window as any).electronAPI = { project: {} };
    wrapper = mount(Panel, { props: { goal, identityKey: "owner" } });
    await submit();
    expect(wrapper.text()).toContain("当前环境暂不支持");
    expect(reviseGoal).not.toHaveBeenCalled();
  });
});
