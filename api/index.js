const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Path file JSON untuk penyimpanan data sementara
// Catatan di Vercel: /tmp bersifat ephemeral (sementara), gunakan database seperti MongoDB/Supabase untuk produksi jangka panjang.
const dataDir = path.join('/tmp');
const dataFilePath = path.join(dataDir, 'posts.json');

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

// API: Ambil semua postingan
app.get('/api/posts', (req, res) => {
  const posts = getPosts();
  res.json(posts);
});

// API: Tambah postingan baru
app.post('/api/posts', (req, res) => {
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

// API: Hapus postingan
app.delete('/api/posts/:id', (req, res) => {
  const postId = parseInt(req.params.id);
  let posts = getPosts();
  
  const filteredPosts = posts.filter(p => p.id !== postId);
  if (filteredPosts.length === posts.length) {
    return res.status(404).json({ error: 'Postingan tidak ditemukan' });
  }

  savePosts(filteredPosts);
  res.json({ message: 'Postingan berhasil dihapus' });
});

// Untuk menjalankan secara lokal di komputer (opsional)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;