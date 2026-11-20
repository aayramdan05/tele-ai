---
name: clipper
description: Mengunduh video podcast/YouTube, memotong highlight, menambahkan judul atas-bawah rasio 16:9 atau 9:16, subtitle otomatis, dan merender video untuk Reels/TikTok/Shorts
---

# Video Clipper Skill (Hermes Media Agent)

Gunakan helper `python scripts/clipper-helper.py` untuk mengunduh video dan memotong klip dengan FFmpeg.

## Panduan Penggunaan:
1. Jalankan `python scripts/clipper-helper.py` untuk proses otomatis.
2. File output harus disimpan di direktori `data/output/` dengan format nama yang jelas (misal `reels_tema_16x9.mp4`).
3. Sebutkan nama file output lengkap di respon akhir agar server Tele-AI otomatis mengirimkan video ke chat Telegram pengguna.
