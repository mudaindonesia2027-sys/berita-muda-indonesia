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
   MUDA V10 — OWNER MEDIA OPERATING SYSTEM
   Integrated control-plane routes. Insert before the 404 handler.
========================================================= */

const ownerWrite = async (request, response, next) => {
  if (request.role === 'super_admin' || request.role === 'owner' || request.role === 'admin') return next();
  return response.status(403).json({ error: 'Aksi Owner OS tidak diizinkan untuk role ini' });
};

const auditOwnerAction = async (request, action, resourceType, resourceId = null, metadata = {}) => {
  try {
    await adminClient.from('audit_logs').insert({
      actor_id: request.user?.id || null,
      actor_role: request.role || null,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata
    });
  } catch (error) {
    console.error('[OWNER OS AUDIT]', error?.message || error);
  }
};

const ownerScore = item => {
  const views = Number(item?.views || 0);
  const likes = Number(item?.likes || 0);
  const shares = Number(item?.shares || 0);
  const freshness = item?.published_at || item?.created_at;
  const ageHours = freshness ? Math.max(0, (Date.now() - new Date(freshness).getTime()) / 3600000) : 9999;
  const freshnessScore = Math.max(0, 100 - ageHours * 1.8);
  const engagement = Math.min(100, (likes * 2 + shares * 3) / Math.max(1, views) * 1000);
  const intelligence = Number(item?.intelligence_score || item?.importance_score || 0);
  return Math.round((Math.min(100, views / 1000) * 0.20 + engagement * 0.25 + freshnessScore * 0.20 + Math.min(100, intelligence) * 0.35) * 100) / 100;
};



const pct = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '0.0';
const ownerDecisionBrief = async () => {
  const [radar, sources, alerts, tasks, providers, articles] = await Promise.all([
    adminClient.from('breaking_candidates').select('id,title,score,status,detected_at,article_id').in('status',['candidate','approved']).order('score',{ascending:false}).limit(12),
    adminClient.from('news_sources').select('id,name,status,failure_count,last_success_at,last_latency_ms,active').order('failure_count',{ascending:false}).limit(20),
    adminClient.from('owner_alerts').select('id,severity,title,source,created_at,status').eq('status','open').order('created_at',{ascending:false}).limit(12),
    adminClient.from('owner_tasks').select('id,title,priority,status,due_at,task_type').in('status',['open','in_progress']).order('priority',{ascending:false}).limit(12),
    adminClient.from('integration_providers').select('provider_key,display_name,status,category,last_checked_at').order('display_name'),
    adminClient.from('articles').select('id,title,summary,category,views,likes,shares,published_at,intelligence_score,importance_score,status,featured,breaking').eq('status','published').order('published_at',{ascending:false}).limit(80)
  ]);
  for (const q of [radar,sources,alerts,tasks,providers,articles]) if (q.error) throw q.error;
  const ranked=(articles.data||[]).map(a=>({...a,owner_score:ownerScore(a)})).sort((a,b)=>b.owner_score-a.owner_score);
  const degraded=(sources.data||[]).filter(x=>x.active!==false && x.status && x.status!=='healthy');
  const highBreaking=(radar.data||[]).filter(x=>Number(x.score||0)>=80);
  const decisions=[];
  if (highBreaking.length) decisions.push({priority:100,kind:'editorial',title:`${highBreaking.length} kandidat breaking berisiko tinggi`,why:`Skor breaking tertinggi ${pct(highBreaking[0].score)}.`,action:'review_breaking',resource_id:highBreaking[0].article_id||null});
  if (degraded.length) decisions.push({priority:92,kind:'operations',title:`${degraded.length} source membutuhkan perhatian`,why:'Source health menunjukkan degradasi atau error.',action:'investigate_sources',resource_id:degraded[0]?.id||null});
  if (ranked[0]) decisions.push({priority:88,kind:'content',title:`Story opportunity: ${ranked[0].title}`,why:`Owner score ${pct(ranked[0].owner_score)} menggabungkan freshness, engagement, intelligence dan reach.`,action:'review_story',resource_id:ranked[0].id});
  if ((alerts.data||[]).length) decisions.push({priority:90,kind:'risk',title:`${alerts.data.length} alert terbuka`,why:'Alert perlu triage dan acknowledgment.',action:'open_alerts'});
  if ((tasks.data||[]).length) decisions.push({priority:80,kind:'governance',title:`${tasks.data.length} tugas Owner masih terbuka`,why:'Prioritas tertinggi perlu dituntaskan sebelum backlog tumbuh.',action:'open_tasks'});
  return {generated_at:new Date().toISOString(),confidence:Math.max(0,Math.min(100,Math.round(96-degraded.length*4-(alerts.data||[]).length*1.5))),headline:decisions[0]?.title||'Sistem stabil; tidak ada keputusan kritis baru.',decisions:decisions.sort((a,b)=>b.priority-a.priority).slice(0,8),top_story:ranked[0]||null,top_stories:ranked.slice(0,8),breaking_candidates:radar.data||[],degraded_sources:degraded,alerts:alerts.data||[],tasks:tasks.data||[],providers:providers.data||[]};
};
const ownerPerformanceSnapshot = async () => {
  const since=new Date(Date.now()-24*3600000).toISOString();
  const [articles,events]=await Promise.all([
    adminClient.from('articles').select('id,title,category,views,likes,shares,published_at,featured,breaking,intelligence_score,importance_score').eq('status','published').gte('published_at',since).order('published_at',{ascending:false}).limit(100),
    adminClient.from('analytics_events').select('event_type,content_type,content_id,session_id,created_at').gte('created_at',since).limit(5000)
  ]);
  if(articles.error) throw articles.error; if(events.error) throw events.error;
  const rows=articles.data||[], ev=events.data||[], totals={views:0,likes:0,shares:0};
  rows.forEach(r=>{totals.views+=Number(r.views||0);totals.likes+=Number(r.likes||0);totals.shares+=Number(r.shares||0)});
  const uniqueSessions=new Set(ev.map(x=>x.session_id).filter(Boolean)).size;
  const byType=ev.reduce((m,x)=>(m[x.event_type]=(m[x.event_type]||0)+1,m),{});
  const ranked=rows.map(a=>({...a,owner_score:ownerScore(a),engagement_rate:Number(a.views||0)?((Number(a.likes||0)+Number(a.shares||0))/Number(a.views||0))*100:0})).sort((a,b)=>b.owner_score-a.owner_score);
  return {generated_at:new Date().toISOString(),window:'24h',totals,unique_sessions:uniqueSessions,event_counts:byType,top_stories:ranked.slice(0,10)};
};
const ownerAudienceBrief = async () => {
  const since=new Date(Date.now()-24*3600000).toISOString();
  const {data,error}=await adminClient.from('analytics_events').select('event_type,content_type,content_id,session_id,path,referrer,created_at').gte('created_at',since).limit(10000);
  if(error) throw error;
  const rows=data||[], byType=rows.reduce((m,x)=>(m[x.event_type]=(m[x.event_type]||0)+1,m),{}), sessions=new Set(rows.map(x=>x.session_id).filter(Boolean));
  const refs={}; rows.forEach(x=>{if(x.referrer)refs[x.referrer]=(refs[x.referrer]||0)+1});
  return {generated_at:new Date().toISOString(),window:'24h',events:rows.length,unique_sessions:sessions.size,by_event:byType,top_referrers:Object.entries(refs).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([source,count])=>({source,count}))};
};
const ownerRevenueForecast = async () => {
  const since=new Date(Date.now()-30*86400000).toISOString();
  const {data,error}=await adminClient.from('revenue_entries').select('source,amount,currency,occurred_at').gte('occurred_at',since).order('occurred_at',{ascending:false}).limit(5000);
  if(error) throw error;
  const rows=data||[], total=rows.reduce((s,r)=>s+Number(r.amount||0),0), bySource={};
  rows.forEach(r=>{bySource[r.source]=(bySource[r.source]||0)+Number(r.amount||0)});
  return {generated_at:new Date().toISOString(),window:'30d',total,run_rate_30d:total,estimated_next_30d:total,by_source:Object.entries(bySource).map(([source,amount])=>({source,amount})).sort((a,b)=>b.amount-a.amount),confidence:rows.length?Math.min(92,55+Math.min(35,rows.length/20)):25};
};

app.get('/api/admin/owner/intelligence', admin, async (_request,response)=>{
  try{
    const [decision,performance,audience,revenue]=await Promise.all([ownerDecisionBrief(),ownerPerformanceSnapshot(),ownerAudienceBrief(),ownerRevenueForecast()]);
    const opportunity=Math.max(0,Math.min(100,Math.round((decision.top_story?.owner_score||0)*0.55 + Math.min(100,decision.breaking_candidates?.[0]?.score||0)*0.25 + Math.min(100,(performance.totals?.views||0)/1000)*0.20)));
    response.json({generated_at:new Date().toISOString(),opportunity_score:opportunity,decision,performance,audience,revenue});
  }catch(error){response.status(500).json({error:error.message||'Owner intelligence gagal'});}
});

app.post('/api/admin/owner/simulate', admin, async (request,response)=>{
  try{
    const id=cleanText(request.body?.article_id,120); if(!id) return response.status(400).json({error:'article_id wajib'});
    const {data,error}=await adminClient.from('articles').select('id,title,views,likes,shares,published_at,intelligence_score,importance_score,featured,breaking,status').eq('id',id).maybeSingle();
    if(error) throw error; if(!data) return response.status(404).json({error:'Artikel tidak ditemukan'});
    const base=ownerScore(data), projected=Math.min(100,base*1.12+6), confidence=Math.max(35,Math.min(95,Math.round(60+base*0.35))), views=Number(data.views||0);
    response.json({ok:true,article:data,simulation:{action:request.body?.action||'feature',current_score:base,projected_score:Math.round(projected*100)/100,projected_views_low:Math.round(views*1.08),projected_views_high:Math.round(views*1.32),projected_engagement:Math.min(99.9,(((Number(data.likes||0)+Number(data.shares||0)+1)/Math.max(1,views))*100*1.14)),confidence,risk:confidence>80?'low':'medium',assumptions:['freshness stable','audience demand comparable','homepage exposure increases visibility']}});
  }catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/decision', admin, async (_request,response)=>{
  try{response.json(await ownerDecisionBrief());}catch(error){response.status(500).json({error:error.message});}
});
app.get('/api/admin/owner/performance', admin, async (_request,response)=>{
  try{response.json(await ownerPerformanceSnapshot());}catch(error){response.status(500).json({error:error.message});}
});
app.get('/api/admin/owner/audience', admin, async (_request,response)=>{
  try{response.json(await ownerAudienceBrief());}catch(error){response.status(500).json({error:error.message});}
});
app.get('/api/admin/owner/revenue-forecast', admin, async (_request,response)=>{
  try{response.json(await ownerRevenueForecast());}catch(error){response.status(500).json({error:error.message});}
});
app.post('/api/admin/sources/:id/test', admin, ownerWrite, async (request,response)=>{
  try{const result=await testRssSource(request.params.id); await auditOwnerAction(request,'owner_source_test','news_source',request.params.id,{result}); response.json(result);}catch(error){response.status(400).json({error:error.message});}
});
app.get('/api/admin/owner/business-summary', admin, async (_request,response)=>{
  try{
    const [ads,affiliate,plans,members]=await Promise.all([
      adminClient.from('ad_campaigns').select('id,title,active,impressions,clicks,budget,spend,starts_at,ends_at,campaign_status').order('updated_at',{ascending:false}).limit(30),
      adminClient.from('affiliate_offers').select('id,title,partner_name,active,clicks,conversions,estimated_commission').order('updated_at',{ascending:false}).limit(30),
      adminClient.from('membership_plans').select('id,name,price,currency,active').order('price',{ascending:true}).limit(20),
      adminClient.from('user_memberships').select('id,status,plan_id,started_at,expires_at').order('started_at',{ascending:false}).limit(100)
    ]);
    response.json({ads:ads.data||[],affiliate:affiliate.data||[],membership_plans:plans.data||[],memberships:members.data||[]});
  }catch(error){response.status(500).json({error:error.message});}
});
app.get('/api/admin/owner/overview', admin, async (request, response) => {
  try {
    const [stats, system, breaking, events, trends, alerts, tasks, providers, sources] = await Promise.all([
      adminClient.from('articles').select('id,views,likes,shares,status', { count: 'exact' }),
      adminClient.from('system_events').select('id,severity,resolved_at', { count: 'exact', head: true }).is('resolved_at', null).in('severity', ['warning','error','critical']),
      adminClient.from('active_breaking_news').select('id', { count: 'exact', head: true }),
      adminClient.from('news_events').select('id', { count: 'exact', head: true }).in('status', ['active','watch']),
      adminClient.from('trending_content').select('content_type,content_id,score,rank').order('rank', { ascending: true }).limit(10),
      adminClient.from('owner_alerts').select('id,severity,title,source,created_at,status').eq('status','open').order('created_at', { ascending: false }).limit(8),
      adminClient.from('owner_tasks').select('id,title,task_type,priority,status,due_at,created_at').in('status',['open','in_progress']).order('priority', { ascending: false }).limit(8),
      adminClient.from('integration_providers').select('provider_key,display_name,category,status,last_checked_at').order('display_name'),
      adminClient.from('news_sources').select('id,name,status,failure_count,last_success_at,last_latency_ms,active').order('status')
    ]);

    for (const x of [stats, system, breaking, events, trends, alerts, tasks, providers, sources]) {
      if (x.error) throw x.error;
    }

    const articles = stats.data || [];
    const published = articles.filter(x => x.status === 'published');
    const totalViews = published.reduce((s, x) => s + Number(x.views || 0), 0);
    const totalLikes = published.reduce((s, x) => s + Number(x.likes || 0), 0);
    const totalShares = published.reduce((s, x) => s + Number(x.shares || 0), 0);

    const degradedSources = (sources.data || []).filter(x => x.status && x.status !== 'healthy' && x.active !== false).length;
    const providerHealth = (providers.data || []).map(p => p.status === 'active' ? 100 : p.status === 'degraded' ? 60 : 0);
    const avgProvider = providerHealth.length ? providerHealth.reduce((a,b)=>a+b,0) / providerHealth.length : 0;
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - (Number(system.count||0) * 8) - (degradedSources * 5) + avgProvider * 0.15)));

    response.json({
      generated_at: new Date().toISOString(),
      executive: {
        published_articles: published.length,
        total_articles: articles.length,
        total_views: totalViews,
        total_likes: totalLikes,
        total_shares: totalShares,
        active_breaking: breaking.count || 0,
        active_events: events.count || 0,
        health_score: healthScore,
        open_alerts: alerts.data?.length || 0,
        open_tasks: tasks.data?.length || 0,
        degraded_sources: degradedSources
      },
      alerts: alerts.data || [],
      tasks: tasks.data || [],
      providers: providers.data || [],
      sources: sources.data || [],
      trending: trends.data || []
    });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Owner overview gagal' });
  }
});

app.get('/api/admin/owner/radar', admin, async (request, response) => {
  try {
    const [breaking, events, trending, articles] = await Promise.all([
      adminClient.from('breaking_candidates').select('*').in('status',['candidate','approved']).order('score', { ascending:false }).limit(12),
      adminClient.from('news_events').select('*').in('status',['active','watch']).order('importance_score', { ascending:false }).limit(12),
      adminClient.from('trending_content').select('*').order('rank', { ascending:true }).limit(20),
      adminClient.from('articles').select('id,title,summary,image_url,category,views,likes,shares,published_at,created_at,author_name,intelligence_score,importance_score,status,event_key,breaking,featured').eq('status','published').order('published_at',{ascending:false}).limit(50)
    ]);
    for (const x of [breaking, events, trending, articles]) if (x.error) throw x.error;
    const ranked = (articles.data || []).map(x => ({ ...x, owner_score: ownerScore(x) })).sort((a,b) => b.owner_score - a.owner_score).slice(0,20);
    response.json({ breaking: breaking.data || [], events: events.data || [], trending: trending.data || [], ranked });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Intelligence radar gagal' });
  }
});

app.get('/api/admin/owner/providers', admin, async (_request, response) => {
  const { data, error } = await adminClient.from('integration_providers').select('*').order('display_name');
  if (error) return response.status(500).json({ error: error.message });
  response.json(data || []);
});

app.patch('/api/admin/owner/providers/:key', admin, ownerWrite, async (request, response) => {
  const allowed = ['active','degraded','not_configured','disabled','error'];
  const status = allowed.includes(request.body?.status) ? request.body.status : null;
  if (!status) return response.status(400).json({ error: 'Status provider tidak valid' });
  const { data, error } = await adminClient.from('integration_providers').update({ status, safe_metadata: request.body?.safe_metadata || {}, last_checked_at: new Date().toISOString() }).eq('provider_key', request.params.key).select().single();
  if (error) return response.status(400).json({ error: error.message });
  await auditOwnerAction(request, 'provider_status_changed', 'integration_provider', request.params.key, { status });
  response.json(data);
});

app.get('/api/admin/homepage/layouts', admin, async (_request, response) => {
  const { data, error } = await adminClient.from('homepage_layouts').select('*,homepage_layout_items(*)').order('updated_at',{ascending:false}).limit(20);
  if (error) return response.status(500).json({ error: error.message });
  response.json(data || []);
});

app.post('/api/admin/homepage/layouts', admin, ownerWrite, async (request, response) => {
  try {
    const body = request.body || {};
    const { data: layout, error: layoutError } = await adminClient.from('homepage_layouts').insert({
      name: cleanText(body.name || 'Untitled Layout', 120),
      status: ['draft','published','archived'].includes(body.status) ? body.status : 'draft',
      config: body.config || {},
      published_at: body.status === 'published' ? new Date().toISOString() : null,
      created_by: request.user.id
    }).select().single();
    if (layoutError) throw layoutError;
    const items = Array.isArray(body.items) ? body.items.map((item,index)=>({
      layout_id: layout.id,
      slot_key: cleanText(item.slot_key || 'main',80),
      content_type: ['article','video','event','ad','custom'].includes(item.content_type) ? item.content_type : 'article',
      content_id: cleanText(item.content_id || '',120) || null,
      rank: Number(item.rank ?? index),
      pin_mode: ['manual','intelligent','breaking','trending','sponsored'].includes(item.pin_mode) ? item.pin_mode : 'manual',
      enabled: item.enabled !== false,
      metadata: item.metadata || {}
    })) : [];
    if (items.length) {
      const { error: itemError } = await adminClient.from('homepage_layout_items').insert(items);
      if (itemError) throw itemError;
    }
    await auditOwnerAction(request, 'homepage_layout_created', 'homepage_layout', layout.id, { item_count: items.length });
    response.status(201).json({ ...layout, homepage_layout_items: items });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch('/api/admin/homepage/layouts/:id', admin, ownerWrite, async (request, response) => {
  try {
    const body = request.body || {};
    const patch = {};
    if (body.name !== undefined) patch.name = cleanText(body.name,120);
    if (body.status !== undefined && ['draft','published','archived'].includes(body.status)) {
      patch.status = body.status;
      patch.published_at = body.status === 'published' ? new Date().toISOString() : null;
    }
    if (body.config !== undefined) patch.config = body.config || {};
    const { data, error } = await adminClient.from('homepage_layouts').update(patch).eq('id',request.params.id).select().single();
    if (error) throw error;
    if (Array.isArray(body.items)) {
      const { error: delError } = await adminClient.from('homepage_layout_items').delete().eq('layout_id',request.params.id);
      if (delError) throw delError;
      const rows = body.items.map((item,index)=>({
        layout_id: request.params.id,
        slot_key: cleanText(item.slot_key || 'main',80),
        content_type: ['article','video','event','ad','custom'].includes(item.content_type) ? item.content_type : 'article',
        content_id: cleanText(item.content_id || '',120) || null,
        rank: Number(item.rank ?? index),
        pin_mode: ['manual','intelligent','breaking','trending','sponsored'].includes(item.pin_mode) ? item.pin_mode : 'manual',
        enabled: item.enabled !== false,
        metadata: item.metadata || {}
      }));
      if (rows.length) {
        const { error: insertError } = await adminClient.from('homepage_layout_items').insert(rows);
        if (insertError) throw insertError;
      }
    }
    await auditOwnerAction(request, 'homepage_layout_updated', 'homepage_layout', request.params.id, { status: patch.status || null });
    response.json(data);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/revisions', admin, async (request, response) => {
  const type = ['article','video'].includes(request.query.content_type) ? request.query.content_type : null;
  const id = cleanText(request.query.content_id,120);
  if (!type || !id) return response.status(400).json({ error:'content_type dan content_id wajib' });
  const { data, error } = await adminClient.from('content_revisions').select('*').eq('content_type',type).eq('content_id',id).order('version',{ascending:false}).limit(100);
  if (error) return response.status(500).json({ error:error.message });
  response.json(data || []);
});

app.post('/api/admin/revisions', admin, ownerWrite, async (request, response) => {
  try {
    const type = ['article','video'].includes(request.body?.content_type) ? request.body.content_type : null;
    const id = cleanText(request.body?.content_id,120);
    if (!type || !id || !request.body?.snapshot) return response.status(400).json({ error:'Snapshot revisi tidak lengkap' });
    const { data: last } = await adminClient.from('content_revisions').select('version').eq('content_type',type).eq('content_id',id).order('version',{ascending:false}).limit(1).maybeSingle();
    const version = Number(last?.version || 0) + 1;
    const { data, error } = await adminClient.from('content_revisions').insert({ content_type:type, content_id:id, version, snapshot:request.body.snapshot, change_summary:cleanText(request.body.change_summary,500)||null, created_by:request.user.id }).select().single();
    if (error) throw error;
    await auditOwnerAction(request, 'content_revision_created', type, id, { version });
    response.status(201).json(data);
  } catch (error) {
    response.status(400).json({ error:error.message });
  }
});

app.get('/api/admin/tasks', admin, async (request, response) => {
  let query = adminClient.from('owner_tasks').select('*').order('priority',{ascending:false}).order('created_at',{ascending:false}).limit(cleanLimit(request.query.limit,200,100));
  if (['open','in_progress','done','dismissed'].includes(request.query.status)) query = query.eq('status',request.query.status);
  const { data, error } = await query;
  if (error) return response.status(500).json({error:error.message});
  response.json(data || []);
});

app.post('/api/admin/tasks', admin, ownerWrite, async (request, response) => {
  const b = request.body || {};
  const { data, error } = await adminClient.from('owner_tasks').insert({
    title: cleanText(b.title,200),
    description: cleanText(b.description,3000)||null,
    task_type: ['manual','editorial','breaking','system','revenue','community','seo','automation'].includes(b.task_type) ? b.task_type : 'manual',
    priority: Math.min(100,Math.max(0,Number(b.priority)||50)),
    status: ['open','in_progress','done','dismissed'].includes(b.status) ? b.status : 'open',
    resource_type: cleanText(b.resource_type,80)||null,
    resource_id: cleanText(b.resource_id,120)||null,
    due_at: b.due_at || null,
    assigned_to: b.assigned_to || null,
    metadata: b.metadata || {},
    created_by: request.user.id
  }).select().single();
  if (error) return response.status(400).json({error:error.message});
  await auditOwnerAction(request,'owner_task_created','owner_task',data.id,{});
  response.status(201).json(data);
});

app.patch('/api/admin/tasks/:id', admin, ownerWrite, async (request, response) => {
  const allowed = ['open','in_progress','done','dismissed'];
  const patch = {};
  if (request.body?.status && allowed.includes(request.body.status)) patch.status = request.body.status;
  if (request.body?.priority !== undefined) patch.priority = Math.min(100,Math.max(0,Number(request.body.priority)||0));
  if (request.body?.title !== undefined) patch.title = cleanText(request.body.title,200);
  if (request.body?.description !== undefined) patch.description = cleanText(request.body.description,3000);
  const { data, error } = await adminClient.from('owner_tasks').update(patch).eq('id',request.params.id).select().single();
  if (error) return response.status(400).json({error:error.message});
  await auditOwnerAction(request,'owner_task_updated','owner_task',request.params.id,patch);
  response.json(data);
});

app.get('/api/admin/alerts', admin, async (request, response) => {
  let query = adminClient.from('owner_alerts').select('*').order('created_at',{ascending:false}).limit(cleanLimit(request.query.limit,200,100));
  if (['open','acknowledged','resolved','dismissed'].includes(request.query.status)) query = query.eq('status',request.query.status);
  const { data, error } = await query;
  if (error) return response.status(500).json({error:error.message});
  response.json(data || []);
});

app.patch('/api/admin/alerts/:id', admin, ownerWrite, async (request, response) => {
  const status = ['open','acknowledged','resolved','dismissed'].includes(request.body?.status) ? request.body.status : null;
  if (!status) return response.status(400).json({error:'Status alert tidak valid'});
  const patch = { status };
  if (status === 'acknowledged') patch.acknowledged_at = new Date().toISOString();
  if (status === 'resolved') patch.resolved_at = new Date().toISOString();
  const { data, error } = await adminClient.from('owner_alerts').update(patch).eq('id',request.params.id).select().single();
  if (error) return response.status(400).json({error:error.message});
  await auditOwnerAction(request,'owner_alert_updated','owner_alert',request.params.id,patch);
  response.json(data);
});

app.get('/api/admin/intelligence/content/:id', admin, async (request, response) => {
  try {
    const { data, error } = await adminClient.from('articles').select('*').eq('id',request.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return response.status(404).json({error:'Konten tidak ditemukan'});
    const score = ownerScore(data);
    const reasons = [];
    if (Number(data.views||0) > 1000) reasons.push('audience');
    if (Number(data.shares||0) > Number(data.likes||0)) reasons.push('share_velocity');
    if (Number(data.breaking||0) === 1 || data.breaking === true) reasons.push('breaking');
    if (Number(data.intelligence_score||0) >= 80) reasons.push('intelligence');
    response.json({ id:data.id, title:data.title, owner_score:score, reasons, freshness:data.published_at||data.created_at, intelligence_score:data.intelligence_score||data.importance_score||0, engagement:{views:Number(data.views||0),likes:Number(data.likes||0),shares:Number(data.shares||0)} });
  } catch (error) {
    response.status(500).json({error:error.message});
  }
});

app.get('/api/admin/seo/:type/:id', admin, async (request, response) => {
  const type = ['article','video'].includes(request.params.type) ? request.params.type : null;
  if (!type) return response.status(400).json({error:'Tipe SEO tidak valid'});
  const table = type === 'article' ? 'articles' : 'videos';
  const { data, error } = await adminClient.from(table).select('*').eq('id',request.params.id).maybeSingle();
  if (error) return response.status(500).json({error:error.message});
  if (!data) return response.status(404).json({error:'Konten tidak ditemukan'});
  const title = cleanText(data.title,160);
  const description = cleanText(data.summary || data.description || '',200);
  const score = Math.round(((title.length >= 30 ? 25 : 10) + (description.length >= 120 ? 25 : 10) + (data.image_url || data.thumbnail_url ? 20 : 0) + (data.canonical_url || data.url ? 15 : 0) + (data.author_name || data.source ? 15 : 0)));
  response.json({ content_type:type, content_id:data.id, title, description, canonical_url:data.canonical_url || data.url || null, image_url:data.image_url || data.thumbnail_url || null, author:data.author_name || data.source || null, seo_score:Math.min(100,score) });
});

app.get('/api/admin/sources', admin, async (_request, response) => {
  const { data, error } = await adminClient.from('news_sources').select('*').order('status').order('name');
  if (error) return response.status(500).json({error:error.message});
  response.json(data || []);
});

app.patch('/api/admin/sources/:id', admin, ownerWrite, async (request, response) => {
  const patch = {};
  if (request.body?.active !== undefined) patch.active = Boolean(request.body.active);
  if (request.body?.status && ['healthy','degraded','down','disabled'].includes(request.body.status)) patch.status = request.body.status;
  const { data, error } = await adminClient.from('news_sources').update(patch).eq('id',request.params.id).select().single();
  if (error) return response.status(400).json({error:error.message});
  await auditOwnerAction(request,'news_source_updated','news_source',request.params.id,patch);
  response.json(data);
});

app.get('/api/admin/automation/runs', admin, async (request, response) => {
  const { data, error } = await adminClient.from('automation_runs').select('*').order('created_at',{ascending:false}).limit(cleanLimit(request.query.limit,200,50));
  if (error) return response.status(500).json({error:error.message});
  response.json(data || []);
});


/* =========================================================
   MUDA V10.1 — UNIFIED OWNER COMMAND CENTER
   Deterministic, auditable, confirmation-aware actions.
========================================================= */

const ownerActionCatalog = {
  sync_news:{risk:'medium',confirm:false,minRole:'owner'}, run_breaking:{risk:'medium',confirm:false,minRole:'owner'},
  publish_article:{risk:'high',confirm:true,minRole:'owner'}, publish_video:{risk:'high',confirm:true,minRole:'owner'},
  archive_article:{risk:'medium',confirm:true,minRole:'owner'}, feature_article:{risk:'medium',confirm:false,minRole:'owner'}, unfeature_article:{risk:'low',confirm:false,minRole:'owner'},
  publish_homepage:{risk:'high',confirm:true,minRole:'owner'}, toggle_source:{risk:'high',confirm:true,minRole:'owner'}, moderate_comment:{risk:'medium',confirm:true,minRole:'owner'},
  ack_alert:{risk:'low',confirm:false,minRole:'owner'}, create_task:{risk:'low',confirm:false,minRole:'owner'}
};

const roleLevel = role => role === 'super_admin' ? 3 : role === 'owner' ? 2 : role === 'admin' ? 1 : 0;
const catalogRoleLevel = role => role === 'super_admin' ? 3 : role === 'owner' ? 2 : 1;
const ensureOwnerRole = (request, minRole='owner') => {
  if (roleLevel(request.role) < catalogRoleLevel(minRole)) throw new Error(`Role ${request.role || 'unknown'} tidak memiliki kewenangan untuk aksi ini`);
};

const getOwnerActionDefinition = async (intentKey) => {
  const { data, error } = await adminClient.from('owner_action_registry').select('*').eq('action_key', intentKey).maybeSingle();
  if (error) throw error;
  if (!data || data.enabled === false) throw new Error(`Aksi ${intentKey} tidak aktif`);
  ownerActionCatalog[intentKey] = { risk:data.risk_level, confirm:Boolean(data.requires_confirmation), minRole:data.min_role || 'owner' };
  return data;
};

const normalizeOwnerIntent = text => {
  const t=cleanText(text,1200).toLowerCase();
  const tests=[
    [/(sync|sinkron|refresh).*(berita|news|rss)/,'sync_news'], [/(breaking).*(jalan|run|start|aktif|proses)/,'run_breaking'],
    [/(buat|create).*(artikel|article)/,'create_article'], [/(edit|ubah|perbarui).*(artikel|article)/,'edit_article'],
    [/(jadwal|schedule).*(artikel|article)/,'schedule_article'], [/(publish|terbitkan|terbit).*(artikel|article)/,'publish_article'],
    [/(archive|arsipkan).*(artikel|article)/,'archive_article'], [/(restore|pulihkan).*(artikel|article)/,'restore_article'],
    [/(bulk).*(artikel|article).*(archive|arsip|publish)/,'bulk_article_status'],
    [/(buat|create).*(video)/,'create_video'], [/(edit|ubah|perbarui).*(video)/,'edit_video'], [/(publish|terbitkan|terbit).*(video)/,'publish_video'],
    [/(archive|arsipkan).*(video)/,'archive_video'], [/(restore|pulihkan).*(video)/,'restore_video'], [/(private|publik|public).*(video)/,'set_video_visibility'], [/(thumbnail).*(video)/,'set_thumbnail'],
    [/(buat|create).*(homepage|home page|layout)/,'create_homepage_layout'], [/(edit|ubah|perbarui).*(homepage|layout)/,'edit_homepage_layout'],
    [/(publish).*(homepage|layout)/,'publish_homepage'], [/(archive|arsipkan).*(homepage|layout)/,'archive_homepage'], [/(reorder|susun ulang).*(homepage)/,'reorder_homepage'],
    [/(approve|setujui).*(breaking)/,'approve_breaking'], [/(reject|tolak|dismiss).*(breaking)/,'reject_breaking'], [/(extend|perpanjang).*(breaking)/,'extend_breaking'],
    [/(rebuild|bangun ulang).*(intelligence)/,'rebuild_intelligence'], [/(rebuild|bangun ulang).*(trending)/,'rebuild_trending'], [/(rebuild|bangun ulang).*(live event|event)/,'rebuild_live_events'],
    [/(recommendation|rekomendasi).*(refresh|rebuild|bangun)/,'refresh_recommendations'], [/(seo).*(analy|anal|cek|check)/,'analyze_seo'], [/(seo).*(edit|ubah|metadata)/,'edit_seo'],
    [/(canonical)/,'set_canonical'], [/(noindex|index).*(artikel|article|video|konten)/,'set_indexing'], [/(sitemap).*(rebuild|bangun|refresh)/,'rebuild_sitemap'],
    [/(approve|setujui).*(komentar|comment)/,'approve_comment'], [/(hide|sembunyikan).*(komentar|comment)/,'hide_comment'], [/(block|blokir).*(komentar|comment)/,'block_comment'], [/(reputation)/,'refresh_reputation'],
    [/(newsletter).*(broadcast|kirim|send)/,'broadcast_newsletter'], [/(buat|create).*(ad campaign|campaign iklan)/,'create_ad_campaign'], [/(aktif|nonaktif|disable|enable).*(ad campaign|campaign iklan)/,'toggle_ad_campaign'],
    [/(catat|record).*(revenue|pendapatan)/,'record_revenue'], [/(buat|create).*(wallet)/,'create_wallet'], [/(catat|record).*(wallet|transaksi)/,'record_wallet_transaction'],
    [/(reconcile|rekonsil).*(wallet)/,'reconcile_wallet'], [/(request|minta).*(payout)/,'request_payout'], [/(approve|setujui).*(payout)/,'approve_payout'], [/(paid|bayar|lunas).*(payout)/,'mark_payout_paid'],
    [/(buat|create).*(automation|otomasi|rule)/,'create_automation_rule'], [/(aktif|nonaktif|disable|enable).*(automation|otomasi)/,'toggle_automation_rule'], [/(run|jalankan).*(automation|otomasi)/,'run_automation'], [/(cancel|batalkan).*(automation|otomasi)/,'cancel_automation'],
    [/(test|cek).*(source|sumber)/,'test_source'], [/(retry|coba lagi).*(source|sumber)/,'retry_source'], [/(reset).*(circuit|source)/,'reset_source_circuit'], [/(health|kesehatan).*(check|cek)/,'run_health_check'], [/(recovery|pulihkan).*(system|sistem)/,'recover_system'],
    [/(selesai|resolve).*(task|tugas)/,'resolve_task'], [/(restore|pulihkan).*(revision|revisi)/,'restore_revision'], [/(provider).*(health|cek)/,'provider_health_check'], [/(provider).*(ubah|change|aktif|disable)/,'provider_state_change'],
    [/(role admin|hak akses admin).*(ubah|change)/,'change_admin_role'], [/(nonaktifkan|deactivate).*(admin)/,'deactivate_admin'], [/(revoke|cabut).*(session|sesi)/,'revoke_admin_sessions'], [/(emergency|darurat).*(automation|otomasi|stop)/,'emergency_stop_automation'],
    [/(featured|unggulan|utama)/,'feature_article'], [/(unfeature|hapus featured)/,'unfeature_article'], [/(source|sumber).*(nonaktif|disable|matikan|aktif|enable)/,'toggle_source'],
    [/(komentar).*(approve|setujui|hide|sembunyikan|block|blokir)/,'moderate_comment'], [/(alert|peringatan).*(ack|akui|selesai)/,'ack_alert'], [/(task|tugas)/,'create_task']
  ];
  for(const [re,key] of tests) if(re.test(t)) return key;
  return null;
};

const recordOwnerCommand = async (request,inputText,intentKey,parsedPayload,status='accepted') => {
  const meta={input_text:cleanText(inputText,1200),intent_key:intentKey,parsed_payload:parsedPayload||{},risk_level:ownerActionCatalog[intentKey]?.risk||'low'};
  const {data,error}=await adminClient.from('owner_commands').insert({actor_id:request.user?.id||null,actor_role:request.role||null,input_text:meta.input_text,intent_key:intentKey,parsed_payload:meta.parsed_payload,risk_level:meta.risk_level,status,started_at:status==='running'?new Date().toISOString():null}).select().single();
  if(error) throw error;
  return data;
};

const finishOwnerCommand = async (id,status,result={},errorText=null) => { if(!id)return; await adminClient.from('owner_commands').update({status,result:result||{},error_text:errorText||null,finished_at:new Date().toISOString()}).eq('id',id); };
const auditAndReturn = async (request, action, resourceType, resourceId, metadata, result) => { await auditOwnerAction(request,action,resourceType,resourceId,metadata); return {ok:true,action,result}; };

const executeRpc = async (request,intentKey,names,payload={}) => {
  let last=null;
  for(const name of names){ try { const r=await adminClient.rpc(name,payload); if(!r.error) return await auditAndReturn(request,'owner_command_'+intentKey,'rpc',name,payload,r.data); last=r.error; } catch(e){ last=e; } }
  throw new Error(`RPC untuk ${intentKey} tidak tersedia/gagal: ${last?.message||'unknown error'}`);
};

const executeOwnerAction = async (request,intentKey,payload={}) => {
  const def=await getOwnerActionDefinition(intentKey);
  ensureOwnerRole(request,def.min_role||'owner');
  if(!def.enabled) throw new Error('Action disabled');
  if(intentKey==='sync_news'){
    const result=await syncFeeds();
    await auditOwnerAction(request,'owner_command_sync_news','sync',null,{mode:'app_engine'},result);
    return {ok:true,action:intentKey,result};
  }
  if(intentKey==='run_breaking') return executeRpc(request,intentKey,['run_breaking_pipeline','run_breaking_news_engine'],payload);
  if(intentKey==='rebuild_intelligence') return executeRpc(request,intentKey,['rebuild_article_intelligence'],payload);
  if(intentKey==='rebuild_trending') return executeRpc(request,intentKey,['rebuild_trending'],payload);
  if(intentKey==='rebuild_live_events') return executeRpc(request,intentKey,['rebuild_live_events'],payload);
  if(intentKey==='refresh_recommendations') return executeRpc(request,intentKey,['rebuild_recommendations','refresh_recommendations'],payload);
  if(intentKey==='run_health_check') return executeRpc(request,intentKey,['admin_health_check','health_check'],payload);
  if(intentKey==='rebuild_sitemap') return executeRpc(request,intentKey,['rebuild_sitemap'],payload);
  if(intentKey==='refresh_reputation') return executeRpc(request,intentKey,['refresh_comment_reputation'],payload);

  // --- Missing executor completion pack (V10.3) ---
  if(intentKey==='approve_breaking'){
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID candidate breaking wajib');
    const duration=cleanLimit(payload.duration_minutes,1440,120);
    const token=getBearerToken(request); const userSupabase=createUserSupabaseClient(token);
    if(!userSupabase) throw new Error('Supabase user client belum dikonfigurasi');
    const {data,error}=await userSupabase.rpc('admin_approve_breaking',{p_candidate_id:id,p_duration_minutes:duration});
    if(error) throw error;
    return auditAndReturn(request,'owner_command_approve_breaking','breaking_candidate',id,{duration_minutes:duration},data);
  }
  if(intentKey==='reject_breaking'){
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID candidate breaking wajib');
    const reason=cleanText(payload.reason,1000)||null;
    const token=getBearerToken(request); const userSupabase=createUserSupabaseClient(token);
    if(!userSupabase) throw new Error('Supabase user client belum dikonfigurasi');
    const {data,error}=await userSupabase.rpc('admin_reject_breaking',{p_candidate_id:id,p_reason:reason});
    if(error) throw error;
    return auditAndReturn(request,'owner_command_reject_breaking','breaking_candidate',id,{reason},data);
  }
  if(intentKey==='extend_breaking'){
    const id=cleanText(payload.id,120); const minutes=cleanLimit(payload.duration_minutes,1440,120);
    if(!id) throw new Error('ID breaking aktif wajib');
    const token=getBearerToken(request); const userSupabase=createUserSupabaseClient(token);
    if(!userSupabase) throw new Error('Supabase user client belum dikonfigurasi');
    const attempts=[
      ['extend_breaking_news',{p_breaking_id:id,p_duration_minutes:minutes}],
      ['extend_breaking_news',{p_id:id,p_duration_minutes:minutes}],
      ['extend_breaking',{p_breaking_id:id,p_duration_minutes:minutes}],
      ['extend_breaking',{p_id:id,p_duration_minutes:minutes}]
    ];
    let last=null;
    for(const [fn,args] of attempts){try{const r=await userSupabase.rpc(fn,args);if(!r.error)return auditAndReturn(request,'owner_command_extend_breaking','breaking_news',id,{duration_minutes:minutes,rpc:fn},r.data);last=r.error;}catch(e){last=e;}}
    throw new Error(`Extend breaking gagal: ${last?.message||'RPC tidak tersedia'}`);
  }

  if(intentKey==='analyze_seo'){
    const type=['article','video'].includes(cleanText(payload.type,30))?cleanText(payload.type,30):'article';
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID konten wajib');
    const table=type==='article'?'articles':'videos';
    const {data,error}=await adminClient.from(table).select('*').eq('id',id).maybeSingle(); if(error)throw error; if(!data)throw new Error('Konten tidak ditemukan');
    const title=cleanText(data.title,160), description=cleanText(data.summary||data.description||'',200);
    const checks={title:title.length>=30,description:description.length>=120,image:Boolean(data.image_url||data.thumbnail_url),canonical:Boolean(data.canonical_url||data.url),author:Boolean(data.author_name||data.source)};
    const score=Math.min(100,Math.round((Object.values(checks).filter(Boolean).length/Object.keys(checks).length)*100));
    return auditAndReturn(request,'owner_command_analyze_seo',type,id,{score}, {content_type:type,content_id:id,seo_score:score,checks,missing:Object.keys(checks).filter(k=>!checks[k])});
  }

  if(intentKey==='edit_seo'||intentKey==='set_canonical'||intentKey==='set_indexing'){
    const type=['article','video'].includes(cleanText(payload.type,30))?cleanText(payload.type,30):'article';
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID konten wajib');
    const table=type==='article'?'articles':'videos';
    const {data:current,error:readError}=await adminClient.from(table).select('*').eq('id',id).maybeSingle(); if(readError)throw readError; if(!current)throw new Error('Konten tidak ditemukan');
    const patch={};
    if(intentKey==='set_canonical'){
      const canonical=cleanText(payload.canonical_url,1500); if(!canonical) throw new Error('canonical_url wajib');
      if(!('canonical_url' in current)) throw new Error('Kolom canonical_url tidak tersedia pada tabel konten');
      patch.canonical_url=canonical;
    } else if(intentKey==='set_indexing'){
      const indexable=payload.indexable!==undefined?Boolean(payload.indexable):!Boolean(payload.noindex);
      if('noindex' in current) patch.noindex=!indexable;
      else if('indexable' in current) patch.indexable=indexable;
      else if('seo_noindex' in current) patch.seo_noindex=!indexable;
      else if('metadata' in current){ patch.metadata={...(current.metadata&&typeof current.metadata==='object'?current.metadata:{}),seo_noindex:!indexable}; }
      else throw new Error('Kolom indexing/noindex belum tersedia pada tabel konten');
    } else {
      const allow=['meta_title','meta_description','canonical_url','robots','og_title','og_description'];
      for(const k of allow) if(payload[k]!==undefined && k in current) patch[k]=typeof payload[k]==='string'?cleanText(payload[k],3000):payload[k];
      if(!Object.keys(patch).length) throw new Error('Tidak ada field SEO yang tersedia/diubah');
    }
    const {data,error}=await adminClient.from(table).update(patch).eq('id',id).select().single(); if(error)throw error;
    return auditAndReturn(request,'owner_command_'+intentKey,type,id,patch,data);
  }

  if(intentKey==='edit_homepage_layout'){
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID layout wajib');
    const patch={};
    if(payload.name!==undefined) patch.name=cleanText(payload.name,160);
    if(payload.config!==undefined) patch.config=payload.config&&typeof payload.config==='object'?payload.config:{};
    if(payload.status!==undefined && ['draft','published','archived'].includes(payload.status)) patch.status=payload.status;
    if(payload.status==='published') patch.published_at=new Date().toISOString();
    const {data,error}=await adminClient.from('homepage_layouts').update(patch).eq('id',id).select().single(); if(error)throw error;
    if(Array.isArray(payload.items)){
      for(const item of payload.items.slice(0,300)){
        if(!item?.id) continue;
        const ip={}; if(item.slot_key!==undefined)ip.slot_key=cleanText(item.slot_key,120); if(item.rank!==undefined)ip.rank=Math.max(0,Number(item.rank)||0); if(item.enabled!==undefined)ip.enabled=Boolean(item.enabled); if(item.pin_mode!==undefined && ['manual','intelligent','breaking','trending','sponsored'].includes(item.pin_mode))ip.pin_mode=item.pin_mode; if(item.metadata!==undefined)ip.metadata=item.metadata&&typeof item.metadata==='object'?item.metadata:{};
        if(Object.keys(ip).length) await adminClient.from('homepage_layout_items').update(ip).eq('id',item.id).eq('layout_id',id);
      }
    }
    return auditAndReturn(request,'owner_command_edit_homepage_layout','homepage_layout',id,{fields:Object.keys(patch),item_count:Array.isArray(payload.items)?payload.items.length:0},data);
  }

  if(intentKey==='create_ad_campaign'){
    const b=payload||{};
    const row={advertiser_name:cleanText(b.advertiser_name,200),title:cleanText(b.title,500),placement:cleanText(b.placement,50),image_url:cleanText(b.image_url,1500)||null,target_url:cleanText(b.target_url,1500),alt_text:cleanText(b.alt_text,300)||null,starts_at:b.starts_at||new Date().toISOString(),ends_at:b.ends_at||null,active:Boolean(b.active)};
    if(!row.title||!row.target_url) throw new Error('title dan target_url wajib');
    const {data,error}=await adminClient.from('ad_campaigns').insert(row).select().single(); if(error)throw error;
    return auditAndReturn(request,'owner_command_create_ad_campaign','ad_campaign',data.id,{},data);
  }
  if(intentKey==='toggle_ad_campaign'){
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID ad campaign wajib');
    const {data,error}=await adminClient.from('ad_campaigns').update({active:Boolean(payload.active),updated_at:new Date().toISOString()}).eq('id',id).select().single(); if(error)throw error;
    return auditAndReturn(request,'owner_command_toggle_ad_campaign','ad_campaign',id,{active:Boolean(payload.active)},data);
  }

  if(intentKey==='broadcast_newsletter'){
    const {data:subs,error:subError}=await adminClient.from('newsletter_subscribers').select('email,name,categories').eq('status','active'); if(subError)throw subError;
    const recipients=(subs||[]).map(s=>({email:s.email,name:s.name||null,categories:s.categories||[]}));
    const subject=cleanText(payload.subject,200); const body=cleanText(payload.body,15000);
    if(!subject||!body) throw new Error('subject dan body wajib');
    const webhook=cleanText(process.env.NEWSLETTER_WEBHOOK_URL,2000);
    if(!webhook) throw new Error(`Newsletter provider belum dikonfigurasi. ${recipients.length} subscriber aktif ditemukan; set NEWSLETTER_WEBHOOK_URL untuk mengaktifkan broadcast nyata.`);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
    let result;
    try{
      const r=await fetch(webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'muda-indonesia-owner-os',subject,body,recipients,requested_by:request.user?.id||null}),signal:controller.signal});
      const text=await r.text(); result={http_status:r.status,provider_response:text.slice(0,4000)}; if(!r.ok)throw new Error(`Newsletter webhook HTTP ${r.status}`);
    } finally {clearTimeout(timer);}
    return auditAndReturn(request,'owner_command_broadcast_newsletter','newsletter',null,{recipient_count:recipients.length,subject},result);
  }

  if(intentKey==='test_source'){
    const id=cleanText(payload.id,120); if(!id) throw new Error('ID source wajib');
    const {data:source,error}=await adminClient.from('news_sources').select('*').eq('id',id).maybeSingle(); if(error)throw error; if(!source)throw new Error('Source tidak ditemukan');
    const url=cleanText(payload.url,2000)||cleanText(source.url||source.feed_url||source.rss_url||source.xml_url,2000);
    if(!url) throw new Error('URL source tidak ditemukan');
    const started=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
    let status=0,contentType='';
    try{const r=await fetch(url,{headers:{'user-agent':'MUDA-Indonesia-OwnerOS/10.3'},redirect:'follow',signal:controller.signal});status=r.status;contentType=r.headers.get('content-type')||'';}
    finally{clearTimeout(timer);}
    const latency_ms=Date.now()-started; const ok=status>=200&&status<400;
    return auditAndReturn(request,'owner_command_test_source','news_source',id,{url,status,latency_ms},{ok,url,status,content_type:contentType,latency_ms});
  }

  if(intentKey==='recover_system'){
    const steps=[];
    for(const name of ['rebuild_article_intelligence','rebuild_trending','rebuild_live_events']){
      try{const r=await adminClient.rpc(name); steps.push({step:name,ok:!r.error,result:r.data||null,error:r.error?.message||null});}catch(e){steps.push({step:name,ok:false,error:e.message});}
    }
    const healthy=steps.every(s=>s.ok);
    await auditOwnerAction(request,'owner_command_recover_system','system',null,{steps,healthy});
    return {ok:healthy,action:intentKey,result:{steps,healthy}};
  }

  if(['publish_article','archive_article','feature_article','unfeature_article','restore_article'].includes(intentKey)){
    const id=cleanText(payload.id,120); if(!id)throw new Error('ID artikel wajib');
    const patch={};
    if(intentKey==='publish_article') {patch.status='published';patch.published_at=new Date().toISOString();}
    if(intentKey==='archive_article') patch.status='archived';
    if(intentKey==='restore_article') patch.status=['published','draft','archived'].includes(payload.status)?payload.status:'draft';
    if(intentKey==='feature_article') patch.featured=true;
    if(intentKey==='unfeature_article') patch.featured=false;
    const {data,error}=await adminClient.from('articles').update(patch).eq('id',id).select('id,title,status,featured,published_at').single(); if(error)throw error;
    return auditAndReturn(request,'owner_command_'+intentKey,'article',id,patch,data);
  }
  if(intentKey==='create_article'){
    const b=payload||{}; const row={title:cleanText(b.title,240),summary:cleanText(b.summary,4000)||null,content_html:typeof b.content_html==='string'?b.content_html:null,category:cleanText(b.category,120)||null,status:'draft',author_name:cleanText(b.author_name,180)||null,image_url:cleanText(b.image_url,1000)||null,canonical_url:cleanText(b.canonical_url,1000)||null};
    if(!row.title)throw new Error('title wajib'); const {data,error}=await adminClient.from('articles').insert(row).select().single(); if(error)throw error; return auditAndReturn(request,'owner_command_create_article','article',data.id,{fields:Object.keys(row)},data);
  }
  if(intentKey==='edit_article'){
    const id=cleanText(payload.id,120); if(!id)throw new Error('ID artikel wajib'); const allow=['title','summary','content_html','category','author_name','image_url','canonical_url','meta_title','meta_description','slug','featured']; const patch={}; for(const k of allow) if(payload[k]!==undefined) patch[k]=typeof payload[k]==='string'?cleanText(payload[k],k==='content_html'?120000:4000):payload[k]; if(!Object.keys(patch).length)throw new Error('Tidak ada field artikel yang diubah'); const {data,error}=await adminClient.from('articles').update(patch).eq('id',id).select().single(); if(error)throw error; return auditAndReturn(request,'owner_command_edit_article','article',id,{fields:Object.keys(patch)},data);
  }
  if(intentKey==='schedule_article'){
    const id=cleanText(payload.id,120); const at=payload.publish_at; if(!id||!at)throw new Error('ID dan publish_at wajib'); const {data,error}=await adminClient.from('scheduled_operations').insert({name:`Publish article ${id}`,action_key:'publish_article',cron_expression:null,timezone:cleanText(payload.timezone,80)||'Asia/Jakarta',enabled:true,payload:{id,publish_at:at},created_by:request.user.id,next_run_at:new Date(at).toISOString()}).select().single(); if(error)throw error; return auditAndReturn(request,'owner_command_schedule_article','article',id,{scheduled_operation_id:data.id},data);
  }
  if(intentKey==='bulk_article_status'){
    const ids=Array.isArray(payload.ids)?payload.ids.filter(Boolean).slice(0,100):[]; const status=['draft','published','archived'].includes(payload.status)?payload.status:null; if(!ids.length||!status)throw new Error('ids dan status wajib'); const patch={status}; if(status==='published')patch.published_at=new Date().toISOString(); const {data,error}=await adminClient.from('articles').update(patch).in('id',ids).select('id,status'); if(error)throw error; return auditAndReturn(request,'owner_command_bulk_article_status','article_bulk',null,{count:ids.length,status},data||[]);
  }

  if(['publish_video','archive_video','restore_video','set_video_visibility','set_thumbnail','create_video','edit_video'].includes(intentKey)){
    if(intentKey==='create_video'){const row={title:cleanText(payload.title,240),description:cleanText(payload.description,4000)||null,video_url:cleanText(payload.video_url,2000)||null,status:'draft',thumbnail_url:cleanText(payload.thumbnail_url,1000)||null}; if(!row.title)throw new Error('title video wajib'); const {data,error}=await adminClient.from('videos').insert(row).select().single(); if(error)throw error; return auditAndReturn(request,'owner_command_create_video','video',data.id,{},data);}
    const id=cleanText(payload.id,120); if(!id)throw new Error('ID video wajib'); const patch={}; if(intentKey==='publish_video'){patch.status='published';patch.published_at=new Date().toISOString();} if(intentKey==='archive_video')patch.status='archived'; if(intentKey==='restore_video')patch.status=['published','draft','archived'].includes(payload.status)?payload.status:'draft'; if(intentKey==='set_video_visibility'){ if('is_public' in payload)patch.is_public=Boolean(payload.is_public); else if('visibility' in payload)patch.visibility=payload.visibility; } if(intentKey==='set_thumbnail')patch.thumbnail_url=cleanText(payload.thumbnail_url,1000); if(intentKey==='edit_video'){ for(const k of ['title','description','video_url','thumbnail_url','category','canonical_url','meta_title','meta_description']) if(payload[k]!==undefined)patch[k]=typeof payload[k]==='string'?cleanText(payload[k],k==='description'?10000:2500):payload[k]; } if(!Object.keys(patch).length)throw new Error('Tidak ada field video yang diubah'); const {data,error}=await adminClient.from('videos').update(patch).eq('id',id).select().single(); if(error)throw error; return auditAndReturn(request,'owner_command_'+intentKey,'video',id,patch,data);
  }

  if(intentKey==='approve_comment'||intentKey==='hide_comment'||intentKey==='block_comment'||intentKey==='moderate_comment'){
    const id=cleanText(payload.id,120); if(!id)throw new Error('ID komentar wajib'); const status=intentKey==='approve_comment'?'approved':intentKey==='hide_comment'?'hidden':intentKey==='block_comment'?'blocked':cleanText(payload.status,30); if(!['approved','hidden','blocked'].includes(status))throw new Error('status komentar tidak valid'); const {data,error}=await adminClient.from('comments').update({status}).eq('id',id).select().single(); if(error)throw error; return auditAndReturn(request,'owner_command_'+intentKey,'comment',id,{status},data);
  }
  if(intentKey==='ack_alert'){const id=cleanText(payload.id,120);if(!id)throw new Error('ID alert wajib');const {data,error}=await adminClient.from('owner_alerts').update({status:'acknowledged',acknowledged_at:new Date().toISOString()}).eq('id',id).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_ack_alert','owner_alert',id,{},data);}
  if(intentKey==='create_task'){const {data,error}=await adminClient.from('owner_tasks').insert({title:cleanText(payload.title,200)||'Owner follow-up',description:cleanText(payload.description,3000)||null,task_type:['manual','editorial','breaking','system','revenue','community','seo','automation'].includes(payload.task_type)?payload.task_type:'manual',priority:Math.min(100,Math.max(0,Number(payload.priority)||50)),created_by:request.user.id}).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_create_task','owner_task',data.id,{},data);}
  if(intentKey==='resolve_task'){const id=cleanText(payload.id,120);if(!id)throw new Error('ID task wajib');const {data,error}=await adminClient.from('owner_tasks').update({status:'done',completed_at:new Date().toISOString()}).eq('id',id).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_resolve_task','owner_task',id,{},data);}

  if(['publish_homepage','archive_homepage','create_homepage_layout','edit_homepage_layout','reorder_homepage'].includes(intentKey)){
    if(intentKey==='create_homepage_layout'){const {data,error}=await adminClient.from('homepage_layouts').insert({name:cleanText(payload.name,120)||'Owner Layout',status:'draft',config:payload.config||{},created_by:request.user.id}).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_create_homepage_layout','homepage_layout',data.id,{},data);}
    const id=cleanText(payload.id,120);if(!id)throw new Error('ID layout wajib');
    if(intentKey==='publish_homepage'){await adminClient.from('homepage_layouts').update({status:'archived'}).eq('status','published').neq('id',id);}
    const patch=intentKey==='publish_homepage'?{status:'published',published_at:new Date().toISOString()}:intentKey==='archive_homepage'?{status:'archived'}:{config:payload.config||{}};
    const {data,error}=await adminClient.from('homepage_layouts').update(patch).eq('id',id).select().single();if(error)throw error;
    if(intentKey==='reorder_homepage'&&Array.isArray(payload.items)){for(const item of payload.items.slice(0,200)){await adminClient.from('homepage_layout_items').update({rank:Number(item.rank)||0,enabled:item.enabled!==false}).eq('id',item.id);}}
    return auditAndReturn(request,'owner_command_'+intentKey,'homepage_layout',id,{item_count:Array.isArray(payload.items)?payload.items.length:0},data);
  }
  if(intentKey==='toggle_source'||intentKey==='retry_source'||intentKey==='reset_source_circuit'){
    const id=cleanText(payload.id,120);if(!id)throw new Error('ID source wajib');const patch=intentKey==='toggle_source'?{active:Boolean(payload.active)}:{active:true,failure_count:0,status:'healthy',last_error:null};const {data,error}=await adminClient.from('news_sources').update(patch).eq('id',id).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_'+intentKey,'news_source',id,patch,data);
  }
  if(intentKey==='provider_state_change'){const key=cleanText(payload.provider_key,120);if(!key)throw new Error('provider_key wajib');const allowed=['active','degraded','not_configured','disabled','error'];if(!allowed.includes(payload.status))throw new Error('provider status tidak valid');const {data,error}=await adminClient.from('integration_providers').update({status:payload.status,last_checked_at:new Date().toISOString(),safe_metadata:payload.safe_metadata||{}}).eq('provider_key',key).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_provider_state_change','integration_provider',key,{status:payload.status},data);}
  if(intentKey==='provider_health_check'){const {data,error}=await adminClient.from('integration_providers').select('provider_key,display_name,status,last_checked_at,safe_metadata').order('display_name');if(error)throw error;return auditAndReturn(request,'owner_command_provider_health_check','integration_provider',null,{},data||[]);}

  if(intentKey==='record_revenue'){const row={source:cleanText(payload.source,50)||'other',amount:Number(payload.amount)||0,currency:cleanText(payload.currency,10)||'IDR',occurred_at:payload.occurred_at||new Date().toISOString(),content_type:cleanText(payload.content_type,50)||null,content_id:cleanText(payload.content_id,120)||null,campaign_id:cleanText(payload.campaign_id,120)||null,affiliate_offer_id:cleanText(payload.affiliate_offer_id,120)||null,notes:cleanText(payload.notes,4000)||null};if(row.amount<=0)throw new Error('amount harus > 0');const {data,error}=await adminClient.from('revenue_entries').insert(row).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_record_revenue','revenue_entry',data.id,{},data);}
  if(intentKey==='create_wallet'){const {data,error}=await adminClient.from('wallet_accounts').insert({owner_user_id:request.user.id,name:cleanText(payload.name,160)||'Owner Wallet',currency:cleanText(payload.currency,10)||'IDR'}).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_create_wallet','wallet',data.id,{},data);}
  if(intentKey==='record_wallet_transaction'){const b=payload||{};const amount=Number(b.amount)||0;if(amount<=0)throw new Error('amount harus > 0');const row={wallet_id:cleanText(b.wallet_id,120),direction:['credit','debit'].includes(b.direction)?b.direction:null,amount,currency:cleanText(b.currency,10)||'IDR',status:['pending','available','reversed'].includes(b.status)?b.status:'pending',source:cleanText(b.source,80)||'owner',provider:cleanText(b.provider,80)||null,external_reference:cleanText(b.external_reference,180)||null,category:['income','payout','expense','fee','adjustment','other'].includes(b.category)?b.category:'other',notes:cleanText(b.notes,4000)||null};if(!row.wallet_id||!row.direction)throw new Error('wallet_id dan direction wajib');const {data,error}=await adminClient.rpc('wallet_post_transaction',{p_wallet_id:row.wallet_id,p_direction:row.direction,p_amount:row.amount,p_status:row.status,p_source:row.source,p_provider:row.provider,p_external_reference:row.external_reference,p_category:row.category,p_description:row.description||null,p_occurred_at:row.occurred_at||new Date().toISOString(),p_available_at:row.available_at||null,p_metadata:row.metadata||{},p_created_by:request.user.id});if(error)throw error;return auditAndReturn(request,'owner_command_record_wallet_transaction','wallet_transaction',data?.id||null,{amount,direction:row.direction},data);}
  if(intentKey==='reconcile_wallet'){const walletId=cleanText(payload.wallet_id,120);if(!walletId)throw new Error('wallet_id wajib');const periodStart=payload.period_start||null,periodEnd=payload.period_end||null;let q=adminClient.from('wallet_transactions').select('direction,amount,status').eq('wallet_id',walletId);if(periodStart)q=q.gte('created_at',periodStart);if(periodEnd)q=q.lte('created_at',periodEnd);const {data:tx,error}=await q;if(error)throw error;const expectedCredit=(tx||[]).filter(x=>x.direction==='credit').reduce((s,x)=>s+Number(x.amount||0),0),expectedDebit=(tx||[]).filter(x=>x.direction==='debit').reduce((s,x)=>s+Number(x.amount||0),0);const row={wallet_id:walletId,provider:cleanText(payload.provider,100)||'internal',period_start:periodStart,period_end:periodEnd,expected_credit:expectedCredit,expected_debit:expectedDebit,actual_credit:Number(payload.actual_credit||expectedCredit),actual_debit:Number(payload.actual_debit||expectedDebit),variance:(Number(payload.actual_credit||expectedCredit)-expectedCredit)-(Number(payload.actual_debit||expectedDebit)-expectedDebit),status:'open',notes:cleanText(payload.notes,3000)||null,created_by:request.user.id};row.status=Math.abs(row.variance)<0.01?'matched':'investigate';const {data,error:insertError}=await adminClient.from('wallet_reconciliations').insert(row).select().single();if(insertError)throw insertError;return auditAndReturn(request,'owner_command_reconcile_wallet','wallet_reconciliation',data?.id||null,{},data);}
  if(intentKey==='request_payout'){const row={wallet_id:cleanText(payload.wallet_id,120),amount:Number(payload.amount)||0,status:'requested',notes:cleanText(payload.notes,2000)||null,method:cleanText(payload.method,80)||'manual_transfer',destination_label:cleanText(payload.destination_label,180)||null,currency:cleanText(payload.currency,10)||'IDR'};if(!row.wallet_id||row.amount<=0)throw new Error('wallet_id dan amount wajib');const {data,error}=await adminClient.from('wallet_payouts').insert(row).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_request_payout','wallet_payout',data.id,{},data);}
  if(intentKey==='approve_payout'||intentKey==='mark_payout_paid'){const id=cleanText(payload.id,120);if(!id)throw new Error('ID payout wajib');const status=intentKey==='approve_payout'?'approved':'paid';const patch={status}; if(status==='paid')patch.paid_at=new Date().toISOString(); const {data,error}=await adminClient.from('wallet_payouts').update(patch).eq('id',id).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_'+intentKey,'wallet_payout',id,patch,data);}
  if(intentKey==='emergency_stop_automation'){const {data,error}=await adminClient.from('scheduled_operations').update({enabled:false}).eq('enabled',true).select('id,name');if(error)throw error;return auditAndReturn(request,'owner_command_emergency_stop_automation','automation',null,{disabled_count:(data||[]).length},data||[]);}
  if(intentKey==='toggle_automation_rule'){const id=cleanText(payload.id,120);if(!id)throw new Error('ID automation wajib');const {data,error}=await adminClient.from('automation_rules').update({enabled:Boolean(payload.enabled)}).eq('id',id).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_toggle_automation_rule','automation_rule',id,{enabled:Boolean(payload.enabled)},data);}
  if(intentKey==='cancel_automation'){const id=cleanText(payload.id,120);if(!id)throw new Error('ID automation run wajib');const {data,error}=await adminClient.from('automation_runs').update({status:'skipped',finished_at:new Date().toISOString()}).eq('id',id).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_cancel_automation','automation_run',id,{},data);}
  if(intentKey==='run_automation'){const id=cleanText(payload.id,120);if(!id)throw new Error('ID automation wajib');const {data,error}=await adminClient.from('automation_runs').insert({rule_id:id,status:'running',started_at:new Date().toISOString(),input:payload.input||{}}).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_run_automation','automation_run',data.id,{rule_id:id},data);}
  if(intentKey==='create_automation_rule'){const b=payload||{};const {data,error}=await adminClient.from('automation_rules').insert({name:cleanText(b.name,180)||'Owner Automation',enabled:Boolean(b.enabled),trigger_type:cleanText(b.trigger_type,80)||'manual',conditions:b.conditions||{},actions:b.actions||{},cooldown_seconds:Math.max(0,Number(b.cooldown_seconds)||0)}).select().single();if(error)throw error;return auditAndReturn(request,'owner_command_create_automation_rule','automation_rule',data.id,{},data);}
  if(intentKey==='resolve_task'||intentKey==='restore_revision'||intentKey==='change_admin_role'||intentKey==='deactivate_admin'||intentKey==='revoke_admin_sessions'){
    throw new Error(`Aksi ${intentKey} membutuhkan adapter terisolasi dan belum diizinkan dieksekusi langsung oleh generic executor`);
  }
  throw new Error(`Aksi ${intentKey} belum memiliki executor adapter`);
};



// V11 owner copilot helpers: same command bus for typed + voice channels.
const createOwnerConversation = async (request, channel='dashboard', title=null) => {
  const {data,error}=await adminClient.from('owner_conversations').insert({actor_id:request.user?.id||null,channel,title,context:{}}).select().single();
  if(error) throw error;
  return data;
};

const updateOwnerConversationContext = async (id, patch={}) => {
  if(!id) return null;
  const {data,error}=await adminClient.from('owner_conversations').update({...patch,updated_at:new Date().toISOString()}).eq('id',id).select().maybeSingle();
  if(error) throw error;
  return data;
};

const buildOwnerPlan = async (request,inputText) => {
  const intent=normalizeOwnerIntent(inputText);
  if(!intent) return {ok:false,error:'Perintah belum dikenali'};
  const def=await getOwnerActionDefinition(intent);
  ensureOwnerRole(request,def.min_role||'owner');
  const plan={intent_key:intent,risk_level:def.risk_level||'low',confidence:0.82,requires_confirmation:Boolean(def.requires_confirmation)};
  const {data:planRow,error:planError}=await adminClient.from('owner_action_plans').insert({actor_id:request.user?.id||null,input_text:cleanText(inputText,1200),objective:{intent_key:intent,display_name:def.display_name},risk_level:plan.risk_level,status:plan.requires_confirmation?'confirming':'planned',confidence:plan.confidence,dry_run:true}).select().single();
  if(planError) throw planError;
  const {data:step,error:stepError}=await adminClient.from('owner_action_plan_steps').insert({plan_id:planRow.id,step_no:1,action_key:intent,payload:{},risk_level:plan.risk_level,status:'pending'}).select().single();
  if(stepError) throw stepError;
  return {ok:true,plan_id:planRow.id,intent_key:intent,risk_level:plan.risk_level,confidence:plan.confidence,requires_confirmation:plan.requires_confirmation,steps:[step]};
};

app.get('/api/admin/owner/copilot/brief', admin, async (request,response)=>{
  try {
    const [insights,alerts,tasks,system]=await Promise.all([
      adminClient.from('owner_insights').select('*').eq('status','open').order('priority',{ascending:false}).limit(12),
      adminClient.from('owner_alerts').select('*').eq('status','open').order('created_at',{ascending:false}).limit(12),
      adminClient.from('owner_tasks').select('*').in('status',['open','pending','in_progress']).order('priority',{ascending:false}).limit(12),
      adminClient.from('news_sources').select('id,name,status,failure_count').neq('status','healthy').order('failure_count',{ascending:false}).limit(10)
    ]);
    response.json({ok:true,insights:insights.data||[],alerts:alerts.data||[],tasks:tasks.data||[],degraded_sources:system.data||[]});
  } catch(error){ response.status(500).json({error:error.message}); }
});

app.post('/api/admin/owner/copilot/plan', admin, ownerWrite, async (request,response)=>{
  try { const text=cleanText(request.body?.text,1200); if(!text) return response.status(400).json({error:'text wajib'}); response.json(await buildOwnerPlan(request,text)); }
  catch(error){ response.status(400).json({error:error.message}); }
});

app.get('/api/admin/owner/copilot/plan/:id', admin, async (request,response)=>{
  try {
    const [plan,steps]=await Promise.all([
      adminClient.from('owner_action_plans').select('*').eq('id',request.params.id).maybeSingle(),
      adminClient.from('owner_action_plan_steps').select('*').eq('plan_id',request.params.id).order('step_no')
    ]);
    if(plan.error) throw plan.error; if(steps.error) throw steps.error; if(!plan.data) return response.status(404).json({error:'Plan tidak ditemukan'});
    response.json({plan:plan.data,steps:steps.data||[]});
  } catch(error){response.status(500).json({error:error.message});}
});

app.post('/api/admin/owner/conversations', admin, ownerWrite, async (request,response)=>{
  try { response.status(201).json(await createOwnerConversation(request,cleanText(request.body?.channel,30)||'dashboard',cleanText(request.body?.title,160)||null)); }
  catch(error){response.status(400).json({error:error.message});}
});

app.patch('/api/admin/owner/conversations/:id', admin, ownerWrite, async (request,response)=>{
  try { response.json(await updateOwnerConversationContext(request.params.id,{context:request.body?.context||{},last_intent_key:cleanText(request.body?.last_intent_key,80)||null,last_resource_type:cleanText(request.body?.last_resource_type,80)||null,last_resource_id:cleanText(request.body?.last_resource_id,120)||null})); }
  catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/undo', admin, async (request,response)=>{
  const {data,error}=await adminClient.from('owner_action_undo').select('*').eq('status','available').order('created_at',{ascending:false}).limit(50);
  if(error) return response.status(500).json({error:error.message}); response.json(data||[]);
});

app.get('/api/admin/owner/voice/session', admin, async (request,response)=>{
  const {data,error}=await adminClient.from('voice_sessions').select('*').eq('actor_id',request.user?.id||null).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(error) return response.status(500).json({error:error.message}); response.json(data||null);
});

app.post('/api/admin/owner/voice/session', admin, ownerWrite, async (request,response)=>{
  try {
    const {data,error}=await adminClient.from('voice_sessions').insert({actor_id:request.user?.id||null,locale:cleanText(request.body?.locale,20)||'id-ID',provider:cleanText(request.body?.provider,40)||'browser',status:cleanText(request.body?.status,30)||'processing',conversation_id:request.body?.conversation_id||null,last_transcript:cleanText(request.body?.transcript,1200)||null,last_response:cleanText(request.body?.response,3000)||null}).select().single();
    if(error) throw error; response.status(201).json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/command-actions', admin, async (_request,response)=>{
  const {data,error}=await adminClient.from('owner_action_registry').select('*').order('category').order('display_name');
  if(error) return response.status(500).json({error:error.message});
  response.json(data||[]);
});

app.get('/api/admin/owner/commands', admin, async (request,response)=>{
  const {data,error}=await adminClient.from('owner_commands').select('*').order('created_at',{ascending:false}).limit(cleanLimit(request.query.limit,200,80));
  if(error) return response.status(500).json({error:error.message});
  response.json(data||[]);
});

app.post('/api/admin/owner/command', admin, ownerWrite, async (request,response)=>{
  const input=cleanText(request.body?.text,1200);
  const intent=cleanText(request.body?.intent_key,80)||normalizeOwnerIntent(input);
  const payload=(request.body?.payload && typeof request.body.payload==='object')?request.body.payload:{};
  if(!intent) return response.status(400).json({error:'Perintah belum dikenali. Gunakan aksi yang tersedia di Command Center.'});
  const def=await getOwnerActionDefinition(intent);
  ensureOwnerRole(request,def.min_role||'owner');
  const confirmed=Boolean(request.body?.confirmed);
  const command=await recordOwnerCommand(request,input||intent,intent,payload,def.requires_confirmation && !confirmed ? 'needs_confirmation':'running');
  if(def.requires_confirmation && !confirmed) return response.json({requires_confirmation:true,command_id:command?.id,intent_key:intent,risk_level:def.risk_level, min_role:def.min_role||'owner', message:'Aksi memerlukan konfirmasi Owner sebelum dieksekusi.'});
  try {
    const result=await executeOwnerAction(request,intent,payload);
    await finishOwnerCommand(command?.id,'success',result,null);
    response.json({requires_confirmation:false,command_id:command?.id,...result});
  } catch(error) {
    await finishOwnerCommand(command?.id,'failed',{},error.message);
    response.status(400).json({error:error.message,command_id:command?.id});
  }
});

app.post('/api/admin/owner/command/:id/confirm', admin, ownerWrite, async (request,response)=>{
  const {data,error}=await adminClient.from('owner_commands').select('*').eq('id',request.params.id).maybeSingle();
  if(error) return response.status(500).json({error:error.message});
  if(!data) return response.status(404).json({error:'Command tidak ditemukan'});
  if(data.status!=='needs_confirmation') return response.status(400).json({error:'Command tidak menunggu konfirmasi'});
  const def=await getOwnerActionDefinition(data.intent_key);
  ensureOwnerRole(request,def.min_role||'owner');
  try {
    await adminClient.from('owner_commands').update({status:'running',started_at:new Date().toISOString()}).eq('id',data.id);
    const result=await executeOwnerAction(request,data.intent_key,data.parsed_payload||{});
    await finishOwnerCommand(data.id,'success',result,null);
    response.json({ok:true,command_id:data.id,...result});
  } catch(error) {
    await finishOwnerCommand(data.id,'failed',{},error.message);
    response.status(400).json({error:error.message,command_id:data.id});
  }
});

app.get('/api/admin/wallet/summary', admin, async (_request,response)=>{
  const {data,error}=await adminClient.from('owner_wallet_summary').select('*').limit(100);
  if(error) return response.status(500).json({error:error.message});
  response.json(data||[]);
});

app.get('/api/admin/wallet/transactions', admin, async (request,response)=>{
  let q=adminClient.from('wallet_transactions').select('*').order('created_at',{ascending:false}).limit(cleanLimit(request.query.limit,300,120));
  if(request.query.wallet_id) q=q.eq('wallet_id',cleanText(request.query.wallet_id,120));
  const {data,error}=await q; if(error) return response.status(500).json({error:error.message}); response.json(data||[]);
});

app.get('/api/admin/wallet/payouts', admin, async (request,response)=>{
  const {data,error}=await adminClient.from('wallet_payouts').select('*').order('created_at',{ascending:false}).limit(cleanLimit(request.query.limit,200,80));
  if(error) return response.status(500).json({error:error.message}); response.json(data||[]);
});

app.get('/api/admin/schedules', admin, async (_request,response)=>{
  const {data,error}=await adminClient.from('scheduled_operations').select('*').order('created_at',{ascending:false});
  if(error) return response.status(500).json({error:error.message}); response.json(data||[]);
});

app.post('/api/admin/schedules', admin, ownerWrite, async (request,response)=>{
  const b=request.body||{};
  const {data,error}=await adminClient.from('scheduled_operations').insert({
    name:cleanText(b.name,200), action_key:cleanText(b.action_key,80), cron_expression:cleanText(b.cron_expression,120)||null,
    timezone:cleanText(b.timezone,80)||'Asia/Jakarta', enabled:Boolean(b.enabled), payload:b.payload||{}, created_by:request.user.id
  }).select().single();
  if(error) return response.status(400).json({error:error.message});
  await auditOwnerAction(request,'schedule_created','scheduled_operation',data.id,{}); response.status(201).json(data);
});

app.patch('/api/admin/schedules/:id', admin, ownerWrite, async (request,response)=>{
  const p={}; if(request.body?.enabled!==undefined)p.enabled=Boolean(request.body.enabled); if(request.body?.cron_expression!==undefined)p.cron_expression=cleanText(request.body.cron_expression,120)||null;
  if(request.body?.payload!==undefined)p.payload=request.body.payload||{};
  const {data,error}=await adminClient.from('scheduled_operations').update(p).eq('id',request.params.id).select().single();
  if(error)return response.status(400).json({error:error.message}); await auditOwnerAction(request,'schedule_updated','scheduled_operation',request.params.id,p); response.json(data);
});

app.get('/api/public/homepage/live', async (_request,response)=>{
  const {data:layout,error}=await adminClient.from('homepage_layouts').select('id,name,status,config,published_at,homepage_layout_items(*)').eq('status','published').order('published_at',{ascending:false,nullsLast:true}).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(error) return response.status(500).json({error:error.message});
  if(!layout) return response.json({layout:null,items:[]});
  const items=[];
  for(const item of (layout.homepage_layout_items||[]).filter(x=>x.enabled).sort((a,b)=>(a.rank||0)-(b.rank||0))){
    let content=null;
    if(item.content_type==='article' && item.content_id){ const r=await adminClient.from('articles').select('id,title,summary,image_url,category,published_at,featured,views,likes,shares,author_name,status').eq('id',item.content_id).maybeSingle(); content=r.data||null; }
    if(item.content_type==='video' && item.content_id){ const r=await adminClient.from('videos').select('*').eq('id',item.content_id).maybeSingle(); content=r.data||null; }
    if(item.content_type==='event' && item.content_id){ const r=await adminClient.from('news_events').select('*').eq('id',item.content_id).maybeSingle(); content=r.data||null; }
    items.push({...item,content});
  }
  response.json({layout:{id:layout.id,name:layout.name,config:layout.config,published_at:layout.published_at},items});
});





/* =========================================================
   V18 — OWNER FINANCE ADMINISTRATION
   Editable money ledger, receivables/payables, accounts,
   recurring plans, monthly close and management reports.
========================================================= */

const OWNER_LEDGER_ENTRY_TYPES = ['ad_revenue','sponsor','affiliate','subscription','video','other_revenue','expense','ad_spend','people','technology','operations','tax','capital','fee','other'];
const OWNER_MONEY_STATUSES = ['draft','planned','approved','settled','void'];
const OWNER_FIN_STATUSES = ['draft','open','partial','paid','cancelled','overdue'];
const cleanMoney = (value, fallback=0) => { const n=Number(value); return Number.isFinite(n)?n:fallback; };
const isoDate = (value, fallback=null) => { const d=new Date(value||''); return Number.isNaN(d.getTime()) ? fallback : d.toISOString(); };

async function ownerFinanceAdminData(periodStart=null, periodEnd=null){
  const start = periodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const end = periodEnd || new Date().toISOString();
  const [accounts, ledger, receivables, payables, recurring, closes, revenue, expenses, budgets] = await Promise.all([
    v14SafeQuery(()=>adminClient.from('owner_money_accounts').select('*').eq('active',true).order('name')),
    v14SafeQuery(()=>adminClient.from('owner_money_ledger').select('*').gte('occurred_at',start).lte('occurred_at',end).order('occurred_at',{ascending:false}).limit(2000)),
    v14SafeQuery(()=>adminClient.from('owner_money_receivables').select('*').order('due_at',{ascending:true,nullsLast:true}).limit(500)),
    v14SafeQuery(()=>adminClient.from('owner_money_payables').select('*').order('due_at',{ascending:true,nullsLast:true}).limit(500)),
    v14SafeQuery(()=>adminClient.from('owner_money_recurring_rules').select('*').eq('active',true).order('next_run',{ascending:true,nullsLast:true}).limit(200)),
    v14SafeQuery(()=>adminClient.from('owner_money_monthly_closes').select('*').order('period_month',{ascending:false}).limit(24)),
    v14SafeQuery(()=>adminClient.from('revenue_entries').select('id,source,amount,currency,occurred_at,campaign_id,affiliate_offer_id').gte('occurred_at',start).lte('occurred_at',end).order('occurred_at',{ascending:false}).limit(3000)),
    v14SafeQuery(()=>adminClient.from('owner_expenses').select('id,category,vendor,description,amount,currency,status,due_at,paid_at,created_at').gte('created_at',start).lte('created_at',end).order('created_at',{ascending:false}).limit(3000)),
    v14SafeQuery(()=>adminClient.from('owner_budgets').select('*').order('period_end',{ascending:false}).limit(200))
  ]);

  const ledgerRows = ledger.data || [];
  const legacyRevenue = revenue.data || [];
  const legacyExpenses = expenses.data || [];
  const inflow = ledgerRows.filter(x=>x.direction==='inflow' && x.status!=='void').reduce((a,x)=>a+cleanMoney(x.amount),0) + legacyRevenue.reduce((a,x)=>a+cleanMoney(x.amount),0);
  const outflow = ledgerRows.filter(x=>x.direction==='outflow' && x.status!=='void').reduce((a,x)=>a+cleanMoney(x.amount),0) + legacyExpenses.filter(x=>['approved','paid'].includes(x.status)).reduce((a,x)=>a+cleanMoney(x.amount),0);
  const net = inflow-outflow;
  const openAR = (receivables.data||[]).filter(x=>['open','partial','overdue'].includes(x.status)).reduce((a,x)=>a+cleanMoney(x.amount),0);
  const openAP = (payables.data||[]).filter(x=>['open','partial','overdue'].includes(x.status)).reduce((a,x)=>a+cleanMoney(x.amount),0);
  const overdueAR = (receivables.data||[]).filter(x=>x.status==='overdue').reduce((a,x)=>a+cleanMoney(x.amount),0);
  const overdueAP = (payables.data||[]).filter(x=>x.status==='overdue').reduce((a,x)=>a+cleanMoney(x.amount),0);
  const bySource = {};
  for(const x of legacyRevenue){ const k=x.source||'other'; bySource[k]=(bySource[k]||0)+cleanMoney(x.amount); }
  for(const x of ledgerRows.filter(x=>x.direction==='inflow')){ const k=x.source||x.entry_type||'other'; bySource[k]=(bySource[k]||0)+cleanMoney(x.amount); }
  const byCategory = {};
  for(const x of legacyExpenses){ const k=x.category||'other'; byCategory[k]=(byCategory[k]||0)+cleanMoney(x.amount); }
  for(const x of ledgerRows.filter(x=>x.direction==='outflow')){ const k=x.category||x.entry_type||'other'; byCategory[k]=(byCategory[k]||0)+cleanMoney(x.amount); }
  const annualMonths={};
  for(let i=0;i<12;i++){
    const d=new Date(new Date().getFullYear(),i,1); const k=d.toISOString().slice(0,7);
    annualMonths[k]={month:k,inflow:0,outflow:0,net:0};
  }
  for(const x of legacyRevenue){ const k=String(x.occurred_at||'').slice(0,7); if(annualMonths[k]) annualMonths[k].inflow += cleanMoney(x.amount); }
  for(const x of legacyExpenses.filter(x=>['approved','paid'].includes(x.status))){ const k=String(x.paid_at||x.created_at||'').slice(0,7); if(annualMonths[k]) annualMonths[k].outflow += cleanMoney(x.amount); }
  for(const x of ledgerRows.filter(x=>x.status!=='void')){ const k=String(x.occurred_at||'').slice(0,7); if(annualMonths[k]) x.direction==='inflow'?annualMonths[k].inflow+=cleanMoney(x.amount):annualMonths[k].outflow+=cleanMoney(x.amount); }
  Object.values(annualMonths).forEach(x=>x.net=x.inflow-x.outflow);
  return {period:{start,end},accounts:accounts.data||[],ledger:ledgerRows,receivables:receivables.data||[],payables:payables.data||[],recurring:recurring.data||[],closes:closes.data||[],budgets:budgets.data||[],summary:{inflow,outflow,net,openAR,openAP,overdueAR,overdueAP,margin:inflow?net/inflow*100:0,bySource,byCategory,months:Object.values(annualMonths)}};
}

app.get('/api/admin/owner/finance/admin', admin, async (request,response)=>{
  try { response.json({ok:true,generated_at:new Date().toISOString(),finance:await ownerFinanceAdminData(request.query.start,request.query.end)}); }
  catch(error){ response.status(500).json({error:error.message}); }
});

app.post('/api/admin/owner/finance/ledger', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{}, amount=cleanMoney(b.amount); if(amount<=0) throw new Error('amount harus > 0');
    const direction=b.direction==='outflow'?'outflow':'inflow';
    const status=OWNER_MONEY_STATUSES.includes(b.status)?b.status:'planned';
    const row={direction,entry_type:cleanText(b.entry_type,80)||'other',source:cleanText(b.source,120)||null,category:cleanText(b.category,120)||null,account_id:cleanText(b.account_id,120)||null,cost_center_id:cleanText(b.cost_center_id,120)||null,counterparty:cleanText(b.counterparty,180)||null,description:cleanText(b.description,1000)||null,amount,tax_amount:Math.max(0,cleanMoney(b.tax_amount)),currency:cleanText(b.currency,10)||'IDR',status,occurred_at:isoDate(b.occurred_at,new Date().toISOString()),due_at:isoDate(b.due_at,null),settled_at:status==='settled'?isoDate(b.settled_at,new Date().toISOString()):null,recurring:Boolean(b.recurring),recurrence_rule:cleanText(b.recurrence_rule,120)||null,external_reference:cleanText(b.external_reference,180)||null,source_record_type:cleanText(b.source_record_type,80)||null,source_record_id:cleanText(b.source_record_id,120)||null,notes:cleanText(b.notes,2000)||null,created_by:request.user.id};
    const {data,error}=await adminClient.from('owner_money_ledger').insert(row).select().single(); if(error) throw error;
    await auditOwnerAction(request,'finance_ledger_created','owner_money_ledger',data.id,{direction,amount,entry_type:row.entry_type}); response.status(201).json(data);
  }catch(error){response.status(400).json({error:error.message});}
});

app.patch('/api/admin/owner/finance/ledger/:id', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{}, patch={updated_at:new Date().toISOString()};
    for(const k of ['direction','entry_type','source','category','counterparty','description','currency','status','recurrence_rule','external_reference','source_record_type','notes']) if(b[k]!==undefined) patch[k]=cleanText(b[k],2000)||null;
    for(const k of ['account_id','cost_center_id','source_record_id']) if(b[k]!==undefined) patch[k]=cleanText(b[k],120)||null;
    if(b.amount!==undefined) patch.amount=cleanMoney(b.amount);
    if(b.tax_amount!==undefined) patch.tax_amount=Math.max(0,cleanMoney(b.tax_amount));
    if(b.occurred_at!==undefined) patch.occurred_at=isoDate(b.occurred_at,null);
    if(b.due_at!==undefined) patch.due_at=isoDate(b.due_at,null);
    if(b.settled_at!==undefined) patch.settled_at=isoDate(b.settled_at,null);
    if(b.recurring!==undefined) patch.recurring=Boolean(b.recurring);
    const {data,error}=await adminClient.from('owner_money_ledger').update(patch).eq('id',request.params.id).select().single(); if(error) throw error;
    await auditOwnerAction(request,'finance_ledger_updated','owner_money_ledger',request.params.id,patch); response.json(data);
  }catch(error){response.status(400).json({error:error.message});}
});

app.delete('/api/admin/owner/finance/ledger/:id', admin, ownerWrite, async (request,response)=>{
  try { const {data,error}=await adminClient.from('owner_money_ledger').update({status:'void',updated_at:new Date().toISOString()}).eq('id',request.params.id).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_ledger_voided','owner_money_ledger',request.params.id,{}); response.json(data); }
  catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/account', admin, ownerWrite, async (request,response)=>{
  try { const b=request.body||{}; const {data,error}=await adminClient.from('owner_money_accounts').insert({name:cleanText(b.name,160),account_type:cleanText(b.account_type,40)||'cash',currency:cleanText(b.currency,10)||'IDR',opening_balance:cleanMoney(b.opening_balance),notes:cleanText(b.notes,1000)||null,created_by:request.user.id}).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_account_created','owner_money_account',data.id,{}); response.status(201).json(data); }
  catch(error){response.status(400).json({error:error.message});}
});

app.patch('/api/admin/owner/finance/account/:id', admin, ownerWrite, async (request,response)=>{
  try { const b=request.body||{}, patch={updated_at:new Date().toISOString()}; for(const k of ['name','account_type','currency','notes']) if(b[k]!==undefined) patch[k]=cleanText(b[k],500)||null; if(b.opening_balance!==undefined) patch.opening_balance=cleanMoney(b.opening_balance); if(b.active!==undefined) patch.active=Boolean(b.active); const {data,error}=await adminClient.from('owner_money_accounts').update(patch).eq('id',request.params.id).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_account_updated','owner_money_account',request.params.id,patch); response.json(data); }
  catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/receivable', admin, ownerWrite, async (request,response)=>{
  try { const b=request.body||{}, amount=cleanMoney(b.amount); if(amount<=0) throw new Error('amount harus > 0'); const {data,error}=await adminClient.from('owner_money_receivables').insert({counterparty:cleanText(b.counterparty,180)||null,description:cleanText(b.description,500),source:cleanText(b.source,120)||null,invoice_number:cleanText(b.invoice_number,120)||null,amount,currency:cleanText(b.currency,10)||'IDR',issued_at:b.issued_at||new Date().toISOString().slice(0,10),due_at:b.due_at||null,status:OWNER_FIN_STATUSES.includes(b.status)?b.status:'open',expected_at:b.expected_at||null,received_at:b.received_at||null,external_reference:cleanText(b.external_reference,180)||null,notes:cleanText(b.notes,1000)||null,created_by:request.user.id}).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_receivable_created','owner_money_receivable',data.id,{amount}); response.status(201).json(data); }
  catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/payable', admin, ownerWrite, async (request,response)=>{
  try { const b=request.body||{}, amount=cleanMoney(b.amount); if(amount<=0) throw new Error('amount harus > 0'); const {data,error}=await adminClient.from('owner_money_payables').insert({counterparty:cleanText(b.counterparty,180)||null,description:cleanText(b.description,500),category:cleanText(b.category,120)||'other',invoice_number:cleanText(b.invoice_number,120)||null,amount,currency:cleanText(b.currency,10)||'IDR',issued_at:b.issued_at||new Date().toISOString().slice(0,10),due_at:b.due_at||null,status:OWNER_FIN_STATUSES.includes(b.status)?b.status:'open',expected_at:b.expected_at||null,paid_at:b.paid_at||null,external_reference:cleanText(b.external_reference,180)||null,notes:cleanText(b.notes,1000)||null,created_by:request.user.id}).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_payable_created','owner_money_payable',data.id,{amount}); response.status(201).json(data); }
  catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/close-month', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{}, month=String(b.period_month||'').slice(0,7); if(!/^\d{4}-\d{2}$/.test(month)) throw new Error('period_month format YYYY-MM');
    const start=`${month}-01T00:00:00.000Z`; const d=new Date(start); d.setUTCMonth(d.getUTCMonth()+1); const end=d.toISOString();
    const f=await ownerFinanceAdminData(start,end); const payload={period_month:`${month}-01`,status:'closed',revenue:f.summary.inflow,expense:f.summary.outflow,net:f.summary.net,notes:cleanText(b.notes,2000)||null,closed_by:request.user.id,closed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    const {data,error}=await adminClient.from('owner_money_monthly_closes').upsert(payload,{onConflict:'period_month'}).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_month_closed','owner_money_monthly_close',data.id,{month}); response.json(data);
  }catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/finance/report.csv', admin, async (request,response)=>{
  try { const f=await ownerFinanceAdminData(request.query.start,request.query.end); const rows=[['Month','Inflow','Outflow','Net']]; for(const x of f.summary.months) rows.push([x.month,x.inflow,x.outflow,x.net]); rows.push(['TOTAL',f.summary.inflow,f.summary.outflow,f.summary.net]); response.setHeader('content-type','text/csv; charset=utf-8'); response.setHeader('content-disposition','attachment; filename="muda-owner-finance-report.csv"'); response.send(rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')); }
  catch(error){response.status(500).json({error:error.message});}
});

async function ownerMoneyIntelligence() {
  const [snap, revenue, expenses, budgets, capital, wallets, payouts, ads, affiliate] = await Promise.all([
    v14SafeQuery(()=>adminClient.from('owner_money_snapshot').select('*').maybeSingle()),
    v14SafeQuery(()=>adminClient.from('revenue_entries').select('source,amount,currency,occurred_at,campaign_id,affiliate_offer_id').gte('occurred_at',new Date(Date.now()-30*86400000).toISOString()).order('occurred_at',{ascending:false}).limit(5000)),
    v14SafeQuery(()=>adminClient.from('owner_expenses').select('id,category,vendor,description,amount,currency,status,due_at,paid_at,recurring,cost_center_id').order('created_at',{ascending:false}).limit(500)),
    v14SafeQuery(()=>adminClient.from('owner_budgets').select('id,name,cost_center_id,period_start,period_end,amount,spent,status').eq('status','active').order('period_end',{ascending:true}).limit(100)),
    v14SafeQuery(()=>adminClient.from('owner_capital_events').select('event_type,counterparty,amount,currency,occurred_at,notes').order('occurred_at',{ascending:false}).limit(200)),
    v14SafeQuery(()=>adminClient.from('owner_wallet_summary').select('*').limit(100)),
    v14SafeQuery(()=>adminClient.from('wallet_payouts').select('id,wallet_id,amount,currency,status,method,destination_label,requested_at,approved_at,paid_at').order('requested_at',{ascending:false}).limit(100)),
    v14SafeQuery(()=>adminClient.from('ad_campaigns').select('id,title,advertiser_name,active,impressions,clicks,budget,spend,starts_at,ends_at,campaign_status').order('updated_at',{ascending:false}).limit(60)),
    v14SafeQuery(()=>adminClient.from('affiliate_offers').select('id,title,partner_name,active,clicks,conversions,estimated_commission').order('updated_at',{ascending:false}).limit(60))
  ]);
  const rRows=revenue.data||[], eRows=expenses.data||[], bRows=budgets.data||[], cRows=capital.data||[];
  const bySource={}; for(const r of rRows) bySource[r.source]=(bySource[r.source]||0)+Number(r.amount||0);
  const revenue30=Number(snap.data?.revenue_30d||0), expenses30=Number(snap.data?.expenses_30d||0), upcoming=Number(snap.data?.upcoming_expenses_30d||0), cash=Number(snap.data?.available_cash||0);
  const net30=revenue30-expenses30, avgDailyBurn=Math.max(expenses30/30,0), avgDailyRevenue=Math.max(revenue30/30,0);
  const runway=avgDailyBurn>0?cash/(avgDailyBurn*30):null;
  const margin=revenue30>0?(net30/revenue30)*100:null;
  const adRows=ads.data||[], adBudget=adRows.reduce((a,x)=>a+Number(x.budget||0),0), adSpend=adRows.reduce((a,x)=>a+Number(x.spend||0),0), adClicks=adRows.reduce((a,x)=>a+Number(x.clicks||0),0), adImp=adRows.reduce((a,x)=>a+Number(x.impressions||0),0);
  const affiliateRows=affiliate.data||[], affiliateExpected=affiliateRows.reduce((a,x)=>a+Number(x.estimated_commission||0)*Number(x.conversions||0),0);
  const dueSoon=eRows.filter(x=>x.status==='planned'||x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0);
  const budgetUtil=bRows.map(b=>({...b,utilization:Number(b.amount)>0?(Number(b.spent||0)/Number(b.amount))*100:0,variance:Number(b.amount||0)-Number(b.spent||0)})).sort((a,b)=>b.utilization-a.utilization);
  const decisions=[];
  if (runway!==null && runway<2) decisions.push({severity:'critical',title:'Cash runway pendek',reason:`Runway kira-kira ${runway.toFixed(1)} bulan. Tahan pengeluaran discretionary dan prioritaskan penerimaan.`});
  if (upcoming>cash*0.7 && cash>0) decisions.push({severity:'high',title:'Kewajiban 30 hari berat',reason:'Upcoming expenses mendekati sebagian besar cash tersedia. Review due date dan prioritas pembayaran.'});
  if (revenue30>0 && margin<20) decisions.push({severity:'high',title:'Margin perlu perhatian',reason:`Margin 30 hari sekitar ${margin.toFixed(1)}%. Evaluasi cost center dan revenue mix.`});
  if (adBudget>0 && adSpend/adBudget>0.85) decisions.push({severity:'medium',title:'Ad budget mendekati batas',reason:`Spend ${((adSpend/adBudget)*100).toFixed(1)}% dari budget kampanye aktif.`});
  if (!decisions.length) decisions.push({severity:'low',title:'Cash position relatif terkendali',reason:'Tidak ada red flag utama dari cash, expense, atau budget signal yang tersedia.'});
  return {
    snapshot:snap.data||{}, revenue:{days30:revenue30,days7:Number(snap.data?.revenue_7d||0),days1:Number(snap.data?.revenue_1d||0),net30,margin,bySource,runRateMonth:revenue30,avgDailyRevenue},
    cash:{available:cash,pending:Number(snap.data?.pending_cash||0),upcoming30d:upcoming,avgDailyBurn,runwayMonths:runway},
    expenses:{paid30d:expenses30,rows:eRows.slice(0,80),dueSoon,byCategory:eRows.reduce((m,x)=>(m[x.category]=(m[x.category]||0)+Number(x.amount||0),m),{})},
    budgets:budgetUtil,
    capital:{rows:cRows.slice(0,50),in:Number(snap.data?.capital_in_ever||0),out:Number(snap.data?.capital_out_ever||0)},
    wallets:wallets.data||[], payouts:payouts.data||[], ads:{rows:adRows,budget:adBudget,spend:adSpend,clicks:adClicks,impressions:adImp}, affiliate:{rows:affiliateRows,expectedCommission:affiliateExpected}, decisions
  };
}

app.get('/api/admin/owner/money/cockpit', admin, async (_request,response)=>{
  try { response.json({ok:true,generated_at:new Date().toISOString(),money:await ownerMoneyIntelligence()}); }
  catch(error){ response.status(500).json({error:error.message}); }
});

app.post('/api/admin/owner/money/expense', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{};
    const amount=Number(b.amount)||0; if(amount<=0) throw new Error('amount harus > 0');
    const row={cost_center_id:cleanText(b.cost_center_id,120)||null,category:['content','marketing','sales','technology','people','operations','tax','capital','fee','other'].includes(b.category)?b.category:'other',vendor:cleanText(b.vendor,180)||null,description:cleanText(b.description,1000)||null,amount,currency:cleanText(b.currency,10)||'IDR',status:['planned','approved','paid','cancelled'].includes(b.status)?b.status:'planned',due_at:b.due_at||null,paid_at:b.status==='paid'?(b.paid_at||new Date().toISOString()):null,recurring:Boolean(b.recurring),recurrence_rule:cleanText(b.recurrence_rule,160)||null,external_reference:cleanText(b.external_reference,180)||null,created_by:request.user.id};
    const {data,error}=await adminClient.from('owner_expenses').insert(row).select().single(); if(error) throw error;
    await auditOwnerAction(request,'money_expense_created','owner_expense',data.id,{amount,category:row.category,status:row.status}); response.status(201).json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/money/revenue', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{}, amount=Number(b.amount)||0; if(amount<=0) throw new Error('amount harus > 0');
    const row={source:['adsense','direct_ad','sponsor','affiliate','video','subscription','other'].includes(b.source)?b.source:'other',amount,currency:cleanText(b.currency,10)||'IDR',occurred_at:b.occurred_at||new Date().toISOString(),content_type:cleanText(b.content_type,50)||null,content_id:cleanText(b.content_id,120)||null,campaign_id:cleanText(b.campaign_id,120)||null,affiliate_offer_id:cleanText(b.affiliate_offer_id,120)||null,notes:cleanText(b.notes,2000)||null};
    const {data,error}=await adminClient.from('revenue_entries').insert(row).select().single(); if(error) throw error;
    await auditOwnerAction(request,'money_revenue_recorded','revenue_entry',data.id,{amount,source:row.source}); response.status(201).json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/money/budget', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{}, amount=Number(b.amount)||0; if(amount<0) throw new Error('budget tidak valid');
    const {data,error}=await adminClient.from('owner_budgets').insert({name:cleanText(b.name,180)||'Owner Budget',cost_center_id:cleanText(b.cost_center_id,120)||null,period_start:b.period_start,period_end:b.period_end,amount,status:'active',created_by:request.user.id}).select().single(); if(error) throw error;
    await auditOwnerAction(request,'money_budget_created','owner_budget',data.id,{amount}); response.status(201).json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/cockpit', admin, async (_request,response)=>{
  try {
    const [intelligence, _radar, overview, _briefing, timeline, _featuresQuery, goals, autonomy, commands, sources] = await Promise.all([
      ownerDecisionBrief().then(async decision => ({
        decision,
        performance: await ownerPerformanceSnapshot(),
        audience: await ownerAudienceBrief(),
        revenue: await ownerRevenueForecast(),
        radar: (await adminClient.from('articles').select('id,title,summary,views,likes,shares,published_at,created_at,category,intelligence_score,importance_score').order('published_at',{ascending:false,nullsLast:true}).limit(80)).data || []
      })),
      Promise.resolve(null),
      v14SafeQuery(()=>adminClient.from('owner_tasks').select('id,title,priority,status,due_at').in('status',['open','in_progress']).order('priority',{ascending:false}).limit(10)),
      Promise.resolve(null),
      v14SafeQuery(()=>adminClient.from('audit_logs').select('id,action,resource_type,resource_id,created_at,metadata').order('created_at',{ascending:false}).limit(30)),
      Promise.resolve(null),
      v14SafeQuery(()=>adminClient.from('owner_goals').select('id,title,status,horizon,target_value,unit,updated_at,owner_goal_metrics(*)').eq('status','active').order('updated_at',{ascending:false}).limit(12)),
      v14SafeQuery(()=>adminClient.from('owner_autonomy_policies').select('action_key,mode,enabled,max_risk,min_role').order('action_key').limit(30)),
      v14SafeQuery(()=>adminClient.from('owner_commands').select('id,intent_key,status,risk_level,input_text,created_at').order('created_at',{ascending:false}).limit(24)),
      v14SafeQuery(()=>adminClient.from('news_sources').select('id,name,url,status,failure_count,last_success_at,active').order('name').limit(60))
    ]);
    const brief = await ownerDecisionBrief().catch(()=>null);
    const featuresDb = await v14SafeQuery(()=>adminClient.from('owner_feature_catalog').select('feature_key,area,capability,status,evidence,route,provider_dependency').order('area').order('feature_key'));
    const featureMap=new Map((featuresDb.data||[]).map(x=>[x.feature_key,x]));
    const featureRows = typeof OWNER_FEATURES_V14!=='undefined' ? OWNER_FEATURES_V14.map(x=>({...x,...(featureMap.get(x.key)||{})})) : (featuresDb.data||[]);
    const counts=featureRows.reduce((m,x)=>(m[x.status]=(m[x.status]||0)+1,m),{});
    const radarRows=(intelligence?.radar||[]).map(x=>({...x,owner_score:ownerScore(x)})).sort((a,b)=>b.owner_score-a.owner_score).slice(0,20);
    response.json({ok:true,generated_at:new Date().toISOString(),intelligence:{...intelligence,decision:brief||intelligence.decision,radar:radarRows},tasks:overview.data||[],brief:await ownerDecisionBrief().then(x=>({brief:{headline:x.headline,decision_confidence:x.confidence,top_story:x.top_story,recommended_next_actions:(x.decisions||[]).slice(0,6)}})).catch(()=>null),timeline:(timeline.data||[]).map(x=>({at:x.created_at,type:'audit',title:x.action,detail:[x.resource_type,x.resource_id].filter(Boolean).join(' · '),risk:'normal'})),features:{total:featureRows.length,counts,features:featureRows},goals:goals.data||[],autonomy:autonomy.data||[],commands:commands.data||[],sources:sources.data||[],money:await ownerMoneyIntelligence()});
  } catch(error){response.status(500).json({error:error.message});}
});

/* =========================================================
   V14 — OWNER EVOLUTION LAYER
   Goal-driven decisions, briefs, feature coverage, autonomy,
   activity timeline, recommendation explainability and learning loop.
========================================================= */

const OWNER_FEATURES_V14 = [
  {key:'owner.copilot',area:'Owner',name:'Stateful Copilot',status:'enhanced'},
  {key:'owner.context',area:'Owner',name:'Conversational Context',status:'enhanced'},
  {key:'owner.planner',area:'Owner',name:'Multi-step Action Planner',status:'active'},
  {key:'owner.dry_run',area:'Owner',name:'Dry Run / Scenario Preview',status:'enhanced'},
  {key:'owner.undo',area:'Owner',name:'Undo / Rollback',status:'active'},
  {key:'owner.voice',area:'Owner',name:'Voice Command Bus',status:'active'},
  {key:'owner.decision',area:'Decision',name:'Decision Stack',status:'enhanced'},
  {key:'owner.goals',area:'Decision',name:'Goal-driven Owner Mode',status:'active'},
  {key:'owner.what_if',area:'Decision',name:'What-if Simulator',status:'enhanced'},
  {key:'owner.timeline',area:'Decision',name:'Universal Activity Timeline',status:'active'},
  {key:'owner.briefs',area:'Decision',name:'Morning / Midday / Evening Briefs',status:'active'},
  {key:'intelligence.story_opportunity',area:'Intelligence',name:'Story Opportunity Score',status:'enhanced'},
  {key:'intelligence.event_radar',area:'Intelligence',name:'Event Acceleration Radar',status:'active'},
  {key:'intelligence.explainability',area:'Intelligence',name:'Recommendation WHY',status:'foundation'},
  {key:'intelligence.learning',area:'Intelligence',name:'Outcome Feedback Loop',status:'foundation'},
  {key:'newsroom.publish_now',area:'Newsroom',name:'What Should I Publish Now?',status:'enhanced'},
  {key:'newsroom.quality_gate',area:'Newsroom',name:'Quality Gate',status:'foundation'},
  {key:'homepage.autopilot',area:'Distribution',name:'Homepage Autopilot',status:'foundation'},
  {key:'homepage.what_if',area:'Distribution',name:'Homepage What-if',status:'enhanced'},
  {key:'audience.demand',area:'Audience',name:'Demand Intelligence',status:'enhanced'},
  {key:'money.forecast',area:'Money',name:'Revenue Forecast',status:'enhanced'},
  {key:'ops.self_heal',area:'Operations',name:'Self-healing Loop',status:'foundation'},
  {key:'ops.incident',area:'Operations',name:'Incident Commander',status:'active'},
  {key:'ops.source_intel',area:'Operations',name:'Source Intelligence',status:'enhanced'},
  {key:'governance.autonomy',area:'Governance',name:'Autonomy Policy',status:'active'},
  {key:'governance.audit',area:'Governance',name:'Audit + Verification',status:'active'},
  {key:'evolution.learning',area:'Evolution',name:'Recommend → Execute → Learn',status:'foundation'},
  {key:'distribution.social',area:'Distribution',name:'Share / Multi-platform UI',status:'active'},
  {key:'media.video',area:'Media',name:'Private video + signed URLs',status:'active'},
  {key:'seo.schema',area:'SEO',name:'NewsArticle / VideoObject / canonical',status:'active'},
  {key:'community.moderation',area:'Audience',name:'Community moderation + reputation',status:'active'},
  {key:'money.wallet',area:'Money',name:'Internal wallet + reconciliation',status:'active'},
  {key:'money.cashflow',area:'Money',name:'Cashflow + runway intelligence',status:'enhanced'},
  {key:'money.expenses',area:'Money',name:'Expense / outflow control',status:'active'},
  {key:'money.budgets',area:'Money',name:'Budget guard + variance',status:'active'},
  {key:'money.capital',area:'Money',name:'Capital / owner funding ledger',status:'active'},
  {key:'money.attribution',area:'Money',name:'Revenue source attribution',status:'enhanced'},
  {key:'money.ad_yield',area:'Money',name:'Ad inventory / campaign yield',status:'enhanced'},
  {key:'ads.campaigns',area:'Money',name:'Ad campaign control',status:'foundation'},
  {key:'automation.rules',area:'Operations',name:'Automation / scheduler / run log',status:'active'},
  {key:'security.roles',area:'Governance',name:'Role + risk + session control',status:'active'},
  {key:'provider.honesty',area:'Governance',name:'Provider honest-state registry',status:'active'}
];

const v14SafeQuery = async (builderFactory, fallback = []) => {
  try {
    const result = await builderFactory();
    if (result.error) return {data:fallback,error:result.error};
    return {data:result.data || fallback,error:null};
  } catch (error) {
    return {data:fallback,error};
  }
};

app.get('/api/admin/owner/briefing', admin, async (request,response)=>{
  try {
    const [intel,commands,alerts,tasks,goals] = await Promise.all([
      ownerDecisionBrief(),
      adminClient.from('owner_commands').select('id,intent_key,status,risk_level,input_text,created_at').order('created_at',{ascending:false}).limit(12),
      adminClient.from('owner_alerts').select('id,title,severity,status,created_at').eq('status','open').order('created_at',{ascending:false}).limit(8),
      adminClient.from('owner_tasks').select('id,title,priority,status,due_at').in('status',['open','in_progress']).order('priority',{ascending:false}).limit(8),
      adminClient.from('owner_goals').select('id,title,status,horizon,target_value,unit,updated_at').eq('status','active').order('updated_at',{ascending:false}).limit(6)
    ]);
    const degraded=intel.degraded_sources||[];
    const story=intel.top_story;
    const brief={
      generated_at:new Date().toISOString(),
      headline:intel.headline,
      decision_confidence:intel.confidence,
      top_story:story ? {id:story.id,title:story.title,score:story.owner_score} : null,
      risks:degraded.slice(0,5),
      alerts:alerts.data||[],
      tasks:tasks.data||[],
      goals:goals.data||[],
      command_activity:commands.data||[],
      recommended_next_actions:(intel.decisions||[]).slice(0,5),
      briefing_questions:['Apa yang paling penting sekarang?','Apa yang sebaiknya dipublikasikan?','Apa yang berisiko hari ini?','Bagaimana performa dan revenue bergerak?']
    };
    response.json({ok:true,brief});
  } catch(error){response.status(500).json({error:error.message});}
});

app.get('/api/admin/owner/timeline', admin, async (request,response)=>{
  try {
    const [a,c,o,u,r] = await Promise.all([
      adminClient.from('audit_logs').select('id,actor_id,actor_role,action,resource_type,resource_id,metadata,created_at').order('created_at',{ascending:false}).limit(40),
      adminClient.from('owner_commands').select('id,actor_id,intent_key,status,risk_level,input_text,result,error_text,created_at,finished_at').order('created_at',{ascending:false}).limit(40),
      adminClient.from('owner_action_undo').select('id,command_id,action_key,resource_type,resource_id,status,expires_at,created_at').order('created_at',{ascending:false}).limit(25),
      adminClient.from('owner_decision_outcomes').select('id,action_key,resource_type,resource_id,accepted,outcome_score,notes,created_at').order('created_at',{ascending:false}).limit(25),
      adminClient.from('owner_daily_briefs').select('id,brief_date,brief_type,created_at').order('created_at',{ascending:false}).limit(10)
    ]);
    const events=[];
    (a.data||[]).forEach(x=>events.push({at:x.created_at,type:'audit',title:x.action,detail:[x.resource_type,x.resource_id].filter(Boolean).join(' · '),risk:'normal',payload:x}));
    (c.data||[]).forEach(x=>events.push({at:x.created_at,type:'command',title:x.intent_key,detail:x.input_text||'',risk:x.risk_level||'low',payload:x}));
    (o.data||[]).forEach(x=>events.push({at:x.created_at,type:'undo',title:`Undo ${x.action_key}`,detail:x.resource_type||'',risk:'controlled',payload:x}));
    (u.data||[]).forEach(x=>events.push({at:x.created_at,type:'outcome',title:`Outcome ${x.action_key}`,detail:x.accepted===false?'rejected':'observed',risk:'learning',payload:x}));
    (r.data||[]).forEach(x=>events.push({at:x.created_at,type:'brief',title:`${x.brief_type} brief`,detail:String(x.brief_date),risk:'briefing',payload:x}));
    events.sort((x,y)=>new Date(y.at)-new Date(x.at));
    response.json({ok:true,events:events.slice(0,90)});
  } catch(error){response.status(500).json({error:error.message});}
});

app.get('/api/admin/owner/features', admin, async (_request,response)=>{
  const db = await v14SafeQuery(()=>adminClient.from('owner_feature_catalog').select('feature_key,area,capability,status,evidence,route,provider_dependency').order('area').order('feature_key'));
  const dbMap=new Map((db.data||[]).map(x=>[x.feature_key,x]));
  const features=OWNER_FEATURES_V14.map(x=>({...x,...(dbMap.get(x.key)||{})}));
  const counts=features.reduce((m,x)=>(m[x.status]=(m[x.status]||0)+1,m),{});
  response.json({ok:true,generated_at:new Date().toISOString(),total:features.length,counts,features});
});

app.get('/api/admin/owner/recommendations', admin, async (_request,response)=>{
  try {
    const [insights,stories] = await Promise.all([
      adminClient.from('owner_insights').select('id,insight_type,priority,title,reason,confidence,action_key,resource_type,resource_id,status,payload,expires_at,created_at').eq('status','open').order('priority',{ascending:false}).limit(20),
      adminClient.from('recommendation_explanations').select('id,content_type,content_id,score,factors,reason,segment_key,generated_at').order('generated_at',{ascending:false}).limit(20)
    ]);
    if(insights.error) throw insights.error; if(stories.error) throw stories.error;
    response.json({ok:true,recommendations:insights.data||[],explanations:stories.data||[]});
  } catch(error){response.status(500).json({error:error.message});}
});

app.get('/api/admin/owner/autonomy', admin, async (_request,response)=>{
  try {
    const {data,error}=await adminClient.from('owner_autonomy_policies').select('*').order('mode').order('action_key');
    if(error) throw error;
    response.json({ok:true,policies:data||[]});
  } catch(error){response.status(500).json({error:error.message});}
});

app.patch('/api/admin/owner/autonomy/:action_key', admin, ownerWrite, async (request,response)=>{
  try {
    const mode=['assisted','semi_auto','auto'].includes(request.body?.mode)?request.body.mode:'assisted';
    const enabled=request.body?.enabled===undefined?true:Boolean(request.body.enabled);
    const maxRisk=['low','medium','high','critical'].includes(request.body?.max_risk)?request.body.max_risk:'low';
    const minRole=['admin','owner','super_admin'].includes(request.body?.min_role)?request.body.min_role:'owner';
    const {data,error}=await adminClient.from('owner_autonomy_policies').upsert({action_key:request.params.action_key,mode,enabled,max_risk:maxRisk,min_role:minRole,updated_at:new Date().toISOString()},{onConflict:'action_key'}).select().single();
    if(error) throw error;
    await auditOwnerAction(request,'owner_autonomy_policy_updated','owner_autonomy_policy',data.id,{action_key:request.params.action_key,mode,enabled,max_risk:maxRisk,min_role:minRole});
    response.json({ok:true,policy:data});
  } catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/goals', admin, async (request,response)=>{
  try {
    const {data,error}=await adminClient.from('owner_goals').select('*,owner_goal_metrics(*)').eq('status','active').order('updated_at',{ascending:false}).limit(20);
    if(error) throw error;
    response.json({ok:true,goals:data||[]});
  } catch(error){response.status(500).json({error:error.message});}
});

app.post('/api/admin/owner/goals', admin, ownerWrite, async (request,response)=>{
  try {
    const title=cleanText(request.body?.title,200); if(!title) return response.status(400).json({error:'Judul goal wajib'});
    const {data,error}=await adminClient.from('owner_goals').insert({actor_id:request.user?.id||null,title,objective:request.body?.objective||{},horizon:cleanText(request.body?.horizon,80)||null,target_value:Number(request.body?.target_value)||null,unit:cleanText(request.body?.unit,40)||null,status:'active'}).select().single();
    if(error) throw error;
    await auditOwnerAction(request,'owner_goal_created','owner_goal',data.id,{title,horizon:data.horizon,target_value:data.target_value,unit:data.unit});
    response.status(201).json({ok:true,goal:data});
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/outcomes', admin, ownerWrite, async (request,response)=>{
  try {
    const {data,error}=await adminClient.from('owner_decision_outcomes').insert({insight_id:request.body?.insight_id||null,command_id:request.body?.command_id||null,action_key:cleanText(request.body?.action_key,140)||null,resource_type:cleanText(request.body?.resource_type,80)||null,resource_id:cleanText(request.body?.resource_id,140)||null,accepted:request.body?.accepted===undefined?true:Boolean(request.body.accepted),outcome_score:Number(request.body?.outcome_score)||null,notes:cleanText(request.body?.notes,2000)||null,before_metrics:request.body?.before_metrics||{},after_metrics:request.body?.after_metrics||{}}).select().single();
    if(error) throw error;
    response.status(201).json({ok:true,outcome:data});
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/briefing/generate', admin, ownerWrite, async (request,response)=>{
  try {
    const type=['morning','midday','evening','incident'].includes(request.body?.brief_type)?request.body.brief_type:'morning';
    const [briefRes,decision]=await Promise.all([ownerDecisionBrief(),ownerRevenueForecast()]);
    const payload={headline:briefRes.headline,confidence:briefRes.confidence,decisions:briefRes.decisions,top_story:briefRes.top_story,risks:briefRes.degraded_sources,alerts:briefRes.alerts,tasks:briefRes.tasks,revenue:decision,generated_by:'owner-evolution-engine'};
    const {data,error}=await adminClient.from('owner_daily_briefs').upsert({brief_date:new Date().toISOString().slice(0,10),brief_type:type,payload,created_at:new Date().toISOString()},{onConflict:'brief_date,brief_type'}).select().single();
    if(error) throw error;
    response.json({ok:true,brief:data});
  } catch(error){response.status(400).json({error:error.message});}
});

/* =========================================================
   MUDA V19 — ULTIMATE OWNER CONTROL PLANE
   Canonical money, finance administration, media intelligence,
   reconciliation, scenario/decision support and richer cockpit.
========================================================= */

const v19MoneySafe = async (queryFactory, fallback = []) => {
  try {
    const result = await queryFactory();
    return result?.data || fallback;
  } catch (_) {
    return fallback;
  }
};

const v19CsvEscape = value => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
};

const v19CanonicalMoney = async (startDate = new Date(Date.now()-30*86400000), endDate = new Date()) => {
  const start = startDate instanceof Date ? startDate.toISOString() : new Date(startDate).toISOString();
  const end = endDate instanceof Date ? endDate.toISOString() : new Date(endDate).toISOString();
  const ledger = await v19MoneySafe(() => adminClient.from('owner_money_ledger')
    .select('id,direction,entry_type,source,category,account_id,cost_center_id,counterparty,description,amount,tax_amount,currency,status,occurred_at,due_at,settled_at,recurring,external_reference,source_system,source_record_type,source_record_id,reconciled,reconciliation_status')
    .gte('occurred_at', start).lte('occurred_at', end)
    .order('occurred_at',{ascending:false}).limit(10000));
  const inflow = ledger.filter(x => x.direction === 'inflow' && x.status !== 'void').reduce((a,x)=>a+Number(x.amount||0),0);
  const outflow = ledger.filter(x => x.direction === 'outflow' && x.status !== 'void').reduce((a,x)=>a+Number(x.amount||0),0);
  return { rows:ledger, inflow, outflow, net:inflow-outflow };
};

const v19FinanceAdmin = async () => {
  const [ledger,accounts,receivables,payables,recurring,closes,checks,costCenters,budgets,capital] = await Promise.all([
    v19MoneySafe(() => adminClient.from('owner_money_ledger').select('*').order('occurred_at',{ascending:false}).limit(500)),
    v19MoneySafe(() => adminClient.from('owner_money_accounts').select('*').order('name')),
    v19MoneySafe(() => adminClient.from('owner_money_receivables').select('*').order('due_at',{ascending:true}).limit(500)),
    v19MoneySafe(() => adminClient.from('owner_money_payables').select('*').order('due_at',{ascending:true}).limit(500)),
    v19MoneySafe(() => adminClient.from('owner_money_recurring_rules').select('*').order('next_run',{ascending:true}).limit(300)),
    v19MoneySafe(() => adminClient.from('owner_money_monthly_closes').select('*').order('period_month',{ascending:false}).limit(24)),
    v19MoneySafe(() => adminClient.from('owner_finance_close_checks').select('*').order('period_month',{ascending:false}).order('check_key').limit(300)),
    v19MoneySafe(() => adminClient.from('owner_cost_centers').select('*').order('name')),
    v19MoneySafe(() => adminClient.from('owner_budgets').select('*').order('period_end',{ascending:true}).limit(200)),
    v19MoneySafe(() => adminClient.from('owner_capital_events').select('*').order('occurred_at',{ascending:false}).limit(200))
  ]);
  const today = new Date();
  const overdueReceivables = receivables.filter(x => ['open','partial','overdue'].includes(x.status) && x.due_at && new Date(x.due_at) < today);
  const overduePayables = payables.filter(x => ['open','partial','overdue'].includes(x.status) && x.due_at && new Date(x.due_at) < today);
  const next30 = new Date(Date.now()+30*86400000);
  const upcomingPayables = payables.filter(x => ['open','partial','overdue'].includes(x.status) && x.due_at && new Date(x.due_at) <= next30);
  const upcomingReceivables = receivables.filter(x => ['open','partial','overdue'].includes(x.status) && x.due_at && new Date(x.due_at) <= next30);
  return {
    ledger, accounts, receivables, payables, recurring, closes, checks, costCenters, budgets, capital,
    overdueReceivables, overduePayables, upcomingPayables, upcomingReceivables,
    totals:{
      receivableOpen:receivables.filter(x=>['open','partial','overdue'].includes(x.status)).reduce((a,x)=>a+Number(x.amount||0),0),
      payableOpen:payables.filter(x=>['open','partial','overdue'].includes(x.status)).reduce((a,x)=>a+Number(x.amount||0),0),
      receivableOverdue:overdueReceivables.reduce((a,x)=>a+Number(x.amount||0),0),
      payableOverdue:overduePayables.reduce((a,x)=>a+Number(x.amount||0),0),
      upcomingPayables:upcomingPayables.reduce((a,x)=>a+Number(x.amount||0),0),
      upcomingReceivables:upcomingReceivables.reduce((a,x)=>a+Number(x.amount||0),0)
    }
  };
};

const v19MediaIntelligence = async () => {
  const [articles,videos,events,breaking,ads,analytics] = await Promise.all([
    v19MoneySafe(() => adminClient.from('articles').select('id,title,status,views,likes,shares,published_at,created_at,category,intelligence_score,importance_score,is_featured').order('published_at',{ascending:false,nullsLast:true}).limit(400)),
    v19MoneySafe(() => adminClient.from('videos').select('*').order('created_at',{ascending:false}).limit(300)),
    v19MoneySafe(() => adminClient.from('news_events').select('*').order('last_seen_at',{ascending:false}).limit(100)),
    v19MoneySafe(() => adminClient.from('breaking_news').select('*').eq('active',true).order('created_at',{ascending:false}).limit(100)),
    v19MoneySafe(() => adminClient.from('ad_campaigns').select('*').order('updated_at',{ascending:false}).limit(100)),
    v19MoneySafe(() => adminClient.from('analytics_events').select('event_type,created_at,content_id').gte('created_at',new Date(Date.now()-86400000).toISOString()).limit(10000))
  ]);
  const rank = row => {
    const views=Number(row.views||0), likes=Number(row.likes||0), shares=Number(row.shares||0);
    const intel=Number(row.intelligence_score||0), importance=Number(row.importance_score||0);
    const ageHours=Math.max(0,(Date.now()-new Date(row.published_at||row.created_at||Date.now()).getTime())/3600000);
    const freshness=Math.max(0,100-ageHours*4);
    return Math.max(0,Math.min(100,Math.round(freshness*0.25 + Math.min(100,Math.log10(views+1)*25)*0.25 + Math.min(100,(likes+shares)*3)*0.15 + intel*0.2 + importance*0.15)));
  };
  const rankedArticles=articles.map(x=>({...x,owner_score:rank(x)})).sort((a,b)=>b.owner_score-a.owner_score);
  const analyticsByType=analytics.reduce((m,x)=>(m[x.event_type]=(m[x.event_type]||0)+1,m),{});
  const videoStats={total:videos.length,published:videos.filter(v=>['published','public'].includes(String(v.status||v.visibility||'').toLowerCase())).length};
  const articleStats={total:articles.length,published:articles.filter(a=>String(a.status||'').toLowerCase()==='published').length,views:articles.reduce((a,x)=>a+Number(x.views||0),0),likes:articles.reduce((a,x)=>a+Number(x.likes||0),0),shares:articles.reduce((a,x)=>a+Number(x.shares||0),0)};
  const adStats={budget:ads.reduce((a,x)=>a+Number(x.budget||0),0),spend:ads.reduce((a,x)=>a+Number(x.spend||0),0),impressions:ads.reduce((a,x)=>a+Number(x.impressions||0),0),clicks:ads.reduce((a,x)=>a+Number(x.clicks||0),0)};
  return {articles:rankedArticles.slice(0,40),videos:videos.slice(0,40),events,breaking,analyticsByType,articleStats,videoStats,adStats,topStory:rankedArticles[0]||null};
};


const ownerDecisionSignalSeverity = value => ['info','low','medium','high','critical'].includes(value) ? value : 'info';

const buildOwnerDecisionSignals = (cockpit, intelligence = null) => {
  const now = new Date().toISOString();
  const out = [];
  const push = (signal_key, area, severity, score, confidence, title, explanation, recommended_action, resource_type = null, resource_id = null) => {
    out.push({signal_key, area, severity:ownerDecisionSignalSeverity(severity), score:Number(score||0), confidence:Number(confidence||0), title, explanation, recommended_action, resource_type, resource_id:resource_id || null, observed_at:now});
  };
  const f = cockpit?.finance || {};
  const m = cockpit?.media || {};
  const d = intelligence?.decision || null;
  const providers = cockpit?.providers || [];
  const degradedProviders = providers.filter(x => !['active'].includes(String(x.status||'').toLowerCase()));
  const red = cockpit?.redFlags || [];

  if (Number(f.totals?.receivableOverdue||0) > 0) push('finance.receivable_overdue','Finance','high',92,96,'Piutang jatuh tempo',`Piutang overdue Rp ${Number(f.totals.receivableOverdue).toLocaleString('id-ID')}.`,'review_overdue_receivable','finance',null);
  if (Number(f.totals?.payableOverdue||0) > 0) push('finance.payable_overdue','Finance','high',90,96,'Hutang jatuh tempo',`Hutang overdue Rp ${Number(f.totals.payableOverdue).toLocaleString('id-ID')}.`,'review_overdue_payable','finance',null);
  const budgetHot = (f.budgets||[]).find(x => Number(x.amount||0)>0 && Number(x.spent||0)/Number(x.amount||1) >= .9);
  if (budgetHot) push(`finance.budget.${budgetHot.id}`,'Finance','medium',78,92,`Budget hampir habis: ${budgetHot.name}`,`Utilisasi ${Math.round(Number(budgetHot.spent||0)/Number(budgetHot.amount||1)*100)}%.`,'review_ad_budget','owner_budget',budgetHot.id);
  if ((m.breaking||[]).length) push('newsroom.breaking_active','Newsroom','high',94,95,`${m.breaking.length} breaking aktif`,'Breaking aktif perlu triage editorial sebelum backlog bertambah.','review_breaking','breaking_news',m.breaking[0]?.id||null);
  if (degradedProviders.length) push('governance.provider_degraded','Governance','medium',72,94,`${degradedProviders.length} provider belum active`,'Provider yang belum active mempengaruhi kemampuan tertentu dan harus ditampilkan jujur.','provider_health_check','integration_provider',null);
  if (d?.degraded_sources?.length) push('operations.source_degraded','Operations','high',86,93,`${d.degraded_sources.length} source berita terdegradasi`,'Source health menurun sehingga freshness dan coverage berita berisiko.','investigate_sources','news_source',d.degraded_sources[0]?.id||null);
  if ((cockpit?.core?.alerts||[]).length) push('operations.open_alerts','Operations','high',84,96,`${cockpit.core.alerts.length} alert terbuka`,'Alert aktif membutuhkan triage, acknowledgment, atau recovery.','open_alerts','owner_alert',cockpit.core.alerts[0]?.id||null);
  if ((cockpit?.core?.tasks||[]).length) push('governance.owner_tasks','Governance','medium',68,90,`${cockpit.core.tasks.length} task Owner terbuka`,'Backlog operasional masih memiliki pekerjaan aktif.','open_tasks','owner_task',cockpit.core.tasks[0]?.id||null);
  if (m.topStory) push('intelligence.top_story_opportunity','Intelligence','medium',Math.min(95,Math.max(55,Number(m.topStory.owner_score||0))),88,`Peluang story: ${m.topStory.title}`,'Story dengan owner score tertinggi layak ditinjau untuk publication, feature, distribution, dan monetization.','review_story','articles',m.topStory.id);
  if (!out.length) push('system.stable','Mission','info',55,72,'Sistem stabil','Tidak ada red flag prioritas dari telemetry yang tersedia.','generate_brief');
  return out.sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,20);
};

const syncOwnerDecisionSignals = async (cockpit, intelligence = null) => {
  const signals = buildOwnerDecisionSignals(cockpit, intelligence);
  try {
    const existingQ = await adminClient.from('owner_decision_signals').select('*').eq('status','open').limit(200);
    const existing = existingQ.data || [];
    const byKey = new Map(existing.map(x => [x.signal_key, x]));
    const seen = new Set();
    for (const signal of signals) {
      seen.add(signal.signal_key);
      const prior = byKey.get(signal.signal_key);
      const payload = {...signal};
      delete payload.observed_at;
      if (prior) await adminClient.from('owner_decision_signals').update(payload).eq('id',prior.id);
      else await adminClient.from('owner_decision_signals').insert(payload);
    }
    for (const prior of existing) if (!seen.has(prior.signal_key)) await adminClient.from('owner_decision_signals').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',prior.id);
  } catch (error) {
    console.warn('[OWNER SIGNALS]', error?.message || error);
  }
  return signals;
};

const ownerRuntimeCapabilities = async (cockpit, intelligence = null) => {
  const features = OWNER_FEATURES_V14.map(x => ({...x}));
  const providers = cockpit.providers || [];
  const providerMap = new Map(providers.map(x => [x.provider_key, x]));
  const hasSignalLayer = true;
  return features.map(f => {
    const inferred = f.key.startsWith('ads.') || f.key.startsWith('money.ad_yield') ? ['adsense'] : f.key.startsWith('automation.') ? ['scheduler'] : f.key.startsWith('distribution.social') ? ['social_distribution'] : f.key.includes('recommendation') || f.key.includes('copilot') ? ['ai_provider'] : [];
    const providerKeys = String(f.provider_dependency || '').split(',').map(x=>x.trim()).filter(Boolean).concat(inferred).filter((v,i,a)=>a.indexOf(v)===i);
    const blocked = providerKeys.some(k => providerMap.get(k) && providerMap.get(k).status !== 'active');
    let runtime_status = 'ready';
    let runtime_reason = 'Core V19 path available';
    if (blocked) { runtime_status='conditional'; runtime_reason='Menunggu provider aktif: '+providerKeys.filter(k=>providerMap.get(k)?.status !== 'active').join(', '); }
    else if (f.status === 'foundation') { runtime_status='ready_with_guard'; runtime_reason='Foundation aktif; akses tunduk pada evidence, risk gate, dan data availability.'; }
    else if (f.status === 'enhanced') { runtime_status='ready'; runtime_reason='Enhanced runtime path tersedia.'; }
    else if (f.status === 'active') { runtime_status='ready'; runtime_reason='Active runtime path tersedia.'; }
    return {...f,runtime_status,runtime_reason,signal_layer:hasSignalLayer};
  });
};

const v19OwnerUltimateCockpit = async () => {
  const [core,finance,media,providers,commands,tasks,alerts,goals,autonomy,timeline] = await Promise.all([
    adminClient.from('owner_alerts').select('id,severity,title,source,created_at,status').eq('status','open').order('created_at',{ascending:false}).limit(20),
    v19FinanceAdmin(),
    v19MediaIntelligence(),
    v19MoneySafe(() => adminClient.from('integration_providers').select('*').order('provider_key')),
    v19MoneySafe(() => adminClient.from('owner_commands').select('id,intent_key,status,risk_level,input_text,created_at,finished_at,result,error_text').order('created_at',{ascending:false}).limit(50)),
    v19MoneySafe(() => adminClient.from('owner_tasks').select('*').in('status',['open','pending','in_progress']).order('priority',{ascending:false}).limit(30)),
    v19MoneySafe(() => adminClient.from('owner_alerts').select('*').eq('status','open').order('severity').order('created_at',{ascending:false}).limit(30)),
    v19MoneySafe(() => adminClient.from('owner_goals').select('id,title,status,horizon,target_value,unit,updated_at,owner_goal_metrics(*)').eq('status','active').order('updated_at',{ascending:false}).limit(20)),
    v19MoneySafe(() => adminClient.from('owner_autonomy_policies').select('*').order('action_key').limit(100)),
    v19MoneySafe(() => adminClient.from('audit_logs').select('id,action,resource_type,resource_id,created_at,metadata').order('created_at',{ascending:false}).limit(60))
  ]);
  const month = new Date(); month.setDate(1); month.setHours(0,0,0,0);
  const monthRows=finance.ledger.filter(x => new Date(x.occurred_at)>=month && x.status!=='void');
  const monthIn=monthRows.filter(x=>x.direction==='inflow').reduce((a,x)=>a+Number(x.amount||0),0);
  const monthOut=monthRows.filter(x=>x.direction==='outflow').reduce((a,x)=>a+Number(x.amount||0),0);
  const redFlags=[];
  if(finance.totals.receivableOverdue>0) redFlags.push({severity:'high',title:'Piutang jatuh tempo',amount:finance.totals.receivableOverdue,action:'review_overdue_receivable'});
  if(finance.totals.payableOverdue>0) redFlags.push({severity:'high',title:'Hutang jatuh tempo',amount:finance.totals.payableOverdue,action:'review_overdue_payable'});
  if(media.adStats.budget>0 && media.adStats.spend/media.adStats.budget>0.9) redFlags.push({severity:'medium',title:'Budget iklan hampir habis',amount:media.adStats.spend,action:'review_ad_budget'});
  if(media.breaking.length>0) redFlags.push({severity:'medium',title:`${media.breaking.length} breaking aktif`,action:'review_breaking'});
  let signalSource = {decision:{degraded_sources:[]}};
  try { const brief = await ownerDecisionBrief(); signalSource = {decision:brief}; } catch (_) {}
  const decisionSignals = await syncOwnerDecisionSignals({finance,media,providers,core:{alerts:alerts||core.data||[],tasks}}, signalSource);
  const capabilities = await ownerRuntimeCapabilities({providers}, signalSource);
  return {
    generated_at:new Date().toISOString(),
    headline:redFlags.length?`Owner memiliki ${redFlags.length} hal yang perlu diputuskan.`:'Kontrol Owner stabil; fokus berikutnya pada pertumbuhan, kualitas, dan monetisasi.',
    core:{alerts:alerts||core.data||[],tasks,goals,autonomy,timeline},
    media,
    finance:{...finance,month:{inflow:monthIn,outflow:monthOut,net:monthIn-monthOut}},
    providers,commands,redFlags,
    signals:decisionSignals,
    capabilities:{total:capabilities.length,ready:capabilities.filter(x=>x.runtime_status==='ready').length,conditional:capabilities.filter(x=>x.runtime_status==='conditional').length,guarded:capabilities.filter(x=>x.runtime_status==='ready_with_guard').length,features:capabilities},
    decision:{topStory:media.topStory,confidence:Math.max(55,Math.min(97,100-redFlags.length*7)),recommended: redFlags.length?redFlags:[{severity:'low',title:'Naikkan monetisasi story terbaik',action:'analyze_top_story_revenue'}]}
  };
};

app.get('/api/admin/owner/ultimate/cockpit', admin, async (_request,response)=>{
  try { response.json(await v19OwnerUltimateCockpit()); }
  catch(error){ response.status(500).json({error:error.message}); }
});


app.get('/api/admin/owner/decision-signals', admin, async (_request,response)=>{
  try {
    const cockpit = await v19OwnerUltimateCockpit();
    const {data,error}=await adminClient.from('owner_decision_signals').select('*').order('status').order('severity').order('created_at',{ascending:false}).limit(100);
    if(error) throw error;
    response.json({ok:true,generated_at:new Date().toISOString(),signals:data||cockpit.signals||[],live_signals:cockpit.signals||[]});
  } catch(error){ response.status(500).json({error:error.message}); }
});

app.patch('/api/admin/owner/decision-signals/:id', admin, ownerWrite, async (request,response)=>{
  try {
    const status=['open','acknowledged','resolved','dismissed'].includes(request.body?.status)?request.body.status:null;
    if(!status) return response.status(400).json({error:'status tidak valid'});
    const patch={status,resolved_at:['resolved','dismissed'].includes(status)?new Date().toISOString():null};
    const {data,error}=await adminClient.from('owner_decision_signals').update(patch).eq('id',request.params.id).select().single();
    if(error) throw error;
    await auditOwnerAction(request,'owner_decision_signal_'+status,'owner_decision_signal',request.params.id,{status});
    response.json({ok:true,signal:data});
  } catch(error){ response.status(400).json({error:error.message}); }
});

app.post('/api/admin/owner/finance/reconcile-legacy', admin, ownerWrite, async (request,response)=>{
  try {
    const [revenue, expenses] = await Promise.all([
      v19MoneySafe(() => adminClient.from('revenue_entries').select('id,source,amount,currency,occurred_at,content_id,campaign_id,affiliate_offer_id,notes').limit(10000)),
      v19MoneySafe(() => adminClient.from('owner_expenses').select('id,category,vendor,description,amount,currency,status,due_at,paid_at,external_reference,created_at').limit(10000))
    ]);
    let imported=0;
    for(const r of revenue){
      const key=`legacy:revenue:${r.id}`;
      const {error}=await adminClient.from('owner_money_ledger').upsert({canonical_key:key,direction:'inflow',entry_type:'revenue',source:r.source||'other',category:'revenue',description:r.notes||'Legacy revenue entry',amount:Number(r.amount||0),currency:r.currency||'IDR',status:'settled',occurred_at:r.occurred_at||r.created_at,settled_at:r.occurred_at||r.created_at,source_system:'legacy_revenue_entries',source_record_type:'revenue_entry',source_record_id:r.id,reconciled:true,reconciliation_status:'matched',created_by:request.user.id},{onConflict:'canonical_key'});
      if(!error) imported++;
    }
    for(const e of expenses){
      const key=`legacy:expense:${e.id}`;
      const {error}=await adminClient.from('owner_money_ledger').upsert({canonical_key:key,direction:'outflow',entry_type:'expense',source:'expense',category:e.category||'other',counterparty:e.vendor||null,description:e.description||'Legacy owner expense',amount:Number(e.amount||0),currency:e.currency||'IDR',status:e.status==='cancelled'?'void':(e.status==='paid'?'settled':'planned'),occurred_at:e.paid_at||e.due_at||e.created_at,settled_at:e.paid_at||null,due_at:e.due_at||null,external_reference:e.external_reference||null,source_system:'legacy_owner_expenses',source_record_type:'owner_expense',source_record_id:e.id,reconciled:true,reconciliation_status:'matched',created_by:request.user.id},{onConflict:'canonical_key'});
      if(!error) imported++;
    }
    await auditOwnerAction(request,'finance_legacy_reconciled','owner_money_ledger',null,{imported});
    response.json({ok:true,imported,message:'Legacy finance data mapped into canonical Owner ledger.'});
  } catch(error){ response.status(400).json({error:error.message}); }
});

app.patch('/api/admin/owner/finance/receivable/:id', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{};
    const patch={};
    for(const k of ['counterparty','description','source','invoice_number','currency','status','expected_at','received_at','external_reference','notes']) if(b[k]!==undefined) patch[k]=cleanText(b[k],1000)||null;
    if(b.amount!==undefined) patch.amount=Number(b.amount)||0;
    if(b.due_at!==undefined) patch.due_at=b.due_at||null;
    const {data,error}=await adminClient.from('owner_money_receivables').update(patch).eq('id',request.params.id).select().single();
    if(error) throw error; await auditOwnerAction(request,'finance_receivable_updated','owner_money_receivable',request.params.id,patch); response.json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/receivable/:id/payment', admin, ownerWrite, async (request,response)=>{
  try {
    const row=(await adminClient.from('owner_money_receivables').select('*').eq('id',request.params.id).single()).data;
    if(!row) throw new Error('Receivable tidak ditemukan');
    const amount=Math.max(0,Number(request.body?.amount)||0); if(amount<=0) throw new Error('amount harus > 0');
    const newStatus = amount >= Number(row.amount||0) ? 'paid' : 'partial';
    const patch={status:newStatus,received_at:newStatus==='paid'?(request.body?.received_at||new Date().toISOString().slice(0,10)):null};
    const {data,error}=await adminClient.from('owner_money_receivables').update(patch).eq('id',row.id).select().single(); if(error) throw error;
    const ledger={canonical_key:`receivable:${row.id}:${patch.received_at||new Date().toISOString()}:${amount}`,direction:'inflow',entry_type:'receivable_payment',source:row.source||'other',category:'receivable',counterparty:row.counterparty||null,description:`Payment ${row.description}`,amount,currency:row.currency||'IDR',status:'settled',occurred_at:new Date().toISOString(),settled_at:new Date().toISOString(),source_system:'finance_receivable',source_record_type:'owner_money_receivable',source_record_id:row.id,reconciled:true,reconciliation_status:'matched',created_by:request.user.id};
    await adminClient.from('owner_money_ledger').upsert(ledger,{onConflict:'canonical_key'});
    await auditOwnerAction(request,'finance_receivable_payment','owner_money_receivable',row.id,{amount,newStatus}); response.json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.patch('/api/admin/owner/finance/payable/:id', admin, ownerWrite, async (request,response)=>{
  try {
    const b=request.body||{}; const patch={};
    for(const k of ['counterparty','description','category','invoice_number','currency','status','expected_at','paid_at','external_reference','notes']) if(b[k]!==undefined) patch[k]=cleanText(b[k],1000)||null;
    if(b.amount!==undefined) patch.amount=Number(b.amount)||0; if(b.due_at!==undefined) patch.due_at=b.due_at||null;
    const {data,error}=await adminClient.from('owner_money_payables').update(patch).eq('id',request.params.id).select().single(); if(error) throw error;
    await auditOwnerAction(request,'finance_payable_updated','owner_money_payable',request.params.id,patch); response.json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/payable/:id/payment', admin, ownerWrite, async (request,response)=>{
  try {
    const row=(await adminClient.from('owner_money_payables').select('*').eq('id',request.params.id).single()).data; if(!row) throw new Error('Payable tidak ditemukan');
    const amount=Math.max(0,Number(request.body?.amount)||0); if(amount<=0) throw new Error('amount harus > 0');
    const newStatus=amount>=Number(row.amount||0)?'paid':'partial'; const paidAt=newStatus==='paid'?(request.body?.paid_at||new Date().toISOString()):null;
    const {data,error}=await adminClient.from('owner_money_payables').update({status:newStatus,paid_at:paidAt}).eq('id',row.id).select().single(); if(error) throw error;
    const ledger={canonical_key:`payable:${row.id}:${paidAt||new Date().toISOString()}:${amount}`,direction:'outflow',entry_type:'payable_payment',source:'payable',category:row.category||'other',counterparty:row.counterparty||null,description:`Payment ${row.description}`,amount,currency:row.currency||'IDR',status:'settled',occurred_at:new Date().toISOString(),settled_at:new Date().toISOString(),source_system:'finance_payable',source_record_type:'owner_money_payable',source_record_id:row.id,reconciled:true,reconciliation_status:'matched',created_by:request.user.id};
    await adminClient.from('owner_money_ledger').upsert(ledger,{onConflict:'canonical_key'});
    await auditOwnerAction(request,'finance_payable_payment','owner_money_payable',row.id,{amount,newStatus}); response.json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/finance/recurring', admin, async (_request,response)=>{
  const {data,error}=await adminClient.from('owner_money_recurring_rules').select('*').order('next_run',{ascending:true}); if(error) return response.status(500).json({error:error.message}); response.json(data||[]);
});
app.post('/api/admin/owner/finance/recurring', admin, ownerWrite, async (request,response)=>{
  try { const b=request.body||{}; const row={name:cleanText(b.name,180)||'Recurring Rule',direction:b.direction==='inflow'?'inflow':'outflow',entry_type:cleanText(b.entry_type,80)||'other',source:cleanText(b.source,80)||null,category:cleanText(b.category,80)||null,amount:Number(b.amount)||0,currency:cleanText(b.currency,10)||'IDR',frequency:['weekly','monthly','quarterly','yearly'].includes(b.frequency)?b.frequency:'monthly',next_run:b.next_run||null,active:b.active!==false,account_id:b.account_id||null,notes:cleanText(b.notes,1000)||null,created_by:request.user.id}; if(row.amount<=0) throw new Error('amount harus > 0'); const {data,error}=await adminClient.from('owner_money_recurring_rules').insert(row).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_recurring_created','owner_money_recurring_rule',data.id,row); response.status(201).json(data);} catch(error){response.status(400).json({error:error.message});}
});
app.patch('/api/admin/owner/finance/recurring/:id', admin, ownerWrite, async (request,response)=>{ try { const b=request.body||{}, patch={}; for(const k of ['name','direction','entry_type','source','category','currency','frequency','next_run','notes']) if(b[k]!==undefined) patch[k]=cleanText(b[k],500)||null; if(b.amount!==undefined) patch.amount=Number(b.amount)||0; if(b.active!==undefined) patch.active=Boolean(b.active); if(b.account_id!==undefined) patch.account_id=b.account_id||null; const {data,error}=await adminClient.from('owner_money_recurring_rules').update(patch).eq('id',request.params.id).select().single(); if(error) throw error; await auditOwnerAction(request,'finance_recurring_updated','owner_money_recurring_rule',request.params.id,patch); response.json(data);} catch(error){response.status(400).json({error:error.message});} });

app.get('/api/admin/owner/finance/cost-centers', admin, async (_request,response)=>{const {data,error}=await adminClient.from('owner_cost_centers').select('*').order('name'); if(error) return response.status(500).json({error:error.message}); response.json(data||[]);});
app.post('/api/admin/owner/finance/cost-centers', admin, ownerWrite, async (request,response)=>{try{const b=request.body||{},row={name:cleanText(b.name,180)||'Cost Center',kind:cleanText(b.kind,40)||'operating',active:b.active!==false,monthly_budget:Number(b.monthly_budget)||0};const {data,error}=await adminClient.from('owner_cost_centers').insert(row).select().single();if(error)throw error;await auditOwnerAction(request,'finance_cost_center_created','owner_cost_center',data.id,row);response.status(201).json(data);}catch(error){response.status(400).json({error:error.message});}});
app.patch('/api/admin/owner/finance/cost-centers/:id', admin, ownerWrite, async (request,response)=>{try{const b=request.body||{},patch={};for(const k of ['name','kind'])if(b[k]!==undefined)patch[k]=cleanText(b[k],180)||null;if(b.active!==undefined)patch.active=Boolean(b.active);if(b.monthly_budget!==undefined)patch.monthly_budget=Number(b.monthly_budget)||0;const {data,error}=await adminClient.from('owner_cost_centers').update(patch).eq('id',request.params.id).select().single();if(error)throw error;await auditOwnerAction(request,'finance_cost_center_updated','owner_cost_center',request.params.id,patch);response.json(data);}catch(error){response.status(400).json({error:error.message});}});

app.patch('/api/admin/owner/finance/budgets/:id', admin, ownerWrite, async (request,response)=>{try{const b=request.body||{},patch={};for(const k of ['name','period_start','period_end','status'])if(b[k]!==undefined)patch[k]=b[k];for(const k of ['amount','spent'])if(b[k]!==undefined)patch[k]=Number(b[k])||0;if(b.cost_center_id!==undefined)patch.cost_center_id=b.cost_center_id||null;const {data,error}=await adminClient.from('owner_budgets').update(patch).eq('id',request.params.id).select().single();if(error)throw error;await auditOwnerAction(request,'finance_budget_updated','owner_budget',request.params.id,patch);response.json(data);}catch(error){response.status(400).json({error:error.message});}});

app.post('/api/admin/owner/finance/reconcile', admin, ownerWrite, async (request,response)=>{
  try {
    const start = request.body?.period_start || new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
    const end = request.body?.period_end || new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().slice(0,10);
    const canonical=await v19CanonicalMoney(new Date(`${start}T00:00:00Z`),new Date(`${end}T23:59:59Z`));
    const recon={period_start:start,period_end:end,source_name:'owner_os',source_record_count:canonical.rows.length,canonical_record_count:canonical.rows.length,source_total_in:canonical.inflow,source_total_out:canonical.outflow,canonical_total_in:canonical.inflow,canonical_total_out:canonical.outflow,variance_in:0,variance_out:0,status:'matched',notes:'Canonical ledger self-reconciliation',created_by:request.user.id};
    const {data,error}=await adminClient.from('owner_money_reconciliations').insert(recon).select().single();if(error)throw error;await adminClient.from('owner_money_ledger').update({reconciled:true,reconciliation_status:'matched'}).gte('occurred_at',`${start}T00:00:00Z`).lte('occurred_at',`${end}T23:59:59Z`);await auditOwnerAction(request,'finance_reconciled','owner_money_reconciliation',data.id,recon);response.json(data);
  } catch(error){response.status(400).json({error:error.message});}
});

app.post('/api/admin/owner/finance/month/:period/reopen', admin, ownerWrite, async (request,response)=>{try{const period=request.params.period;const {data,error}=await adminClient.from('owner_money_monthly_closes').update({status:'reopened',closed_at:null,closed_by:null}).eq('period_month',period).select().single();if(error)throw error;await auditOwnerAction(request,'finance_month_reopened','owner_money_monthly_close',data.id,{period});response.json(data);}catch(error){response.status(400).json({error:error.message});}});

app.get('/api/admin/owner/finance/report.csv', admin, async (request,response)=>{
  try{
    const start=request.query.from?new Date(request.query.from):new Date(Date.now()-365*86400000); const end=request.query.to?new Date(request.query.to):new Date(); const canonical=await v19CanonicalMoney(start,end);
    const rows=[['Date','Direction','Type','Source','Category','Counterparty','Description','Amount','Tax','Currency','Status','Due','Settled','Reference','Reconciled']];
    for(const x of canonical.rows) rows.push([x.occurred_at,x.direction,x.entry_type,x.source,x.category,x.counterparty,x.description,x.amount,x.tax_amount,x.currency,x.status,x.due_at,x.settled_at,x.external_reference,x.reconciled?'yes':'no']);
    response.setHeader('Content-Type','text/csv; charset=utf-8'); response.setHeader('Content-Disposition',`attachment; filename="muda-owner-money-${start.toISOString().slice(0,10)}-${end.toISOString().slice(0,10)}.csv"`); response.send(rows.map(r=>r.map(v19CsvEscape).join(',')).join('\n'));
  }catch(error){response.status(400).json({error:error.message});}
});

app.get('/api/admin/owner/media/cockpit', admin, async (_request,response)=>{try{response.json(await v19MediaIntelligence());}catch(error){response.status(500).json({error:error.message});}});

app.post('/api/admin/owner/media/snapshot', admin, ownerWrite, async (request,response)=>{try{const m=await v19MediaIntelligence();const row={articles_total:m.articleStats.total,articles_published:m.articleStats.published,videos_total:m.videoStats.total,videos_published:m.videoStats.published,live_events:m.events.length,breaking_active:m.breaking.length,top_story_id:m.topStory?.id||null,article_views:m.articleStats.views||0,video_views:m.videos.reduce((a,x)=>a+Number(x.views||0),0),engagement_rate:m.articleStats.views?(((m.articleStats.likes+m.articleStats.shares)/m.articleStats.views)*100):0,notes:'Owner media snapshot',created_by:request.user.id};const {data,error}=await adminClient.from('owner_media_snapshots').insert(row).select().single();if(error)throw error;await auditOwnerAction(request,'owner_media_snapshot','owner_media_snapshot',data.id,row);response.status(201).json(data);}catch(error){response.status(400).json({error:error.message});}});

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
        `MUDA OWNER INTELLIGENCE OS V14 running on :${PORT}`
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
