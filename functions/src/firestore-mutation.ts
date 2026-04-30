// import * as functions from 'firebase-functions/v1';
// import * as admin from 'firebase-admin';

// admin.initializeApp();

// const db = admin.firestore();
// const REGION = 'asia-northeast1' as const;

// export const onEmailInvitationCreated = functions
//   .region(REGION)
//   .firestore
//   .document("projects/{projectId}/invitedEmails/{email}")
//   .onCreate(async (snapshot, context) => {
//     const { projectId, email } = context.params;
//     const inviteData = snapshot.data();
    
//     if (!inviteData) return;

//     const invitedBy = inviteData.invitedBy;
//     const invitedAt = inviteData.invitedAt || admin.firestore.FieldValue.serverTimestamp();

//     const usersRef = admin.firestore().collection("accounts");
//     const querySnapshot = await usersRef.where("emailLower", "==", email).limit(1).get();

//     if (querySnapshot.empty) {
//       return;
//     }

//     const userDoc = querySnapshot.docs[0];
//     const userId = userDoc.id;

//     const invitedProjectRef = admin.firestore()
//       .collection("accounts")
//       .doc(userId)
//       .collection("invitedProjects")
//       .doc(projectId);

//     await invitedProjectRef.set({
//       invitedAt: invitedAt,
//       invitedBy: invitedBy,
//     });
//   });