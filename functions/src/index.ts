import * as functions from 'firebase-functions/v1';
import type { EventContext } from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { computeAndWriteRollup, refreshAllRollupsForUser, taskScopeFromDetailRouteParam } from './report-rollup.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

admin.initializeApp();

const db = admin.firestore();
const REGION = 'asia-northeast1' as const;

const BATCH_SIZE = 500;

/**
 * トリガに対応した `tasks` コレクション参照（Angular の taskDocRef / TaskCollectionReference と同じ階層）
 */
function tasksCollectionForEvent(context: EventContext): admin.firestore.CollectionReference {
  const p = context.params;
  if (p.projectId) {
    return db.collection('projects').doc(p.projectId).collection('tasks');
  }
  if (p.listId && p.userId) {
    return db
      .collection('accounts')
      .doc(p.userId)
      .collection('privateTaskLists')
      .doc(p.listId)
      .collection('tasks');
  }
  if (p.userId) {
    return db.collection('accounts').doc(p.userId).collection('tasks');
  }
  throw new Error('onTaskDeleted: 未対応のドキュメントパス');
}

/**
 * 同じ collection 内で parentTaskId == 削除された taskId の子を全削除（500件超は複数 batch）。
 * 子が削除されると再び onDelete が走り、孫以降が連鎖的に消える。
 */
async function handleTaskDocumentDeleted(
  _snapshot: admin.firestore.DocumentSnapshot,
  context: EventContext,
): Promise<void> {
  const taskId = context.params.taskId;
  if (!taskId) {
    return;
  }
  const col = tasksCollectionForEvent(context);
  for (;;) {
    const snap = await col.where('parentTaskId', '==', taskId).limit(BATCH_SIZE).get();
    if (snap.empty) {
      return;
    }
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    console.log(
      `onTaskDeleted: deleting ${snap.size} direct children of ${taskId} (path params=${JSON.stringify(
        context.params,
      )})`,
    );
    await batch.commit();
  }
}

/**
 * Firestore トリガは「1 本の .document(パス) につき 1 パターン」しか置けないため、
 * アプリの各 tasks 階層ごとに export を分け、処理は上の 1 関数に集約する。
 */
function onTaskDeletedForPath(documentPath: string) {
  return functions.region(REGION).firestore.document(documentPath).onDelete(handleTaskDocumentDeleted);
}

export const onTaskDeletedAccountDefault = onTaskDeletedForPath('accounts/{userId}/tasks/{taskId}');
export const onTaskDeletedAccountPrivateList = onTaskDeletedForPath(
  'accounts/{userId}/privateTaskLists/{listId}/tasks/{taskId}',
);
export const onTaskDeletedProject = onTaskDeletedForPath('projects/{projectId}/tasks/{taskId}');


// レポート関連

export const refreshTaskReportRollup = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ログインが必要です');
  }
  const scopeParam = request.data?.scopeParam;
  if (typeof scopeParam !== 'string') {
    throw new HttpsError('invalid-argument', 'scopeParam が必要です');
  }
  const uid = request.auth.uid;
  const scope = taskScopeFromDetailRouteParam(scopeParam);
  await computeAndWriteRollup(db, uid, scope);
  return { ok: true };
});

export const scheduledTaskReportRollupDaily = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'Asia/Tokyo',
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    const accountsRef = db.collection('accounts');
    for (;;) {
      let q = accountsRef.orderBy(admin.firestore.FieldPath.documentId()).limit(100);
      if (last) {
        q = q.startAfter(last);
      }
      const snap = await q.get();
      if (snap.empty) break;
      for (const userDoc of snap.docs) {
        try {
          await refreshAllRollupsForUser(db, userDoc.id);
        } catch (e) {
          console.error('scheduledTaskReportRollupDaily user failed', userDoc.id, e);
        }
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 100) break;
    }
  },
);