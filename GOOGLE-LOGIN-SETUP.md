# Google Login untuk Video

Alur: berita bebas dibaca → klik video → login Google → video diputar.

## Supabase
1. Authentication → Providers → Google → aktifkan Google.
2. Buat OAuth Client ID tipe Web di Google Cloud Console.
3. Masukkan Client ID dan Client Secret ke provider Google di Supabase.
4. Pada Google Cloud, Authorized redirect URI gunakan callback URL Supabase yang ditampilkan di halaman provider Google (bukan URL Vercel langsung).
5. Di Supabase Authentication → URL Configuration, tambahkan URL produksi Vercel/domain pada Site URL dan Redirect URLs.

## Vercel
Set environment variables:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- PUBLIC_BASE_URL
- CORS_ORIGIN

Jangan pernah menaruh SUPABASE_SERVICE_ROLE_KEY di kode browser.

## Catatan keamanan video
V4.3 menerapkan login Google sebagai gerbang pemutaran. Untuk proteksi file video yang benar-benar kuat, video sebaiknya disimpan pada bucket private dan endpoint `/api/videos/:id/play` ditingkatkan menjadi signed URL yang kedaluwarsa. URL video eksternal yang sudah bersifat publik tetap secara teknis dapat diakses langsung bila seseorang memperoleh URL-nya.


## Urutan konfigurasi yang benar

1. **Google Cloud**: buat OAuth Client ID → Web application. Tambahkan domain website Anda pada Authorized JavaScript origins. Tambahkan **callback URL Supabase** yang tampil di Authentication → Providers → Google pada Authorized redirect URIs.
2. **Supabase**: Authentication → Providers → Google → aktifkan, lalu tempel Client ID dan Client Secret dari Google.
3. **Supabase URL Configuration**: isi Site URL dengan domain produksi, lalu tambahkan domain produksi/URL yang dipakai aplikasi ke Redirect URLs. Supabase mensyaratkan URL redirect aplikasi masuk dalam allow-list.
4. **Vercel**: masukkan `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_BASE_URL`, dan `CORS_ORIGIN`.
5. Deploy ulang Vercel.
6. Uji: buka berita → buka bagian video → klik **TONTON VIDEO** → Google Login → kembali ke situs → video otomatis dibuka.

> Jangan kirim Client Secret Google atau `SUPABASE_SERVICE_ROLE_KEY` kepada siapa pun dan jangan menaruhnya di file browser.
