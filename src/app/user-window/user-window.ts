import {
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TaskList } from '../task-list/task-list';
import { ProjectHub, ProjectOpenedPayload } from '../project-hub/project-hub';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { ProjectSessionService } from '../project-session.service';
import { TaskScope } from '../task-scope';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  setDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { PrivateListService } from '../private-list.service';
import {
  mergeTabKeys,
  TAB_KEY_PRIVATE_DEFAULT,
  tabKeyPrivateList,
  tabKeyProject,
} from '../nav-tab-order';
import { TabColorPickerDialog } from '../tab-color-picker-dialog/tab-color-picker-dialog';
import { displayEllipsis, isDisplayTruncated } from '../display-ellipsis';

export type NavEntry =
  | { key: string; kind: 'privateDefault'; label: string }
  | { key: string; kind: 'privateList'; id: string; title: string }
  | { key: string; kind: 'project'; projectId: string; projectName: string };

@Component({
  selector: 'app-user-window',
  standalone: true,
  imports: [
    CommonModule,
    TaskList,
    ProjectHub,
    MatToolbarModule,
    MatButtonModule,
    MatMenuModule,
    MatTabsModule,
    MatIconModule,
    MatDialogModule,
    DragDropModule,
  ],
  templateUrl: './user-window.html',
  styleUrl: './user-window.css',
})
export class UserWindow implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly projectSession = inject(ProjectSessionService);
  private readonly firestore = inject(Firestore);
  private readonly privateListService = inject(PrivateListService);
  private readonly dialog = inject(MatDialog);
  private membershipSub?: Subscription;
  private privateListsSub?: Subscription;
  private privateUiSub?: Subscription;
  private tabOrderSub?: Subscription;
  private tabAppearanceSub?: Subscription;

  mainTab = signal<'private' | 'project'>('private');
  activeProject = signal<{ id: string; name: string } | null>(null);

  activePrivateListId = signal<'default' | string>('default');
  defaultPrivateLabel = signal('プライベート');
  privateLists = signal<{ id: string; title: string }[]>([]);
  memberships = signal<{ projectId: string; projectName: string }[]>([]);

  /** Firestore `accounts/.../config/tabOrder.order` と同期 */
  tabOrderRaw = signal<string[]>([]);

  /** Firestore `accounts/.../config/tabAppearance.colors`（タブキー → #RRGGBB） */
  tabColorsRaw = signal<Record<string, string>>({});

  readonly tabKeyDefault = TAB_KEY_PRIVATE_DEFAULT;

  privateTaskScope = computed<TaskScope>(() => ({
    kind: 'private',
    privateListId: this.activePrivateListId(),
  }));

  projectTaskScope = computed<TaskScope>(() => {
    const p = this.activeProject();
    if (!p) {
      return { kind: 'private', privateListId: 'default' };
    }
    return { kind: 'project', projectId: p.id };
  });

  readonly allTabKeys = computed(() => {
    const s = new Set<string>();
    s.add(TAB_KEY_PRIVATE_DEFAULT);
    for (const pl of this.privateLists()) {
      s.add(tabKeyPrivateList(pl.id));
    }
    for (const m of this.memberships()) {
      s.add(tabKeyProject(m.projectId));
    }
    return s;
  });

  readonly mergedTabOrderKeys = computed(() =>
    mergeTabKeys(this.tabOrderRaw(), this.allTabKeys()),
  );

  readonly navEntries = computed((): NavEntry[] => {
    const keys = this.mergedTabOrderKeys();
    const plById = new Map(this.privateLists().map((p) => [p.id, p]));
    const prById = new Map(this.memberships().map((m) => [m.projectId, m]));
    const label = this.defaultPrivateLabel();
    const out: NavEntry[] = [];
    for (const key of keys) {
      if (key === TAB_KEY_PRIVATE_DEFAULT) {
        out.push({ key, kind: 'privateDefault', label });
        continue;
      }
      if (key.startsWith('pl:')) {
        const id = key.slice(3);
        const pl = plById.get(id);
        if (pl) {
          out.push({ key, kind: 'privateList', id, title: pl.title });
        }
        continue;
      }
      if (key.startsWith('p:')) {
        const projectId = key.slice(2);
        const m = prById.get(projectId);
        if (m) {
          out.push({
            key,
            kind: 'project',
            projectId,
            projectName: m.projectName,
          });
        }
      }
    }
    return out;
  });

  ngOnInit(): void {
    const s = this.projectSession.load();
    this.mainTab.set(s.mainTab);
    this.activeProject.set(s.activeProject);
    this.memberships.set(s.projectTabsCache);
    this.tabOrderRaw.set(s.tabOrderCache);
    this.tabColorsRaw.set(s.tabColorsCache ?? {});
    this.activePrivateListId.set(
      typeof s.activePrivateListId === 'string' && s.activePrivateListId.length > 0
        ? s.activePrivateListId
        : 'default',
    );
    this.defaultPrivateLabel.set(s.defaultPrivateListLabel);
    this.privateLists.set(s.privateListsCache);

    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    this.subscribePrivateUi(userId);
    this.subscribePrivateLists(userId);
    this.subscribeTabOrder(userId);
    this.subscribeTabAppearance(userId);

    const ref = collection(this.firestore, 'accounts', userId, 'projectMemberships');
    this.membershipSub = collectionData(ref, { idField: 'projectId' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => ({
            projectId: String(data['projectId'] ?? ''),
            projectName:
              typeof data['projectName'] === 'string' ? data['projectName'] : '（無題）',
          })),
        ),
      )
      .subscribe((rows) => {
        this.memberships.set(rows);
        this.persistSession();
      });
  }

  private subscribePrivateUi(username: string): void {
    const ref = doc(this.firestore, 'accounts', username, 'config', 'privateUi');
    this.privateUiSub = docData(ref).subscribe((d) => {
      const label =
        d && typeof (d as Record<string, unknown>)['defaultListLabel'] === 'string'
          ? String((d as Record<string, unknown>)['defaultListLabel'])
          : 'プライベート';
      this.defaultPrivateLabel.set(label.trim() || 'プライベート');
      this.persistSession();
    });
  }

  private subscribePrivateLists(username: string): void {
    const ref = collection(this.firestore, 'accounts', username, 'privateTaskLists');
    this.privateListsSub = collectionData(ref, { idField: 'id' })
      .pipe(
        map((rows) => {
          const list = (rows as Record<string, unknown>[]).map((data) => ({
            id: String(data['id'] ?? ''),
            title:
              typeof data['title'] === 'string' && data['title'].trim() !== ''
                ? data['title']
                : '（無題）',
          }));
          return list.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
        }),
      )
      .subscribe((rows) => {
        this.privateLists.set(rows);
        const active = this.activePrivateListId();
        if (active !== 'default' && !rows.some((r) => r.id === active)) {
          this.activePrivateListId.set('default');
        }
        this.persistSession();
      });
  }

  private subscribeTabOrder(username: string): void {
    const ref = doc(this.firestore, 'accounts', username, 'config', 'tabOrder');
    this.tabOrderSub = docData(ref).subscribe((d) => {
      const raw = d && Array.isArray((d as Record<string, unknown>)['order'])
        ? (d as Record<string, unknown>)['order']
        : [];
      const order = (raw as unknown[]).filter((x): x is string => typeof x === 'string');
      this.tabOrderRaw.set(order);
      this.persistSession();
    });
  }

  private subscribeTabAppearance(username: string): void {
    const ref = doc(this.firestore, 'accounts', username, 'config', 'tabAppearance');
    this.tabAppearanceSub = docData(ref).subscribe((d) => {
      const raw = d && (d as Record<string, unknown>)['colors'];
      const colors: Record<string, string> = {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof k === 'string' && typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)) {
            colors[k] = v;
          }
        }
      }
      this.tabColorsRaw.set(colors);
      this.persistSession();
    });
  }

  ngOnDestroy(): void {
    this.membershipSub?.unsubscribe();
    this.privateListsSub?.unsubscribe();
    this.privateUiSub?.unsubscribe();
    this.tabOrderSub?.unsubscribe();
    this.tabAppearanceSub?.unsubscribe();
    this.persistSession();
  }

  private persistSession(): void {
    this.projectSession.save({
      mainTab: this.mainTab(),
      activeProject: this.activeProject(),
      projectTabsCache: this.memberships(),
      activePrivateListId: this.activePrivateListId(),
      privateListsCache: this.privateLists(),
      defaultPrivateListLabel: this.defaultPrivateLabel(),
      tabOrderCache: this.tabOrderRaw(),
      tabColorsCache: this.tabColorsRaw(),
    });
  }

  onNavTabDrop(ev: CdkDragDrop<NavEntry[]>): void {
    if (ev.previousIndex === ev.currentIndex) {
      return;
    }
    const keys = [...this.mergedTabOrderKeys()];
    moveItemInArray(keys, ev.previousIndex, ev.currentIndex);
    this.tabOrderRaw.set(keys);
    void this.persistTabOrderToFirestore(keys);
  }

  private async persistTabOrderToFirestore(order: string[]): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    try {
      await setDoc(
        doc(this.firestore, 'accounts', userId, 'config', 'tabOrder'),
        { order, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.error('persistTabOrderToFirestore failed:', e);
    }
    this.persistSession();
  }

  selectDefaultPrivateTab(): void {
    this.mainTab.set('private');
    this.activeProject.set(null);
    this.activePrivateListId.set('default');
    this.persistSession();
  }

  selectPrivateList(listId: string): void {
    this.mainTab.set('private');
    this.activeProject.set(null);
    this.activePrivateListId.set(listId);
    this.persistSession();
  }

  selectProjectHub(): void {
    this.mainTab.set('project');
    this.activeProject.set(null);
    this.persistSession();
  }

  onProjectOpened(payload: ProjectOpenedPayload): void {
    this.mainTab.set('project');
    this.activeProject.set({ id: payload.projectId, name: payload.projectName });
    this.persistSession();
  }

  async changeDisplayName(): Promise<void> {
    const cur = this.auth.displayName() ?? this.auth.userId() ?? '';
    const n = window.prompt('新しいユーザー名', cur);
    if (n === null) {
      return;
    }
    try {
      await this.auth.updateDisplayName(n);
    } catch (e) {
      alert(e instanceof Error ? e.message : '更新に失敗しました');
    }
  }

  signOut(): void {
    this.persistSession();
    this.auth.signOut();
    void this.router.navigate(['/login']);
  }

  openProject(entry: NavEntry & { kind: 'project' }): void {
    this.mainTab.set('project');
    this.activeProject.set({ id: entry.projectId, name: entry.projectName });
    this.persistSession();
  }

  openProjectSettings(ev: Event, entry: NavEntry & { kind: 'project' }): void {
    ev.stopPropagation();
    ev.preventDefault();
    void this.router.navigate(['/project', entry.projectId, 'settings']);
  }

  openProjectSettingsFromMenu(entry: NavEntry & { kind: 'project' }): void {
    void this.router.navigate(['/project', entry.projectId, 'settings']);
  }

  isEntryActive(entry: NavEntry): boolean {
    switch (entry.kind) {
      case 'privateDefault':
        return this.isDefaultPrivateTabActive();
      case 'privateList':
        return this.isPrivateListTabActive(entry.id);
      case 'project':
        return this.isProjectTabActive(entry.projectId);
    }
  }

  tabLabel(entry: NavEntry): string {
    switch (entry.kind) {
      case 'privateDefault':
        return entry.label;
      case 'privateList':
        return entry.title;
      case 'project':
        return entry.projectName;
    }
  }

  /** ナビタブ表示（プロジェクト名のみ最大10文字＋…） */
  navTabDisplayLabel(entry: NavEntry): string {
    const full = this.tabLabel(entry);
    if (entry.kind !== 'project') {
      return full;
    }
    return displayEllipsis(full);
  }

  /** プロジェクトタブで省略したときホバー用の全文 */
  navTabTitleAttr(entry: NavEntry): string | null {
    if (entry.kind !== 'project') {
      return null;
    }
    const full = this.tabLabel(entry);
    return isDisplayTruncated(full) ? full : null;
  }

  onNavEntryClick(entry: NavEntry, ev: Event): void {
    ev.preventDefault();
    switch (entry.kind) {
      case 'privateDefault':
        this.selectDefaultPrivateTab();
        break;
      case 'privateList':
        this.selectPrivateList(entry.id);
        break;
      case 'project':
        this.openProject(entry);
        break;
    }
  }

  changeTabColor(tabKey: string): void {
    const cur = this.tabColorsRaw()[tabKey] ?? '';
    const ref = this.dialog.open(TabColorPickerDialog, {
      width: 'min(96vw, 360px)',
      autoFocus: 'first-tabbable',
      data: { current: cur },
    });
    ref.afterClosed().subscribe((v: string | undefined) => {
      if (v === undefined) {
        return;
      }
      void this.applyTabColorChoice(tabKey, v.trim());
    });
  }

  private async applyTabColorChoice(tabKey: string, t: string): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    if (t === '') {
      const next = { ...this.tabColorsRaw() };
      delete next[tabKey];
      this.tabColorsRaw.set(next);
      await this.persistTabColorsDoc(next);
      return;
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(t)) {
      return;
    }
    const next = { ...this.tabColorsRaw(), [tabKey]: t };
    this.tabColorsRaw.set(next);
    await this.persistTabColorsDoc(next);
  }

  private async persistTabColorsDoc(colors: Record<string, string>): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    try {
      await setDoc(
        doc(this.firestore, 'accounts', userId, 'config', 'tabAppearance'),
        { colors, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.error('persistTabColorsDoc failed:', e);
    }
    this.persistSession();
  }

  isProjectHubActive(): boolean {
    return this.mainTab() === 'project' && this.activeProject() === null;
  }

  isProjectTabActive(projectId: string): boolean {
    return (
      this.mainTab() === 'project' && this.activeProject()?.id === projectId
    );
  }

  isDefaultPrivateTabActive(): boolean {
    return this.mainTab() === 'private' && this.activePrivateListId() === 'default';
  }

  isPrivateListTabActive(listId: string): boolean {
    return this.mainTab() === 'private' && this.activePrivateListId() === listId;
  }

  async onAddPrivateList(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    try {
      const id = await this.privateListService.createPrivateList(userId);
      this.activePrivateListId.set(id);
      this.mainTab.set('private');
      this.activeProject.set(null);
      this.persistSession();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'リストの追加に失敗しました');
    }
  }

  async promptRenameDefaultPrivate(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const cur = this.defaultPrivateLabel();
    const n = window.prompt('リストの名称', cur);
    if (n === null) {
      return;
    }
    try {
      await this.privateListService.renameDefaultListLabel(userId, n);
    } catch (e) {
      alert(e instanceof Error ? e.message : '名称の変更に失敗しました');
    }
  }

  async renameExtraPrivate(pl: { id: string; title: string }): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const n = window.prompt('リストの名称', pl.title);
    if (n === null) {
      return;
    }
    try {
      await this.privateListService.renameExtraList(userId, pl.id, n);
    } catch (e) {
      alert(e instanceof Error ? e.message : '名称の変更に失敗しました');
    }
  }

  async deleteExtraPrivate(pl: { id: string; title: string }): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    if (!window.confirm(`「${pl.title}」を削除しますか？\n含まれるタスクもすべて削除されます。`)) {
      return;
    }
    try {
      await this.privateListService.deleteExtraList(userId, pl.id);
      if (this.activePrivateListId() === pl.id) {
        this.activePrivateListId.set('default');
      }
      this.persistSession();
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました');
    }
  }
}
