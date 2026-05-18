/**
 * Helper for ant-design-vue mocking in tests
 * Use vi.hoisted to ensure mocks are available before vi.mock runs
 */
import { vi } from 'vitest';

// Create hoisted mocks for ant-design-vue
export const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  destroy: vi.fn(),
}));

export const mockModal = vi.hoisted(() => ({
  confirm: vi.fn((options) => {
    if (options?.onOk) {
      Promise.resolve().then(() => options.onOk());
    }
    return { destroy: vi.fn() };
  }),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  destroyAll: vi.fn(),
}));

export const mockNotification = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  open: vi.fn(),
  destroy: vi.fn(),
}));

// Use this to mock ant-design-vue in your test file:
// vi.mock('ant-design-vue', () => ({
//   message: mockMessage,
//   Modal: mockModal,
//   notification: mockNotification,
// }));
