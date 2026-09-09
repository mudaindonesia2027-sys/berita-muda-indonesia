(() => {
  const state = {
    category: '',
    query: '',
    articles: [],
    videos: [],
    loading: false,
    autoTimer: null,
    heroId: null,
    sessionId:
      localStorage.getItem('bmi-session-id') ||
      crypto.randomUUID(),
    articleReadTimers: new Map()
  };

  localStorage.setItem(
    'bmi-session-id',
    state.sessionId
  );

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

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
    showAllVideos: $('#showAllVideos')
  };

  /* =====================================================
     HELPERS
  ===================================================== */

  const escapeHtml = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      character =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[character]
    );

  const stripHtml = value =>
    String(value ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const safeHtml = value =>
    String(value ?? '')
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        ''
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        ''
      )
      .replace(
        /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
        ''
      )
      .replace(/javascript:/gi, '');

  const articleTime = article =>
    article?.published_at ||
    article?.created_at ||
    article?.updated_at;

  const imageUrl = item =>
    item?.image_url ||
    item?.thumbnail_url ||
    '';

  const numberFormat = value =>
    Number(value || 0).toLocaleString('id-ID');

  const readingTime = article => {
    const minutes = Number(
      article?.reading_minutes
    );

    if (
      Number.isFinite(minutes) &&
      minutes > 0
    ) {
      return `${minutes} menit baca`;
    }

    const content =
      stripHtml(
        article?.content ||
        article?.content_html ||
        article?.summary ||
        ''
      );

    const words =
      content.split(/\s+/).filter(Boolean).length;

    return `${Math.max(
      1,
      Math.ceil(words / 200)
    )} menit baca`;
  };

  const fmtDate = value => {
    if (!value) {
      return 'Baru diperbarui';
    }

    const date = new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return 'Baru diperbarui';
    }

    const difference =
      Date.now() -
      date.getTime();

    if (difference < 60_000) {
      return 'Baru saja';
    }

    if (difference < 3_600_000) {
      return `${Math.max(
        1,
        Math.floor(
          difference / 60_000
        )
      )} menit lalu`;
    }

    if (
      difference <
      86_400_000
    ) {
      return `${Math.floor(
        difference / 3_600_000
      )} jam lalu`;
    }

    return new Intl.DateTimeFormat(
      'id-ID',
      {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }
    ).format(date);
  };

  const absoluteDate = value => {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '';
    }

    return new Intl.DateTimeFormat(
      'id-ID',
      {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }
    ).format(date);
  };

  const toast = (
    message,
    type = ''
  ) => {
    const notification =
      document.createElement('div');

    notification.className =
      `toast ${type}`;

    notification.textContent =
      message;

    els.toast.appendChild(
      notification
    );

    setTimeout(
      () => notification.remove(),
      3600
    );
  };

  const trackEvent = async ({
    event_type,
    content_type = null,
    content_id = null
  }) => {
    try {
      await fetch(
        '/api/analytics/event',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({
            event_type,
            content_type,
            content_id,
            path:
              window.location.pathname,

            referrer:
              document.referrer,

            session_id:
              state.sessionId
          })
        }
      );
    } catch (_) {
      /* analytics tidak boleh
         merusak aplikasi */
    }
  };

  /* =====================================================
     CLOCK
  ===================================================== */

  function updateClock() {
    const now =
      new Date();

    if (els.today) {
      els.today.textContent =
        new Intl.DateTimeFormat(
          'id-ID',
          {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          }
        ).format(now);
    }

    if (els.clock) {
      els.clock.textContent =
        new Intl.DateTimeFormat(
          'id-ID',
          {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone:
              'Asia/Jakarta'
          }
        ).format(now) +
        ' WIB';
    }
  }

  /* =====================================================
     LOADING
  ===================================================== */

  function setLoading(
    active
  ) {
    state.loading =
      active;

    if (els.loading) {
      els.loading.classList.toggle(
        'hidden',
        !active
      );
    }

    if (
      active &&
      els.empty
    ) {
      els.empty.classList.add(
        'hidden'
      );
    }
  }

  function activateCategory(
    category
  ) {
    state.category =
      category;

    $$(
      '.nav-item[data-category]'
    ).forEach(button =>
      button.classList.toggle(
        'active',
        button.dataset.category ===
          category
      )
    );

    $$('.pill').forEach(
      button =>
        button.classList.toggle(
          'active',
          button.dataset.category ===
            category
        )
    );
  }

  /* =====================================================
     ARTICLE CARD
  ===================================================== */

  function articleCard(
    article,
    index
  ) {
    const card =
      document.createElement(
        'article'
      );

    card.className =
      `article-card${
        index === 0
          ? ' featured'
          : ''
      }`;

    const image =
      imageUrl(article);

    const title =
      article.title ||
      'Berita terbaru';

    const summary =
      stripHtml(
        article.summary ||
        article.content ||
        article.content_html ||
        'Ringkasan berita belum tersedia.'
      );

    card.innerHTML = `
      <div
        class="article-thumb"
        ${
          image
            ? `style="background-image:url('${escapeHtml(
                image
              )}')"`
            : ''
        }
      ></div>

      <div class="article-body">

        <div class="article-meta">

          <span class="article-category">
            ${escapeHtml(
              article.category ||
                'TERBARU'
            )}
          </span>

          <span>
            ${escapeHtml(
              fmtDate(
                articleTime(
                  article
                )
              )
            )}
          </span>

        </div>

        <h3>
          ${escapeHtml(
            title
          )}
        </h3>

        <p>
          ${escapeHtml(
            summary
          )}
        </p>

        <div class="article-foot">

          <span>
            ${escapeHtml(
              article.author_name ||
                article.source ||
                'Berita Muda Indonesia'
            )}
          </span>

          <span class="read-link">
            Baca →
          </span>

        </div>

      </div>
    `;

    card.addEventListener(
      'click',
      () =>
        openArticle(
          article.id,
          article
        )
    );

    return card;
  }

  /* =====================================================
     HERO
  ===================================================== */

  function renderHero() {
    const article =
      state.articles[0];

    state.heroId =
      article?.id ||
      null;

    if (!article) {
      els.heroImage?.classList.remove(
        'has-image'
      );

      if (els.heroImage) {
        els.heroImage.style.backgroundImage =
          '';
      }

      if (els.heroCategory) {
        els.heroCategory.textContent =
          'TOP STORY';
      }

      if (els.heroTitle) {
        els.heroTitle.textContent =
          'Newsroom siap menerima pembaruan terbaru';
      }

      if (els.heroSummary) {
        els.heroSummary.textContent =
          'Berita utama akan tampil otomatis ketika sumber data dan sinkronisasi newsroom aktif.';
      }

      if (els.heroDate) {
        els.heroDate.textContent =
          'LIVE DATA';
      }

      if (els.heroViews) {
        els.heroViews.textContent =
          'Menunggu sinkronisasi';
      }

      if (els.ticker) {
        els.ticker.textContent =
          'Sumber berita belum mengirim artikel baru.';
      }

      return;
    }

    const image =
      imageUrl(article);

    if (els.heroImage) {
      els.heroImage.style.backgroundImage =
        image
          ? `url("${image.replace(
              /"/g,
              '\\"'
            )}")`
          : '';

      els.heroImage.classList.toggle(
        'has-image',
        Boolean(image)
      );
    }

    if (els.heroCategory) {
      els.heroCategory.textContent =
        article.category ||
        'TOP STORY';
    }

    if (els.heroTitle) {
      els.heroTitle.textContent =
        article.title ||
        'Berita terbaru';
    }

    if (els.heroSummary) {
      els.heroSummary.textContent =
        stripHtml(
          article.summary ||
          article.content ||
          article.content_html ||
          'Ringkasan berita terbaru dari newsroom.'
        );
    }

    if (els.heroDate) {
      els.heroDate.textContent =
        fmtDate(
          articleTime(article)
        );
    }

    if (els.heroViews) {
      els.heroViews.textContent =
        `${numberFormat(
          article.views
        )} views`;
    }

    if (els.ticker) {
      els.ticker.textContent =
        article.title ||
        'Berita terbaru';
    }
  }

  /* =====================================================
     COMPACT
  ===================================================== */

  function renderCompact() {
    if (!els.compact) {
      return;
    }

    els.compact.innerHTML =
      '';

    state.articles
      .slice(1, 4)
      .forEach(article => {
        const button =
          document.createElement(
            'button'
          );

        button.className =
          'compact-card';

        const image =
          imageUrl(article);

        button.innerHTML = `
          <div
            class="compact-thumb"
            ${
              image
                ? `style="background-image:url('${escapeHtml(
                    image
                  )}')"`
                : ''
            }
          ></div>

          <div class="compact-copy">

            <span class="tag ghost">
              ${escapeHtml(
                article.category ||
                  'TERBARU'
              )}
            </span>

            <h3>
              ${escapeHtml(
                article.title ||
                  'Berita terbaru'
              )}
            </h3>

            <small>
              ${escapeHtml(
                fmtDate(
                  articleTime(
                    article
                  )
                )
              )}
              ·
              ${escapeHtml(
                article.source ||
                  'Berita Muda'
              )}
            </small>

          </div>
        `;

        button.addEventListener(
          'click',
          () =>
            openArticle(
              article.id,
              article
            )
        );

        els.compact.appendChild(
          button
        );
      });

    if (
      !els.compact.children.length
    ) {
      els.compact.innerHTML = `
        <div class="compact-card">

          <div class="compact-thumb"></div>

          <div class="compact-copy">

            <span class="tag ghost">
              SMART FEED
            </span>

            <h3>
              Artikel terbaru akan muncul di sini
            </h3>

            <small>
              Menunggu sinkronisasi
            </small>

          </div>

        </div>
      `;
    }
  }

  /* =====================================================
     TRENDING
  ===================================================== */

  function renderTrending() {
    if (!els.trending) {
      return;
    }

    els.trending.innerHTML =
      '';

    state.articles
      .slice(0, 5)
      .forEach(
        (
          article,
          index
        ) => {
          const item =
            document.createElement(
              'li'
            );

          item.innerHTML = `
            <span class="trend-number">
              ${index + 1}
            </span>

            <button>
              ${escapeHtml(
                article.title ||
                  'Berita terbaru'
              )}
            </button>

            <span class="trend-up">
              ↗
            </span>
          `;

          item
            .querySelector(
              'button'
            )
            .addEventListener(
              'click',
              () =>
                openArticle(
                  article.id,
                  article
                )
            );

          els.trending.appendChild(
            item
          );
        }
      );
  }

  /* =====================================================
     ARTICLE LIST
  ===================================================== */

  function renderArticles() {
    if (!els.grid) {
      return;
    }

    els.grid.innerHTML =
      '';

    state.articles.forEach(
      (
        article,
        index
      ) =>
        els.grid.appendChild(
          articleCard(
            article,
            index
          )
        )
    );

    const count =
      state.articles.length;

    if (els.count) {
      els.count.textContent =
        `${count} berita`;
    }

    if (els.clear) {
      els.clear.classList.toggle(
        'hidden',
        !(
          state.category ||
          state.query
        )
      );
    }

    if (els.section) {
      els.section.textContent =
        state.query
          ? `Hasil Pencarian: ${state.query}`
          : state.category
            ? `Berita ${state.category
                .toLowerCase()
                .replace(
                  /(^|\s)\S/g,
                  character =>
                    character.toUpperCase()
                )}`
            : 'Berita Terbaru';
    }

    if (els.empty) {
      els.empty.classList.toggle(
        'hidden',
        count > 0
      );
    }
  }

  /* =====================================================
     SYSTEM
  ===================================================== */

  async function loadSystem() {
    try {
      const response =
        await fetch(
          '/api/system/config',
          {
            cache:
              'no-store'
          }
        );

      const data =
        await response.json();

      if (els.sourceStatus) {
        els.sourceStatus.textContent =
          data.supabaseConfigured
            ? 'Sumber data terhubung'
            : 'Mode konfigurasi';
      }
    } catch (_) {
      if (els.sourceStatus) {
        els.sourceStatus.textContent =
          'Status sumber tidak tersedia';
      }
    }
  }

  /* =====================================================
     LOAD ARTICLES
  ===================================================== */

  async function loadArticles({
    silent = false
  } = {}) {
    if (
      state.loading
    ) {
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    const params =
      new URLSearchParams({
        limit:
          '24'
      });

    if (state.category) {
      params.set(
        'category',
        state.category
      );
    }

    if (state.query) {
      params.set(
        'q',
        state.query
      );
    }

    try {
      const response =
        await fetch(
          `/api/articles?${params}`,
          {
            headers: {
              Accept:
                'application/json'
            },

            cache:
              'no-store'
          }
        );

      if (!response.ok) {
        throw new Error(
          `API ${response.status}`
        );
      }

      const data =
        await response.json();

      state.articles =
        Array.isArray(data)
          ? data
          : [];

      renderHero();
      renderCompact();
      renderTrending();
      renderArticles();

      if (
        state.articles.length &&
        els.sourceStatus
      ) {
        els.sourceStatus.textContent =
          'Live data aktif';
      }

    } catch (error) {

      console.error(
        error
      );

      state.articles =
        [];

      renderHero();
      renderCompact();
      renderTrending();
      renderArticles();

      if (els.sourceStatus) {
        els.sourceStatus.textContent =
          'Koneksi perlu perhatian';
      }

      if (els.emptyTitle) {
        els.emptyTitle.textContent =
          'Koneksi berita belum berhasil';
      }

      if (els.emptyText) {
        els.emptyText.textContent =
          `Tidak dapat mengambil berita dari API: ${error.message}`;
      }

    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     LIVE UPDATE
  ===================================================== */

  function renderLiveUpdates() {
    if (!els.liveUpdates) {
      return;
    }

    const now =
      new Date();

    const items =
      state.articles.slice(
        0,
        4
      );

    els.liveUpdates.innerHTML =
      '';

    (
      items.length
        ? items
        : [
            {
              title:
                'Sistem memantau pembaruan sumber berita secara berkala.'
            },
            {
              title:
                'Data live akan masuk otomatis setelah sinkronisasi aktif.'
            }
          ]
    ).forEach(
      (
        article,
        index
      ) => {
        const row =
          document.createElement(
            'div'
          );

        row.className =
          'live-update';

        const time =
          new Date(
            now.getTime() -
            index *
              7 *
              60_000
          );

        row.innerHTML = `
          <time>
            ${new Intl.DateTimeFormat(
              'id-ID',
              {
                hour:
                  '2-digit',
                minute:
                  '2-digit',
                hour12:
                  false,
                timeZone:
                  'Asia/Jakarta'
              }
            ).format(time)}
          </time>

          <p>
            ${escapeHtml(
              article.title
            )}
          </p>
        `;

        els.liveUpdates.appendChild(
          row
        );
      }
    );
  }

  /* =====================================================
     VIDEOS
  ===================================================== */

  async function loadVideos() {
    if (!els.videoGrid) {
      return;
    }

    try {
      const response =
        await fetch(
          '/api/videos?limit=6',
          {
            headers: {
              Accept:
                'application/json'
            },

            cache:
              'no-store'
          }
        );

      if (!response.ok) {
        throw new Error();
      }

      const data =
        await response.json();

      state.videos =
        Array.isArray(data)
          ? data
          : [];

    } catch (_) {
      state.videos =
        [];
    }

    els.videoGrid.innerHTML =
      '';

    state.videos
      .slice(0, 4)
      .forEach(video => {
        const card =
          document.createElement(
            'button'
          );

        card.className =
          'video-card';

        const image =
          imageUrl(video);

        card.innerHTML = `
          <div
            class="video-thumb"
            ${
              image
                ? `style="background-image:url('${escapeHtml(
                    image
                  )}')"`
                : ''
            }
          ></div>

          <div>

            <h4>
              ${escapeHtml(
                video.title ||
                  'Video terbaru'
              )}
            </h4>

            <small>
              ${escapeHtml(
                video.category ||
                  'VIDEO'
              )}
              ·
              ${escapeHtml(
                video.source ||
                  'Berita Muda'
              )}
            </small>

          </div>
        `;

        card.addEventListener(
          'click',
          () =>
            openVideo(video)
        );

        els.videoGrid.appendChild(
          card
        );
      });

    if (
      !state.videos.length
    ) {
      els.videoGrid.innerHTML = `
        <div class="video-empty">
          Belum ada video published.
        </div>
      `;
    }
  }

  /* =====================================================
     RELATED ARTICLES
  ===================================================== */

  function relatedArticles(
    article
  ) {
    return state.articles
      .filter(
        item =>
          item.id !==
          article.id
      )
      .sort(
        (
          first,
          second
        ) => {
          const firstScore =
            first.category ===
            article.category
              ? 1
              : 0;

          const secondScore =
            second.category ===
            article.category
              ? 1
              : 0;

          return (
            secondScore -
            firstScore
          );
        }
      )
      .slice(
        0,
        3
      );
  }

  /* =====================================================
     ADVERTISEMENT
  ===================================================== */

  function advertisementMarkup() {
    return `
      <aside class="article-ad-slot">

        <span class="ad-label">
          ADVERTISEMENT
        </span>

        <div class="article-ad-placeholder">

          <strong>
            Ruang Iklan
          </strong>

          <span>
            Kampanye sponsor akan tampil di area ini
          </span>

        </div>

      </aside>
    `;
  }

  /* =====================================================
     ARTICLE BODY
  ===================================================== */

  function buildArticleBody(
    article
  ) {
    const raw =
      article.content_html ||
      article.content ||
      '';

    if (raw) {

      if (
        /<[^>]+>/.test(
          raw
        )
      ) {
        return safeHtml(
          raw
        );
      }

      return raw
        .split(
          /\n\s*\n/
        )
        .filter(
          Boolean
        )
        .map(
          paragraph =>
            `<p>${escapeHtml(
              paragraph
            )}</p>`
        )
        .join(
          ''
        );
    }

    if (
      article.summary
    ) {
      return `
        <p>
          ${escapeHtml(
            article.summary
          )}
        </p>
      `;
    }

    return `
      <div class="article-no-content">

        <strong>
          Naskah artikel belum tersedia
        </strong>

        <p>
          Konten lengkap belum dimasukkan ke newsroom.
        </p>

      </div>
    `;
  }

  /* =====================================================
     ARTICLE DETAIL
  ===================================================== */

  async function openArticle(
    id,
    fallback
  ) {

    if (!els.modal) {
      return;
    }

    els.modal.classList.remove(
      'hidden'
    );

    document.body.style.overflow =
      'hidden';

    els.modalBody.innerHTML = `
      <div class="article-loading">

        <span class="eyebrow">
          MEMUAT ARTIKEL
        </span>

        <h2>
          Menyiapkan berita…
        </h2>

      </div>
    `;

    let article =
      fallback;

    if (id) {
      try {

        const response =
          await fetch(
            `/api/articles/${encodeURIComponent(
              id
            )}`,
            {
              headers: {
                Accept:
                  'application/json'
              },

              cache:
                'no-store'
            }
          );

        if (
          response.ok
        ) {
          article =
            await response.json();
        }

      } catch (
        error
      ) {
        console.error(
          error
        );
      }
    }

    if (!article) {

      els.modalBody.innerHTML = `
        <div class="article-loading">

          <span class="eyebrow">
            DATA BELUM TERSEDIA
          </span>

          <h2>
            Artikel tidak dapat dibuka
          </h2>

          <p>
            Konten mungkin belum tersinkronisasi.
          </p>

        </div>
      `;

      return;
    }

    await trackEvent({
      event_type:
        'view',

      content_type:
        'article',

      content_id:
        article.id
    });

    const image =
      imageUrl(article);

    const content =
      buildArticleBody(
        article
      );

    const tags =
      Array.isArray(
        article.tags
      )
        ? article.tags
        : [];

    const related =
      relatedArticles(
        article
      );

    const sourceUrl =
      article.source_url ||
      article.url ||
      '';

    const articleUrl =
      `${window.location.origin}/berita/${article.id}`;

    const author =
      article.author_name ||
      article.source ||
      'Redaksi Berita Muda Indonesia';

    const updated =
      article.updated_at &&
      article.published_at &&
      article.updated_at !==
        article.published_at;

    els.modalBody.innerHTML = `

      <article
        class="premium-article"
        data-article-id="${escapeHtml(
          article.id
        )}"
      >

        <header class="premium-article-header">

          <div class="article-breadcrumb">

            <span>
              ${escapeHtml(
                article.category ||
                  'BERITA'
              )}
            </span>

            <span>
              Berita Muda Indonesia
            </span>

          </div>

          <span class="premium-category">
            ${escapeHtml(
              article.category ||
                'TERBARU'
            )}
          </span>

          <h1>
            ${escapeHtml(
              article.title ||
                'Berita terbaru'
            )}
          </h1>

          ${
            article.summary
              ? `
                <p class="premium-summary">
                  ${escapeHtml(
                    stripHtml(
                      article.summary
                    )
                  )}
                </p>
              `
              : ''
          }

          <div class="article-byline">

            <div class="author-block">

              <div class="author-avatar">
                ${escapeHtml(
                  author
                    .charAt(0)
                    .toUpperCase()
                )}
              </div>

              <div>

                <strong>
                  ${escapeHtml(
                    author
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    article.source ||
                      'Berita Muda Indonesia'
                  )}
                </span>

              </div>

            </div>

            <div class="article-date-block">

              <span>
                ${escapeHtml(
                  absoluteDate(
                    articleTime(
                      article
                    )
                  )
                )}
              </span>

              ${
                updated
                  ? `
                    <small>
                      Diperbarui
                      ${escapeHtml(
                        absoluteDate(
                          article.updated_at
                        )
                      )}
                    </small>
                  `
                  : ''
              }

            </div>

          </div>

          <div class="article-stats">

            <span>
              👁
              ${numberFormat(
                article.views
              )}
              dilihat
            </span>

            <span>
              ⏱
              ${escapeHtml(
                readingTime(
                  article
                )
              )}
            </span>

          </div>

          <div class="article-actions">

            <button
              class="article-action like-action"
              data-action="like"
            >

              <span>
                ♡
              </span>

              <span>
                Suka
              </span>

              <b
                id="articleLikeCount"
              >
                ${numberFormat(
                  article.likes
                )}
              </b>

            </button>

            <button
              class="article-action"
              data-action="share"
            >

              <span>
                ↗
              </span>

              Bagikan

            </button>

            <button
              class="article-action"
              data-action="whatsapp"
            >

              <span>
                ◉
              </span>

              WhatsApp

            </button>

            <button
              class="article-action"
              data-action="copy"
            >

              <span>
                ⧉
              </span>

              Salin Link

            </button>

          </div>

        </header>

        ${
          image
            ? `
              <figure class="premium-hero">

                <img
                  src="${escapeHtml(
                    image
                  )}"

                  alt="${escapeHtml(
                    article.title ||
                      'Berita'
                  )}"
                >

                <figcaption>

                  ${escapeHtml(
                    article.image_caption ||
                      article.source ||
                      'Berita Muda Indonesia'
                  )}

                </figcaption>

              </figure>
            `
            : ''
        }

        <div class="article-reading-layout">

          <aside class="article-social-rail">

            <button
              data-action="like"
              title="Suka"
            >
              ♡
            </button>

            <button
              data-action="share"
              title="Bagikan"
            >
              ↗
            </button>

            <button
              data-action="copy"
              title="Salin link"
            >
              ⧉
            </button>

          </aside>

          <div class="article-reading-content">

            <div
              class="article-html premium-prose"
            >

              ${content}

            </div>

            ${advertisementMarkup()}

            ${
              tags.length
                ? `
                  <section class="article-tags-section">

                    <span>
                      TOPIK
                    </span>

                    <div class="article-tags">

                      ${tags
                        .map(
                          tag =>
                            `
                              <button
                                data-tag="${escapeHtml(
                                  tag
                                )}"
                              >
                                #${escapeHtml(
                                  tag
                                )}
                              </button>
                            `
                        )
                        .join(
                          ''
                        )}

                    </div>

                  </section>
                `
                : ''
            }

            <section class="article-source-card">

              <span class="source-label">
                INFORMASI SUMBER
              </span>

              <strong>
                ${escapeHtml(
                  article.source ||
                    'Berita Muda Indonesia'
                )}
              </strong>

              ${
                sourceUrl
                  ? `
                    <a
                      href="${escapeHtml(
                        sourceUrl
                      )}"

                      target="_blank"

                      rel="noopener noreferrer"
                    >

                      Buka sumber informasi ↗

                    </a>
                  `
                  : ''
              }

            </section>

          </div>

        </div>

        ${
          related.length
            ? `
              <section class="related-section">

                <div class="related-heading">

                  <span>
                    LANJUT BACA
                  </span>

                  <h2>
                    Berita Terkait
                  </h2>

                </div>

                <div class="related-grid">

                  ${related
                    .map(
                      item =>
                        `
                          <button
                            class="related-card"
                            data-related="${escapeHtml(
                              item.id
                            )}"
                          >

                            ${
                              imageUrl(
                                item
                              )
                                ? `
                                  <div
                                    class="related-image"
                                    style="background-image:url('${escapeHtml(
                                      imageUrl(
                                        item
                                      )
                                    )}')"
                                  ></div>
                                `
                                : ''
                            }

                            <div>

                              <span>
                                ${escapeHtml(
                                  item.category ||
                                    'BERITA'
                                )}
                              </span>

                              <h3>
                                ${escapeHtml(
                                  item.title ||
                                    'Berita terbaru'
                                )}
                              </h3>

                              <small>
                                ${escapeHtml(
                                  readingTime(
                                    item
                                  )
                                )}
                              </small>

                            </div>

                          </button>
                        `
                    )
                    .join(
                      ''
                    )}

                </div>

              </section>
            `
            : ''
        }

      </article>
    `;

    bindArticleActions(
      article,
      articleUrl
    );

    startArticleReadTracking(
      article
    );
  }

  /* =====================================================
     ARTICLE INTERACTION
  ===================================================== */

  function bindArticleActions(
    article,
    articleUrl
  ) {

    const root =
      els.modalBody;

    if (!root) {
      return;
    }

    const likeButtons =
      $$(
        '[data-action="like"]',
        root
      );

    const shareButtons =
      $$(
        '[data-action="share"]',
        root
      );

    const whatsappButtons =
      $$(
        '[data-action="whatsapp"]',
        root
      );

    const copyButtons =
      $$(
        '[data-action="copy"]',
        root
      );

    const relatedButtons =
      $$(
        '[data-related]',
        root
      );

    const tagButtons =
      $$(
        '[data-tag]',
        root
      );

    let liked =
      localStorage.getItem(
        `bmi-liked-${article.id}`
      ) === 'true';

    function updateLikeUI() {

      likeButtons.forEach(
        button => {
          button.classList.toggle(
            'active',
            liked
          );
        }
      );
    }

    updateLikeUI();

    likeButtons.forEach(
      button =>
        button.addEventListener(
          'click',
          async () => {

            if (
              liked
            ) {
              toast(
                'Anda sudah menyukai artikel ini.'
              );

              return;
            }

            liked =
              true;

            localStorage.setItem(
              `bmi-liked-${article.id}`,
              'true'
            );

            updateLikeUI();

            article.likes =
              Number(
                article.likes ||
                  0
              ) +
              1;

            const count =
              $('#articleLikeCount');

            if (count) {
              count.textContent =
                numberFormat(
                  article.likes
                );
            }

            await trackEvent({
              event_type:
                'like',

              content_type:
                'article',

              content_id:
                article.id
            });

            toast(
              'Terima kasih atas dukungan Anda.',
              'success'
            );

          }
        )
    );

    shareButtons.forEach(
      button =>
        button.addEventListener(
          'click',
          async () => {

            await trackEvent({
              event_type:
                'share',

              content_type:
                'article',

              content_id:
                article.id
            });

            const shareData = {
              title:
                article.title,

              text:
                article.summary ||
                article.title,

              url:
                articleUrl
            };

            try {

              if (
                navigator.share
              ) {
                await navigator.share(
                  shareData
                );
              } else {
                await navigator.clipboard.writeText(
                  articleUrl
                );

                toast(
                  'Link artikel disalin.'
                );
              }

            } catch (_) {
              /* user membatalkan share */
            }

          }
        )
    );

    whatsappButtons.forEach(
      button =>
        button.addEventListener(
          'click',
          async () => {

            await trackEvent({
              event_type:
                'share',

              content_type:
                'article',

              content_id:
                article.id
            });

            const message =
              `${article.title}\n\n${articleUrl}`;

            window.open(
              `https://wa.me/?text=${encodeURIComponent(
                message
              )}`,
              '_blank',
              'noopener'
            );

          }
        )
    );

    copyButtons.forEach(
      button =>
        button.addEventListener(
          'click',
          async () => {

            try {

              await navigator.clipboard.writeText(
                articleUrl
              );

              await trackEvent({
                event_type:
                  'share',

                content_type:
                  'article',

                content_id:
                  article.id
              });

              toast(
                'Link artikel berhasil disalin.',
                'success'
              );

            } catch (_) {

              toast(
                'Tidak dapat menyalin link.'
              );

            }

          }
        )
    );

    relatedButtons.forEach(
      button =>
        button.addEventListener(
          'click',
          () => {

            const related =
              state.articles.find(
                item =>
                  item.id ===
                  button.dataset.related
              );

            if (
              related
            ) {
              openArticle(
                related.id,
                related
              );
            }

          }
        )
    );

    tagButtons.forEach(
      button =>
        button.addEventListener(
          'click',
          () => {

            const tag =
              button.dataset.tag;

            closeModal();

            state.query =
              tag;

            if (els.search) {
              els.search.value =
                tag;
            }

            activateCategory(
              ''
            );

            loadArticles();

            setTimeout(
              () =>
                els.section?.scrollIntoView(
                  {
                    behavior:
                      'smooth'
                  }
                ),
              250
            );

          }
        )
    );
  }

  /* =====================================================
     READ ANALYTICS
  ===================================================== */

  function startArticleReadTracking(
    article
  ) {

    if (
      state.articleReadTimers.has(
        article.id
      )
    ) {
      return;
    }

    const timer =
      setTimeout(
        async () => {

          await trackEvent({
            event_type:
              'article_read',

            content_type:
              'article',

            content_id:
              article.id
          });

        },
        15_000
      );

    state.articleReadTimers.set(
      article.id,
      timer
    );
  }

  /* =====================================================
     VIDEO
  ===================================================== */

  function openVideo(
    video
  ) {

    if (!els.modal) {
      return;
    }

    els.modal.classList.remove(
      'hidden'
    );

    document.body.style.overflow =
      'hidden';

    const source =
      video.video_url;

    const image =
      imageUrl(video);

    els.modalBody.innerHTML = `
      <div class="video-modal-content">

        <span class="eyebrow">
          VIDEO
        </span>

        <h2>
          ${escapeHtml(
            video.title ||
              'Video terbaru'
          )}
        </h2>

        ${
          source
            ? `
              <video
                controls
                playsinline
                poster="${escapeHtml(
                  image
                )}"

                src="${escapeHtml(
                  source
                )}"
              ></video>
            `
            : image
              ? `
                <img
                  class="modal-hero"
                  src="${escapeHtml(
                    image
                  )}"

                  alt="${escapeHtml(
                    video.title
                  )}"
                >
              `
              : ''
        }

        <p class="summary">
          ${escapeHtml(
            video.description ||
              'Informasi video belum tersedia.'
          )}
        </p>

      </div>
    `;

    trackEvent({
      event_type:
        'video_play',

      content_type:
        'video',

      content_id:
        video.id
    });
  }

  /* =====================================================
     CLOSE MODAL
  ===================================================== */

  function closeModal() {

    els.modal?.classList.add(
      'hidden'
    );

    document.body.style.overflow =
      '';
  }

  function scrollToVideo() {
    $('#videoPanel')?.scrollIntoView(
      {
        behavior:
          'smooth',

        block:
          'start'
      }
    );
  }

  /* =====================================================
     EVENTS
  ===================================================== */

  els.heroOpen?.addEventListener(
    'click',
    () =>
      openArticle(
        state.heroId,
        state.articles[0]
      )
  );

  els.refresh?.addEventListener(
    'click',
    async () => {

      await loadArticles();

      renderLiveUpdates();

      toast(
        'Pembaruan selesai.',
        'success'
      );

    }
  );

  els.emptyRefresh?.addEventListener(
    'click',
    () =>
      loadArticles()
  );

  els.form?.addEventListener(
    'submit',
    event => {

      event.preventDefault();

      state.query =
        els.search.value.trim();

      activateCategory(
        ''
      );

      loadArticles();

    }
  );

  els.nav?.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest(
          '[data-category]'
        );

      if (!button) {
        return;
      }

      state.query =
        '';

      if (els.search) {
        els.search.value =
          '';
      }

      activateCategory(
        button.dataset.category
      );

      loadArticles();

    }
  );

  els.tiles?.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest(
          '[data-category]'
        );

      if (!button) {
        return;
      }

      state.query =
        '';

      if (els.search) {
        els.search.value =
          '';
      }

      activateCategory(
        button.dataset.category
      );

      loadArticles();

    }
  );

  els.pills?.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest(
          '[data-category]'
        );

      if (!button) {
        return;
      }

      state.query =
        '';

      if (els.search) {
        els.search.value =
          '';
      }

      activateCategory(
        button.dataset.category
      );

      loadArticles();

    }
  );

  els.clear?.addEventListener(
    'click',
    () => {

      state.query =
        '';

      if (els.search) {
        els.search.value =
          '';
      }

      activateCategory(
        ''
      );

      loadArticles();

    }
  );

  $$(
    '[data-close-modal]'
  ).forEach(
    button =>
      button.addEventListener(
        'click',
        closeModal
      )
  );

  document.addEventListener(
    'keydown',
    event => {

      if (
        event.key ===
        'Escape'
      ) {
        closeModal();
      }

    }
  );

  els.theme?.addEventListener(
    'click',
    () => {

      const next =
        document.documentElement
          .dataset.theme ===
          'light'
          ? 'dark'
          : 'light';

      document.documentElement
        .dataset.theme =
        next;

      localStorage.setItem(
        'bmi-theme',
        next
      );

    }
  );

  const savedTheme =
    localStorage.getItem(
      'bmi-theme'
    );

  if (savedTheme) {
    document.documentElement
      .dataset.theme =
      savedTheme;
  }

  els.videoShortcut?.addEventListener(
    'click',
    scrollToVideo
  );

  els.videoNav?.addEventListener(
    'click',
    scrollToVideo
  );

  els.liveTv?.addEventListener(
    'click',
    scrollToVideo
  );

  els.showAllVideos?.addEventListener(
    'click',
    scrollToVideo
  );

  $('#refreshLive')?.addEventListener(
    'click',
    () => {

      renderLiveUpdates();

      toast(
        'Live update diperbarui.',
        'success'
      );

    }
  );

  $('#advertiseBtn')?.addEventListener(
    'click',
    () =>
      toast(
        'Modul iklan sedang disiapkan untuk kampanye aktif.'
      )
  );

  $('#exploreBtn')?.addEventListener(
    'click',
    () =>
      $('#sectionTitle')?.scrollIntoView(
        {
          behavior:
            'smooth'
        }
      )
  );

  $('#openTrending')?.addEventListener(
    'click',
    () => {

      activateCategory(
        ''
      );

      state.query =
        '';

      loadArticles();

      $('#sectionTitle')?.scrollIntoView(
        {
          behavior:
            'smooth'
        }
      );

    }
  );

  $('#loginBtn')?.addEventListener(
    'click',
    () =>
      toast(
        'Google Login akan diaktifkan pada tahap autentikasi.'
      )
  );

  $('#joinBtn')?.addEventListener(
    'click',
    () =>
      toast(
        'Registrasi akan memakai Supabase Auth.'
      )
  );

  $('#notificationBtn')?.addEventListener(
    'click',
    () =>
      toast(
        state.articles.length
          ? 'Ada pembaruan berita terbaru.'
          : 'Belum ada notifikasi baru.'
      )
  );

  $('#newsletterForm')?.addEventListener(
    'submit',
    event => {

      event.preventDefault();

      event.target.reset();

      toast(
        'Terima kasih. Newsletter siap dihubungkan ke sistem email.',
        'success'
      );

    }
  );

  /* =====================================================
     URL ARTICLE
     /?article=UUID
  ===================================================== */

  async function openArticleFromURL() {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const id =
      params.get(
        'article'
      );

    if (!id) {
      return;
    }

    await openArticle(
      id,
      null
    );
  }

  /* =====================================================
     INIT
  ===================================================== */

  updateClock();

  setInterval(
    updateClock,
    1000
  );

  const year =
    $('#year');

  if (year) {
    year.textContent =
      new Date().getFullYear();
  }

  trackEvent({
    event_type:
      'pageview',

    content_type:
      'site'
  });

  Promise.all([
    loadSystem(),
    loadArticles(),
    loadVideos()
  ]).then(
    () => {

      renderLiveUpdates();

      openArticleFromURL();

    }
  );

  state.autoTimer =
    setInterval(
      async () => {

        await loadArticles({
          silent:
            true
        });

        renderLiveUpdates();

      },
      60_000
    );

})();
