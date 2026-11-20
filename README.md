# ⚡ Tele-AI Studio — Autonomous VPS Agent & Quota Flow Monitor

Sistem AI Agent otonom yang berjalan di server VPS lokal (`10.69.69.53`), dikendalikan langsung lewat obrolan Telegram dengan Web UI Dashboard monitoring kuota & alur kerja (*Live Flow Monitor*) seperti 9router, namun dengan arsitektur terlindungi agar **bebas dari pemblokiran Error 403 Google**.

---

## 🚀 Fitur Unggulan

1. **Telegram sebagai Prompt Bebas:**
   - Chat santai di Telegram layaknya asisten pribadi: *"Buatkan video reels 16:9 judul atas-bawah dan subtitle"*, *"Cek resource server"*, *"Bikinkan cronjob backup"*.
   - AI Agent memiliki akses penuh ke terminal dan filesystem VPS.
   - Mengirimkan file hasil jadi (video MP4, gambar, script) langsung ke Telegram Anda.

2. **Google OAuth 2.0 & Antigravity CLI (`agy`) Engine:**
   - Mendukung otentikasi Google OAuth via Web UI (mirip Munder Difflin).
   - Mendukung pemanfaatan sesi login `agy` (Antigravity CLI) yang sudah ada di mesin secara native.
   - Pilihan model cerdas: `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`, dll.

3. **Web UI Live Flow Monitor (9router-style):**
   - **Dashboard Kuota:** Pantau RPM, TPM, jumlah request harian, dan estimasi biaya token.
   - **Live Flow Monitor:** Streaming log real-time melalui WebSocket (Pesan masuk -> Pemikiran Agent -> Eksekusi Terminal -> Respon).
   - **Interactive Agent Console:** Uji prompt AI langsung dari web browser.

4. **Arsitektur Anti-403 Protection (Beda Cara Kerja dari 9router):**
   - **Strict Concurrency = 1:** Memproses request secara serial (antrean FIFO).
   - **Human Pacing Delay:** Jeda alami (default 2000ms) antar eksekusi tool agar tidak terdeteksi sebagai serangan bot.
   - **Circuit Breaker:** Otomatis cooling down (pause 5 menit) jika terdeteksi indikasi 429/403, menghentikan loop error tanpa retry spam.
   - **Smart Context Truncation:** Log terminal panjang (seperti FFmpeg/yt-dlp) diringkas sebelum masuk ke context token agar kuota tidak jebol.

5. **Reels Clipper Studio & Cron Automations:**
   - Script helper bawaan: `scripts/clipper-helper.py` untuk mengunduh video otomatis, memotong highlight, menambahkan padding bar atas-bawah rasio 16:9 / 9:16, mencetak judul tebal dan subtitle.
   - Scheduler cronjob bawaan untuk eksekusi berkala tanpa campur tangan user.

---

## 🛠️ Panduan Instalasi & Menjalankan di VPS (10.69.69.53)

### 1. Prasyarat Sistem di VPS
Pastikan di VPS sudah terpasang:
- **Node.js** (v18 ke atas)
- **Python 3** & **pip**
- **FFmpeg** (`sudo apt install ffmpeg` di Ubuntu/Debian)
- **yt-dlp** (`pip install yt-dlp`)

### 2. Menjalankan Aplikasi
```bash
cd "D:\Unpad\Infra Apps\tele-ai" # Atau path di VPS Anda
npm install
node server/index.js
```

Untuk menjalankan di background VPS secara 24/7 menggunakan PM2:
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Buka browser dan akses Web Dashboard:
👉 **`http://10.69.69.53:3000`** (atau `http://localhost:3000`)

---

## ⚙️ Langkah Konfigurasi Pertama Kali

1. **Atur Telegram Bot:**
   - Buka tab **Settings & OAuth** di Web Dashboard.
   - Masukkan **Telegram Bot Token** dari `@BotFather`.
   - Klik **Tes Token** untuk memverifikasi.
   - Hubungi bot Anda di Telegram dan ketik `/start`. Bot akan memberi tahu **Chat ID** Anda.
   - Masukkan Chat ID tersebut ke kolom **Whitelisted Chat IDs** di Web Dashboard, lalu klik **Simpan Pengaturan Telegram**.

2. **Pilih Engine & OAuth:**
   - Pilih engine:
     - **Antigravity CLI (agy)**: Jika VPS sudah terpasang `agy` yang terotentikasi.
     - **Google Gemini OAuth 2.0**: Masukkan Google Client ID & Secret, lalu klik tombol **Hubungkan Akun Google OAuth**.
     - **Gemini API Key**: Masukkan API key jika ingin menggunakan jalur resmi.
   - Klik **Simpan Pengaturan Engine**.

3. **Mulai Perintah dari Telegram:**
   - Kirim chat ke bot Telegram Anda:
     > *"Tolong carikan video podcast menarik, potong 1 menit, tambahkan judul atas 'RAHASIA SUKSES' dan judul bawah 'Tonton sampai habis', render rasio 16:9 dan kirim videonya kesini"*
   - Buka tab **Live Flow Monitor** di Web Dashboard untuk melihat AI Agent Anda berpikir, mengeksekusi terminal, dan mengirimkan video kembali ke Telegram secara real-time!
