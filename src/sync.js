import 'dotenv/config';

import crypto from 'node:crypto';
import Parser from 'rss-parser';

import {
  supabase
} from './supabase.js';


/* =========================================================
   RSS CONFIG
========================================================= */

const parser =
  new Parser({
    timeout: 15000,

    headers: {
      'User-Agent':
        'BeritaMudaIndonesia/5.2 RSS Sync'
    }
  });


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
        new URL(value);


      url.hash =
        '';


      [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid'
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
    stripHtml(value)

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
      (
        url +
        ' ' +
        title
      )

        .toLowerCase();


    const categories = {

      politik:
        'POLITIK',

      hukum:
        'HUKUM',

      ekonomi:
        'EKONOMI',

      teknologi:
        'TEKNOLOGI',

      olahraga:
        'OLAHRAGA',

      internasional:
        'INTERNASIONAL',

      hiburan:
        'HIBURAN',

      lifestyle:
        'LIFESTYLE'

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
  item =>

    item.enclosure?.url ||

    item['media:content']?.url ||

    item['media:thumbnail']?.url ||

    item.itunes?.image ||

    null;


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
   SAFE RPC

   FIX:
   Jangan gunakan:

   supabase.rpc(...).catch(...)

   Supabase RPC harus di-await terlebih dahulu.
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

        `[SYNC RPC] ${name}:`,

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
   FETCH RSS
========================================================= */

async function fetchFeed(
  url
) {

  let lastError;


  for (

    let attempt = 0;

    attempt < 3;

    attempt++

  ) {

    const started =
      Date.now();


    try {

      return {

        feed:

          await parser.parseURL(
            url
          ),

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


      if (
        attempt < 2
      ) {

        await sleep(

          500 *

          (
            2 **
            attempt
          )

        );

      }

    }

  }


  throw lastError;

}


/* =========================================================
   MAIN SYNC
========================================================= */

export async function syncFeeds() {

  /*
   * Acquire sync lock
   */

  const lock =
    await safeRpc(

      'acquire_sync_lock',

      {

        p_name:
          'news-sync',

        p_ttl_seconds:
          240

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

      skipped:
        true,

      reason:
        'sync_locked',

      at:

        new Date()
          .toISOString()

    };

  }


  let rowsSeen =
    0;


  let upserted =
    0;


  let failed =
    0;


  let runId =
    null;


  /*
   * Create sync run
   */

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

        '[SYNC] Tidak dapat membuat sync_runs:',

        error.message ||
        error

      );

    }

    else {

      runId =
        data?.id ||
        null;

    }

  }

  catch (
    error
  ) {

    console.error(

      '[SYNC] sync_runs error:',

      error.message ||
      error

    );

  }


  try {

    for (
      const url
      of feeds
    ) {

      const sourceStart =
        Date.now();


      try {

        const {
          feed,
          latency
        } =

          await fetchFeed(
            url
          );


        const source =

          (
            feed.title ||
            'RSS'
          )

            .slice(
              0,
              120
            );


        /*
         * Update source status
         */

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

              success_count:
                1,

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

          );


        /*
         * Convert RSS items
         */

        const rows =

          (
            feed.items ||
            []
          )

            .slice(
              0,
              80
            )

            .map(

              item => {

                const rawHtml =

                  item['content:encoded'] ||

                  item.content ||

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
                  item.link;


                const canonical =

                  canonicalUrl(
                    urlRaw
                  );


                const published =

                  item.isoDate ||

                  item.pubDate ||

                  new Date()
                    .toISOString();


                const category =

                  categoryFor(
                    url,
                    item.title
                  );


                return {

                  title:

                    (
                      item.title ||
                      ''
                    )

                      .trim()

                      .slice(
                        0,
                        500
                      ),


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

                      title:
                        item.title,

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

                      title:
                        item.title,

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

            )

            .filter(

              item =>

                item.title &&

                item.url

            );


        rowsSeen +=
          rows.length;


        /*
         * Save articles
         */

        if (
          rows.length
        ) {

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


          upserted +=
            rows.length;

        }

      }

      catch (
        error
      ) {

        failed++;


        console.error(

          '[SYNC] RSS failed',

          url,

          error.message ||
          error

        );


        try {

          const {
            data:
              existing
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


          const failureCount =

            Number(

              existing?.failure_count ||

              0

            ) +

            1;


          await supabase

            .from(
              'news_sources'
            )

            .upsert(

              {

                name:

                  new URL(
                    url
                  ).hostname,


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

                  new Date()
                    .toISOString(),


                last_latency_ms:

                  Date.now() -
                  sourceStart,


                updated_at:

                  new Date()
                    .toISOString()

              },

              {

                onConflict:
                  'feed_url'

              }

            );

        }

        catch (
          sourceError
        ) {

          console.error(

            '[SYNC] Source status update failed:',

            sourceError.message ||
            sourceError

          );

        }

      }

    }


    /*
     * Optional rebuild RPCs
     */

    await safeRpc(
      'rebuild_article_intelligence'
    );


    await safeRpc(
      'rebuild_live_events'
    );


    /*
     * Finish sync run
     */

    if (
      runId
    ) {

      await supabase

        .from(
          'sync_runs'
        )

        .update({

          finished_at:

            new Date()
              .toISOString(),


          status:

            failed === 0

              ? 'success'

              : (

                  failed <
                  feeds.length

                    ? 'partial'

                    : 'failed'

                ),


          feeds_failed:
            failed,


          rows_seen:
            rowsSeen,


          rows_upserted:
            upserted

        })

        .eq(
          'id',
          runId
        );

    }


    return {

      ok:
        true,


      feeds:
        feeds.length,


      rowsSeen,


      upserted,


      failed,


      at:

        new Date()
          .toISOString()

    };

  }

  catch (
    error
  ) {

    /*
     * Mark failed run
     */

    if (
      runId
    ) {

      try {

        await supabase

          .from(
            'sync_runs'
          )

          .update({

            finished_at:

              new Date()
                .toISOString(),


            status:
              'failed',


            feeds_failed:
              failed,


            rows_seen:
              rowsSeen,


            rows_upserted:
              upserted,


            error_message:

              error.message ||

              String(
                error
              )

          })

          .eq(
            'id',
            runId
          );

      }

      catch (
        updateError
      ) {

        console.error(

          '[SYNC] Update sync run failed:',

          updateError.message ||
          updateError

        );

      }

    }


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
========================================================= */

if (

  process.argv[1] &&

  import.meta.url ===
  `file://${process.argv[1]}`

) {

  try {

    await syncFeeds();

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
