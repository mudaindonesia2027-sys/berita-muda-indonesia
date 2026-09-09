import 'dotenv/config';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'BeritaMudaIndonesia/7.0'
  }
});

/* =========================================================
   RSS FEEDS
========================================================= */

const feeds = (process.env.RSS_FEEDS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);


/* =========================================================
   UTILITIES
========================================================= */

function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function safeHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}


function normalizeUrl(value = '') {
  try {
    const url = new URL(value);

    url.hash = '';

    [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid'
    ].forEach(key => {
      url.searchParams.delete(key);
    });

    return url.toString();

  } catch {
    return String(value).trim();
  }
}


function createFingerprint(title = '', summary = '') {
  return crypto
    .createHash('sha256')
    .update(`${title}|${summary}`.toLowerCase())
    .digest('hex');
}


/* =========================================================
   CATEGORY DETECTION
========================================================= */

function detectCategory(url = '', title = '') {

  const text = `${url} ${title}`.toLowerCase();

  const rules = [
    ['politik', 'POLITIK'],
    ['pemerintahan', 'POLITIK'],
    ['presiden', 'POLITIK'],
    ['ekonomi', 'EKONOMI'],
    ['bisnis', 'EKONOMI'],
    ['keuangan', 'EKONOMI'],
    ['teknologi', 'TEKNOLOGI'],
    ['digital', 'TEKNOLOGI'],
    ['tekno', 'TEKNOLOGI'],
    ['olahraga', 'OLAHRAGA'],
    ['sepakbola', 'OLAHRAGA'],
    ['bola', 'OLAHRAGA'],
    ['internasional', 'INTERNASIONAL'],
    ['dunia', 'INTERNASIONAL'],
    ['hiburan', 'HIBURAN'],
    ['entertainment', 'HIBURAN'],
    ['lifestyle', 'LIFESTYLE'],
    ['kesehatan', 'KESEHATAN'],
    ['pendidikan', 'PENDIDIKAN'],
    ['hukum', 'HUKUM'],
    ['kriminal', 'HUKUM'],
    ['otomotif', 'OTOMOTIF'],
    ['lingkungan', 'LINGKUNGAN']
  ];

  for (const [keyword, category] of rules) {
    if (text.includes(keyword)) {
      return category;
    }
  }

  return 'NASIONAL';
}


/* =========================================================
   AUTHOR
========================================================= */

function getAuthor(item) {

  const author =
    item.creator ||
    item.author ||
    item['dc:creator'] ||
    item['dc:Creator'] ||
    null;

  if (!author) return null;

  return String(author)
    .trim()
    .slice(0, 160);
}


/* =========================================================
   IMAGE
========================================================= */

function getImage(item) {

  if (item.enclosure?.url) {
    const type = String(item.enclosure.type || '');

    if (type.startsWith('image/')) {
      return item.enclosure.url;
    }
  }

  if (item['media:content']?.url) {
    return item['media:content'].url;
  }

  if (item['media:thumbnail']?.url) {
    return item['media:thumbnail'].url;
  }

  if (item.itunes?.image) {
    return item.itunes.image;
  }

  return null;
}


/* =========================================================
   VIDEO DETECTION
========================================================= */

function isVideoFeed(feedUrl = '') {

  const url = feedUrl.toLowerCase();

  return (
    url.includes('/video') ||
    url.includes('/videos') ||
    url.includes('youtube') ||
    url.includes('video.xml')
  );
}


function isVideoItem(item = {}) {

  const enclosureType =
    String(item.enclosure?.type || '').toLowerCase();

  const link =
    String(item.link || '').toLowerCase();

  const guid =
    String(item.guid || '').toLowerCase();

  return (
    enclosureType.startsWith('video/') ||
    link.includes('/video') ||
    guid.includes('/video') ||
    Boolean(item.itunes)
  );
}


function getVideoUrl(item) {

  if (
    item.enclosure?.url &&
    String(item.enclosure?.type || '')
      .toLowerCase()
      .startsWith('video/')
  ) {
    return item.enclosure.url;
  }

  if (item.link) {
    return item.link;
  }

  if (item.guid) {
    return item.guid;
  }

  return null;
}


/* =========================================================
   ARTICLE SYNC
========================================================= */

async function saveArticle({
  item,
  source
}) {

  const originalUrl =
    item.link ||
    item.guid;

  if (!originalUrl) {
    return {
      saved: false,
      reason: 'no_url'
    };
  }

  const url =
    normalizeUrl(originalUrl);

  const title =
    stripHtml(item.title || '')
      .slice(0, 500);

  if (!title) {
    return {
      saved: false,
      reason: 'no_title'
    };
  }

  const rawHtml =
    item['content:encoded'] ||
    item.content ||
    '';

  const html =
    safeHtml(rawHtml);

  const text =
    stripHtml(
      rawHtml ||
      item.contentSnippet ||
      item.summary ||
      item.description ||
      ''
    );

  const summary =
    (
      text ||
      stripHtml(
        item.summary ||
        item.description ||
        ''
      )
    )
      .slice(0, 1000);

  const wordCount =
    text
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const payload = {

    title,

    summary,

    content:
      text || null,

    content_html:
      html.length >= 80
        ? html.slice(0, 50000)
        : null,

    url,

    source_url:
      url,

    canonical_url:
      url,

    source,

    author_name:
      getAuthor(item),

    category:
      detectCategory(url, title),

    image_url:
      getImage(item),

    published_at:
      item.isoDate ||
      item.pubDate ||
      new Date().toISOString(),

    status:
      'published',

    content_source:
      html.length >= 80
        ? 'rss'
        : 'snippet',

    content_available:
      Boolean(text || html),

    content_fingerprint:
      createFingerprint(title, summary),

    reading_minutes:
      Math.max(
        1,
        Math.ceil(wordCount / 220)
      ),

    updated_at:
      new Date().toISOString()
  };

  const { error } =
    await supabase
      .from('articles')
      .upsert(
        payload,
        {
          onConflict: 'url'
        }
      );

  if (error) {
    throw error;
  }

  return {
    saved: true
  };
}


/* =========================================================
   VIDEO SYNC
========================================================= */

async function saveVideo({
  item,
  source
}) {

  const videoUrl =
    getVideoUrl(item);

  if (!videoUrl) {
    return {
      saved: false,
      reason: 'no_video_url'
    };
  }

  const title =
    stripHtml(item.title || '')
      .slice(0, 500);

  if (!title) {
    return {
      saved: false,
      reason: 'no_title'
    };
  }

  const description =
    stripHtml(
      item['content:encoded'] ||
      item.content ||
      item.contentSnippet ||
      item.summary ||
      item.description ||
      ''
    )
      .slice(0, 5000);

  const payload = {

    title,

    description:
      description || null,

    video_url:
      normalizeUrl(videoUrl),

    thumbnail_url:
      getImage(item),

    source,

    category:
      detectCategory(
        videoUrl,
        title
      ),

    status:
      'published',

    updated_at:
      new Date().toISOString()
  };

  /*
    videos tidak terlihat memiliki
    UNIQUE constraint pada video_url.

    Karena itu cek dulu sebelum insert.
  */

  const { data: existing, error: checkError } =
    await supabase
      .from('videos')
      .select('id')
      .eq(
        'video_url',
        payload.video_url
      )
      .limit(1);

  if (checkError) {
    throw checkError;
  }

  if (
    existing &&
    existing.length > 0
  ) {

    const { error } =
      await supabase
        .from('videos')
        .update(payload)
        .eq(
          'id',
          existing[0].id
        );

    if (error) {
      throw error;
    }

  } else {

    const { error } =
      await supabase
        .from('videos')
        .insert(payload);

    if (error) {
      throw error;
    }

  }

  return {
    saved: true
  };
}


/* =========================================================
   MAIN SYNC
========================================================= */

export async function syncFeeds() {

  if (feeds.length === 0) {

    return {

      ok: false,

      message:
        'RSS_FEEDS belum diatur',

      feeds: 0,

      articles: 0,

      videos: 0

    };
  }


  let processedFeeds = 0;

  let processedItems = 0;

  let articlesSaved = 0;

  let videosSaved = 0;

  let failedFeeds = 0;

  const errors = [];


  for (const feedUrl of feeds) {

    try {

      console.log(
        '[SYNC] Fetching:',
        feedUrl
      );

      const feed =
        await parser.parseURL(
          feedUrl
        );

      processedFeeds++;

      const source =
        String(
          feed.title ||
          new URL(feedUrl).hostname
        )
          .slice(0, 160);

      const feedIsVideo =
        isVideoFeed(feedUrl);

      const items =
        (feed.items || [])
          .slice(0, 100);

      processedItems +=
        items.length;


      for (const item of items) {

        try {

          const itemIsVideo =
            feedIsVideo ||
            isVideoItem(item);


          if (itemIsVideo) {

            const result =
              await saveVideo({
                item,
                source
              });

            if (result.saved) {
              videosSaved++;
            }

          } else {

            const result =
              await saveArticle({
                item,
                source
              });

            if (result.saved) {
              articlesSaved++;
            }

          }

        } catch (itemError) {

          console.error(
            '[SYNC ITEM ERROR]',
            itemError.message
          );

        }

      }

    } catch (error) {

      failedFeeds++;

      errors.push({

        feed: feedUrl,

        error: error.message

      });

      console.error(
        '[SYNC FEED ERROR]',
        feedUrl,
        error.message
      );

    }

  }


  /* ===============================================
     OPTIONAL DATABASE REBUILD FUNCTIONS
  =============================================== */

  try {
    await supabase.rpc(
      'rebuild_trending'
    );
  } catch (error) {
    console.log(
      '[TRENDING SKIPPED]',
      error.message
    );
  }


  try {
    await supabase.rpc(
      'rebuild_article_intelligence'
    );
  } catch (_) {}


  try {
    await supabase.rpc(
      'rebuild_live_events'
    );
  } catch (_) {}


  return {

    ok:
      processedFeeds > 0,

    feeds:
      feeds.length,

    processedFeeds,

    processedItems,

    articles:
      articlesSaved,

    videos:
      videosSaved,

    failedFeeds,

    errors,

    updatedAt:
      new Date().toISOString()

  };
}


/* =========================================================
   LOCAL EXECUTION
========================================================= */

if (
  process.argv[1] &&
  import.meta.url ===
  `file://${process.argv[1]}`
) {

  syncFeeds()
    .then(result => {

      console.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );

    })
    .catch(error => {

      console.error(error);

      process.exit(1);

    });

}
