import * as functions from 'firebase-functions/v1';
import type { EventContext } from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { computeAndWriteRollup, refreshAllRollupsForUser, taskScopeFromDetailRouteParam } from './report-rollup.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { CloudTasksClient } from '@google-cloud/tasks';

export * from './firestore-mutation.js';

admin.initializeApp();

const db = admin.firestore();
const REGION = 'asia-northeast1' as const;
const tasksClient = new CloudTasksClient();
const BATCH_SIZE = 500;

//　子タスクを削除
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


function onTaskDeletedForPath(documentPath: string) {
  return functions.region(REGION).firestore.document(documentPath).onDelete(handleTaskDocumentDeleted);
}

export const onTaskDeletedAccountDefault = onTaskDeletedForPath('accounts/{userId}/tasks/{taskId}');
export const onTaskDeletedAccountPrivateList = onTaskDeletedForPath('accounts/{userId}/privateTaskLists/{listId}/tasks/{taskId}');
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
  },
  async () => {
    try{
    const accountsRef = db.collection('accounts');
    const project = 'kensyu10149';
    const queue = 'report-rollup-queue';
    const location = REGION;

    const queuePath = `projects/${project}/locations/${location}/queues/${queue}`;

    const url = `https://asia-northeast1-kensyu10149.cloudfunctions.net/workerTaskReportRollup`;

    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

    for (;;) {
      let q = accountsRef.orderBy(admin.firestore.FieldPath.documentId()).limit(100);
      if (last) {
        q = q.startAfter(last);
      }
      const snap = await q.get();
      if (snap.empty) break;
      for (const userDoc of snap.docs) {
        if (!userDoc.id) {
          console.log('scheduledTaskReportRollupDaily: userDoc.id is undefined');
          continue;
        }
        const task = {
          httpRequest: {
            httpMethod: 'POST' as const,
            url,
            headers: {
              'Content-Type': 'application/json',
            },
            body: Buffer.from(JSON.stringify({ userId: userDoc.id }), 'utf-8').toString('base64'),
          },
        };
        await tasksClient.createTask({
          parent: queuePath,
          task,
        });
      }

      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 100) break;
    }
    console.log('scheduledTaskReportRollupDaily: done');
  } catch (e) {
    console.error('scheduledTaskReportRollupDaily: error', e);
    throw e;
  }
},
);
      
export const workerTaskReportRollup = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).send('userId is required');
      return;
    }

    try {
      await refreshAllRollupsForUser(db, userId);
      res.status(200).send(`Success: ${userId}`);
    } catch (e) {
      console.error('Worker failed', userId, e);
      res.status(500).send('Internal Server Error');
    }
});



// 幽霊データを削除
export const cleanupOrphanedTasks = onCall({ region: REGION }, async (request) => {
  const aliveUserSnap = await db.collection('projects').get();
  const aliveUserIds = new Set(aliveUserSnap.docs.map(doc => doc.id));

  //const allTasksSnap = await db.collectionGroup('tasks').get();
  const allTaskActivityLogsSnap = await db.collectionGroup('taskActivityLogs').get();
  // const allReportRollupsSnap = await db.collectionGroup('reportRollups').get();
  // const allProjectMenmbershipsSnap = await db.collectionGroup('projectMemberships').get();
  // const allPrivateTaskListsSnap = await db.collectionGroup('privateTaskLists').get();
  //const allConfigSnap = await db.collectionGroup('config').get();
  
  let batch = db.batch();
  let count = 0;
  const deletedUserIds = new Set<string>();

  for (const taskDoc of allTaskActivityLogsSnap.docs) {
    const pathSegments = taskDoc.ref.path.split('/');
    const userId = pathSegments[1];

    if (!aliveUserIds.has(userId)) {
      batch.delete(taskDoc.ref);
      deletedUserIds.add(userId);
      count++;

      if (count % 500 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
  }

  await batch.commit();
  return { 
    message: `${count}件の幽霊データを削除しました。`,
    orphanedUsers: Array.from(deletedUserIds) 
  };
});


/**
 * 汎用的な削除タスク追加関数
 */
async function enqueueCleanupTask(userId: string, path: string, subCollections: string[]) {
  const project = 'kensyu10149';
  const queue = 'data-cleanup-queue';
  const url = `https://${REGION}-${project}.cloudfunctions.net/workerRecursiveCleanup`;

  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ userId, path, subCollections }), 'utf8').toString('base64'),
    },
  };
  await tasksClient.createTask({
    parent: `projects/${project}/locations/${REGION}/queues/${queue}`,
    task,
  });
}

// アカウント削除時
export const onAccountDeleted = functions.region(REGION).firestore
  .document('accounts/{userId}')
  .onDelete(async (snap, context) => {
    await enqueueCleanupTask(context.params.userId, snap.ref.path, ['config', 'privateTaskLists', 'reportRollups', 'projectMemberships', 'invitedProjects', 'taskActivityLog', 'tasks']);
  });

// プロジェクト削除時
export const onProjectDeleted = functions.region(REGION).firestore
  .document('projects/{projectId}')
  .onDelete(async (snap, context) => {
    await enqueueCleanupTask('', snap.ref.path, ['authenticatedEmails', 'invitedEmails', 'pendingJoinRequests', 'members', 'config','tasks','taskActivityLog','reportRollups'],);
  });

// プライベートリスト削除時
export const onPrivateListDeleted = functions.region(REGION).firestore
  .document('accounts/{userId}/privateTaskLists/{listId}')
  .onDelete(async (snap, context) => {
    await enqueueCleanupTask(context.params.userId, snap.ref.path, ['tasks','taskActivityLog','reportRollups']);
  });

  export const workerRecursiveCleanup = functions.region(REGION).https.onRequest(async (req, res) => {
    const { path, subCollections, projectId } = req.body;
  
    if (!path || !subCollections) {
      res.status(400).send('Missing path or subCollections');
      return;
    }
  
    try {
      const parentRef = db.doc(path);

      if (path.startsWith('projects/')) {
        const actualProjectId = projectId || path.split('/')[1];
        const membersSnap = await parentRef.collection('members').get();
        
        let mBatch = db.batch();
        let mCount = 0;
        
        for (const mDoc of membersSnap.docs) {
          const uid = mDoc.id;
          const mRef = db.collection('accounts').doc(uid)
                         .collection('projectMemberships').doc(actualProjectId);
          
          mBatch.delete(mRef);
          mCount++;
  
          if (mCount % 500 === 0) {
            await mBatch.commit();
            mBatch = db.batch();
          }
        }
        await mBatch.commit();
        console.log(`Cleaned up ${mCount} memberships for project: ${actualProjectId}`);
      }
  
      for (const collName of subCollections) {
        const collRef = parentRef.collection(collName);
        await deleteCollection(collRef);
      }
  
      res.status(200).send(`Cleanup finished for ${path}`);
    } catch (err) {
      console.error('Cleanup worker failed:', err);
      res.status(500).send(String(err));
    }
  });

/**
 * コレクション内の全ドキュメントをバッチ削除する補助関数
 */
async function deleteCollection(collectionRef: admin.firestore.CollectionReference) {
  const query = collectionRef.limit(500);
  
  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query: admin.firestore.Query, resolve: any) {
  const snapshot = await query.get();

  if (snapshot.size === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  // 次のバッチを再帰的に実行（末端まで消し切る）
  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}
