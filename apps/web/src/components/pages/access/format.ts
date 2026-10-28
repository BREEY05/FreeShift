/** 把 epoch 毫秒格式化为 2026/03/02 14:05；缺失时返回破折号 */
export function formatEpochDateTime(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (input: number) => String(input).padStart(2, '0');
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** 相对时间：刚刚 / 3 分钟前 / 2 天前；超过 30 天或缺失返回空字符串 */
export function formatRelative(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const diff = Date.now() - value;
  if (diff < 0) return '';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  const days = Math.floor(hours / 24);
  if (days <= 30) return days + ' 天前';
  return '';
}

/** 邮箱首字母，用作头像占位 */
export function emailInitial(email: string): string {
  const trimmed = email.trim();
  return (trimmed[0] ?? '?').toUpperCase();
}
