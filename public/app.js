(() => {
  'use strict';

  /* =========================================================
     BERITA MUDA INDONESIA
     INTELLIGENT FRONTEND APPLICATION
     NEWS + VIDEO
  ========================================================= */

  const state = {
    category: '',
    query: '',
    articles: [],
    videos: [],
    trending: [],
    loading: false,
    page: 0,
    limit: 24,
    hasMore: true,
    autoTimer: null,
    heroId: null,
    currentArticle: null,
    currentVideo: null
  };

  /* =========================================================
     DOM HELPERS
  ========================================================= */

  const $ = (
    selector,
    root = document
  ) => root.querySelector(selector);

  const $$ = (
    selector,
    root = document
  ) => [
    ...root.querySelectorAll(selector)
  ];

  const els = {
    today:
      $('#todayLabel'),

    clock:
      $('#clockLabel'),

    sourceStatus:
      $('#sourceStatus'),

    ticker:
      $('#tickerText'),

    heroImage:
      $('#heroImage'),

    heroCategory:
      $('#heroCategory'),

    heroTitle:
      $('#heroTitle'),

    heroSummary:
      $('#heroSummary'),

    heroDate:
      $('#heroDate'),

    heroViews:
      $('#heroViews'),

    heroOpen:
      $('#heroOpen'),

    compact:
      $('#compactNews'),

    trending:
      $('#trendingList'),

    nav:
      $('#categoryNav'),

    tiles:
      $('#categoryTiles'),

    pills:
      $('#filterPills'),

    section:
      $('#sectionTitle'),

    count:
      $('#feedCount'),

    clear:
      $('#clearFilter'),

    grid:
      $('#articlesGrid'),

    loading:
      $('#loadingState'),

    empty:
      $('#emptyState'),

    emptyTitle:
      $('#emptyTitle'),

    emptyText:
      $('#emptyText'),

    refresh:
      $('#refreshBtn'),

    emptyRefresh:
      $('#emptyRefresh'),

    form:
      $('#searchForm'),

    search:
      $('#searchInput'),

    videoGrid:
      $('#videoGrid'),

    liveUpdates:
      $('#liveUpdates'),

    modal:
      $('#articleModal'),

    modalBody:
      $('#modalBody'),

    toast:
      $('#toastZone'),

    theme:
      $('#themeToggle'),

    videoShortcut:
      $('#videoShortcut'),

    videoNav:
      $('#videoNav'),

    liveTv:
      $('#liveTvBtn'),

    showAllVideos:
      $('#showAllVideos')
  };

  /* =========================================================
     HTML ESCAPE
  ========================================================= */

  const escapeHtml =
    value =>
      String(
        value ??
        ''
      ).replace(
        /[&<>"']/g,
        character =>
          ({
            '&':
              '&amp;',

            '<':
              '&lt;',

            '>':
              '&gt;',

            '"':
              '&quot;',

            "'":
              '&#39;'
          })[
            character
          ]
      );

  /* =========================================================
     STRIP HTML
  ========================================================= */

  const stripHtml =
    value =>
      String(
        value ??
        ''
      )
        .replace(
          /<[^>]+>/g,
          ' '
        )
        .replace(
          /\s+/g,
          ' '
        )
        .trim();

  /* =========================================================
     DATE FORMAT
  ========================================================= */

  const fmtDate =
    value => {

      if (
        !value
      ) {
        return 'Baru diperbarui';
      }

      const date =
        new Date(
          value
        );

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

      if (
        difference <
        60_000
      ) {
        return 'Baru saja';
      }

      if (
        difference <
        3_600_000
      ) {
        return `${
          Math.max(
            1,
            Math.floor(
              difference /
              60_000
            )
          )
        } menit lalu`;
      }

      if (
        difference <
        86_400_000
      ) {
        return `${
          Math.floor(
            difference /
            3_600_000
          )
        } jam lalu`;
      }

      return new Intl.DateTimeFormat(
        'id-ID',
        {
          day:
            '2-digit',

          month:
            'short',

          year:
            'numeric',

          hour:
            '2-digit',

          minute:
            '2-digit'
        }
      ).format(
        date
      );
    };

  /* =========================================================
     DATE SOURCE
  ========================================================= */

  const articleTime =
    item =>
      item?.published_at ||
      item?.created_at ||
      item?.updated_at ||
      null;

  /* =========================================================
     IMAGE URL
  ========================================================= */

  const imageUrl =
    item =>
      item?.image_url ||
      item?.thumbnail_url ||
      item?.image ||
      '';

  /* =========================================================
     CONTENT URL
  ========================================================= */

  const getContentUrl =
    item =>
      item?.url ||
      item?.canonical_url ||
      item?.source_url ||
      '';

  /* =========================================================
     TOAST
  ========================================================= */

  const toast =
    (
      message,
      type = ''
    ) => {

      if (
        !els.toast
      ) {
        return;
      }

      const notification =
        document.createElement(
          'div'
        );

      notification.className =
        `toast ${type}`;

      notification.textContent =
        message;

      els.toast.appendChild(
        notification
      );

      setTimeout(
        () =>
          notification.remove(),

        4000
      );
    };

  /* =========================================================
     FETCH JSON
  ========================================================= */

  async function fetchJson(
    url,
    options = {}
  ) {

    const response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              'application/json',

            ...(
              options.headers ||
              {}
            )
          },

          cache:
            'no-store',

          ...options
        }
      );

    let data =
      null;

    try {
      data =
        await response.json();

    } catch (
      error
    ) {

      data =
        null;
    }

    if (
      !response.ok
    ) {

      const message =
        data?.error ||
        data?.message ||
        `Request gagal (${response.status})`;

      throw new Error(
        message
      );
    }

    return data;
  }

  /* =========================================================
     POST
  ========================================================= */

  async function post(
    url,
    body = null
  ) {

    try {

      const options = {
        method:
          'POST',

        headers: {
          Accept:
            'application/json'
        }
      };

      if (
        body !== null
      ) {

        options.headers[
          'Content-Type'
        ] =
          'application/json';

        options.body =
          JSON.stringify(
            body
          );
      }

      return await fetchJson(
        url,
        options
      );

    } catch (
      error
    ) {

      console.warn(
        '[POST]',
        url,
        error.message
      );

      return null;
    }
  }

  /* =========================================================
     ANALYTICS EVENT
  ========================================================= */

  function trackEvent(
    eventType,
    contentType = null,
    contentId = null
  ) {

    post(
      '/api/events',
      {
        event_type:
          eventType,

        content_type:
          contentType,

        content_id:
          contentId,

        path:
          window.location.pathname
      }
    );
  }

  /* =========================================================
     CLOCK
  ========================================================= */

  function updateClock() {

    const now =
      new Date();

    if (
      els.today
    ) {

      els.today.textContent =
        new Intl.DateTimeFormat(
          'id-ID',
          {
            weekday:
              'long',

            day:
              'numeric',

            month:
              'long',

            year:
              'numeric'
          }
        ).format(
          now
        );
    }

    if (
      els.clock
    ) {

      els.clock.textContent =
        new Intl.DateTimeFormat(
          'id-ID',
          {
            hour:
              '2-digit',

            minute:
              '2-digit',

            second:
              '2-digit',

            hour12:
              false,

            timeZone:
              'Asia/Jakarta'
          }
        ).format(
          now
        ) +
        ' WIB';
    }
  }

  /* =========================================================
     LOADING
  ========================================================= */

  function setLoading(
    active
  ) {

    state.loading =
      active;

    if (
      els.loading
    ) {

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

  /* =========================================================
     CATEGORY
  ========================================================= */

  function activateCategory(
    category
  ) {

    state.category =
      category ||
      '';

    $$(
      '[data-category]'
    ).forEach(
      button => {

        button.classList.toggle(
          'active',

          button.dataset.category ===
          state.category
        );
      }
    );
  }

  /* =========================================================
     ARTICLE IMAGE
  ========================================================= */

  function createArticleImage(
    article
  ) {

    const image =
      imageUrl(
        article
      );

    if (
      image
    ) {

      return `
        <div class="article-thumb">
          <img
            src="${escapeHtml(
              image
            )}"
            alt="${escapeHtml(
              article.title ||
              'Berita'
            )}"
            loading="lazy"
            onerror="
              this.style.display='none';
              this.parentElement.classList.add('no-image');
            "
          >
        </div>
      `;
    }

    return `
      <div class="article-thumb no-image">
        <span>BERITA MUDA</span>
      </div>
    `;
  }

  /* =========================================================
     ARTICLE CARD
  ========================================================= */

  function articleCard(
    article,
    index = 0
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

    const title =
      article.title ||
      'Berita terbaru';

    const summary =
      stripHtml(
        article.summary ||
        article.content ||
        article.content_html ||
        ''
      ) ||
      'Baca informasi lengkap dan perkembangan terbaru.';

    card.innerHTML =
      `
      ${createArticleImage(
        article
      )}

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

          <span class="article-source">
            ${escapeHtml(
              article.source ||
              'Berita Muda Indonesia'
            )}
          </span>

          <div class="article-stats">

            <span>
              👁️ ${
                Number(
                  article.views ||
                  0
                ).toLocaleString(
                  'id-ID'
                )
              }
            </span>

            <span>
              ❤️ ${
                Number(
                  article.likes ||
                  0
                ).toLocaleString(
                  'id-ID'
                )
              }
            </span>

          </div>

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

  /* =========================================================
     HERO
  ========================================================= */

  function renderHero() {

    const article =
      state.articles[
        0
      ];

    state.heroId =
      article?.id ||
      null;

    if (
      !article
    ) {

      if (
        els.heroImage
      ) {

        els.heroImage.style.backgroundImage =
          '';

        els.heroImage.classList.remove(
          'has-image'
        );
      }

      if (
        els.heroCategory
      ) {
        els.heroCategory.textContent =
          'TOP STORY';
      }

      if (
        els.heroTitle
      ) {
        els.heroTitle.textContent =
          'Newsroom siap menerima pembaruan terbaru';
      }

      if (
        els.heroSummary
      ) {
        els.heroSummary.textContent =
          'Berita utama akan tampil otomatis ketika sumber berita aktif.';
      }

      if (
        els.heroDate
      ) {
        els.heroDate.textContent =
          'LIVE DATA';
      }

      if (
        els.heroViews
      ) {
        els.heroViews.textContent =
          'Menunggu sinkronisasi';
      }

      if (
        els.ticker
      ) {
        els.ticker.textContent =
          'Sistem sedang menunggu berita terbaru.';
      }

      return;
    }

    const image =
      imageUrl(
        article
      );

    if (
      els.heroImage
    ) {

      els.heroImage.style.backgroundImage =
        image
          ? `url("${image.replace(
              /"/g,
              '\\"'
            )}")`
          : '';

      els.heroImage.classList.toggle(
        'has-image',
        Boolean(
          image
        )
      );
    }

    if (
      els.heroCategory
    ) {

      els.heroCategory.textContent =
        article.breaking
          ? 'BREAKING NEWS'
          : (
              article.category ||
              'TOP STORY'
            );
    }

    if (
      els.heroTitle
    ) {

      els.heroTitle.textContent =
        article.title ||
        'Berita terbaru';
    }

    if (
      els.heroSummary
    ) {

      els.heroSummary.textContent =
        stripHtml(
          article.summary ||
          article.content ||
          article.content_html ||
          ''
        ) ||
        'Ringkasan berita terbaru dari Berita Muda Indonesia.';
    }

    if (
      els.heroDate
    ) {

      els.heroDate.textContent =
        fmtDate(
          articleTime(
            article
          )
        );
    }

    if (
      els.heroViews
    ) {

      els.heroViews.textContent =
        article.views
          ? `${
              Number(
                article.views
              ).toLocaleString(
                'id-ID'
              )
            } pembaca`
          : 'Update terbaru';
    }

    if (
      els.ticker
    ) {

      els.ticker.textContent =
        article.title ||
        'Berita terbaru';
    }
  }

  /* =========================================================
     COMPACT NEWS
  ========================================================= */

  function renderCompact() {

    if (
      !els.compact
    ) {
      return;
    }

    els.compact.innerHTML =
      '';

    state.articles
      .slice(
        1,
        4
      )
      .forEach(
        article => {

          const button =
            document.createElement(
              'button'
            );

          button.className =
            'compact-card';

          const image =
            imageUrl(
              article
            );

          button.innerHTML =
            `
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
                  'Berita Muda Indonesia'
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
        }
      );
  }

  /* =========================================================
     TRENDING
  ========================================================= */

  async function loadTrending() {

    try {

      const data =
        await fetchJson(
          '/api/trending?limit=10'
        );

      state.trending =
        Array.isArray(
          data
        )
          ? data
          : [];

    } catch (
      error
    ) {

      console.warn(
        '[TRENDING]',
        error.message
      );

      state.trending =
        state.articles
          .slice(
            0,
            10
          );
    }
  }

  function renderTrending() {

    if (
      !els.trending
    ) {
      return;
    }

    els.trending.innerHTML =
      '';

    const items =
      (
        state.trending.length
          ? state.trending
          : state.articles
      )
        .slice(
          0,
          5
        );

    items.forEach(
      (
        article,
        index
      ) => {

        const item =
          document.createElement(
            'li'
          );

        item.innerHTML =
          `
          <span class="trend-number">
            ${
              index +
              1
            }
          </span>

          <button>
            ${escapeHtml(
              article.title ||
              'Berita terbaru'
            )}
          </button>

          <span class="trend-up">
            🔥
          </span>
          `;

        const button =
          $(
            'button',
            item
          );

        button.addEventListener(
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

    if (
      !els.trending.children.length
    ) {

      els.trending.innerHTML =
        `
        <li>
          <button>
            Trending akan muncul setelah berita tersedia
          </button>

          <span class="trend-up">
            ·
          </span>
        </li>
        `;
    }
  }

  /* =========================================================
     RENDER ARTICLES
  ========================================================= */

  function renderArticles() {

    if (
      !els.grid
    ) {
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

    if (
      els.count
    ) {

      els.count.textContent =
        `${
          count
        } berita`;
    }

    if (
      els.clear
    ) {

      els.clear.classList.toggle(
        'hidden',

        !(
          state.category ||
          state.query
        )
      );
    }

    if (
      els.section
    ) {

      if (
        state.query
      ) {

        els.section.textContent =
          `Hasil Pencarian: ${
            state.query
          }`;

      } else if (
        state.category
      ) {

        els.section.textContent =
          `Berita ${
            state.category
          }`;

      } else {

        els.section.textContent =
          'Berita Terbaru';
      }
    }

    if (
      els.empty
    ) {

      els.empty.classList.toggle(
        'hidden',
        count > 0
      );
    }

    if (
      !count &&
      els.emptyTitle &&
      els.emptyText
    ) {

      els.emptyTitle.textContent =
        'Belum ada berita yang tersedia';

      els.emptyText.textContent =
        'Sistem sudah siap. Jalankan sinkronisasi RSS atau periksa sumber berita.';
    }
  }

  /* =========================================================
     LOAD SYSTEM
  ========================================================= */

  async function loadSystem() {

    try {

      const data =
        await fetchJson(
          '/api/system/config'
        );

      if (
        els.sourceStatus
      ) {

        els.sourceStatus.textContent =
          data.supabaseConfigured

            ? 'Sumber data terhubung'

            : 'Mode konfigurasi';
      }

    } catch (
      error
    ) {

      if (
        els.sourceStatus
      ) {

        els.sourceStatus.textContent =
          'Status sumber tidak tersedia';
      }
    }
  }

  /* =========================================================
     LOAD ARTICLES
  ========================================================= */

  async function loadArticles(
    {
      silent = false
    } = {}
  ) {

    if (
      state.loading &&
      !silent
    ) {
      return;
    }

    if (
      !silent
    ) {

      setLoading(
        true
      );
    }

    const params =
      new URLSearchParams();

    params.set(
      'limit',
      String(
        state.limit
      )
    );

    if (
      state.category
    ) {

      params.set(
        'category',
        state.category
      );
    }

    if (
      state.query
    ) {

      params.set(
        'q',
        state.query
      );
    }

    try {

      const data =
        await fetchJson(
          `/api/articles?${
            params.toString()
          }`
        );

      state.articles =
        Array.isArray(
          data
        )
          ? data
          : [];

      renderHero();

      renderCompact();

      renderArticles();

      await loadTrending();

      renderTrending();

      renderLiveUpdates();

      if (
        els.sourceStatus &&
        state.articles.length
      ) {

        els.sourceStatus.textContent =
          'Live data aktif';
      }

    } catch (
      error
    ) {

      console.error(
        '[ARTICLES]',
        error
      );

      state.articles =
        [];

      renderHero();

      renderCompact();

      renderArticles();

      renderTrending();

      if (
        els.sourceStatus
      ) {

        els.sourceStatus.textContent =
          'Koneksi perlu perhatian';
      }

      if (
        els.emptyTitle
      ) {

        els.emptyTitle.textContent =
          'Berita belum berhasil dimuat';
      }

      if (
        els.emptyText
      ) {

        els.emptyText.textContent =
          `API berita bermasalah: ${
            error.message
          }`;
      }

      if (
        !silent
      ) {

        toast(
          'Belum bisa memuat berita. Periksa server.'
        );
      }

    } finally {

      if (
        !silent
      ) {

        setLoading(
          false
        );
      }
    }
  }

  /* =========================================================
     LOAD VIDEOS
  ========================================================= */

  async function loadVideos() {

    try {

      const data =
        await fetchJson(
          '/api/videos?limit=12'
        );

      state.videos =
        Array.isArray(
          data
        )
          ? data
          : [];

    } catch (
      error
    ) {

      console.warn(
        '[VIDEOS]',
        error.message
      );

      state.videos =
        [];
    }

    renderVideos();
  }

  /* =========================================================
     VIDEO CARD
  ========================================================= */

  function createVideoCard(
    video
  ) {

    const card =
      document.createElement(
        'article'
      );

    card.className =
      'video-card';

    const image =
      imageUrl(
        video
      );

    const duration =
      video.duration ||
      video.duration_text ||
      '';

    const source =
      video.source ||
      video.channel ||
      'Berita Muda Indonesia';

    card.innerHTML =
      `
      <div class="video-thumb">

        ${
          image

            ? `
              <img
                src="${escapeHtml(
                  image
                )}"
                alt="${escapeHtml(
                  video.title ||
                  'Video'
                )}"
                loading="lazy"
              >
              `

            : `
              <div class="video-placeholder">
                VIDEO
              </div>
              `
        }

        <div class="video-play">
          ▶
        </div>

        ${
          duration

            ? `
              <span class="video-duration">
                ${escapeHtml(
                  duration
                )}
              </span>
              `

            : ''
        }

      </div>

      <div class="video-info">

        <span class="video-category">
          ${escapeHtml(
            video.category ||
            'VIDEO'
          )}
        </span>

        <h4>
          ${escapeHtml(
            video.title ||
            'Video terbaru'
          )}
        </h4>

        <p>
          ${escapeHtml(
            source
          )}
        </p>

        <div class="video-meta">

          <span>
            👁️ ${
              Number(
                video.views ||
                0
              ).toLocaleString(
                'id-ID'
              )
            }
          </span>

          <span>
            ❤️ ${
              Number(
                video.likes ||
                0
              ).toLocaleString(
                'id-ID'
              )
            }
          </span>

        </div>

      </div>
      `;

    card.addEventListener(
      'click',

      () =>
        openVideo(
          video
        )
    );

    return card;
  }

  /* =========================================================
     RENDER VIDEOS
  ========================================================= */

  function renderVideos() {

    if (
      !els.videoGrid
    ) {
      return;
    }

    els.videoGrid.innerHTML =
      '';

    state.videos.forEach(
      video =>
        els.videoGrid.appendChild(
          createVideoCard(
            video
          )
        )
    );

    if (
      !state.videos.length
    ) {

      els.videoGrid.innerHTML =
        `
        <div class="video-empty">

          <strong>
            Belum ada video terbaru
          </strong>

          <p>
            Video akan muncul otomatis setelah
            sumber video tersinkronisasi.
          </p>

        </div>
        `;
    }
  }

  /* =========================================================
     LIVE UPDATES
  ========================================================= */

  function renderLiveUpdates() {

    if (
      !els.liveUpdates
    ) {
      return;
    }

    const now =
      new Date();

    const items =
      state.articles.slice(
        0,
        5
      );

    els.liveUpdates.innerHTML =
      '';

    const data =
      items.length

        ? items

        : [
            {
              title:
                'Sistem sedang memantau pembaruan sumber berita.'
            },

            {
              title:
                'Data live akan masuk otomatis setelah sinkronisasi aktif.'
            }
          ];

    data.forEach(
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
          articleTime(
            article
          )

            ? new Date(
                articleTime(
                  article
                )
              )

            : new Date(
                now.getTime() -
                index *
                7 *
                60_000
              );

        row.innerHTML =
          `
          <time>
            ${
              new Intl.DateTimeFormat(
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
              ).format(
                time
              )
            }
          </time>

          <p>
            ${escapeHtml(
              article.title
            )}
          </p>
          `;

        if (
          article.id
        ) {

          row.addEventListener(
            'click',

            () =>
              openArticle(
                article.id,
                article
              )
          );
        }

        els.liveUpdates.appendChild(
          row
        );
      }
    );
  }

  /* =========================================================
     ARTICLE CONTENT
  ========================================================= */

  function renderArticleContent(
    article
  ) {

    if (
      article.content_html &&
      String(
        article.content_html
      ).trim()
    ) {

      return String(
        article.content_html
      )
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          ''
        );
    }

    if (
      article.content &&
      String(
        article.content
      ).trim()
    ) {

      return String(
        article.content
      )
        .split(
          /\n\s*\n/
        )
        .map(
          paragraph =>
            paragraph.trim()
        )
        .filter(
          Boolean
        )
        .map(
          paragraph =>
            `
            <p>
              ${escapeHtml(
                paragraph
              )}
            </p>
            `
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
            stripHtml(
              article.summary
            )
          )}
        </p>
        `;
    }

    return `
      <p>
        Isi artikel belum tersedia.
      </p>
      `;
  }

  /* =========================================================
     SOURCE URL
  ========================================================= */

  function getSourceUrl(
    article
  ) {

    const candidate =
      article.source_url ||
      article.canonical_url ||
      article.url ||
      '';

    if (
      !candidate
    ) {
      return '';
    }

    try {

      const url =
        new URL(
          candidate,
          window.location.origin
        );

      if (
        url.origin ===
        window.location.origin
      ) {
        return '';
      }

      return url.href;

    } catch (
      error
    ) {

      return '';
    }
  }

  /* =========================================================
     ARTICLE ACTIONS
  ========================================================= */

  function articleActions(
    article
  ) {

    return `
      <div class="detail-actions">

        <button
          class="detail-action like-btn"
          data-like-article="${escapeHtml(
            article.id
          )}"
        >
          ❤️
          Suka
        </button>

        <button
          class="detail-action share-btn"
          data-share-article="${escapeHtml(
            article.id
          )}"
        >
          🔗
          Bagikan
        </button>

        <button
          class="detail-action copy-btn"
          data-copy-article="${escapeHtml(
            article.id
          )}"
        >
          📋
          Salin Link
        </button>

      </div>
    `;
  }

  /* =========================================================
     BIND ARTICLE ACTIONS
  ========================================================= */

  function bindArticleActions(
    article
  ) {

    const likeButton =
      $(
        `[data-like-article="${CSS.escape(
          String(
            article.id
          )
        )}"]`
      );

    if (
      likeButton
    ) {

      likeButton.addEventListener(
        'click',

        async () => {

          await post(
            `/api/articles/${
              encodeURIComponent(
                article.id
              )
            }/like`
          );

          likeButton.classList.add(
            'active'
          );

          likeButton.textContent =
            '❤️ Disukai';

          trackEvent(
            'like',
            'article',
            article.id
          );
        }
      );
    }

    const shareButton =
      $(
        `[data-share-article="${CSS.escape(
          String(
            article.id
          )
        )}"]`
      );

    if (
      shareButton
    ) {

      shareButton.addEventListener(
        'click',

        async () => {

          const url =
            `${
              window.location.origin
            }/berita/${
              encodeURIComponent(
                article.id
              )
            }`;

          if (
            navigator.share
          ) {

            try {

              await navigator.share(
                {
                  title:
                    article.title,

                  text:
                    article.summary ||
                    article.title,

                  url
                }
              );

            } catch (
              error
            ) {

              if (
                error?.name !==
                'AbortError'
              ) {

                console.warn(
                  error
                );
              }
            }

          } else {

            try {

              await navigator.clipboard.writeText(
                url
              );

              toast(
                'Link berhasil disalin',
                'success'
              );

            } catch (
              error
            ) {

              window.prompt(
                'Salin link:',
                url
              );
            }
          }

          await post(
            `/api/articles/${
              encodeURIComponent(
                article.id
              )
            }/share`
          );

          trackEvent(
            'share',
            'article',
            article.id
          );
        }
      );
    }

    const copyButton =
      $(
        `[data-copy-article="${CSS.escape(
          String(
            article.id
          )
        )}"]`
      );

    if (
      copyButton
    ) {

      copyButton.addEventListener(
        'click',

        async () => {

          const url =
            `${
              window.location.origin
            }/berita/${
              encodeURIComponent(
                article.id
              )
            }`;

          try {

            await navigator.clipboard.writeText(
              url
            );

            toast(
              'Link berhasil disalin',
              'success'
            );

          } catch (
            error
          ) {

            window.prompt(
              'Salin link:',
              url
            );
          }
        }
      );
    }
  }

  /* =========================================================
     OPEN ARTICLE
  ========================================================= */

  async function openArticle(
    id,
    fallback = null
  ) {

    if (
      !els.modal ||
      !els.modalBody
    ) {
      return;
    }

    els.modal.classList.remove(
      'hidden'
    );

    document.body.style.overflow =
      'hidden';

    els.modalBody.innerHTML =
      `
      <div class="modal-content">

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

    try {

      if (
        id
      ) {

        article =
          await fetchJson(
            `/api/articles/${
              encodeURIComponent(
                id
              )
            }`
          );
      }

    } catch (
      error
    ) {

      console.warn(
        '[ARTICLE DETAIL]',
        error.message
      );
    }

    if (
      !article
    ) {

      els.modalBody.innerHTML =
        `
        <div class="modal-content">

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

    state.currentArticle =
      article;

    document.title =
      `${
        article.title ||
        'Berita'
      } | Berita Muda Indonesia`;

    const image =
      imageUrl(
        article
      );

    const body =
      renderArticleContent(
        article
      );

    const sourceUrl =
      getSourceUrl(
        article
      );

    els.modalBody.innerHTML =
      `
      ${
        image

          ? `
            <img
              class="modal-hero"
              src="${escapeHtml(
                image
              )}"
              alt="${escapeHtml(
                article.title ||
                'Berita'
              )}"
            >
            `

          : ''
      }

      <div class="modal-content">

        <div class="detail-category-row">

          <span class="eyebrow">
            ${escapeHtml(
              article.category ||
              'BERITA'
            )}
          </span>

          ${
            article.breaking

              ? `
                <span class="breaking-mini">
                  BREAKING
                </span>
                `

              : ''
          }

        </div>

        <h2>
          ${escapeHtml(
            article.title ||
            'Berita terbaru'
          )}
        </h2>

        <div class="detail-meta">

          <span>
            ${
              escapeHtml(
                article.author_name ||
                article.source ||
                'Berita Muda Indonesia'
              )
            }
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

          ${
            article.reading_minutes

              ? `
                <span>
                  ${
                    escapeHtml(
                      article.reading_minutes
                    )
                  }
                  menit baca
                </span>
                `

              : ''
          }

        </div>

        ${
          article.summary

            ? `
              <p class="summary">
                ${escapeHtml(
                  stripHtml(
                    article.summary
                  )
                )}
              </p>
              `

            : ''
        }

        ${articleActions(
          article
        )}

        <div class="article-html">

          ${body}

        </div>

        ${
          sourceUrl

            ? `
              <div class="source-box">

                <small>
                  SUMBER BERITA
                </small>

                <a
                  href="${escapeHtml(
                    sourceUrl
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHtml(
                    article.source ||
                    'Baca sumber asli'
                  )}
                  ↗
                </a>

              </div>
              `

            : ''
        }

      </div>
      `;

    bindArticleActions(
      article
    );

    post(
      `/api/articles/${
        encodeURIComponent(
          article.id
        )
      }/view`
    );

    trackEvent(
      'view',
      'article',
      article.id
    );

    updateUrl(
      'article',
      article.id
    );
  }

  /* =========================================================
     VIDEO URL
  ========================================================= */

  function getVideoUrl(
    video
  ) {

    return (
      video.video_url ||
      video.embed_url ||
      video.url ||
      video.youtube_url ||
      ''
    );
  }

  /* =========================================================
     VIDEO EMBED
  ========================================================= */

  function createVideoPlayer(
    video
  ) {

    const source =
      getVideoUrl(
        video
      );

    const image =
      imageUrl(
        video
      );

    if (
      !source
    ) {

      return image

        ? `
          <img
            class="modal-hero"
            src="${escapeHtml(
              image
            )}"
            alt="${escapeHtml(
              video.title ||
              'Video'
            )}"
          >
          `

        : `
          <div class="video-player-empty">
            VIDEO
          </div>
          `;
    }

    const lower =
      source.toLowerCase();

    if (
      lower.includes(
        'youtube.com'
      ) ||
      lower.includes(
        'youtu.be'
      )
    ) {

      let videoId =
        '';

      try {

        const url =
          new URL(
            source
          );

        if (
          url.hostname.includes(
            'youtu.be'
          )
        ) {

          videoId =
            url.pathname
              .split(
                '/'
              )
              .filter(
                Boolean
              )[0];

        } else {

          videoId =
            url.searchParams.get(
              'v'
            ) ||
            '';
        }

      } catch (
        error
      ) {

        videoId =
          '';
      }

      if (
        videoId
      ) {

        return `
          <div class="video-player">

            <iframe
              src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(
                videoId
              )}"
              title="${escapeHtml(
                video.title ||
                'Video'
              )}"
              allow="
                accelerometer;
                autoplay;
                clipboard-write;
                encrypted-media;
                gyroscope;
                picture-in-picture
              "
              allowfullscreen
            ></iframe>

          </div>
          `;
      }
    }

    if (
      /\.(mp4|webm|ogg)(\?|$)/i
        .test(
          source
        )
    ) {

      return `
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
        `;
    }

    return `
      <div class="video-player">

        <iframe
          src="${escapeHtml(
            source
          )}"
          title="${escapeHtml(
            video.title ||
            'Video'
          )}"
          allowfullscreen
        ></iframe>

      </div>
      `;
  }

  /* =========================================================
     OPEN VIDEO
  ========================================================= */

  async function openVideo(
    video
  ) {

    if (
      !video
    ) {
      return;
    }

    if (
      !els.modal ||
      !els.modalBody
    ) {
      return;
    }

    state.currentVideo =
      video;

    els.modal.classList.remove(
      'hidden'
    );

    document.body.style.overflow =
      'hidden';

    const player =
      createVideoPlayer(
        video
      );

    els.modalBody.innerHTML =
      `
      <div class="modal-content video-detail">

        <span class="eyebrow">
          ${escapeHtml(
            video.category ||
            'VIDEO'
          )}
        </span>

        <h2>
          ${escapeHtml(
            video.title ||
            'Video terbaru'
          )}
        </h2>

        <div class="detail-meta">

          <span>
            ${escapeHtml(
              video.source ||
              video.channel ||
              'Berita Muda Indonesia'
            )}
          </span>

          <span>
            ${escapeHtml(
              fmtDate(
                articleTime(
                  video
                )
              )
            )}
          </span>

        </div>

        <div class="video-player-wrap">

          ${player}

        </div>

        ${
          video.description ||
          video.summary

            ? `
              <p class="summary">
                ${escapeHtml(
                  stripHtml(
                    video.description ||
                    video.summary
                  )
                )}
              </p>
              `

            : ''
        }

        <div class="detail-actions">

          <button
            class="detail-action"
            id="videoLikeBtn"
          >
            ❤️ Suka
          </button>

          <button
            class="detail-action"
            id="videoShareBtn"
          >
            🔗 Bagikan
          </button>

        </div>

      </div>
      `;

    bindVideoActions(
      video
    );

    if (
      video.id
    ) {

      post(
        `/api/videos/${
          encodeURIComponent(
            video.id
          )
        }/view`
      );

      trackEvent(
        'view',
        'video',
        video.id
      );
    }

    updateUrl(
      'video',
      video.id
    );
  }

  /* =========================================================
     VIDEO ACTIONS
  ========================================================= */

  function bindVideoActions(
    video
  ) {

    const likeButton =
      $('#videoLikeBtn');

    const shareButton =
      $('#videoShareBtn');

    if (
      likeButton &&
      video.id
    ) {

      likeButton.addEventListener(
        'click',

        async () => {

          await post(
            `/api/videos/${
              encodeURIComponent(
                video.id
              )
            }/like`
          );

          likeButton.textContent =
            '❤️ Disukai';

          likeButton.classList.add(
            'active'
          );
        }
      );
    }

    if (
      shareButton &&
      video.id
    ) {

      shareButton.addEventListener(
        'click',

        async () => {

          const url =
            `${
              window.location.origin
            }/video/${
              encodeURIComponent(
                video.id
              )
            }`;

          if (
            navigator.share
          ) {

            try {

              await navigator.share(
                {
                  title:
                    video.title,

                  text:
                    video.description ||
                    video.title,

                  url
                }
              );

            } catch (
              error
            ) {

              if (
                error?.name !==
                'AbortError'
              ) {

                console.warn(
                  error
                );
              }
            }

          } else {

            try {

              await navigator.clipboard.writeText(
                url
              );

              toast(
                'Link video disalin',
                'success'
              );

            } catch (
              error
            ) {

              window.prompt(
                'Salin link video:',
                url
              );
            }
          }

          await post(
            `/api/videos/${
              encodeURIComponent(
                video.id
              )
            }/share`
          );

          trackEvent(
            'share',
            'video',
            video.id
          );
        }
      );
    }
  }

  /* =========================================================
     CLOSE MODAL
  ========================================================= */

  function closeModal() {

    if (
      els.modal
    ) {

      els.modal.classList.add(
        'hidden'
      );
    }

    document.body.style.overflow =
      '';

    state.currentArticle =
      null;

    state.currentVideo =
      null;

    const url =
      new URL(
        window.location.href
      );

    url.searchParams.delete(
      'article'
    );

    url.searchParams.delete(
      'video'
    );

    window.history.replaceState(
      {},
      '',
      url.pathname +
      (
        url.search
          ? url.search
          : ''
      )
    );
  }

  /* =========================================================
     URL
  ========================================================= */

  function updateUrl(
    type,
    id
  ) {

    if (
      !id
    ) {
      return;
    }

    const url =
      new URL(
        window.location.href
      );

    url.searchParams.delete(
      type === 'article'
        ? 'video'
        : 'article'
    );

    url.searchParams.set(
      type,
      id
    );

    window.history.replaceState(
      {},
      '',
      url.pathname +
      url.search
    );
  }

  /* =========================================================
     VIDEO SCROLL
  ========================================================= */

  function scrollToVideo() {

    const panel =
      $('#videoPanel');

    if (
      panel
    ) {

      panel.scrollIntoView(
        {
          behavior:
            'smooth',

          block:
            'start'
        }
      );
    }
  }

  /* =========================================================
     OPEN DETAIL FROM URL
  ========================================================= */

  async function openFromUrl() {

    const path =
      window.location.pathname;

    const params =
      new URLSearchParams(
        window.location.search
      );

    let articleId =
      params.get(
        'article'
      );

    let videoId =
      params.get(
        'video'
      );

    if (
      path.startsWith(
        '/berita/'
      )
    ) {

      articleId =
        decodeURIComponent(
          path.split(
            '/'
          ).pop()
        );
    }

    if (
      path.startsWith(
        '/video/'
      )
    ) {

      videoId =
        decodeURIComponent(
          path.split(
            '/'
          ).pop()
        );
    }

    if (
      articleId
    ) {

      await openArticle(
        articleId
      );

      return;
    }

    if (
      videoId
    ) {

      let video =
        state.videos.find(
          item =>
            String(
              item.id
            ) ===
            String(
              videoId
            )
        );

      if (
        !video
      ) {

        try {

          video =
            await fetchJson(
              `/api/videos/${
                encodeURIComponent(
                  videoId
                )
              }`
            );

        } catch (
          error
        ) {

          console.warn(
            error
          );
        }
      }

      if (
        video
      ) {

        openVideo(
          video
        );
      }
    }
  }

  /* =========================================================
     EVENT LISTENERS
  ========================================================= */

  if (
    els.heroOpen
  ) {

    els.heroOpen.addEventListener(
      'click',

      () => {

        if (
          state.heroId
        ) {

          openArticle(
            state.heroId,
            state.articles[0]
          );
        }
      }
    );
  }

  if (
    els.refresh
  ) {

    els.refresh.addEventListener(
      'click',

      async () => {

       await Promise.all([
    loadArticles(),
    loadVideos(),
]);

        toast(
          'Pembaruan selesai',
          'success'
        );
      }
    );
  }

  if (
    els.emptyRefresh
  ) {

    els.emptyRefresh.addEventListener(
      'click',

      () =>
        loadArticles()
    );
  }

  if (
    els.form
  ) {

    els.form.addEventListener(
      'submit',

      event => {

        event.preventDefault();

        state.query =
          els.search?.value
            .trim() ||
          '';

        state.category =
          '';

        activateCategory(
          ''
        );

        loadArticles();
      }
    );
  }

  if (
    els.nav
  ) {

    els.nav.addEventListener(
      'click',

      event => {

        const button =
          event.target.closest(
            '[data-category]'
          );

        if (
          !button
        ) {
          return;
        }

        state.query =
          '';

        if (
          els.search
        ) {

          els.search.value =
            '';
        }

        activateCategory(
          button.dataset.category
        );

        loadArticles();
      }
    );
  }

  if (
    els.tiles
  ) {

    els.tiles.addEventListener(
      'click',

      event => {

        const button =
          event.target.closest(
            '[data-category]'
          );

        if (
          !button
        ) {
          return;
        }

        state.query =
          '';

        if (
          els.search
        ) {

          els.search.value =
            '';
        }

        activateCategory(
          button.dataset.category
        );

        loadArticles();

        const section =
          $('#sectionTitle');

        if (
          section
        ) {

          window.scrollTo(
            {
              top:
                section
                  .getBoundingClientRect()
                  .top +
                window.scrollY -
                100,

              behavior:
                'smooth'
            }
          );
        }
      }
    );
  }

  if (
    els.pills
  ) {

    els.pills.addEventListener(
      'click',

      event => {

        const button =
          event.target.closest(
            '[data-category]'
          );

        if (
          !button
        ) {
          return;
        }

        state.query =
          '';

        if (
          els.search
        ) {

          els.search.value =
            '';
        }

        activateCategory(
          button.dataset.category
        );

        loadArticles();
      }
    );
  }

  if (
    els.clear
  ) {

    els.clear.addEventListener(
      'click',

      () => {

        state.query =
          '';

        state.category =
          '';

        if (
          els.search
        ) {

          els.search.value =
            '';
        }

        activateCategory(
          ''
        );

        loadArticles();
      }
    );
  }

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

  if (
    els.theme
  ) {

    els.theme.addEventListener(
      'click',

      () => {

        const next =
          document.documentElement.dataset.theme ===
          'light'

            ? 'dark'

            : 'light';

        document.documentElement.dataset.theme =
          next;

        localStorage.setItem(
          'bmi-theme',
          next
        );
      }
    );
  }

  const savedTheme =
    localStorage.getItem(
      'bmi-theme'
    );

  if (
    savedTheme
  ) {

    document.documentElement.dataset.theme =
      savedTheme;
  }

  [
    els.videoShortcut,
    els.videoNav,
    els.liveTv,
    els.showAllVideos
  ]
    .filter(
      Boolean
    )
    .forEach(
      button =>
        button.addEventListener(
          'click',
          scrollToVideo
        )
    );

  const refreshLive =
    $('#refreshLive');

  if (
    refreshLive
  ) {

    refreshLive.addEventListener(
      'click',

      () => {

        renderLiveUpdates();

        toast(
          'Live update diperbarui',
          'success'
        );
      }
    );
  }

  const advertiseButton =
    $('#advertiseBtn');

  if (
    advertiseButton
  ) {

    advertiseButton.addEventListener(
      'click',

      () => {

        toast(
          'Modul iklan siap dihubungkan ke sistem kampanye.'
        );
      }
    );
  }

  const exploreButton =
    $('#exploreBtn');

  if (
    exploreButton
  ) {

    exploreButton.addEventListener(
      'click',

      () => {

        const section =
          $('#sectionTitle');

        if (
          section
        ) {

          section.scrollIntoView(
            {
              behavior:
                'smooth'
            }
          );
        }
      }
    );
  }

  const openTrending =
    $('#openTrending');

  if (
    openTrending
  ) {

    openTrending.addEventListener(
      'click',

      () => {

        state.query =
          '';

        state.category =
          '';

        activateCategory(
          ''
        );

        loadArticles();
      }
    );
  }

  const loginButton =
    $('#loginBtn');

  if (
    loginButton
  ) {

    loginButton.addEventListener(
      'click',

      () =>
        toast(
          'Login dapat diaktifkan melalui Supabase Auth.'
        )
    );
  }

  const joinButton =
    $('#joinBtn');

  if (
    joinButton
  ) {

    joinButton.addEventListener(
      'click',

      () =>
        toast(
          'Registrasi dapat diaktifkan melalui Supabase Auth.'
        )
    );
  }

  const notificationButton =
    $('#notificationBtn');

  if (
    notificationButton
  ) {

    notificationButton.addEventListener(
      'click',

      () => {

        toast(
          state.articles.length

            ? 'Ada pembaruan terbaru di feed berita.'

            : 'Belum ada notifikasi baru.'
        );
      }
    );
  }

  const newsletterForm =
    $('#newsletterForm');

  if (
    newsletterForm
  ) {

    newsletterForm.addEventListener(
      'submit',

      async event => {

        event.preventDefault();

        const input =
          $(
            'input[type="email"]',
            newsletterForm
          );

        const email =
          input?.value
            .trim();

        if (
          !email
        ) {
          return;
        }

        const result =
          await post(
            '/api/newsletter/subscribe',
            {
              email
            }
          );

        if (
          result
        ) {

          newsletterForm.reset();

          toast(
            'Terima kasih. Anda berhasil berlangganan.',
            'success'
          );

        } else {

          toast(
            'Newsletter belum dapat diproses saat ini.'
          );
        }
      }
    );
  }

  /* =========================================================
     INITIALIZE
  ========================================================= */

  async function initialize() {

    updateClock();

    setInterval(
      updateClock,
      1000
    );

    const year =
      $('#year');

    if (
      year
    ) {

      year.textContent =
        new Date()
          .getFullYear();
    }

    await Promise.all([
      loadSystem(),
      loadArticles(),
      loadVideos()
    ]);

    renderLiveUpdates();

    await openFromUrl();

    state.autoTimer =
      setInterval(
        async () => {

          await Promise.all([
            loadArticles(
              {
                silent:
                  true
              }
            ),

            loadVideos()
          ]);

        },

        60_000
      );
  }

  initialize();

})();
