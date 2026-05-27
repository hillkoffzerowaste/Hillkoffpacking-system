# Deploy To Vercel And Prepare Firebase

เอกสารนี้ใช้สำหรับ deploy frontend ขึ้น Vercel และเตรียมค่าเชื่อม Firebase

## Vercel

โปรเจคมีไฟล์ `vercel.json` แล้ว โดยตั้งค่าไว้ดังนี้

| Setting | Value |
|---|---|
| Root Directory | repository root |
| Framework | Vite |
| Build Command | `npm run build:vercel` |
| Output Directory | `frontend/dist` |
| Install Command | `npm install` |

## Environment Variables On Vercel

เพิ่มค่าเหล่านี้ใน Vercel Project Settings > Environment Variables

```text
VITE_DATA_MODE=local
VITE_BASE_PATH=/
VITE_API_BASE=
```

ถ้าต้องการเปิด Firebase ภายหลัง ให้เพิ่มค่า Firebase Web App config:

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

## Firebase Files Included

| File | Purpose |
|---|---|
| `frontend/src/lib/firebase.js` | Initialize Firebase app, Auth, Firestore |
| `frontend/src/lib/firebaseAdapter.js` | Firestore adapter scaffold for orders and scan events |
| `firebase.json` | Firebase CLI project config |
| `.firebaserc.example` | Template for Firebase project id |
| `firestore.rules` | Starter Firestore security rules |
| `firestore.indexes.json` | Starter Firestore indexes |

## Firebase Collections

Recommended collections:

```text
orders
scan_events
packers
shipping_providers
import_batches
```

## Current Data Mode

The production deploy is still safe to run as `VITE_DATA_MODE=local`, which stores operational data in browser `localStorage`.

When ready to switch to Firebase:

1. Create Firebase project
2. Enable Firestore
3. Enable Authentication
4. Enable Anonymous sign-in provider
4. Add Firebase env vars to Vercel
5. Set `VITE_DATA_MODE=firebase` in Vercel
6. Deploy Firestore rules and indexes

```powershell
Copy-Item .firebaserc.example .firebaserc
# edit .firebaserc and replace your-firebase-project-id
firebase deploy --only firestore
```

Firebase-backed UI actions are wired through `frontend/src/lib/firebaseAdapter.js`.

## Firebase Mode Checklist

Use these Vercel environment variables:

```text
VITE_DATA_MODE=firebase
VITE_BASE_PATH=/
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
```

After deploy, open the app and click `Load Demo`. The app should create default packers, shipping providers, demo orders, and scan events in Firestore.
