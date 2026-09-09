# BERITA MUDA INDONESIA — FINAL PRODUCTION

## Status sebelum LIVE
- [ ] Buat project Supabase production
- [ ] Jalankan installer/schema dan migrations 001-008 berurutan
- [ ] Buat akun Owner di Supabase Auth
- [ ] Tetapkan role Owner/Admin sesuai schema yang digunakan
- [ ] Aktifkan Google OAuth dan callback URL production
- [ ] Buat bucket Storage yang diperlukan dan kebijakan akses
- [ ] Isi RSS_FEEDS dengan sumber yang sah/diizinkan
- [ ] Isi semua environment variables di Vercel
- [ ] Set CRON_SECRET yang kuat dan rahasia
- [ ] Deploy ke Vercel
- [ ] Uji /health dan /api/health
- [ ] Uji cron sync dengan header Authorization yang benar
- [ ] Uji artikel, video, share, komentar, admin, mobile
- [ ] Pasang domain dan PUBLIC_BASE_URL final
- [ ] Uji SEO metadata dan sitemap
- [ ] Aktifkan monitoring dan backup

## Keamanan
Jangan pernah memasukkan SUPABASE_SERVICE_ROLE_KEY atau CRON_SECRET ke frontend/public repository.
