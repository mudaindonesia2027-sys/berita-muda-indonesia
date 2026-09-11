(() => {
  const tokenKey='muda_owner_os_token';
  const getToken=()=>sessionStorage.getItem(tokenKey)||'';
  const api=async (path)=>{const r=await fetch(path,{headers:getToken()?{Authorization:'Bearer '+getToken()}: {}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{};if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d};
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
  async function refreshIntel(){
    if(!document.getElementById('app')||document.getElementById('app').classList.contains('hidden')) return;
    try{
      const [o,p,s]=await Promise.allSettled([api('/api/admin/owner/overview'),api('/api/admin/owner/performance'),api('/api/admin/system/overview')]);
      if(o.status==='fulfilled'){
        const e=o.value.executive||{};
        set('miAnalytics',`${Number(e.total_views||0).toLocaleString('id-ID')} views`);
        set('miRevenue',`${Number(e.published_articles||0).toLocaleString('id-ID')} articles`);
        set('miAds',`${Number(e.degraded_sources||0)} degraded sources`);
      }
      if(p.status==='fulfilled') set('miSystem',`${p.value.total_ms||0} ms probe`);
      if(s.status==='fulfilled' && Number(s.value.open_events||0)>0) set('miSystem',`${s.value.open_events} open events`);
    }catch{}
  }
  const bind=()=>{
    document.querySelectorAll('.intel-card').forEach(c=>c.addEventListener('keydown',e=>{if(e.key==='Enter')c.click()}));
    ['#syncBtn','#runBreakingBtn'].forEach(sel=>document.querySelector(sel)?.addEventListener('click',()=>setTimeout(refreshIntel,900)));
  };
  document.addEventListener('DOMContentLoaded',()=>{bind();refreshIntel();setInterval(refreshIntel,45000)});
  window.MudaIntelligence={refresh:refreshIntel};
})();
