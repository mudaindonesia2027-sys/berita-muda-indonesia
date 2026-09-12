(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>new Intl.NumberFormat('id-ID').format(Number(v||0));
  const rupiah=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v||0));
  const dateTime=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(d)};
  const get=async path=>{const r=await fetch(path,{cache:'no-store',headers:{Accept:'application/json'}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok)throw new Error(d?.error||`HTTP ${r.status}`);return d};
  const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body||{})});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok)throw new Error(d?.error||`HTTP ${r.status}`);return d};

  const REGION_GROUPS={
    'Kedu & Selatan':['Purworejo','Kebumen','Magelang','Kota Magelang','Temanggung','Wonosobo'],
    'Banyumasan':['Banyumas','Cilacap','Purbalingga','Banjarnegara'],
    'Semarangan':['Kota Semarang','Kabupaten Semarang','Kendal','Demak','Grobogan'],
    'Pantura Barat':['Brebes','Kota Tegal','Kabupaten Tegal','Pemalang','Pekalongan','Kota Pekalongan'],
    'Pantura Timur':['Batang','Jepara','Kudus','Pati','Rembang'],
    'Solo Raya':['Surakarta','Boyolali','Klaten','Sukoharjo','Wonogiri','Karanganyar','Sragen'],
    'Jawa Tengah':['Banjarnegara','Banyumas','Batang','Blora','Boyolali','Brebes','Cilacap','Demak','Grobogan','Jepara','Karanganyar','Kebumen','Kendal','Klaten','Kudus','Magelang','Pati','Pekalongan','Pemalang','Purbalingga','Purworejo','Rembang','Semarang','Sragen','Sukoharjo','Tegal','Temanggung','Wonogiri','Wonosobo','Kota Magelang','Kota Pekalongan','Kota Salatiga','Kota Semarang','Kota Surakarta','Kota Tegal']
  };

  function ensureRail(){
    if($('#publicIntelligence041')) return;
    const main=$('.public-main')||$('main'); if(!main)return;
    const rail=document.createElement('section');rail.id='publicIntelligence041';rail.className='public-intel-041 container';
    rail.innerHTML=`
      <div class="intel-topline"><div><span class="eyebrow">MUDA INTELLIGENCE</span><h2>Berita yang membaca situasi, bukan sekadar menampilkan kartu.</h2><p>Waktu, wilayah, tren, minat baca, suara, peta, dan sumber data dijadikan pengalaman publik yang bisa diperiksa.</p></div><div class="intel-status" id="intelStatus">Menyiapkan mesin…</div></div>
      <div class="intel-grid">
        <section class="intel-card intel-clock" id="intelClock"><div class="intel-card-head"><span>WAKTU & KONTEKS</span><button class="intel-mini-btn" id="locationBtn">Gunakan lokasi saya</button></div><div class="clock-main" id="clockMain">—</div><div class="clock-sub" id="clockSub">Menunggu zona waktu perangkat</div><div class="location-line" id="locationLine">Lokasi perangkat tidak dibaca tanpa izin.</div><details class="intel-source"><summary>Sumber & privasi</summary><p>Jam berasal dari waktu perangkat. Lokasi hanya dibaca setelah Anda memberi izin melalui browser dan tidak dikirim sebagai profil identitas.</p></details></section>
        <section class="intel-card" id="intelReader"><div class="intel-card-head"><span>INVENTARIS MINAT BACA</span><button class="intel-mini-btn" id="clearReaderBtn">Reset perangkat</button></div><div id="readerInventory" class="reader-inventory"></div><details class="intel-source"><summary>Sumber data</summary><p>Aktivitas disusun dari interaksi di perangkat dan event publik MUDA. Tidak menampilkan nama/email pembaca.</p></details></section>
        <section class="intel-card intel-trending"><div class="intel-card-head"><span>TRENDING TOPIK</span><div class="intel-head-actions"><button class="intel-mini-btn" id="notifyBtn">Aktifkan notifikasi</button><button class="intel-mini-btn" id="trendRefresh">↻</button></div></div><div id="trendRows" class="trend-rows"></div><details class="intel-source"><summary>Lihat sumber & metode</summary><p id="trendSourceText">Menggabungkan artikel dan event interaksi yang tersedia pada server. Jika data tidak cukup, sistem menyatakan belum tersedia.</p></details></section>
        <section class="intel-card intel-voice"><div class="intel-card-head"><span>SUARA MUDA</span><button class="intel-mini-btn" id="voiceWelcomeBtn">Selamat datang</button></div><div class="voice-command-line"><button id="voiceCommandBtn" class="voice-big-btn">🎙️ <span>Dengarkan perintah</span></button><div id="voiceStatus">Contoh: “Cari ekonomi”, “Buka trending”, “Buka Jawa Tengah”.</div></div><details class="intel-source"><summary>Kompatibilitas</summary><p>Perintah suara menggunakan Speech Recognition browser yang tersedia. Tidak direkam sebagai file suara oleh fitur ini.</p></details></section>
      </div>
      <section class="intel-card map-card-041"><div class="intel-card-head"><span>MESIN PETA & WILAYAH</span><div class="intel-head-actions"><select id="mapGroupSelect" class="intel-select"></select><button class="intel-mini-btn" id="mapLocateBtn">Posisi saya</button></div></div><div id="mudaMap041" class="muda-map-041"></div><div id="mapLegend041" class="map-legend-041"></div><details class="intel-source"><summary>Sumber peta & wilayah</summary><p>Konten berita berasal dari database MUDA. Peta menggunakan OpenStreetMap melalui Leaflet ketika jaringan tersedia; posisi perangkat hanya digunakan setelah izin.</p></details></section>
      <section class="intel-card source-board-041"><div class="intel-card-head"><span>JALUR FAKTUAL</span><span class="intel-proof-badge">DATA → SUMBER → WAKTU</span></div><div id="proofRows041" class="proof-grid-041"></div></section>
    `;
    const anchor=$('.region-hub')||$('.category-showcase')||main.firstElementChild; main.insertBefore(rail,anchor||main.firstChild);
  }

  const readerKey='muda_reader_inventory_v1';
  function getReader(){try{return JSON.parse(localStorage.getItem(readerKey)||'{"reads":0,"shares":0,"likes":0,"saved":0,"categories":{},"regions":{},"topics":{},"lastRead":null}')||{}}catch{return {}}}
  function saveReader(s){localStorage.setItem(readerKey,JSON.stringify(s));}
  function paintReader(){
    const el=$('#readerInventory');if(!el)return;const s=getReader();const cat=Object.entries(s.categories||{}).sort((a,b)=>b[1]-a[1]).slice(0,4);const reg=Object.entries(s.regions||{}).sort((a,b)=>b[1]-a[1]).slice(0,4);const top=Object.entries(s.topics||{}).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const rows=[['Dibaca',fmt(s.reads)],['Disimpan',fmt(s.saved)],['Disukai',fmt(s.likes)],['Dibagikan',fmt(s.shares)]];
    el.innerHTML=`<div class="reader-kpis-041">${rows.map(([a,b])=>`<div><strong>${b}</strong><span>${a}</span></div>`).join('')}</div><div class="reader-columns-041"><div><b>Kategori utama</b>${cat.length?cat.map(([k,v])=>`<span>${esc(k)} <em>${fmt(v)}</em></span>`).join(''):'<small>Belum cukup data.</small>'}</div><div><b>Wilayah</b>${reg.length?reg.map(([k,v])=>`<span>${esc(k)} <em>${fmt(v)}</em></span>`).join(''):'<small>Belum cukup data.</small>'}</div><div><b>Topik</b>${top.length?top.map(([k,v])=>`<span>${esc(k)} <em>${fmt(v)}</em></span>`).join(''):'<small>Belum cukup data.</small>'}</div></div><div class="reader-last-041">Aktivitas terakhir: ${s.lastRead?dateTime(s.lastRead):'belum ada'} · <button type="button" id="readerExplainBtn">Jelaskan cara data ini dibentuk</button></div>`;
    $('#readerExplainBtn')?.addEventListener('click',()=>alert('Inventaris ini berasal dari interaksi pada perangkat ini: buka berita, simpan, suka, dan bagikan. Data tidak menjual atau menampilkan identitas Anda.'));
  }
  function recordReader(type,item={}){
    const s=getReader(); if(type==='read')s.reads=(s.reads||0)+1;if(type==='like')s.likes=(s.likes||0)+1;if(type==='share')s.shares=(s.shares||0)+1;if(type==='saved')s.saved=(s.saved||0)+1;const c=String(item.category||'Lainnya');const r=String(item.region||'Tidak ditentukan');if(type==='read')s.categories[c]=(s.categories[c]||0)+1;if(type==='read')s.regions[r]=(s.regions[r]||0)+1;for(const k of [...(Array.isArray(item.tags)?item.tags:[]),item.category].filter(Boolean)){s.topics[k]=(s.topics[k]||0)+1;}s.lastRead=new Date().toISOString();saveReader(s);paintReader();
  }

  function startClock(){
    const tick=()=>{const d=new Date();const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'waktu perangkat';const t=new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(d);const day=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(d);$('#clockMain')&&( $('#clockMain').textContent=t);$('#clockSub')&&($('#clockSub').textContent=`${day} · ${tz}`);};tick();setInterval(tick,1000);
  }
  async function locate(){
    const line=$('#locationLine');
    if(!navigator.geolocation){line.textContent='Browser ini tidak menyediakan geolocation.';return;}
    line.textContent='Meminta izin lokasi…';
    navigator.geolocation.getCurrentPosition(async pos=>{const lat=pos.coords.latitude.toFixed(4),lon=pos.coords.longitude.toFixed(4);line.textContent=`Lokasi perkiraan perangkat: ${lat}, ${lon} · hanya digunakan untuk pengalaman wilayah/cuaca.`;localStorage.setItem('muda_reader_geo',JSON.stringify({lat:Number(lat),lon:Number(lon),at:new Date().toISOString()}));try{const w=await get(`/api/site/weather-public?lat=${lat}&lon=${lon}`);line.textContent+=` · Cuaca saat ini ${w?.current?.temperature_2m ?? '—'}°`;}catch{}},()=>{line.textContent='Izin lokasi tidak diberikan. Peta tetap bisa digunakan tanpa posisi pribadi.'},{enableHighAccuracy:false,maximumAge:300000,timeout:8000});
  }

  async function trending(){
    const el=$('#trendRows');if(!el)return;el.innerHTML='<div class="intel-loading">Membaca sinyal terbaru…</div>';
    try{const d=await get('/api/public/intelligence/trending?limit=7');const rows=Array.isArray(d?.items)?d.items:[];el.innerHTML=rows.length?rows.map((x,i)=>`<button type="button" class="trend-row-041" data-topic="${esc(x.topic||x.title)}"><span>#${i+1}</span><div><b>${esc(x.topic||x.title)}</b><small>${fmt(x.signal_count||0)} sinyal · ${esc(x.category||'Berita')} · diperbarui ${dateTime(x.updated_at)}</small></div><strong>${Math.round(Number(x.score||0))}</strong></button>`).join(''):'<div class="intel-empty">Belum cukup data untuk menyatakan topik sedang trending.</div>';
      $$('.trend-row-041',el).forEach(b=>b.addEventListener('click',()=>window.MUDA041?.commandSearch(b.dataset.topic||'')));
    }catch(e){el.innerHTML=`<div class="intel-empty">Data trending tidak tersedia: ${esc(e.message)}</div>`}
  }

  async function loadProof(){
    const el=$('#proofRows041');if(!el)return;try{const d=await get('/api/public/intelligence/overview');const p=[['Server data',d.generated_at,'MUDA API'],['Artikel terbit',fmt(d.articles_published),'public.articles'],['Video terbit',fmt(d.videos_published),'public.videos'],['Event 24 jam',fmt(d.events_24h),'public.analytics_events'],['Rate iklan aktif',fmt(d.active_ad_rates),'owner_ad_pricing_rules']];el.innerHTML=p.map(x=>`<div class="proof-item-041"><b>${esc(x[0])}</b><strong>${esc(x[1])}</strong><small>Sumber: ${esc(x[2])}</small></div>`).join('');$('#intelStatus')&&( $('#intelStatus').textContent=`Data diperiksa ${dateTime(d.generated_at)}`);}catch(e){el.innerHTML='<div class="intel-empty">Ringkasan data belum tersedia.</div>'}
  }

  let mapInstance=null, mapMarkers=[];
  function loadLeaflet(){return new Promise((resolve,reject)=>{if(window.L)return resolve();const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(link);const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=()=>resolve();s.onerror=reject;document.head.appendChild(s);});}
  async function initMap(){
    const mount=$('#mudaMap041');if(!mount)return;try{await loadLeaflet();const regions=await get('/api/public/regions');if(!mapInstance){mapInstance=L.map(mount,{scrollWheelZoom:false}).setView([-7.3,110.4],8);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'}).addTo(mapInstance);}mapMarkers.forEach(m=>m.remove());mapMarkers=[];const sel=$('#mapGroupSelect');if(sel){sel.innerHTML=`<option value="Jawa Tengah">Jawa Tengah</option>`+Object.keys(REGION_GROUPS).filter(x=>x!=='Jawa Tengah').map(x=>`<option>${esc(x)}</option>`).join('');sel.onchange=()=>drawMap(regions,sel.value);}drawMap(regions,'Jawa Tengah');}catch(e){mount.innerHTML=`<div class="map-fallback-041"><b>Peta belum dapat dimuat.</b><span>${esc(e.message)}</span><small>MUDA tetap menampilkan data wilayah dari server jika peta provider sedang tidak tersedia.</small></div>`;}}
  function drawMap(regions,group){const allow=new Set((REGION_GROUPS[group]||REGION_GROUPS['Jawa Tengah']).map(String));const rows=regions.filter(r=>allow.has(r.name)||group==='Jawa Tengah');mapMarkers.forEach(m=>m.remove());mapMarkers=[];rows.forEach(r=>{if(!mapInstance||r.latitude==null||r.longitude==null)return;const pop=`<strong>${esc(r.name)}</strong><br>${fmt(r.article_count)} berita · ${fmt(r.video_count)} video<br><a href="/?q=${encodeURIComponent(r.query)}">Buka liputan wilayah →</a>`;const m=L.marker([r.latitude,r.longitude]).addTo(mapInstance).bindPopup(pop);mapMarkers.push(m);});$('#mapLegend041')&&($('#mapLegend041').innerHTML=`<span>${fmt(rows.length)} wilayah terpetakan</span><span>klik marker untuk membuka liputan</span>`);}

  function startVoice(){
    const status=$('#voiceStatus'),btn=$('#voiceCommandBtn'); if(!btn)return;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    btn.addEventListener('click',()=>{
      if(!SR){status.textContent='Browser ini belum mendukung perintah suara.';return;}
      const r=new SR();r.lang='id-ID';r.interimResults=false;r.maxAlternatives=1;status.textContent='Mendengarkan…';r.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript||'';status.textContent=`Perintah: “${text}”`;executeVoice(text);};r.onerror=()=>status.textContent='Suara tidak terbaca. Coba lagi.';r.onend=()=>{};try{r.start();}catch{}
    });
    $('#voiceWelcomeBtn')?.addEventListener('click',()=>speak('Selamat datang di Berita Muda Indonesia. Saya siap membantu Anda mencari berita, melihat tren, menjelajah wilayah, dan membaca informasi yang tersedia.'));
  }
  function speak(text){if(!('speechSynthesis' in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='id-ID';u.rate=.95;window.speechSynthesis.speak(u);}
  function executeVoice(text){const t=text.toLowerCase();if(/trending|tren|ramai/.test(t)){document.getElementById('trendRows')?.scrollIntoView({behavior:'smooth',block:'center'});speak('Saya membuka tren topik yang tersedia.');return;}if(/jawa tengah|wilayah|daerah|peta/.test(t)){document.querySelector('.map-card-041')?.scrollIntoView({behavior:'smooth',block:'center'});speak('Saya membuka mesin peta dan wilayah.');return;}const m=t.match(/(?:cari|search|temukan)\s+(.+)/);if(m){window.MUDA041.commandSearch(m[1]);speak(`Saya mencari ${m[1]}.`);return;}if(/beranda|home/.test(t)){location.href='/';return;}speak('Perintah belum dikenali. Coba: cari ekonomi, buka trending, atau buka Jawa Tengah.');}
  function commandSearch(q){const input=$('#searchInput');const form=$('#searchForm');if(input)input.value=q;if(form)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));else location.href=`/?q=${encodeURIComponent(q)}`;}

  async function notifications(){
    const btn=$('#notifyBtn'); if(!btn)return; if(!('Notification' in window)){btn.textContent='Notifikasi tidak didukung';btn.disabled=true;return;}
    const render=()=>{btn.textContent=Notification.permission==='granted'?'Notifikasi aktif':'Aktifkan notifikasi';};render();btn.addEventListener('click',async()=>{const p=await Notification.requestPermission();render();if(p==='granted'){checkTrendingNotify();}});setInterval(checkTrendingNotify,300000);
  }
  async function checkTrendingNotify(){if(!('Notification' in window)||Notification.permission!=='granted')return;try{const d=await get('/api/public/intelligence/trending?limit=1');const x=d?.items?.[0];if(!x?.topic)return;const key='muda_last_trend_notify_v1',seen=localStorage.getItem(key);if(seen===x.topic)return;localStorage.setItem(key,x.topic);if(navigator.serviceWorker?.controller)navigator.serviceWorker.controller.postMessage({type:'TRENDING_NOTIFICATION',title:`Trending MUDA: ${x.topic}`,body:`${fmt(x.signal_count||0)} sinyal · ${x.category||'Berita'} · buka untuk membaca sumber.`});else new Notification(`Trending MUDA: ${x.topic}`,{body:`${fmt(x.signal_count||0)} sinyal · ${x.category||'Berita'}`});}catch{}}


  async function loadAdIntelligence(){const el=$('#adIntelligence041');if(!el)return;try{const rows=await get('/api/site/ad-market-intelligence');const live=rows.filter(x=>x.active_now);if(!live.length){el.innerHTML='<div><b>Belum ada rate aktif.</b><span>Tidak ada harga yang diciptakan secara otomatis.</span></div>';return;}el.innerHTML=live.slice(0,4).map(x=>{const pct=x.price_change_pct;const cls=pct>0?'up':pct<0?'down':'flat';return `<div class="ad-intel-row"><div><b>${esc(x.placement||'Placement')}</b><small>${esc(x.region||'Nasional')} · berlaku ${dateTime(x.effective_from)}</small></div><strong>${x.computed_rate?rupiah(x.computed_rate):'—'}</strong><span class="${cls}">${pct==null?'—':`${pct>0?'+':''}${pct.toFixed(1)}%`}</span><a href="#" onclick="event.preventDefault();document.querySelector('#adMarketCard')?.scrollIntoView({behavior:'smooth',block:'center'});">sumber</a></div>`;}).join('')+`<div class="ad-intel-foot">Formula: base × audience × demand × fill × seasonal × premium · dihitung ${dateTime(new Date())}.</div>`;}catch(e){el.innerHTML='<div><b>Mesin harga belum tersedia.</b><span>Data rate card belum dapat diverifikasi.</span></div>'}}

  async function init(){ensureRail();paintReader();startClock();$('#locationBtn')?.addEventListener('click',locate);$('#clearReaderBtn')?.addEventListener('click',()=>{localStorage.removeItem(readerKey);paintReader();});$('#trendRefresh')?.addEventListener('click',trending);$('#mapLocateBtn')?.addEventListener('click',locate);startVoice();notifications();trending();loadProof();initMap();loadAdIntelligence();
    window.MUDA041={commandSearch,recordReader,paintReader};
    window.addEventListener('muda:article-read',e=>recordReader('read',e.detail||{})); window.addEventListener('muda:reader-action',e=>{const d=e.detail||{}; if(d.item)recordReader(d.action||'read',d.item);});
    navigator.serviceWorker?.register('/sw.js?v=v19-041').catch(()=>{});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
