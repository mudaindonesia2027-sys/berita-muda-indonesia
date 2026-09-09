import 'dotenv/config';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent':
      'BeritaMudaIndonesia/7.0 News Aggregator'
  }
});

/* =========================================================
   RSS SOURCES
========================================================= */

const feeds = (
  process.env.RSS_FEEDS || ''
)
  .split(',')
  .map(
    item => item.trim()
  )
  .filter(Boolean);

/* =========================================================
   UTILITIES
========================================================= */

const stripHtml = (
  value = ''
) =>
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

const safeHtml = (
  value = ''
) =>
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

const normalizeUrl = (
  value = ''
) => {
  try {

    const url =
      new URL(value);

    url.hash = '';

    [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid'
    ].forEach(
      key =>
        url.searchParams.delete(
          key
        )
    );

    return url.toString();

  } catch {

    return String(value)
      .trim();

  }
};

const createFingerprint = (
  title = '',
  summary = ''
) =>
  crypto
    .createHash(
      'sha256'
    )
    .update(
      `${title}|${summary}`
        .toLowerCase()
    )
    .digest(
      'hex'
    );

/* =========================================================
   CATEGORY DETECTION
========================================================= */

const detectCategory = (
  url = '',
  title = ''
) => {

  const text =
    `${url} ${title}`
      .toLowerCase();

  const categories = {

    politik:
      'POLITIK',

    pemerintahan:
      'POLITIK',

    ekonomi:
      'EKONOMI',

    bisnis:
      'EKONOMI',

    teknologi:
      'TEKNOLOGI',

    digital:
      'TEKNOLOGI',

    olahraga:
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

    kesehatan:
      'KESEHATAN',

    pendidikan:
      'PENDIDIKAN',

    hukum:
      'HUKUM'
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

/* =========================================================
   AUTHOR
========================================================= */

const getAuthor = (
  item
) => {

  const author =
    item.creator ||
    item.author ||
    item['dc:creator'] ||
    item['dc:Creator'] ||
    null;

  if (!author) {

    return null;

  }

  return String(
    author
  )
    .trim()
    .slice(
      0,
      160
    );

};

/* =========================================================
   IMAGE
========================================================= */

const getImage = (
  item
) => {

  if (
    item.enclosure?.url
  ) {

    return item
      .enclosure
      .url;

  }

  if (
    item['media:content']?.url
  ) {

    return item[
      'media:content'
    ].url;

  }

  if (
    item['media:thumbnail']?.url
  ) {

    return item[
      'media:thumbnail'
    ].url;

  }

  if (
    item.itunes?.image
  ) {

    return item
      .itunes
      .image;

  }

  return null;

};

/* =========================================================
   FETCH FEED
========================================================= */

async function fetchFeed(
  url
) {

  return parser.parseURL(
    url
  );

}

/* =========================================================
   MAIN SYNC
========================================================= */

export async function syncFeeds() {

  if (
    feeds.length === 0
  ) {

    return {

      ok:
        false,

      message:
        'RSS_FEEDS belum diatur',

      feeds:
        0,

      inserted:
        0

    };

  }

  let totalFeeds =
    0;

  let totalItems =
    0;

  let inserted =
    0;

  let failed =
    0;

  const errors =
    [];

  for (
    const feedUrl
    of feeds
  ) {

    try {

      console.log(
        '[SYNC] Fetching:',
        feedUrl
      );

      const feed =
        await fetchFeed(
          feedUrl
        );

      totalFeeds++;

      const source =
        String(
          feed.title ||
          new URL(
            feedUrl
          ).hostname
        )
          .slice(
            0,
            160
          );

      const items =
        (
          feed.items ||
          []
        )
          .slice(
            0,
            100
          );

      totalItems +=
        items.length;

      for (
        const item
        of items
      ) {

        try {

          const originalUrl =
            item.link ||
            item.guid;

          if (
            !originalUrl
          ) {

            continue;

          }

          const url =
            normalizeUrl(
              originalUrl
            );

          const title =
            stripHtml(
              item.title ||
              ''
            )
              .slice(
                0,
                500
              );

          if (
            !title
          ) {

            continue;

          }

          const rawHtml =
            item[
              'content:encoded'
            ] ||
            item.content ||
            '';

          const html =
            safeHtml(
              rawHtml
            );

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
              .slice(
                0,
                1000
              );

          const category =
            detectCategory(
              url,
              title
            );

          const publishedAt =
            item.isoDate ||
            item.pubDate ||
            new Date()
              .toISOString();

          const payload = {

            title,

            summary,

            content:
              text ||
              null,

            content_html:
              html.length >= 80
                ? html.slice(
                    0,
                    50000
                  )
                : null,

            url,

            source_url:
              url,

            canonical_url:
              url,

            source,

            author_name:
              getAuthor(
                item
              ),

            category,

            image_url:
              getImage(
                item
              ),

            published_at:
              publishedAt,

            status:
              'published',

            content_source:
              html.length >= 80
                ? 'rss'
                : 'snippet',

            content_available:
              Boolean(
                text ||
                html
              ),

            content_fingerprint:
              createFingerprint(
                title,
                summary
              ),

            reading_minutes:
              Math.max(
                1,
                Math.ceil(
                  (
                    text
                      .split(
                        /\s+/
                      )
                      .filter(
                        Boolean
                      )
                      .length
                  ) / 220
                )
              ),

            updated_at:
              new Date()
                .toISOString()

          };

          const {
            error
          } =
            await supabase
              .from(
                'articles'
              )
              .upsert(
                payload,
                {
                  onConflict:
                    'url'
                }
              );

          if (
            error
          ) {

            throw error;

          }

          inserted++;

        } catch (
          itemError
        ) {

          console.error(
            '[SYNC ITEM ERROR]',
            itemError.message
          );

        }

      }

    } catch (
      error
    ) {

      failed++;

      errors.push({

        feed:
          feedUrl,

        error:
          error.message

      });

      console.error(
        '[SYNC FEED ERROR]',
        feedUrl,
        error.message
      );

    }

  }

  /*
   Rebuild intelligence jika
   function tersedia.

   Error tidak boleh menghentikan
   proses berita utama.
  */

  try {

    await supabase
      .rpc(
        'rebuild_article_intelligence'
      );

  } catch (_) {}

  try {

    await supabase
      .rpc(
        'rebuild_trending'
      );

  } catch (_) {}

  try {

    await supabase
      .rpc(
        'rebuild_live_events'
      );

  } catch (_) {}

  return {

    ok:
      failed <
      feeds.length,

    feeds:
      feeds.length,

    processedFeeds:
      totalFeeds,

    items:
      totalItems,

    inserted,

    failed,

    errors,

    updatedAt:
      new Date()
        .toISOString()

  };

}

/* =========================================================
   CLI
========================================================= */

if (
  import.meta.url ===
  `file://${process.argv[1]}`
) {

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
