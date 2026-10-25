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
- `approvals` — riwayat keputusan transaksi dan reimbursement.
- `reimbursements` — pengajuan reimbursement beserta bukti.

## Fitur

- Dashboard saldo akun dan transaksi terbaru.
- Peringatan saldo minimum per akun kas di dashboard, memakai transaksi Approved/Posted.
- Pengelolaan cabang dan akun kas, termasuk saldo minimum per akun.
- Pencatatan transaksi kas masuk/keluar, transfer, petty cash, dan permintaan kas, dengan bukti transaksi opsional PDF/JPG/JPEG/PNG.
- Login Supabase Auth, approval transaksi/reimbursement, dan riwayat keputusan.
- Pengajuan reimbursement, bukti privat di Supabase Storage, serta pembayaran yang tercatat sebagai transaksi kas keluar.
- Bukti transaksi tersimpan di Supabase Storage dan dapat ditinjau approver.
- Laporan arus kas langsung dengan filter periode, akun kas, dan cabang serta ekspor CSV.
- Saldo dan laporan hanya memakai transaksi `Approved` atau `Posted`; transfer antar-akun tidak dihitung sebagai penerimaan/pengeluaran perusahaan.

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
│   ├── auth.css
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

Konfigurasi Supabase frontend berada di `frontend/app.js` melalui `window.CASHFLOW_SUPABASE_CONFIG` (URL dan publishable/anon key). Hanya publishable/anon key yang boleh berada di browser; jangan masukkan service-role key atau password ke frontend.

## Supabase

- Database baru: jalankan `backend/schema.sql`, lalu migration Auth/reimbursement, migration cabang, dan migration saldo minimum/bukti di SQL Editor Supabase.
- Database lama: buat dan verifikasi backup yang dapat dipulihkan; tinjau foreign key, view, trigger, function, policy, dan aplikasi lain; lalu jalankan migration Auth/reimbursement satu kali, migration cabang, dan migration saldo minimum/bukti. Jangan rerun `schema.sql` sebagai migrasi.
- `20261010_reimbursement_auth_exports.sql` mengarsipkan data kategori ke `cashflow_archive.categories_20261010`, kemudian menghapus tabel `public.categories` setelah memeriksa jumlah baris. Kategori transaksi tetap disimpan sebagai teks. Baca seluruh SQL dan pastikan dependensi tabel kategori sudah ditangani sebelum menjalankannya.
- Migration Auth mengganti policy akses anonim dengan Supabase Auth. Setiap akun pengguna harus memiliki `app_metadata.role` yang diatur administrator tepercaya: `employee`, `approver`, atau `finance_manager`. Jangan menyimpan role di `user_metadata` atau mengizinkan pengguna mengubah role sendiri.
- `finance_manager` mengelola master cabang/akun kas dan pembayaran reimbursement; `approver`/`finance_manager` dapat memutuskan transaksi dan reimbursement. Keputusan dicatat melalui RPC database, bukan update status langsung dari browser.
- Migration cabang mengaitkan akun dan transaksi lama ke `Kantor Pusat`; setelah migrasi, periksa dan pindahkan akun yang seharusnya berada di `Pabrik` melalui menu Akun Kas.
- Migration saldo minimum/bukti membuat bucket privat `cashflow-evidence` dengan batas file 10 MB dan tipe PDF/JPG/JPEG/PNG. Upload bukti transaksi tidak tersedia sampai migration ini dijalankan.
- Reimbursement memakai bucket privat `reimbursement-receipts`; bukti wajib diunggah sebelum pengajuan dapat dikirim. Pembayaran melalui RPC membuat transaksi `cash-out` pada cabang akun kas yang dipilih.
- SQL migration di repository adalah instruksi untuk ditinjau dan dijalankan manual. Aplikasi/server tidak menjalankan SQL, dan perubahan kode tidak otomatis mengubah proyek Supabase. Jangan gunakan `DROP ... CASCADE` untuk melewati dependency.
- `schema.sql` masih membuat beberapa policy development untuk tabel awal; jangan membuka aplikasi/database untuk pengguna sebelum migration Auth dan bukti selesai ditinjau serta diterapkan.

## Validasi lokal

Periksa sintaks frontend dengan:

```powershell
node --check frontend\app.js
```

Server statis hanya menyajikan frontend. Tidak ada koneksi database live atau migration yang otomatis dijalankan oleh server.
