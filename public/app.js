(() => {
  'use strict';

  /* =========================================================
     BERITA MUDA INDONESIA — FRONTEND CONTROL CENTER
     - Konten: feed, search, kategori
     - Intelligence: ranking + trending
     - Live: breaking + event monitor
     - Media: video playback
     - Engagement: view / like / share / newsletter
     - Monetisasi: active ads + inquiry
  ========================================================= */

  const state = {
    category: '',
    query: '',
    articles: [],
    videos: [],
    trends: [],
    liveEvents: [],
    breaking: [],
    ads: [],
    loading: false,
    offset: 0,
    pageSize: 24,
    videosExpanded: false,
    autoTimer: null,
    heroId: null
  };

  const CATEGORY_META = {
    '': { label: 'Semua', canonical: '' },
    NASIONAL: { label: 'Nasional', canonical: 'NASIONAL' },
    INTERNASIONAL: { label: 'Dunia', canonical: 'INTERNASIONAL' },
    EKONOMI: { label: 'Ekonomi', canonical: 'EKONOMI' },
    POLITIK: { label: 'Politik', canonical: 'POLITIK' },
    HUKUM: { label: 'Hukum', canonical: 'HUKUM' },
    TEKNOLOGI: { label: 'Teknologi', canonical: 'TEKNOLOGI' },
    OLAHRAGA: { label: 'Sport', canonical: 'OLAHRAGA' },
    HIBURAN: { label: 'Hiburan', canonical: 'HIBURAN' },
    LIFESTYLE: { label: 'Lifestyle', canonical: 'LIFESTYLE' }
  };

  const CATEGORY_ALIASES = {
    SPORT: 'OLAHRAGA',
    OLAHRAGA: 'OLAHRAGA',
    TEKNO: 'TEKNOLOGI',
    TEKNOLOGI: 'TEKNOLOGI',
    INTERNATIONAL: 'INTERNASIONAL',
    INTERNASIONAL: 'INTERNASIONAL',
    WORLD: 'INTERNASIONAL',
    DUNIA: 'INTERNASIONAL',
    HIBURAN: 'HIBURAN',
    ENTERTAINMENT: 'HIBURAN',
    LIFESTYLE: 'LIFESTYLE',
    'GAYA HIDUP': 'LIFESTYLE',
    NASIONAL: 'NASIONAL',
    EKONOMI: 'EKONOMI',
    POLITIK: 'POLITIK',
    HUKUM: 'HUKUM'
  };

  const FEATURE_IDS = {
    feed: 'featureFeed',
    ranking: 'featureRanking',
    trend: 'featureTrend',
    live: 'featureLive',
    video: 'featureVideo',
    engagement: 'featureEngagement'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    today: $('#todayLabel'),
    clock: $('#clockLabel'),
    sourceStatus: $('#sourceStatus'),
    ticker: $('#tickerText'),
    heroImage: $('#heroImage'),
    heroCategory: $('#heroCategory'),
    heroTitle: $('#heroTitle'),
    heroSummary: $('#heroSummary'),
    heroDate: $('#heroDate'),
    heroViews: $('#heroViews'),
    heroOpen: $('#heroOpen'),
    compact: $('#compactNews'),
    trending: $('#trendingList'),
    nav: $('#categoryNav'),
    tiles: $('#categoryTiles'),
    pills: $('#filterPills'),
    section: $('#sectionTitle'),
    count: $('#feedCount'),
    clear: $('#clearFilter'),
    grid: $('#articlesGrid'),
    loading: $('#loadingState'),
    empty: $('#emptyState'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    refresh: $('#refreshBtn'),
    emptyRefresh: $('#emptyRefresh'),
    form: $('#searchForm'),
    search: $('#searchInput'),
    videoGrid: $('#videoGrid'),
    liveUpdates: $('#liveUpdates'),
    modal: $('#articleModal'),
    modalBody: $('#modalBody'),
    toast: $('#toastZone'),
    theme: $('#themeToggle'),
    videoShortcut: $('#videoShortcut'),
    videoNav: $('#videoNav'),
    liveTv: $('#liveTvBtn'),
    showAllVideos: $('#showAllVideos'),
    notificationBtn: $('#notificationBtn'),
    notificationBadge: $('#notificationBadge'),
    featureOverall: $('#featureOverall'),
    adPanel: $('#adPanel'),
    adContent: $('#adContent'),
    advertiseBtn: $('#advertiseBtn'),
    newsletterForm: $('#newsletterForm'),
    loginBtn: $('#loginBtn'),
    joinBtn: $('#joinBtn')
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const stripHtml = value => String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const canonicalCategory = value => {
    const raw = String(value ?? '').trim().toUpperCase();
    return CATEGORY_ALIASES[raw] || raw;
  };

  const categoryLabel = value => {
    const key = canonicalCategory(value);
    return CATEGORY_META[key]?.label || (key ? key.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()) : 'Terbaru');
  };

  const articleTime = item => item?.published_at || item?.created_at || item?.updated_at;
  const imageUrl = item => item?.image_url || item?.thumbnail_url || '';

  const fmtDate = value => {
    if (!value) return 'Baru diperbarui';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Baru diperbarui';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Baru saja';
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} menit lalu`;
    if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} jam lalu`;
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  };

  const toast = (message, type = '') => {
    if (!els.toast) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    els.toast.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  };

  const setFeature = (name, status, tone = 'ready') => {
    const node = document.getElementById(FEATURE_IDS[name]);
    if (!node) return;
    node.textContent = status;
    node.dataset.state = tone;
  };

  const updateFeatureOverall = () => {
    const nodes = Object.values(FEATURE_IDS).map(id => document.getElementById(id)).filter(Boolean);
    const active = nodes.filter(node => ['AKTIF', 'LIVE', 'SIAP'].includes(node.textContent)).length;
    if (els.featureOverall) {
      els.featureOverall.textContent = active === nodes.length ? 'SEMUA FITUR SIAP' : `${active}/${nodes.length} FITUR SIAP`;
    }
  };

  const json = async response => {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data?.error || data?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  };

  const getJson = async (url, options = {}) => json(await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options
  }));

  const postJson = async (url, body) => json(await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {})
  }));

  const safeScroll = element => element?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  function updateClock() {
    const now = new Date();
    if (els.today) {
      els.today.textContent = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(now);
    }
    if (els.clock) {
      els.clock.textContent = `${new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta'
      }).format(now)} WIB`;
    }
  }

  function setLoading(on) {
    state.loading = on;
    els.loading?.classList.toggle('hidden', !on);
    if (on) els.empty?.classList.add('hidden');
  }

  function activateCategory(category) {
    state.category = canonicalCategory(category);
    $$('[data-category]').forEach(button => {
      if (!button.dataset.category && state.category) return;
      button.classList.toggle('active', canonicalCategory(button.dataset.category) === state.category);
    });
  }

  function sortFeed(items) {
    return [...items].sort((a, b) => {
      const breakA = a?.breaking ? 1 : 0;
      const breakB = b?.breaking ? 1 : 0;
      if (breakA !== breakB) return breakB - breakA;
      return new Date(articleTime(b) || 0).getTime() - new Date(articleTime(a) || 0).getTime();
    });
  }

  function articleRegion(item) {
    return [item?.city, item?.regency, item?.district, item?.province, item?.region]
      .map(v => String(v || '').trim()).filter(Boolean).join(' · ');
  }

  function isSavedArticle(id) { return Boolean(id && localStorage.getItem(`muda:saved:${id}`) === '1'); }

  function toggleSavedArticle(item) {
    if (!item?.id) return false;
    const key = `muda:saved:${item.id}`;
    const saved = localStorage.getItem(key) === '1';
    if (saved) { localStorage.removeItem(key); toast('Berita dihapus dari Simpan.', 'success'); }
    else { localStorage.setItem(key, '1'); toast('Berita disimpan.', 'success'); }
    return !saved;
  }

  function articleCard(item, index) {
    const card = document.createElement('article');
    card.className = `article-card${index === 0 && !state.category && !state.query ? ' featured' : ''}`;
    const bg = imageUrl(item);
    const title = item?.title || 'Berita terbaru';
    const summary = stripHtml(item?.summary || item?.content || item?.content_html || 'Ringkasan berita belum tersedia.');
    const canonical = categoryLabel(item?.category);
    const source = item?.source || 'Berita Muda';
    const author = item?.author_name || item?.author || '';
    const region = articleRegion(item);
    card.innerHTML = `
      <div class="article-thumb" ${bg ? `style="background-image:url('${escapeHtml(bg)}')"` : ''}></div>
      <div class="article-body">
        <div class="article-meta">
          <span class="article-category">${escapeHtml(canonical)}</span>
          <span>${escapeHtml(fmtDate(articleTime(item)))}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(summary)}</p>
        <div class="article-byline-row">${author ? `<span>Oleh ${escapeHtml(author)}</span>` : '<span>Redaksi Berita Muda</span>'}${region ? `<span>• ${escapeHtml(region)}</span>` : ''}</div>
        <div class="article-foot">
          <span>${escapeHtml(source)}</span>
          <span class="article-engagement">
            <button type="button" class="mini-action js-like">♥ ${Number(item?.likes || 0).toLocaleString('id-ID')}</button>
            <button type="button" class="mini-action js-share">↗ Bagikan</button>
            <button type="button" class="mini-action js-save">${isSavedArticle(item.id) ? '🔖 Tersimpan' : '🔖 Simpan'} </button>
            <span class="read-link">Baca →</span>
          </span>
        </div>
      </div>`;
    card.addEventListener('click', () => openArticle(item.id, item));
    card.querySelector('.js-like')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      const ok = await mutateCounter(`/api/articles/${encodeURIComponent(item.id)}/like`, 'Suka tersimpan.');
      if (ok) {
        item.likes = Number(item.likes || 0) + 1;
        const el = card.querySelector('.js-like');
        if (el) el.textContent = `♥ ${Number(item.likes).toLocaleString('id-ID')}`;
      }
    });
    card.querySelector('.js-share')?.addEventListener('click', (event) => {
      event.stopPropagation();
      shareArticle(item);
    });
    card.querySelector('.js-save')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const saved = toggleSavedArticle(item);
      event.currentTarget.textContent = saved ? '🔖 Tersimpan' : '🔖 Simpan';
    });
    return card;
  }

  function renderHero() {
    const item = state.articles[0];
    state.heroId = item?.id || null;
    if (!item) {
      els.heroImage?.classList.remove('has-image');
      if (els.heroImage) els.heroImage.style.backgroundImage = '';
      if (els.heroCategory) els.heroCategory.textContent = 'TOP STORY';
      if (els.heroTitle) els.heroTitle.textContent = 'Newsroom siap menerima pembaruan terbaru';
      if (els.heroSummary) els.heroSummary.textContent = 'Berita utama akan tampil otomatis ketika sumber data dan sinkronisasi newsroom aktif.';
      if (els.heroDate) els.heroDate.textContent = 'LIVE DATA';
      if (els.heroViews) els.heroViews.textContent = 'Menunggu sinkronisasi';
      if (els.ticker) els.ticker.textContent = state.breaking[0]?.title || 'Sumber berita sedang dipantau.';
      return;
    }
    const bg = imageUrl(item);
    if (els.heroImage) {
      els.heroImage.style.backgroundImage = bg ? `url("${bg.replace(/"/g, '\\"')}")` : '';
      els.heroImage.classList.toggle('has-image', Boolean(bg));
    }
    if (els.heroCategory) els.heroCategory.textContent = state.breaking.length ? 'BREAKING' : categoryLabel(item.category).toUpperCase();
    if (els.heroTitle) els.heroTitle.textContent = item.title || 'Berita terbaru';
    if (els.heroSummary) els.heroSummary.textContent = stripHtml(item.summary || item.content || item.content_html || 'Ringkasan berita terbaru dari newsroom.');
    if (els.heroDate) els.heroDate.textContent = fmtDate(articleTime(item));
    if (els.heroViews) els.heroViews.textContent = `${Number(item.views || 0).toLocaleString('id-ID')} views`;
    const byline = item.author_name || item.author || item.source || 'Berita Muda';
    const region = articleRegion(item);
    if (els.heroByline) els.heroByline.textContent = region ? `${byline} · ${region}` : byline;
    if (els.ticker) els.ticker.textContent = state.breaking[0]?.title || item.title || 'Berita terbaru';
    const heroLike = document.getElementById('heroLike');
    const heroShare = document.getElementById('heroShare');
    if (heroLike) {
      heroLike.textContent = `♥ Suka ${Number(item.likes || 0).toLocaleString('id-ID')}`;
      heroLike.onclick = async (event) => {
        event.stopPropagation();
        const ok = await mutateCounter(`/api/articles/${encodeURIComponent(item.id)}/like`, 'Suka tersimpan.');
        if (ok) {
          item.likes = Number(item.likes || 0) + 1;
          heroLike.textContent = `♥ Suka ${Number(item.likes).toLocaleString('id-ID')}`;
        }
      };
    }
    if (heroShare) {
      heroShare.onclick = (event) => {
        event.stopPropagation();
        shareArticle(item);
      };
    }
  }

  function renderCompact() {
    if (!els.compact) return;
    els.compact.innerHTML = '';
    state.articles.slice(1, 4).forEach(item => {
      const button = document.createElement('button');
      button.className = 'compact-card';
      const bg = imageUrl(item);
      button.innerHTML = `
        <div class="compact-thumb" ${bg ? `style="background-image:url('${escapeHtml(bg)}')"` : ''}></div>
        <div class="compact-copy">
          <span class="tag ghost">${escapeHtml(categoryLabel(item.category))}</span>
          <h3>${escapeHtml(item.title || 'Berita terbaru')}</h3>
          <small>${escapeHtml(fmtDate(articleTime(item)))} · ${escapeHtml(item.source || 'Berita Muda')}</small>
        </div>`;
      button.addEventListener('click', () => openArticle(item.id, item));
      els.compact.appendChild(button);
    });
    if (!els.compact.children.length) {
      els.compact.innerHTML = '<div class="compact-card"><div class="compact-thumb"></div><div class="compact-copy"><span class="tag ghost">NEWSROOM</span><h3>Menunggu berita terbaru</h3><small>Sinkronisasi aktif</small></div></div>';
    }
  }

  function renderTrending() {
    if (!els.trending) return;
    els.trending.innerHTML = '';
    const source = state.trends.length
      ? state.trends.map(x => ({ ...x.item, trend: x.score, content_type: x.content_type }))
      : state.articles.slice(0, 5).map(x => ({ ...x, content_type: 'article' }));

    source.slice(0, 5).forEach((item, index) => {
      const li = document.createElement('li');
      const label = item.content_type === 'video' ? 'VIDEO' : categoryLabel(item.category);
      li.innerHTML = `<button>${escapeHtml(item.title || 'Konten terbaru')}</button><span class="trend-up">${escapeHtml(String(index + 1).padStart(2, '0'))}</span>`;
      li.querySelector('button')?.addEventListener('click', () => {
        if (item.content_type === 'video') openVideo(item);
        else openArticle(item.id, item);
      });
      li.title = label;
      els.trending.appendChild(li);
    });

    if (!els.trending.children.length) {
      els.trending.innerHTML = '<li><button>Trending akan muncul setelah data tersedia</button><span class="trend-up">—</span></li>';
    }
  }

  function renderArticles() {
    if (!els.grid) return;
    els.grid.innerHTML = '';
    state.articles.forEach((item, index) => els.grid.appendChild(articleCard(item, index)));
    const count = state.articles.length;
    if (els.count) els.count.textContent = `${count} berita`;
    els.clear?.classList.toggle('hidden', !(state.category || state.query));
    if (els.section) {
      els.section.textContent = state.query
        ? `Hasil Pencarian: ${state.query}`
        : state.category
          ? `Berita ${categoryLabel(state.category)}`
          : 'Berita Terbaru';
    }
    els.empty?.classList.toggle('hidden', count > 0);
    if (!count) {
      if (els.emptyTitle) els.emptyTitle.textContent = state.query || state.category ? 'Tidak ada berita yang cocok' : 'Newsroom sedang menunggu data';
      if (els.emptyText) els.emptyText.textContent = state.query || state.category
        ? 'Coba kata kunci atau kategori lain.'
        : 'Belum ada berita published dari API newsroom.';
    }

    let loadMore = $('#loadMoreArticles');
    if (!loadMore && count >= state.pageSize) {
      const wrap = document.createElement('div');
      wrap.className = 'load-more-wrap';
      wrap.innerHTML = '<button id="loadMoreArticles" class="primary-cta small">Muat berita berikutnya</button>';
      els.grid.parentElement?.appendChild(wrap);
      loadMore = $('#loadMoreArticles');
    }
    if (loadMore) {
      loadMore.onclick = async () => {
        loadMore.disabled = true;
        await loadArticles({ append: true });
        loadMore.disabled = false;
      };
      loadMore.parentElement?.classList.toggle('hidden', count < state.pageSize);
    }
  }


  async function loadHomepageLive() {
    if (homepageLive && Date.now() - homepageLiveAt < 30000) return homepageLive;
    try { homepageLive = await getJson('/api/public/homepage/live'); homepageLiveAt = Date.now(); return homepageLive; } catch { return null; }
  }

  async function loadSystem() {
    try {
      const data = await getJson('/api/system/config');
      if (els.sourceStatus) els.sourceStatus.textContent = data?.supabaseConfigured ? 'Sumber data terhubung' : 'Mode konfigurasi';
      setFeature('feed', data?.supabaseConfigured ? 'SIAP' : 'CEK', data?.supabaseConfigured ? 'ready' : 'warn');
    } catch (error) {
      if (els.sourceStatus) els.sourceStatus.textContent = 'Status sumber tidak tersedia';
      setFeature('feed', 'CEK', 'warn');
    }
  }

  async function loadArticles({ append = false, silent = false } = {}) {
    loadHomepageLive().catch(() => null);
    if (state.loading && !silent) return;
    if (!append) state.offset = 0;
    if (!silent) setLoading(true);
    const params = new URLSearchParams({ limit: String(state.pageSize), offset: String(state.offset) });
    if (state.category) params.set('category', state.category);
    if (state.query) params.set('q', state.query);

    try {
      const data = await getJson(`/api/articles?${params.toString()}`);
      const incoming = Array.isArray(data) ? data : [];
      state.articles = append ? [...state.articles, ...incoming] : incoming;
      state.articles = sortFeed(state.articles);
      state.offset = state.articles.length;
      setFeature('feed', 'AKTIF', 'live');
      setFeature('ranking', state.articles.some(item => Number.isFinite(Number(item?.intelligence_score))) ? 'AKTIF' : 'SIAP', 'ready');
      renderHero();
      renderCompact();
      renderTrending();
      renderArticles();
      if (state.articles.length && els.sourceStatus) els.sourceStatus.textContent = 'Live data aktif';
    } catch (error) {
      if (!append) state.articles = [];
      renderHero(); renderCompact(); renderTrending(); renderArticles();
      if (els.sourceStatus) els.sourceStatus.textContent = 'Koneksi perlu perhatian';
      if (!silent) toast(`Feed gagal dimuat: ${error.message}`);
      setFeature('feed', 'CEK', 'warn');
    } finally {
      if (!silent) setLoading(false);
    }
    updateFeatureOverall();
  }

  async function loadTrending() {
    try {
      const data = await getJson('/api/trending?limit=10');
      state.trends = Array.isArray(data) ? data.filter(item => item?.item) : [];
      renderTrending();
      setFeature('trend', state.trends.length ? 'AKTIF' : 'SIAP', 'ready');
    } catch (error) {
      state.trends = [];
      renderTrending();
      setFeature('trend', 'SIAP', 'ready');
    }
    updateFeatureOverall();
  }

  function liveRow(title, timeLabel, type = 'LIVE') {
    const row = document.createElement('div');
    row.className = 'live-update';
    row.innerHTML = `<time>${escapeHtml(timeLabel)}</time><p><b>${escapeHtml(type)}</b> ${escapeHtml(title)}</p>`;
    return row;
  }

  function renderLiveUpdates() {
    if (!els.liveUpdates) return;
    els.liveUpdates.innerHTML = '';
    const rows = [];
    state.breaking.slice(0, 3).forEach(item => rows.push({ title: item.title, time: fmtDate(item.created_at || item.updated_at), type: 'BREAKING' }));
    state.liveEvents.slice(0, 5).forEach(item => rows.push({ title: item.title, time: fmtDate(item.last_seen_at), type: categoryLabel(item.category) }));
    if (!rows.length) {
      state.articles.slice(0, 4).forEach(item => rows.push({ title: item.title, time: fmtDate(articleTime(item)), type: 'FEED' }));
    }
    rows.slice(0, 6).forEach(item => els.liveUpdates.appendChild(liveRow(item.title, item.time, item.type)));
    if (!rows.length) els.liveUpdates.innerHTML = '<div class="video-empty">Live monitor belum menerima event baru.</div>';
  }

  async function loadLive() {
    try {
      const [events, breaking] = await Promise.all([
        getJson('/api/live/events?limit=8').catch(() => []),
        getJson('/api/live/breaking').catch(() => [])
      ]);
      state.liveEvents = Array.isArray(events) ? events : [];
      state.breaking = Array.isArray(breaking) ? breaking : [];
      if (els.notificationBadge) {
        const total = state.breaking.length;
        els.notificationBadge.textContent = total > 99 ? '99+' : String(total);
        els.notificationBadge.style.display = total ? 'grid' : 'none';
      }
      renderLiveUpdates();
      renderHero();
      setFeature('live', state.liveEvents.length || state.breaking.length ? 'LIVE' : 'SIAP', 'live');
    } catch {
      state.liveEvents = [];
      state.breaking = [];
      renderLiveUpdates();
      setFeature('live', 'SIAP', 'ready');
    }
    updateFeatureOverall();
  }

  function renderVideos() {
    if (!els.videoGrid) return;
    els.videoGrid.innerHTML = '';
    const visible = state.videosExpanded ? state.videos : state.videos.slice(0, 4);
    visible.forEach(video => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'video-card';
      const bg = imageUrl(video);
      card.innerHTML = `<div class="video-thumb" ${bg ? `style="background-image:url('${escapeHtml(bg)}')"` : ''}></div><div><h4>${escapeHtml(video.title || 'Video terbaru')}</h4><small>${escapeHtml(categoryLabel(video.category))} · ${escapeHtml(video.source || 'Berita Muda')}</small></div>`;
      card.addEventListener('click', () => openVideo(video));
      els.videoGrid.appendChild(card);
    });
    if (!state.videos.length) {
      els.videoGrid.innerHTML = '<div class="video-empty">Belum ada video published dari newsroom.</div>';
      if (els.showAllVideos) els.showAllVideos.textContent = 'Belum ada video';
    } else if (els.showAllVideos) {
      els.showAllVideos.textContent = state.videosExpanded ? 'Tampilkan lebih sedikit' : `Lihat Semua (${state.videos.length}) →`;
    }
  }

  async function loadVideos() {
    try {
      const data = await getJson('/api/videos?limit=12');
      state.videos = Array.isArray(data) ? data : [];
      renderVideos();
      setFeature('video', state.videos.length ? 'AKTIF' : 'SIAP', 'ready');
    } catch {
      state.videos = [];
      renderVideos();
      setFeature('video', 'SIAP', 'ready');
    }
    updateFeatureOverall();
  }

  function renderArticleContent(item) {
    if (item?.content_html && String(item.content_html).trim()) return item.content_html;
    if (item?.content && String(item.content).trim()) {
      return String(item.content).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
    }
    return item?.summary ? `<p>${escapeHtml(item.summary)}</p>` : '<p>Isi artikel belum tersedia.</p>';
  }

  function getSourceUrl(item) {
    const candidate = item?.source_url || item?.url || '';
    if (!candidate) return '';
    try {
      const url = new URL(candidate, window.location.origin);
      return url.href;
    } catch {
      return '';
    }
  }

  async function trackEvent(eventType, contentType, contentId) {
    try {
      await postJson('/api/analytics/event', {
        event_type: eventType,
        content_type: contentType || null,
        content_id: contentId || null,
        path: window.location.pathname,
        referrer: document.referrer || null,
        session_id: sessionStorage.getItem('bmi-session') || null
      });
    } catch {
      /* analytics tidak boleh mengganggu UX */
    }
  }

  async function registerView(id) {
    if (!id) return;
    const key = `bmi:view:article:${id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    try { await postJson(`/api/articles/${encodeURIComponent(id)}/view`, {}); } catch {}
  }

  async function mutateCounter(url, successMessage) {
    try {
      await postJson(url, {});
      toast(successMessage, 'success');
      return true;
    } catch (error) {
      toast(error.message || 'Aksi belum berhasil');
      return false;
    }
  }

  function shareArticle(item) {
    const url = `${window.location.origin}/berita/${encodeURIComponent(item.id)}`;
    const run = async () => {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: stripHtml(item.summary || ''), url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast('Tautan artikel disalin.', 'success');
      } else {
        window.prompt('Salin tautan artikel:', url);
      }
      await mutateCounter(`/api/articles/${encodeURIComponent(item.id)}/share`, 'Artikel dibagikan.');
    };
    run().catch(() => {});
  }

  async function loadComments(contentType, contentId) {
    try {
      const rows = await getJson(`/api/comments?content_type=${encodeURIComponent(contentType)}&content_id=${encodeURIComponent(contentId)}&limit=50`);
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }

  async function renderCommentsPanel(item) {
    const comments = await loadComments('article', item.id);
    const list = comments.length
      ? comments.map(c => `<article class="comment-item"><div class="comment-avatar">${escapeHtml(String(c.user_id || 'MU').slice(0,2).toUpperCase())}</div><div><strong>Pembaca MUDA</strong><time>${escapeHtml(fmtDate(c.created_at))}</time><p>${escapeHtml(c.body || '')}</p></div></article>`).join('')
      : '<div class="comment-empty">Belum ada komentar. Jadilah pembaca pertama yang ikut berdiskusi.</div>';
    return `<section class="article-comments" aria-label="Komentar pembaca"><div class="comments-head"><div><span class="eyebrow">KOMUNITAS PEMBACA</span><h3>Komentar</h3><p>${comments.length} komentar terverifikasi tampil.</p></div><a class="comment-login" href="/contact.html?topic=komentar">Masuk / daftar untuk berkomentar</a></div><div class="comment-list">${list}</div></section>`;
  }

  async function openArticle(id, fallback) {
    els.modal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (els.modalBody) els.modalBody.innerHTML = '<div class="modal-content reader-loading"><span class="eyebrow">MEMUAT ARTIKEL</span><h2>Menyiapkan berita…</h2></div>';
    let item = fallback;
    try {
      const fresh = await getJson(`/api/articles/${encodeURIComponent(id)}`);
      if (fresh) item = fresh;
    } catch {}
    if (!item) {
      if (els.modalBody) els.modalBody.innerHTML = '<div class="modal-content"><span class="eyebrow">DATA BELUM TERSEDIA</span><h2>Artikel tidak dapat dibuka</h2><p>Konten belum tersedia.</p></div>';
      return;
    }
    const bg = imageUrl(item);
    const sourceUrl = getSourceUrl(item);
    const body = renderArticleContent(item);
    const region = articleRegion(item) || 'Indonesia';
    const author = item.author_name || item.author || 'Redaksi Berita Muda';
    const source = item.source || 'Berita Muda Indonesia';
    const saved = isSavedArticle(item.id);
    if (els.modalBody) {
      els.modalBody.innerHTML = `
        <div class="reader-shell">
          ${bg ? `<div class="reader-hero"><img class="modal-hero" src="${escapeHtml(bg)}" alt="${escapeHtml(item.title || 'Berita')}" loading="eager"><div class="reader-hero-overlay"><span class="tag tag-red">${escapeHtml(categoryLabel(item.category).toUpperCase())}</span><span class="reader-region">${escapeHtml(region)}</span></div></div>` : ''}
          <div class="reader-content">
            <div class="reader-kicker">${escapeHtml(categoryLabel(item.category).toUpperCase())} · ${escapeHtml(region)}</div>
            <h1>${escapeHtml(item.title || 'Berita terbaru')}</h1>
            <p class="reader-deck">${escapeHtml(stripHtml(item.summary || ''))}</p>
            <div class="reader-byline"><div><strong>Oleh ${escapeHtml(author)}</strong><span>${escapeHtml(source)} · ${escapeHtml(fmtDate(articleTime(item)))}</span></div><div class="reader-stat">${Number(item.views || 0).toLocaleString('id-ID')} dibaca</div></div>
            <div class="reader-actions"><button class="action" id="modalLike">♥ <span>${Number(item.likes || 0).toLocaleString('id-ID')}</span> Suka</button><button class="action" id="modalShare">↗ Bagikan</button><button class="action" id="modalSave">🔖 ${saved ? 'Tersimpan' : 'Simpan'}</button>${sourceUrl ? `<a class="action" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Sumber ↗</a>` : ''}</div>
            <div class="reader-body article-html">${body}</div>
            <div class="reader-footnote"><span>Lokasi liputan: ${escapeHtml(region)}</span><span>Source: ${escapeHtml(source)}</span>${item.editor_name ? `<span>Editor: ${escapeHtml(item.editor_name)}</span>` : ''}</div>
            <div id="readerComments" class="comments-mount"><div class="comment-empty">Memuat komentar…</div></div>
          </div>
        </div>`;
      $('#modalLike')?.addEventListener('click', async () => {
        const ok = await mutateCounter(`/api/articles/${encodeURIComponent(item.id)}/like`, 'Suka tersimpan.');
        if (ok) { item.likes = Number(item.likes || 0) + 1; window.dispatchEvent(new CustomEvent('muda:reader-action',{detail:{action:'like',item}})); }
        const span = $('#modalLike span'); if (span) span.textContent = Number(item.likes || 0).toLocaleString('id-ID');
      });
      $('#modalShare')?.addEventListener('click', () => { shareArticle(item); window.dispatchEvent(new CustomEvent('muda:reader-action',{detail:{action:'share',item}})); });
      $('#modalSave')?.addEventListener('click', (e) => { const on = toggleSavedArticle(item); e.currentTarget.textContent = `🔖 ${on ? 'Tersimpan' : 'Simpan'}`; if(on) window.dispatchEvent(new CustomEvent('muda:reader-action',{detail:{action:'saved',item}})); });
      renderCommentsPanel(item).then(html => { const mount = $('#readerComments'); if (mount) mount.innerHTML = html; });
    }
    registerView(item.id);
    trackEvent('article_open', 'article', item.id);
    window.dispatchEvent(new CustomEvent('muda:article-read',{detail:item}));
    const canonicalUrl = `${window.location.origin}/berita/${encodeURIComponent(item.id)}`;
    try { window.history.replaceState({}, '', canonicalUrl); } catch {}
  }

  async function openVideo(video) {
    els.modal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (els.modalBody) els.modalBody.innerHTML = '<div class="modal-content"><span class="eyebrow">VIDEO</span><h2>Menyiapkan pemutaran…</h2></div>';
    try {
      const playback = await getJson(`/api/videos/${encodeURIComponent(video.id)}/play`);
      const source = playback?.url || video.video_url || '';
      const bg = imageUrl(video);
      if (els.modalBody) {
        els.modalBody.innerHTML = `<div class="modal-content"><span class="eyebrow">VIDEO</span><h2>${escapeHtml(video.title || 'Video terbaru')}</h2>${source ? `<video controls playsinline poster="${escapeHtml(bg)}" style="width:100%;border-radius:12px;background:#000" src="${escapeHtml(source)}"></video>` : `${bg ? `<img class="modal-hero" src="${escapeHtml(bg)}" alt="${escapeHtml(video.title || 'Video')}">` : ''}`}<p class="summary">${escapeHtml(video.description || '')}</p><div class="share-row"><button class="action" id="videoShare">↗ Bagikan</button></div></div>`;
        $('#videoShare')?.addEventListener('click', async () => {
          const url = `${window.location.origin}/video/${encodeURIComponent(video.id)}`;
          try {
            if (navigator.share) await navigator.share({ title: video.title, url });
            else if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast('Tautan video disalin.', 'success'); }
            await mutateCounter(`/api/videos/${encodeURIComponent(video.id)}/share`, 'Video dibagikan.');
          } catch {}
        });
      }
      try { await postJson(`/api/videos/${encodeURIComponent(video.id)}/view`, {}); } catch {}
      trackEvent('video_open', 'video', video.id);
    } catch (error) {
      if (els.modalBody) {
        els.modalBody.innerHTML = `<div class="modal-content"><span class="eyebrow">VIDEO</span><h2>${escapeHtml(video.title || 'Video')}</h2><p class="summary">${escapeHtml(error.message || 'Video belum dapat diputar.')}</p>${imageUrl(video) ? `<img class="modal-hero" src="${escapeHtml(imageUrl(video))}" alt="${escapeHtml(video.title || 'Video')}">` : ''}</div>`;
      }
    }
  }

  function showNotificationCenter() {
    els.modal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const rows = state.breaking.length ? state.breaking : state.liveEvents;
    const title = state.breaking.length ? 'Breaking & Notifikasi' : 'Live Monitor';
    const body = rows.length
      ? rows.slice(0, 12).map((item, index) => `<button class="notification-row" data-notification-index="${index}"><span>${index + 1}</span><div><b>${escapeHtml(item.title || 'Pembaruan newsroom')}</b><small>${escapeHtml(fmtDate(item.created_at || item.last_seen_at || item.updated_at))}</small></div></button>`).join('')
      : '<p class="summary">Belum ada notifikasi aktif.</p>';
    if (els.modalBody) {
      els.modalBody.innerHTML = `<div class="modal-content"><span class="eyebrow">NEWSROOM</span><h2>${escapeHtml(title)}</h2><div class="notification-list">${body}</div></div>`;
      $$('.notification-row').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.dataset.notificationIndex);
        const selected = rows[index];
        if (selected?.article_id) openArticle(selected.article_id);
      }));
    }
  }

  function closeModal() {
    els.modal?.classList.add('hidden');
    document.body.style.overflow = '';
    if (els.modalBody) els.modalBody.innerHTML = '';
  }

  function scrollToVideo() {
    safeScroll($('#videoPanel'));
  }

  async function loadAds() {
    try {
      let data = await getJson('/api/ads?placement=sidebar');
      if (!Array.isArray(data) || !data.length) data = await getJson('/api/ads?placement=top');
      state.ads = Array.isArray(data) ? data : [];
      const active = state.ads[0];
      if (active && els.adContent) {
        const image = active.image_url ? `<img src="${escapeHtml(active.image_url)}" alt="${escapeHtml(active.alt_text || active.title || active.advertiser_name || 'Iklan')}">` : '';
        els.adContent.innerHTML = `<span class="ad-label">${escapeHtml(active.advertiser_name || 'IKLAN PREMIUM')}</span><h3>${escapeHtml(active.title || 'Promosi Bersama Berita Muda')}</h3>${image}<p>${escapeHtml(active.alt_text || 'Promosi digital yang terukur dan terhubung dengan audiens.')}</p>`;
        if (els.advertiseBtn) {
          els.advertiseBtn.textContent = 'Buka Penawaran →';
          els.advertiseBtn.onclick = () => { window.location.href = active.target_url || `/contact.html?topic=iklan`; };
        }
        trackEvent('ad_view', 'ad', active.id);
      }
    } catch {
      state.ads = [];
    }
  }

  async function submitNewsletter(event) {
    event.preventDefault();
    const email = els.newsletterForm?.querySelector('input[type="email"]')?.value?.trim() || '';
    if (!email) return;
    try {
      await postJson('/api/newsletter/subscribe', { email, categories: state.category ? [state.category] : [] });
      els.newsletterForm?.reset();
      toast('Berhasil berlangganan pembaruan Berita Muda.', 'success');
      setFeature('engagement', 'AKTIF', 'live');
    } catch (error) {
      toast(error.message || 'Pendaftaran newsletter gagal.');
    }
    updateFeatureOverall();
  }

  function applyTheme() {
    const saved = localStorage.getItem('bmi-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  }

  function bindEvents() {
    els.heroOpen?.addEventListener('click', () => state.heroId && openArticle(state.heroId, state.articles[0]));
    els.refresh?.addEventListener('click', async () => {
      await Promise.all([loadArticles(), loadTrending(), loadLive(), loadVideos(), loadAds()]);
      renderLiveUpdates();
      toast('Semua modul newsroom diperbarui.', 'success');
    });
    els.emptyRefresh?.addEventListener('click', () => loadArticles());
    els.form?.addEventListener('submit', event => {
      event.preventDefault();
      state.query = els.search?.value?.trim() || '';
      state.offset = 0;
      activateCategory('');
      loadArticles();
    });
    els.nav?.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      state.query = '';
      if (els.search) els.search.value = '';
      activateCategory(button.dataset.category || '');
      loadArticles();
    });
    els.tiles?.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      state.query = '';
      if (els.search) els.search.value = '';
      activateCategory(button.dataset.category || '');
      loadArticles();
      safeScroll(els.section);
    });
    els.pills?.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      state.query = '';
      if (els.search) els.search.value = '';
      activateCategory(button.dataset.category || '');
      loadArticles();
    });
    els.clear?.addEventListener('click', () => {
      state.query = '';
      state.offset = 0;
      if (els.search) els.search.value = '';
      activateCategory('');
      loadArticles();
    });
    $$('[data-close-modal]').forEach(node => node.addEventListener('click', closeModal));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
    els.theme?.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('bmi-theme', next);
    });
    els.videoShortcut?.addEventListener('click', scrollToVideo);
    els.videoNav?.addEventListener('click', scrollToVideo);
    els.liveTv?.addEventListener('click', showNotificationCenter);
    els.showAllVideos?.addEventListener('click', () => {
      state.videosExpanded = !state.videosExpanded;
      renderVideos();
      safeScroll($('#videoPanel'));
    });
    $('#refreshLive')?.addEventListener('click', async () => { await loadLive(); toast('Live monitor diperbarui.', 'success'); });
    els.notificationBtn?.addEventListener('click', showNotificationCenter);
    els.advertiseBtn?.addEventListener('click', () => { window.location.href = '/contact.html?topic=iklan'; });
    $('#exploreBtn')?.addEventListener('click', () => safeScroll(els.section));
    $('#openTrending')?.addEventListener('click', () => {
      state.query = '';
      activateCategory('');
      loadTrending();
      safeScroll($('#sectionTitle'));
    });
    els.loginBtn?.addEventListener('click', () => { window.location.href = '/admin.html'; });
    els.joinBtn?.addEventListener('click', () => { window.location.href = '/contact.html?topic=kolaborasi'; });
    els.newsletterForm?.addEventListener('submit', submitNewsletter);
  }

  window.openArticle = openArticle;

  async function bootstrap() {
    applyTheme();
    bindEvents();
    updateClock();
    setInterval(updateClock, 1000);
    if ($('#year')) $('#year').textContent = String(new Date().getFullYear());
    const currentSession = sessionStorage.getItem('bmi-session') || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem('bmi-session', currentSession);

    await Promise.all([
      loadSystem(),
      loadArticles(),
      loadTrending(),
      loadLive(),
      loadVideos(),
      loadAds()
    ]);

    renderHero();
    renderCompact();
    renderTrending();
    renderLiveUpdates();
    updateFeatureOverall();

    const params = new URLSearchParams(window.location.search);
    const articleId = params.get('article');
    const urlQuery = params.get('q');
    if (urlQuery) { state.query = urlQuery.trim(); if (els.search) els.search.value = state.query; await loadArticles(); }
    if (articleId) openArticle(articleId);
    $$('.region-chip').forEach(btn => btn.addEventListener('click', async () => {
      $$('.region-chip').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      const q = btn.dataset.regionQuery || '';
      state.category = '';
      state.query = q === 'Jawa Tengah' ? '' : q;
      if (els.search) els.search.value = state.query;
      await loadArticles();
      renderHero(); renderCompact(); renderTrending();
      document.querySelector('.content-layout')?.scrollIntoView({behavior:'smooth',block:'start'});
    }));
    $$('[data-region-query]:not(.region-chip)').forEach(btn => btn.addEventListener('click', async (event) => {
      event.preventDefault();
      const q = btn.dataset.regionQuery || '';
      state.category = '';
      state.query = q === 'Jawa Tengah' ? '' : q;
      if (els.search) els.search.value = state.query;
      await loadArticles();
      renderHero(); renderCompact(); renderTrending();
      document.querySelector('.content-layout')?.scrollIntoView({behavior:'smooth',block:'start'});
    }));
    $('#advertiserQuickCta')?.addEventListener('click', () => $('#advertiseBtn')?.click());

    state.autoTimer = setInterval(async () => {
      await Promise.all([
        loadArticles({ silent: true }),
        loadTrending(),
        loadLive(),
        loadVideos()
      ]);
      renderLiveUpdates();
    }, 120_000);
  }

  bootstrap().catch(error => {
    console.error('[BMI] bootstrap failed:', error);
    toast('Newsroom memulai dalam mode pemulihan.');
  });
})();
