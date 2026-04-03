import admin from 'firebase-admin'

let initialized = false

export function isFirebaseConfigured(): boolean {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
  return Boolean(projectId && clientEmail && privateKey)
}

function ensureInit(): void {
  if (initialized) return
  if (!isFirebaseConfigured()) {
    throw new Error('FIREBASE_NOT_CONFIGURED')
  }
  const projectId = process.env.FIREBASE_PROJECT_ID!
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n')
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    })
  }
  initialized = true
}

export async function verifyFirebaseIdToken(idToken: string) {
  ensureInit()
  return admin.auth().verifyIdToken(idToken)
}
