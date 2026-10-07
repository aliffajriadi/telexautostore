# PRD: Platform Bot Telegram Terintegrasi AutoStore

> Dokumen ini ditulis sebagai instruksi untuk AI agent yang akan membangun proyeknya. Baca seluruhnya sebelum menulis kode. Kalau ada hal yang tidak jelas atau bertentangan dengan dokumen ini, **tanya dulu**, jangan menebak.

## 1. Ringkasan

Web panel multi-user tempat setiap user mendaftarkan **satu bot Telegram milik sendiri**. Bot itu menjual produk dari **AutoStore** (aplikasi toko lain, sumber semua data produk, stok, dan pembayaran). Pembeli di Telegram memilih produk, membayar via QRIS, lalu bot mengirim item hasil order setelah pembayaran terkonfirmasi lewat callback webhook.

Peran sistem ini hanya sebagai **jembatan**: katalog, stok, dan invoice QRIS semuanya urusan AutoStore. Sistem ini **tidak menyimpan stok dan tidak memproses pembayaran sendiri**.

## 2. Tujuan dan Non-Tujuan

**Tujuan**
- User bisa register, login, lalu menyambungkan bot Telegram + akun AutoStore lewat web.
- Bot menampilkan katalog, membuat order QRIS, dan mengirim item setelah bayar.
- Satu server menjalankan banyak bot sekaligus (1 user = 1 bot).
- Admin bisa memantau user, memblacklist, dan mengganti password user.

**Non-tujuan (versi 1)**
- Tidak ada saldo/deposit pembeli. Pembayaran hanya QRIS per order.
- Tidak ada pembayaran selain QRIS.
- Tidak ada fitur `!logs buy #channel` (itu perintah bot Discord milik AutoStore, bukan bagian proyek ini).
- Tidak ada manajemen produk. Semua produk dikelola di AutoStore.

## 3. Stack

| Bagian | Pilihan |
|---|---|
| Runtime | Node.js (LTS), TypeScript |
| Package manager | **pnpm** |
| Database | **MySQL** |
| ORM / skema | **Prisma** |
| Framework HTTP | Fastify (boleh Express kalau ada alasan kuat) |
| Library bot | grammY |
| Tampilan web | Server-rendered (EJS/Nunjucks) + sedikit JS biasa. Tidak perlu SPA. |
| Hash password | argon2id |
| Validasi input | zod |
| Enkripsi data sensitif | AES-256-GCM (modul `crypto` bawaan Node) |

Satu proses/service saja (web + bot + endpoint webhook). Jangan dipecah jadi microservice.

## 4. Peran Pengguna

1. **User (pemilik bot)**: register, login, mengatur bot dan integrasi, melihat order bot miliknya.
2. **Admin**: login ke halaman admin, memantau semua user, blacklist/unblacklist, reset password user.
3. **Pembeli**: pengguna Telegram yang chat ke bot milik seorang user. Tidak punya akun di web.

## 5. Alur Utama

### 5.1 Onboarding user
1. User buka halaman **Register**, isi form, lalu login.
2. Di dashboard, user mengisi:
   - **Token bot Telegram** (dari BotFather)
   - **URL AutoStore** (base URL)
   - **API key AutoStore**
3. Saat disimpan, sistem memvalidasi:
   - Token: panggil `getMe` ke Telegram. Gagal = tolak.
   - AutoStore: panggil `GET {url}/api/v1/integration/products` dengan API key. Gagal = tolak dan tampilkan pesan error yang jelas.
4. Jika valid, sistem:
   - mengenkripsi token bot dan API key sebelum disimpan,
   - membuat **callback key** dan **webhook secret** unik untuk user itu,
   - mendaftarkan webhook Telegram untuk bot tersebut,
   - menampilkan **Callback URL** dan **webhook secret** di dashboard (ada tombol salin dan tombol regenerate).
5. Status bot di dashboard: `Aktif`, `Nonaktif`, `Error`.

### 5.2 Pembeli membeli produk
1. Pembeli kirim `/start` ke bot. Bot menyapa dan menampilkan menu.
2. `/katalog`: bot mengambil produk dari AutoStore (cache singkat, lihat 7.4) dan menampilkan daftar dengan inline keyboard (nama, harga rupiah, stok). Produk stok 0 ditandai habis dan tidak bisa dipilih.
3. Pembeli pilih produk, lalu pilih jumlah (tombol angka atau ketik angka). Validasi: qty ≥ 1 dan ≤ stok yang tersedia.
4. Bot menampilkan ringkasan (produk, qty, total) dengan tombol **Bayar** dan **Batal**.
5. Saat **Bayar**, sistem:
   - membuat record order lokal status `PENDING_PAYMENT` dengan `externalReference` unik,
   - memanggil `POST {url}/api/v1/integration/orders/qris` dengan `productId`, `qty`, `externalReference`, `webhookUrl` (Callback URL milik user), dan `webhookSecret` (secret milik user),
   - mengirim QRIS ke pembeli (gambar QR atau link, tergantung isi respons AutoStore) beserta kode invoice, total, dan batas waktu bayar bila ada.
6. Pembeli membayar. AutoStore mengirim callback `order.paid` ke Callback URL.
7. Sistem memverifikasi, memperbarui order, lalu bot mengirim `deliveredItems` ke pembeli.
8. `/riwayat`: pembeli melihat order terakhirnya. `/cek <kode>`: cek status satu order.

### 5.3 Callback dari AutoStore
Endpoint: `POST /webhook/autostore/:callbackKey`

Urutan proses (wajib berurutan):
1. Cari user dari `callbackKey`. Tidak ketemu = `404`.
2. Ambil **raw body** persis seperti diterima (jangan di-parse lalu di-stringify ulang).
3. Hitung HMAC SHA-256 dari raw body memakai webhook secret user. Bandingkan dengan header `X-Store-Signature` (format `sha256=<hex>`) memakai **timing-safe compare**. Tidak cocok = `401`, jangan diproses.
4. Parse JSON. Cari order lokal lewat `externalReference`. Tidak ketemu = catat log, balas `200` (agar tidak di-retry terus).
5. **Idempoten**: kalau order sudah `PAID`/`DELIVERED`, balas `200` tanpa kirim ulang item. Gunakan `invoiceCode` sebagai kunci dedup.
6. Update order sesuai `order.status`:
   - `success` → simpan `deliveredItems`, status `PAID`, kirim item ke pembeli, lalu status `DELIVERED`.
   - `pending` → status `PAID_MANUAL_PENDING` (stok perlu diproses manual di AutoStore). Beri tahu pembeli bahwa pembayaran diterima dan item sedang diproses.
7. Balas `200` secepatnya. Pengiriman pesan Telegram boleh lanjut di belakang, tapi harus ada retry kalau gagal.

Kalau user sedang di-blacklist, callback tetap **diterima dan dicatat** (uang pembeli sudah masuk), tetapi pesan ke pembeli tetap dikirim lewat bot hanya jika kebijakan di 6.3 mengizinkan. Lihat 6.3.

## 6. Kebutuhan Fungsional

### 6.1 Autentikasi dan akun user
- **Form register**: field `username`, `email`, `password`, `konfirmasi password`. Validasi: username unik (3–20 karakter, huruf/angka/underscore), email valid dan unik, password minimal 8 karakter.
- Admin bisa menonaktifkan pendaftaran lewat pengaturan (`registrationEnabled`).
- **Login** dengan email atau username + password. Session berbasis cookie `httpOnly`, `secure` (di produksi), `sameSite=lax`. Simpan session di MySQL.
- Proteksi: CSRF token di semua form POST, rate limit login (misal 5 percobaan per 15 menit per IP + akun), pesan error login tidak membocorkan apakah akun ada atau tidak.
- User yang login bisa **ganti password sendiri** (wajib isi password lama).
- Logout.

### 6.2 Dashboard user
- **Pengaturan integrasi**: form token bot, URL AutoStore, API key. Saat edit, nilai rahasia tidak ditampilkan penuh (tampilkan `••••` + 4 karakter terakhir); kosongkan input berarti tidak diubah.
- Tombol **Tes koneksi** (cek token bot dan API AutoStore).
- Tampilkan **Callback URL** dan **webhook secret** dengan tombol salin dan **Regenerate** (regenerate = key/secret lama langsung tidak berlaku; beri peringatan).
- Tombol **Aktifkan / Nonaktifkan bot**.
- **Daftar order** milik user (filter status, pencarian kode order, paginasi): kode invoice, produk, qty, total, status, waktu.
- Ringkasan: total order, total sukses, total omzet, jumlah pembeli unik.

### 6.3 Halaman Admin
Akses di `/admin`, hanya untuk role `ADMIN`. Akun admin pertama dibuat lewat script seed (`pnpm seed:admin`), bukan lewat form register.

- **Daftar user**: tabel dengan username, email, tanggal daftar, status (`ACTIVE`/`BLACKLISTED`), status bot, jumlah order, login terakhir. Ada pencarian dan paginasi.
- **Detail user**: info akun, status bot, waktu callback terakhir, daftar order, riwayat error integrasi. Admin **tidak boleh bisa melihat** token bot atau API key dalam bentuk asli.
- **Blacklist / unblacklist** dengan kolom alasan. Efek blacklist:
  - user tidak bisa login dan session aktifnya dihapus,
  - bot dinonaktifkan (webhook Telegram dihapus, bot berhenti membalas pembeli baru),
  - callback `order.paid` untuk order yang **sudah ada** tetap diproses dan item tetap dikirim ke pembeli (supaya pembeli yang sudah bayar tidak dirugikan); order baru tidak bisa dibuat.
- **Ganti password user**: admin mengisi password baru (atau generate acak yang ditampilkan sekali). Semua session user itu dihapus setelahnya.
- **Dashboard ringkas**: total user, user aktif, bot aktif, order hari ini, order gagal/error terbaru.
- **Audit log**: setiap aksi admin (blacklist, unblacklist, reset password) tercatat: siapa, ke siapa, kapan, alasan.

### 6.4 Bot Telegram
- Perintah: `/start`, `/katalog`, `/riwayat`, `/cek <kode>`, `/bantuan`.
- Semua interaksi pilihan memakai inline keyboard. Pesan error ramah, tidak menampilkan detail teknis ke pembeli.
- Satu pembeli sebaiknya maksimal punya N order `PENDING_PAYMENT` aktif sekaligus (default 3) untuk mencegah spam invoice.
- Order `PENDING_PAYMENT` yang melewati batas waktu (default 30 menit, atau ikuti expiry dari AutoStore bila ada) diubah ke `EXPIRED` oleh job terjadwal.

## 7. Kebutuhan Teknis

### 7.1 Banyak bot dalam satu server
- Gunakan **mode webhook Telegram**, bukan long polling. Tiap bot didaftarkan ke `https://<domain>/telegram/:botKey` dengan parameter `secret_token`. Endpoint memverifikasi header `X-Telegram-Bot-Api-Secret-Token`.
- `botKey` acak dan unik per bot (bukan token asli).
- Instance grammY dibuat dan di-cache per bot (lazy), dan dibuang saat bot dinonaktifkan atau user di-blacklist.
- Saat server restart, tidak perlu daftar ulang webhook kecuali konfigurasi berubah. Sediakan script `pnpm bots:resync` untuk sinkronisasi ulang.

### 7.2 Keamanan data
- Token bot dan API key AutoStore **dienkripsi** (AES-256-GCM) dengan kunci dari env `ENCRYPTION_KEY` (32 byte). Simpan `iv` dan `authTag` bersama ciphertext.
- Webhook secret disimpan terenkripsi juga (dibutuhkan untuk menghitung HMAC dan dikirim ke AutoStore).
- Jangan pernah menulis token, API key, atau secret ke log.
- **Perlindungan SSRF** pada URL AutoStore: hanya `http`/`https`; di produksi tolak `localhost`, IP privat/loopback/link-local (cek hasil DNS, bukan hanya hostname); batasi timeout (10 detik) dan ukuran respons; jangan ikuti redirect ke host lain. HTTP lokal hanya diizinkan bila `NODE_ENV !== production`.
- Semua query lewat Prisma (tidak ada SQL mentah dari input user). Escape output di template.
- Header keamanan (helmet atau setara), rate limit di endpoint publik (register, login, webhook).

### 7.3 Integrasi AutoStore
Dua endpoint yang dipakai (otentikasi memakai API key milik user; **cek dokumentasi AutoStore untuk nama header-nya**, jangan ditebak):

`GET /api/v1/integration/products` → daftar produk aktif.
Field yang dipakai: `id`, `name`, `category`, `priceWl`, `priceRupiah`, `currencyMode`, `deliveryType`, `stockCount`.
Hanya tampilkan harga rupiah di bot. Produk yang `currencyMode`-nya tidak mendukung rupiah disembunyikan.

`POST /api/v1/integration/orders/qris`
```json
{
  "productId": 1,
  "qty": 2,
  "externalReference": "tg-<orderId>",
  "webhookUrl": "https://<domain>/webhook/autostore/<callbackKey>",
  "webhookSecret": "<secret-user, minimal 16 karakter>"
}
```
- `externalReference` harus unik per order dan **dipakai ulang persis sama saat retry** agar invoice tidak dobel. Format: `tg-` + id order lokal.
- Kalau request gagal karena timeout/jaringan, retry (maks 3x dengan jeda bertahap) memakai `externalReference` yang sama. Jangan buat order lokal baru.

Callback `order.paid`: header `X-Store-Event: order.paid`, `X-Store-Signature: sha256=<hmac>`. Body berisi `invoiceCode`, `externalReference`, `order.{orderCode,status,productId,productName,qty,amount,currency,deliveredItems}`, `paidAt`. `order.status` bernilai `success` atau `pending`.

> **Catatan celah spesifikasi**: format respons `POST .../orders/qris` (field QRIS/gambar, kode invoice, expiry) dan nama header autentikasi API key belum ada di data yang diberikan. Bangun lewat satu modul adapter (`autostore-client.ts`) dengan tipe respons yang mudah diubah, tandai dengan `TODO` di bagian yang belum pasti, dan minta contoh respons nyata ke pemilik proyek sebelum finalisasi.

### 7.4 Cache dan performa
- Cache katalog per user selama 30–60 detik (in-memory) supaya tidak menembak AutoStore di setiap tap tombol.
- Sebelum membuat invoice, **selalu cek ulang** stok ke AutoStore (jangan percaya cache).
- Pengiriman pesan Telegram harus menghormati rate limit (antrean sederhana per bot, retry saat `429` dengan `retry_after`).

### 7.5 Logging dan error
- Log terstruktur (pino). Setiap callback, order, dan error integrasi tercatat dengan `userId` dan `orderId`, tanpa data rahasia.
- Tabel `IntegrationEvent` menyimpan kejadian penting (callback ditolak, gagal kirim pesan, gagal panggil AutoStore) agar bisa dilihat di detail user di halaman admin.

## 8. Skema Database (Prisma, draf awal)

```prisma
datasource db { provider = "mysql"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

enum Role { USER ADMIN }
enum UserStatus { ACTIVE BLACKLISTED }
enum OrderStatus { PENDING_PAYMENT PAID_MANUAL_PENDING PAID DELIVERED EXPIRED FAILED CANCELLED }

model User {
  id            Int        @id @default(autoincrement())
  username      String     @unique @db.VarChar(32)
  email         String     @unique @db.VarChar(191)
  passwordHash  String
  role          Role       @default(USER)
  status        UserStatus @default(ACTIVE)
  blacklistReason String?
  lastLoginAt   DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  integration   Integration?
  sessions      Session[]
}

model Session {
  id        String   @id
  userId    Int
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Integration {
  id                Int      @id @default(autoincrement())
  userId            Int      @unique
  botKey            String   @unique @db.VarChar(64)      // untuk URL webhook Telegram
  botTokenEnc       String   @db.Text
  botUsername       String?
  telegramSecret    String   @db.VarChar(64)              // secret_token webhook Telegram
  autostoreUrl      String   @db.VarChar(255)
  apiKeyEnc         String   @db.Text
  callbackKey       String   @unique @db.VarChar(64)      // untuk URL callback AutoStore
  webhookSecretEnc  String   @db.Text
  botActive         Boolean  @default(false)
  lastCallbackAt    DateTime?
  lastError         String?  @db.Text
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orders            Order[]
}

model Buyer {
  id             Int      @id @default(autoincrement())
  integrationId  Int
  telegramId     BigInt
  username       String?
  firstName      String?
  createdAt      DateTime @default(now())
  orders         Order[]
  @@unique([integrationId, telegramId])
}

model Order {
  id                 Int         @id @default(autoincrement())
  integrationId      Int
  buyerId            Int
  externalReference  String      @unique @db.VarChar(64)   // "tg-<id>"
  invoiceCode        String?     @unique @db.VarChar(64)
  orderCode          String?     @db.VarChar(64)
  productId          Int
  productName        String      @db.VarChar(191)
  qty                Int
  amount             Int
  status             OrderStatus @default(PENDING_PAYMENT)
  deliveredItems     Json?
  expiresAt          DateTime?
  paidAt             DateTime?
  deliveredAt        DateTime?
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt
  integration        Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  buyer              Buyer       @relation(fields: [buyerId], references: [id])
  @@index([integrationId, status])
  @@index([buyerId])
}

model IntegrationEvent {
  id            Int      @id @default(autoincrement())
  integrationId Int
  type          String   @db.VarChar(64)
  message       String   @db.Text
  createdAt     DateTime @default(now())
  @@index([integrationId, createdAt])
}

model AdminAuditLog {
  id           Int      @id @default(autoincrement())
  adminId      Int
  targetUserId Int
  action       String   @db.VarChar(64)   // BLACKLIST, UNBLACKLIST, RESET_PASSWORD
  reason       String?  @db.Text
  createdAt    DateTime @default(now())
}

model Setting {
  key   String @id @db.VarChar(64)
  value String @db.Text                   // contoh: registrationEnabled
}
```

Agent boleh menyesuaikan tipe/indeks selama relasi dan batasan unik di atas tetap terjaga.

## 9. Struktur Rute

**Web**
- `GET/POST /register`, `GET/POST /login`, `POST /logout`
- `GET /dashboard`, `POST /dashboard/integration`, `POST /dashboard/integration/test`
- `POST /dashboard/integration/regenerate-callback`, `POST /dashboard/bot/toggle`
- `GET /dashboard/orders`, `GET/POST /account/password`
- `GET /admin`, `GET /admin/users`, `GET /admin/users/:id`
- `POST /admin/users/:id/blacklist`, `POST /admin/users/:id/unblacklist`, `POST /admin/users/:id/reset-password`
- `GET /admin/audit`

**Publik (tanpa session)**
- `POST /telegram/:botKey` (update dari Telegram)
- `POST /webhook/autostore/:callbackKey` (callback AutoStore)
- `GET /health`

## 10. Variabel Environment

```
NODE_ENV=
PORT=
APP_URL=https://domain-publik-kamu      # dasar untuk webhook Telegram & callback
DATABASE_URL=mysql://user:pass@host:3306/db
SESSION_SECRET=
ENCRYPTION_KEY=                         # 32 byte, base64/hex
ADMIN_EMAIL=                            # untuk seed admin
ADMIN_PASSWORD=
```

## 11. Struktur Folder yang Disarankan

```
src/
  server.ts
  config/            # env, konstanta
  modules/
    auth/            # register, login, session
    dashboard/
    admin/
    bot/             # manager multi-bot, handler grammY
    autostore/       # client + tipe
    webhook/         # handler callback + verifikasi signature
    orders/
  lib/               # crypto, logger, queue, ssrf-guard
  views/
prisma/
  schema.prisma
  seed-admin.ts
```

## 12. Kriteria Penerimaan

1. User baru bisa register, login, mengisi token + URL + API key valid, dan bot langsung merespons `/start`.
2. Token/API key salah ditolak dengan pesan jelas. Data tersimpan terenkripsi (cek langsung di DB: tidak ada plaintext).
3. Pembeli bisa melihat katalog, memilih produk, dan menerima QRIS. Retry request tidak membuat invoice dobel.
4. Callback dengan signature valid membuat item terkirim ke pembeli tepat sekali, bahkan jika callback dikirim berulang.
5. Callback dengan signature salah ditolak `401` dan tidak mengubah data apa pun.
6. Callback `status: pending` membuat pembeli menerima pesan "sedang diproses" dan order berstatus `PAID_MANUAL_PENDING`.
7. Dua user berbeda dengan dua bot berbeda berjalan bersamaan tanpa data tercampur (callback key dan secret terpisah).
8. Admin bisa melihat semua user, blacklist (user langsung tidak bisa login, bot berhenti), unblacklist, dan reset password (session lama hangus). Semua tercatat di audit log.
9. Admin tidak bisa melihat token/API key asli.
10. Rate limit login berfungsi; semua form POST dilindungi CSRF.
11. URL AutoStore internal (misal `http://127.0.0.1`) ditolak saat `NODE_ENV=production`.

## 13. Tahapan Pengerjaan

1. **Fondasi**: setup pnpm, TypeScript, Prisma + MySQL, migrasi awal, modul crypto, seed admin.
2. **Auth**: register, login, session, ganti password, rate limit, CSRF.
3. **Dashboard + integrasi**: form pengaturan, tes koneksi, enkripsi, pembuatan callback key/secret, SSRF guard.
4. **Bot**: manager multi-bot (webhook), katalog, alur beli, pembuatan invoice QRIS, riwayat.
5. **Callback**: verifikasi signature, idempotensi, pengiriman item, job expire order.
6. **Admin**: daftar/detail user, blacklist, reset password, audit log, dashboard ringkas.
7. **Hardening**: logging, retry, pengujian, README (cara deploy, env, seed, resync bot).

Setiap tahap diakhiri dengan pengujian yang bisa dijalankan. Tulis test otomatis minimal untuk: verifikasi signature, idempotensi callback, enkripsi/dekripsi, dan aturan blacklist.

## 14. Pertanyaan Terbuka (konfirmasi ke pemilik proyek)

1. Contoh respons lengkap `POST /api/v1/integration/orders/qris` (field QRIS, kode invoice, expiry).
2. Nama header autentikasi API key AutoStore.
3. Apakah ada batas waktu bayar default dari AutoStore, atau sistem ini yang menetapkan?
4. Apakah pemilik bot perlu notifikasi di Telegram pribadi saat ada order baru terbayar? (ditunda ke versi 2 kalau belum jelas)
5. Domain publik dan hosting yang akan dipakai (butuh HTTPS untuk webhook Telegram).