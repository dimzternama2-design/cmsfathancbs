const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

// Inisialisasi Firebase Admin
let serviceAccount;

// 1) Satu variabel berisi JSON service account lengkap
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error('Firebase: FIREBASE_SERVICE_ACCOUNT tidak valid JSON:', err.message);
  }
}

// 2) Kredensial terpisah (umum di Vercel / Railway / Render)
if (!serviceAccount &&
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
) {
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      .replace(/^["'\ufeff]|["'\ufeff]$/g, '')
      .replace(/\\n/g, '\n')
  };
}

let initError = null;

if (!serviceAccount) {
  try {
    serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json')); // Opsional untuk lokal
  } catch (err) {
    initError = 'Kredensial Firebase tidak ditemukan. Isi FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (atau FIREBASE_SERVICE_ACCOUNT), atau sediakan serviceAccountKey.json di root proyek.';
  }
}

if (serviceAccount && !admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin berjalan.');
  } catch (err) {
    initError = 'Firebase gagal diinisialisasi: ' + err.message;
  }
}

const app = express();

app.use(cors());
app.use(express.json());

// Sajikan halaman depan (Abzah CMS) beserta asetnya dari folder public
const publicPath = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Middleware untuk merespons error inisialisasi Firebase dengan perasaan yang jelas
app.use((req, res, next) => {
  if (initError) {
    console.error('[Firebase]', initError);
    return res.status(503).json({ success: false, error: 'Server belum siap: ' + initError });
  }
  next();
});

// 1. GET: Ambil semua artikel/konten
app.get('/api/posts', async (req, res) => {
  try {
    const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
    const posts = [];
    snapshot.forEach(doc => {
      posts.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json({ success: true, data: posts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. GET: Ambil detail artikel berdasarkan ID
app.get('/api/posts/:id', async (req, res) => {
  try {
    const docRef = db.collection('posts').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Konten tidak ditemukan' });
    }
    res.status(200).json({ success: true, data: { id: doc.id, ...doc.data() } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. POST: Tambah artikel baru
app.post('/api/posts', async (req, res) => {
  try {
    const { title, content, author } = req.body;
    const newPost = {
      title,
      content,
      author: author || 'Admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const docRef = await db.collection('posts').add(newPost);
    res.status(201).json({ success: true, id: docRef.id, message: 'Konten berhasil ditambahkan' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. PUT: Update artikel
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { title, content, author } = req.body;
    const docRef = db.collection('posts').doc(req.params.id);
    await docRef.update({
      title,
      content,
      author,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).json({ success: true, message: 'Konten berhasil diperbarui' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. DELETE: Hapus artikel
app.delete('/api/posts/:id', async (req, res) => {
  try {
    await db.collection('posts').doc(req.params.id).delete();
    res.status(200).json({ success: true, message: 'Konten berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. GET: Uji koneksi (hanya untuk debugging)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    ready: !initError,
    env: {
      hasFirebaseServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      hasFirebaseProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasFirebaseClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      hasFirebasePrivateKey: !!process.env.FIREBASE_PRIVATE_KEY
    }
  });
});

// Export untuk Vercel Serverless
module.exports = app;

// Jalankan server lokal jika tidak di Vercel
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
