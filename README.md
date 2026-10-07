# TelexAutoStore

Web panel multi-user untuk mengelola bot Telegram yang terintegrasi dengan AutoStore.

## Persyaratan
- Node.js LTS (v18 atau lebih baru)
- pnpm
- MySQL database

## Cara Instalasi

1. Clone repositori ini.
2. Salin `.env.example` ke `.env` dan sesuaikan nilainya (terutama `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, dan kredensial admin).
3. Jalankan `pnpm install` untuk mengunduh semua dependency.
4. Jalankan migrasi database dan generate Prisma client:
   ```bash
   pnpm db:push
   pnpm db:generate
   ```
5. Buat akun Admin pertama dengan menjalankan seed:
   ```bash
   pnpm seed:admin
   ```
6. Build project (Backend & Frontend):
   ```bash
   pnpm build
   pnpm client:build
   ```

## Menjalankan Server

Untuk mode development (dengan reload otomatis):
```bash
pnpm dev
```
(Jalankan juga server vite frontend di terminal lain jika ingin hot-reload web-nya: `pnpm client:dev`)

Untuk produksi:
```bash
pnpm start
```

## Test

```bash
pnpm test
```
Mencakup enkripsi/dekripsi, verifikasi signature callback, SSRF guard, dan CSRF.

## Catatan Rute

- API web panel ada di bawah prefix `/api` (misal `/api/login`, `/api/dashboard`, `/api/admin/stats`). Semua request non-GET ke `/api` wajib membawa header `X-XSRF-TOKEN` yang sama dengan cookie `XSRF-TOKEN` (axios di frontend melakukannya otomatis).
- Endpoint publik tetap di luar `/api`: `POST /telegram/:botKey`, `POST /webhook/autostore/:callbackKey`, `GET /health`.
- `AUTOSTORE_API_KEY_HEADER` (default `X-Api-Key`) menentukan nama header API key ke AutoStore. Sesuaikan dengan dokumentasi AutoStore.

## Fitur Utama

- **Multi-user bot:** Tiap user mendaftarkan 1 bot Telegram.
- **AutoStore Webhook:** Menerima notifikasi pembayaran sukses/pending.
- **Bot Katalog & QRIS:** Menampilkan katalog dan memproses tagihan otomatis ke pembeli.
- **Panel Admin:** Mengelola semua pendaftaran user dan melakukan aksi blacklist/reset password.
