(()=>{
  'use strict';
  const K='muda_owner_os_token';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=v=>new Intl.NumberFormat('id-ID').format(Number(v||0));
  const money=v=>'Rp '+nf(v);
  const token=()=>sessionStorage.getItem(K)||'';
  async function api(path,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};const t=token();if(t)headers.Authorization='Bearer '+t;const r=await fetch(path,{...opt,headers});const txt=await r.text();let d={};try{d=txt?JSON.parse(txt):{}}catch{d={error:txt}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
  function toast(msg,bad=false){if(typeof window.toast==='function')return window.toast(msg,bad);const el=document.createElement('div');el.style.cssText='position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 14px;border:1px solid #29445f;border-radius:10px;background:#081320;color:#dbe8f6';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3000)}
  const V={};
  V.render=async function(){
    try{
      const d=await api('/api/admin/owner/ultimate/cockpit');
      const finance=d.finance||{}, month=finance.month||{}, caps=d.capabilities||{};
      const sig=d.signals||[];
      const critical=sig.filter(x=>['critical','high'].includes(String(x.severity))).length;
      const mode=critical?'GUARDED':(caps.conditional?'CONDITIONAL':'OPTIMAL');
      $('v19_mode').textContent=mode; $('v19_mode_reason').textContent=critical?`${critical} signal prioritas tinggi.`:(caps.conditional?`${caps.conditional} capability menunggu dependency.`:'Core V19 runtime sehat.');
      $('v19_signal_count').textContent=nf(sig.length); $('v19_ready').textContent=nf(caps.ready); $('v19_cap_summary').textContent=`${nf(caps.guarded)} guarded · ${nf(caps.conditional)} conditional`;
      $('v19_net').textContent=money(month.net);
      $('v19_brief').innerHTML=(sig.slice(0,6).map((x,i)=>`<div class="item"><div class="item-row"><div><h3>${i+1}. ${esc(x.title||x.kind||'Decision')}</h3><p>${esc(x.explanation||x.reason||'')}</p></div><span class="tag">${esc(x.severity||'info')} · ${nf(x.confidence)}%</span></div><div class="actions"><button class="secondary" data-v19-cmd="${esc(x.recommended_action||x.action||x.title||'review decision')}">Act</button></div></div>`).join(''))||'<div class="muted">Tidak ada signal prioritas.</div>';
      $('v19_signals').innerHTML=(sig.map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.title||x.kind||'Signal')}</h3><p>${esc(x.explanation||'')}</p></div><span class="tag">${esc(x.severity||'info')} · ${nf(x.score)}</span></div><div class="actions"><button class="secondary" data-v19-signal="ack" data-id="${esc(x.id||'')}">Acknowledge</button><button class="good" data-v19-signal="resolved" data-id="${esc(x.id||'')}">Resolve</button></div></div>`).join(''))||'<div class="muted">Decision Signal Engine tidak memiliki signal terbuka.</div>';
      const ft=finance.totals||{};
      $('v19_finance').innerHTML=`<div class="grid-3"><div class="metric"><span>Month In</span><b>${money(month.inflow)}</b></div><div class="metric"><span>Month Out</span><b>${money(month.outflow)}</b></div><div class="metric"><span>Net</span><b>${money(month.net)}</b></div></div><div class="grid-3" style="margin-top:8px"><div class="metric"><span>AR Open</span><b>${money(ft.receivableOpen)}</b></div><div class="metric"><span>AR Overdue</span><b>${money(ft.receivableOverdue)}</b></div><div class="metric"><span>AP Overdue</span><b>${money(ft.payableOverdue)}</b></div></div>`;
      const m=d.media||{};
      $('v19_media').innerHTML=`<div class="grid-3"><div class="metric"><span>Articles</span><b>${nf(m.articleStats?.total)}</b></div><div class="metric"><span>Videos</span><b>${nf(m.videoStats?.total)}</b></div><div class="metric"><span>Breaking</span><b>${nf(m.breaking?.length)}</b></div></div><div class="grid-2" style="margin-top:8px"><div class="metric"><span>Live Events</span><b>${nf(m.events?.length)}</b></div><div class="metric"><span>Top Story</span><b style="font-size:13px">${esc(m.topStory?.title||'—')}</b></div></div>`;
      $('v19_caps').innerHTML=(caps.features||[]).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.name)}</h3><p>${esc(x.area||'')} · ${esc(x.runtime_reason||'')}</p></div><span class="tag">${esc(x.runtime_status||'unknown')}</span></div></div>`).join('')||'<div class="muted">Capability matrix belum tersedia.</div>';
      await V.goals(); await V.outcomes(); await V.timeline();
      document.querySelectorAll('[data-v19-cmd]').forEach(b=>b.onclick=()=>{const txt=b.dataset.v19Cmd;if(typeof window.submitOwnerCommand==='function'){const i=document.getElementById('ownerCommandText');if(i)i.value=txt;window.submitOwnerCommand()}else toast(txt)});
      document.querySelectorAll('[data-v19-signal]').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/owner/decision-signals/'+encodeURIComponent(b.dataset.id),{method:'PATCH',body:JSON.stringify({status:b.dataset.v19Signal})});await V.render();toast('Signal diperbarui')}catch(e){toast(e.message,true)}});
    }catch(e){toast(e.message,true)}
  };
  V.goals=async function(){try{const d=await api('/api/admin/owner/goals');$('v19_goals').innerHTML=(d||[]).map(x=>`<div class="item"><h3>${esc(x.title)}</h3><p>Target ${nf(x.target_value)} ${esc(x.unit||'')} · horizon ${esc(x.horizon||'')}</p></div>`).join('')||'<div class="muted">Belum ada goal aktif.</div>'}catch(e){$('v19_goals').innerHTML='<div class="muted">Goal belum dapat dimuat.</div>'}};
  V.outcomes=async function(){try{const d=await api('/api/admin/owner/timeline');const rows=(d.events||[]).filter(x=>x.type==='outcome').slice(0,10);$('v19_outcomes').innerHTML=rows.map(x=>`<div class="item"><h3>${esc(x.title||'Outcome')}</h3><p>${esc(x.detail||'')}</p></div>`).join('')||'<div class="muted">Belum ada outcome.</div>'}catch{}};
  V.timeline=async function(){try{const d=await api('/api/admin/owner/timeline');$('v19_timeline_list').innerHTML=(d.events||[]).slice(0,35).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.title||x.type||'Event')}</h3><p>${esc(x.detail||'')}</p></div><span class="tag">${esc(x.type||'')} · ${esc(x.at||'')}</span></div></div>`).join('')||'<div class="muted">Timeline kosong.</div>'}catch(e){$('v19_timeline_list').innerHTML='<div class="muted">Timeline tidak tersedia.</div>'}};
  V.brief=async()=>{try{await api('/api/admin/owner/briefing/generate',{method:'POST',body:JSON.stringify({brief_type:'morning'})});toast('Brief dibuat');V.render()}catch(e){toast(e.message,true)}};
  V.snapshot=async()=>{try{await api('/api/admin/owner/media/snapshot',{method:'POST',body:'{}'});toast('Media snapshot tersimpan');V.render()}catch(e){toast(e.message,true)}};
  V.reconcile=async()=>{try{await api('/api/admin/owner/finance/reconcile-legacy',{method:'POST',body:'{}'}).catch(()=>({}));await api('/api/admin/owner/finance/reconcile',{method:'POST',body:'{}'});toast('Reconciliation selesai');V.render()}catch(e){toast(e.message,true)}};
  V.close=async()=>{try{await api('/api/admin/owner/finance/close-month',{method:'POST',body:'{}'});toast('Month close diproses');V.render()}catch(e){toast(e.message,true)}};
  V.goal=async()=>{const title=prompt('Judul goal Owner');if(!title)return;const target=prompt('Target numerik','100');try{await api('/api/admin/owner/goals',{method:'POST',body:JSON.stringify({title,target_value:Number(target)||0,unit:'score',horizon:'7 hari'})});toast('Goal dibuat');V.render()}catch(e){toast(e.message,true)}};
  V.outcome=async()=>{const action=prompt('Action key / command yang dievaluasi');if(!action)return;const score=prompt('Outcome score 0-100','80');const notes=prompt('Catatan hasil','');try{await api('/api/admin/owner/outcomes',{method:'POST',body:JSON.stringify({action_key:action,outcome_score:Number(score)||0,notes,accepted:true})});toast('Outcome direkam');V.render()}catch(e){toast(e.message,true)}};
  V.bind=()=>{
    const tab=document.querySelector('#nav button[data-view="v19"]'); if(tab)tab.addEventListener('click',()=>V.render());
    $('v19_refresh')?.addEventListener('click',V.render); $('v19_brief_btn')?.addEventListener('click',V.brief); $('v19_snapshot_btn')?.addEventListener('click',V.snapshot); $('v19_reconcile_btn')?.addEventListener('click',V.reconcile); $('v19_finance_refresh')?.addEventListener('click',V.render); $('v19_export')?.addEventListener('click',()=>{window.open('/api/admin/owner/finance/report.csv','_blank')}); $('v19_close')?.addEventListener('click',V.close); $('v19_goal')?.addEventListener('click',V.goal); $('v19_outcome')?.addEventListener('click',V.outcome); $('v19_timeline')?.addEventListener('click',V.timeline);
    setInterval(()=>{if(token() && !$('view-v19')?.classList.contains('hidden'))V.render()},30000);
  };
  window.MudaV19Cockpit=V;
  document.addEventListener('DOMContentLoaded',V.bind);
})();
