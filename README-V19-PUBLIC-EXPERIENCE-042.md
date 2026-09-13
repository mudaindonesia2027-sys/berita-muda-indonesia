# MUDA Indonesia V19 — Public Experience 042

## Tujuan
Reframe pengalaman publik berdasarkan audit live 041: initial viewport lebih editorial, tipografi lebih terbaca, layout tidak horizontal-scroll, intelligence rail dipindahkan ke area lebih rendah, dan map tidak lagi bergantung pada raster tile OpenStreetMap pada initial load.

## Perubahan utama
- memperbaiki nested `.hero-grid` yang menyebabkan struktur layout rusak;
- menata ulang urutan tampilan homepage dengan hero lebih dahulu;
- ukuran jam/kartu diturunkan agar tidak mendominasi;
- memperkuat kontras, spacing, dan responsive layout;
- memperbaiki grid kategori dan kartu berita;
- memindahkan Public Intelligence rail dari posisi paling atas ke bawah setelah konten utama;
- mengganti map raster eksternal dengan peta skematik berbasis koordinat wilayah dari API MUDA, sehingga tidak menampilkan tile 403 dari provider;
- menambahkan tombol navigasi `Intelijen` untuk menuju mesin data publik;
- tidak menambah migration baru.

## Prinsip
Konten tetap bersumber dari data MUDA yang tersedia. Tidak ada artikel, angka, harga, atau trend yang dipalsukan.
