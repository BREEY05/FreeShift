import { BarChart3, Building2, Clock3, KeyRound, LayoutGrid, Settings, Sparkles, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  end?: boolean;
  /** 仅管理员可见（访问授权） */
  adminOnly?: boolean;
}

/** 全局导航：总览 / 用户 / 时间段 / 推荐 / 统计 / 组织 / 设置；访问授权仅管理员可见 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '总览', description: '聚合空闲视图', icon: LayoutGrid, end: true },
  { to: '/users', label: '用户', description: '成员与颜色', icon: Users },
  { to: '/slots', label: '时间段', description: '模板与节次', icon: Clock3 },
  { to: '/recommend', label: '推荐', description: '共同空闲与加权', icon: Sparkles },
  { to: '/stats', label: '统计', description: '公平性与负载', icon: BarChart3 },
  { to: '/org', label: '组织', description: '成员与邀请码', icon: Building2 },
  { to: '/settings', label: '设置', description: '学期与数据', icon: Settings },
  { to: '/access', label: '访问授权', description: '登录邮箱名单', icon: KeyRound, adminOnly: true },
];

/** 按当前角色过滤导航：非管理员不显示访问授权 */
export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}
