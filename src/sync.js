import 'dotenv/config';

import crypto from 'node:crypto';

import Parser from 'rss-parser';

import { supabase } from './supabase.js';


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
        'BeritaMudaIndonesia/6.0 (+news aggregator)'

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
        ]

      ]

    }

  });


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

    .filter(Boolean);


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
      /\s+/g,
      ' '
    )

    .trim();

}


function safeHtmlFromFeed(
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


function canonicalUrl(
  value = ''
) {

  try {

    const url =
      new URL(value);


    url.hash =
      '';


    const removeParams = [

      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',

      'fbclid',

      'gclid'

    ];


    for (
      const key
      of removeParams
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
      url.pathname !== '/'
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


function normalizeTitle(
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


function fingerprintOf({
  title,
  summary,
  source
}) {

  const text =
    [

      normalizeTitle(
        title
      ),

      stripHtml(
        summary
      ).slice(
        0,
        500
      ),

      String(
        source ||
        ''
      ).toLowerCase()

    ].join(
      '|'
    );


  return crypto

    .createHash(
      'sha256'
    )

    .update(
      text
    )

    .digest(
      'hex'
    );

}


function eventKeyOf({
  title,
  category
}) {

  const normalized =
    normalizeTitle(
      title
    )

      .split(
        ' '
      )

      .slice(
        0,
        14
      )

      .join(
        ' '
      );


  return crypto

    .createHash(
      'sha256'
    )

    .update(
      `${normalized}|${category || ''}`
    )

    .digest(
      'hex'
    )

    .slice(
      0,
      32
    );

}


/* =========================================================
   CATEGORY
========================================================= */

function categoryFor(
  feedUrl = '',
  title = ''
) {

  const text =
    `${feedUrl} ${title}`
      .toLowerCase();


  const categories = {

    politik:
      'POLITIK',

    pemerintahan:
      'POLITIK',

    hukum:
      'HUKUM',

    kriminal:
      'HUKUM',

    ekonomi:
      'EKONOMI',

    bisnis:
      'EKONOMI',

    finansial:
      'EKONOMI',

    teknologi:
      'TEKNOLOGI',

    digital:
      'TEKNOLOGI',

    olahraga:
      'OLAHRAGA',

    sport:
      'OLAHRAGA',

    sepakbola:
      'OLAHRAGA',

    internasional:
      'INTERNASIONAL',

    dunia:
      'INTERNASIONAL',

    hiburan:
      'HIBURAN',

    entertainment:
      'HIBURAN',

    lifestyle:
      'LIFESTYLE',

    gaya:
      'LIFESTYLE',

    kesehatan:
      'KESEHATAN',

    kesehatan:
      'KESEHATAN',

    pendidikan:
      'PENDIDIKAN',

    pendidikan:
      'PENDIDIKAN'

  };


  for (
    const [
      keyword,
      category
    ]
    of Object.entries(
      categories
    )
  ) {

    if (
      text.includes(
        keyword
      )
    ) {

      return category;

    }

  }


  return 'NASIONAL';

}


/* =========================================================
   AUTHOR
========================================================= */

function authorOf(
  item
) {

  return String(

    item?.creator ||

    item?.author ||

    item?.['dc:creator'] ||

    item?.['dc:Creator'] ||

    ''

  )

    .trim()

    .slice(
      0,
      160
    )

    || null;

}


/* =========================================================
   IMAGE
========================================================= */

function imageOf(
  item = {}
) {

  const candidates = [

    item?.enclosure?.url,

    item?.['media:content']?.url,

    item?.mediaContent?.url,

    item?.['media:thumbnail']?.url,

    item?.mediaThumbnail?.url,

    item?.itunes?.image,

    item?.image,

    item?.image_url

  ];


  for (
    const image
    of candidates
  ) {

    if (
      typeof image ===
      'string'
    ) {

      const value =
        image.trim();


      if (
        /^https?:\/\//i.test(
          value
        )
      ) {

        return value;

      }

    }


    if (
      image &&
      typeof image ===
      'object' &&
      image.url
    ) {

      return image.url;

    }

  }


  return null;

}


/* =========================================================
   SAFE RPC

   PENTING:
   Jangan gunakan:

   supabase.rpc(...).catch(...)

   Karena hasil rpc pada kasus project Anda
   menyebabkan error:

   ".catch is not a function"
========================================================= */

async function safeRpc(
  name,
  params = {}
) {

  try {

    const result =
      await supabase.rpc(
        name,
        params
      );


    if (
      result?.error
    ) {

      console.warn(
        `[SYNC] RPC ${name} error:`,
        result.error.message
      );


      return {

        ok:
          false,

        error:
          result.error

      };

    }


    return {

      ok:
        true,

      data:
        result?.data

    };

  }

  catch (
    error
  ) {

    console.warn(
      `[SYNC] RPC ${name} failed:`,
      error?.message ||
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
   SAFE QUERY

   Untuk query tambahan yang tidak boleh
   menghentikan seluruh sync.
========================================================= */

async function safeQuery(
  callback,
  label = 'query'
) {

  try {

    return await callback();

  }

  catch (
    error
  ) {

    console.warn(
      `[SYNC] ${label} failed:`,
      error?.message ||
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
   FETCH RSS
========================================================= */

async function fetchFeed(
  url
) {

  let lastError =
    null;


  for (
    let attempt = 0;
    attempt <= RSS_RETRIES;
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
          started

      };

    }

    catch (
      error
    ) {

      lastError =
        error;


      const isLastAttempt =
        attempt >=
        RSS_RETRIES;


      if (
        !isLastAttempt
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
   CREATE ARTICLE ROW
========================================================= */

function createArticleRow({
  item,
  feedUrl,
  source
}) {

  const rawHtml =
    item?.contentEncoded ||

    item?.['content:encoded'] ||

    item?.content ||

    item?.contentSnippet ||

    item?.summary ||

    item?.description ||

    '';


  const plain =
    stripHtml(
      rawHtml
    );


  const contentHtml =
    safeHtmlFromFeed(
      item?.contentEncoded ||

      item?.['content:encoded'] ||

      item?.content ||

      ''
    );


  const url =
    String(
      item?.link ||
      item?.guid ||
      ''
    ).trim();


  const title =
    String(
      item?.title ||
      ''
    )

      .trim()

      .slice(
        0,
        500
      );


  if (
    !title ||
    !url
  ) {

    return null;

  }


  const category =
    categoryFor(
      feedUrl,
      title
    );


  const publishedAt =
    item?.isoDate ||

    item?.pubDate ||

    item?.published ||

    new Date()
      .toISOString();


  const summary =
    plain.slice(
      0,
      600
    );


  return {

    title,

    summary,

    content_html:

      contentHtml.length >=
      80

        ? contentHtml.slice(
            0,
            50000
          )

        : null,


    content:

      plain.length >=
      80

        ? plain.slice(
            0,
            50000
          )

        : null,


    url,


    canonical_url:
      canonicalUrl(
        url
      ) || null,


    source_url:
      url,


    source,


    author_name:
      authorOf(
        item
      ),


    category,


    image_url:
      imageOf(
        item
      ),


    published_at:
      publishedAt,


    status:
      'published',


    content_source:

      contentHtml.length >=
      80

        ? 'rss'

        : 'snippet',


    content_available:

      plain.length >=
      80,


    editorial_status:
      'auto',


    content_fingerprint:

      fingerprintOf({

        title,

        summary,

        source

      }),


    event_key:

      eventKeyOf({

        title,

        category

      })

  };

}


/* =========================================================
   UPDATE SOURCE SUCCESS
========================================================= */

async function markSourceSuccess({
  source,
  feedUrl,
  latency
}) {

  await safeQuery(

    () =>

      supabase

        .from(
          'news_sources'
        )

        .upsert(

          {

            name:
              source,

            feed_url:
              feedUrl,

            active:
              true,

            status:
              'healthy',

            success_count:
              1,

            failure_count:
              0,

            last_success_at:

              new Date()
                .toISOString(),


            last_latency_ms:
              latency,


            updated_at:

              new Date()
                .toISOString()

          },

          {

            onConflict:
              'feed_url'

          }

        ),

    'mark source success'

  );

}


/* =========================================================
   UPDATE SOURCE FAILURE
========================================================= */

async function markSourceFailure(
  feedUrl,
  latency
) {

  let failureCount =
    1;


  try {

    const result =
      await supabase

        .from(
          'news_sources'
        )

        .select(
          'failure_count'
        )

        .eq(
          'feed_url',
          feedUrl
        )

        .maybeSingle();


    if (
      !result?.error
    ) {

      failureCount =
        Number(
          result?.data
            ?.failure_count ||
          0
        ) + 1;

    }

  }

  catch (
    error
  ) {

    console.warn(
      '[SYNC] Cannot read source failure count:',
      error?.message
    );

  }


  let sourceName =
    feedUrl;


  try {

    sourceName =
      new URL(
        feedUrl
      ).hostname;

  }

  catch {

    /* tetap gunakan feedUrl */

  }


  await safeQuery(

    () =>

      supabase

        .from(
          'news_sources'
        )

        .upsert(

          {

            name:
              sourceName,

            feed_url:
              feedUrl,

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

              new Date()
                .toISOString(),


            last_latency_ms:
              latency,


            updated_at:

              new Date()
                .toISOString()

          },

          {

            onConflict:
              'feed_url'

          }

        ),

    'mark source failure'

  );

}


/* =========================================================
   UPDATE SYNC RUN
========================================================= */

async function updateSyncRun(
  runId,
  payload
) {

  if (
    !runId
  ) {

    return;

  }


  await safeQuery(

    () =>

      supabase

        .from(
          'sync_runs'
        )

        .update(
          payload
        )

        .eq(
          'id',
          runId
        ),

    'update sync run'

  );

}


/* =========================================================
   SYNC ONE FEED
========================================================= */

async function syncOneFeed(
  feedUrl
) {

  const started =
    Date.now();


  try {

    const {

      feed,

      latency

    } =
      await fetchFeed(
        feedUrl
      );


    const source =
      String(

        feed?.title ||

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


    await markSourceSuccess({

      source,

      feedUrl,

      latency

    });


    const rows =
      (
        feed?.items ||
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


    if (
      !rows.length
    ) {

      return {

        ok:
          true,

        feedUrl,

        source,

        rows:
          0,

        upserted:
          0,

        latency

      };

    }


    const {

      error

    } =
      await supabase

        .from(
          'articles'
        )

        .upsert(

          rows,

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


    return {

      ok:
        true,

      feedUrl,

      source,

      rows:
        rows.length,

      upserted:
        rows.length,

      latency

    };

  }

  catch (
    error
  ) {

    const latency =
      Date.now() -
      started;


    console.error(

      '[SYNC] RSS failed:',

      feedUrl,

      error?.message ||
      error

    );


    await markSourceFailure(
      feedUrl,
      latency
    );


    return {

      ok:
        false,

      feedUrl,

      rows:
        0,

      upserted:
        0,

      latency,

      error:

        error?.message ||

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


  /* -------------------------------------------------------
     VALIDATE FEEDS
  ------------------------------------------------------- */

  if (
    !feeds.length
  ) {

    return {

      ok:
        true,

      skipped:
        true,

      reason:
        'RSS_FEEDS is empty',

      feeds:
        0,

      rowsSeen:
        0,

      upserted:
        0,

      failed:
        0,

      startedAt,

      finishedAt:

        new Date()
          .toISOString()

    };

  }


  /* -------------------------------------------------------
     ACQUIRE LOCK
  ------------------------------------------------------- */

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


  /*
     Jika fungsi RPC lock belum ada,
     sync tetap bisa dilanjutkan.

     Ini penting agar error database RPC
     tidak langsung membuat website mati.
  */

  const lockAvailable =
    lockResult.ok;


  const lockAcquired =
    lockResult.ok

      ? Boolean(
          lockResult.data
        )

      : true;


  if (
    lockAvailable &&
    !lockAcquired
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

      startedAt,

      finishedAt:

        new Date()
          .toISOString()

    };

  }


  let runId =
    null;


  let rowsSeen =
    0;


  let upserted =
    0;


  let failed =
    0;


  const results =
    [];


  /* -------------------------------------------------------
     CREATE SYNC RUN
  ------------------------------------------------------- */

  try {

    const run =
      await supabase

        .from(
          'sync_runs'
        )

        .insert({

          feeds_total:
            feeds.length,

          status:
            'running',

          started_at:
            startedAt

        })

        .select(
          'id'
        )

        .single();


    if (
      !run?.error
    ) {

      runId =
        run?.data?.id ||
        null;

    }

    else {

      console.warn(

        '[SYNC] Cannot create sync run:',

        run.error.message

      );

    }

  }

  catch (
    error
  ) {

    console.warn(

      '[SYNC] sync_runs unavailable:',

      error?.message

    );

  }


  /* -------------------------------------------------------
     PROCESS FEEDS

     Dijalankan satu per satu agar lebih aman
     untuk Vercel dan tidak membanjiri RSS server.
  ------------------------------------------------------- */

  try {

    for (
      const feedUrl
      of feeds
    ) {

      const result =
        await syncOneFeed(
          feedUrl
        );


      results.push(
        result
      );


      rowsSeen +=
        result.rows ||
        0;


      upserted +=
        result.upserted ||
        0;


      if (
        !result.ok
      ) {

        failed++;

      }

    }


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
       FINAL STATUS
    ----------------------------------------------------- */

    const status =

      failed === 0

        ? 'success'

        : failed < feeds.length

          ? 'partial'

          : 'failed';


    const finishedAt =
      new Date()
        .toISOString();


    await updateSyncRun(

      runId,

      {

        finished_at:
          finishedAt,

        status,

        feeds_failed:
          failed,

        rows_seen:
          rowsSeen,

        rows_upserted:
          upserted

      }

    );


    return {

      ok:
        failed <
        feeds.length,


      status,


      feeds:
        feeds.length,


      rowsSeen,


      upserted,


      failed,


      results,


      startedAt,


      finishedAt

    };

  }

  catch (
    error
  ) {

    const finishedAt =
      new Date()
        .toISOString();


    await updateSyncRun(

      runId,

      {

        finished_at:
          finishedAt,

        status:
          'failed',

        feeds_failed:
          failed,

        rows_seen:
          rowsSeen,

        rows_upserted:
          upserted,

        error_message:

          error?.message ||

          String(
            error
          )

      }

    );


    throw error;

  }

  finally {

    /*
       Jangan pernah lagi menggunakan:

       supabase.rpc(...).catch(...)
    */

    if (
      lockAvailable
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
   DIRECT EXECUTION
========================================================= */

if (
  import.meta.url ===
  `file://${process.argv[1]}`
) {

  try {

    const result =
      await syncFeeds();


    console.log(

      '[SYNC RESULT]',

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

      '[SYNC ERROR]',

      error
    );


    process.exitCode =
      1;

  }

}
