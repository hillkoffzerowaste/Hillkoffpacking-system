import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { getFirebaseServices } from "./firebase";

function requireFirestore() {
  const services = getFirebaseServices();
  if (!services.enabled) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE_* env values first.");
  }
  return services.db;
}

function cleanRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

export async function createFirebaseOrder(order) {
  const db = requireFirestore();
  const ref = doc(collection(db, "orders"));
  const now = serverTimestamp();
  const payload = cleanRecord({
    ...order,
    id: ref.id,
    status: "Ready to Pack",
    imported_at: now,
    ready_to_pack_at: now,
    created_at: now,
    updated_at: now
  });

  await setDoc(ref, payload);
  return { ...payload, id: ref.id };
}

export async function listFirebaseOrders({ status, channel, q } = {}) {
  const db = requireFirestore();
  const filters = [];
  if (status) filters.push(where("status", "==", status));
  if (channel) filters.push(where("channel", "==", channel));

  const snapshot = await getDocs(query(
    collection(db, "orders"),
    ...filters,
    orderBy("updated_at", "desc"),
    limit(300)
  ));

  const orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  if (!q) return orders;

  const term = q.toLowerCase();
  return orders.filter((order) => {
    return String(order.tracking_id || "").toLowerCase().includes(term)
      || String(order.order_key || "").toLowerCase().includes(term)
      || String(order.customer_name || "").toLowerCase().includes(term);
  });
}

export async function getFirebaseOrder(id) {
  const db = requireFirestore();
  const snapshot = await getDoc(doc(db, "orders", id));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function updateFirebaseOrder(id, patch) {
  const db = requireFirestore();
  await updateDoc(doc(db, "orders", id), cleanRecord({
    ...patch,
    updated_at: serverTimestamp()
  }));
}

export async function addFirebaseScanEvent(event) {
  const db = requireFirestore();
  await addDoc(collection(db, "scan_events"), cleanRecord({
    ...event,
    created_at: serverTimestamp()
  }));
}

export async function listFirebaseScanEvents() {
  const db = requireFirestore();
  const snapshot = await getDocs(query(
    collection(db, "scan_events"),
    orderBy("created_at", "desc"),
    limit(100)
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

