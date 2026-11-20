---
name: crypto-tracker
description: Memantau harga cryptocurrency real-time, tren pergerakan pasar, dan status token menggunakan CoinGecko API publik
---

# Crypto Tracker Skill

Mengambil harga dan analitik cryptocurrency secara langsung tanpa API key berbayar.

## Panduan:
- Ambil harga pasar via CoinGecko: `curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,idr"`
- Sajikan ringkasan harga dalam format yang rapi dan mudah dibaca di chat Telegram.
