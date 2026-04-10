/** 既定プライベートタブ */
export const TAB_KEY_PRIVATE_DEFAULT = 'pd';

export function tabKeyPrivateList(listId: string): string {
  return `pl:${listId}`;
}

export function tabKeyProject(projectId: string): string {
  return `p:${projectId}`;
}

function sortAppendedKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const rank = (k: string) =>
      k === TAB_KEY_PRIVATE_DEFAULT ? 0 : k.startsWith('pl:') ? 1 : 2;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) {
      return ra - rb;
    }
    return a.localeCompare(b);
  });
}

/** Firestore に保存した順を優先し、未登録のタブは既定順で末尾に追加する */
export function mergeTabKeys(storedOrder: string[], allKeys: Set<string>): string[] {
  const result: string[] = [];
  const used = new Set<string>();
  for (const k of storedOrder) {
    if (allKeys.has(k) && !used.has(k)) {
      result.push(k);
      used.add(k);
    }
  }
  const missing = [...allKeys].filter((k) => !used.has(k));
  result.push(...sortAppendedKeys(missing));
  return result;
}

/** 半角英数字のみ（プロジェクトID） */
export function isValidProjectIdChars(id: string): boolean {
  return /^[A-Za-z0-9]+$/.test(id);
}
