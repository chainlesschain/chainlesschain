/**
 * Pure helpers extracted from OrganizationActivityLogPage.vue (opportunistic
 * split). Action/resource label+color, activity-detail rendering, role label,
 * and relative/full time formatting. Self-contained: extends dayjs with the
 * relativeTime plugin + zh-cn locale on load (idempotent singleton).
 *
 * NOTE: getActorName/getActorAvatar stay in the SFC — they read the reactive
 * member list.
 */
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

export function getActionLabel(action) {
  const labels = {
    add_member: "添加成员",
    remove_member: "移除成员",
    update_member_role: "更新角色",
    create_knowledge: "创建知识库",
    update_knowledge: "更新知识库",
    delete_knowledge: "删除知识库",
    create_project: "创建项目",
    update_project: "更新项目",
    delete_project: "删除项目",
    update_organization: "更新组织",
    create_role: "创建角色",
    update_role: "更新角色",
    delete_role: "删除角色",
    invite_member: "邀请成员",
    leave_organization: "离开组织",
  };
  return labels[action] || action;
}

export function getActionColor(action) {
  const colors = {
    add_member: "green",
    remove_member: "red",
    update_member_role: "blue",
    create_knowledge: "cyan",
    update_knowledge: "blue",
    delete_knowledge: "red",
    create_project: "green",
    update_organization: "orange",
    create_role: "purple",
    invite_member: "geekblue",
  };
  return colors[action] || "default";
}

export function getResourceTypeLabel(resourceType) {
  const labels = {
    member: "成员",
    knowledge: "知识库",
    project: "项目",
    organization: "组织",
    role: "角色",
    invitation: "邀请",
  };
  return labels[resourceType] || resourceType;
}

export function getActivityDetails(activity) {
  try {
    const metadata = JSON.parse(activity.metadata || "{}");

    switch (activity.action) {
      case "add_member":
        return `添加了成员: ${metadata.display_name} (${metadata.role})`;
      case "remove_member":
        return `移除了成员: ${metadata.member_name || activity.resource_id}`;
      case "update_member_role":
        return `将 ${metadata.member_name} 的角色从 ${metadata.old_role} 更改为 ${metadata.new_role}`;
      case "create_knowledge":
        return `创建了知识库: ${metadata.title || ""}`;
      case "update_knowledge":
        return `更新了知识库: ${metadata.title || ""}`;
      case "delete_knowledge":
        return `删除了知识库: ${metadata.title || activity.resource_id}`;
      case "create_project":
        return `创建了项目: ${metadata.name || ""}`;
      case "update_organization":
        return `更新了组织信息`;
      case "create_role":
        return `创建了角色: ${metadata.name || ""}`;
      case "invite_member":
        return `生成了邀请码`;
      default:
        return JSON.stringify(metadata);
    }
  } catch {
    return activity.metadata || "";
  }
}

export function formatRelativeTime(timestamp) {
  return dayjs(timestamp).fromNow();
}

export function formatFullTime(timestamp) {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
}

export function getRoleLabel(role) {
  const labels = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    viewer: "访客",
  };
  return labels[role] || role;
}
