import { Injectable } from '@angular/core';

const STORAGE_KEY = 'angular-todo-project-session';

export interface ProjectSessionState {
  mainTab: 'private' | 'project';
  activeProject: { id: string; name: string } | null;
  /** タブ表示のキャッシュ（サインアウト後もプロジェクト UI を復元する） */
  projectTabsCache: { projectId: string; projectName: string }[];
  /** 選択中のプライベートリスト（`default` は従来の `accounts/.../tasks`） */
  activePrivateListId: 'default' | string;
  /** 追加プライベートリストのタブ表示キャッシュ */
  privateListsCache: { id: string; title: string }[];
  /** 既定「プライベート」タブの表示名キャッシュ */
  defaultPrivateListLabel: string;
}

const defaultState = (): ProjectSessionState => ({
  mainTab: 'private',
  activeProject: null,
  projectTabsCache: [],
  activePrivateListId: 'default',
  privateListsCache: [],
  defaultPrivateListLabel: 'プライベート',
});

@Injectable({ providedIn: 'root' })
export class ProjectSessionService {
  load(): ProjectSessionState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return defaultState();
      }
      const parsed = JSON.parse(raw) as Partial<ProjectSessionState>;
      const activePrivate =
        parsed.activePrivateListId === 'default' || typeof parsed.activePrivateListId === 'string'
          ? parsed.activePrivateListId
          : 'default';
      return {
        mainTab: parsed.mainTab === 'project' ? 'project' : 'private',
        activeProject:
          parsed.activeProject &&
          typeof parsed.activeProject.id === 'string' &&
          typeof parsed.activeProject.name === 'string'
            ? parsed.activeProject
            : null,
        projectTabsCache: Array.isArray(parsed.projectTabsCache)
          ? parsed.projectTabsCache.filter(
              (r) =>
                r &&
                typeof r.projectId === 'string' &&
                typeof r.projectName === 'string',
            )
          : [],
        activePrivateListId: activePrivate,
        privateListsCache: Array.isArray(parsed.privateListsCache)
          ? parsed.privateListsCache.filter(
              (r) => r && typeof r.id === 'string' && typeof r.title === 'string',
            )
          : [],
        defaultPrivateListLabel:
          typeof parsed.defaultPrivateListLabel === 'string' &&
          parsed.defaultPrivateListLabel.trim() !== ''
            ? parsed.defaultPrivateListLabel
            : 'プライベート',
      };
    } catch {
      return defaultState();
    }
  }

  save(state: ProjectSessionState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
