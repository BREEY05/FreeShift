import clsx, { type ClassValue } from 'clsx';

/** 合并 Tailwind class，支持条件类名 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
