import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const getPrivateKey = () => {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (!raw) return undefined;

  // Normalize common .env formats:
  // - "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  // - "-----BEGIN\ PRIVATE\ KEY-----\MIIE... \-----END\ PRIVATE\ KEY-----\"
  let key = raw.replace(/\\ /g, " ").replace(/\\n/g, "\n");
  if (key.includes("\\") && !key.includes("\n")) {
    key = key.replace(/\\/g, "\n");
  }
  return key;
};

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = getPrivateKey();
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

if (!projectId || !clientEmail || !privateKey || !storageBucket) {
  throw new Error("Firebase Admin env vars missing");
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        storageBucket,
      });

export const storage = getStorage(app);
