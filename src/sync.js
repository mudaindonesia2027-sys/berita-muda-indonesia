import 'dotenv/config';

import crypto from 'node:crypto';

import Parser from 'rss-parser';

import {
  supabase
} from './supabase.js';


/* =========================================================
   BERITA MUDA INDONESIA
   RSS SYNC - PRODUCTION ADVANCED

   Features:
   - 50–100+ RSS feeds
   - Priority processing
   - Bounded parallel workers
   - Adaptive safe concurrency
   - Per-feed timeout
   - Global sync deadline
   - Retry + exponential backoff
   - Circuit breaker
   - Feed health monitoring
   - Global run deduplication
   - Batch database upsert
   - Safe Supabase RPC handling
   - Sync lock
   - Detailed statistics
   - Error isolation
========================================================= */


/* =========================================================
   CONFIG HELPERS
========================================================= */

const envNumber =
  (
    name,
    fallback,
    min,
    max
  ) => {

    const value =
      Number(
        process.env[name]
      );

    if (
      !Number.isFinite(
        value
      )
    ) {

      return fallback;

    }

    return Math.max(
      min,
      Math.min(
        value,
        max
      )
    );

  };


/* =========================================================
   CONFIG
========================================================= */


/*
  RSS workers berjalan bersamaan.

  Rekomendasi:
  5 untuk Vercel awal.
*/

const RSS_CONCURRENCY =
  envNumber(
    'RSS_CONCURRENCY',
    5,
    1,
    10
  );


/*
  Timeout setiap RSS.
*/

const RSS_TIMEOUT_MS =
  envNumber(
    'RSS_TIMEOUT_MS',
    12000,
    3000,
    30000
  );


/*
  Retry maksimal.
*/

const RSS_RETRIES =
  envNumber(
    'RSS_RETRIES',
    2,
    0,
    3
  );


/*
  Maksimal artikel diambil dari satu feed.
*/

const MAX_ITEMS_PER_FEED =
  envNumber(
    'MAX_ITEMS_PER_FEED',
    10,
    1,
    50
  );


/*
  Maksimal waktu seluruh sync.

  Harus disesuaikan dengan batas
  serverless function Anda.

  Default 45 detik.
*/

const GLOBAL_SYNC_TIMEOUT_MS =
  envNumber(
    'GLOBAL_SYNC_TIMEOUT_MS',
    45000,
    10000,
    300000
  );


/*
  Berhenti mengambil feed baru
  sebelum batas waktu benar-benar habis.
*/

const GLOBAL_TIMEOUT_BUFFER_MS =
  envNumber(
    'GLOBAL_TIMEOUT_BUFFER_MS',
    5000,
    1000,
    30000
  );


/*
  TTL lock.

  15 menit.
*/

const SYNC_LOCK_TTL =
  envNumber(
    'SYNC_LOCK_TTL',
    900,
    120,
    3600
  );


/*
  Jika feed gagal sebanyak angka ini,
  feed dianggap unhealthy.

  Pada sync berikutnya feed unhealthy
  akan dilewati sementara.
*/

const CIRCUIT_BREAKER_FAILURES =
  envNumber(
    'CIRCUIT_BREAKER_FAILURES',
    3,
    2,
    20
  );


/*
  Batas batch database.
*/

const DB_BATCH_SIZE =
  envNumber(
    'DB_BATCH_SIZE',
    50,
    10,
    200
);


/* =========================================================
   RSS PARSER
========================================================= */

const parser =
  new Parser({

    timeout:
      RSS_TIMEOUT_MS,


    headers: {

      'User-Agent':

        'BeritaMudaIndonesia/6.0 (+news aggregator)'

    }

  });


/* =========================================================
   RSS FEEDS
========================================================= */

const feeds =
  [

    ...new Set(

      (
        process.env.RSS_FEEDS ||
        ''
      )

        .split(',')

        .map(
          value =>
            value.trim()
        )

        .filter(
          Boolean
        )

    )

  ];


/* =========================================================
   TIME
========================================================= */

const nowIso =
  () =>
    new Date()
      .toISOString();


const sleep =
  milliseconds =>

    new Promise(
      resolve =>
        setTimeout(
          resolve,
          milliseconds
        )
    );


/* =========================================================
   STRING HELPERS
========================================================= */

const stripHtml =
  (
    value = ''
  ) =>

    String(
      value
    )

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


const safeHtmlFromFeed =
  (
    raw = ''
  ) =>

    String(
      raw
    )

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


const normalizeTitle =
  (
    value = ''
  ) =>

    stripHtml(
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


/* =========================================================
   URL NORMALIZATION
========================================================= */

const canonicalUrl =
  (
    raw = ''
  ) => {

    try {

      const url =
        new URL(
          raw
        );


      url.hash =
        '';


      const trackingKeys =
        [

          'utm_source',

          'utm_medium',

          'utm_campaign',

          'utm_term',

          'utm_content',

          'fbclid',

          'gclid',

          'mc_cid',

          'mc_eid',

          'igshid'

        ];


      for (

        const key
        of trackingKeys

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
        raw ||
        ''
      )

        .trim();

    }

  };


/* =========================================================
   FINGERPRINT
========================================================= */

const fingerprintOf =
  ({
    title,
    summary,
    source
  }) =>

    crypto

      .createHash(
        'sha256'
      )

      .update(

        `${normalizeTitle(title)}|${stripHtml(summary).slice(0, 500)}|${String(source || '').toLowerCase()}`

      )

      .digest(
        'hex'
      );


/* =========================================================
   EVENT KEY

   Sengaja tidak menggunakan source.

   Tujuannya:
   berita dari banyak publisher tentang
   peristiwa yang sama bisa memiliki
   event key yang sama.
========================================================= */

const eventKeyOf =
  ({
    title,
    category
  }) =>

    crypto

      .createHash(
        'sha256'
      )

      .update(

        `${normalizeTitle(title)

          .split(' ')

          .slice(
            0,
            14
          )

          .join(
            ' '
          )

        }|${category || ''}`

      )

      .digest(
        'hex'
      )

      .slice(
        0,
        32
      );


/* =========================================================
   CATEGORY
========================================================= */

const categoryFor =
  (
    url,
    title = ''
  ) => {

    const text =
      `${url} ${title}`
        .toLowerCase();


    const categories =
      [

        {
          category:
            'POLITIK',

          keywords:
            [

              'politik',

              'pemilu',

              'pilkada',

              'partai',

              'presiden',

              'dpr',

              'pemerintah'

            ]
        },


        {
          category:
            'HUKUM',

          keywords:
            [

              'hukum',

              'pengadilan',

              'kejaksaan',

              'korupsi',

              'tersangka',

              'kepolisian',

              'polisi'

            ]
        },


        {
          category:
            'EKONOMI',

          keywords:
            [

              'ekonomi',

              'bisnis',

              'keuangan',

              'bank',

              'saham',

              'investasi',

              'finansial'

            ]
        },


        {
          category:
            'TEKNOLOGI',

          keywords:
            [

              'teknologi',

              'technology',

              'digital',

              'internet',

              'gadget',

              'startup',

              'artificial intelligence'

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

              'football',

              'sepak bola',

              'badminton',

              'bulutangkis'

            ]
        },


        {
          category:
            'INTERNASIONAL',

          keywords:
            [

              'internasional',

              'international',

              'world',

              'dunia'

            ]
        },


        {
          category:
            'HIBURAN',

          keywords:
            [

              'hiburan',

              'film',

              'musik',

              'artis',

              'seleb',

              'entertainment'

            ]
        },


        {
          category:
            'LIFESTYLE',

          keywords:
            [

              'lifestyle',

              'gaya hidup',

              'kuliner',

              'fashion',

              'wisata',

              'travel'

            ]
        }

      ];


    for (

      const item
      of categories

    ) {

      if (

        item.keywords.some(
          keyword =>
            text.includes(
              keyword
            )
        )

      ) {

        return item.category;

      }

    }


    return 'NASIONAL';

  };


/* =========================================================
   AUTHOR
========================================================= */

const authorOf =
  item =>

    String(

      item.creator ||

      item.author ||

      item['dc:creator'] ||

      item['dc:Creator'] ||

      ''

    )

      .trim()

      .slice(
        0,
        160
      )

      ||

      null;


/* =========================================================
   IMAGE
========================================================= */

const imageOf =
  item => {

    const candidates =
      [

        item.enclosure?.url,

        item['media:content']?.url,

        item['media:thumbnail']?.url,

        item.itunes?.image,

        item.image?.url,

        item.image

      ];


    return (

      candidates.find(

        value =>

          typeof value ===
          'string' &&

          /^https?:\/\//i.test(
            value
          )

      )

      ||

      null

    );

  };


/* =========================================================
   SOURCE NAME
========================================================= */

const sourceNameFromUrl =
  (
    value
  ) => {

    try {

      return new URL(
        value
      )

        .hostname

        .replace(
          /^www\./,
          ''
        );

    }

    catch {

      return 'RSS';

    }

  };


/* =========================================================
   PRIORITY SYSTEM

   Urutan:

   1. PURWOREJO
   2. JAWA TENGAH
   3. NASIONAL
   4. INTERNASIONAL

   Ini membuat sumber lokal diproses lebih awal.
========================================================= */

const feedPriority =
  (
    url
  ) => {

    const text =
      String(
        url
      )
        .toLowerCase();


    /*
      PRIORITAS 1
      PURWOREJO
    */

    if (

      text.includes(
        'purworejo'
      ) ||

      text.includes(
        'bagelen'
      ) ||

      text.includes(
        'kutoarjo'
      ) ||

      text.includes(
        'pituruh'
      ) ||

      text.includes(
        'bener'
      )

    ) {

      return 1;

    }


    /*
      PRIORITAS 2
      JAWA TENGAH
    */

    if (

      text.includes(
        'jateng'
      ) ||

      text.includes(
        'jawa+tengah'
      ) ||

      text.includes(
        'jawa-tengah'
      ) ||

      text.includes(
        'semarang'
      ) ||

      text.includes(
        'solo'
      ) ||

      text.includes(
        'surakarta'
      ) ||

      text.includes(
        'magelang'
      ) ||

      text.includes(
        'kebumen'
      ) ||

      text.includes(
        'wonosobo'
      ) ||

      text.includes(
        'temanggung'
      ) ||

      text.includes(
        'banyumas'
      ) ||

      text.includes(
        'cilacap'
      )

    ) {

      return 2;

    }


    /*
      PRIORITAS 4
      INTERNASIONAL
    */

    if (

      text.includes(
        'bbc.'
      ) ||

      text.includes(
        'aljazeera'
      ) ||

      text.includes(
        'dw.com'
      ) ||

      text.includes(
        'cna.'
      ) ||

      text.includes(
        'world'
      ) ||

      text.includes(
        'international'
      )

    ) {

      return 4;

    }


    /*
      PRIORITAS 3
      NASIONAL
    */

    return 3;

  };


/* =========================================================
   SORT FEEDS
========================================================= */

const prioritizedFeeds =
  [
    ...feeds
  ]

    .sort(

      (
        a,
        b
      ) =>

        feedPriority(
          a
        )

        -

        feedPriority(
          b
        )

    );


/* =========================================================
   SAFE RPC

   PENTING:

   Jangan:

   supabase.rpc(...).catch(...)

   Gunakan await dulu.
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

      console.error(

        `[SYNC RPC ERROR] ${name}:`,

        error.message ||
        error

      );

    }


    return {

      data,

      error

    };

  }

  catch (
    error
  ) {

    console.error(

      `[SYNC RPC FAILED] ${name}:`,

      error.message ||
      error

    );


    return {

      data:
        null,

      error

    };

  }

}


/* =========================================================
   GET SOURCE HEALTH

   Menggunakan tabel news_sources
   yang sudah dipakai kode lama.
========================================================= */

async function getFeedHealth(
  urls
) {

  const map =
    new Map();


  if (
    !urls.length
  ) {

    return map;

  }


  try {

    const {
      data,
      error
    } =

      await supabase

        .from(
          'news_sources'
        )

        .select(
          `
          feed_url,
          status,
          failure_count,
          last_failure_at,
          last_success_at
          `
        )

        .in(
          'feed_url',
          urls
        );


    if (
      error
    ) {

      console.error(

        '[SYNC] Feed health read failed:',

        error.message ||
        error

      );


      return map;

    }


    for (

      const row
      of data ||
      []

    ) {

      map.set(

        row.feed_url,

        row

      );

    }

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] Feed health exception:',

      error.message ||
      error

    );

  }


  return map;

}


/* =========================================================
   CIRCUIT BREAKER

   Feed dengan kegagalan berulang
   akan dilewati.

   Feed bisa dicoba lagi jika:
   - pernah healthy lagi
   - failure_count belum melewati batas
========================================================= */

const shouldSkipByCircuitBreaker =
  (
    health
  ) => {

    if (
      !health
    ) {

      return false;

    }


    const failures =
      Number(
        health.failure_count ||
        0
      );


    return (

      health.status ===
      'unhealthy'

      &&

      failures >=
      CIRCUIT_BREAKER_FAILURES

    );

  };


/* =========================================================
   FETCH FEED

   Retry + exponential backoff.
========================================================= */

async function fetchFeed(
  url
) {

  let lastError;


  for (

    let attempt = 0;

    attempt <=
    RSS_RETRIES;

    attempt++

  ) {

    const started =
      Date.now();


    try {

      const feed =

        await parser.parseURL(
          url
        );


      return {

        feed,


        latency:

          Date.now() -
          started,


        attempts:

          attempt +
          1

      };

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

        const delay =

          Math.min(

            750 *

            (
              2 **
              attempt
            ),

            5000

          );


        await sleep(
          delay
        );

      }

    }

  }


  throw lastError;

}


/* =========================================================
   BUILD ARTICLE
========================================================= */

function buildArticleRow(
  item,
  feedUrl,
  source
) {

  const rawHtml =

    item['content:encoded'] ||

    item.content ||

    item.summary ||

    item.description ||

    '';


  const plain =

    stripHtml(

      item.contentSnippet ||

      rawHtml ||

      item.summary ||

      item.description ||

      ''

    );


  const contentHtml =

    safeHtmlFromFeed(
      rawHtml
    );


  const rawUrl =

    String(

      item.link ||

      item.guid ||

      ''

    )

      .trim();


  const canonical =

    canonicalUrl(
      rawUrl
    );


  const title =

    String(

      item.title ||

      ''

    )

      .trim()

      .slice(
        0,
        500
      );


  if (

    !title ||

    !rawUrl

  ) {

    return null;

  }


  const category =

    categoryFor(

      feedUrl,

      title

    );


  const publishedAt =

    item.isoDate ||

    item.pubDate ||

    nowIso();


  return {

    title,


    summary:

      plain.slice(
        0,
        600
      ),


    content_html:

      contentHtml.length >=
      80

        ? contentHtml.slice(
            0,
            50000
          )

        : null,


    url:
      rawUrl,


    canonical_url:

      canonical ||
      null,


    content_fingerprint:

      fingerprintOf({

        title,

        summary:
          plain,

        source

      }),


    source_url:
      rawUrl,


    source,


    author_name:

      authorOf(
        item
      ),


    category,


    event_key:

      eventKeyOf({

        title,

        category

      }),


    editorial_status:
      'auto',


    image_url:

      imageOf(
        item
      ),


    published_at:
      publishedAt,


    content_source:

      contentHtml.length >=
      80

        ? 'rss'

        : 'snippet',


    content_available:

      contentHtml.length >=
      80,


    status:
      'published'

  };

}


/* =========================================================
   UPDATE SOURCE SUCCESS
========================================================= */

async function markFeedSuccess(
  {
    url,
    source,
    latency
  }
) {

  try {

    const {
      error
    } =

      await supabase

        .from(
          'news_sources'
        )

        .upsert(

          {

            name:
              source,


            feed_url:
              url,


            active:
              true,


            status:
              'healthy',


            /*
              Reset failure count setelah sukses.
            */

            failure_count:
              0,


            success_count:
              1,


            last_success_at:
              nowIso(),


            last_latency_ms:
              latency,


            updated_at:
              nowIso()

          },

          {

            onConflict:
              'feed_url'

          }

        );


    if (
      error
    ) {

      console.error(

        '[SYNC] markFeedSuccess failed:',

        error.message ||
        error

      );

    }

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] markFeedSuccess exception:',

      error.message ||
      error

    );

  }

}


/* =========================================================
   UPDATE SOURCE FAILURE
========================================================= */

async function markFeedFailure(
  {
    url,
    latency
  }
) {

  try {

    const {
      data:
        existing,
      error:
        existingError
    } =

      await supabase

        .from(
          'news_sources'
        )

        .select(
          'failure_count'
        )

        .eq(
          'feed_url',
          url
        )

        .maybeSingle();


    if (
      existingError
    ) {

      console.error(

        '[SYNC] Failure count read failed:',

        existingError.message ||
        existingError

      );

    }


    const failureCount =

      Number(

        existing?.failure_count ||

        0

      )

      +

      1;


    const status =

      failureCount >=
      CIRCUIT_BREAKER_FAILURES

        ? 'unhealthy'

        : 'degraded';


    const {
      error
    } =

      await supabase

        .from(
          'news_sources'
        )

        .upsert(

          {

            name:

              sourceNameFromUrl(
                url
              ),


            feed_url:
              url,


            active:
              true,


            status,


            failure_count:
              failureCount,


            last_failure_at:
              nowIso(),


            last_latency_ms:
              latency,


            updated_at:
              nowIso()

          },

          {

            onConflict:
              'feed_url'

          }

        );


    if (
      error
    ) {

      console.error(

        '[SYNC] markFeedFailure failed:',

        error.message ||
        error

      );

    }

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] markFeedFailure exception:',

      error.message ||
      error

    );

  }

}


/* =========================================================
   SAVE ARTICLES

   Batch upsert agar database
   tidak menerima terlalu banyak row sekaligus.
========================================================= */

async function saveArticles(
  rows
) {

  let saved =
    0;


  for (

    let index = 0;

    index <
    rows.length;

    index +=
      DB_BATCH_SIZE

  ) {

    const batch =

      rows.slice(

        index,

        index +
        DB_BATCH_SIZE

      );


    const {
      error
    } =

      await supabase

        .from(
          'articles'
        )

        .upsert(

          batch,

          {

            onConflict:
              'url',

            ignoreDuplicates:
              false

          }

        );


    if (
      error
    ) {

      throw error;

    }


    saved +=
      batch.length;

  }


  return saved;

}


/* =========================================================
   PROCESS ONE FEED
========================================================= */

async function processFeed(
  url,
  runState
) {

  const started =
    Date.now();


  try {

    const {
      feed,
      latency,
      attempts
    } =

      await fetchFeed(
        url
      );


    const source =

      String(

        feed.title ||

        sourceNameFromUrl(
          url
        )

      )

        .trim()

        .slice(
          0,
          120
        );


    /*
      Update health terlebih dahulu.
    */

    await markFeedSuccess({

      url,

      source,

      latency

    });


    const rows =
      [];


    const localUrls =
      new Set();


    const localFingerprints =
      new Set();


    const items =

      (
        feed.items ||
        []
      )

        .slice(
          0,
          MAX_ITEMS_PER_FEED
        );


    for (

      const item
      of items

    ) {

      const row =

        buildArticleRow(

          item,

          url,

          source

        );


      if (
        !row
      ) {

        continue;

      }


      /*
        DEDUP DALAM FEED
      */

      if (

        localUrls.has(
          row.canonical_url
        )

      ) {

        continue;

      }


      if (

        localFingerprints.has(
          row.content_fingerprint
        )

      ) {

        continue;

      }


      /*
        GLOBAL RUN DEDUP

        Mencegah artikel sama dari
        banyak feed diproses berulang
        dalam satu sync.
      */

      if (

        runState.seenUrls.has(
          row.canonical_url
        )

      ) {

        continue;

      }


      if (

        runState.seenFingerprints.has(
          row.content_fingerprint
        )

      ) {

        continue;

      }


      localUrls.add(
        row.canonical_url
      );


      localFingerprints.add(
        row.content_fingerprint
      );


      runState.seenUrls.add(
        row.canonical_url
      );


      runState.seenFingerprints.add(
        row.content_fingerprint
      );


      rows.push(
        row
      );

    }


    const saved =

      await saveArticles(
        rows
      );


    return {

      ok:
        true,


      url,


      source,


      priority:

        feedPriority(
          url
        ),


      items:

        items.length,


      rowsSeen:

        rows.length,


      upserted:
        saved,


      failed:
        false,


      latency,


      attempts

    };

  }

  catch (
    error
  ) {

    const latency =

      Date.now() -
      started;


    console.error(

      '[SYNC] RSS FAILED:',

      url,

      error.message ||
      error

    );


    await markFeedFailure({

      url,

      latency

    });


    return {

      ok:
        false,


      failed:
        true,


      url,


      source:

        sourceNameFromUrl(
          url
        ),


      priority:

        feedPriority(
          url
        ),


      rowsSeen:
        0,


      upserted:
        0,


      latency,


      error:

        error.message ||

        String(
          error
        )

    };

  }

}


/* =========================================================
   CONCURRENCY WORKER POOL

   Contoh:

   100 feeds
   concurrency = 5

   Maksimal hanya 5 feed aktif
   bersamaan.
========================================================= */

async function runWorkerPool(
  items,
  worker,
  concurrency,
  shouldStop
) {

  const results =
    [];


  let nextIndex =
    0;


  async function workerLoop() {

    while (
      true
    ) {

      /*
        Stop mengambil pekerjaan baru
        jika global deadline hampir habis.
      */

      if (

        shouldStop()

      ) {

        return;

      }


      const index =
        nextIndex;


      nextIndex +=
        1;


      if (

        index >=
        items.length

      ) {

        return;

      }


      const item =
        items[
          index
        ];


      try {

        const result =

          await worker(
            item
          );


        results.push(
          result
        );

      }

      catch (
        error
      ) {

        results.push({

          ok:
            false,


          failed:
            true,


          url:
            item,


          rowsSeen:
            0,


          upserted:
            0,


          error:

            error.message ||

            String(
              error
            )

        });

      }

    }

  }


  const workerCount =

    Math.min(

      concurrency,

      items.length

    );


  const workers =
    [];


  for (

    let index = 0;

    index <
    workerCount;

    index++

  ) {

    workers.push(
      workerLoop()
    );

  }


  await Promise.all(
    workers
  );


  return {

    results,


    remaining:

      Math.max(

        0,

        items.length -
        nextIndex

      )

  };

}


/* =========================================================
   CREATE SYNC RUN
========================================================= */

async function createSyncRun(
  feedsTotal
) {

  try {

    const {
      data,
      error
    } =

      await supabase

        .from(
          'sync_runs'
        )

        .insert({

          feeds_total:
            feedsTotal,


          status:
            'running'

        })

        .select(
          'id'
        )

        .single();


    if (
      error
    ) {

      console.error(

        '[SYNC] createSyncRun failed:',

        error.message ||
        error

      );


      return null;

    }


    return (
      data?.id ||
      null
    );

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] createSyncRun exception:',

      error.message ||
      error

    );


    return null;

  }

}


/* =========================================================
   FINISH SYNC RUN
========================================================= */

async function finishSyncRun(
  runId,
  payload
) {

  if (
    !runId
  ) {

    return;

  }


  try {

    const {
      error
    } =

      await supabase

        .from(
          'sync_runs'
        )

        .update(
          payload
        )

        .eq(
          'id',
          runId
        );


    if (
      error
    ) {

      console.error(

        '[SYNC] finishSyncRun failed:',

        error.message ||
        error

      );

    }

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] finishSyncRun exception:',

      error.message ||
      error

    );

  }

}


/* =========================================================
   MAIN SYNC
========================================================= */

export async function syncFeeds() {

  const syncStarted =
    Date.now();


  const deadline =

    syncStarted +

    GLOBAL_SYNC_TIMEOUT_MS -

    GLOBAL_TIMEOUT_BUFFER_MS;


  /*
    Tidak ada RSS.
  */

  if (
    prioritizedFeeds.length ===
    0
  ) {

    return {

      ok:
        true,


      skipped:
        true,


      reason:
        'no_rss_feeds',


      feeds:
        0,


      at:
        nowIso()

    };

  }


  /*
    ACQUIRE LOCK
  */

  const lock =

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
    lock.error
  ) {

    throw lock.error;

  }


  if (
    !lock.data
  ) {

    return {

      ok:
        true,


      skipped:
        true,


      reason:
        'sync_locked',


      feeds:
        prioritizedFeeds.length,


      at:
        nowIso()

    };

  }


  let runId =
    null;


  try {

    /*
      CREATE RUN
    */

    runId =

      await createSyncRun(
        prioritizedFeeds.length
      );


    /*
      FEED HEALTH
    */

    const healthMap =

      await getFeedHealth(
        prioritizedFeeds
      );


    /*
      CIRCUIT BREAKER FILTER
    */

    const activeFeeds =
      [];


    const skippedFeeds =
      [];


    for (

      const url
      of prioritizedFeeds

    ) {

      const health =

        healthMap.get(
          url
        );


      if (

        shouldSkipByCircuitBreaker(
          health
        )

      ) {

        skippedFeeds.push({

          url,

          reason:
            'circuit_breaker',

          priority:

            feedPriority(
              url
            )

        });

        continue;

      }


      activeFeeds.push(
        url
      );

    }


    console.log(

      `[SYNC] START`

    );


    console.log(

      `[SYNC] Total feeds: ${prioritizedFeeds.length}`

    );


    console.log(

      `[SYNC] Active feeds: ${activeFeeds.length}`

    );


    console.log(

      `[SYNC] Circuit skipped: ${skippedFeeds.length}`

    );


    console.log(

      `[SYNC] Concurrency: ${RSS_CONCURRENCY}`

    );


    /*
      GLOBAL STATE

      Dipakai untuk deduplikasi
      seluruh sync.
    */

    const runState =
      {

        seenUrls:

          new Set(),


        seenFingerprints:

          new Set()

      };


    /*
      STOP CONDITION
    */

    const shouldStop =
      () =>
        Date.now() >=
        deadline;


    /*
      PARALLEL SYNC
    */

    const {

      results,

      remaining

    } =

      await runWorkerPool(

        activeFeeds,


        url =>

          processFeed(

            url,

            runState

          ),


        RSS_CONCURRENCY,


        shouldStop

      );


    /*
      STATISTICS
    */

    const successful =

      results.filter(

        result =>
          result.ok

      )

        .length;


    const failed =

      results.filter(

        result =>
          result.failed

      )

        .length;


    const rowsSeen =

      results.reduce(

        (
          total,
          result
        ) =>

          total +

          Number(

            result.rowsSeen ||

            0

          ),

        0

      );


    const upserted =

      results.reduce(

        (
          total,
          result
        ) =>

          total +

          Number(

            result.upserted ||

            0

          ),

        0

      );


    const timedOut =

      shouldStop();


    const feedsSkipped =

      skippedFeeds.length;


    const durationMs =

      Date.now() -
      syncStarted;


    /*
      STATUS
    */

    let status =
      'success';


    if (

      failed > 0 ||

      timedOut ||

      remaining > 0

    ) {

      status =

        successful > 0

          ? 'partial'

          : 'failed';

    }


    /*
      POST PROCESSING

      Tidak boleh membuat sync utama gagal.
    */

    await safeRpc(
      'rebuild_article_intelligence'
    );


    /*
      Hanya jalankan jika waktu
      masih cukup.
    */

    if (

      !shouldStop()

    ) {

      await safeRpc(
        'rebuild_live_events'
      );

    }


    /*
      FINISH RUN
    */

    await finishSyncRun(

      runId,

      {

        finished_at:
          nowIso(),


        status,


        feeds_failed:
          failed,


        rows_seen:
          rowsSeen,


        rows_upserted:
          upserted

      }

    );


    /*
      RESULT
    */

    const result =
      {

        ok:
          true,


        status,


        feeds:

          prioritizedFeeds.length,


        feedsActive:

          activeFeeds.length,


        successful,


        failed,


        circuitSkipped:

          feedsSkipped,


        deadlineRemaining:

          remaining,


        timedOut,


        rowsSeen,


        upserted,


        concurrency:

          RSS_CONCURRENCY,


        maxItemsPerFeed:

          MAX_ITEMS_PER_FEED,


        durationMs,


        at:
          nowIso(),


        priority:

          {

            purworejo:

              prioritizedFeeds.filter(

                url =>

                  feedPriority(
                    url
                  ) === 1

              ).length,


            jawaTengah:

              prioritizedFeeds.filter(

                url =>

                  feedPriority(
                    url
                  ) === 2

              ).length,


            nasional:

              prioritizedFeeds.filter(

                url =>

                  feedPriority(
                    url
                  ) === 3

              ).length,


            internasional:

              prioritizedFeeds.filter(

                url =>

                  feedPriority(
                    url
                  ) === 4

              ).length

          },


        errors:

          results

            .filter(

              result =>
                result.failed

            )

            .slice(
              0,
              20
            )

            .map(

              result =>
                ({

                  url:
                    result.url,


                  error:
                    result.error

                })

            )

      };


    console.log(

      '[SYNC] FINISHED',

      JSON.stringify(
        result
      )

    );


    return result;

  }

  catch (
    error
  ) {

    const durationMs =

      Date.now() -
      syncStarted;


    console.error(

      '[SYNC FATAL]',

      error.message ||
      error

    );


    await finishSyncRun(

      runId,

      {

        finished_at:
          nowIso(),


        status:
          'failed',


        error_message:

          error.message ||

          String(
            error
          )

      }

    );


    throw error;

  }

  finally {

    /*
      RELEASE LOCK

      Tidak menggunakan:

      supabase.rpc(...).catch()

      karena itu sebelumnya
      menyebabkan error.
    */

    await safeRpc(

      'release_sync_lock',

      {

        p_name:
          'news-sync'

      }

    );

  }

}


/* =========================================================
   DIRECT EXECUTION

   Bisa dijalankan:

   node src/sync.js
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

      '[SYNC FATAL]',

      error.message ||
      error

    );


    process.exitCode =
      1;

  }

}
