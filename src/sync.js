import 'dotenv/config';

import crypto from 'node:crypto';

import Parser from 'rss-parser';

import {
  supabase
} from './supabase.js';


/* =========================================================
   CONFIG
========================================================= */

const RSS_TIMEOUT =
  Number(
    process.env.RSS_TIMEOUT
  ) || 12000;


const RSS_RETRIES =
  Number(
    process.env.RSS_RETRIES
  ) || 2;


const MAX_ITEMS_PER_FEED =
  Number(
    process.env.MAX_ITEMS_PER_FEED
  ) || 40;


const MAX_VIDEO_ITEMS_PER_FEED =
  Number(
    process.env.MAX_VIDEO_ITEMS_PER_FEED
  ) || 25;


const SYNC_LOCK_TTL =
  Number(
    process.env.SYNC_LOCK_TTL
  ) || 240;


/* =========================================================
   RSS PARSER
========================================================= */

const parser =
  new Parser({

    timeout:
      RSS_TIMEOUT,

    headers: {

      'User-Agent':
        'BeritaMudaIndonesia/6.0 RSS Sync'

    },

    customFields: {

      item: [

        [
          'content:encoded',
          'contentEncoded'
        ],

        [
          'media:content',
          'mediaContent'
        ],

        [
          'media:thumbnail',
          'mediaThumbnail'
        ],

        [
          'yt:videoId',
          'youtubeVideoId'
        ]

      ]

    }

  });


/* =========================================================
   ENVIRONMENT FEEDS
========================================================= */

function parseFeeds(
  value = ''
) {

  return String(value)

    .split(
      /[\n,]+/
    )

    .map(
      item =>
        item.trim()
    )

    .filter(Boolean)

    .filter(
      item =>
        /^https?:\/\//i.test(
          item
        )
    );

}


/*
 * RSS berita
 *
 * Contoh:
 *
 * RSS_FEEDS=
 * https://example.com/rss,
 * https://example.com/feed
 */

const articleFeeds =
  parseFeeds(
    process.env.RSS_FEEDS
  );


/*
 * RSS video
 *
 * Bisa menggunakan:
 *
 * VIDEO_FEEDS
 *
 * Contoh YouTube:
 *
 * https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
 */

const videoFeeds =
  parseFeeds(
    process.env.VIDEO_FEEDS
  );


/* =========================================================
   HELPERS
========================================================= */

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}


function stripHtml(
  value = ''
) {

  return String(value)

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ' '
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ' '
    )

    .replace(
      /<[^>]+>/g,
      ' '
    )

    .replace(
      /&nbsp;/gi,
      ' '
    )

    .replace(
      /&amp;/gi,
      '&'
    )

    .replace(
      /&quot;/gi,
      '"'
    )

    .replace(
      /&#39;/gi,
      "'"
    )

    .replace(
      /\s+/g,
      ' '
    )

    .trim();

}


function safeHtml(
  value = ''
) {

  return String(value)

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
    )

    .trim();

}


function normalizeText(
  value = ''
) {

  return stripHtml(
    value
  )

    .toLowerCase()

    .replace(
      /[^\p{L}\p{N}\s]/gu,
      ' '
    )

    .replace(
      /\s+/g,
      ' '
    )

    .trim();

}


function hash(
  value = ''
) {

  return crypto

    .createHash(
      'sha256'
    )

    .update(
      String(value)
    )

    .digest(
      'hex'
    );

}


function canonicalUrl(
  value = ''
) {

  try {

    const url =
      new URL(
        value
      );


    url.hash =
      '';


    const remove =
      [

        'fbclid',

        'gclid',

        'utm_source',

        'utm_medium',

        'utm_campaign',

        'utm_term',

        'utm_content'

      ];


    for (
      const key
      of remove
    ) {

      url.searchParams.delete(
        key
      );

    }


    for (
      const key
      of [
        ...url.searchParams.keys()
      ]
    ) {

      if (

        key
          .toLowerCase()
          .startsWith(
            'utm_'
          )

      ) {

        url.searchParams.delete(
          key
        );

      }

    }


    url.hostname =
      url.hostname
        .toLowerCase();


    if (

      url.pathname !==
      '/'

    ) {

      url.pathname =
        url.pathname.replace(
          /\/+$/,
          ''
        );

    }


    return url.toString();

  }

  catch {

    return String(
      value ||
      ''
    ).trim();

  }

}


/* =========================================================
   CATEGORY DETECTION
========================================================= */

function categoryFor(
  text = ''
) {

  const value =
    String(text)
      .toLowerCase();


  const rules = [

    {

      category:
        'POLITIK',

      keywords:
        [
          'politik',
          'presiden',
          'menteri',
          'pemerintah',
          'dpr',
          'pilkada',
          'pemilu'
        ]

    },

    {

      category:
        'EKONOMI',

      keywords:
        [
          'ekonomi',
          'bisnis',
          'saham',
          'bank',
          'investasi',
          'keuangan',
          'rupiah'
        ]

    },

    {

      category:
        'TEKNOLOGI',

      keywords:
        [
          'teknologi',
          'digital',
          'internet',
          'ai',
          'artificial intelligence',
          'startup'
        ]

    },

    {

      category:
        'OLAHRAGA',

      keywords:
        [
          'olahraga',
          'sport',
          'bola',
          'sepak bola',
          'football',
          'liga'
        ]

    },

    {

      category:
        'HIBURAN',

      keywords:
        [
          'hiburan',
          'musik',
          'film',
          'artis',
          'selebriti',
          'entertainment'
        ]

    },

    {

      category:
        'INTERNASIONAL',

      keywords:
        [
          'internasional',
          'dunia',
          'global',
          'amerika',
          'eropa',
          'asia'
        ]

    },

    {

      category:
        'KESEHATAN',

      keywords:
        [
          'kesehatan',
          'rumah sakit',
          'dokter',
          'medis',
          'penyakit'
        ]

    },

    {

      category:
        'PENDIDIKAN',

      keywords:
        [
          'pendidikan',
          'sekolah',
          'kampus',
          'universitas',
          'mahasiswa'
        ]

    }

  ];


  for (
    const rule
    of rules
  ) {

    for (
      const keyword
      of rule.keywords
    ) {

      if (
        value.includes(
          keyword
        )
      ) {

        return rule.category;

      }

    }

  }


  return 'NASIONAL';

}


/* =========================================================
   AUTHOR
========================================================= */

function authorOf(
  item = {}
) {

  const value =

    item.creator ||

    item.author ||

    item['dc:creator'] ||

    item['dc:Creator'] ||

    item.itunes?.author ||

    '';


  return String(
    value
  )

    .trim()

    .slice(
      0,
      160
    )

    || null;

}


/* =========================================================
   ITEM URL
========================================================= */

function itemUrl(
  item = {}
) {

  if (

    typeof item.link ===
    'string'

  ) {

    return item.link;

  }


  if (

    item.link &&
    typeof item.link ===
    'object'

  ) {

    return (

      item.link.href ||

      item.link.url ||

      ''

    );

  }


  return (

    item.guid ||

    item.id ||

    ''

  );

}


/* =========================================================
   IMAGE
========================================================= */

function imageOf(
  item = {}
) {

  const candidates =
    [

      item?.enclosure?.url,

      item?.mediaContent?.url,

      item?.mediaContent,

      item?.mediaThumbnail?.url,

      item?.mediaThumbnail,

      item?.['media:content']?.url,

      item?.['media:thumbnail']?.url,

      item?.itunes?.image,

      item?.image?.url,

      item?.image,

      item?.thumbnail,

      item?.thumbnail_url,

      item?.image_url

    ];


  for (
    const candidate
    of candidates
  ) {

    if (

      typeof candidate ===
      'string'

    ) {

      const value =
        candidate.trim();


      if (

        /^https?:\/\//i.test(
          value
        )

      ) {

        return value;

      }

    }


    if (

      candidate &&
      typeof candidate ===
      'object'

    ) {

      const value =

        candidate.url ||

        candidate.href ||

        candidate.$?.url ||

        null;


      if (

        value &&
        /^https?:\/\//i.test(
          value
        )

      ) {

        return value;

      }

    }

  }


  return null;

}


/* =========================================================
   YOUTUBE VIDEO ID
========================================================= */

function youtubeIdFromUrl(
  value = ''
) {

  try {

    const url =
      new URL(
        value
      );


    if (

      url.hostname ===
      'youtu.be'

    ) {

      return (
        url.pathname
          .split('/')
          .filter(Boolean)[0]
        ||
        null
      );

    }


    if (

      url.hostname.includes(
        'youtube.com'
      )

    ) {

      const id =
        url.searchParams.get(
          'v'
        );


      if (
        id
      ) {

        return id;

      }


      const parts =
        url.pathname
          .split('/')
          .filter(Boolean);


      const index =
        parts.findIndex(
          value =>

            value ===
            'shorts'

            ||

            value ===
            'embed'
        );


      if (

        index >= 0 &&

        parts[
          index + 1
        ]

      ) {

        return parts[
          index + 1
        ];

      }

    }

  }

  catch {

    return null;

  }


  return null;

}


/* =========================================================
   VIDEO URL
========================================================= */

function videoUrlOf(
  item = {}
) {

  const direct =
    itemUrl(
      item
    );


  const youtubeId =

    item.youtubeVideoId ||

    item['yt:videoId'] ||

    youtubeIdFromUrl(
      direct
    );


  if (
    youtubeId
  ) {

    return (
      `https://www.youtube.com/watch?v=${youtubeId}`
    );

  }


  const enclosure =
    item?.enclosure?.url;


  if (

    enclosure &&
    /^https?:\/\//i.test(
      enclosure
    )

  ) {

    return enclosure;

  }


  return direct || null;

}


/* =========================================================
   VIDEO THUMBNAIL
========================================================= */

function videoThumbnailOf(
  item = {}
) {

  const existing =
    imageOf(
      item
    );


  if (
    existing
  ) {

    return existing;

  }


  const videoUrl =
    videoUrlOf(
      item
    );


  const youtubeId =
    youtubeIdFromUrl(
      videoUrl
    );


  if (
    youtubeId
  ) {

    return (
      `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
    );

  }


  return null;

}


/* =========================================================
   SAFE RPC
========================================================= */

async function safeRpc(
  name,
  parameters = {}
) {

  try {

    const {
      data,
      error
    } =
      await supabase.rpc(
        name,
        parameters
      );


    if (
      error
    ) {

      console.warn(

        `[SYNC] RPC ${name}:`,

        error.message ||
        error

      );


      return {

        ok:
          false,

        error

      };

    }


    return {

      ok:
        true,

      data

    };

  }

  catch (
    error
  ) {

    console.warn(

      `[SYNC] RPC ${name} failed:`,

      error.message ||
      error

    );


    return {

      ok:
        false,

      error

    };

  }

}


/* =========================================================
   FETCH FEED
========================================================= */

async function fetchFeed(
  feedUrl
) {

  let lastError =
    null;


  for (

    let attempt = 0;

    attempt <=
    RSS_RETRIES;

    attempt++

  ) {

    try {

      const feed =
        await parser.parseURL(
          feedUrl
        );


      return feed;

    }

    catch (
      error
    ) {

      lastError =
        error;


      if (

        attempt <
        RSS_RETRIES

      ) {

        await sleep(

          700 *
          (
            attempt +
            1
          )

        );

      }

    }

  }


  throw lastError;

}


/* =========================================================
   ARTICLE ROW
========================================================= */

function createArticleRow({

  item,

  feedUrl,

  source

}) {

  const title =
    stripHtml(
      item.title ||
      ''
    )

      .slice(
        0,
        500
      );


  const url =
    canonicalUrl(
      itemUrl(
        item
      )
    );


  if (

    !title ||

    !url

  ) {

    return null;

  }


  const rawContent =

    item.contentEncoded ||

    item['content:encoded'] ||

    item.content ||

    item.contentSnippet ||

    item.summary ||

    item.description ||

    '';


  const content =
    stripHtml(
      rawContent
    );


  const contentHtml =
    safeHtml(

      item.contentEncoded ||

      item['content:encoded'] ||

      item.content ||

      ''

    );


  const category =
    categoryFor(

      `${title} ${feedUrl}`

    );


  const publishedAt =

    item.isoDate ||

    item.pubDate ||

    item.published ||

    new Date()
      .toISOString();


  const summary =
    content

      .slice(
        0,
        1000
      );


  return {

    title,

    summary,

    content:

      content
        .slice(
          0,
          50000
        )

      ||

      null,


    content_html:

      contentHtml
        .slice(
          0,
          50000
        )

      ||

      null,


    url,

    canonical_url:
      url,


    source_url:
      url,


    image_url:
      imageOf(
        item
      ),


    source,


    author_name:
      authorOf(
        item
      ),


    category,


    tags:
      [],


    published_at:
      publishedAt,


    status:
      'published',


    content_source:
      'rss',


    content_available:
      content.length >=
      80,


    editorial_status:
      'auto',


    content_fingerprint:

      hash(

        `${normalizeText(title)}|${url}`

      ),


    event_key:

      hash(

        `${normalizeText(title).split(' ').slice(0, 12).join(' ')}|${category}`

      )

        .slice(
          0,
          32
        )

  };

}


/* =========================================================
   VIDEO ROW
========================================================= */

function createVideoRow({

  item,

  feedUrl,

  source

}) {

  const title =
    stripHtml(
      item.title ||
      ''
    )

      .slice(
        0,
        500
      );


  const videoUrl =
    videoUrlOf(
      item
    );


  if (

    !title ||

    !videoUrl

  ) {

    return null;

  }


  const rawDescription =

    item.contentSnippet ||

    item.summary ||

    item.description ||

    item.content ||

    '';


  const description =
    stripHtml(
      rawDescription
    )

      .slice(
        0,
        5000
      );


  const category =
    categoryFor(

      `${title} ${feedUrl}`

    );


  const publishedAt =

    item.isoDate ||

    item.pubDate ||

    item.published ||

    new Date()
      .toISOString();


  return {

    title,


    description:
      description ||
      null,


    video_url:
      canonicalUrl(
        videoUrl
      ),


    thumbnail_url:
      videoThumbnailOf(
        item
      ),


    source,


    category,


    author_name:
      authorOf(
        item
      ),


    tags:
      [],


    status:
      'published',


    created_at:
      publishedAt,


    updated_at:

      new Date()
        .toISOString()

  };

}


/* =========================================================
   SAVE ARTICLES
========================================================= */

async function saveArticles(
  rows
) {

  if (
    !rows.length
  ) {

    return 0;

  }


  let saved =
    0;


  for (
    const row
    of rows
  ) {

    try {

      const existing =
        await supabase

          .from(
            'articles'
          )

          .select(
            'id'
          )

          .eq(
            'url',
            row.url
          )

          .maybeSingle();


      if (
        existing.error
      ) {

        throw existing.error;

      }


      if (
        existing.data
      ) {

        const {
          error
        } =
          await supabase

            .from(
              'articles'
            )

            .update({

              ...row,

              updated_at:

                new Date()
                  .toISOString()

            })

            .eq(
              'id',
              existing.data.id
            );


        if (
          error
        ) {

          throw error;

        }

      }

      else {

        const {
          error
        } =
          await supabase

            .from(
              'articles'
            )

            .insert(
              row
            );


        if (
          error
        ) {

          throw error;

        }

      }


      saved++;

    }

    catch (
      error
    ) {

      console.error(

        '[SYNC ARTICLE]',

        row.title,

        error.message ||
        error

      );

    }

  }


  return saved;

}


/* =========================================================
   SAVE VIDEOS

   Tidak memakai onConflict karena struktur constraint
   tabel videos di project bisa berbeda.

   Sistem akan cek video_url terlebih dahulu.
========================================================= */

async function saveVideos(
  rows
) {

  if (
    !rows.length
  ) {

    return 0;

  }


  let saved =
    0;


  for (
    const row
    of rows
  ) {

    try {

      const existing =
        await supabase

          .from(
            'videos'
          )

          .select(
            'id'
          )

          .eq(
            'video_url',
            row.video_url
          )

          .maybeSingle();


      if (
        existing.error
      ) {

        throw existing.error;

      }


      if (
        existing.data
      ) {

        const {
          error
        } =
          await supabase

            .from(
              'videos'
            )

            .update({

              title:
                row.title,

              description:
                row.description,

              thumbnail_url:
                row.thumbnail_url,

              source:
                row.source,

              category:
                row.category,

              author_name:
                row.author_name,

              tags:
                row.tags,

              status:
                'published',

              updated_at:

                new Date()
                  .toISOString()

            })

            .eq(
              'id',
              existing.data.id
            );


        if (
          error
        ) {

          throw error;

        }

      }

      else {

        const {
          error
        } =
          await supabase

            .from(
              'videos'
            )

            .insert(
              row
            );


        if (
          error
        ) {

          throw error;

        }

      }


      saved++;

    }

    catch (
      error
    ) {

      console.error(

        '[SYNC VIDEO]',

        row.title,

        error.message ||
        error

      );

    }

  }


  return saved;

}


/* =========================================================
   SYNC ONE ARTICLE FEED
========================================================= */

async function syncArticleFeed(
  feedUrl
) {

  const started =
    Date.now();


  try {

    const feed =
      await fetchFeed(
        feedUrl
      );


    const source =
      String(

        feed.title ||

        new URL(
          feedUrl
        ).hostname ||

        'RSS'

      )

        .trim()

        .slice(
          0,
          120
        );


    const rows =
      (

        feed.items ||

        []

      )

        .slice(
          0,
          MAX_ITEMS_PER_FEED
        )

        .map(

          item =>

            createArticleRow({

              item,

              feedUrl,

              source

            })

        )

        .filter(
          Boolean
        );


    const saved =
      await saveArticles(
        rows
      );


    return {

      ok:
        true,


      type:
        'article',


      feedUrl,


      source,


      found:
        rows.length,


      saved,


      duration:
        Date.now() -
        started

    };

  }

  catch (
    error
  ) {

    console.error(

      '[ARTICLE FEED ERROR]',

      feedUrl,

      error.message ||
      error

    );


    return {

      ok:
        false,


      type:
        'article',


      feedUrl,


      found:
        0,


      saved:
        0,


      duration:
        Date.now() -
        started,


      error:

        error.message ||

        String(
          error
        )

    };

  }

}


/* =========================================================
   SYNC ONE VIDEO FEED
========================================================= */

async function syncVideoFeed(
  feedUrl
) {

  const started =
    Date.now();


  try {

    const feed =
      await fetchFeed(
        feedUrl
      );


    const source =
      String(

        feed.title ||

        new URL(
          feedUrl
        ).hostname ||

        'VIDEO'

      )

        .trim()

        .slice(
          0,
          120
        );


    const rows =
      (

        feed.items ||

        []

      )

        .slice(
          0,
          MAX_VIDEO_ITEMS_PER_FEED
        )

        .map(

          item =>

            createVideoRow({

              item,

              feedUrl,

              source

            })

        )

        .filter(
          Boolean
        );


    const saved =
      await saveVideos(
        rows
      );


    return {

      ok:
        true,


      type:
        'video',


      feedUrl,


      source,


      found:
        rows.length,


      saved,


      duration:
        Date.now() -
        started

    };

  }

  catch (
    error
  ) {

    console.error(

      '[VIDEO FEED ERROR]',

      feedUrl,

      error.message ||
      error

    );


    return {

      ok:
        false,


      type:
        'video',


      feedUrl,


      found:
        0,


      saved:
        0,


      duration:
        Date.now() -
        started,


      error:

        error.message ||

        String(
          error
        )

    };

  }

}


/* =========================================================
   MAIN SYNC
========================================================= */

export async function syncFeeds() {

  const startedAt =
    new Date()
      .toISOString();


  /*
   * Total feeds
   */

  const totalFeeds =
    articleFeeds.length +
    videoFeeds.length;


  if (
    totalFeeds === 0
  ) {

    return {

      ok:
        true,


      skipped:
        true,


      reason:
        'RSS_FEEDS dan VIDEO_FEEDS kosong',


      articles:
        {

          feeds:
            0,

          found:
            0,

          saved:
            0

        },


      videos:
        {

          feeds:
            0,

          found:
            0,

          saved:
            0

        },


      startedAt,


      finishedAt:

        new Date()
          .toISOString()

    };

  }


  /*
   * Sync lock.
   *
   * Jika RPC lock belum tersedia,
   * sync tetap berjalan.
   */

  const lockResult =
    await safeRpc(

      'acquire_sync_lock',

      {

        p_name:
          'news-sync',

        p_ttl_seconds:
          SYNC_LOCK_TTL

      }

    );


  if (

    lockResult.ok &&

    lockResult.data ===
    false

  ) {

    return {

      ok:
        true,


      skipped:
        true,


      reason:
        'sync_locked'


    };

  }


  const results =
    [];


  let articleFound =
    0;


  let articleSaved =
    0;


  let videoFound =
    0;


  let videoSaved =
    0;


  let failed =
    0;


  try {

    /* =====================================================
       ARTICLE FEEDS
    ===================================================== */

    for (
      const feedUrl
      of articleFeeds
    ) {

      const result =
        await syncArticleFeed(
          feedUrl
        );


      results.push(
        result
      );


      articleFound +=
        result.found ||
        0;


      articleSaved +=
        result.saved ||
        0;


      if (
        !result.ok
      ) {

        failed++;

      }

    }


    /* =====================================================
       VIDEO FEEDS
    ===================================================== */

    for (
      const feedUrl
      of videoFeeds
    ) {

      const result =
        await syncVideoFeed(
          feedUrl
        );


      results.push(
        result
      );


      videoFound +=
        result.found ||
        0;


      videoSaved +=
        result.saved ||
        0;


      if (
        !result.ok
      ) {

        failed++;

      }

    }


    /*
     * Intelligence optional.
     */

    await safeRpc(
      'rebuild_article_intelligence'
    );


    await safeRpc(
      'rebuild_trending'
    );


    await safeRpc(
      'rebuild_live_events'
    );


    const finishedAt =
      new Date()
        .toISOString();


    return {

      ok:

        failed <
        totalFeeds,


      status:

        failed === 0

          ? 'success'

          : failed <
            totalFeeds

            ? 'partial'

            : 'failed',


      articles:

        {

          feeds:
            articleFeeds.length,

          found:
            articleFound,

          saved:
            articleSaved

        },


      videos:

        {

          feeds:
            videoFeeds.length,

          found:
            videoFound,

          saved:
            videoSaved

        },


      failed,


      results,


      startedAt,


      finishedAt

    };

  }

  finally {

    if (
      lockResult.ok
    ) {

      await safeRpc(

        'release_sync_lock',

        {

          p_name:
            'news-sync'

        }

      );

    }

  }

}


/* =========================================================
   DIRECT RUN
========================================================= */

if (

  process.argv[1] &&

  import.meta.url ===
  `file://${process.argv[1]}`

) {

  try {

    const result =
      await syncFeeds();


    console.log(

      JSON.stringify(

        result,

        null,

        2

      )

    );

  }

  catch (
    error
  ) {

    console.error(
      error
    );


    process.exitCode =
      1;

  }

}
