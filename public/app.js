(() => {
  const state = { category:'', query:'', articles:[], videos:[], loading:false, autoTimer:null, heroId:null };
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const els = {
    today:$('#todayLabel'), clock:$('#clockLabel'), sourceStatus:$('#sourceStatus'), ticker:$('#tickerText'),
    heroImage:$('#heroImage'), heroCategory:$('#heroCategory'), heroTitle:$('#heroTitle'), heroSummary:$('#heroSummary'), heroDate:$('#heroDate'), heroViews:$('#heroViews'), heroOpen:$('#heroOpen'), compact:$('#compactNews'), trending:$('#trendingList'),
    nav:$('#categoryNav'), tiles:$('#categoryTiles'), pills:$('#filterPills'), section:$('#sectionTitle'), count:$('#feedCount'), clear:$('#clearFilter'),
    grid:$('#articlesGrid'), loading:$('#loadingState'), empty:$('#emptyState'), emptyTitle:$('#emptyTitle'), emptyText:$('#emptyText'),
    refresh:$('#refreshBtn'), emptyRefresh:$('#emptyRefresh'), form:$('#searchForm'), search:$('#searchInput'),
    videoGrid:$('#videoGrid'), liveUpdates:$('#liveUpdates'), modal:$('#articleModal'), modalBody:$('#modalBody'), toast:$('#toastZone'),
    theme:$('#themeToggle'), videoShortcut:$('#videoShortcut'), videoNav:$('#videoNav'), liveTv:$('#liveTvBtn'), showAllVideos:$('#showAllVideos')
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stripHtml = value => String(value ?? '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const fmtDate = value => {
    if(!value) return 'Baru diperbarui'; const d = new Date(value); if(Number.isNaN(d.getTime())) return 'Baru diperbarui';
    const diff = Date.now()-d.getTime(); if(diff<60000) return 'Baru saja'; if(diff<3600000) return `${Math.max(1,Math.floor(diff/60000))} menit lalu`; if(diff<86400000) return `${Math.floor(diff/3600000)} jam lalu`;
    return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
  };
  const articleTime = a => a?.published_at || a?.created_at || a?.updated_at;
  const imageUrl = item => item?.image_url || item?.thumbnail_url || '';
  const toast = (msg,type='') => { const n=document.createElement('div'); n.className=`toast ${type}`; n.textContent=msg; els.toast.appendChild(n); setTimeout(()=>n.remove(),3600); };

  function updateClock(){
    const now=new Date(); els.today.textContent=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now);
    els.clock.textContent=new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Jakarta'}).format(now)+' WIB';
  }

  function setLoading(on){ state.loading=on; els.loading.classList.toggle('hidden',!on); if(on) els.empty.classList.add('hidden'); }
  function activateCategory(category){
    state.category=category;
    $$('.nav-item[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===category));
    $$('.pill').forEach(b=>b.classList.toggle('active',b.dataset.category===category));
  }

  function articleCard(a,index){
    const card=document.createElement('article'); card.className=`article-card${index===0?' featured':''}`;
    const bg=imageUrl(a); const title=a.title||'Berita terbaru'; const summary=stripHtml(a.summary||a.content_html||'Ringkasan berita belum tersedia.');
    card.innerHTML=`<div class="article-thumb" ${bg?`style="background-image:url('${escapeHtml(bg)}')"`:''}></div><div class="article-body"><div class="article-meta"><span class="article-category">${escapeHtml(a.category||'TERBARU')}</span><span>${escapeHtml(fmtDate(articleTime(a)))}</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(summary)}</p><div class="article-foot"><span>${escapeHtml(a.source||'Berita Muda')}</span><span class="read-link">Baca →</span></div></div>`;
    card.addEventListener('click',()=>openArticle(a.id,a)); return card;
  }

  function renderHero(){
    const a=state.articles[0]; state.heroId=a?.id||null;
    if(!a){
      els.heroImage.classList.remove('has-image'); els.heroImage.style.backgroundImage=''; els.heroCategory.textContent='TOP STORY'; els.heroTitle.textContent='Newsroom siap menerima pembaruan terbaru';
      els.heroSummary.textContent='Berita utama akan tampil otomatis ketika sumber data dan sinkronisasi newsroom aktif.'; els.heroDate.textContent='LIVE DATA'; els.heroViews.textContent='Menunggu sinkronisasi'; els.ticker.textContent='Sumber berita belum mengirim artikel baru.'; return;
    }
    const bg=imageUrl(a); els.heroImage.style.backgroundImage=bg?`url("${bg.replace(/"/g,'\\"')}")`:''; els.heroImage.classList.toggle('has-image',Boolean(bg));
    els.heroCategory.textContent=a.category||'TOP STORY'; els.heroTitle.textContent=a.title||'Berita terbaru'; els.heroSummary.textContent=stripHtml(a.summary||a.content_html||'Ringkasan berita terbaru dari newsroom.');
    els.heroDate.textContent=fmtDate(articleTime(a)); els.heroViews.textContent=a.views?`${Number(a.views).toLocaleString('id-ID')} views`:'Realtime update'; els.ticker.textContent=a.title||'Berita terbaru';
  }

  function renderCompact(){
    els.compact.innerHTML=''; state.articles.slice(1,4).forEach(a=>{
      const b=document.createElement('button'); b.className='compact-card'; const bg=imageUrl(a);
      b.innerHTML=`<div class="compact-thumb" ${bg?`style="background-image:url('${escapeHtml(bg)}')"`:''}></div><div class="compact-copy"><span class="tag ghost">${escapeHtml(a.category||'TERBARU')}</span><h3>${escapeHtml(a.title||'Berita terbaru')}</h3><small>${escapeHtml(fmtDate(articleTime(a)))} · ${escapeHtml(a.source||'Berita Muda')}</small></div>`;
      b.addEventListener('click',()=>openArticle(a.id,a)); els.compact.appendChild(b);
    });
    if(!els.compact.children.length){ els.compact.innerHTML='<div class="compact-card"><div class="compact-thumb"></div><div class="compact-copy"><span class="tag ghost">SMART FEED</span><h3>Artikel terbaru akan muncul di sini</h3><small>Menunggu sinkronisasi</small></div></div>'; }
  }

  function renderTrending(){
    els.trending.innerHTML=''; state.articles.slice(0,5).forEach((a,i)=>{
      const li=document.createElement('li'); li.innerHTML=`<button>${escapeHtml(a.title||'Berita terbaru')}</button><span class="trend-up">↗</span>`; li.querySelector('button').addEventListener('click',()=>openArticle(a.id,a)); els.trending.appendChild(li);
    });
    if(!els.trending.children.length){ els.trending.innerHTML='<li><button>Trending akan muncul setelah data berita tersedia</button><span class="trend-up">·</span></li>'; }
  }

  function renderArticles(){
    els.grid.innerHTML=''; state.articles.forEach((a,i)=>els.grid.appendChild(articleCard(a,i))); const count=state.articles.length;
    els.count.textContent=`${count} berita`; els.clear.classList.toggle('hidden',!(state.category||state.query));
    els.section.textContent=state.query?`Hasil Pencarian: ${state.query}`:state.category?`Berita ${state.category.toLowerCase().replace(/(^|\s)\S/g,s=>s.toUpperCase())}`:'Berita Terbaru';
    els.empty.classList.toggle('hidden',count>0);
    if(!count){ els.emptyTitle.textContent='Newsroom sedang menunggu data'; els.emptyText.textContent='API dapat diakses, tetapi belum ada artikel published. Hubungkan Supabase, jalankan migration, dan aktifkan sinkronisasi sumber berita.'; }
  }

  async function loadSystem(){
    try{ const r=await fetch('/api/system/config',{cache:'no-store'}); const d=await r.json();
      els.sourceStatus.textContent=d.supabaseConfigured?'Sumber data terhubung':'Mode konfigurasi';
    }catch{ els.sourceStatus.textContent='Status sumber tidak tersedia'; }
  }

  async function loadArticles({silent=false}={}){
    if(state.loading)return; if(!silent)setLoading(true); const params=new URLSearchParams({limit:'24'}); if(state.category)params.set('category',state.category); if(state.query)params.set('q',state.query);
    try{
      const r=await fetch(`/api/articles?${params}`,{headers:{Accept:'application/json'},cache:'no-store'}); if(!r.ok)throw new Error(`API ${r.status}`); const d=await r.json(); state.articles=Array.isArray(d)?d:[];
      renderHero(); renderCompact(); renderTrending(); renderArticles();
      if(state.articles.length) els.sourceStatus.textContent='Live data aktif';
      else if(r.headers.get('X-BMI-Data-Mode')==='configuration-required') els.sourceStatus.textContent='Supabase belum terhubung';
    }catch(e){ console.error(e); state.articles=[]; renderHero(); renderCompact(); renderTrending(); renderArticles(); els.sourceStatus.textContent='Koneksi perlu perhatian'; els.emptyTitle.textContent='Koneksi berita belum berhasil'; els.emptyText.textContent=`Tidak dapat mengambil berita dari API: ${e.message}`; toast('Belum bisa memuat berita. Periksa konfigurasi server.'); }
    finally{ setLoading(false); }
  }

  function renderLiveUpdates(){
    const now=new Date(); const items=state.articles.slice(0,4); els.liveUpdates.innerHTML='';
    (items.length?items:[{title:'Sistem memantau pembaruan sumber berita secara berkala.'},{title:'Data live akan masuk otomatis setelah sinkronisasi aktif.'}]).forEach((a,i)=>{
      const row=document.createElement('div'); row.className='live-update'; const t=new Date(now.getTime()-i*7*60000);
      row.innerHTML=`<time>${new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Jakarta'}).format(t)}</time><p>${escapeHtml(a.title)}</p>`; els.liveUpdates.appendChild(row);
    });
  }

  async function loadVideos(){
    try{ const r=await fetch('/api/videos?limit=6',{headers:{Accept:'application/json'},cache:'no-store'}); if(!r.ok)throw new Error(); const d=await r.json(); state.videos=Array.isArray(d)?d:[]; }
    catch{ state.videos=[]; }
    els.videoGrid.innerHTML=''; state.videos.slice(0,4).forEach(v=>{
      const card=document.createElement('button'); card.className='video-card'; const bg=imageUrl(v);
      card.innerHTML=`<div class="video-thumb" ${bg?`style="background-image:url('${escapeHtml(bg)}')"`:''}></div><div><h4>${escapeHtml(v.title||'Video terbaru')}</h4><small>${escapeHtml(v.category||'VIDEO')} · ${escapeHtml(v.source||'Berita Muda')}</small></div>`;
      card.addEventListener('click',()=>openVideo(v)); els.videoGrid.appendChild(card);
    });
    if(!state.videos.length) els.videoGrid.innerHTML='<div class="video-empty">Belum ada video published. Modul video sudah siap menerima konten dari database.</div>';
  }

  async function openArticle(id,fallback){
    els.modal.classList.remove('hidden'); document.body.style.overflow='hidden'; els.modalBody.innerHTML='<div class="modal-content"><span class="eyebrow">MEMUAT ARTIKEL</span><h2>Menyiapkan berita…</h2></div>';
    let a=fallback;
    if(id){ try{ const r=await fetch(`/api/articles/${encodeURIComponent(id)}`,{headers:{Accept:'application/json'},cache:'no-store'}); if(r.ok)a=await r.json(); }catch{} }
    if(!a){ els.modalBody.innerHTML='<div class="modal-content"><span class="eyebrow">DATA BELUM TERSEDIA</span><h2>Artikel tidak dapat dibuka</h2><p>Konten mungkin belum tersinkronisasi atau sumber data belum aktif.</p></div>'; return; }
    const bg=imageUrl(a); const body=a.content_html||`<p>${escapeHtml(a.summary||'Isi artikel belum tersedia.')}</p>`;
    els.modalBody.innerHTML=`${bg?`<img class="modal-hero" src="${escapeHtml(bg)}" alt="${escapeHtml(a.title||'Berita')}">`:''}<div class="modal-content"><span class="eyebrow">${escapeHtml(a.category||'BERITA')}</span><h2>${escapeHtml(a.title||'Berita terbaru')}</h2><p class="summary">${escapeHtml(stripHtml(a.summary||''))}</p><div class="article-html">${body}</div>${a.source_url||a.url?`<a class="modal-source" href="${escapeHtml(a.source_url||a.url)}" target="_blank" rel="noopener noreferrer">Baca sumber asli ↗</a>`:''}</div>`;
  }

  function openVideo(v){
    els.modal.classList.remove('hidden'); document.body.style.overflow='hidden';
    const source=v.video_url; const bg=imageUrl(v);
    els.modalBody.innerHTML=`<div class="modal-content"><span class="eyebrow">VIDEO</span><h2>${escapeHtml(v.title||'Video terbaru')}</h2>${source?`<video controls playsinline poster="${escapeHtml(bg)}" style="width:100%;border-radius:12px;background:#000" src="${escapeHtml(source)}"></video>`:`${bg?`<img class="modal-hero" src="${escapeHtml(bg)}" alt="${escapeHtml(v.title)}">`:''}<p class="summary">Video sudah terdaftar tetapi URL playback belum tersedia.</p>`}<p class="summary">${escapeHtml(v.description||'')}</p></div>`;
  }

  function closeModal(){ els.modal.classList.add('hidden'); document.body.style.overflow=''; }
  function scrollToVideo(){ $('#videoPanel').scrollIntoView({behavior:'smooth',block:'start'}); }

  els.heroOpen.addEventListener('click',()=>openArticle(state.heroId,state.articles[0]));
  els.refresh.addEventListener('click',async()=>{ await loadArticles(); renderLiveUpdates(); toast('Pembaruan selesai.','success'); });
  els.emptyRefresh.addEventListener('click',()=>loadArticles());
  els.form.addEventListener('submit',e=>{e.preventDefault(); state.query=els.search.value.trim(); activateCategory(''); loadArticles();});
  els.nav.addEventListener('click',e=>{const b=e.target.closest('[data-category]'); if(!b)return; state.query=''; els.search.value=''; activateCategory(b.dataset.category); loadArticles();});
  els.tiles.addEventListener('click',e=>{const b=e.target.closest('[data-category]'); if(!b)return; state.query=''; els.search.value=''; activateCategory(b.dataset.category); loadArticles(); window.scrollTo({top:$('#sectionTitle').getBoundingClientRect().top+scrollY-80,behavior:'smooth'});});
  els.pills.addEventListener('click',e=>{const b=e.target.closest('[data-category]'); if(!b)return; state.query=''; els.search.value=''; activateCategory(b.dataset.category); loadArticles();});
  els.clear.addEventListener('click',()=>{state.query='';els.search.value='';activateCategory('');loadArticles();});
  $$('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal)); document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
  els.theme.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;localStorage.setItem('bmi-theme',next);});
  const saved=localStorage.getItem('bmi-theme'); if(saved)document.documentElement.dataset.theme=saved;
  els.videoShortcut.addEventListener('click',scrollToVideo); els.videoNav.addEventListener('click',scrollToVideo); els.liveTv.addEventListener('click',scrollToVideo); els.showAllVideos.addEventListener('click',scrollToVideo);
  $('#refreshLive').addEventListener('click',()=>{renderLiveUpdates();toast('Live update diperbarui.','success');});
  $('#advertiseBtn').addEventListener('click',()=>toast('Modul penawaran iklan siap dihubungkan ke formulir dan payment flow.'));
  $('#exploreBtn').addEventListener('click',()=>$('#sectionTitle').scrollIntoView({behavior:'smooth'}));
  $('#openTrending').addEventListener('click',()=>{activateCategory(''); state.query=''; loadArticles(); $('#sectionTitle').scrollIntoView({behavior:'smooth'});});
  $('#loginBtn').addEventListener('click',()=>toast('Login dapat diaktifkan melalui Supabase Auth / Google OAuth.'));
  $('#joinBtn').addEventListener('click',()=>toast('Registrasi akan memakai modul Auth ketika kredensial OAuth diaktifkan.'));
  $('#notificationBtn').addEventListener('click',()=>toast(state.articles.length?'Ada pembaruan baru di feed hari ini.':'Belum ada notifikasi baru.'));
  $('#newsletterForm').addEventListener('submit',e=>{e.preventDefault(); e.target.reset(); toast('Terima kasih. Form newsletter siap dihubungkan ke database/email service.','success');});

  updateClock(); setInterval(updateClock,1000); $('#year').textContent=new Date().getFullYear();
  Promise.all([loadSystem(),loadArticles(),loadVideos()]).then(renderLiveUpdates);
  state.autoTimer=setInterval(async()=>{await loadArticles({silent:true});renderLiveUpdates();},60000);
})();
