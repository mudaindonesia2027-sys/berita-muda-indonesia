# PRODUCTION CHECKLIST

1. Isi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Isi `CRON_SECRET`.
3. Set `PUBLIC_BASE_URL` ke domain production.
4. Jalankan migration 001 sampai 009 secara berurutan.
5. Verifikasi RPC yang dipanggil server.
6. Konfigurasikan Google OAuth jika login Google digunakan.
7. Buat Storage bucket media/video.
8. Verifikasi CORS dan OAuth callback domain.
9. Jalankan `npm install` lalu `npm run check`.
10. Uji `/`, `/health`, `/api/health`, artikel, video, login, admin, analytics, dan cron.
11. Uji campaign dengan data dummy sebelum transaksi/iklan nyata.
12. Jangan aktifkan pembayaran nyata sebelum webhook, signature validation, dan audit transaksi selesai.
