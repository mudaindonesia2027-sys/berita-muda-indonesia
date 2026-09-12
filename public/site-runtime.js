(() => {
  'use strict';
  const path = location.pathname;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get = async (u) => { const r = await fetch(u, {headers:{Accept:'application/json'}}); const d = await r.json(); if(!r.ok) throw new Error(d?.error||`HTTP ${r.status}`); return d; };

  async function renderNavigation(){
    try{
      const rows = await get('/api/site/navigation');
      const active = rows.filter(x => x.visible !== false && (!x.start_at || new Date(x.start_at) <= new Date()) && (!x.end_at || new Date(x.end_at) >= new Date()));
      const html = active.map(x => `<a href="${esc(x.href||'#')}" data-muda-nav="1">${esc(x.label)}</a>`).join('');
      document.querySelectorAll('nav').forEach(nav => {
        if(nav.closest('#ownerApp,#login,.owner-os')) return;
        if(nav.dataset.mudaManaged === '1' || /site-header|main-nav|navigation|topnav/i.test(nav.className||nav.id||'')){
          nav.dataset.mudaManaged='1'; nav.innerHTML=html;
        }
      });
    }catch(e){}
  }

  async function renderManagedPage(){
    const slug = path === '/' ? '' : path;
    if(!slug.endsWith('.html')) return;
    const key = slug.replace(/^\//,'');
    try{
      const d = await get('/api/site/pages/'+encodeURIComponent(key));
      const main = document.querySelector('main');
      if(!main || !d) return;
      main.innerHTML = `<section class="muda-managed-live"><div class="eyebrow">BERITA MUDA INDONESIA · LIVE CMS</div><h1>${esc(d.title)}</h1><div class="muda-managed-content">${d.content_html || ''}</div></section>`;
      document.title = d.seo_title || `${d.title} | Berita Muda Indonesia`;
      const meta = document.querySelector('meta[name="description"]');
      if(meta && d.seo_description) meta.setAttribute('content', d.seo_description);
    }catch(e){}
  }

  async function renderExperience(){
    try{
      const widgets = await get('/api/site/experience/widgets');
      const campaigns = await get('/api/site/campaigns/active');
      if(!widgets.length && !campaigns.length) return;
      let dock = document.getElementById('mudaExperienceDock');
      if(!dock){ dock=document.createElement('aside'); dock.id='mudaExperienceDock'; dock.innerHTML='<div class="muda-exp-head"><strong>MUDA LIVE</strong><span>Pengalaman interaktif</span></div><div id="mudaExpBody"></div>'; document.body.appendChild(dock); }
      const body=dock.querySelector('#mudaExpBody');
      const cards=[];
      for(const w of widgets){
        if(w.widget_type==='weather'){
          const c=w.config||{}; const r=await get(`/api/site/weather-public?lat=${encodeURIComponent(c.lat||-6.9)}&lon=${encodeURIComponent(c.lon||110.4)}`).catch(()=>null);
          const cur=r?.current||r?.current_weather; if(cur) cards.push(`<div class="muda-exp-card"><span>CUACA · ${esc(c.location||w.title)}</span><b>${Math.round(cur.temperature_2m??cur.temperature)}°</b><small>Wind ${Math.round(cur.wind_speed_10m??cur.windspeed??0)} km/h</small></div>`);
        } else if(w.widget_type==='regional_map') {
          cards.push(`<div class="muda-exp-card"><span>${esc(w.title)}</span><b>Jawa Tengah</b><small>Peta regional aktif · ${esc(w.provider||'map')}</small></div>`);
        } else if(w.widget_type==='holiday_calendar') {
          cards.push(`<div class="muda-exp-card"><span>${esc(w.title)}</span><b>Kalender Editorial</b><small>Hari penting & momentum konten</small></div>`);
        }
      }
      campaigns.slice(0,2).forEach(c=>cards.push(`<div class="muda-exp-card campaign"><span>${esc(c.campaign_type)} · AKTIF</span><b>${esc(c.title)}</b><small>${esc(c.description||'Ikuti interaksi MUDA')}</small></div>`));
      body.innerHTML=cards.join('');
    }catch(e){}
  }

  function injectStyles(){
    if(document.getElementById('mudaPublicRuntimeStyles')) return;
    const s=document.createElement('style'); s.id='mudaPublicRuntimeStyles'; s.textContent=`#mudaExperienceDock{position:fixed;right:18px;bottom:18px;z-index:9999;width:min(390px,calc(100vw - 36px));padding:12px;border:1px solid rgba(87,173,225,.25);border-radius:18px;background:rgba(7,16,27,.94);backdrop-filter:blur(18px);box-shadow:0 18px 55px rgba(0,0,0,.26);color:#eef7ff;font-family:inherit}.muda-exp-head{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:8px}.muda-exp-head span{color:#8fa6bd;font-size:10px}.muda-exp-card{display:grid;grid-template-columns:1fr auto;gap:4px;padding:9px 10px;margin-top:7px;border:1px solid rgba(99,146,188,.16);border-radius:12px;background:rgba(12,27,43,.82)}.muda-exp-card span,.muda-exp-card small{grid-column:1/-1;color:#89a1b7;font-size:9px}.muda-exp-card b{font-size:14px}.muda-managed-live{max-width:980px;margin:50px auto;padding:30px;border-radius:24px;background:#0a1522;border:1px solid rgba(97,165,218,.15)}.muda-managed-live .eyebrow{font-size:10px;letter-spacing:.14em;color:#6fd6ff;font-weight:900}.muda-managed-live h1{font-size:38px;margin:10px 0 18px}.muda-managed-content{color:#b9c9d9;line-height:1.8}.muda-managed-content img{max-width:100%;border-radius:14px}`; document.head.appendChild(s);
  }
  injectStyles(); renderNavigation(); renderManagedPage(); renderExperience();
})();
