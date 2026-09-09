import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncFeeds } from './sync.js';
import { supabase, isSupabaseConfigured, supabaseConfigMessage } from './supabase.js';

/* =========================================================
   PATH CONFIGURATION
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.resolve(__dirname, '../public');

/* =========================================================
   ENVIRONMENT VALIDATION
========================================================= */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missingEnvironmentVariables = [
  !supabaseUrl && 'SUPABASE_URL',
  !supabaseAnonKey && 'SUPABASE_ANON_KEY',
  !supabaseServiceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'
].filter(Boolean);

if (missingEnvironmentVariables.length > 0) {
  console.warn(`Berita Muda Indonesia starting without live Supabase configuration: ${missingEnvironmentVariables.join(', ')}`);
}

/* =========================================================
   SUPABASE CLIENTS
========================================================= */

const unavailableAuthClient = {
  auth: {
    async getUser() { return { data: { user: null }, error: new Error(supabaseConfigMessage || 'Supabase belum dikonfigurasi') }; },
    async signInWithPassword() { return { data: null, error: new Error(supabaseConfigMessage || 'Supabase belum dikonfigurasi') }; }
  }
};

const authClient = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : unavailableAuthClient;

const adminClient = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
  : null;

/* =========================================================
   EXPRESS APP
========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 3000);

const origin =
  process.env.CORS_ORIGIN || '*';

const baseUrl =
  (
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${PORT}`
  ).replace(/\/$/, '');

/* =========================================================
   SECURITY + MIDDLEWARE
========================================================= */

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin:
      origin === '*'
        ? true
        : origin
            .split(',')
            .map(value => value.trim()),
    credentials: false
  })
);

app.use(
  express.json({
    limit: '4mb'
  })
);

app.use(
  morgan('tiny')
);

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false
  })
);

/* =========================================================
   RATE LIMITERS
========================================================= */

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false
});

const commentLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false
});

const interactionLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false
});

/* =========================================================
   HELPERS
========================================================= */

const cleanLimit = (
  value,
  max,
  fallback
) => {
  const parsed = Number(value);

  const safeValue =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : fallback;

  return Math.min(
    Math.max(safeValue, 1),
    max
  );
};

const cleanText = (
  value,
  max = 500
) => {
  return String(value ?? '')
    .trim()
    .slice(0, max);
};

const esc = value => {
  return String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]
  );
};

const safeQuery = value => {
  return String(value || '')
    .replace(/[,%()]/g, ' ')
    .trim()
    .slice(0, 80);
};

const safeHtml = value => {
  return String(value || '')
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
    .replace(
      /javascript:/gi,
      ''
    );
};

/* =========================================================
   AUTH HELPERS
========================================================= */

const getAuthenticatedUser = async request => {
  const authorization =
    request.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  const token =
    authorization.slice(7);

  const {
    data: { user },
    error
  } =
    await adminClient.auth.getUser(token);

  if (error) {
    return null;
  }

  return user || null;
};

/* =========================================================
   USER AUTH MIDDLEWARE
========================================================= */

const requireUser =
  async (
    request,
    response,
    next
  ) => {
    try {
      const user =
        await getAuthenticatedUser(
          request
        );

      if (!user) {
        return response
          .status(401)
          .json({
            error:
              'Login Google diperlukan'
          });
      }

      request.user = user;

      next();

    } catch (error) {
      response
        .status(401)
        .json({
          error:
            'Sesi login tidak valid'
        });
    }
  };

/* =========================================================
   ADMIN MIDDLEWARE
   IMPORTANT:
   DECLARED BEFORE ADMIN ROUTES
========================================================= */

const admin =
  async (
    request,
    response,
    next
  ) => {
    try {
      const user =
        await getAuthenticatedUser(
          request
        );

      if (!user) {
        return response
          .status(401)
          .json({
            error:
              'Unauthorized'
          });
      }

      const {
        data: profile,
        error: profileError
      } =
        await adminClient
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

      if (
        profileError ||
        !profile ||
        !['admin', 'editor']
          .includes(profile.role)
      ) {
        return response
          .status(403)
          .json({
            error:
              'Forbidden'
          });
      }

      request.user = user;
      request.role = profile.role;

      next();

    } catch (error) {
      response
        .status(401)
        .json({
          error:
            'Session tidak valid'
        });
    }
  };

/* =========================================================
   ANALYTICS
========================================================= */

const trackEvent =
  async ({
    event_type,
    content_type = null,
    content_id = null,
    path = null,
    referrer = null,
    session_id = null
  }) => {
    try {
      await adminClient
        .from('analytics_events')
        .insert({
          event_type,
          content_type,
          content_id,
          path,
          referrer,
          session_id
        });
    } catch (_) {
      /* Analytics must never break the main application */
    }
  };

/* =========================================================
   DETAIL SEO SHELL
========================================================= */

const detailShell = ({
  kind,
  item
}) => {
  const title =
    esc(
      item.title ||
      'Berita Muda Indonesia'
    );

  const description =
    esc(
      (
        item.summary ||
        item.description ||
        'Berita terkini Berita Muda Indonesia'
      ).slice(0, 200)
    );

  const image =
    esc(
      item.image_url ||
      item.thumbnail_url ||
      `${baseUrl}/assets/logo-berita-muda.png`
    );

  const detailPath =
    kind === 'article'
      ? `/berita/${item.id}`
      : `/video/${item.id}`;

  const url =
    `${baseUrl}${detailPath}`;

  const openGraphType =
    kind === 'article'
      ? 'article'
      : 'video.other';

  const jsonLd =
    JSON.stringify({
      '@context':
        'https://schema.org',

      '@type':
        kind === 'article'
          ? 'NewsArticle'
          : 'VideoObject',

      headline:
        item.title,

      description:
        item.summary ||
        item.description ||
        '',

      image: [
        item.image_url ||
        item.thumbnail_url ||
        `${baseUrl}/assets/logo-berita-muda.png`
      ],

      url,

      datePublished:
        item.published_at ||
        item.created_at,

      dateModified:
        item.updated_at ||
        item.published_at ||
        item.created_at,

      author: {
        '@type':
          'Person',

        name:
          item.author_name ||
          item.source ||
          'Berita Muda Indonesia'
      },

      publisher: {
        '@type':
          'Organization',

        name:
          'Berita Muda Indonesia',

        url:
          baseUrl
      }
    })
      .replace(
        /</g,
        '\\u003c'
      );

  const queryKey =
    kind === 'article'
      ? 'article'
      : 'video';

  return `<!doctype html>
<html lang="id">

<head>

<meta charset="utf-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>
${title} | Berita Muda Indonesia
</title>

<meta
name="description"
content="${description}"
>

<link
rel="canonical"
href="${esc(url)}"
>

<meta
property="og:type"
content="${openGraphType}"
>

<meta
property="og:title"
content="${title}"
>

<meta
property="og:description"
content="${description}"
>

<meta
property="og:image"
content="${image}"
>

<meta
property="og:url"
content="${esc(url)}"
>

<meta
property="og:site_name"
content="Berita Muda Indonesia"
>

<meta
name="twitter:card"
content="summary_large_image"
>

<meta
name="twitter:title"
content="${title}"
>

<meta
name="twitter:description"
content="${description}"
>

<meta
name="twitter:image"
content="${image}"
>

<script type="application/ld+json">
${jsonLd}
</script>

<link
rel="stylesheet"
href="/styles.css"
>

</head>

<body>

<header class="site-header">

<div class="topbar">

<span>
BERITA MUDA INDONESIA
</span>

<span>
Informasi Cepat • Akurat • Aktual • Faktual
</span>

</div>

</header>

<main class="shell">

<div class="loading-card">

<div class="pulse"></div>

<p>
Memuat ${kind === 'article'
  ? 'berita'
  : 'video'}…
</p>

<a href="/">
Kembali ke Beranda
</a>

</div>

</main>

<script>

location.replace(
  '/?${queryKey}=${encodeURIComponent(item.id)}'
);

</script>

</body>

</html>`;
};

/* =========================================================
   DETAIL SEO ROUTES
========================================================= */

app.get(
  '/berita/:id',

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await supabase
        .from('articles')
        .select('*')
        .eq(
          'id',
          request.params.id
        )
        .eq(
          'status',
          'published'
        )
        .single();

    if (error || !data) {
      return response
        .status(404)
        .send(
          'Berita tidak ditemukan'
        );
    }

    response.send(
      detailShell({
        kind:
          'article',

        item:
          data
      })
    );
  }
);

app.get(
  '/video/:id',

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await supabase
        .from('videos')
        .select('*')
        .eq(
          'id',
          request.params.id
        )
        .eq(
          'status',
          'published'
        )
        .single();

    if (error || !data) {
      return response
        .status(404)
        .send(
          'Video tidak ditemukan'
        );
    }

    response.send(
      detailShell({
        kind:
          'video',

        item:
          data
      })
    );
  }
);

/* =========================================================
   STATIC INFORMATION PAGES
========================================================= */

const staticPages = {
  '/tentang-kami':
    'about.html',

  '/kontak':
    'contact.html',

  '/kebijakan-privasi':
    'privacy.html',

  '/syarat-ketentuan':
    'terms.html',

  '/pedoman-redaksi':
    'editorial.html',

  '/disclaimer':
    'disclaimer.html'
};

for (
  const [
    route,
    file
  ] of Object.entries(
    staticPages
  )
) {
  app.get(
    route,

    (
      request,
      response
    ) => {
      response.sendFile(
        file,
        {
          root:
            publicDir
        }
      );
    }
  );
}

/* =========================================================
   ANALYTICS API
========================================================= */

app.post(
  '/api/analytics/event',

  async (
    request,
    response
  ) => {
    const allowedEvents = [
      'pageview',
      'view',
      'like',
      'share',
      'video_play',
      'ad_impression',
      'ad_click',
      'article_read',
      'scroll_25',
      'scroll_50',
      'scroll_75',
      'scroll_100',
      'video_25',
      'video_50',
      'video_75',
      'video_complete',
      'affiliate_click'
    ];

    const body =
      request.body || {};

    if (
      !allowedEvents.includes(
        body.event_type
      )
    ) {
      return response
        .status(400)
        .json({
          error:
            'event_type tidak valid'
        });
    }

    await trackEvent({
      event_type:
        body.event_type,

      content_type:
        body.content_type,

      content_id:
        body.content_id,

      path:
        cleanText(
          body.path,
          300
        ),

      referrer:
        cleanText(
          body.referrer,
          500
        ),

      session_id:
        cleanText(
          body.session_id,
          100
        )
    });

    response
      .status(204)
      .end();
  }
);

/* =========================================================
   PUBLIC ARTICLES
========================================================= */

app.get(
  '/api/articles',

  async (
    request,
    response
  ) => {
    if (!isSupabaseConfigured) {
      return response
        .set('X-BMI-Data-Mode', 'configuration-required')
        .json([]);
    }

    try {
      const pageLimit =
        cleanLimit(
          request.query.limit,
          100,
          24
        );

      const pageOffset =
        Math.max(
          Number(
            request.query.offset
          ) || 0,
          0
        );

      let query =
        supabase
          .from('articles')
          .select('*')
          .eq(
            'status',
            'published'
          )
          .order(
            'intelligence_score',
            {
              ascending:
                false
            }
          )
          .order(
            'published_at',
            {
              ascending:
                false
            }
          )
          .range(
            pageOffset,
            pageOffset +
              pageLimit -
              1
          );

      if (
        request.query.category
      ) {
        query =
          query.eq(
            'category',

            cleanText(
              request.query.category,
              40
            ).toUpperCase()
          );
      }

      const term =
        safeQuery(
          request.query.q
        );

      if (term) {
        query =
          query.or(
            `title.ilike.%${term}%,summary.ilike.%${term}%,content_html.ilike.%${term}%,source.ilike.%${term}%`
          );
      }

      const {
        data,
        error
      } =
        await query;

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.get(
  '/api/articles/:id',

  async (
    request,
    response
  ) => {
    if (!isSupabaseConfigured) {
      return response.status(503).json({
        error: 'Supabase belum dikonfigurasi',
        code: 'SUPABASE_CONFIGURATION_REQUIRED'
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from('articles')
        .select('*')
        .eq(
          'id',
          request.params.id
        )
        .eq(
          'status',
          'published'
        )
        .single();

    if (error || !data) {
      return response
        .status(404)
        .json({
          error:
            'Artikel tidak ditemukan'
        });
    }

    response.json(data);
  }
);

/* =========================================================
   COMMENTS
========================================================= */

const moderateComment =
  body => {
    const text =
      String(body || '')
        .trim();

    const urls =
      (
        text.match(
          /https?:\/\//gi
        ) || []
      ).length;

    const repeated =
      /(.)\1{8,}/.test(
        text
      );

    const suspicious =
      /(free money|pinjol cepat|klik link|casino|judi online)/i.test(
        text
      );

    if (suspicious) {
      return {
        status:
          'blocked',

        score:
          95,

        reason:
          'Pola spam/penipuan berisiko tinggi'
      };
    }

    if (
      urls > 2 ||
      repeated
    ) {
      return {
        status:
          'pending',

        score:
          70,

        reason:
          'Link berlebihan atau pola spam'
      };
    }

    return {
      status:
        'pending',

      score:
        10,

      reason:
        null
    };
  };

app.get(
  '/api/comments',

  async (
    request,
    response
  ) => {
    try {
      const contentType =
        [
          'article',
          'video'
        ].includes(
          request.query.content_type
        )
          ? request.query.content_type
          : null;

      const contentId =
        cleanText(
          request.query.content_id,
          80
        );

      if (
        !contentType ||
        !contentId
      ) {
        return response
          .status(400)
          .json({
            error:
              'content_type dan content_id wajib'
          });
      }

      const {
        data,
        error
      } =
        await supabase
          .from('comments')
          .select(
            `
            id,
            content_type,
            content_id,
            parent_id,
            body,
            status,
            created_at,
            user_id
            `
          )
          .eq(
            'content_type',
            contentType
          )
          .eq(
            'content_id',
            contentId
          )
          .eq(
            'status',
            'approved'
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          )
          .limit(
            cleanLimit(
              request.query.limit,
              100,
              50
            )
          );

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.post(
  '/api/comments',

  commentLimiter,

  async (
    request,
    response
  ) => {
    try {
      const user =
        await getAuthenticatedUser(
          request
        );

      if (!user) {
        return response
          .status(401)
          .json({
            error:
              'Login diperlukan untuk berkomentar'
          });
      }

      const contentType =
        [
          'article',
          'video'
        ].includes(
          request.body?.content_type
        )
          ? request.body.content_type
          : null;

      const contentId =
        cleanText(
          request.body?.content_id,
          80
        );

      const body =
        cleanText(
          request.body?.body,
          2000
        );

      if (
        !contentType ||
        !contentId ||
        !body
      ) {
        return response
          .status(400)
          .json({
            error:
              'Komentar tidak lengkap'
          });
      }

      const check =
        moderateComment(
          body
        );

      const {
        data: reputation
      } =
        await adminClient
          .from(
            'user_reputation'
          )
          .select(
            'trust_score'
          )
          .eq(
            'user_id',
            user.id
          )
          .maybeSingle();

      if (
        reputation?.trust_score >= 80 &&
        check.status === 'pending'
      ) {
        check.status =
          'approved';
      }

      const {
        data,
        error
      } =
        await adminClient
          .from('comments')
          .insert({
            content_type:
              contentType,

            content_id:
              contentId,

            user_id:
              user.id,

            parent_id:
              cleanText(
                request.body?.parent_id,
                80
              ) || null,

            body,

            status:
              check.status,

            moderation_score:
              check.score,

            moderation_reason:
              check.reason
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      await adminClient
        .rpc(
          'refresh_comment_reputation',
          {
            p_user_id:
              user.id
          }
        )
        .catch(() => {});

      response
        .status(201)
        .json({
          comment:
            data,

          message:
            data.status ===
            'approved'
              ? 'Komentar dipublikasikan'
              : 'Komentar sedang ditinjau'
        });

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

app.post(
  '/api/comments/:id/report',

  interactionLimiter,

  async (
    request,
    response
  ) => {
    try {
      const user =
        await getAuthenticatedUser(
          request
        );

      if (!user) {
        return response
          .status(401)
          .json({
            error:
              'Login diperlukan'
          });
      }

      const reason =
        cleanText(
          request.body?.reason,
          500
        );

      if (!reason) {
        return response
          .status(400)
          .json({
            error:
              'Alasan laporan wajib'
          });
      }

      const {
        error
      } =
        await adminClient
          .from(
            'comment_reports'
          )
          .insert({
            comment_id:
              request.params.id,

            reporter_id:
              user.id,

            reason
          });

      if (
        error &&
        error.code !== '23505'
      ) {
        throw error;
      }

      response
        .status(201)
        .json({
          ok:
            true
        });

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN COMMENTS
========================================================= */

app.get(
  '/api/admin/comments',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const status =
        [
          'approved',
          'pending',
          'hidden',
          'blocked',
          'deleted'
        ].includes(
          request.query.status
        )
          ? request.query.status
          : 'pending';

      const {
        data,
        error
      } =
        await adminClient
          .from('comments')
          .select('*')
          .eq(
            'status',
            status
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          )
          .limit(
            cleanLimit(
              request.query.limit,
              500,
              100
            )
          );

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.patch(
  '/api/admin/comments/:id',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const status =
        [
          'approved',
          'pending',
          'hidden',
          'blocked',
          'deleted'
        ].includes(
          request.body?.status
        )
          ? request.body.status
          : null;

      if (!status) {
        return response
          .status(400)
          .json({
            error:
              'Status tidak valid'
          });
      }

      const {
        data,
        error
      } =
        await adminClient
          .from('comments')
          .update({
            status,

            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            'id',
            request.params.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      await adminClient
        .rpc(
          'refresh_comment_reputation',
          {
            p_user_id:
              data.user_id
          }
        )
        .catch(() => {});

      await adminClient
        .from('audit_logs')
        .insert({
          actor_id:
            request.user.id,

          actor_role:
            request.role,

          action:
            'comment_moderated',

          resource_type:
            'comment',

          resource_id:
            request.params.id,

          metadata:
            {
              status
            }
        });

      response.json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN SYSTEM OVERVIEW
========================================================= */

app.get(
  '/api/admin/system/overview',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const [
        comments,
        events,
        automation,
        audit
      ] =
        await Promise.all([
          adminClient
            .from('comments')
            .select(
              'id',
              {
                count:
                  'exact',
                head:
                  true
              }
            )
            .eq(
              'status',
              'pending'
            ),

          adminClient
            .from(
              'system_events'
            )
            .select(
              '*',
              {
                count:
                  'exact',
                head:
                  true
              }
            )
            .is(
              'resolved_at',
              null
            )
            .in(
              'severity',
              [
                'warning',
                'error',
                'critical'
              ]
            ),

          adminClient
            .from(
              'automation_rules'
            )
            .select(
              'id',
              {
                count:
                  'exact',
                head:
                  true
              }
            )
            .eq(
              'enabled',
              true
            ),

          adminClient
            .from(
              'audit_logs'
            )
            .select(
              `
              action,
              resource_type,
              created_at
              `
            )
            .order(
              'created_at',
              {
                ascending:
                  false
              }
            )
            .limit(10)
        ]);

      response.json({
        pending_comments:
          comments.count || 0,

        open_system_events:
          events.count || 0,

        active_automation_rules:
          automation.count || 0,

        recent_audit:
          audit.data || []
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   TRENDING
========================================================= */

app.get(
  '/api/trending',

  async (
    request,
    response
  ) => {
    try {
      const limit =
        cleanLimit(
          request.query.limit,
          20,
          10
        );

      let {
        data,
        error
      } =
        await adminClient
          .from(
            'trending_content'
          )
          .select(
            `
            content_type,
            content_id,
            score,
            rank
            `
          )
          .order(
            'rank',
            {
              ascending:
                true
            }
          )
          .limit(limit);

      if (error) {
        throw error;
      }

      if (!data?.length) {
        await adminClient
          .rpc(
            'rebuild_article_intelligence'
          )
          .catch(() => {});

        await adminClient
          .rpc(
            'rebuild_trending'
          );

        ({
          data,
          error
        } =
          await adminClient
            .from(
              'trending_content'
            )
            .select(
              `
              content_type,
              content_id,
              score,
              rank
              `
            )
            .order(
              'rank',
              {
                ascending:
                  true
              }
            )
            .limit(limit));

        if (error) {
          throw error;
        }
      }

      const articleIds =
        data
          .filter(
            item =>
              item.content_type ===
              'article'
          )
          .map(
            item =>
              item.content_id
          );

      const videoIds =
        data
          .filter(
            item =>
              item.content_type ===
              'video'
          )
          .map(
            item =>
              item.content_id
          );

      const [
        articlesResult,
        videosResult
      ] =
        await Promise.all([
          articleIds.length
            ? adminClient
                .from('articles')
                .select(
                  `
                  id,
                  title,
                  summary,
                  image_url,
                  category,
                  views,
                  likes,
                  shares,
                  published_at,
                  author_name,
                  content_available
                  `
                )
                .in(
                  'id',
                  articleIds
                )
                .eq(
                  'status',
                  'published'
                )

            : Promise.resolve({
                data:
                  []
              }),

          videoIds.length
            ? adminClient
                .from('videos')
                .select(
                  `
                  id,
                  title,
                  description,
                  thumbnail_url,
                  category,
                  views,
                  likes,
                  shares,
                  created_at,
                  author_name
                  `
                )
                .in(
                  'id',
                  videoIds
                )
                .eq(
                  'status',
                  'published'
                )

            : Promise.resolve({
                data:
                  []
              })
        ]);

      const contentMap =
        new Map([
          ...(
            articlesResult.data ||
            []
          ).map(
            item => [
              `article:${item.id}`,
              {
                ...item,
                content_type:
                  'article'
              }
            ]
          ),

          ...(
            videosResult.data ||
            []
          ).map(
            item => [
              `video:${item.id}`,
              {
                ...item,
                content_type:
                  'video'
              }
            ]
          )
        ]);

      response.json(
        data
          .map(
            trend => ({
              ...trend,

              item:
                contentMap.get(
                  `${trend.content_type}:${trend.content_id}`
                )
            })
          )
          .filter(
            item =>
              item.item
          )
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   LIVE EVENTS
========================================================= */

app.get(
  '/api/live/events',

  async (
    request,
    response
  ) => {
    try {
      const limit =
        cleanLimit(
          request.query.limit,
          30,
          10
        );

      const {
        data,
        error
      } =
        await supabase
          .from(
            'news_events'
          )
          .select(
            `
            id,
            event_key,
            title,
            category,
            status,
            article_count,
            source_count,
            importance_score,
            last_seen_at
            `
          )
          .in(
            'status',
            [
              'active',
              'watch'
            ]
          )
          .order(
            'importance_score',
            {
              ascending:
                false
            }
          )
          .limit(limit);

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.get(
  '/api/live/breaking',

  async (
    request,
    response
  ) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from(
            'breaking_candidates'
          )
          .select('*')
          .in(
            'status',
            [
              'candidate',
              'approved'
            ]
          )
          .order(
            'score',
            {
              ascending:
                false
            }
          )
          .limit(20);

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADVERTISEMENTS
========================================================= */

app.get(
  '/api/ads',

  async (
    request,
    response
  ) => {
    try {
      const placement =
        cleanText(
          request.query.placement ||
          'top',
          20
        );

      const now =
        new Date()
          .toISOString();

      const {
        data,
        error
      } =
        await supabase
          .from(
            'ad_campaigns'
          )
          .select(
            `
            id,
            advertiser_name,
            title,
            placement,
            image_url,
            target_url,
            alt_text
            `
          )
          .eq(
            'placement',
            placement
          )
          .eq(
            'active',
            true
          )
          .lte(
            'starts_at',
            now
          )
          .or(
            `ends_at.is.null,ends_at.gte.${now}`
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          )
          .limit(5);

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

app.post(
  '/api/ads/:id/impression',

  interactionLimiter,

  async (
    request,
    response
  ) => {
    const {
      error
    } =
      await adminClient
        .rpc(
          'increment_ad_impressions',
          {
            campaign_id:
              request.params.id
          }
        );

    await trackEvent({
      event_type:
        'ad_impression',

      content_type:
        'ad',

      content_id:
        request.params.id
    });

    response
      .status(
        error
          ? 500
          : 204
      )
      .end();
  }
);

app.post(
  '/api/ads/:id/click',

  interactionLimiter,

  async (
    request,
    response
  ) => {
    const {
      error
    } =
      await adminClient
        .rpc(
          'increment_ad_clicks',
          {
            campaign_id:
              request.params.id
          }
        );

    await trackEvent({
      event_type:
        'ad_click',

      content_type:
        'ad',

      content_id:
        request.params.id
    });

    response
      .status(
        error
          ? 500
          : 204
      )
      .end();
  }
);

/* =========================================================
   CONTENT COUNTERS
========================================================= */

const counter =
  (
    rpc,
    event,
    contentType,
    requiresAuth = false
  ) =>
    async (
      request,
      response
    ) => {
      try {
        if (
          requiresAuth
        ) {
          const user =
            await getAuthenticatedUser(
              request
            );

          if (!user) {
            return response
              .status(401)
              .json({
                error:
                  'Login diperlukan'
              });
          }
        }

        const parameters =
          contentType ===
          'article'
            ? {
                article_id:
                  request.params.id
              }
            : {
                video_id:
                  request.params.id
              };

        const {
          error
        } =
          await supabase
            .rpc(
              rpc,
              parameters
            );

        await trackEvent({
          event_type:
            event,

          content_type:
            contentType,

          content_id:
            request.params.id
        });

        response
          .status(
            error
              ? 500
              : 204
          )
          .end();

      } catch (error) {
        response
          .status(500)
          .json({
            error:
              error.message
          });
      }
    };

/* =========================================================
   ARTICLE INTERACTIONS
========================================================= */

app.post(
  '/api/articles/:id/view',

  interactionLimiter,

  counter(
    'increment_article_views',
    'view',
    'article'
  )
);

app.post(
  '/api/articles/:id/like',

  interactionLimiter,

  counter(
    'increment_article_likes',
    'like',
    'article'
  )
);

app.post(
  '/api/articles/:id/share',

  interactionLimiter,

  counter(
    'increment_article_shares',
    'share',
    'article'
  )
);

/* =========================================================
   VIDEOS
========================================================= */

app.get(
  '/api/videos',

  async (
    request,
    response
  ) => {
    if (!isSupabaseConfigured) {
      return response
        .set('X-BMI-Data-Mode', 'configuration-required')
        .json([]);
    }

    try {
      let query =
        supabase
          .from('videos')
          .select(
            `
            id,
            title,
            description,
            video_url,
            thumbnail_url,
            source,
            category,
            author_name,
            tags,
            views,
            likes,
            shares,
            status,
            created_at,
            updated_at
            `
          )
          .eq(
            'status',
            'published'
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          )
          .limit(
            cleanLimit(
              request.query.limit,
              50,
              20
            )
          );

      if (
        request.query.category
      ) {
        query =
          query.eq(
            'category',

            cleanText(
              request.query.category,
              40
            ).toUpperCase()
          );
      }

      const {
        data,
        error
      } =
        await query;

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   PRIVATE VIDEO HANDLER
========================================================= */

const isPrivateVideo =
  url =>
    typeof url ===
      'string' &&
    url.startsWith(
      'supabase://videos/'
    );

const playHandler =
  async (
    request,
    response
  ) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('videos')
          .select(
            `
            id,
            video_url,
            thumbnail_url,
            status
            `
          )
          .eq(
            'id',
            request.params.id
          )
          .eq(
            'status',
            'published'
          )
          .single();

      if (
        error ||
        !data
      ) {
        return response
          .status(404)
          .json({
            error:
              'Video tidak ditemukan'
          });
      }

      if (
        isPrivateVideo(
          data.video_url
        )
      ) {
        const user =
          await getAuthenticatedUser(
            request
          );

        if (!user) {
          return response
            .status(401)
            .json({
              error:
                'Login Google diperlukan untuk video privat'
            });
        }

        const storagePath =
          data.video_url.slice(
            'supabase://videos/'
              .length
          );

        const {
          data: signed,
          error: signError
        } =
          await adminClient
            .storage
            .from('videos')
            .createSignedUrl(
              storagePath,
              600
            );

        if (
          signError ||
          !signed?.signedUrl
        ) {
          return response
            .status(500)
            .json({
              error:
                'Gagal membuat URL video aman'
            });
        }

        return response.json({
          url:
            signed.signedUrl,

          thumbnail_url:
            data.thumbnail_url ||
            null,

          expiresIn:
            600,

          requiresLogin:
            true
        });
      }

      response.json({
        url:
          data.video_url,

        thumbnail_url:
          data.thumbnail_url ||
          null,

        expiresIn:
          null,

        requiresLogin:
          false
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  };

app.get(
  '/api/videos/:id/play',

  playHandler
);

app.post(
  '/api/videos/:id/view',

  interactionLimiter,

  requireUser,

  counter(
    'increment_video_views',
    'view',
    'video',
    true
  )
);

app.post(
  '/api/videos/:id/like',

  interactionLimiter,

  requireUser,

  counter(
    'increment_video_likes',
    'like',
    'video',
    true
  )
);

app.post(
  '/api/videos/:id/share',

  interactionLimiter,

  counter(
    'increment_video_shares',
    'share',
    'video'
  )
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  '/api/admin/login',

  authLimiter,

  async (
    request,
    response
  ) => {
    try {
      const {
        email,
        password
      } =
        request.body || {};

      if (
        !email ||
        !password
      ) {
        return response
          .status(400)
          .json({
            error:
              'Email dan password wajib diisi'
          });
      }

      const {
        data,
        error
      } =
        await authClient
          .auth
          .signInWithPassword({
            email,
            password
          });

      if (
        error ||
        !data.session
      ) {
        return response
          .status(401)
          .json({
            error:
              'Login gagal'
          });
      }

      const {
        data: profile
      } =
        await adminClient
          .from('profiles')
          .select('role')
          .eq(
            'id',
            data.user.id
          )
          .maybeSingle();

      if (
        !profile ||
        ![
          'admin',
          'editor'
        ].includes(
          profile.role
        )
      ) {
        return response
          .status(403)
          .json({
            error:
              'Akun bukan admin/editor'
          });
      }

      response.json({
        ok:
          true,

        token:
          data
            .session
            .access_token,

        user:
          data.user,

        role:
          profile.role
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN BREAKING NEWS
========================================================= */

app.get(
  '/api/admin/breaking',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from(
          'breaking_candidates'
        )
        .select('*')
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(200);

    response
      .status(
        error
          ? 500
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

app.patch(
  '/api/admin/breaking/:id',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const status =
        [
          'candidate',
          'approved',
          'dismissed'
        ].includes(
          request.body?.status
        )
          ? request.body.status
          : 'candidate';

      const {
        data,
        error
      } =
        await adminClient
          .from(
            'breaking_candidates'
          )
          .update({
            status,

            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            'id',
            request.params.id
          )
          .select()
          .single();

      if (
        !error &&
        status === 'approved' &&
        data?.event_key
      ) {
        await adminClient
          .from('articles')
          .update({
            breaking:
              true,

            editorial_status:
              'approved',

            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            'event_key',
            data.event_key
          );
      }

      response
        .status(
          error
            ? 400
            : 200
        )
        .json(
          error
            ? {
                error:
                  error.message
              }
            : data
        );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN SYNC
========================================================= */

app.post(
  '/api/admin/sync',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const result =
        await syncFeeds();

      response.json({
        ok:
          true,

        result
      });

    } catch (error) {
      response
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  '/api/admin/stats',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const [
        articlesResult,
        draftsResult,
        videosResult,
        eventsResult
      ] =
        await Promise.all([
          adminClient
            .from('articles')
            .select(
              `
              id,
              title,
              category,
              views,
              likes,
              shares,
              published_at,
              status
              `
            )
            .eq(
              'status',
              'published'
            )
            .order(
              'views',
              {
                ascending:
                  false
              }
            )
            .limit(2000),

          adminClient
            .from('articles')
            .select(
              'id',
              {
                count:
                  'exact',
                head:
                  true
              }
            )
            .eq(
              'status',
              'draft'
            ),

          adminClient
            .from('videos')
            .select(
              `
              id,
              title,
              category,
              views,
              likes,
              shares,
              created_at,
              status
              `
            )
            .eq(
              'status',
              'published'
            )
            .order(
              'views',
              {
                ascending:
                  false
              }
            )
            .limit(1000),

          adminClient
            .from(
              'analytics_events'
            )
            .select(
              'id',
              {
                count:
                  'exact',
                head:
                  true
              }
            )
        ]);

      const firstError =
        articlesResult.error ||
        draftsResult.error ||
        videosResult.error ||
        eventsResult.error;

      if (firstError) {
        throw firstError;
      }

      const articles =
        articlesResult.data ||
        [];

      const videos =
        videosResult.data ||
        [];

      const all =
        [
          ...articles,
          ...videos
        ];

      const topContent =
        [...all]
          .sort(
            (a, b) => {
              const scoreA =
                Number(
                  a.views ||
                  0
                ) +
                Number(
                  a.shares ||
                  0
                ) * 3 +
                Number(
                  a.likes ||
                  0
                ) * 2;

              const scoreB =
                Number(
                  b.views ||
                  0
                ) +
                Number(
                  b.shares ||
                  0
                ) * 3 +
                Number(
                  b.likes ||
                  0
                ) * 2;

              return (
                scoreB -
                scoreA
              );
            }
          )
          .slice(
            0,
            10
          );

      response.json({
        publishedArticles:
          articles.length,

        draftArticles:
          draftsResult.count ||
          0,

        videos:
          videos.length,

        views:
          all.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.views ||
                0
              ),
            0
          ),

        likes:
          all.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.likes ||
                0
              ),
            0
          ),

        shares:
          all.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.shares ||
                0
              ),
            0
          ),

        events:
          eventsResult.count ||
          0,

        topContent
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ARTICLE WRITE HELPER
========================================================= */

const articleWriteBody =
  body => ({
    title:
      cleanText(
        body.title,
        500
      ),

    summary:
      cleanText(
        body.summary,
        1500
      ),

    content_html:
      safeHtml(
        body.content_html ||
        ''
      ),

    url:
      cleanText(
        body.url,
        1200
      ),

    source_url:
      cleanText(
        body.source_url ||
        body.url,
        1200
      ),

    image_url:
      cleanText(
        body.image_url,
        1200
      ) || null,

    source:
      cleanText(
        body.source,
        120
      ) || 'ADMIN',

    author_name:
      cleanText(
        body.author_name,
        160
      ) || null,

    author_url:
      cleanText(
        body.author_url,
        500
      ) || null,

    category:
      cleanText(
        body.category,
        50
      )
        .toUpperCase() ||
      'NASIONAL',

    tags:
      Array.isArray(
        body.tags
      )
        ? body.tags
            .map(
              value =>
                cleanText(
                  value,
                  40
                )
            )
            .filter(Boolean)
            .slice(
              0,
              20
            )
        : [],

    status:
      [
        'draft',
        'published',
        'archived'
      ].includes(
        body.status
      )
        ? body.status
        : 'draft',

    published_at:
      body.published_at ||
      null,

    featured:
      Boolean(
        body.featured
      ),

    content_source:
      cleanText(
        body.content_source ||
        'editor',
        40
      )
  });

/* =========================================================
   ADMIN ARTICLES
========================================================= */

app.get(
  '/api/admin/articles',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from('articles')
        .select('*')
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(300);

    response
      .status(
        error
          ? 500
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

app.post(
  '/api/admin/articles',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const payload =
        articleWriteBody(
          request.body ||
          {}
        );

      if (
        !payload.title ||
        !payload.url
      ) {
        return response
          .status(400)
          .json({
            error:
              'Judul dan URL wajib'
          });
      }

      if (
        payload.status ===
          'published' &&
        !payload.published_at
      ) {
        payload.published_at =
          new Date()
            .toISOString();
      }

      const {
        data,
        error
      } =
        await adminClient
          .from('articles')
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      response
        .status(201)
        .json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

app.patch(
  '/api/admin/articles/:id',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const payload =
        articleWriteBody(
          request.body ||
          {}
        );

      delete payload.url;

      const {
        data,
        error
      } =
        await adminClient
          .from('articles')
          .update({
            ...payload,

            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            'id',
            request.params.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      response.json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

app.delete(
  '/api/admin/articles/:id',

  admin,

  async (
    request,
    response
  ) => {
    const {
      error
    } =
      await adminClient
        .from('articles')
        .delete()
        .eq(
          'id',
          request.params.id
        );

    response
      .status(
        error
          ? 400
          : 204
      )
      .end();
  }
);

/* =========================================================
   ADMIN VIDEOS
========================================================= */

app.get(
  '/api/admin/videos',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from('videos')
        .select('*')
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(300);

    response
      .status(
        error
          ? 500
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

const videoWriteBody =
  body => ({
    title:
      cleanText(
        body.title,
        500
      ),

    description:
      cleanText(
        body.description,
        4000
      ),

    video_url:
      cleanText(
        body.video_url,
        2000
      ),

    thumbnail_url:
      cleanText(
        body.thumbnail_url,
        1200
      ) || null,

    source:
      cleanText(
        body.source,
        120
      ) || 'ADMIN',

    category:
      cleanText(
        body.category,
        50
      )
        .toUpperCase() ||
      'VIDEO',

    author_name:
      cleanText(
        body.author_name,
        160
      ) || null,

    tags:
      Array.isArray(
        body.tags
      )
        ? body.tags
            .map(
              value =>
                cleanText(
                  value,
                  40
                )
            )
            .filter(Boolean)
            .slice(
              0,
              20
            )
        : [],

    status:
      [
        'draft',
        'published',
        'archived'
      ].includes(
        body.status
      )
        ? body.status
        : 'draft'
  });

app.post(
  '/api/admin/videos',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const payload =
        videoWriteBody(
          request.body ||
          {}
        );

      if (
        !payload.title ||
        !payload.video_url
      ) {
        return response
          .status(400)
          .json({
            error:
              'Judul dan URL video wajib'
          });
      }

      const {
        data,
        error
      } =
        await adminClient
          .from('videos')
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      response
        .status(201)
        .json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

app.patch(
  '/api/admin/videos/:id',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const payload =
        videoWriteBody(
          request.body ||
          {}
        );

      const {
        data,
        error
      } =
        await adminClient
          .from('videos')
          .update({
            ...payload,

            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            'id',
            request.params.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      response.json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

app.delete(
  '/api/admin/videos/:id',

  admin,

  async (
    request,
    response
  ) => {
    const {
      error
    } =
      await adminClient
        .from('videos')
        .delete()
        .eq(
          'id',
          request.params.id
        );

    response
      .status(
        error
          ? 400
          : 204
      )
      .end();
  }
);

/* =========================================================
   ADMIN ADS
========================================================= */

app.get(
  '/api/admin/ads',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from(
          'ad_campaigns'
        )
        .select('*')
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(300);

    response
      .status(
        error
          ? 500
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

app.post(
  '/api/admin/ads',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const body =
        request.body || {};

      const payload = {
        advertiser_name:
          cleanText(
            body.advertiser_name,
            200
          ),

        title:
          cleanText(
            body.title,
            500
          ),

        placement:
          cleanText(
            body.placement,
            20
          ),

        image_url:
          cleanText(
            body.image_url,
            1200
          ) || null,

        target_url:
          cleanText(
            body.target_url,
            1500
          ),

        alt_text:
          cleanText(
            body.alt_text,
            300
          ) || null,

        starts_at:
          body.starts_at ||
          new Date()
            .toISOString(),

        ends_at:
          body.ends_at ||
          null,

        active:
          Boolean(
            body.active
          )
      };

      const {
        data,
        error
      } =
        await adminClient
          .from(
            'ad_campaigns'
          )
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      response
        .status(201)
        .json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

app.patch(
  '/api/admin/ads/:id',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from(
          'ad_campaigns'
        )
        .update({
          ...request.body,

          updated_at:
            new Date()
              .toISOString()
        })
        .eq(
          'id',
          request.params.id
        )
        .select()
        .single();

    response
      .status(
        error
          ? 400
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

app.delete(
  '/api/admin/ads/:id',

  admin,

  async (
    request,
    response
  ) => {
    const {
      error
    } =
      await adminClient
        .from(
          'ad_campaigns'
        )
        .delete()
        .eq(
          'id',
          request.params.id
        );

    response
      .status(
        error
          ? 400
          : 204
      )
      .end();
  }
);

/* =========================================================
   AFFILIATE OFFERS
========================================================= */

app.get(
  '/api/affiliate/offers',

  async (
    request,
    response
  ) => {
    try {
      const now =
        new Date()
          .toISOString();

      let query =
        adminClient
          .from(
            'affiliate_offers'
          )
          .select(
            `
            id,
            partner_name,
            title,
            description,
            target_url,
            image_url,
            category,
            content_type,
            content_id,
            commission_model
            `
          )
          .eq(
            'active',
            true
          )
          .lte(
            'starts_at',
            now
          )
          .or(
            `ends_at.is.null,ends_at.gte.${now}`
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          )
          .limit(
            cleanLimit(
              request.query.limit,
              20,
              6
            )
          );

      if (
        request.query.category
      ) {
        query =
          query.eq(
            'category',
            cleanText(
              request.query.category,
              80
            )
          );
      }

      if (
        request.query.content_id
      ) {
        query =
          query.eq(
            'content_id',
            cleanText(
              request.query.content_id,
              80
            )
          );
      }

      const {
        data,
        error
      } =
        await query;

      if (error) {
        throw error;
      }

      response.json(
        data || []
      );

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   AFFILIATE REDIRECT
========================================================= */

app.get(
  '/go/:id',

  async (
    request,
    response
  ) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from(
            'affiliate_offers'
          )
          .select(
            `
            id,
            target_url,
            active,
            starts_at,
            ends_at
            `
          )
          .eq(
            'id',
            request.params.id
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      const now =
        new Date();

      if (
        !data ||
        !data.active ||
        new Date(
          data.starts_at
        ) > now ||
        (
          data.ends_at &&
          new Date(
            data.ends_at
          ) < now
        )
      ) {
        return response
          .status(404)
          .send(
            'Penawaran tidak tersedia'
          );
      }

      const sessionId =
        cleanText(
          request.query.sid,
          120
        ) || null;

      const contentType =
        cleanText(
          request.query.content_type,
          20
        ) || null;

      const contentId =
        cleanText(
          request.query.content_id,
          80
        ) || null;

      await Promise.all([
        adminClient
          .rpc(
            'increment_affiliate_click',
            {
              p_offer_id:
                data.id
            }
          ),

        adminClient
          .from(
            'affiliate_clicks'
          )
          .insert({
            offer_id:
              data.id,

            session_id:
              sessionId,

            content_type:
              contentType,

            content_id:
              contentId
          }),

        trackEvent({
          event_type:
            'affiliate_click',

          content_type:
            contentType ||
            'site',

          content_id:
            contentId,

          path:
            request.path,

          session_id:
            sessionId
        })
      ]);

      response.redirect(
        302,
        data.target_url
      );

    } catch (error) {
      response
        .status(500)
        .send(
          'Gagal membuka penawaran'
        );
    }
  }
);

/* =========================================================
   NEWSLETTER
========================================================= */

app.post(
  '/api/newsletter/subscribe',

  interactionLimiter,

  async (
    request,
    response
  ) => {
    try {
      const email =
        cleanText(
          request.body?.email,
          254
        )
          .toLowerCase();

      const name =
        cleanText(
          request.body?.name,
          120
        ) || null;

      const categories =
        Array.isArray(
          request.body?.categories
        )
          ? request.body.categories
              .map(
                value =>
                  cleanText(
                    value,
                    40
                  )
              )
              .filter(Boolean)
              .slice(
                0,
                20
              )
          : [];

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
          .test(email)
      ) {
        return response
          .status(400)
          .json({
            error:
              'Email tidak valid'
          });
      }

      const {
        error
      } =
        await adminClient
          .from(
            'newsletter_subscribers'
          )
          .upsert(
            {
              email,
              name,
              categories,

              status:
                'active',

              source:
                'website',

              updated_at:
                new Date()
                  .toISOString()
            },
            {
              onConflict:
                'email'
            }
          );

      if (error) {
        throw error;
      }

      response
        .status(201)
        .json({
          ok:
            true,

          message:
            'Berlangganan berhasil'
        });

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN REVENUE
========================================================= */

app.get(
  '/api/admin/revenue',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const days =
        Math.min(
          Math.max(
            Number(
              request.query.days
            ) || 30,
            1
          ),
          3650
        );

      const since =
        new Date(
          Date.now() -
          days *
          86400000
        )
          .toISOString();

      const [
        revenueResult,
        affiliateResult,
        adsResult
      ] =
        await Promise.all([
          adminClient
            .from(
              'revenue_entries'
            )
            .select(
              `
              source,
              amount,
              currency,
              occurred_at,
              content_type,
              content_id
              `
            )
            .gte(
              'occurred_at',
              since
            )
            .order(
              'occurred_at',
              {
                ascending:
                  false
              }
            )
            .limit(5000),

          adminClient
            .from(
              'affiliate_offers'
            )
            .select(
              `
              id,
              title,
              partner_name,
              clicks,
              conversions,
              estimated_commission
              `
            )
            .order(
              'clicks',
              {
                ascending:
                  false
              }
            )
            .limit(20),

          adminClient
            .from(
              'ad_campaigns'
            )
            .select(
              `
              id,
              title,
              advertiser_name,
              impressions,
              clicks
              `
            )
            .order(
              'impressions',
              {
                ascending:
                  false
              }
            )
            .limit(20)
        ]);

      const firstError =
        revenueResult.error ||
        affiliateResult.error ||
        adsResult.error;

      if (firstError) {
        throw firstError;
      }

      const totals = {};

      for (
        const entry of
        revenueResult.data ||
        []
      ) {
        const key =
          `${entry.source}:${entry.currency}`;

        totals[key] =
          (
            totals[key] ||
            0
          ) +
          Number(
            entry.amount ||
            0
          );
      }

      response.json({
        days,

        totals,

        entries:
          revenueResult.data ||
          [],

        topAffiliate:
          affiliateResult.data ||
          [],

        topAds:
          adsResult.data ||
          []
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN NEWSLETTER
========================================================= */

app.get(
  '/api/admin/newsletter',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from(
          'newsletter_subscribers'
        )
        .select(
          `
          id,
          email,
          name,
          categories,
          status,
          created_at
          `
        )
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(1000);

    response
      .status(
        error
          ? 500
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

/* =========================================================
   ADMIN AFFILIATE
========================================================= */

app.get(
  '/api/admin/affiliate',

  admin,

  async (
    request,
    response
  ) => {
    const {
      data,
      error
    } =
      await adminClient
        .from(
          'affiliate_offers'
        )
        .select('*')
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(500);

    response
      .status(
        error
          ? 500
          : 200
      )
      .json(
        error
          ? {
              error:
                error.message
            }
          : data
      );
  }
);

app.post(
  '/api/admin/affiliate',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const body =
        request.body || {};

      const payload = {
        partner_name:
          cleanText(
            body.partner_name,
            200
          ),

        title:
          cleanText(
            body.title,
            500
          ),

        description:
          cleanText(
            body.description,
            3000
          ) || null,

        target_url:
          cleanText(
            body.target_url,
            2000
          ),

        image_url:
          cleanText(
            body.image_url,
            1500
          ) || null,

        category:
          cleanText(
            body.category,
            80
          ) || null,

        content_type:
          [
            'article',
            'video',
            'site'
          ].includes(
            body.content_type
          )
            ? body.content_type
            : null,

        content_id:
          cleanText(
            body.content_id,
            80
          ) || null,

        commission_model:
          [
            'cpa',
            'cps',
            'cpc',
            'fixed',
            'unknown'
          ].includes(
            body.commission_model
          )
            ? body.commission_model
            : 'unknown',

        estimated_commission:
          Number(
            body.estimated_commission
          ) || null,

        active:
          body.active !== false,

        starts_at:
          body.starts_at ||
          new Date()
            .toISOString(),

        ends_at:
          body.ends_at ||
          null
      };

      if (
        !payload.partner_name ||
        !payload.title ||
        !/^https?:\/\//i
          .test(
            payload.target_url
          )
      ) {
        return response
          .status(400)
          .json({
            error:
              'Partner, judul, dan URL http(s) wajib'
          });
      }

      const {
        data,
        error
      } =
        await adminClient
          .from(
            'affiliate_offers'
          )
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      response
        .status(201)
        .json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   ADMIN REVENUE ENTRY
========================================================= */

app.post(
  '/api/admin/revenue',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const body =
        request.body || {};

      const payload = {
        source:
          [
            'adsense',
            'direct_ad',
            'sponsor',
            'affiliate',
            'video',
            'subscription',
            'other'
          ].includes(
            body.source
          )
            ? body.source
            : 'other',

        amount:
          Number(
            body.amount
          ) || 0,

        currency:
          cleanText(
            body.currency,
            8
          )
            .toUpperCase() ||
          'IDR',

        occurred_at:
          body.occurred_at ||
          new Date()
            .toISOString(),

        content_type:
          [
            'article',
            'video',
            'site'
          ].includes(
            body.content_type
          )
            ? body.content_type
            : null,

        content_id:
          cleanText(
            body.content_id,
            80
          ) || null,

        campaign_id:
          cleanText(
            body.campaign_id,
            80
          ) || null,

        affiliate_offer_id:
          cleanText(
            body.affiliate_offer_id,
            80
          ) || null,

        notes:
          cleanText(
            body.notes,
            2000
          ) || null
      };

      const {
        data,
        error
      } =
        await adminClient
          .from(
            'revenue_entries'
          )
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      response
        .status(201)
        .json(data);

    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   CRON SYNC
========================================================= */

app.get(
  '/api/cron/sync',

  async (
    request,
    response
  ) => {
    const expectedSecret =
      process.env.CRON_SECRET;

    if (!expectedSecret) {
      return response
        .status(503)
        .json({
          error:
            'CRON_SECRET belum diatur'
        });
    }

    const authorization =
      request.headers.authorization ||
      '';

    const bearer =
      authorization.startsWith(
        'Bearer '
      )
        ? authorization.slice(7)
        : '';

    const headerSecret =
      request.headers[
        'x-cron-secret'
      ];

    if (
      headerSecret !==
        expectedSecret &&
      bearer !==
        expectedSecret
    ) {
      return response
        .status(401)
        .json({
          error:
            'Unauthorized'
        });
    }

    try {
      const result =
        await syncFeeds();

      const trendResult =
        await adminClient
          .rpc(
            'rebuild_article_intelligence'
          )
          .catch(
            () => ({
              error:
                null
            })
          );

      await adminClient
        .rpc(
          'rebuild_trending'
        );

      await adminClient
        .rpc(
          'rebuild_live_events'
        )
        .catch(
          () => {}
        );

      if (
        trendResult?.error
      ) {
        throw trendResult.error;
      }

      response.json({
        ok:
          true,

        result,

        updatedAt:
          new Date()
            .toISOString()
      });

    } catch (error) {
      response
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

/* =========================================================
   SITEMAP
========================================================= */

app.get(
  '/sitemap.xml',

  async (
    request,
    response
  ) => {
    try {
      const [
        articlesResult,
        videosResult
      ] =
        await Promise.all([
          supabase
            .from('articles')
            .select(
              `
              id,
              published_at,
              updated_at
              `
            )
            .eq(
              'status',
              'published'
            )
            .order(
              'published_at',
              {
                ascending:
                  false
              }
            )
            .limit(5000),

          supabase
            .from('videos')
            .select(
              `
              id,
              created_at,
              updated_at
              `
            )
            .eq(
              'status',
              'published'
            )
            .order(
              'created_at',
              {
                ascending:
                  false
              }
            )
            .limit(3000)
        ]);

      const firstError =
        articlesResult.error ||
        videosResult.error;

      if (firstError) {
        throw firstError;
      }

      const urls = [
        `<url><loc>${esc(
          baseUrl
        )}/</loc></url>`
      ];

      for (
        const article of
        articlesResult.data ||
        []
      ) {
        const date =
          article.updated_at ||
          article.published_at;

        urls.push(
          `<url>
<loc>${esc(
            baseUrl
          )}/berita/${article.id}</loc>
${
  date
    ? `<lastmod>${new Date(
        date
      ).toISOString()}</lastmod>`
    : ''
}
</url>`
        );
      }

      for (
        const video of
        videosResult.data ||
        []
      ) {
        const date =
          video.updated_at ||
          video.created_at;

        urls.push(
          `<url>
<loc>${esc(
            baseUrl
          )}/video/${video.id}</loc>
${
  date
    ? `<lastmod>${new Date(
        date
      ).toISOString()}</lastmod>`
    : ''
}
</url>`
        );
      }

      response
        .type(
          'application/xml'
        )
        .send(
          `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('')}
</urlset>`
        );

    } catch (error) {
      response
        .status(500)
        .type(
          'text/plain'
        )
        .send(
          error.message
        );
    }
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

const healthHandler =
  async (
    request,
    response
  ) => {
    try {
      const [
        databaseResult,
        lastRunResult,
        badSourcesResult
      ] =
        await Promise.all([
          adminClient
            .from('articles')
            .select('id')
            .limit(1),

          adminClient
            .from(
              'sync_runs'
            )
            .select(
              `
              status,
              finished_at,
              started_at
              `
            )
            .order(
              'started_at',
              {
                ascending:
                  false
              }
            )
            .limit(1)
            .maybeSingle(),

          adminClient
            .from(
              'news_sources'
            )
            .select('id')
            .in(
              'status',
              [
                'degraded',
                'unhealthy'
              ]
            )
        ]);

      if (
        databaseResult.error
      ) {
        return response
          .status(503)
          .json({
            ok:
              false,

            version:
              '5.5.0',

            database:
              false,

            error:
              databaseResult
                .error
                .message,

            time:
              new Date()
                .toISOString()
          });
      }

      response.json({
        ok:
          true,

        version:
          '5.5.0',

        database:
          true,

        sync:
          lastRunResult.data ||
          null,

        degraded_sources:
          (
            badSourcesResult.data ||
            []
          ).length,

        time:
          new Date()
            .toISOString()
      });

    } catch (error) {
      response
        .status(503)
        .json({
          ok:
            false,

          version:
            '5.5.0',

          database:
            false,

          error:
            error.message,

          time:
            new Date()
              .toISOString()
        });
    }
  };

app.get(
  '/api/system/config',
  (request, response) => {
    response.json({
      ok: true,
      supabaseConfigured: isSupabaseConfigured,
      missingEnvironmentVariables,
      message: isSupabaseConfigured ? 'Live data engine siap.' : 'Live data membutuhkan environment variables Supabase.'
    });
  }
);

app.get(
  '/health',
  healthHandler
);

app.get(
  '/api/health',
  healthHandler
);

/* =========================================================
   HOMEPAGE
========================================================= */

app.get(
  '/',

  (
    request,
    response
  ) => {
    response.sendFile(
      path.join(
        publicDir,
        'index.html'
      )
    );
  }
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    publicDir,
    {
      extensions:
        ['html']
    }
  )
);

/* =========================================================
   404 HANDLER
========================================================= */

app.use(
  (
    request,
    response
  ) => {
    response
      .status(404)
      .json({
        error:
          'Endpoint tidak ditemukan'
      });
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    request,
    response,
    next
  ) => {
    console.error(error);

    if (
      response.headersSent
    ) {
      return next(error);
    }

    response
      .status(500)
      .json({
        error:
          'Internal server error'
      });
  }
);

/* =========================================================
   EXPORT FOR VERCEL
========================================================= */

export default app;

/* =========================================================
   LOCAL SERVER ONLY
========================================================= */

if (
  process.env.VERCEL !==
  '1'
) {
  app.listen(
    PORT,
    () => {
      console.log(
        `BERITA MUDA INDONESIA V5.5 running on :${PORT}`
      );
    }
  );

  const runCycle =
    async () => {
      if (!isSupabaseConfigured || !adminClient) {
        console.warn('Sync cycle skipped: Supabase environment belum lengkap.');
        return;
      }

      await syncFeeds()
        .catch(
          console.error
        );

      await adminClient
        .rpc(
          'rebuild_article_intelligence'
        )
        .catch(
          console.error
        );

      await adminClient
        .rpc(
          'rebuild_trending'
        )
        .catch(
          console.error
        );

      await adminClient
        .rpc(
          'rebuild_live_events'
        )
        .catch(
          console.error
        );
    };

  setTimeout(
    runCycle,
    3000
  );

  setInterval(
    runCycle,

    Math.max(
      1,
      Number(
        process.env
          .SYNC_INTERVAL_MINUTES
      ) || 5
    ) *
      60_000
  );
}
