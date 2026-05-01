import * as functions from 'firebase-functions/v1';
import type { CallableContext } from 'firebase-functions/v1/https';
import * as admin from 'firebase-admin';
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';

admin.initializeApp();
const db = admin.firestore();

const REGION = 'asia-northeast1' as const;
const FIRESTORE_BATCH_LIMIT = 500;

function requireAuth(context: CallableContext): asserts context is CallableContext & {
  auth: NonNullable<CallableContext['auth']>;
} {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'ログインが必要です');
  }
}

async function assertCallerIsProjectMember(projectId: string, callerUid: string): Promise<void> {
  const memberRef = db.collection('projects').doc(projectId).collection('members').doc(callerUid);
  const snap = await memberRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('permission-denied', 'このプロジェクトのメンバーではありません');
  }
}

export const onAvatarUrlUpdated = functions
  .region(REGION)
  .firestore
  .document("accounts/{userId}")
  .onUpdate(async (change, context) => {
    const { userId } = context.params;
    const before = change.before.data() as { avatarUrl?: string | null };
    const after = change.after.data() as { avatarUrl?: string | null };

    if (before.avatarUrl === after.avatarUrl) {
      return;
    }

    const projectMembershipsRef = db.collection("accounts").doc(userId).collection("projectMemberships");
    const projectMembershipsSnap = await projectMembershipsRef.get();
    if (projectMembershipsSnap.empty) {
        return;
    }
    const docs = projectMembershipsSnap.docs;
    for (let i = 0; i < docs.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = db.batch();
      const slice = docs.slice(i, i + FIRESTORE_BATCH_LIMIT);
      for (const doc of slice) {
        const projectId = doc.id;
        const memberRef = db.collection("projects").doc(projectId).collection("members").doc(userId);
        if (after.avatarUrl === null || after.avatarUrl === '') {
          batch.update(memberRef, { avatarUrl: FieldValue.delete() });
        } else {
          batch.update(memberRef, { avatarUrl: after.avatarUrl });
        }
      }
      await batch.commit();
    }
  });

export const createProject = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    requireAuth(context);
    const { projectId, projectName, password, userId, email } = data;
    if (context.auth.uid !== userId) {
      throw new functions.https.HttpsError('permission-denied', '認証情報が一致しません');
    }
    const projectRef = db.collection("projects").doc(projectId);
    const existing = await projectRef.get();
    if (existing.exists) {
      throw new functions.https.HttpsError('already-exists', 'プロジェクトIDは既に使われています。別のIDを指定するか、参加から入ってください。');
    }
    await projectRef.set({
      name: projectName,
      password: password,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
    });
    await executeAddMemberLogic(projectId, userId, projectName);
    const authenticatedRef = db.collection("projects").doc(projectId).collection("authenticatedEmails").doc(email);
    await authenticatedRef.set({
        invitedAt: FieldValue.serverTimestamp(),
        invitedBy: userId,
      });
  });



export const joinProject = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    requireAuth(context);
    const { projectId, password, userId, email } = data;
    if (context.auth.uid !== userId) {
      throw new functions.https.HttpsError('permission-denied', '認証情報が一致しません');
    }
    const projectRef = db.collection("projects").doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'プロジェクトが見つかりません。プロジェクトIDとパスワードを確認してください。');
    }
    const projectData = projectSnap.data() as { password?: string; name?: string };
    if (projectData.password !== password) {
      throw new functions.https.HttpsError('invalid-argument', 'パスワードが正しくありません。');
    }
    const projectName =
      typeof projectData.name === 'string' && projectData.name !== '' ? projectData.name : projectId;

    const result = await executeAuthenticatedEmailRecord(projectId, email, userId, projectName);
    if (result.status){
        return {
            status: 'tabOpened',
            row: { projectId, projectName: result.projectName, joinedAt: null },
          };
    }
    await db.collection("projects").doc(projectId).collection("pendingJoinRequests").doc(userId).set({
      emailLower: email,
      requestedAt: FieldValue.serverTimestamp(),
    });
    return {
        status: 'pendingApproval',
        projectId: projectId,
        projectName: result.projectName,
    };
});

/**
 * @param knownProjectName joinProject などで既に projects/{id} を読んでいる場合に渡すと、その get を省略できる
 */
async function executeAuthenticatedEmailRecord(
  projectId: string,
  email: string,
  userId: string,
  knownProjectName?: string,
): Promise<{ status: boolean; projectName: string }> {
  const authenticatedRef = db.collection('projects').doc(projectId).collection('authenticatedEmails').doc(email);
  const invitedRef = db.collection('projects').doc(projectId).collection('invitedEmails').doc(email);
  const invitedProjectRef = db.collection('accounts').doc(userId).collection('invitedProjects').doc(projectId);

  let projectName: string;
  let authenticatedSnap: DocumentSnapshot;
  let invitedSnap: DocumentSnapshot;
  let invitedProjectSnap: DocumentSnapshot;

  if (knownProjectName !== undefined) {
    projectName = knownProjectName;
    [authenticatedSnap, invitedSnap, invitedProjectSnap] = await Promise.all([
      authenticatedRef.get(),
      invitedRef.get(),
      invitedProjectRef.get(),
    ]);
  } else {
    const projectRef = db.collection('projects').doc(projectId);
    let projectSnap: DocumentSnapshot;
    [projectSnap, authenticatedSnap, invitedSnap, invitedProjectSnap] = await Promise.all([
      projectRef.get(),
      authenticatedRef.get(),
      invitedRef.get(),
      invitedProjectRef.get(),
    ]);
    if (!projectSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'プロジェクトが見つかりません。プロジェクトIDとパスワードを確認してください。',
      );
    }
    const projectData = projectSnap.data() as { name?: string };
    projectName = typeof projectData.name === 'string' && projectData.name !== '' ? projectData.name : projectId;
  }

  if (authenticatedSnap.exists || invitedSnap.exists || invitedProjectSnap.exists) {
    if (!authenticatedSnap.exists) {
      const data = invitedSnap.data() as { invitedBy: string };
      const invitedBy = data.invitedBy;
      await authenticatedRef.set({
        invitedAt: FieldValue.serverTimestamp(),
        invitedBy: invitedBy,
      });
      await Promise.all([invitedRef.delete(), invitedProjectRef.delete()]);
    }
    await executeAddMemberLogic(projectId, userId, projectName);
    return { status: true, projectName: projectName };
  }
  return { status: false, projectName: projectName };
}

async function executeAddMemberLogic(projectId: string, userId: string, projectName: string) {
  const accRef = db.collection('accounts').doc(userId);
  let displayName = userId;
  let avatarUrl: string | null = null;
  let emailLower: string | undefined;
  const accSnap = await accRef.get();
  if (accSnap.exists) {
    const d = accSnap.data() as {
      displayName?: string;
      avatarUrl?: string;
      emailLower?: string;
    };
    displayName =
      typeof d['displayName'] === 'string' && d['displayName'].trim() !== ''
        ? d['displayName'].trim()
        : userId;
    if (typeof d['avatarUrl'] === 'string' && d['avatarUrl'].trim() !== '') {
      avatarUrl = d['avatarUrl'].trim();
    }
    if (typeof d['emailLower'] === 'string' && d['emailLower'].trim() !== '') {
      emailLower = d['emailLower'].trim().toLowerCase();
    }
  }
  const memberRef = db.collection('projects').doc(projectId).collection('members').doc(userId);
  const membershipRef = db.collection('accounts').doc(userId).collection('projectMemberships').doc(projectId);

  const memberPayload: Record<string, unknown> = {
    avatarUrl,
    userId,
    displayName,
    joinedAt: FieldValue.serverTimestamp(),
  };
  if (emailLower !== undefined) {
    memberPayload['emailLower'] = emailLower;
  }

  await Promise.all([
    memberRef.set(memberPayload),
    membershipRef.set({
      projectName,
      joinedAt: FieldValue.serverTimestamp(),
    }),
  ]);
}


export const addMember = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    requireAuth(context);
    const { projectId, userId, projectName } = data;
    await assertCallerIsProjectMember(projectId, context.auth.uid);
    await executeAddMemberLogic(projectId, userId, projectName);
});

export const approveInvitation = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    requireAuth(context);
    const { projectId, userId, email } = data;
    if (context.auth.uid !== userId) {
      throw new functions.https.HttpsError('permission-denied', '認証情報が一致しません');
    }
    return await executeAuthenticatedEmailRecord(projectId, email, userId);
});

export const onEmailInvitationCreated = functions
  .region(REGION)
  .firestore
  .document("projects/{projectId}/invitedEmails/{email}")
  .onCreate(async (snapshot, context) => {
    const { projectId, email } = context.params;
    const inviteData = snapshot.data();
    
    if (!inviteData) return;

    const invitedBy = inviteData.invitedBy;
    const invitedAt = inviteData.invitedAt || FieldValue.serverTimestamp();

    const usersRef = db.collection("accounts");
    const querySnapshot = await usersRef.where("emailLower", "==", email).limit(1).get();

    if (querySnapshot.empty) {
      return;
    }

    const userDoc = querySnapshot.docs[0];
    const userId = userDoc.id;

    const invitedProjectRef = db
      .collection("accounts")
      .doc(userId)
      .collection("invitedProjects")
      .doc(projectId);

    await invitedProjectRef.set({
      invitedAt: invitedAt,
      invitedBy: invitedBy,
    });
  });

export const onEmailInvitationDeleted = functions
  .region(REGION)
  .firestore
  .document("accounts/{userId}/invitedProjects/{projectId}")
  .onDelete(async (_snapshot, context) => {
    const { projectId, userId } = context.params;
    const accountSnap = await db.collection("accounts").doc(userId).get();
    const emailLower = accountSnap.data()?.emailLower;
    if (typeof emailLower !== 'string' || emailLower.trim() === '') {
      return;
    }
    const invitedEmailRef = db
      .collection("projects")
      .doc(projectId)
      .collection("invitedEmails")
      .doc(emailLower.trim().toLowerCase());
    await invitedEmailRef.delete();
  });

export const onInvitationEmailDeleted = functions
  .region(REGION)
  .firestore
  .document("projects/{projectId}/invitedEmails/{email}")
  .onDelete(async (snapshot, context) => {
    const { projectId, email } = context.params;
    const querySnapshot = await db.collection("accounts").where("emailLower", "==", email).limit(1).get();
    if (querySnapshot.empty) return;
    const userId = querySnapshot.docs[0].id;
    const invitedEmailRef = db.collection("accounts").doc(userId).collection("invitedProjects").doc(projectId);
    await invitedEmailRef.delete();
  });

export const onRenameProject = functions
  .region(REGION)
  .firestore
  .document("projects/{projectId}")
  .onUpdate(async (change, context) => {
    const { projectId } = context.params;
    const before = change.before.data() as { name?: string };
    const after = change.after.data() as { name?: string };
    if (before.name === after.name) return;
    const membersRef = db.collection("projects").doc(projectId).collection("members");
    const membersSnap = await membersRef.get();
    const memberDocs = membersSnap.docs;
    const newName = after.name;
    for (let i = 0; i < memberDocs.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = db.batch();
      const slice = memberDocs.slice(i, i + FIRESTORE_BATCH_LIMIT);
      for (const d of slice) {
        batch.update(db.collection("accounts").doc(d.id).collection("projectMemberships").doc(projectId), { projectName: newName });
      }
      await batch.commit();
    }
  });

export const onMemberDeleted = functions
  .region(REGION)
  .firestore
  .document("projects/{projectId}/members/{userId}")
  .onDelete(async (snapshot, context) => {
    const { projectId, userId } = context.params;
    const membershipRef = db.collection("accounts").doc(userId).collection("projectMemberships").doc(projectId);
    await membershipRef.delete();

    const deleted = snapshot.data() as { emailLower?: string } | undefined;
    let emailKey =
      typeof deleted?.emailLower === 'string' ? deleted.emailLower.trim().toLowerCase() : '';
    if (emailKey === '') {
      const accSnap = await db.collection('accounts').doc(userId).get();
      const raw = accSnap.data()?.emailLower;
      emailKey = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    }
    if (emailKey === '') {
      return;
    }
    const authenticatedRef = db
      .collection('projects')
      .doc(projectId)
      .collection('authenticatedEmails')
      .doc(emailKey);
    await authenticatedRef.delete();
  });