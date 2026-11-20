---
name: facebook-uploader
description: Mengunggah video Reels secara otomatis ke Facebook Page menggunakan Facebook Graph API dan token yang tersimpan di server
---

# Facebook Reels Auto Uploader (Hermes Media Integration)

Gunakan helper `python scripts/facebook-uploader.py` untuk mengunggah video reels/MP4 ke Facebook Page secara otomatis.

## Panduan Penggunaan:
1. Pastikan `facebook_page_access_token` dan `facebook_page_id` telah tersimpan di server database via tool `save_server_setting`.
2. Untuk menguji koneksi token:
   `python scripts/facebook-uploader.py --test`
3. Untuk mengunggah video Reels yang telah dirender di `data/output/`:
   `python scripts/facebook-uploader.py --video "data/output/reels_nama.mp4" --title "Judul Menarik" --description "Caption viral #reels #fyp"`
4. Setelah upload sukses, laporkan Video ID dan link video ke chat Telegram pengguna.
