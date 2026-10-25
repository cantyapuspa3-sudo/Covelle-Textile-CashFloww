## Identitas Mahasiswa

- **Nama:** Cantya Puspa
- **NIM:** 12030124140273
- **Kelas:** G

# Covelle Textile CashFlow

Aplikasi pencatatan kas berbasis frontend statis dengan Supabase sebagai penyimpanan. 

Repository: [cantyapuspa3-sudo/Covelle-Textile-CashFloww](https://github.com/cantyapuspa3-sudo/Covelle-Textile-CashFloww)

Web Demo Aplikasi: [Klik di sini untuk membuka Covelle Textile CashFlow](https://cantyapuspa3-sudo.github.io/Covelle-Textile-CashFloww/frontend/index.html)

Versi ringkas ini menggunakan lima tabel bisnis:
- `branches` — master cabang.
- `cash_accounts` — akun kas/bank dan saldo awal.
- `categories` — kategori transaksi.
- `transactions` — penerimaan, pengeluaran, transfer, dan permintaan kas.
- `approvals` — keputusan dan riwayat persetujuan transaksi.

## Fitur

- Dashboard saldo akun dan transaksi terbaru.
- Peringatan saldo minimum per akun kas di dashboard, memakai transaksi Approved/Posted.
- Pengelolaan cabang, akun kas, dan kategori.
- Pencatatan transaksi kas masuk/keluar, transfer, petty cash, dan permintaan kas, dengan bukti transaksi opsional PDF/JPG/JPEG/PNG.
- Approval atau penolakan transaksi serta riwayat keputusan.
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

- Pada database baru, jalankan `backend/schema.sql`. Skema tersebut menambahkan master `Kantor Pusat` dan `Pabrik`, dan setiap akun kas/transaksi memerlukan cabang.
- Pada database yang sudah digunakan, backup terlebih dahulu, lalu tinjau kebijakan dan jalankan `backend/migrations/20261025_branches_cashflow.sql`. Migrasi akan mengaitkan akun/transaksi lama ke `Kantor Pusat`; pindahkan akun ke cabang yang benar setelahnya melalui menu Akun Kas. Jangan rerun setup schema sebagai migrasi.
- Pada database baru maupun lama, jalankan `backend/migrations/20261025_minimum_balance_and_evidence.sql` di SQL Editor Supabase (untuk database lama, setelah migrasi cabang). Migrasi ini menambahkan metadata bukti dan bucket Storage privat `cashflow-evidence` (batas file 10 MB, PDF/JPG/JPEG/PNG). Fitur upload tidak dapat menyimpan bukti sebelum migrasi ini dijalankan. Saldo minimum sudah menjadi kolom akun; isikan nilainya dari menu Akun Kas untuk mengaktifkan peringatan dashboard.
- Bukti diberi path unik dan kebijakan Storage tidak mengizinkan update/delete objek. Kebijakan anon saat ini mengikuti aplikasi demo tanpa Supabase Auth; siapkan RLS berbasis autentikasi sebelum menyimpan dokumen sensitif atau membuka akses produksi.
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
