import 'dotenv/config';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'BeritaMudaIndonesia/5.1 (+news aggregator)' } });
const feeds = (process.env.RSS_FEEDS || '').split(',').map(x => x.trim()).filter(Boolean);
const stripHtml = (s='') => String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const safeHtmlFromFeed = (raw='') => String(raw).replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/javascript:/gi,'').trim();
const canonicalUrl = (raw='') => { try { const u=new URL(raw); u.hash=''; ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'].forEach(k=>u.searchParams.delete(k)); [...u.searchParams.keys()].forEach(k=>{if(k.toLowerCase().startsWith('utm_'))u.searchParams.delete(k)}); u.hostname=u.hostname.toLowerCase(); if(u.pathname!=='/')u.pathname=u.pathname.replace(/\/+$/,''); return u.toString(); } catch { return String(raw||'').trim(); } };
const normalizeTitle = (s='') => stripHtml(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const fingerprintOf = ({title,summary,source}) => crypto.createHash('sha256').update(`${normalizeTitle(title)}|${stripHtml(summary).slice(0,500)}|${String(source||'').toLowerCase()}`).digest('hex');
// Event key intentionally ignores source so multiple publishers covering one topic can be clustered.
const eventKeyOf = ({title,category}) => crypto.createHash('sha256').update(`${normalizeTitle(title).split(' ').slice(0,14).join(' ')}|${category||''}`).digest('hex').slice(0,32);
const categoryFor = (url,title='') => { const s=(url+' '+title).toLowerCase(); for (const [k,v] of Object.entries({politik:'POLITIK',hukum:'HUKUM',ekonomi:'EKONOMI',teknologi:'TEKNOLOGI',olahraga:'OLAHRAGA',internasional:'INTERNASIONAL',hiburan:'HIBURAN',lifestyle:'LIFESTYLE'})) if(s.includes(k)) return v; return 'NASIONAL'; };
const authorOf = i => String(i.creator || i.author || i['dc:creator'] || i['dc:Creator'] || '').trim().slice(0,160) || null;
const imageOf = i => i.enclosure?.url || i['media:content']?.url || i['media:thumbnail']?.url || i.itunes?.image || null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchFeed(url){ let last; for(let attempt=0;attempt<3;attempt++){ const started=Date.now(); try{return {feed:await parser.parseURL(url),latency:Date.now()-started};}catch(e){last=e;if(attempt<2)await sleep(500*(2**attempt));} } throw last; }

export async function syncFeeds(){
  const lock=await supabase.rpc('acquire_sync_lock',{p_name:'news-sync',p_ttl_seconds:240});
  if(lock.error) throw lock.error;
  if(!lock.data) return {skipped:true,reason:'sync_locked',at:new Date().toISOString()};
  let rowsSeen=0, upserted=0, failed=0;
  const run=await supabase.from('sync_runs').insert({feeds_total:feeds.length,status:'running'}).select('id').single();
  const runId=run.data?.id;
  try{
    for(const url of feeds){
      const sourceStart=Date.now();
      try{
        const {feed,latency}=await fetchFeed(url);
        const source=(feed.title||'RSS').slice(0,120);
        await supabase.from('news_sources').upsert({name:source,feed_url:url,active:true,status:'healthy',success_count:1,last_success_at:new Date().toISOString(),last_latency_ms:latency,updated_at:new Date().toISOString()},{onConflict:'feed_url'});
        const rows=(feed.items||[]).slice(0,80).map(i=>{
          const rawHtml=i['content:encoded'] || i.content || '';
          const plain=stripHtml(i.contentSnippet || rawHtml || i.summary || i.description || '');
          const contentHtml=safeHtmlFromFeed(rawHtml);
          const urlRaw=i.link;
          const canon=canonicalUrl(urlRaw);
          const published=i.isoDate || i.pubDate || new Date().toISOString();
          const category=categoryFor(url,i.title);
          return { title:(i.title||'').trim().slice(0,500), summary:plain.slice(0,600), content_html:contentHtml.length>=80 ? contentHtml.slice(0,50000) : null, url:urlRaw, canonical_url:canon||null, content_fingerprint:fingerprintOf({title:i.title,summary:plain,source}), source_url:urlRaw, source, author_name:authorOf(i), category, event_key:eventKeyOf({title:i.title,category}), editorial_status:'auto', image_url:imageOf(i), published_at:published, content_source:contentHtml.length>=80?'rss':'snippet', content_available:contentHtml.length>=80, status:'published' };
        }).filter(x=>x.title&&x.url);
        rowsSeen += rows.length;
        if(rows.length){
          const {error}=await supabase.from('articles').upsert(rows,{onConflict:'url',ignoreDuplicates:false});
          if(error) throw error;
          upserted += rows.length;
        }
      }catch(e){
        failed++; console.error('[SYNC] RSS failed',url,e.message);
        const {data:existing}=await supabase.from('news_sources').select('failure_count').eq('feed_url',url).maybeSingle();
        await supabase.from('news_sources').upsert({name:new URL(url).hostname,feed_url:url,active:true,status:(Number(existing?.failure_count||0)+1)>=3?'unhealthy':'degraded',failure_count:Number(existing?.failure_count||0)+1,last_failure_at:new Date().toISOString(),last_latency_ms:Date.now()-sourceStart,updated_at:new Date().toISOString()},{onConflict:'feed_url'});
      }
    }
    await supabase.rpc('rebuild_article_intelligence').catch(()=>{});
    await supabase.rpc('rebuild_live_events').catch(()=>{});
    if(runId) await supabase.from('sync_runs').update({finished_at:new Date().toISOString(),status:failed===0?'success':(failed<feeds.length?'partial':'failed'),feeds_failed:failed,rows_seen:rowsSeen,rows_upserted:upserted}).eq('id',runId);
    return {feeds:feeds.length,rowsSeen,upserted,failed,at:new Date().toISOString()};
  }catch(e){
    if(runId) await supabase.from('sync_runs').update({finished_at:new Date().toISOString(),status:'failed',feeds_failed:failed,rows_seen:rowsSeen,rows_upserted:upserted,error_message:e.message}).eq('id',runId);
    throw e;
  }finally{ await supabase.rpc('release_sync_lock',{p_name:'news-sync'}).catch(()=>{}); }
}
if(import.meta.url===`file://${process.argv[1]}`){ await syncFeeds(); }
