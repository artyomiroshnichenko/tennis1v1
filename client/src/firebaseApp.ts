import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const options: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(
  options.apiKey && options.authDomain && options.projectId,
)

let authInstance: Auth | null = null

export function getFirebaseAuth(): Auth | null {
  if (!firebaseConfigured) return null
  if (!authInstance) {
    authInstance = getAuth(initializeApp(options))
  }
  return authInstance
}
