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
   AUTH + ADMIN SECURITY HELPERS
========================================================= */

const getBearerToken = request => {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
};

const getAuthenticatedUser = async request => {
  if (!adminClient) return null;

  const token = getBearerToken(request);
  if (!token) return null;

  const {
    data: { user },
    error
  } = await adminClient.auth.getUser(token);

  if (error || !user) return null;
  return user;
};

const getAdminRecord = async userId => {
  if (!adminClient || !userId) {
    return { admin: null, error: new Error('Admin database unavailable') };
  }

  const { data, error } = await adminClient
    .from('admins')
    .select('id,user_id,email,role,is_active,created_at,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  return { admin: data || null, error };
};

const createUserSupabaseClient = token => {
  if (!supabaseUrl || !supabaseAnonKey || !token) return null;

  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
};

/* =========================================================
   USER AUTH MIDDLEWARE
========================================================= */

const requireUser = async (request, response, next) => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return response.status(401).json({
        error: 'Login diperlukan'
      });
    }

    request.user = user;
    next();

  } catch (error) {
    response.status(401).json({
      error: 'Sesi login tidak valid'
    });
  }
};

/* =========================================================
   ADMIN MIDDLEWARE
   Source of truth: public.admins
========================================================= */

const admin = async (request, response, next) => {
  try {
    if (!adminClient) {
      return response.status(503).json({
        error: 'Admin service belum dikonfigurasi'
      });
    }

    const user = await getAuthenticatedUser(request);

    if (!user) {
      return response.status(401).json({
        error: 'Unauthorized'
      });
    }

    const {
      admin: adminRecord,
      error
    } = await getAdminRecord(user.id);

    if (
      error ||
      !adminRecord ||
      adminRecord.is_active !== true
    ) {
      return response.status(403).json({
        error: 'Akses admin ditolak'
      });
    }

    request.user = user;
    request.admin = adminRecord;
    request.role = adminRecord.role || 'admin';

    next();

  } catch (error) {
    console.error('[ADMIN AUTH]', error);

    response.status(401).json({
      error: 'Session tidak valid'
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
        },
        error => {
          if (error) {
            response
              .status(404)
              .send(
                'Halaman tidak ditemukan'
              );
          }
        }
      );
    }
  );
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  '/api/health',

  (
    request,
    response
  ) => {
    response.json({
      ok:
        true,

      service:
        'Berita Muda Indonesia API',

      timestamp:
        new Date()
          .toISOString(),

      supabase:
        Boolean(
          isSupabaseConfigured
        )
    });
  }
);

/* =========================================================
   API STATUS
========================================================= */

app.get(
  '/api/status',

  (
    request,
    response
  ) => {
    response.json({
      ok:
        true,

      configured:
        Boolean(
          isSupabaseConfigured
        ),

      message:
        isSupabaseConfigured
          ? 'Supabase terhubung'
          : (
              supabaseConfigMessage ||
              'Supabase belum dikonfigurasi'
            )
    });
  }
);

/* =========================================================
   ARTICLES
========================================================= */

app.get(
  '/api/articles',

  async (
    request,
    response
  ) => {
    try {
      if (!isSupabaseConfigured) {
        return response
          .status(503)
          .json({
            error:
              supabaseConfigMessage ||
              'Supabase belum dikonfigurasi'
          });
      }

      const limit =
        cleanLimit(
          request.query.limit,
          100,
          20
        );

      const offset =
        Math.max(
          Number(
            request.query.offset ||
            0
          ),
          0
        );

      const category =
        cleanText(
          request.query.category,
          80
        );

      const query =
        safeQuery(
          request.query.q
        );

      let builder =
        supabase
          .from('articles')
          .select(
            `
            id,
            title,
            summary,
            content,
            content_html,
            url,
            image_url,
            source,
            source_url,
            author_name,
            author_url,
            category,
            tags,
            published_at,
            created_at,
            updated_at,
            reading_minutes,
            views,
            likes,
            shares,
            featured,
            breaking,
            status,
            content_available,
            editorial_status,
            intelligence_score,
            source_quality_score,
            freshness_score,
            engagement_score,
            canonical_url
            `
          )
          .eq(
            'status',
            'published'
          );

      if (category) {
        builder =
          builder.eq(
            'category',
            category
          );
      }

      if (query) {
        builder =
          builder.or(
            [
              `title.ilike.%${query}%`,
              `summary.ilike.%${query}%`,
              `content.ilike.%${query}%`
            ].join(',')
          );
      }

      const {
        data,
        error
      } =
        await builder
          .order(
            'breaking',
            {
              ascending:
                false
            }
          )
          .order(
            'featured',
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
            offset,
            offset +
              limit -
              1
          );

      if (error) {
        throw error;
      }

      response.json(
        data ||
        []
      );

    } catch (error) {
      console.error(
        '[API] articles:',
        error
      );

      response
        .status(500)
        .json({
          error:
            error.message ||
            'Gagal mengambil berita'
        });
    }
  }
);

/* =========================================================
   SINGLE ARTICLE
========================================================= */

app.get(
  '/api/articles/:id',

  async (
    request,
    response
  ) => {
    try {
      if (!isSupabaseConfigured) {
        return response
          .status(503)
          .json({
            error:
              supabaseConfigMessage ||
              'Supabase belum dikonfigurasi'
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
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return response
          .status(404)
          .json({
            error:
              'Berita tidak ditemukan'
          });
      }

      response.json(
        data
      );

    } catch (error) {
      console.error(
        '[API] article detail:',
        error
      );

      response
        .status(500)
        .json({
          error:
            error.message ||
            'Gagal mengambil detail berita'
        });
    }
  }
);

/* =========================================================
   ARTICLE VIEW
========================================================= */

app.post(
  '/api/articles/:id/view',

  interactionLimiter,

  async (
    request,
    response
  ) => {
    try {
      const id =
        request.params.id;

      const {
        data:
          current,
        error:
          currentError
      } =
        await adminClient
          .from('articles')
          .select(
            'views'
          )
          .eq(
            'id',
            id
          )
          .maybeSingle();

      if (currentError) {
        throw currentError;
      }

      if (!current) {
        return response
          .status(404)
          .json({
            error:
              'Berita tidak ditemukan'
          });
      }

      const {
        error
      } =
        await adminClient
          .from('articles')
          .update({
            views:
              Number(
                current.views ||
                0
              ) +
              1
          })
          .eq(
            'id',
            id
          );

      if (error) {
        throw error;
      }

      trackEvent({
        event_type:
          'view',

        content_type:
          'article',

        content_id:
          id,

        path:
          `/berita/${id}`,

        referrer:
          request.headers.referer ||
          null
      });

      response.json({
        ok:
          true
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message ||
            'Gagal mencatat view'
        });
    }
  }
);

/* =========================================================
   ARTICLE LIKE
========================================================= */

app.post(
  '/api/articles/:id/like',

  interactionLimiter,

  async (
    request,
    response
  ) => {
    try {
      const id =
        request.params.id;

      const {
        data:
          current,
        error:
          currentError
      } =
        await adminClient
          .from('articles')
          .select(
            'likes'
          )
          .eq(
            'id',
            id
          )
          .maybeSingle();

      if (currentError) {
        throw currentError;
      }

      if (!current) {
        return response
          .status(404)
          .json({
            error:
              'Berita tidak ditemukan'
          });
      }

      const {
        error
      } =
        await adminClient
          .from('articles')
          .update({
            likes:
              Number(
                current.likes ||
                0
              ) +
              1
          })
          .eq(
            'id',
            id
          );

      if (error) {
        throw error;
      }

      trackEvent({
        event_type:
          'like',

        content_type:
          'article',

        content_id:
          id,

        path:
          `/berita/${id}`
      });

      response.json({
        ok:
          true
      });

    } catch (error) {
      response
        .status(500)
        .json({
          error:
            error.message ||
            'Gagal menyimpan like'
        });
    }
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
          .select(`
            id,
            content_type,
            content_id,
            parent_id,
            body,
            status,
            created_at,
            user_id
          `)
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

      /*
       * FIX:
       * Jangan gunakan adminClient.rpc(...).catch(...)
       */
      try {
        const {
          error: reputationError
        } =
          await adminClient.rpc(
            'refresh_comment_reputation',
            {
              p_user_id:
                user.id
            }
          );

        if (reputationError) {
          console.error(
            '[COMMENTS] refresh_comment_reputation:',
            reputationError.message ||
              reputationError
          );
        }

      } catch (rpcError) {
        console.error(
          '[COMMENTS] refresh_comment_reputation failed:',
          rpcError?.message ||
            rpcError
        );
      }

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

      /*
       * FIX:
       * Jangan gunakan .catch() langsung pada RPC builder.
       */
      try {
        const {
          error: reputationError
        } =
          await adminClient.rpc(
            'refresh_comment_reputation',
            {
              p_user_id:
                data.user_id
            }
          );

        if (reputationError) {
          console.error(
            '[ADMIN COMMENTS] refresh_comment_reputation:',
            reputationError.message ||
              reputationError
          );
        }

      } catch (rpcError) {
        console.error(
          '[ADMIN COMMENTS] refresh_comment_reputation failed:',
          rpcError?.message ||
            rpcError
        );
      }

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
            .select(`
              action,
              resource_type,
              created_at
            `)
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
          .select(`
            content_type,
            content_id,
            score,
            rank
          `)
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
        /*
         * FIX:
         * RPC harus di-await terlebih dahulu.
         */
        try {
          const {
            error: intelligenceError
          } =
            await adminClient.rpc(
              'rebuild_article_intelligence'
            );

          if (intelligenceError) {
            console.error(
              '[TRENDING] rebuild_article_intelligence:',
              intelligenceError.message ||
                intelligenceError
            );
          }

        } catch (rpcError) {
          console.error(
            '[TRENDING] rebuild_article_intelligence failed:',
            rpcError?.message ||
              rpcError
          );
        }

        try {
          const {
            error: rebuildError
          } =
            await adminClient.rpc(
              'rebuild_trending'
            );

          if (rebuildError) {
            throw rebuildError;
          }

        } catch (rpcError) {
          console.error(
            '[TRENDING] rebuild_trending failed:',
            rpcError?.message ||
              rpcError
          );
        }

        ({
          data,
          error
        } =
          await adminClient
            .from(
              'trending_content'
            )
            .select(`
              content_type,
              content_id,
              score,
              rank
            `)
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
                .select(`
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
                `)
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
                .select(`
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
                `)
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
        .set(
          'X-BMI-Data-Mode',
          'configuration-required'
        )
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
   ADMIN LOGIN + BREAKING NEWS
   FINAL SECURE INTEGRATION
========================================================= */

app.post(
  '/api/admin/login',
  authLimiter,
  async (request, response) => {
    try {
      if (!adminClient) {
        return response.status(503).json({
          error: 'Admin service belum dikonfigurasi'
        });
      }

      const email = cleanText(request.body?.email, 320).toLowerCase();
      const password = String(request.body?.password || '');

      if (!email || !password) {
        return response.status(400).json({
          error: 'Email dan password wajib diisi'
        });
      }

      const { data, error } = await authClient
        .auth
        .signInWithPassword({ email, password });

      if (error || !data?.session || !data?.user) {
        return response.status(401).json({
          error: 'Login gagal'
        });
      }

      const {
        admin: adminRecord,
        error: adminError
      } = await getAdminRecord(data.user.id);

      if (
        adminError ||
        !adminRecord ||
        adminRecord.is_active !== true
      ) {
        return response.status(403).json({
          error: 'Akun berhasil login tetapi tidak memiliki akses admin aktif'
        });
      }

      response.json({
        ok: true,
        token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email
        },
        admin: adminRecord,
        role: adminRecord.role
      });

    } catch (error) {
      console.error('[ADMIN LOGIN]', error);

      response.status(500).json({
        error: 'Terjadi kesalahan pada login admin'
      });
    }
  }
);

/* =========================================================
   ADMIN SESSION / PROFILE
========================================================= */

app.get(
  '/api/admin/me',
  admin,
  async (request, response) => {
    response.json({
      ok: true,
      user: {
        id: request.user.id,
        email: request.user.email
      },
      admin: request.admin,
      role: request.role
    });
  }
);

/* =========================================================
   BREAKING CANDIDATES
========================================================= */

app.get(
  '/api/admin/breaking',
  admin,
  async (request, response) => {
    try {
      const limit = cleanLimit(request.query.limit, 500, 200);

      const { data, error } = await adminClient
        .from('breaking_candidates')
        .select('*')
        .eq('status', 'candidate')
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      response.json({
        ok: true,
        data: data || []
      });

    } catch (error) {
      console.error('[ADMIN BREAKING CANDIDATES]', error);

      response.status(500).json({
        error: error.message || 'Gagal mengambil breaking candidates'
      });
    }
  }
);

app.get(
  '/api/admin/breaking/candidates',
  admin,
  async (request, response) => {
    try {
      const limit = cleanLimit(request.query.limit, 500, 100);

      const { data, error } = await adminClient.rpc(
        'get_breaking_candidates',
        { p_limit: limit }
      );

      if (error) throw error;

      response.json({
        ok: true,
        data: data || []
      });

    } catch (error) {
      console.error('[ADMIN BREAKING RPC CANDIDATES]', error);

      response.status(500).json({
        error: error.message || 'Gagal mengambil breaking candidates'
      });
    }
  }
);

/* =========================================================
   APPROVE BREAKING
   Uses authenticated user's JWT so SQL RPC security remains
   the source of truth.
========================================================= */

app.post(
  '/api/admin/breaking/:id/approve',
  admin,
  async (request, response) => {
    try {
      const candidateId = cleanText(request.params.id, 64);
      const duration = cleanLimit(
        request.body?.duration_minutes,
        1440,
        120
      );

      const token = getBearerToken(request);
      const userSupabase = createUserSupabaseClient(token);

      if (!userSupabase) {
        return response.status(503).json({
          error: 'Supabase user client belum dikonfigurasi'
        });
      }

      const { data, error } = await userSupabase.rpc(
        'admin_approve_breaking',
        {
          p_candidate_id: candidateId,
          p_duration_minutes: duration
        }
      );

      if (error) {
        return response.status(400).json({
          error: error.message || 'Approve breaking gagal'
        });
      }

      response.json({
        ok: Boolean(data),
        approved: Boolean(data),
        candidate_id: candidateId,
        duration_minutes: duration,
        approved_by: request.user.id
      });

    } catch (error) {
      console.error('[ADMIN BREAKING APPROVE]', error);

      response.status(500).json({
        error: error.message || 'Approve breaking gagal'
      });
    }
  }
);

/* =========================================================
   REJECT BREAKING
========================================================= */

app.post(
  '/api/admin/breaking/:id/reject',
  admin,
  async (request, response) => {
    try {
      const candidateId = cleanText(request.params.id, 64);
      const reason = cleanText(
        request.body?.reason,
        1000
      ) || null;

      const token = getBearerToken(request);
      const userSupabase = createUserSupabaseClient(token);

      if (!userSupabase) {
        return response.status(503).json({
          error: 'Supabase user client belum dikonfigurasi'
        });
      }

      const { data, error } = await userSupabase.rpc(
        'admin_reject_breaking',
        {
          p_candidate_id: candidateId,
          p_reason: reason
        }
      );

      if (error) {
        return response.status(400).json({
          error: error.message || 'Reject breaking gagal'
        });
      }

      response.json({
        ok: Boolean(data),
        rejected: Boolean(data),
        candidate_id: candidateId,
        reason,
        rejected_by: request.user.id
      });

    } catch (error) {
      console.error('[ADMIN BREAKING REJECT]', error);

      response.status(500).json({
        error: error.message || 'Reject breaking gagal'
      });
    }
  }
);

/* =========================================================
   BACKWARD COMPATIBILITY PATCH ROUTE
   Only candidate/approved/rejected are allowed.
========================================================= */

app.patch(
  '/api/admin/breaking/:id',
  admin,
  async (request, response) => {
    const status = cleanText(request.body?.status, 30).toLowerCase();

    if (status === 'approved') {
      request.url = `/api/admin/breaking/${request.params.id}/approve`;
      return response.status(400).json({
        error: 'Gunakan POST /api/admin/breaking/:id/approve'
      });
    }

    if (status === 'rejected' || status === 'dismissed') {
      return response.status(400).json({
        error: 'Gunakan POST /api/admin/breaking/:id/reject'
      });
    }

    return response.status(400).json({
      error: 'Status breaking tidak dapat diubah langsung'
    });
  }
);

/* =========================================================
   ACTIVE BREAKING
========================================================= */

app.get(
  '/api/admin/breaking/active',
  admin,
  async (request, response) => {
    try {
      const { data, error } = await adminClient.rpc(
        'get_active_breaking_news'
      );

      if (error) throw error;

      response.json({
        ok: true,
        data: data || []
      });

    } catch (error) {
      console.error('[ADMIN ACTIVE BREAKING]', error);

      response.status(500).json({
        error: error.message || 'Gagal mengambil breaking aktif'
      });
    }
  }
);

/* =========================================================
   BREAKING HISTORY
========================================================= */

app.get(
  '/api/admin/breaking/history',
  admin,
  async (request, response) => {
    try {
      const limit = cleanLimit(request.query.limit, 500, 100);

      const { data, error } = await adminClient.rpc(
        'get_breaking_history',
        { p_limit: limit }
      );

      if (error) throw error;

      response.json({
        ok: true,
        data: data || []
      });

    } catch (error) {
      console.error('[ADMIN BREAKING HISTORY]', error);

      response.status(500).json({
        error: error.message || 'Gagal mengambil breaking history'
      });
    }
  }
);

/* =========================================================
   BREAKING ENGINE RUN NOW
========================================================= */

app.post(
  '/api/admin/breaking/run',
  admin,
  async (request, response) => {
    try {
      const { data, error } = await adminClient.rpc(
        'run_breaking_news_engine'
      );

      if (error) throw error;

      response.json({
        ok: true,
        data: data || []
      });

    } catch (error) {
      console.error('[ADMIN BREAKING ENGINE]', error);

      response.status(500).json({
        error: error.message || 'Gagal menjalankan breaking engine'
      });
    }
  }
);

/* =========================================================
   BREAKING HEALTH CHECK ALL-IN-ONE
========================================================= */

app.get(
  '/api/admin/breaking/health',
  admin,
  async (request, response) => {
    try {
      const [
        statusResult,
        activeResult,
        candidateResult,
        historyResult
      ] = await Promise.all([
        adminClient.rpc('get_breaking_system_status'),
        adminClient.rpc('get_active_breaking_news'),
        adminClient.rpc('get_breaking_candidates', { p_limit: 1 }),
        adminClient.rpc('get_breaking_history', { p_limit: 1 })
      ]);

      const errors = [
        statusResult.error,
        activeResult.error,
        candidateResult.error,
        historyResult.error
      ].filter(Boolean);

      if (errors.length) {
        throw errors[0];
      }

      response.json({
        ok: true,
        health: statusResult.data?.[0] || null,
        active_breaking_count: (activeResult.data || []).length,
        candidate_endpoint_ready: true,
        history_endpoint_ready: true,
        checked_at: new Date().toISOString()
      });

    } catch (error) {
      console.error('[ADMIN BREAKING HEALTH]', error);

      response.status(500).json({
        ok: false,
        error: error.message || 'Breaking health check gagal',
        checked_at: new Date().toISOString()
      });
    }
  }
);

/* =========================================================
   ADMIN DASHBOARD HEALTH ALL-IN-ONE
========================================================= */

app.get(
  '/api/admin/health',
  admin,
  async (request, response) => {
    try {
      const [
        breakingStatus,
        adminStatus
      ] = await Promise.all([
        adminClient.rpc('get_breaking_system_status'),
        getAdminRecord(request.user.id)
      ]);

      response.json({
        ok: !breakingStatus.error && !adminStatus.error,
        admin: {
          id: adminStatus.admin?.id || null,
          user_id: adminStatus.admin?.user_id || request.user.id,
          email: adminStatus.admin?.email || request.user.email,
          role: adminStatus.admin?.role || null,
          is_active: adminStatus.admin?.is_active === true
        },
        breaking: breakingStatus.data?.[0] || null,
        supabase_configured: Boolean(isSupabaseConfigured),
        service_role_available: Boolean(adminClient),
        checked_at: new Date().toISOString()
      });

    } catch (error) {
      console.error('[ADMIN HEALTH]', error);

      response.status(500).json({
        ok: false,
        error: error.message || 'Admin health check gagal'
      });
    }
  }
);

/* =========================================================
   ADMIN SYNC
========================================================= */
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
            ),

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
            .neq(
              'status',
              'published'
            ),

          adminClient
            .from('videos')
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
              'published'
            ),

          adminClient
            .from('news_events')
            .select(
              'id',
              {
                count:
                  'exact',
                head:
                  true
              }
            )
            .in(
              'status',
              [
                'active',
                'watch'
              ]
            )
        ]);

      const articles =
        articlesResult.data ||
        [];

      const totalViews =
        articles.reduce(
          (
            total,
            article
          ) =>
            total +
            Number(
              article.views ||
              0
            ),
          0
        );

      const totalLikes =
        articles.reduce(
          (
            total,
            article
          ) =>
            total +
            Number(
              article.likes ||
              0
            ),
          0
        );

      const totalShares =
        articles.reduce(
          (
            total,
            article
          ) =>
            total +
            Number(
              article.shares ||
              0
            ),
          0
        );

      response.json({
        articles:
          articles.length,

        drafts:
          draftsResult.count ||
          0,

        videos:
          videosResult.count ||
          0,

        events:
          eventsResult.count ||
          0,

        totalViews,

        totalLikes,

        totalShares
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
          .select(`
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
          `)
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
          .select(`
            id,
            target_url,
            active,
            starts_at,
            ends_at
          `)
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
            .select(`
              source,
              amount,
              currency,
              occurred_at,
              content_type,
              content_id
            `)
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
            .select(`
              id,
              title,
              partner_name,
              clicks,
              conversions,
              estimated_commission
            `)
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
            .select(`
              id,
              title,
              advertiser_name,
              impressions,
              clicks
            `)
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
        .select(`
          id,
          email,
          name,
          categories,
          status,
          created_at
        `)
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
   FIXED VERSION
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
          ok:
            false,

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
          ok:
            false,

          error:
            'Unauthorized'
        });
    }

    try {
      if (!adminClient) {
        throw new Error(
          'Supabase admin client belum dikonfigurasi'
        );
      }

      /*
       * STEP 1
       * Sync RSS feeds.
       */
      const result =
        await syncFeeds();

      /*
       * STEP 2
       * Rebuild intelligence.
       *
       * FIX UTAMA:
       * Tidak menggunakan:
       *
       * adminClient.rpc(...).catch(...)
       */
      let intelligenceError =
        null;

      try {
        const {
          error
        } =
          await adminClient.rpc(
            'rebuild_article_intelligence'
          );

        intelligenceError =
          error || null;

      } catch (error) {
        intelligenceError =
          error;
      }

      /*
       * Intelligence tidak harus
       * menghentikan sync utama.
       */
      if (intelligenceError) {
        console.error(
          '[CRON] rebuild_article_intelligence:',
          intelligenceError.message ||
          intelligenceError
        );
      }

      /*
       * STEP 3
       * Rebuild trending.
       */
      let trendingError =
        null;

      try {
        const {
          error
        } =
          await adminClient.rpc(
            'rebuild_trending'
          );

        trendingError =
          error || null;

      } catch (error) {
        trendingError =
          error;
      }

      if (trendingError) {
        console.error(
          '[CRON] rebuild_trending:',
          trendingError.message ||
          trendingError
        );
      }

      /*
       * STEP 4
       * Rebuild live events.
       */
      let liveEventsError =
        null;

      try {
        const {
          error
        } =
          await adminClient.rpc(
            'rebuild_live_events'
          );

        liveEventsError =
          error || null;

      } catch (error) {
        liveEventsError =
          error;
      }

      if (liveEventsError) {
        console.error(
          '[CRON] rebuild_live_events:',
          liveEventsError.message ||
          liveEventsError
        );
      }

      response.json({
        ok:
          true,

        result,

        intelligence:
          intelligenceError
            ? 'warning'
            : 'ok',

        trending:
          trendingError
            ? 'warning'
            : 'ok',

        liveEvents:
          liveEventsError
            ? 'warning'
            : 'ok',

        updatedAt:
          new Date()
            .toISOString()
      });

    } catch (error) {
      console.error(
        '[CRON SYNC]',
        error
      );

      response
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message ||
            'Sync gagal'
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
            .select(`
              id,
              published_at,
              updated_at
            `)
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
            .select(`
              id,
              created_at,
              updated_at
            `)
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
      if (!adminClient) {
        return response
          .status(503)
          .json({
            ok:
              false,

            version:
              '5.5.1',

            database:
              false,

            error:
              'Supabase admin client belum dikonfigurasi',

            time:
              new Date()
                .toISOString()
          });
      }

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
            .select(`
              status,
              finished_at,
              started_at
            `)
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
              '5.5.1',

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
          '5.5.1',

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
            '5.5.1',

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

  (
    request,
    response
  ) => {
    response.json({
      ok:
        true,

      supabaseConfigured:
        isSupabaseConfigured,

      missingEnvironmentVariables,

      message:
        isSupabaseConfigured
          ? 'Live data engine siap.'
          : 'Live data membutuhkan environment variables Supabase.'
    });
  }
);

app.get(
  '/health',
  healthHandler
);



/* =========================================================
   MUDA INDONESIA V19
   OWNER MONEY + RECONCILIATION + MEDIA INTELLIGENCE API
   Added to integrate migrations 021 and 022 with production.
========================================================= */

const validUuid = value =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(
      String(value || '')
    );

const parseOptionalBoolean = value => {
  if (
    value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1'
  ) {
    return true;
  }

  if (
    value === false ||
    value === 'false' ||
    value === 0 ||
    value === '0'
  ) {
    return false;
  }

  return null;
};

const getV19Overview = async () => {
  const [
    moneyResult,
    reconciliationResult,
    closeChecksResult,
    mediaResult,
    signalsResult
  ] = await Promise.all([
    adminClient
      .from('owner_money_ledger')
      .select(
        'id, canonical_key, reconciled, reconciliation_status',
        { count: 'exact' }
      ),

    adminClient
      .from('owner_money_reconciliations')
      .select(
        'id, period_start, period_end, status, variance_in, variance_out, created_at',
        { count: 'exact' }
      )
      .order(
        'created_at',
        { ascending: false }
      )
      .limit(50),

    adminClient
      .from('owner_finance_close_checks')
      .select(
        'id, period_month, check_key, label, required, passed',
        { count: 'exact' }
      )
      .order(
        'period_month',
        { ascending: false }
      )
      .limit(100),

    adminClient
      .from('owner_media_snapshots')
      .select('*')
      .order(
        'snapshot_at',
        { ascending: false }
      )
      .limit(1)
      .maybeSingle(),

    adminClient
      .from('owner_decision_signals')
      .select(
        'id, signal_key, area, severity, score, confidence, title, status, created_at',
        { count: 'exact' }
      )
      .eq(
        'status',
        'open'
      )
      .order(
        'created_at',
        { ascending: false }
      )
      .limit(50)
  ]);

  const firstError =
    moneyResult.error ||
    reconciliationResult.error ||
    closeChecksResult.error ||
    mediaResult.error ||
    signalsResult.error;

  if (firstError) {
    throw firstError;
  }

  const money =
    moneyResult.data ||
    [];

  const reconciliations =
    reconciliationResult.data ||
    [];

  const closeChecks =
    closeChecksResult.data ||
    [];

  const signals =
    signalsResult.data ||
    [];

  const requiredChecks =
    closeChecks.filter(
      item => item.required === true
    );

  const failedChecks =
    requiredChecks.filter(
      item => item.passed !== true
    );

  const openSignals =
    signals.filter(
      item => item.status === 'open'
    );

  return {
    ok: true,
    version: 'V19',
    generated_at:
      new Date().toISOString(),

    money: {
      total_records:
        moneyResult.count ??
        money.length,

      canonical_records:
        money.filter(
          item => Boolean(item.canonical_key)
        ).length,

      unreconciled_records:
        money.filter(
          item => item.reconciled !== true
        ).length
    },

    reconciliation: {
      total:
        reconciliationResult.count ??
        reconciliations.length,

      latest:
        reconciliations[0] ||
        null,

      variance_records:
        reconciliations.filter(
          item => item.status === 'variance'
        ).length
    },

    finance_close: {
      total_checks:
        closeChecksResult.count ??
        closeChecks.length,

      required_checks:
        requiredChecks.length,

      failed_required_checks:
        failedChecks.length,

      ready:
        failedChecks.length === 0
    },

    media: {
      latest_snapshot:
        mediaResult.data ||
        null
    },

    decisions: {
      open_signals:
        signalsResult.count ??
        openSignals.length,

      critical_signals:
        openSignals.filter(
          item => item.severity === 'critical'
        ).length,

      high_signals:
        openSignals.filter(
          item => item.severity === 'high'
        ).length
    }
  };
};

/* =========================================================
   V19 OVERVIEW
   GET /api/admin/owner/v19/overview
========================================================= */

app.get(
  '/api/admin/owner/v19/overview',

  admin,

  async (
    request,
    response
  ) => {
    try {
      response.json(
        await getV19Overview()
      );

    } catch (error) {
      console.error(
        '[V19] overview:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          error:
            error.message ||
            'Gagal memuat V19 overview'
        });
    }
  }
);

/* =========================================================
   V19 OWNER MONEY
   GET /api/admin/owner/money
========================================================= */

app.get(
  '/api/admin/owner/money',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const limit =
        cleanLimit(
          request.query.limit,
          500,
          100
        );

      const offset =
        Math.max(
          Number(
            request.query.offset ||
            0
          ) || 0,
          0
        );

      let query =
        adminClient
          .from('owner_money_ledger')
          .select(
            '*',
            { count: 'exact' }
          );

      const reconciled =
        parseOptionalBoolean(
          request.query.reconciled
        );

      if (
        reconciled !== null
      ) {
        query =
          query.eq(
            'reconciled',
            reconciled
          );
      }

      const status =
        cleanText(
          request.query.status,
          40
        );

      if (status) {
        query =
          query.eq(
            'reconciliation_status',
            status
          );
      }

      const {
        data,
        error,
        count
      } =
        await query
          .order(
            'created_at',
            { ascending: false }
          )
          .range(
            offset,
            offset + limit - 1
          );

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        total: count || 0,
        offset,
        limit,
        data: data || []
      });

    } catch (error) {
      console.error(
        '[V19] owner money:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 RECONCILIATIONS
   GET /api/admin/owner/reconciliations
========================================================= */

app.get(
  '/api/admin/owner/reconciliations',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const limit =
        cleanLimit(
          request.query.limit,
          200,
          50
        );

      let query =
        adminClient
          .from('owner_money_reconciliations')
          .select(
            '*',
            { count: 'exact' }
          );

      const status =
        cleanText(
          request.query.status,
          40
        );

      if (status) {
        query =
          query.eq(
            'status',
            status
          );
      }

      const {
        data,
        error,
        count
      } =
        await query
          .order(
            'period_end',
            { ascending: false }
          )
          .limit(limit);

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        total: count || 0,
        data: data || []
      });

    } catch (error) {
      console.error(
        '[V19] reconciliations:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 FINANCE CLOSE CHECKS
   GET /api/admin/owner/finance-close
========================================================= */

app.get(
  '/api/admin/owner/finance-close',

  admin,

  async (
    request,
    response
  ) => {
    try {
      let query =
        adminClient
          .from('owner_finance_close_checks')
          .select(
            '*',
            { count: 'exact' }
          );

      const periodMonth =
        cleanText(
          request.query.period_month,
          20
        );

      if (periodMonth) {
        query =
          query.eq(
            'period_month',
            periodMonth
          );
      }

      const {
        data,
        error,
        count
      } =
        await query
          .order(
            'period_month',
            { ascending: false }
          )
          .order(
            'check_key',
            { ascending: true }
          )
          .limit(200);

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        total: count || 0,
        data: data || []
      });

    } catch (error) {
      console.error(
        '[V19] finance close:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 FINANCE CLOSE CHECK UPDATE
   PATCH /api/admin/owner/finance-close/:id
========================================================= */

app.patch(
  '/api/admin/owner/finance-close/:id',

  admin,

  async (
    request,
    response
  ) => {
    try {
      if (
        !validUuid(
          request.params.id
        )
      ) {
        return response
          .status(400)
          .json({
            ok: false,
            error:
              'ID tidak valid'
          });
      }

      const body =
        request.body ||
        {};

      const payload =
        {};

      if (
        Object.prototype.hasOwnProperty.call(
          body,
          'passed'
        )
      ) {
        payload.passed =
          body.passed === true;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          body,
          'value'
        )
      ) {
        const value =
          Number(body.value);

        payload.value =
          Number.isFinite(value)
            ? value
            : null;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          body,
          'notes'
        )
      ) {
        payload.notes =
          cleanText(
            body.notes,
            3000
          ) || null;
      }

      payload.checked_at =
        new Date().toISOString();

      payload.checked_by =
        request.user.id;

      const {
        data,
        error
      } =
        await adminClient
          .from('owner_finance_close_checks')
          .update(payload)
          .eq(
            'id',
            request.params.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        data
      });

    } catch (error) {
      console.error(
        '[V19] finance close update:',
        error
      );

      response
        .status(400)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 MEDIA SNAPSHOTS
   GET /api/admin/owner/media-snapshots
========================================================= */

app.get(
  '/api/admin/owner/media-snapshots',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const limit =
        cleanLimit(
          request.query.limit,
          500,
          50
        );

      const {
        data,
        error,
        count
      } =
        await adminClient
          .from('owner_media_snapshots')
          .select(
            '*',
            { count: 'exact' }
          )
          .order(
            'snapshot_at',
            { ascending: false }
          )
          .limit(limit);

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        total: count || 0,
        data: data || []
      });

    } catch (error) {
      console.error(
        '[V19] media snapshots:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 DECISION SIGNALS
   GET /api/admin/owner/decision-signals
========================================================= */

app.get(
  '/api/admin/owner/decision-signals',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const limit =
        cleanLimit(
          request.query.limit,
          500,
          100
        );

      let query =
        adminClient
          .from('owner_decision_signals')
          .select(
            '*',
            { count: 'exact' }
          );

      const status =
        cleanText(
          request.query.status,
          40
        );

      const severity =
        cleanText(
          request.query.severity,
          40
        );

      const area =
        cleanText(
          request.query.area,
          100
        );

      if (status) {
        query =
          query.eq(
            'status',
            status
          );
      }

      if (severity) {
        query =
          query.eq(
            'severity',
            severity
          );
      }

      if (area) {
        query =
          query.eq(
            'area',
            area
          );
      }

      const {
        data,
        error,
        count
      } =
        await query
          .order(
            'created_at',
            { ascending: false }
          )
          .limit(limit);

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        total: count || 0,
        data: data || []
      });

    } catch (error) {
      console.error(
        '[V19] decision signals:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 DECISION SIGNAL UPDATE
   PATCH /api/admin/owner/decision-signals/:id
========================================================= */

app.patch(
  '/api/admin/owner/decision-signals/:id',

  admin,

  async (
    request,
    response
  ) => {
    try {
      if (
        !validUuid(
          request.params.id
        )
      ) {
        return response
          .status(400)
          .json({
            ok: false,
            error:
              'ID tidak valid'
          });
      }

      const allowedStatuses =
        [
          'open',
          'acknowledged',
          'resolved',
          'dismissed'
        ];

      const requestedStatus =
        cleanText(
          request.body?.status,
          40
        );

      if (
        !allowedStatuses.includes(
          requestedStatus
        )
      ) {
        return response
          .status(400)
          .json({
            ok: false,
            error:
              'Status tidak valid'
          });
      }

      const payload = {
        status:
          requestedStatus,

        resolved_at:
          requestedStatus === 'resolved'
            ? new Date().toISOString()
            : null
      };

      const {
        data,
        error
      } =
        await adminClient
          .from('owner_decision_signals')
          .update(payload)
          .eq(
            'id',
            request.params.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      response.json({
        ok: true,
        data
      });

    } catch (error) {
      console.error(
        '[V19] decision signal update:',
        error
      );

      response
        .status(400)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   V19 FUNCTIONAL HEALTH
   GET /api/admin/owner/v19/health
========================================================= */

app.get(
  '/api/admin/owner/v19/health',

  admin,

  async (
    request,
    response
  ) => {
    try {
      const tableNames = [
        'owner_money_ledger',
        'owner_money_reconciliations',
        'owner_finance_close_checks',
        'owner_media_snapshots',
        'owner_decision_signals'
      ];

      const results =
        await Promise.all(
          tableNames.map(
            tableName =>
              adminClient
                .from(tableName)
                .select(
                  'id',
                  {
                    head: true,
                    count: 'exact'
                  }
                )
          )
        );

      const tables = {};

      results.forEach(
        (
          result,
          index
        ) => {
          tables[
            tableNames[index]
          ] = {
            ok:
              !result.error,

            count:
              result.count || 0,

            error:
              result.error
                ? result.error.message
                : null
          };
        }
      );

      const failed =
        Object.values(tables)
          .filter(
            item => !item.ok
          );

      response
        .status(
          failed.length
            ? 503
            : 200
        )
        .json({
          ok:
            failed.length === 0,

          version:
            'V19',

          checked_at:
            new Date().toISOString(),

          tables
        });

    } catch (error) {
      console.error(
        '[V19] health:',
        error
      );

      response
        .status(500)
        .json({
          ok: false,
          version: 'V19',
          error:
            error.message
        });
    }
  }
);

/* =========================================================
   END V19 OWNER API
========================================================= */



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
    console.error(
      error
    );

    if (
      response.headersSent
    ) {
      return next(
        error
      );
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
   FIXED VERSION
========================================================= */

if (
  process.env.VERCEL !==
  '1'
) {
  app.listen(
    PORT,
    () => {
      console.log(
        `BERITA MUDA INDONESIA V5.5.1 running on :${PORT}`
      );
    }
  );

  const runCycle =
    async () => {
      if (
        !isSupabaseConfigured ||
        !adminClient
      ) {
        console.warn(
          'Sync cycle skipped: Supabase environment belum lengkap.'
        );

        return;
      }

      /*
       * RSS SYNC
       */
      try {
        await syncFeeds();

      } catch (error) {
        console.error(
          '[SYNC] syncFeeds:',
          error
        );
      }

      /*
       * ARTICLE INTELLIGENCE
       *
       * FIX:
       * Tidak menggunakan rpc(...).catch(...)
       */
      try {
        const {
          error
        } =
          await adminClient.rpc(
            'rebuild_article_intelligence'
          );

        if (error) {
          console.error(
            '[SYNC] rebuild_article_intelligence:',
            error.message ||
            error
          );
        }

      } catch (error) {
        console.error(
          '[SYNC] rebuild_article_intelligence failed:',
          error
        );
      }

      /*
       * TRENDING
       */
      try {
        const {
          error
        } =
          await adminClient.rpc(
            'rebuild_trending'
          );

        if (error) {
          console.error(
            '[SYNC] rebuild_trending:',
            error.message ||
            error
          );
        }

      } catch (error) {
        console.error(
          '[SYNC] rebuild_trending failed:',
          error
        );
      }

      /*
       * LIVE EVENTS
       */
      try {
        const {
          error
        } =
          await adminClient.rpc(
            'rebuild_live_events'
          );

        if (error) {
          console.error(
            '[SYNC] rebuild_live_events:',
            error.message ||
            error
          );
        }

      } catch (error) {
        console.error(
          '[SYNC] rebuild_live_events failed:',
          error
        );
      }
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
