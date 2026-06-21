import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey
    && firebaseConfig.authDomain
    && firebaseConfig.projectId
    && firebaseConfig.appId
  );
}

let firebaseApp;
let firestoreDb;
let firebaseAuth;

export function getFirebaseServices() {
  if (!hasFirebaseConfig()) {
    return { app: null, db: null, auth: null, enabled: false };
  }

  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp);
    firebaseAuth = getAuth(firebaseApp);
  }

  return {
    app: firebaseApp,
    db: firestoreDb,
    auth: firebaseAuth,
    enabled: true
  };
}

export async function ensureFirebaseAuth() {
  const services = getFirebaseServices();
  if (!services.enabled) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE_* env values first.");
  }

  if (services.auth.currentUser) return services.auth.currentUser;
  throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");
}

export function getLoginUsername() {
  return import.meta.env.VITE_LOGIN_USERNAME || "packing";
}

export function hasFirebaseLoginConfig() {
  return Boolean(import.meta.env.VITE_LOGIN_EMAIL);
}

export function subscribeFirebaseUser(callback) {
  const services = getFirebaseServices();
  if (!services.enabled) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(services.auth, callback);
}

export async function signInFirebaseUser(username, password) {
  const services = getFirebaseServices();
  if (!services.enabled) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE_* env values first.");
  }

  const expectedUsername = getLoginUsername();
  const enteredUsername = String(username || "").trim();
  const isReviewEmail = enteredUsername.includes("@");
  if (!isReviewEmail && enteredUsername !== expectedUsername) {
    throw new Error("Username หรือ password ไม่ถูกต้อง");
  }

  const email = isReviewEmail ? enteredUsername : import.meta.env.VITE_LOGIN_EMAIL;
  if (!email) {
    throw new Error("ยังไม่ได้ตั้งค่า VITE_LOGIN_EMAIL สำหรับล็อกอิน");
  }

  return signInWithEmailAndPassword(services.auth, email, password).then((credential) => credential.user);
}

export async function signOutFirebaseUser() {
  const services = getFirebaseServices();
  if (services.auth) await signOut(services.auth);
}
