## Identitas Mahasiswa

- **Nama:** Cantya Puspa
- **NIM:** 12030124140273
- **Kelas:** G
- 
# Covelle Textile CashFlow

Aplikasi pencatatan kas berbasis frontend statis dengan Supabase sebagai penyimpanan. 

Web Demo Aplikasi: [[Klik di sini untuk membuka Covelle Textile CashFlow](https://cantyapuspa3-sudo.github.io/Covelle-Textile-CashFloww/frontend/index.html)]

Versi ringkas ini menggunakan empat tabel bisnis:
- `cash_accounts` — akun kas/bank dan saldo awal.
- `categories` — kategori transaksi.
- `transactions` — penerimaan, pengeluaran, transfer, dan permintaan kas.
- `approvals` — keputusan dan riwayat persetujuan transaksi.

## Fitur

- Dashboard saldo akun dan transaksi terbaru.
- Pengelolaan akun kas dan kategori.
- Pencatatan transaksi kas masuk/keluar, transfer, petty cash, dan permintaan kas.
- Approval atau penolakan transaksi serta riwayat keputusan.
- Ringkasan laporan dari transaksi yang sudah `Approved` atau `Posted`.

Modul COA, departemen, user/role, jurnal, cash count, approval matrix, dan pengaturan imprest terpisah tidak termasuk dalam aplikasi ringkas ini.

## Struktur proyek

```text
.
├── .github/
├── backend/
│   ├── app.js
│   └── schema.sql
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── .gitignore
└── README.md
```

`schema.sql` ditujukan untuk setup database baru, bukan migrasi database lama.

## Menjalankan aplikasi

```powershell
node backend\app.js
```

Buka `http://127.0.0.1:3000`. Server ini hanya menyajikan file frontend; tidak menjalankan migration atau menyediakan backend autentikasi.

Konfigurasi Supabase frontend berada di `frontend/app.js` melalui `window.CASHFLOW_SUPABASE_CONFIG` (URL dan publishable/anon key). Gunakan hanya publishable/anon key di browser; jangan masukkan service-role key atau password ke frontend.

## Supabase

- Jalankan `backend/schema.sql` hanya pada database baru yang belum memiliki tabel target. Untuk database lama, skema ini bukan pengganti proses backfill/cutover.
- Untuk database lama, buat dan verifikasi backup terlebih dahulu. Tinjau foreign key, view, trigger, function, policy, dan aplikasi lain yang mungkin bergantung pada tabel legacy sebelum menghapusnya. Jangan gunakan `DROP ... CASCADE` untuk melewati dependency.
- Perubahan lokal ini tidak menjalankan atau menghapus tabel pada proyek Supabase. `schema.sql` sendiri tidak menghapus tabel legacy dan tidak memindahkan data.
- Jangan menganggap browser demo identity sebagai login sungguhan. Aplikasi saat ini tidak menyediakan Supabase Auth; identitas pengguna di UI bersifat demo.
- Kebijakan akses anon di `schema.sql` mempertahankan pola development sebelumnya. Ganti dengan RLS berbasis Supabase Auth dan aturan produksi sebelum menyimpan data sensitif atau membuka aplikasi untuk pengguna.
- SoD di trigger membandingkan snapshot nama aktor yang dikirim client. Tanpa autentikasi/identitas yang dipercaya database, pemeriksaan ini tidak cukup sebagai kontrol keamanan produksi.

## Validasi lokal

Periksa sintaks frontend dengan:

```powershell
node --check frontend\app.js
```

Tidak ada test suite otomatis atau koneksi database yang dijalankan oleh server statis.
