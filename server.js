const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const app = express();

// โหลด Service Account ของโปรเจกต์ packing
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Fix: แปลง phoneNumber ว่างเป็น undefined
function sanitizePhoneNumber(phone) {
  if (!phone || phone.trim() === '') return undefined;
  // ถ้าไม่ได้ขึ้นต้นด้วย + ให้เติม +66 (ไทย)
  let cleaned = phone.trim().replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('0')) cleaned = '+66' + cleaned.slice(1);
  else if (!cleaned.startsWith('+')) cleaned = '+66' + cleaned;
  return cleaned;
}

// Middleware: ตรวจสอบว่าเป็น Admin หรือไม่ (ใช้ Bearer Token)
async function verifyAdmin(req, res, next) {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  
  if (!idToken) {
    return res.status(401).json({ error: 'ไม่พบ Token' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // ตรวจสอบว่า UID นี้อยู่ใน collection "admins" หรือไม่
    const adminDoc = await admin.firestore()
      .collection('admins')
      .doc(uid)
      .get();

    if (!adminDoc.exists) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เป็น Admin' });
    }

    req.adminUid = uid;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token ไม่ถูกต้อง' });
  }
}

// API: สร้างผู้ใช้ใหม่ (เฉพาะ Admin เท่านั้น)
app.post('/api/admin/create-user', verifyAdmin, async (req, res) => {
  const { email, password, displayName, phoneNumber } = req.body;

  // ตรวจสอบข้อมูลที่จำเป็น
  if (!email || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Email และ Password' });
  }

  try {
    // สร้างผู้ใช้ด้วย Admin SDK
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName || '',
      phoneNumber: sanitizePhoneNumber(phoneNumber),
      disabled: false
    });

    // สร้าง document ใน Firestore collection "users"
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: email,
      displayName: displayName || '',
      phoneNumber: phoneNumber || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.adminUid,
      role: 'user',
      isActive: true
    });

    res.status(201).json({
      message: 'สร้างผู้ใช้สำเร็จ',
      uid: userRecord.uid,
      email: userRecord.email
    });

  } catch (error) {
    console.error('Error creating user:', error);

    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'อีเมลนี้มีผู้ใช้งานแล้ว' });
    }

    res.status(500).json({ error: error.message });
  }
});

// API: ดึงรายชื่อผู้ใช้ทั้งหมด (เฉพาะ Admin)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .orderBy('createdAt', 'desc')
      .get();

    const users = [];
    usersSnapshot.forEach(doc => {
      users.push({ id: doc.id, ...doc.data() });
    });

    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: ลบผู้ใช้ (เฉพาะ Admin)
app.delete('/api/admin/delete-user/:uid', verifyAdmin, async (req, res) => {
  const { uid } = req.params;

  try {
    // ลบจาก Firebase Auth
    await admin.auth().deleteUser(uid);
    
    // ลบจาก Firestore
    await admin.firestore().collection('users').doc(uid).delete();

    res.json({ message: 'ลบผู้ใช้สำเร็จ' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Admin API Server กำลังทำงานที่พอร์ต ${PORT}`);
});