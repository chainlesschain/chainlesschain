/**
 * CoordinateAction 单元测试
 */

import { vi } from 'vitest';

// Alias jest to vi for compatibility
const jest = { fn: vi.fn };

const { CoordinateAction, MouseButton, GestureType } = require('../coordinate-action');

describe('CoordinateAction', () => {
  let mockEngine;
  let mockPage;
  let coordinateAction;

  beforeEach(() => {
    mockPage = {
      mouse: {
        click: jest.fn().mockResolvedValue(undefined),
        move: jest.fn().mockResolvedValue(undefined),
        down: jest.fn().mockResolvedValue(undefined),
        up: jest.fn().mockResolvedValue(undefined),
        wheel: jest.fn().mockResolvedValue(undefined)
      },
      viewportSize: jest.fn().mockReturnValue({ width: 1280, height: 720 }),
      locator: jest.fn().mockReturnValue({
        boundingBox: jest.fn().mockResolvedValue({ x: 100, y: 100, width: 50, height: 30 })
      })
    };

    mockEngine = {
      getPage: jest.fn().mockReturnValue(mockPage)
    };

    coordinateAction = new CoordinateAction(mockEngine);
  });

  describe('clickAt', () => {
    it('should click at specified coordinates', async () => {
      const result = await coordinateAction.clickAt('tab-1', 500, 300);

      expect(mockPage.mouse.click).toHaveBeenCalledWith(500, 300, {
        button: 'left',
        clickCount: 1,
        delay: 0
      });
      expect(result.success).toBe(true);
      expect(result.x).toBe(500);
      expect(result.y).toBe(300);
    });

    it('should support right click', async () => {
      const result = await coordinateAction.clickAt('tab-1', 500, 300, {
        button: MouseButton.RIGHT
      });

      expect(mockPage.mouse.click).toHaveBeenCalledWith(500, 300, {
        button: 'right',
        clickCount: 1,
        delay: 0
      });
      expect(result.button).toBe('right');
    });

    it('should support double click', async () => {
      const result = await coordinateAction.clickAt('tab-1', 500, 300, {
        clickCount: 2
      });

      expect(mockPage.mouse.click).toHaveBeenCalledWith(500, 300, {
        button: 'left',
        clickCount: 2,
        delay: 0
      });
    });
  });

  describe('doubleClickAt', () => {
    it('should double click at coordinates', async () => {
      const result = await coordinateAction.doubleClickAt('tab-1', 500, 300);

      expect(mockPage.mouse.click).toHaveBeenCalledWith(500, 300, expect.objectContaining({
        clickCount: 2
      }));
      expect(result.success).toBe(true);
    });
  });

  describe('rightClickAt', () => {
    it('should right click at coordinates', async () => {
      const result = await coordinateAction.rightClickAt('tab-1', 500, 300);

      expect(mockPage.mouse.click).toHaveBeenCalledWith(500, 300, expect.objectContaining({
        button: 'right'
      }));
      expect(result.success).toBe(true);
    });
  });

  describe('moveTo', () => {
    it('should move mouse to coordinates', async () => {
      const result = await coordinateAction.moveTo('tab-1', 800, 400);

      expect(mockPage.mouse.move).toHaveBeenCalledWith(800, 400);
      expect(result.success).toBe(true);
      expect(result.x).toBe(800);
      expect(result.y).toBe(400);
    });

    it('should support smooth movement', async () => {
      const result = await coordinateAction.moveTo('tab-1', 800, 400, {
        smooth: true,
        steps: 5
      });

      // 5 steps means 5 calls to mouse.move
      expect(mockPage.mouse.move).toHaveBeenCalledTimes(5);
      expect(result.success).toBe(true);
    });
  });

  describe('dragFromTo', () => {
    it('should drag from one point to another', async () => {
      const result = await coordinateAction.dragFromTo(
        'tab-1',
        100, 100,
        500, 500,
        { smooth: false }
      );

      expect(mockPage.mouse.move).toHaveBeenCalled();
      expect(mockPage.mouse.down).toHaveBeenCalled();
      expect(mockPage.mouse.up).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.from).toEqual({ x: 100, y: 100 });
      expect(result.to).toEqual({ x: 500, y: 500 });
    });
  });

  describe('gesture', () => {
    it('should execute swipe up gesture', async () => {
      const result = await coordinateAction.gesture('tab-1', GestureType.SWIPE_UP, {
        distance: 200
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('drag');
    });

    it('should execute swipe down gesture', async () => {
      const result = await coordinateAction.gesture('tab-1', GestureType.SWIPE_DOWN);

      expect(result.success).toBe(true);
    });

    it('should throw for unknown gesture', async () => {
      await expect(
        coordinateAction.gesture('tab-1', 'unknown_gesture')
      ).rejects.toThrow('Unknown gesture');
    });
  });

  describe('scrollAt', () => {
    it('should scroll at specified coordinates', async () => {
      const result = await coordinateAction.scrollAt('tab-1', 500, 300, 0, 200);

      expect(mockPage.mouse.move).toHaveBeenCalledWith(500, 300);
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 200);
      expect(result.success).toBe(true);
    });
  });

  describe('drawPath', () => {
    it('should draw a path', async () => {
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 150 },
        { x: 300, y: 100 }
      ];

      const result = await coordinateAction.drawPath('tab-1', points);

      expect(mockPage.mouse.down).toHaveBeenCalled();
      expect(mockPage.mouse.move).toHaveBeenCalledTimes(3); // start + 2 moves
      expect(mockPage.mouse.up).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.pointsCount).toBe(3);
    });

    it('should throw for insufficient points', async () => {
      await expect(
        coordinateAction.drawPath('tab-1', [{ x: 100, y: 100 }])
      ).rejects.toThrow('At least 2 points required');
    });
  });

  describe('getElementCenter', () => {
    it('should return element center coordinates', async () => {
      const result = await coordinateAction.getElementCenter('tab-1', '#button');

      expect(result.x).toBe(125); // 100 + 50/2
      expect(result.y).toBe(115); // 100 + 30/2
    });
  });

  describe('ratioToCoordinate', () => {
    it('should convert ratio to coordinates', async () => {
      const result = await coordinateAction.ratioToCoordinate('tab-1', 0.5, 0.5);

      expect(result.x).toBe(640); // 1280 * 0.5
      expect(result.y).toBe(360); // 720 * 0.5
    });
  });

  describe('execute', () => {
    it('should route to correct action', async () => {
      const clickResult = await coordinateAction.execute('tab-1', {
        action: 'click',
        x: 500,
        y: 300
      });
      expect(clickResult.success).toBe(true);

      const moveResult = await coordinateAction.execute('tab-1', {
        action: 'move',
        x: 800,
        y: 400
      });
      expect(moveResult.success).toBe(true);
    });

    it('should throw for unknown action', async () => {
      await expect(
        coordinateAction.execute('tab-1', { action: 'unknown' })
      ).rejects.toThrow('Unknown coordinate action');
    });
  });

  describe('getMousePosition', () => {
    it('should return current mouse position', () => {
      coordinateAction.mousePosition = { x: 100, y: 200 };
      const pos = coordinateAction.getMousePosition();

      expect(pos).toEqual({ x: 100, y: 200 });
    });
  });
});
