import 'dotenv/config';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: Number(process.env.RSS_TIMEOUT_MS || 6500),
  headers: {
    'User-Agent': 'BeritaMudaIndonesia/5.2 (+news aggregator)'
  }
});

const splitFeeds = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const articleFeeds = splitFeeds(process.env.RSS_FEEDS);
const videoFeeds = splitFeeds(process.env.VIDEO_RSS_FEEDS);

const feedEntries = [
  ...articleFeeds.map((url) => ({
    url,
    type: 'article'
  })),
  ...videoFeeds.map((url) => ({
    url,
    type: 'video'
  }))
];

const FEED_CONCURRENCY = Math.max(
  1,
  Math.min(6, Number(process.env.RSS_CONCURRENCY || 4))
);

const MAX_ITEMS_PER_FEED = Math.max(
  1,
  Math.min(60, Number(process.env.RSS_MAX_ITEMS || 30))
);

const MAX_RUNTIME_MS = Math.max(
  10000,
  Math.min(
    55000,
    Number(process.env.RSS_MAX_RUNTIME_MS || 45000)
  )
);

const RETRIES = Math.max(
  0,
  Math.min(2, Number(process.env.RSS_RETRIES || 1))
);

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const stripHtml = (value = '') =>
  String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const safeHtmlFromFeed = (value = '') =>
  String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(
      /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      ''
    )
    .replace(/javascript:/gi, '')
    .trim();

const canonicalUrl = (raw = '') => {
  try {
    const url = new URL(raw);

    url.hash = '';

    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid'
    ];

    trackingParams.forEach((key) => {
      url.searchParams.delete(key);
    });

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }

    url.hostname = url.hostname.toLowerCase();

    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return String(raw || '').trim();
  }
};

const normalizeTitle = (value = '') =>
  stripHtml(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fingerprintOf = ({ title, summary, source }) =>
  crypto
    .createHash('sha256')
    .update(
      `${normalizeTitle(title)}|${stripHtml(summary).slice(
        0,
        500
      )}|${String(source || '').toLowerCase()}`
    )
    .digest('hex');

const eventKeyOf = ({ title, category }) =>
  crypto
    .createHash('sha256')
    .update(
      `${normalizeTitle(title)
        .split(' ')
        .slice(0, 14)
        .join(' ')}|${category || ''}`
    )
    .digest('hex')
    .slice(0, 32);

const categoryFor = (url, title = '') => {
  const text = `${url || ''} ${title || ''}`.toLowerCase();

  const categories = {
    politik: 'POLITIK',
    hukum: 'HUKUM',
    ekonomi: 'EKONOMI',
    teknologi: 'TEKNOLOGI',
    olahraga: 'OLAHRAGA',
    sport: 'OLAHRAGA',
    dunia: 'INTERNASIONAL',
    internasional: 'INTERNASIONAL',
    hiburan: 'HIBURAN',
    entertainment: 'HIBURAN',
    lifestyle: 'LIFESTYLE',
    gaya: 'LIFESTYLE'
  };

  for (const [keyword, category] of Object.entries(categories)) {
    if (text.includes(keyword)) {
      return category;
    }
  }

  return 'NASIONAL';
};

const authorOf = (item) =>
  String(
    item.creator ||
      item.author ||
      item['dc:creator'] ||
      item['dc:Creator'] ||
      ''
  )
    .trim()
    .slice(0, 160) || null;

const imageOf = (item) => {
  const mediaContent = item['media:content'];
  const mediaThumbnail = item['media:thumbnail'];

  const enclosureType = String(
    item.enclosure?.type || ''
  ).toLowerCase();

  const enclosureImage = enclosureType.startsWith('image/')
    ? item.enclosure?.url
    : null;

  const thumbnail = Array.isArray(mediaThumbnail)
    ? mediaThumbnail[0]?.url
    : mediaThumbnail?.url;

  const mediaImage = Array.isArray(mediaContent)
    ? mediaContent[0]?.url
    : mediaContent?.url;

  return (
    thumbnail ||
    item.itunes?.image ||
    item.image ||
    enclosureImage ||
    mediaImage ||
    null
  );
};

const videoUrlOf = (item) => {
  const enclosureUrl = item.enclosure?.url;

  const enclosureType = String(
    item.enclosure?.type || ''
  ).toLowerCase();

  const mediaContent = item['media:content'];

  const mediaUrl = Array.isArray(mediaContent)
    ? mediaContent[0]?.url
    : mediaContent?.url;

  if (
    enclosureUrl &&
    enclosureType.startsWith('video/')
  ) {
    return enclosureUrl;
  }

  if (mediaUrl) {
    return mediaUrl;
  }

  return item.link || enclosureUrl || null;
};

const looksLikeVideo = (item) => {
  const url = String(videoUrlOf(item) || '').toLowerCase();

  const enclosureType = String(
    item.enclosure?.type || ''
  ).toLowerCase();

  return (
    enclosureType.startsWith('video/') ||
    /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|\.mp4(?:\?|$)|\.webm(?:\?|$)|\.m3u8(?:\?|$)/.test(
      url
    )
  );
};

async function fetchFeed(url) {
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const startedAt = Date.now();

    try {
      const feed = await parser.parseURL(url);

      return {
        feed,
        latency: Date.now() - startedAt
      };
    } catch (error) {
      lastError = error;

      if (attempt < RETRIES) {
        await sleep(350 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];

  let nextIndex = 0;

  const workers = Array.from(
    {
      length: Math.min(limit, items.length)
    },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await worker(items[index], index);
      }
    }
  );

  await Promise.all(workers);

  return results;
}

function articleRowFromItem(item, feedUrl, source) {
  const rawHtml =
    item['content:encoded'] ||
    item.content ||
    '';

  const plain = stripHtml(
    item.contentSnippet ||
      rawHtml ||
      item.summary ||
      item.description ||
      ''
  );

  const contentHtml = safeHtmlFromFeed(rawHtml);

  const url = canonicalUrl(
    item.link ||
      item.guid ||
      ''
  );

  const title = String(item.title || '')
    .trim()
    .slice(0, 500);

  const category = categoryFor(feedUrl, title);

  if (!title || !url) {
    return null;
  }

  return {
    title,

    summary: plain.slice(0, 600),

    content_html:
      contentHtml.length >= 80
        ? contentHtml.slice(0, 50000)
        : null,

    url,

    canonical_url: url,

    content_fingerprint: fingerprintOf({
      title,
      summary: plain,
      source
    }),

    source_url: url,

    source,

    author_name: authorOf(item),

    category,

    event_key: eventKeyOf({
      title,
      category
    }),

    editorial_status: 'auto',

    image_url: imageOf(item),

    published_at:
      item.isoDate ||
      item.pubDate ||
      new Date().toISOString(),

    content_source:
      contentHtml.length >= 80
        ? 'rss'
        : 'snippet',

    content_available:
      contentHtml.length >= 80,

    status: 'published'
  };
}

function videoRowFromItem(item, feedUrl, source) {
  const videoUrl = canonicalUrl(
    videoUrlOf(item) ||
      ''
  );

  const title = String(item.title || '')
    .trim()
    .slice(0, 500);

  if (!title || !videoUrl) {
    return null;
  }

  const description = stripHtml(
    item.contentSnippet ||
      item.summary ||
      item.description ||
      item.content ||
      ''
  ).slice(0, 5000);

  return {
    title,

    description:
      description || null,

    video_url: videoUrl,

    thumbnail_url: imageOf(item),

    source,

    category: categoryFor(
      feedUrl,
      title
    ),

    status: 'published'
  };
}

async function saveArticles(rows) {
  if (!rows.length) {
    return 0;
  }

  const uniqueRows = [
    ...new Map(
      rows.map((row) => [
        row.url,
        row
      ])
    ).values()
  ];

  const { error } = await supabase
    .from('articles')
    .upsert(uniqueRows, {
      onConflict: 'url',
      ignoreDuplicates: false
    });

  if (error) {
    throw error;
  }

  return uniqueRows.length;
}

async function saveVideos(rows) {
  if (!rows.length) {
    return {
      inserted: 0,
      existing: 0
    };
  }

  const uniqueRows = [
    ...new Map(
      rows.map((row) => [
        row.video_url,
        row
      ])
    ).values()
  ];

  const urls = uniqueRows.map(
    (row) => row.video_url
  );

  const existingUrls = new Set();

  for (
    let start = 0;
    start < urls.length;
    start += 100
  ) {
    const chunk = urls.slice(
      start,
      start + 100
    );

    const { data, error } = await supabase
      .from('videos')
      .select('video_url')
      .in('video_url', chunk);

    if (error) {
      throw error;
    }

    for (const row of data || []) {
      if (row.video_url) {
        existingUrls.add(
          row.video_url
        );
      }
    }
  }

  const rowsToInsert = uniqueRows.filter(
    (row) =>
      !existingUrls.has(
        row.video_url
      )
  );

  if (rowsToInsert.length) {
    const { error } = await supabase
      .from('videos')
      .insert(rowsToInsert);

    if (error) {
      throw error;
    }
  }

  return {
    inserted: rowsToInsert.length,

    existing:
      uniqueRows.length -
      rowsToInsert.length
  };
}

export async function syncFeeds() {
  const startedAt = Date.now();

  const deadline =
    startedAt +
    MAX_RUNTIME_MS;

  if (!feedEntries.length) {
    return {
      ok: false,

      reason:
        'RSS_FEEDS_empty',

      feeds: 0,

      articles: 0,

      videos: 0,

      failed: 0,

      at:
        new Date().toISOString()
    };
  }

  const entries = [];

  const seen = new Set();

  for (const entry of feedEntries) {
    const key =
      `${entry.type}:${entry.url}`;

    if (!seen.has(key)) {
      seen.add(key);

      entries.push(entry);
    }
  }

  const limitedEntries = entries.slice(
    0,
    Number(
      process.env.RSS_MAX_FEEDS ||
        30
    )
  );

  const results =
    await mapWithConcurrency(
      limitedEntries,
      FEED_CONCURRENCY,

      async (entry) => {
        if (Date.now() >= deadline) {
          return {
            skipped: true,

            url: entry.url,

            type: entry.type,

            reason:
              'runtime_limit'
          };
        }

        try {
          const {
            feed,
            latency
          } =
            await fetchFeed(
              entry.url
            );

          let source =
            String(
              feed.title || ''
            ).trim();

          if (!source) {
            try {
              source =
                new URL(
                  entry.url
                ).hostname;
            } catch {
              source =
                'RSS Feed';
            }
          }

          source =
            source.slice(
              0,
              120
            );

          const articles = [];
          const videos = [];

          const items =
            (feed.items || [])
              .slice(
                0,
                MAX_ITEMS_PER_FEED
              );

          for (const item of items) {
            const isVideo =
              entry.type ===
                'video' ||
              looksLikeVideo(
                item
              );

            if (isVideo) {
              const video =
                videoRowFromItem(
                  item,
                  entry.url,
                  source
                );

              if (video) {
                videos.push(video);
              }
            } else {
              const article =
                articleRowFromItem(
                  item,
                  entry.url,
                  source
                );

              if (article) {
                articles.push(article);
              }
            }
          }

          return {
            ok: true,

            url:
              entry.url,

            type:
              entry.type,

            source,

            latency,

            articles,

            videos
          };
        } catch (error) {
          console.error(
            '[SYNC] RSS failed:',
            entry.url,
            error?.message || error
          );

          return {
            ok: false,

            url:
              entry.url,

            type:
              entry.type,

            error:
              error?.message ||
              String(error)
          };
        }
      }
    );

  const articleRows =
    results.flatMap(
      (result) =>
        result.articles || []
    );

  const videoRows =
    results.flatMap(
      (result) =>
        result.videos || []
    );

  const failedFeeds =
    results.filter(
      (result) =>
        result &&
        result.ok === false
    );

  const skippedFeeds =
    results.filter(
      (result) =>
        result?.skipped
    );

  const articlesUpserted =
    await saveArticles(
      articleRows
    );

  const videoResult =
    await saveVideos(
      videoRows
    );

  /*
   * Optional database intelligence rebuild.
   *
   * IMPORTANT:
   * Do not use:
   *
   * supabase.rpc(...).catch(...)
   *
   * because Supabase query builders may not expose
   * .catch() directly.
   */

  const remainingMs =
    deadline -
    Date.now();

  if (remainingMs > 5000) {
    try {
      const { error } =
        await supabase.rpc(
          'rebuild_article_intelligence'
        );

      if (error) {
        console.error(
          '[SYNC] rebuild_article_intelligence:',
          error.message
        );
      }
    } catch (error) {
      console.error(
        '[SYNC] intelligence rebuild failed:',
        error?.message || error
      );
    }
  }

  if (remainingMs > 10000) {
    try {
      const { error } =
        await supabase.rpc(
          'rebuild_live_events'
        );

      if (error) {
        console.error(
          '[SYNC] rebuild_live_events:',
          error.message
        );
      }
    } catch (error) {
      console.error(
        '[SYNC] live events rebuild failed:',
        error?.message || error
      );
    }
  }

  return {
    ok: true,

    feeds:
      limitedEntries.length,

    processedFeeds:
      results.filter(
        (result) =>
          result?.ok
      ).length,

    failedFeeds:
      failedFeeds.length,

    skippedFeeds:
      skippedFeeds.length,

    articles:
      articlesUpserted,

    videos:
      videoResult.inserted,

    existingVideos:
      videoResult.existing,

    durationMs:
      Date.now() -
      startedAt,

    at:
      new Date().toISOString(),

    errors:
      failedFeeds.map(
        (feed) => ({
          url:
            feed.url,

          error:
            feed.error
        })
      )
  };
}

if (
  import.meta.url ===
  `file://${process.argv[1]}`
) {
  syncFeeds()
    .then((result) => {
      console.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );
    })
    .catch((error) => {
      console.error(error);

      process.exitCode = 1;
    });
}
