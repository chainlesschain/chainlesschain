import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "../ProjectRiskReviewPanel.vue";
function review(id = "r1", projectId = "p1") {
  return {
    review: { id, projectId, createdAt: "2026-10-06T00:00:00.000Z" },
    evaluation: {
      status: "evaluated",
      asOf: "2026-10-06T00:00:00.000Z",
      summary: { taskCount: 1, riskTaskCount: 1 },
      reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
      tasks: [
        { taskRef: { id: "t1" }, reasonCodes: ["OVERDUE_INCOMPLETE_TASK"] },
      ],
    },
  };
}
function lineage() {
  return {
    review: review().review,
    actionRuns: [],
    feedback: [],
    nextCursor: null,
    nextFeedbackCursor: null,
  };
}
describe("risk review history and human correction panel", () => {
  let wrapper: VueWrapper, api: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      listRiskReviews: vi.fn(async () => ({
        reviews: [
          { ...review(), status: "evaluated", summary: { riskTaskCount: 1 } },
        ],
        nextCursor: null,
      })),
      getRiskReview: vi.fn(async () => ({
        ...review(),
        sourceSnapshot: { secret: "hidden-source" },
      })),
      getRiskLineage: vi.fn(async () => lineage()),
      recordRiskFeedback: vi.fn(async () => ({})),
    };
    (window as any).electronAPI = { project: api };
    wrapper = mount(Panel, {
      props: { projectId: "p1", identityKey: "owner", review: review() },
    });
  });
  afterEach(() => {
    wrapper.unmount();
    delete (window as any).electronAPI;
  });
  it("shows rule facts while exposing independent history and correction controls", () => {
    expect(wrapper.text()).toContain("1 个任务");
    expect(wrapper.find('[data-testid="risk-history"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("人工判断单独保存");
    expect(wrapper.text()).toContain("补充任务描述不会消除");
  });
  it("selects an authorized historical review without retaining the source snapshot", async () => {
    await wrapper.get('[data-testid="risk-history"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-review-id="r1"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("review")![0][0]).toEqual(review());
    expect(wrapper.text()).not.toContain("hidden-source");
  });
  it("does not accept a historical review for another project", async () => {
    api.getRiskReview.mockResolvedValue(review("r1", "p2"));
    await wrapper.get('[data-testid="risk-history"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-review-id="r1"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("review")![0][0]).toBeNull();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it("saves dismissal as empty corrected reasons and refreshes the persisted evidence", async () => {
    const selects = wrapper.findAll("select");
    await selects[0].setValue("t1");
    await selects[1].setValue("dismissed");
    await wrapper
      .get('[data-testid="risk-feedback-comment"]')
      .setValue("Deadline revised");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.recordRiskFeedback).toHaveBeenCalledWith({
      reviewId: "r1",
      taskId: "t1",
      verdict: "dismissed",
      reasonCodes: [],
      comment: "Deadline revised",
    });
    expect(api.getRiskLineage).toHaveBeenCalledWith({
      reviewId: "r1",
      limit: 10,
    });
    expect(wrapper.text()).toContain("模型费用：未知");
  });
  it("prevents duplicate submission after uncertain transport until evidence is read", async () => {
    api.recordRiskFeedback.mockRejectedValue(new Error("connection lost"));
    await wrapper.findAll("select")[0].setValue("t1");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(
      wrapper.get('[data-testid="save-risk-feedback"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.text()).toContain("待核实");
    await wrapper.get('[data-testid="risk-lineage"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.get('[data-testid="save-risk-feedback"]').attributes("disabled"),
    ).toBeUndefined();
  });
  it("limits feedback by UTF-8 bytes", async () => {
    await wrapper.findAll("select")[0].setValue("t1");
    await wrapper
      .get('[data-testid="risk-feedback-comment"]')
      .setValue("中".repeat(1400));
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.recordRiskFeedback).not.toHaveBeenCalled();
  });
  it("discards a late history result after changing identity", async () => {
    let resolve!: (value: unknown) => void;
    api.listRiskReviews.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    await wrapper.get('[data-testid="risk-history"]').trigger("click");
    await wrapper.setProps({ identityKey: "different-owner" });
    resolve({
      reviews: [{ ...review(), status: "evaluated" }],
      nextCursor: null,
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="risk-history-list"]').exists()).toBe(
      false,
    );
  });
  it("clears old linked evidence after a new review and discards late lineage", async () => {
    let resolve!: (value: unknown) => void;
    api.getRiskLineage.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    await wrapper.get('[data-testid="risk-lineage"]').trigger("click");
    await wrapper.setProps({ review: review("r2") });
    resolve(lineage());
    await flushPromises();
    expect(wrapper.find('[data-testid="risk-lineage-result"]').exists()).toBe(
      false,
    );
  });
  it("clears history and signals the parent on revoked authorization", async () => {
    await wrapper.get('[data-testid="risk-history"]').trigger("click");
    await flushPromises();
    api.getRiskLineage.mockRejectedValue(
      new Error("PROJECT_RISK_NOT_FOUND_OR_DENIED"),
    );
    await wrapper.get('[data-testid="risk-lineage"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="risk-history-list"]').exists()).toBe(
      false,
    );
    expect(wrapper.emitted("review")![0][0]).toBeNull();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
});
