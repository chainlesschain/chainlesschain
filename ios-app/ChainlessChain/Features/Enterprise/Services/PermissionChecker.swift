import Foundation
import SwiftUI

/// 权限检查器
/// 提供便捷的权限检查方法和SwiftUI视图修饰符
public struct PermissionChecker {

    // MARK: - Static Methods

    /// 检查权限（快速方法）
    public static func check(
        _ permission: Permission,
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await RBACManager.shared.checkPermission(
            orgId: orgId,
            userDID: userDID,
            permission: permission
        )
    }

    /// 要求权限（不满足则抛出异常）
    public static func require(
        _ permission: Permission,
        in orgId: String,
        for userDID: String
    ) async throws {
        try await RBACManager.shared.requirePermission(
            orgId: orgId,
            userDID: userDID,
            permission: permission
        )
    }

    /// 检查任一权限
    public static func checkAny(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await RBACManager.shared.checkAnyPermission(
            orgId: orgId,
            userDID: userDID,
            permissions: permissions
        )
    }

    /// 要求任一权限
    public static func requireAny(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws {
        let hasPermission = try await checkAny(
            permissions,
            in: orgId,
            for: userDID
        )

        guard hasPermission else {
            throw PermissionError.insufficientPermissions(permissions)
        }
    }

    /// 检查所有权限
    public static func checkAll(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await RBACManager.shared.checkAllPermissions(
            orgId: orgId,
            userDID: userDID,
            permissions: permissions
        )
    }

    /// 要求所有权限
    public static func requireAll(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws {
        let hasPermissions = try await checkAll(
            permissions,
            in: orgId,
            for: userDID
        )

        guard hasPermissions else {
            throw PermissionError.insufficientPermissions(permissions)
        }
    }

    // MARK: - Batch Checking

    /// 批量检查多个权限
    public static func checkMultiple(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws -> [Permission: Bool] {
        var results: [Permission: Bool] = [:]

        for permission in permissions {
            results[permission] = try await check(
                permission,
                in: orgId,
                for: userDID
            )
        }

        return results
    }

    /// 获取用户拥有的权限
    public static func getGrantedPermissions(
        from permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws -> [Permission] {
        let results = try await checkMultiple(
            permissions,
            in: orgId,
            for: userDID
        )

        return results.filter { $0.value }.map { $0.key }
    }

    /// 获取用户缺少的权限
    public static func getMissingPermissions(
        from permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) async throws -> [Permission] {
        let results = try await checkMultiple(
            permissions,
            in: orgId,
            for: userDID
        )

        return results.filter { !$0.value }.map { $0.key }
    }

    // MARK: - Context-Aware Checking

    /// 检查是否可以管理成员
    public static func canManageMembers(
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await checkAny(
            [.memberManage, .memberInvite, .memberRemove],
            in: orgId,
            for: userDID
        )
    }

    /// 检查是否可以管理角色
    public static func canManageRoles(
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await checkAny(
            [.roleCreate, .roleEdit, .roleDelete, .roleAssign],
            in: orgId,
            for: userDID
        )
    }

    /// 检查是否可以管理知识库
    public static func canManageKnowledge(
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await check(
            .knowledgeAll,
            in: orgId,
            for: userDID
        ) || try await checkAll(
            [.knowledgeCreate, .knowledgeWrite, .knowledgeDelete],
            in: orgId,
            for: userDID
        )
    }

    /// 检查是否可以管理项目
    public static func canManageProjects(
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await check(
            .projectAll,
            in: orgId,
            for: userDID
        ) || try await checkAll(
            [.projectCreate, .projectWrite, .projectDelete],
            in: orgId,
            for: userDID
        )
    }

    /// 检查是否是组织管理员
    public static func isOrgAdmin(
        in orgId: String,
        for userDID: String
    ) async throws -> Bool {
        return try await checkAny(
            [.all, .orgManage],
            in: orgId,
            for: userDID
        )
    }
}

// MARK: - SwiftUI View Modifiers

extension View {
    /// 根据权限显示/隐藏视图
    public func requirePermission(
        _ permission: Permission,
        in orgId: String,
        for userDID: String
    ) -> some View {
        modifier(PermissionModifier(
            permission: permission,
            orgId: orgId,
            userDID: userDID
        ))
    }

    /// 根据任一权限显示/隐藏视图
    public func requireAnyPermission(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) -> some View {
        modifier(AnyPermissionModifier(
            permissions: permissions,
            orgId: orgId,
            userDID: userDID
        ))
    }

    /// 根据所有权限显示/隐藏视图
    public func requireAllPermissions(
        _ permissions: [Permission],
        in orgId: String,
        for userDID: String
    ) -> some View {
        modifier(AllPermissionsModifier(
            permissions: permissions,
            orgId: orgId,
            userDID: userDID
        ))
    }

    /// 如果没有权限则禁用
    public func disableWithoutPermission(
        _ permission: Permission,
        in orgId: String,
        for userDID: String
    ) -> some View {
        modifier(DisableWithoutPermissionModifier(
            permission: permission,
            orgId: orgId,
            userDID: userDID
        ))
    }
}

// MARK: - View Modifiers

/// 权限视图修饰符
private struct PermissionModifier: ViewModifier {
    let permission: Permission
    let orgId: String
    let userDID: String

    @State private var hasPermission = false
    @State private var isLoading = true

    func body(content: Content) -> some View {
        Group {
            if isLoading {
                ProgressView()
            } else if hasPermission {
                content
            } else {
                EmptyView()
            }
        }
        .task {
            await checkPermission()
        }
    }

    private func checkPermission() async {
        isLoading = true
        defer { isLoading = false }

        do {
            hasPermission = try await PermissionChecker.check(
                permission,
                in: orgId,
                for: userDID
            )
        } catch {
            hasPermission = false
        }
    }
}

/// 任一权限视图修饰符
private struct AnyPermissionModifier: ViewModifier {
    let permissions: [Permission]
    let orgId: String
    let userDID: String

    @State private var hasPermission = false
    @State private var isLoading = true

    func body(content: Content) -> some View {
        Group {
            if isLoading {
                ProgressView()
            } else if hasPermission {
                content
            } else {
                EmptyView()
            }
        }
        .task {
            await checkPermissions()
        }
    }

    private func checkPermissions() async {
        isLoading = true
        defer { isLoading = false }

        do {
            hasPermission = try await PermissionChecker.checkAny(
                permissions,
                in: orgId,
                for: userDID
            )
        } catch {
            hasPermission = false
        }
    }
}

/// 所有权限视图修饰符
private struct AllPermissionsModifier: ViewModifier {
    let permissions: [Permission]
    let orgId: String
    let userDID: String

    @State private var hasPermissions = false
    @State private var isLoading = true

    func body(content: Content) -> some View {
        Group {
            if isLoading {
                ProgressView()
            } else if hasPermissions {
                content
            } else {
                EmptyView()
            }
        }
        .task {
            await checkPermissions()
        }
    }

    private func checkPermissions() async {
        isLoading = true
        defer { isLoading = false }

        do {
            hasPermissions = try await PermissionChecker.checkAll(
                permissions,
                in: orgId,
                for: userDID
            )
        } catch {
            hasPermissions = false
        }
    }
}

/// 无权限禁用修饰符
private struct DisableWithoutPermissionModifier: ViewModifier {
    let permission: Permission
    let orgId: String
    let userDID: String

    @State private var hasPermission = false
    @State private var isLoading = true

    func body(content: Content) -> some View {
        content
            .disabled(!hasPermission)
            .opacity(hasPermission ? 1.0 : 0.5)
            .task {
                await checkPermission()
            }
    }

    private func checkPermission() async {
        isLoading = true
        defer { isLoading = false }

        do {
            hasPermission = try await PermissionChecker.check(
                permission,
                in: orgId,
                for: userDID
            )
        } catch {
            hasPermission = false
        }
    }
}

// MARK: - Property Wrappers

/// 权限检查属性包装器
@propertyWrapper
public struct RequirePermission {
    private let permission: Permission
    private let orgId: String
    private let userDID: String
    private var hasPermission: Bool = false

    public var wrappedValue: Bool {
        return hasPermission
    }

    public init(
        _ permission: Permission,
        orgId: String,
        userDID: String
    ) {
        self.permission = permission
        self.orgId = orgId
        self.userDID = userDID
    }

    public mutating func check() async {
        do {
            hasPermission = try await PermissionChecker.check(
                permission,
                in: orgId,
                for: userDID
            )
        } catch {
            hasPermission = false
        }
    }
}
