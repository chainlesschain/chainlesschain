import Foundation

/// 虚拟光标位置 — Phase 6.6.2 (sub-phase 2 of 6)。
///
/// 实现 Phase 6.6 doc §4.3 OQ-4 选项 A：iOS 端维护"虚拟光标"绝对坐标，touch
/// drag delta 通过 [applyDelta] 累加并 clamp 到屏幕边界，最终发出绝对坐标
/// 给桌面 `desktop.sendInput(mouse_move, {x, y})`（桌面 robotjs.moveMouse 是
/// 绝对坐标）。
///
/// **用法**：
/// 1. `startSession` 后调 `display.getDisplays` 拉显示器分辨率 → [setScreen]
/// 2. 调 `display.getCursorPosition` 拉桌面当前真实 cursor → [reset]
/// 3. 用户触摸 drag 每 delta → [applyDelta] → 发 sendInput
/// 4. 周期性 (5s) 重 调 `display.getCursorPosition` 校准（Trap D3 防漂移）
/// 5. `switchDisplay` 完成后重 [setScreen] + [reset] (Trap D10)
///
/// **状态边界**：
/// - x ∈ [0, screenWidth - 1]
/// - y ∈ [0, screenHeight - 1]
/// - 累加 delta 时 clamp 到边界（不越界）
/// - `setScreen` 缩小后 clamp 当前 x/y 到新边界内
///
/// **不暴露** screen / 当前 x/y 直接 setter — caller 应通过 reset/setScreen/
/// applyDelta API 操作，避免状态不一致。read-only `position()` / `screen()` 用
/// 于 UI 显示和测试。
public actor DesktopVirtualCursor {

    private var x: Int = 0
    private var y: Int = 0
    private var screenWidth: Int = 1920
    private var screenHeight: Int = 1080

    public init(initialWidth: Int = 1920, initialHeight: Int = 1080,
                initialX: Int = 0, initialY: Int = 0) {
        self.screenWidth = max(1, initialWidth)
        self.screenHeight = max(1, initialHeight)
        self.x = Self.clamp(initialX, min: 0, max: self.screenWidth - 1)
        self.y = Self.clamp(initialY, min: 0, max: self.screenHeight - 1)
    }

    /// 重置光标到指定绝对坐标（用于 startSession / switchDisplay 后从
    /// `display.getCursorPosition` 拉真实位置初始化 / 周期校准）。
    /// 越界值自动 clamp。
    public func reset(toX: Int, toY: Int) {
        x = Self.clamp(toX, min: 0, max: screenWidth - 1)
        y = Self.clamp(toY, min: 0, max: screenHeight - 1)
    }

    /// 更新屏幕尺寸（用于 startSession 拉 displays / switchDisplay 后调用）。
    /// 若新屏小于当前光标位置，光标 clamp 到新边界。
    public func setScreen(width: Int, height: Int) {
        guard width > 0 && height > 0 else { return }
        screenWidth = width
        screenHeight = height
        x = Self.clamp(x, min: 0, max: width - 1)
        y = Self.clamp(y, min: 0, max: height - 1)
    }

    /// 应用 touch drag delta，返新绝对坐标 (clamped 到屏幕边界)。
    public func applyDelta(dx: Int, dy: Int) -> (x: Int, y: Int) {
        x = Self.clamp(x + dx, min: 0, max: screenWidth - 1)
        y = Self.clamp(y + dy, min: 0, max: screenHeight - 1)
        return (x, y)
    }

    /// 当前光标位置（绝对坐标）。
    public func position() -> (x: Int, y: Int) {
        return (x, y)
    }

    /// 当前屏幕尺寸。
    public func screen() -> (width: Int, height: Int) {
        return (screenWidth, screenHeight)
    }

    private static func clamp(_ value: Int, min lower: Int, max upper: Int) -> Int {
        if value < lower { return lower }
        if value > upper { return upper }
        return value
    }
}
