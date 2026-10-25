## Identitas Mahasiswa

- **Nama:** Cantya Puspa
- **NIM:** 12030124140273
- **Kelas:** G

# Covelle Textile CashFlow

Aplikasi pencatatan kas berbasis frontend statis dengan Supabase sebagai penyimpanan. 

Repository: [cantyapuspa3-sudo/Covelle-Textile-CashFloww](https://github.com/cantyapuspa3-sudo/Covelle-Textile-CashFloww)

Web Demo Aplikasi: [Klik di sini untuk membuka Covelle Textile CashFlow](https://cantyapuspa3-sudo.github.io/Covelle-Textile-CashFloww/frontend/index.html)

Versi ini menggunakan tabel bisnis berikut:
- `branches` — master cabang.
- `cash_accounts` — akun kas/bank dan saldo awal.
- `transactions` — penerimaan, pengeluaran, transfer, dan permintaan kas.
- `approvals` — riwayat keputusan transaksi.

## Fitur

- Dashboard saldo akun dan transaksi terbaru.
- Peringatan saldo minimum per akun kas di dashboard, memakai transaksi Approved/Posted.
- Pengelolaan cabang dan akun kas, termasuk saldo minimum per akun.
- Pencatatan transaksi kas masuk/keluar, transfer, petty cash, dan permintaan kas.
- Approval transaksi dan riwayat keputusan.
- Laporan arus kas langsung dengan filter periode, akun kas, dan cabang serta ekspor CSV.
- Saldo dan laporan hanya memakai transaksi `Approved` atau `Posted`; transfer antar-akun tidak dihitung sebagai penerimaan/pengeluaran perusahaan.

Login dan fitur reimbursement tidak digunakan pada versi ini. Data reimbursement, konfigurasi Auth, dan file privat yang sudah ada di Supabase tidak dihapus.

Modul COA, departemen, user/role, jurnal, cash count, approval matrix, dan pengaturan imprest terpisah tidak termasuk dalam aplikasi ringkas ini.

## Struktur proyek

```text
.
├── .github/
├── backend/
│   ├── app.js
│   ├── migrations/
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

Buka `http://127.0.0.1:3000`. Server ini hanya menyajikan file frontend dan tidak menjalankan migration.

Konfigurasi Supabase frontend berada di `frontend/app.js` melalui `window.CASHFLOW_SUPABASE_CONFIG` (URL dan publishable/anon key). Hanya publishable/anon key yang boleh berada di browser; jangan masukkan service-role key atau password ke frontend.

## Supabase

- Aplikasi tidak meminta login dan menggunakan Supabase publishable/anon key dari browser. Karena itu data kas, master cabang/akun kas, transaksi, dan approval dapat dibaca atau diubah siapa pun yang dapat mengakses situs. Jangan gunakan konfigurasi ini untuk data rahasia atau lingkungan produksi yang memerlukan kontrol akses.
- Database baru: jalankan `backend/schema.sql`, migration cabang, migration saldo minimum/bukti, lalu `20261025_remove_login_restore_public_cashflow.sql` di SQL Editor Supabase. Jangan jalankan migration Auth/reimbursement untuk instalasi baru tanpa login.
- Database lama yang sudah menjalankan migration Auth/reimbursement: buat dan verifikasi backup yang dapat dipulihkan, tinjau foreign key, view, trigger, function, policy, serta aplikasi lain; pastikan migration cabang dan saldo minimum/bukti sudah diterapkan; lalu tinjau dan jalankan `20261025_remove_login_restore_public_cashflow.sql`. Jangan rerun `schema.sql` sebagai migrasi.
- Migration Auth/reimbursement lama (`20261010_reimbursement_auth_exports.sql`) mengarsipkan kategori lalu menghapus `public.categories`, membuat tabel reimbursement, serta mengganti kebijakan akses. Jangan jalankan ulang. Migration pemulihan akses tanpa login tidak menghapus tabel, data reimbursement, bucket, file, ataupun akun Supabase Auth yang sudah ada.
- Migration pemulihan akses tanpa login mengizinkan akses publik pada data kas dan master, serta approval melalui RPC yang mencatat nama penyetuju yang diinput pengguna. Nama tersebut tidak diverifikasi oleh sistem identitas; siapa pun dapat membuat keputusan approval. Ini bukan mekanisme aman untuk data keuangan.
- Migration cabang mengaitkan akun dan transaksi lama ke `Kantor Pusat`; setelah migrasi, periksa dan pindahkan akun yang seharusnya berada di `Pabrik` melalui menu Akun Kas.
- Bucket `cashflow-evidence` dan `reimbursement-receipts` tetap privat. Upload dan pratinjau bukti dinonaktifkan tanpa login; file lama tidak dihapus.
- SQL migration di repository adalah instruksi untuk ditinjau dan dijalankan manual. Aplikasi/server tidak menjalankan SQL dan perubahan kode tidak otomatis mengubah proyek Supabase. Jangan gunakan `DROP ... CASCADE` untuk melewati dependency.

## Validasi lokal

Periksa sintaks frontend dengan:

```powershell
node --check frontend\app.js
```

Server statis hanya menyajikan frontend. Tidak ada koneksi database live atau migration yang otomatis dijalankan oleh server.
