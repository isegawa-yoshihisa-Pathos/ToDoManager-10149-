/** 一覧・タブなど「表示用」の短縮に使う既定の最大文字数 */
export const DISPLAY_ELLIPSIS_MAX_CHARS = 10;

/** タスク一覧のタイトル表示で許容する最大文字数 */
export const TASK_TITLE_DISPLAY_MAX_CHARS = 60;

export function displayEllipsis(
  value: string | null | undefined,
  maxLength = DISPLAY_ELLIPSIS_MAX_CHARS,
): string {
  const s = value == null ? '' : String(value);
  if (s.length <= maxLength) {
    return s;
  }
  return `${s.slice(0, maxLength)}...`;
}

export function isDisplayTruncated(
  value: string | null | undefined,
  maxLength = DISPLAY_ELLIPSIS_MAX_CHARS,
): boolean {
  return String(value ?? '').length > maxLength;
}
