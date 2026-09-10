import 'dotenv/config';

import crypto from 'node:crypto';
import Parser from 'rss-parser';

import {
  supabase
} from './supabase.js';


/* =========================================================
   CONFIG
========================================================= */

const RSS_CONCURRENCY =
  Math.max(
    1,
    Math.min(
      Number(
        process.env.RSS_CONCURRENCY
      ) || 5,
      10
    )
  );


const RSS_TIMEOUT_MS =
  Math.max(
    3000,
    Math.min(
      Number(
        process.env.RSS_TIMEOUT_MS
      ) || 12000,
      30000
    )
  );


const RSS_RETRIES =
  Math.max(
    0,
    Math.min(
      Number(
        process.env.RSS_RETRIES
      ) || 2,
      3
    )
  );


const MAX_ITEMS_PER_FEED =
  Math.max(
    1,
    Math.min(
      Number(
        process.env.MAX_ITEMS_PER_FEED
      ) || 15,
      50
    )
  );


const SYNC_LOCK_TTL =
  Math.max(
    120,
    Math.min(
      Number(
        process.env.SYNC_LOCK_TTL
      ) || 840,
      3600
    )
  );


const parser =
  new Parser({
    timeout:
      RSS_TIMEOUT_MS,

    headers: {
      'User-Agent':
        'BeritaMudaIndonesia/5.3 RSS Sync'
    }
  );


/* =========================================================
   RSS FEEDS
========================================================= */

const feeds =
  (
    process.env.RSS_FEEDS ||
    ''
  )

    .split(',')

    .map(
      value =>
        value.trim()
    )

    .filter(Boolean)

    .filter(
      (
        value,
        index,
        array
      ) =>
        array.indexOf(
          value
        ) === index
    );


/* =========================================================
   HELPERS
========================================================= */

const sleep =
  milliseconds =>

    new Promise(
      resolve =>
        setTimeout(
          resolve,
          milliseconds
        )
    );


const nowIso =
  () =>
    new Date()
      .toISOString();


function withTimeout(
  promise,
  milliseconds,
  label = 'Operation'
) {

  let timer;


  const timeout =
    new Promise(
      (
        resolve,
        reject
      ) => {

        timer =
          setTimeout(
            () => {

              reject(

                new Error(
                  `${label} timeout after ${milliseconds}ms`
                )

              );

            },

            milliseconds
          );

      }
    );


  return Promise

    .race([
      promise,
      timeout
    ])

    .finally(
      () => {

        clearTimeout(
          timer
        );

      }
    );

}


const stripHtml =
  (value = '') =>
    String(value)

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
  (value = '') =>
    String(value)

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


const canonicalUrl =
  (value = '') => {

    try {

      const url =
        new URL(
          value
        );


      url.hash =
        '';


      [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid',
        'mc_cid',
        'mc_eid'
      ]

        .forEach(
          key =>
            url.searchParams.delete(
              key
            )
        );


      [
        ...url.searchParams.keys()
      ]

        .forEach(
          key => {

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
        );


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
      )

        .trim();

    }

  };


const normalizeTitle =
  (value = '') =>
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
          .slice(0, 14)
          .join(' ')}|${category || ''}`

      )

      .digest(
        'hex'
      )

      .slice(
        0,
        32
      );


const categoryFor =
  (
    url,
    title = ''
  ) => {

    const text =
      `${url} ${title}`

        .toLowerCase();


    const categories = [

      {
        category:
          'TEKNOLOGI',

        keywords: [
          'teknologi',
          'technology',
          'digital',
          'internet',
          'gadget',
          'ai ',
          'artificial intelligence',
          'startup'
        ]
      },

      {
        category:
          'OLAHRAGA',

        keywords: [
          'olahraga',
          'sport',
          'bola',
          'sepak bola',
          'football',
          'liga',
          'badminton',
          'bulutangkis'
        ]
      },

      {
        category:
          'EKONOMI',

        keywords: [
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
          'POLITIK',

        keywords: [
          'politik',
          'pemilu',
          'pilkada',
          'dpr',
          'presiden',
          'partai'
        ]
      },

      {
        category:
          'HUKUM',

        keywords: [
          'hukum',
          'pengadilan',
          'kejaksaan',
          'korupsi',
          'tersangka',
          'polisi'
        ]
      },

      {
        category:
          'HIBURAN',

        keywords: [
          'hiburan',
          'film',
          'musik',
          'seleb',
          'artis',
          'entertainment'
        ]
      },

      {
        category:
          'INTERNASIONAL',

        keywords: [
          'internasional',
          'international',
          'world',
          'dunia'
        ]
      },

      {
        category:
          'LIFESTYLE',

        keywords: [
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


const imageOf =
  item => {

    const candidates = [

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


const sourceNameFromUrl =
  value => {

    try {

      return new URL(
        value
      ).hostname

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
   SAFE RPC

   PENTING:
   JANGAN gunakan:

   supabase.rpc(...).catch(...)

   Karena Supabase Query Builder bukan Promise biasa
   sampai di-await.
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
   FETCH FEED
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

        await withTimeout(

          parser.parseURL(
            url
          ),

          RSS_TIMEOUT_MS,

          `RSS ${url}`

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

            1000 *

            (
              2 **
              attempt
            ),

            4000

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
   BUILD ARTICLE ROW
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


  const urlRaw =

    String(

      item.link ||

      item.guid ||

      ''

    )

      .trim();


  const canonical =

    canonicalUrl(
      urlRaw
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


  const category =

    categoryFor(
      feedUrl,
      title
    );


  const published =

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
      urlRaw,


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
      urlRaw,


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
      published,


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

async function updateSourceSuccess(
  {
    source,
    url,
    latency
  }
) {

  const timestamp =
    nowIso();


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

          last_success_at:
            timestamp,

          last_latency_ms:
            latency,

          updated_at:
            timestamp

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

      '[SYNC] Source success update failed:',

      error.message ||
      error

    );

  }

}


/* =========================================================
   UPDATE SOURCE FAILURE
========================================================= */

async function updateSourceFailure(
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

        '[SYNC] Read source failure count failed:',

        existingError.message ||
        existingError

      );

    }


    const failureCount =

      Number(

        existing?.failure_count ||

        0

      ) +

      1;


    const timestamp =
      nowIso();


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


            status:

              failureCount >=
              3

                ? 'unhealthy'

                : 'degraded',


            failure_count:
              failureCount,


            last_failure_at:
              timestamp,


            last_latency_ms:
              latency,


            updated_at:
              timestamp

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

        '[SYNC] Source failure update failed:',

        error.message ||
        error

      );

    }

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] updateSourceFailure failed:',

      error.message ||
      error

    );

  }

}


/* =========================================================
   UPSERT ARTICLES

   Dibagi per batch supaya request database tidak terlalu besar.
========================================================= */

async function saveArticles(
  rows
) {

  if (
    !rows.length
  ) {

    return {
      saved:
        0
    };

  }


  const BATCH_SIZE =
    100;


  let saved =
    0;


  for (

    let index = 0;

    index <
    rows.length;

    index +=
      BATCH_SIZE

  ) {

    const batch =

      rows.slice(

        index,

        index +
        BATCH_SIZE

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


  return {
    saved
  };

}


/* =========================================================
   PROCESS ONE FEED

   Satu feed tidak boleh menghentikan seluruh proses sync.
========================================================= */

async function processFeed(
  url
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


    await updateSourceSuccess({

      source,

      url,

      latency

    });


    const uniqueUrls =
      new Set();


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
            buildArticleRow(

              item,

              url,

              source

            )

        )

        .filter(

          item => {

            if (

              !item.title ||

              !item.url

            ) {

              return false;

            }


            if (

              uniqueUrls.has(
                item.url
              )

            ) {

              return false;

            }


            uniqueUrls.add(
              item.url
            );


            return true;

          }

        );


    const saveResult =

      await saveArticles(
        rows
      );


    return {

      ok:
        true,


      url,


      source,


      rowsSeen:
        rows.length,


      upserted:

        saveResult.saved,


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


    await updateSourceFailure({

      url,

      latency

    });


    return {

      ok:
        false,


      url,


      source:

        sourceNameFromUrl(
          url
        ),


      rowsSeen:
        0,


      upserted:
        0,


      failed:
        true,


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
   CONCURRENCY POOL

   Contoh:

   100 feed
   concurrency = 5

   Worker hanya menjalankan maksimal 5 feed bersamaan.

   Jadi tidak membuka 100 request sekaligus.
========================================================= */

async function runWithConcurrency(
  items,
  concurrency,
  worker
) {

  const results =
    new Array(
      items.length
    );


  let nextIndex =
    0;


  async function runWorker() {

    while (
      true
    ) {

      const currentIndex =
        nextIndex;


      nextIndex +=
        1;


      if (

        currentIndex >=
        items.length

      ) {

        return;

      }


      try {

        results[
          currentIndex
        ] =

          await worker(

            items[
              currentIndex
            ]

          );

      }

      catch (
        error
      ) {

        results[
          currentIndex
        ] = {

          ok:
            false,

          url:

            items[
              currentIndex
            ],

          failed:
            true,

          rowsSeen:
            0,

          upserted:
            0,

          error:

            error.message ||

            String(
              error
            )

        };

      }

    }

  }


  const workers =
    Array.from(

      {

        length:

          Math.min(

            concurrency,

            items.length

          )

      },

      () =>
        runWorker()

    );


  await Promise.all(
    workers
  );


  return results;

}


/* =========================================================
   CREATE SYNC RUN
========================================================= */

async function createSyncRun() {

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
            feeds.length,

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


  /* -------------------------------------------------------
     NO FEEDS
  ------------------------------------------------------- */

  if (
    feeds.length ===
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


      rowsSeen:
        0,


      upserted:
        0,


      failed:
        0,


      durationMs:

        Date.now() -
        syncStarted,


      at:
        nowIso()

    };

  }


  /* -------------------------------------------------------
     ACQUIRE LOCK
  ------------------------------------------------------- */

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
        feeds.length,


      at:
        nowIso()

    };

  }


  let runId =
    null;


  try {

    /* -----------------------------------------------------
       CREATE RUN
    ----------------------------------------------------- */

    runId =
      await createSyncRun();


    console.log(

      `[SYNC] Starting ${feeds.length} RSS feeds with concurrency ${RSS_CONCURRENCY}`

    );


    /* -----------------------------------------------------
       PARALLEL SYNC
    ----------------------------------------------------- */

    const results =

      await runWithConcurrency(

        feeds,

        RSS_CONCURRENCY,

        processFeed

      );


    /* -----------------------------------------------------
       CALCULATE RESULT
    ----------------------------------------------------- */

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


    const failed =

      results.filter(

        result =>
          result.failed

      )

        .length;


    const successful =

      results.filter(

        result =>
          result.ok

      )

        .length;


    const durationMs =

      Date.now() -
      syncStarted;


    const status =

      failed === 0

        ? 'success'

        : (

            successful > 0

              ? 'partial'

              : 'failed'

          );


    /* -----------------------------------------------------
       OPTIONAL INTELLIGENCE
    ----------------------------------------------------- */

    await safeRpc(
      'rebuild_article_intelligence'
    );


    await safeRpc(
      'rebuild_live_events'
    );


    /* -----------------------------------------------------
       FINISH RUN
    ----------------------------------------------------- */

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


    console.log(

      `[SYNC] Finished: ${successful}/${feeds.length} feeds, ${upserted} articles, ${failed} failed, ${durationMs}ms`

    );


    return {

      ok:
        true,


      status,


      feeds:
        feeds.length,


      successful,


      failed,


      rowsSeen,


      upserted,


      concurrency:
        RSS_CONCURRENCY,


      maxItemsPerFeed:
        MAX_ITEMS_PER_FEED,


      durationMs,


      at:
        nowIso(),


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
            result => ({

              url:
                result.url,

              error:
                result.error

            })
          )

    };

  }

  catch (
    error
  ) {

    const durationMs =

      Date.now() -
      syncStarted;


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
   DIRECT RUN

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

      error

    );


    process.exitCode =
      1;

  }

}
