(()=>{
  'use strict';
  const K='muda_owner_os_token';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=v=>new Intl.NumberFormat('id-ID').format(Number(v||0));
  const money=v=>'Rp '+nf(v);
  const token=()=>sessionStorage.getItem(K)||'';
  async function api(path,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};const t=token();if(t)headers.Authorization='Bearer '+t;const r=await fetch(path,{...opt,headers});const txt=await r.text();let d={};try{d=txt?JSON.parse(txt):{}}catch{d={error:txt}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
  function toast(msg,bad=false){if(typeof window.toast==='function')return window.toast(msg,bad);const el=document.createElement('div');el.style.cssText='position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 14px;border:1px solid '+(bad?'#8f4650':'#275f4d')+';border-radius:10px;background:'+(bad?'#2a1117':'#0f241b')+';color:#eaf5ff';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3200)}

  const V={state:{cockpit:null,finance:null,wallet:null,timeline:null,activeFinance:'overview'}};

  function setText(id,v){const e=$(id);if(e)e.textContent=v}
  function safeArr(v){return Array.isArray(v)?v:[]}
  function drawFinanceChart(months){
    const c=$('fin_chart'); if(!c)return;
    const ctx=c.getContext('2d'), dpr=window.devicePixelRatio||1, w=c.clientWidth||700, h=c.clientHeight||90;
    c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const rows=safeArr(months); if(!rows.length){ctx.fillStyle='#7f93aa';ctx.font='11px system-ui';ctx.fillText('Belum ada seri cashflow bulanan.',12,46);return}
    const inflow=rows.map(x=>Number(x.in||x.inflow||0)), outflow=rows.map(x=>Number(x.out||x.outflow||0));
    const max=Math.max(1,...inflow,...outflow); const pad=14; const step=(w-pad*2)/Math.max(1,rows.length-1);
    const line=(vals,stroke)=>{ctx.beginPath();vals.forEach((v,i)=>{const x=pad+i*step,y=h-pad-(v/max)*(h-pad*2);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()};
    line(inflow,'#54e4ff'); line(outflow,'#9a86ff');
    rows.forEach((x,i)=>{if(i%Math.max(1,Math.ceil(rows.length/6))===0){const xx=pad+i*step;ctx.fillStyle='#6f859e';ctx.font='9px system-ui';ctx.fillText(String(x.month||x.label||'').slice(0,7),Math.max(0,xx-14),h-2)}});
  }

  async function loadFinance(){
    try{
      const [f,w]=await Promise.all([api('/api/admin/owner/finance/admin'),api('/api/admin/wallet/summary').catch(()=>[]) ]);
      V.state.finance=f||{};V.state.wallet=safeArr(w);
      const s=f?.summary||{}; const a=V.state.wallet[0]||{};
      setText('fin_cash',money(a.available_balance??0));setText('fin_in',money(s.inflow));setText('fin_out',money(s.outflow));setText('fin_net',money(s.net));setText('fin_ar',money(s.openAR));setText('fin_ap',money(s.openAP));
      const close=(f.closes||[])[0];
      setText('fin_close_state',`Close state: ${close?.status||'open'} · period ${close?.period_month||'current'}`);
      const margin=Number(s.margin||0); const checks=[
        ['AR overdue',Number(s.overdueAR||0)===0,s.overdueAR],['AP overdue',Number(s.overdueAP||0)===0,s.overdueAP],['Margin',margin>=20,margin],['Reconciliation',true,''],['Budget',true,'']
      ];
      $('fin_checks').innerHTML=checks.map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x[0])}</h3><p>${x[0]==='Margin'?`Margin ${Number(x[2]).toFixed(1)}%`:x[2]?money(x[2]):'Tidak ada red flag'}</p></div><span class="tag ${x[1]?'good-t':'amber-t'}">${x[1]?'OK':'REVIEW'}</span></div></div>`).join('');
      const score=Math.max(0,Math.min(100,100-(Number(s.overdueAR||0)>0?20:0)-(Number(s.overdueAP||0)>0?20:0)-(margin<10?25:margin<20?10:0)));
      $('fin_health').innerHTML=`<div class="metric"><span>Finance Health</span><b>${Math.round(score)}%</b><div class="kpi-bar" style="margin-top:10px"><i style="width:${score}%"></i></div></div>`;
      drawFinanceChart(s.months||[]); renderFinanceDetail(V.state.activeFinance); renderEcosystem(V.state.cockpit||f);
    }catch(e){toast(e.message,true)}
  }

  function renderFinanceDetail(kind){
    const f=V.state.finance||{}, s=f.summary||{}, body=$('fin_detail_body'), title=$('fin_detail_title'), desc=$('fin_detail_desc'), tag=$('fin_detail_tag'); if(!body)return;
    const set=(t,d)=>{title.textContent=t;desc.textContent=d;tag.textContent=kind.toUpperCase()};
    if(kind==='overview'){
      set('Finance Overview','Ringkasan pusat: cash position, inflow, outflow, AR/AP, margin, dan period close.');
      body.innerHTML=`<div class="grid-4"><div class="metric"><span>Overdue AR</span><b>${money(s.overdueAR)}</b></div><div class="metric"><span>Overdue AP</span><b>${money(s.overdueAP)}</b></div><div class="metric"><span>Margin</span><b>${Number(s.margin||0).toFixed(1)}%</b></div><div class="metric"><span>Ledger Rows</span><b>${nf((f.ledger||[]).length)}</b></div></div>`;
    }else if(kind==='cash'){
      set('Cashflow & Runway','Arus kas untuk mengukur kemampuan operasi dan tekanan outflow.');
      const cash=Number((V.state.wallet[0]||{}).available_balance||0), net=Number(s.net||0); body.innerHTML=`<div class="grid-3"><div class="metric"><span>Available Cash</span><b>${money(cash)}</b></div><div class="metric"><span>Monthly Net</span><b>${money(net)}</b></div><div class="metric"><span>Runway Signal</span><b>${net>=0?'STABLE':'WATCH'}</b></div></div><div class="status" style="margin-top:10px">Runway lanjutan dapat dikaitkan ke burn rate dan recurring outflow yang tersedia di Money Intelligence.</div>`;
    }else if(kind==='ar'){
      set('Accounts Receivable','Piutang: open, partial, overdue, invoice, expected payment dan penerimaan.');
      body.innerHTML=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Counterparty</th><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${safeArr(f.receivables).slice(0,80).map(x=>`<tr><td>${esc(x.counterparty||'—')}</td><td>${esc(x.invoice_number||'—')}</td><td>${money(x.amount)}</td><td>${esc(x.due_at||'—')}</td><td>${esc(x.status||'')}</td><td><button class="secondary" data-arpay="${esc(x.id)}">Payment</button></td></tr>`).join('')}</tbody></table></div>`;
    }else if(kind==='ap'){
      set('Accounts Payable','Hutang: open, partial, overdue, invoice, expected payment dan settlement.');
      body.innerHTML=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Vendor</th><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${safeArr(f.payables).slice(0,80).map(x=>`<tr><td>${esc(x.counterparty||'—')}</td><td>${esc(x.invoice_number||'—')}</td><td>${money(x.amount)}</td><td>${esc(x.due_at||'—')}</td><td>${esc(x.status||'')}</td><td><button class="secondary" data-appay="${esc(x.id)}">Payment</button></td></tr>`).join('')}</tbody></table></div>`;
    }else if(kind==='ledger'){
      set('Canonical Money Ledger','Satu sumber pencatatan untuk revenue, expense, capital, receivable payment, payable payment dan adjustment.');
      body.innerHTML=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Direction</th><th>Type</th><th>Counterparty</th><th>Amount</th><th>Status</th><th>Reconcile</th></tr></thead><tbody>${safeArr(f.ledger).slice(0,100).map(x=>`<tr><td>${esc(x.occurred_at||'')}</td><td>${esc(x.direction||'')}</td><td>${esc(x.entry_type||'')}</td><td>${esc(x.counterparty||'—')}</td><td>${money(x.amount)}</td><td>${esc(x.status||'')}</td><td>${esc(x.reconciliation_status||'')}</td></tr>`).join('')}</tbody></table></div>`;
    }else if(kind==='budget'){
      set('Budget & Variance','Budget by period/cost center dan kontrol utilisasi terhadap actual spend.');
      body.innerHTML=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Budget</th><th>Period</th><th>Amount</th><th>Spent</th><th>Variance</th><th>Util.</th></tr></thead><tbody>${safeArr(f.budgets).map(x=>{const util=Number(x.amount)>0?Number(x.spent||0)/Number(x.amount)*100:0;return `<tr><td>${esc(x.name||'Budget')}</td><td>${esc(x.period_start||'')} → ${esc(x.period_end||'')}</td><td>${money(x.amount)}</td><td>${money(x.spent)}</td><td>${money(Number(x.amount||0)-Number(x.spent||0))}</td><td>${util.toFixed(0)}%</td></tr>`}).join('')}</tbody></table></div>`;
    }else if(kind==='recurring'){
      set('Recurring Control','Pemasukan/pengeluaran berulang dan dampaknya terhadap future cashflow.');
      body.innerHTML=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Direction</th><th>Amount</th><th>Frequency</th><th>Next Run</th><th>Active</th></tr></thead><tbody>${safeArr(f.recurring).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.direction)}</td><td>${money(x.amount)}</td><td>${esc(x.frequency)}</td><td>${esc(x.next_run||'')}</td><td>${x.active?'YES':'NO'}</td></tr>`).join('')}</tbody></table></div>`;
    }else if(kind==='close'){
      set('Month Close & Reconciliation','Rekonsiliasi → checks → close → reopen dengan audit.');
      body.innerHTML=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Period</th><th>Status</th><th>Closed At</th><th>Variance</th></tr></thead><tbody>${safeArr(f.closes).map(x=>`<tr><td>${esc(x.period_month||'')}</td><td>${esc(x.status||'')}</td><td>${esc(x.closed_at||'—')}</td><td>${money(x.variance||0)}</td></tr>`).join('')}</tbody></table></div>`;
    }else if(kind==='wallet'){
      set('Wallet & Payout','Saldo tersedia/pending, transaksi, payout dan rekonsiliasi operasional.');
      const w=V.state.wallet[0]||{};body.innerHTML=`<div class="grid-3"><div class="metric"><span>Available</span><b>${money(w.available_balance)}</b></div><div class="metric"><span>Pending</span><b>${money(w.pending_balance)}</b></div><div class="metric"><span>Total Credits</span><b>${money(w.total_credits)}</b></div></div><div class="actions"><button class="secondary" onclick="loadWallet()">Refresh Wallet Detail</button></div>`;
    }
    bindFinanceActions();
  }

  function bindFinanceActions(){
    document.querySelectorAll('[data-arpay]').forEach(b=>b.onclick=async()=>{const amount=prompt('Jumlah pembayaran AR','0');if(!amount)return;try{await api('/api/admin/owner/finance/receivable/'+encodeURIComponent(b.dataset.arpay)+'/payment',{method:'POST',body:JSON.stringify({amount:Number(amount)})});toast('Pembayaran piutang tercatat');await loadFinance()}catch(e){toast(e.message,true)}});
    document.querySelectorAll('[data-appay]').forEach(b=>b.onclick=async()=>{const amount=prompt('Jumlah pembayaran AP','0');if(!amount)return;try{await api('/api/admin/owner/finance/payable/'+encodeURIComponent(b.dataset.appay)+'/payment',{method:'POST',body:JSON.stringify({amount:Number(amount)})});toast('Pembayaran hutang tercatat');await loadFinance()}catch(e){toast(e.message,true)}});
  }

  async function loadWallet(){try{V.state.wallet=safeArr(await api('/api/admin/wallet/summary'));await loadFinance()}catch(e){toast(e.message,true)}}

  async function renderEcosystem(cockpit){
    try{
      const [tl,arts,vids]=await Promise.all([api('/api/admin/owner/timeline'),api('/api/admin/articles'),api('/api/admin/videos')]);
      V.state.timeline=tl||{}; const ev=safeArr(tl?.events);
      const chips=ev.slice(0,10).map(x=>`<span class="activity-chip"><i></i>${esc(x.type||'event')} · ${esc((x.title||x.detail||'').slice(0,55))}</span>`); $('lux_activity').innerHTML=chips.join('')||'<span class="activity-chip"><i></i>Belum ada aktivitas terbaru.</span>';
      const aCount=safeArr(arts).length, vCount=safeArr(vids).length; const med=cockpit?.media||{};setText('lux_web',nf(med.articleStats?.total??aCount));setText('lux_video',nf(med.videoStats?.total??vCount));setText('lux_money',money(cockpit?.finance?.month?.net??cockpit?.finance?.summary?.net??0));setText('lux_mode',(cockpit?.capabilities?.conditional||0)?'CONDITIONAL':'OPTIMAL');
      const funnel=$('ecosystem_funnel'); if(funnel){const stages=[['Reach',Number(med.articleStats?.total||aCount)+Number(med.videoStats?.total||vCount), '#54e4ff'],['Engage',Number(cockpit?.finance?.month?.inflow||0)>0?Math.min(1000,Number(cockpit.finance.month.inflow)/1000):0,'#9a86ff'],['Convert',Number(cockpit?.finance?.month?.net||0)>0?1:0,'#43e19a']]; funnel.innerHTML=stages.map((x,i)=>`<div class="metric" style="margin-top:${i?8:0}"><div class="item-row"><span>${esc(x[0])}</span><b style="font-size:16px">${nf(x[1])}</b></div><div class="kpi-bar" style="margin-top:8px"><i style="width:${Math.min(100,Math.max(4,(x[1]/Math.max(1,stages[0][1]))*100))}%;background:${x[2]}"></i></div></div>`).join('')}
      const ecoList=$('ecosystem_activity'); if(ecoList){ecoList.innerHTML=ev.slice(0,12).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.title||x.type||'Activity')}</h3><p>${esc(x.detail||'')} </p></div><span class="tag">${esc(x.type||'event')}</span></div></div>`).join('')||'<div class="muted">Belum ada event.</div>'}
    }catch(e){if($('lux_activity'))$('lux_activity').innerHTML='<span class="activity-chip"><i></i>'+esc(e.message)+'</span>'}
  }

  V.render=async function(){
    try{
      const d=await api('/api/admin/owner/ultimate/cockpit');V.state.cockpit=d||{}; const finance=d.finance||{}, month=finance.month||{}, caps=d.capabilities||{}, sig=safeArr(d.signals);
      const critical=sig.filter(x=>['critical','high'].includes(String(x.severity))).length; const mode=critical?'GUARDED':(caps.conditional?'CONDITIONAL':'OPTIMAL');
      setText('v19_mode',mode);setText('v19_mode_reason',critical?`${critical} signal prioritas tinggi.`:(caps.conditional?`${caps.conditional} capability menunggu dependency.`:'Core V19 runtime sehat.'));
      setText('v19_signal_count',nf(sig.length));setText('v19_ready',nf(caps.ready));setText('v19_cap_summary',`${nf(caps.guarded)} guarded · ${nf(caps.conditional)} conditional`);setText('v19_net',money(month.net));
      const brief=$('v19_brief'); if(brief)brief.innerHTML=sig.slice(0,6).map((x,i)=>`<div class="item"><div class="item-row"><div><h3>${i+1}. ${esc(x.title||x.kind||'Decision')}</h3><p>${esc(x.explanation||x.reason||'')}</p></div><span class="tag">${esc(x.severity||'info')} · ${nf(x.confidence)}%</span></div><div class="actions"><button class="secondary" data-v19-cmd="${esc(x.recommended_action||x.action||x.title||'review decision')}">Act</button></div></div>`).join('')||'<div class="muted">Tidak ada signal prioritas.</div>';
      const signals=$('v19_signals');if(signals)signals.innerHTML=sig.map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.title||x.kind||'Signal')}</h3><p>${esc(x.explanation||'')}</p></div><span class="tag">${esc(x.severity||'info')} · ${nf(x.score)}</span></div><div class="actions"><button class="secondary" data-v19-signal="acknowledged" data-id="${esc(x.id||'')}">Acknowledge</button><button class="good" data-v19-signal="resolved" data-id="${esc(x.id||'')}">Resolve</button></div></div>`).join('')||'<div class="muted">Decision Signal Engine tidak memiliki signal terbuka.</div>';
      const ft=finance.totals||{};const vf=$('v19_finance');if(vf)vf.innerHTML=`<div class="grid-3"><div class="metric"><span>Month In</span><b>${money(month.inflow)}</b></div><div class="metric"><span>Month Out</span><b>${money(month.outflow)}</b></div><div class="metric"><span>Net</span><b>${money(month.net)}</b></div></div><div class="grid-3" style="margin-top:8px"><div class="metric"><span>AR Open</span><b>${money(ft.receivableOpen)}</b></div><div class="metric"><span>AR Overdue</span><b>${money(ft.receivableOverdue)}</b></div><div class="metric"><span>AP Overdue</span><b>${money(ft.payableOverdue)}</b></div></div>`;
      const m=d.media||{};const vm=$('v19_media');if(vm)vm.innerHTML=`<div class="grid-3"><div class="metric"><span>Articles</span><b>${nf(m.articleStats?.total)}</b></div><div class="metric"><span>Videos</span><b>${nf(m.videoStats?.total)}</b></div><div class="metric"><span>Breaking</span><b>${nf(m.breaking?.length)}</b></div></div><div class="grid-2" style="margin-top:8px"><div class="metric"><span>Live Events</span><b>${nf(m.events?.length)}</b></div><div class="metric"><span>Top Story</span><b style="font-size:13px">${esc(m.topStory?.title||'—')}</b></div></div>`;
      const capsEl=$('v19_caps');if(capsEl)capsEl.innerHTML=safeArr(caps.features).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.name)}</h3><p>${esc(x.area||'')} · ${esc(x.runtime_reason||'')}</p></div><span class="tag">${esc(x.runtime_status||'unknown')}</span></div></div>`).join('')||'<div class="muted">Capability matrix belum tersedia.</div>';
      await loadFinance(); await renderEcosystem(d); await V.goals(); await V.outcomes(); await V.timeline();
      document.querySelectorAll('[data-v19-cmd]').forEach(b=>b.onclick=()=>{const txt=b.dataset.v19Cmd;if(typeof window.submitOwnerCommand==='function'){const i=$('ownerCommandText');if(i)i.value=txt;window.submitOwnerCommand()}else toast(txt)});
      document.querySelectorAll('[data-v19-signal]').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/owner/decision-signals/'+encodeURIComponent(b.dataset.id),{method:'PATCH',body:JSON.stringify({status:b.dataset.v19Signal})});await V.render();toast('Signal diperbarui')}catch(e){toast(e.message,true)}});
    }catch(e){toast(e.message,true)}
  };
  V.goals=async()=>{try{const d=await api('/api/admin/owner/goals');const e=$('v19_goals');if(e)e.innerHTML=safeArr(d).map(x=>`<div class="item"><h3>${esc(x.title)}</h3><p>Target ${nf(x.target_value)} ${esc(x.unit||'')} · horizon ${esc(x.horizon||'')}</p></div>`).join('')||'<div class="muted">Belum ada goal aktif.</div>'}catch(e){const el=$('v19_goals');if(el)el.innerHTML='<div class="muted">Goal belum dapat dimuat.</div>'}};
  V.outcomes=async()=>{try{const d=await api('/api/admin/owner/timeline');const e=$('v19_outcomes');const rows=safeArr(d.events).filter(x=>x.type==='outcome').slice(0,10);if(e)e.innerHTML=rows.map(x=>`<div class="item"><h3>${esc(x.title||'Outcome')}</h3><p>${esc(x.detail||'')}</p></div>`).join('')||'<div class="muted">Belum ada outcome.</div>'}catch{}};
  V.timeline=async()=>{try{const d=await api('/api/admin/owner/timeline');const e=$('v19_timeline_list');if(e)e.innerHTML=safeArr(d.events).slice(0,35).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.title||x.type||'Event')}</h3><p>${esc(x.detail||'')}</p></div><span class="tag">${esc(x.type||'')} · ${esc(x.at||'')}</span></div></div>`).join('')||'<div class="muted">Timeline kosong.</div>'}catch(e){const el=$('v19_timeline_list');if(el)el.innerHTML='<div class="muted">Timeline tidak tersedia.</div>'}};
  V.brief=async()=>{try{await api('/api/admin/owner/briefing/generate',{method:'POST',body:JSON.stringify({brief_type:'morning'})});toast('Brief dibuat');V.render()}catch(e){toast(e.message,true)}};
  V.snapshot=async()=>{try{await api('/api/admin/owner/media/snapshot',{method:'POST',body:'{}'});toast('Media snapshot tersimpan');V.render()}catch(e){toast(e.message,true)}};
  V.reconcile=async()=>{try{try{await api('/api/admin/owner/finance/reconcile-legacy',{method:'POST',body:'{}'})}catch(_){ } await api('/api/admin/owner/finance/reconcile',{method:'POST',body:'{}'});toast('Reconciliation selesai');await loadFinance();V.render()}catch(e){toast(e.message,true)}};
  V.close=async()=>{try{await api('/api/admin/owner/finance/close-month',{method:'POST',body:'{}'});toast('Month close diproses');await loadFinance()}catch(e){toast(e.message,true)}};
  V.goal=async()=>{const title=prompt('Judul goal Owner');if(!title)return;const target=prompt('Target numerik','100');try{await api('/api/admin/owner/goals',{method:'POST',body:JSON.stringify({title,target_value:Number(target)||0,unit:'score',horizon:'7 hari'})});toast('Goal dibuat');V.render()}catch(e){toast(e.message,true)}};
  V.outcome=async()=>{const action=prompt('Action key / command yang dievaluasi');if(!action)return;const score=prompt('Outcome score 0-100','80');const notes=prompt('Catatan hasil','');try{await api('/api/admin/owner/outcomes',{method:'POST',body:JSON.stringify({action_key:action,outcome_score:Number(score)||0,notes,accepted:true})});toast('Outcome direkam');V.render()}catch(e){toast(e.message,true)}};

  function bindFinanceTabs(){document.querySelectorAll('[data-fin]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-fin]').forEach(x=>x.classList.remove('active'));b.classList.add('active');V.state.activeFinance=b.dataset.fin;renderFinanceDetail(b.dataset.fin)})}
  V.bind=()=>{
    const tab=document.querySelector('#nav button[data-view="v19"]'); if(tab)tab.addEventListener('click',()=>V.render());
    const moneyTab=document.querySelector('#nav button[data-view="money"]'); if(moneyTab)moneyTab.addEventListener('click',()=>loadFinance());
    $('v19_refresh')?.addEventListener('click',V.render);$('v19_brief_btn')?.addEventListener('click',V.brief);$('v19_snapshot_btn')?.addEventListener('click',V.snapshot);$('v19_reconcile_btn')?.addEventListener('click',V.reconcile);$('v19_finance_refresh')?.addEventListener('click',loadFinance);$('v19_export')?.addEventListener('click',()=>window.open('/api/admin/owner/finance/report.csv','_blank'));$('v19_close')?.addEventListener('click',V.close);$('v19_goal')?.addEventListener('click',V.goal);$('v19_outcome')?.addEventListener('click',V.outcome);$('v19_timeline')?.addEventListener('click',V.timeline);
    bindFinanceTabs(); setInterval(()=>{if(token()){loadFinance().catch(()=>{});if(!$('view-v19')?.classList.contains('hidden'))V.render()}},30000);
  };
  window.MudaV19Cockpit=V; window.MudaV19Finance={load:loadFinance,detail:renderFinanceDetail}; window.loadFinance=loadFinance; window.loadWallet=loadWallet;
  document.addEventListener('DOMContentLoaded',V.bind);
})();
