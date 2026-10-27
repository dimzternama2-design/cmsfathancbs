const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Path file JSON untuk penyimpanan data sementara
// Catatan di Vercel: /tmp bersifat ephemeral (sementara), gunakan database seperti MongoDB/Supabase untuk produksi jangka panjang.
const dataDir = path.join('/tmp');
const dataFilePath = path.join(dataDir, 'posts.json');

// ===== Konfigurasi area admin =====
// Setel ADMIN_USERNAME dan ADMIN_PASSWORD lewat environment variable (Vercel: Settings -> Environment Variables).
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const SESSION_COOKIE = 'cms_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 hari

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[admin] ADMIN_PASSWORD belum diatur, memakai default. Setel env ADMIN_PASSWORD untuk produksi.');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('hex');
}

function createSessionToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  return `${exp}.${sign(exp)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const sep = token.indexOf('.');
  if (sep < 0) return false;
  const expStr = token.slice(0, sep);
  const sig = token.slice(sep + 1);
  const expected = sign(expStr);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const exp = parseInt(expStr, 10);
  return Number.isFinite(exp) && Date.now() < exp;
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function isSecure(req) {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

// Tolak permintaan dari origin lain (perlindungan CSRF sederhana).
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.host || '');
  } catch (err) {
    return false;
  }
}

// Middleware: hanya admin yang boleh menulis data.
function requireAdmin(req, res, next) {
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'Asal permintaan tidak diizinkan' });
  }
  if (!verifySessionToken(getCookie(req, SESSION_COOKIE))) {
    return res.status(401).json({ error: 'Akses ditolak, silakan login sebagai admin' });
  }
  next();
}

// Inisialisasi file data jika belum ada
function getPosts() {
  try {
    if (!fs.existsSync(dataFilePath)) {
      const initialData = [
        { id: 1, title: 'Halo Dunia', content: 'Selamat datang di CMS sederhana Anda!', date: new Date().toISOString() }
      ];
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(dataFilePath, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const data = fs.readFileSync(dataFilePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function savePosts(posts) {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(posts, null, 2));
  } catch (err) {
    console.error('Gagal menyimpan data:', err);
  }
}

// Serve file statis dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// ===== Autentikasi admin =====
app.get('/api/me', (req, res) => {
  const authenticated = verifySessionToken(getCookie(req, SESSION_COOKIE));
  res.json({ authenticated, username: authenticated ? ADMIN_USERNAME : null });
});

app.post('/api/login', (req, res) => {
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'Asal permintaan tidak diizinkan' });
  }
  const { username, password } = req.body || {};
  const okUser = typeof username === 'string' && safeEqual(username, ADMIN_USERNAME);
  const okPass = typeof password === 'string' && safeEqual(password, ADMIN_PASSWORD);
  if (!okUser || !okPass) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = createSessionToken();
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
  res.json({ ok: true, username: ADMIN_USERNAME });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// ===== API artikel =====
// API: Ambil semua postingan (publik, baca-saja)
app.get('/api/posts', (req, res) => {
  const posts = getPosts();
  res.json(posts);
});

// API: Tambah postingan baru (khusus admin)
app.post('/api/posts', requireAdmin, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Judul dan konten wajib diisi!' });
  }

  const posts = getPosts();
  const newPost = {
    id: Date.now(),
    title,
    content,
    date: new Date().toISOString()
  };

  posts.unshift(newPost);
  savePosts(posts);

  res.status(201).json(newPost);
});

// API: Hapus postingan (khusus admin)
app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  const postId = parseInt(req.params.id);
  let posts = getPosts();
  
  const filteredPosts = posts.filter(p => p.id !== postId);
  if (filteredPosts.length === posts.length) {
    return res.status(404).json({ error: 'Postingan tidak ditemukan' });
  }

  savePosts(filteredPosts);
  res.json({ message: 'Postingan berhasil dihapus' });
});

// Halaman admin: /admin -> /admin.html
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// Untuk menjalankan secara lokal di komputer (opsional)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT} (publik) dan http://localhost:${PORT}/admin (admin)`);
  });
}

module.exports = app;