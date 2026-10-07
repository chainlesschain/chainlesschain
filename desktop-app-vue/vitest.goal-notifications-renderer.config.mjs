import base from "./vitest.business-actions-renderer.config.mjs";

export default {
  ...base,
  test: {
    ...base.test,
    include: [
      ...new Set([
        ...base.test.include,
        "src/renderer/stores/__tests__/goal-notifications.test.ts",
        "src/renderer/stores/__tests__/social.test.ts",
        "src/renderer/components/common/__tests__/goal-notification-list.test.ts",
        "src/renderer/components/projects/__tests__/project-goal-notification-policy-panel.test.ts",
        "src/renderer/components/projects/__tests__/project-goal-notification-drawer.test.ts",
      ]),
    ],
  },
};
