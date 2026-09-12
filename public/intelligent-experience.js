(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt = v => new Intl.NumberFormat('id-ID').format(Number(v||0));
  const state = { tab:'for-you', articles:[], follows: JSON.parse(localStorage.getItem('muda:follows')||'[]'), saves: new Set(JSON.parse(localStorage.getItem('muda:saves')||'[]')), focus:false, current:null, briefLen:60 };
  const visitorKey = (() => { let id=localStorage.getItem('muda:visitor'); if(!id){id=crypto.randomUUID?.()||('v-'+Date.now());localStorage.setItem('muda:visitor',id);} return id; })();
  const api = async (url, opt={}) => { const r=await fetch(url,{credentials:'include',...opt}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j={raw:t}} if(!r.ok) throw new Error(j.error||j.message||`HTTP ${r.status}`); return j; };

  function topicKey(a){ return [a?.category, ...(Array.isArray(a?.tags)?a.tags:[])].filter(Boolean).map(x=>String(x).toUpperCase()); }
  function score(a){
    const fresh = a?.published_at ? Math.max(0, 48-(Date.now()-new Date(a.published_at).getTime())/36e5)/48 : .2;
    const eng = Math.min(1,(Number(a?.views||0)/30000))*.55 + Math.min(1,Number(a?.shares||0)/250)*.25 + Math.min(1,Number(a?.likes||0)/300)*.20;
    const pref = topicKey(a).some(k=>state.follows.some(f=>f.key===k)) ? .35 : 0;
    return fresh*.5 + eng*.35 + pref;
  }
  function sourceLabel(a){return a?.source || 'Berita Muda';}
  function card(a){
    const saved=state.saves.has(a.id);
    return `<article class="smart-story" data-id="${esc(a.id)}">
      <div class="smart-story-media" ${a.image_url?`style="background-image:url('${esc(a.image_url)}')"`:''}></div>
      <div class="smart-story-body"><div class="smart-meta"><span>${esc(a.category||'BERITA')}</span><span>${esc(sourceLabel(a))}</span></div>
      <h3>${esc(a.title||'')}</h3><p>${esc((a.summary||'').replace(/<[^>]+>/g,'').slice(0,180))}</p>
      <div class="smart-story-foot"><button class="tiny" data-open="${esc(a.id)}">Baca</button><button class="tiny" data-ask="${esc(a.id)}">Tanya</button><button class="tiny" data-save="${esc(a.id)}">${saved?'★ Tersimpan':'☆ Simpan'}</button><button class="tiny" data-why="${esc(a.id)}">Mengapa?</button></div></div></article>`;
  }
  async function fetchArticles(limit=18){
    try { const d=await api(`/api/articles?limit=${limit}`); return Array.isArray(d)?d:(d.articles||[]); } catch { return []; }
  }
  async function loadSmartFeed(){
    const box=$('#smartFeed'); if(!box)return; box.innerHTML='<div class="smart-loading">Menganalisis berita…</div>';
    let arr=await fetchArticles(24); state.articles=arr;
    if(state.tab==='latest') arr.sort((a,b)=>new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at));
    else if(state.tab==='following') arr=arr.filter(a=>topicKey(a).some(k=>state.follows.some(f=>f.key===k)));
    else if(state.tab==='local') arr=arr.filter(a=>/JATENG|JAWA|KEBUMEN|PURWOREJO|GOMBONG|YOGYA|JAKARTA|INDONESIA/i.test(`${a.title} ${a.summary} ${a.category} ${a.tags||''}`));
    else if(state.tab==='full') arr=arr.slice().sort((a,b)=>topicKey(b).length-topicKey(a).length);
    else arr.sort((a,b)=>score(b)-score(a));
    box.innerHTML=arr.slice(0,12).map(card).join('')||'<div class="smart-empty">Belum ada cerita yang cocok.</div>';
    bindStoryButtons();
    renderBrief(arr.slice(0,5));
    renderStoryArc(arr.slice(0,5));
  }
  function bindStoryButtons(){
    $$('#smartFeed [data-open]').forEach(b=>b.onclick=()=>{window.__mudaOpenArticle?.(b.dataset.open);});
    $$('#smartFeed [data-save]').forEach(b=>b.onclick=()=>{const id=b.dataset.save;if(state.saves.has(id))state.saves.delete(id);else state.saves.add(id);localStorage.setItem('muda:saves',JSON.stringify([...state.saves]));loadSmartFeed();});
    $$('#smartFeed [data-ask]').forEach(b=>b.onclick=()=>openAsk(b.dataset.ask));
    $$('#smartFeed [data-why]').forEach(b=>b.onclick=()=>whyStory(b.dataset.why));
  }
  function renderBrief(rows){
    const el=$('#dailyBrief'); if(!el)return;
    el.innerHTML=rows.slice(0,4).map((a,i)=>`<button class="brief-item" data-open-brief="${esc(a.id)}"><span>${i+1}</span><div><b>${esc(a.title)}</b><small>${esc(a.category||'News')} · ${esc(sourceLabel(a))}</small></div></button>`).join('')||'<div class="muted">Belum ada briefing.</div>';
    $$('[data-open-brief]').forEach(b=>b.onclick=()=>window.__mudaOpenArticle?.(b.dataset.openBrief));
  }
  function renderStoryArc(rows){
    const el=$('#storyArc'); if(!el)return;
    const groups={}; rows.forEach(a=>{const k=(a.category||'NEWS').toUpperCase();(groups[k] ||= []).push(a)});
    el.innerHTML=Object.entries(groups).slice(0,3).map(([k,items])=>`<div class="arc"><b>${esc(k)}</b><div class="arc-line"></div><small>${fmt(items.length)} cerita terkait · ${esc(items[0]?.title||'')}</small></div>`).join('')||'<div class="muted">StoryArc akan terbentuk dari perkembangan event.</div>';
  }
  function renderFollowChips(){
    const el=$('#followChips'); if(!el)return;
    const pool=['NASIONAL','POLITIK','EKONOMI','TEKNOLOGI','HUKUM','OLAHRAGA','JATENG','KEBUMEN','INTERNASIONAL'];
    el.innerHTML=pool.map(k=>{const on=state.follows.some(f=>f.key===k);return `<button class="follow-chip ${on?'on':''}" data-follow="${k}">${on?'✓ ':''}${k}</button>`}).join('');
    $$('.follow-chip').forEach(b=>b.onclick=()=>{const key=b.dataset.follow;const i=state.follows.findIndex(f=>f.key===key);if(i>=0)state.follows.splice(i,1);else state.follows.push({type:'topic',key});localStorage.setItem('muda:follows',JSON.stringify(state.follows));renderFollowChips();if(state.tab==='following')loadSmartFeed();});
  }
  async function explain(a){
    const reason=[]; if(topicKey(a).some(k=>state.follows.some(f=>f.key===k)))reason.push('sesuai topik yang Anda ikuti'); if(score(a)>.55)reason.push('freshness dan engagement tinggi'); if(Number(a.shares||0)>Number(a.likes||0))reason.push('sedang banyak dibagikan'); if(!reason.length)reason.push('dipilih dari freshness dan kualitas sinyal konten');
    alert(`Mengapa cerita ini muncul?\n\n${reason.join('\n• ')}\n\nSkor lokal: ${Math.round(score(a)*100)}/100`);
  }
  async function whyStory(id){const a=state.articles.find(x=>x.id===id);if(a)explain(a);}
  function openAsk(id){const a=state.articles.find(x=>x.id===id);if(!a)return;state.current=a;$('#storyAskTitle').textContent=a.title||'Tanya tentang cerita';$('#storyAskResult').textContent='';$('#storyAskModal').classList.remove('hidden');$('#storyAskInput').focus();}
  function answerStory(q,a){
    const body=(a.content_html||a.summary||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    if(/mengapa|kenapa|penting/i.test(q)) return `${a.title} penting karena tercatat sebagai perkembangan terbaru pada ${a.category||'isu terkait'} dan berasal dari ${sourceLabel(a)}. Ringkasan sumber: ${body.slice(0,420)}${body.length>420?'…':''}`;
    if(/siapa|tokoh/i.test(q)) return `${body.slice(0,500)}${body.length>500?'…':''}`;
    if(/latar|background|sebelum|konteks/i.test(q)) return `Konteks awal: ${body.slice(0,520)}${body.length>520?'…':''}`;
    return `Dari materi cerita yang tersedia: ${body.slice(0,520)}${body.length>520?'…':''}`;
  }
  function openBrief(){ $('#briefModal').classList.remove('hidden'); $('#briefTopic').focus(); }
  function makeBrief(topic,len){
    const rows=state.articles.filter(a=>!topic||`${a.title} ${a.summary} ${a.category}`.toLowerCase().includes(topic.toLowerCase())).slice(0,6);
    if(!rows.length)return 'Belum ada cerita yang cukup untuk briefing topik tersebut.';
    return rows.map((a,i)=>`${i+1}. ${a.title} — ${(a.summary||'').replace(/<[^>]+>/g,' ').slice(0,180)}`).join('\n\n');
  }
  function listen(text){ if(!('speechSynthesis' in window))return alert('Browser ini tidak mendukung pembacaan suara.'); window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text);u.lang='id-ID';u.rate=.95;window.speechSynthesis.speak(u); }
  function init(){
    if(!$('#intelligenceShell'))return;
    // expose integration hook for existing app.js
    window.__mudaOpenArticle = (id) => window.openArticle?.(id);
    // tab behavior
    $$('#smartTabs [data-smart-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.smartTab; $$('#smartTabs button').forEach(x=>x.classList.toggle('active',x===b)); const map={'for-you':'Untuk Anda','following':'Mengikuti','latest':'Terbaru','local':'Lokal','full':'Full Coverage'}; $('#smartPanelTitle').textContent=map[state.tab]||'Untuk Anda';loadSmartFeed();});
    $('#refreshSmartFeed')?.addEventListener('click',loadSmartFeed);
    $('#briefMeBtn')?.addEventListener('click',openBrief);
    $('#listenBriefBtn')?.addEventListener('click',()=>listen(makeBrief('',180)));
    $('#focusModeBtn')?.addEventListener('click',()=>{state.focus=!state.focus;document.body.classList.toggle('focus-reading',state.focus);});
    $$('[data-close-brief]').forEach(x=>x.addEventListener('click',()=>$('#briefModal').classList.add('hidden')));
    $$('[data-close-ask]').forEach(x=>x.addEventListener('click',()=>$('#storyAskModal').classList.add('hidden')));
    $('#briefForm')?.addEventListener('submit',e=>{e.preventDefault();const t=$('#briefTopic').value.trim();$('#briefResult').textContent=makeBrief(t,state.briefLen);});
    $$('.brief-options button').forEach(b=>b.onclick=()=>{$$('.brief-options button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.briefLen=Number(b.dataset.len)});
    $('#storyAskForm')?.addEventListener('submit',e=>{e.preventDefault();$('#storyAskResult').textContent=answerStory($('#storyAskInput').value.trim(),state.current);});
    renderFollowChips();loadSmartFeed();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
