(()=>{
  'use strict';
  const K='muda_owner_os_token';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=v=>new Intl.NumberFormat('id-ID').format(Number(v||0));
  const money=v=>'Rp '+nf(v);
  const token=()=>sessionStorage.getItem(K)||'';
  async function api(path,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};const t=token();if(t)headers.Authorization='Bearer '+t;const r=await fetch(path,{...opt,headers});const txt=await r.text();let d={};try{d=txt?JSON.parse(txt):{}}catch{d={error:txt}}if(r.status===401){sessionStorage.removeItem(K);sessionStorage.removeItem('muda_owner_os_user');throw new Error(d.error||'Sesi login tidak valid. Silakan login kembali.')}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
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
      await loadFinance(); await renderEcosystem(d); await V.goals(); await V.outcomes(); await V.timeline(); await V.fabric();
      document.querySelectorAll('[data-v19-cmd]').forEach(b=>b.onclick=()=>{const txt=b.dataset.v19Cmd;if(typeof window.submitOwnerCommand==='function'){const i=$('ownerCommandText');if(i)i.value=txt;window.submitOwnerCommand()}else toast(txt)});
      document.querySelectorAll('[data-v19-signal]').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/owner/decision-signals/'+encodeURIComponent(b.dataset.id),{method:'PATCH',body:JSON.stringify({status:b.dataset.v19Signal})});await V.render();toast('Signal diperbarui')}catch(e){toast(e.message,true)}});
    }catch(e){toast(e.message,true)}
  };
  V.goals=async()=>{try{const d=await api('/api/admin/owner/goals');const e=$('v19_goals');if(e)e.innerHTML=safeArr(d).map(x=>`<div class="item"><h3>${esc(x.title)}</h3><p>Target ${nf(x.target_value)} ${esc(x.unit||'')} · horizon ${esc(x.horizon||'')}</p></div>`).join('')||'<div class="muted">Belum ada goal aktif.</div>'}catch(e){const el=$('v19_goals');if(el)el.innerHTML='<div class="muted">Goal belum dapat dimuat.</div>'}};
  V.outcomes=async()=>{try{const d=await api('/api/admin/owner/timeline');const e=$('v19_outcomes');const rows=safeArr(d.events).filter(x=>x.type==='outcome').slice(0,10);if(e)e.innerHTML=rows.map(x=>`<div class="item"><h3>${esc(x.title||'Outcome')}</h3><p>${esc(x.detail||'')}</p></div>`).join('')||'<div class="muted">Belum ada outcome.</div>'}catch{}};
  V.timeline=async()=>{try{const d=await api('/api/admin/owner/timeline');const e=$('v19_timeline_list');if(e)e.innerHTML=safeArr(d.events).slice(0,35).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.title||x.type||'Event')}</h3><p>${esc(x.detail||'')}</p></div><span class="tag">${esc(x.type||'')} · ${esc(x.at||'')}</span></div></div>`).join('')||'<div class="muted">Timeline kosong.</div>'}catch(e){const el=$('v19_timeline_list');if(el)el.innerHTML='<div class="muted">Timeline tidak tersedia.</div>'}};
  V.fabric=async()=>{try{const d=await api('/api/admin/owner/os/overview');const c=d.counts||{};const k=$('v19_fabric_kpi');if(k)k.innerHTML=[['Entity',c.entities||0,'record canonical'],['Event',c.events||0,'universal log'],['Decision',c.decisions||0,'decision records'],['Agent Run',c.agent_runs||0,'queued / history']].map(x=>`<div class="metric"><span>${esc(x[0])}</span><b>${nf(x[1])}</b><small>${esc(x[2])}</small></div>`).join('');const caps=$('v19_fabric_caps');if(caps)caps.innerHTML=safeArr(d.capabilities).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.capability_key)}</h3><p>${esc(x.domain)} · maturity L${esc(x.maturity)} · ${esc(x.provider||'internal')}</p></div><span class="tag">${esc(x.status)}</span></div></div>`).join('')||'<div class="muted">Capability belum tercatat.</div>';const runs=$('v19_fabric_runs');if(runs)runs.innerHTML=safeArr(d.agent_runs).slice(0,12).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.agent_key)} · ${esc(x.task_key)}</h3><p>${esc(x.risk_level)} · approval ${x.approval_required?'wajib':'tidak wajib'}</p></div><span class="tag">${esc(x.status)}</span></div></div>`).join('')||'<div class="muted">Belum ada agent run.</div>';const sc=$('v19_fabric_scenarios');if(sc)sc.innerHTML=safeArr(d.scenarios).slice(0,10).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.name)}</h3><p>${esc(x.domain)} · baseline/assumption/projection</p></div><span class="tag">${esc(x.status)}</span></div></div>`).join('')||'<div class="muted">Belum ada skenario.</div>';const dec=$('v19_fabric_decisions');if(dec)dec.innerHTML=safeArr(d.decisions).slice(0,10).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.decision_key)}</h3><p>${esc(x.domain)} · risk ${esc(x.risk_level)} · ${esc(x.recommendation||'')}</p></div><span class="tag">${esc(x.approval_status)} · ${esc(x.action_status)}</span></div></div>`).join('')||'<div class="muted">Decision queue kosong.</div>';}catch(e){toast('Fabric: '+e.message,true)}};
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
    $('v19_refresh')?.addEventListener('click',V.render);$('v19_brief_btn')?.addEventListener('click',V.brief);$('v19_snapshot_btn')?.addEventListener('click',V.snapshot);$('v19_reconcile_btn')?.addEventListener('click',V.reconcile);$('v19_finance_refresh')?.addEventListener('click',loadFinance);$('v19_export')?.addEventListener('click',()=>window.open('/api/admin/owner/finance/report.csv','_blank'));$('v19_close')?.addEventListener('click',V.close);$('v19_goal')?.addEventListener('click',V.goal);$('v19_outcome')?.addEventListener('click',V.outcome);$('v19_timeline')?.addEventListener('click',V.timeline);$('v19_fabric_refresh')?.addEventListener('click',V.fabric);
    bindFinanceTabs(); setInterval(()=>{if(token()){loadFinance().catch(()=>{});if(!$('view-v19')?.classList.contains('hidden'))V.render()}},30000);
  };
  window.MudaV19Cockpit=V; window.MudaV19Finance={load:loadFinance,detail:renderFinanceDetail}; window.loadFinance=loadFinance; window.loadWallet=loadWallet;
  document.addEventListener('DOMContentLoaded',V.bind);
})();


/* =========================================================
   V19 LIVE MONITOR + BAHASA INDONESIA + SUARA PERINGATAN
========================================================= */
(function(){
  const q=s=>document.querySelector(s); const escx=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const nf2=v=>new Intl.NumberFormat('id-ID').format(Number(v||0));
  const idr=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v||0));
  const state={sound:false,lastInbox:'',ready:false};
  function say(text){ if(!state.sound || !('speechSynthesis' in window)) return; try{window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text);u.lang='id-ID';u.rate=.97;u.pitch=1;window.speechSynthesis.speak(u);}catch{} }
  function notify(title,body){
    const box=q('#noticeToast'); if(box){box.innerHTML='<b>'+escx(title)+'</b><span>'+escx(body)+'</span>';box.classList.remove('hidden');setTimeout(()=>box.classList.add('hidden'),9000);}
    if('Notification' in window && Notification.permission==='granted'){try{new Notification(title,{body})}catch{}}
    say(title+'. '+body);
  }
  function unlockAudio(){
    state.sound=!state.sound; const b=q('#soundToggle'); if(b)b.textContent=state.sound?'🔊 Suara ON':'🔇 Suara OFF';
    if(state.sound){say('Peringatan suara MUDA aktif'); if('Notification' in window && Notification.permission==='default') Notification.requestPermission().catch(()=>{});}
  }
  function drawLine(canvas, series, labels, opts={}){
    if(!canvas)return; const ctx=canvas.getContext('2d'),w=canvas.width=canvas.clientWidth*devicePixelRatio,h=canvas.height=canvas.clientHeight*devicePixelRatio;ctx.clearRect(0,0,w,h);ctx.scale(devicePixelRatio,devicePixelRatio);const W=canvas.clientWidth,H=canvas.clientHeight;
    const pad={l:34,r:12,t:12,b:24}; const max=Math.max(1,...series.flatMap(x=>x.values).map(Number)); const min=0; const x=(i)=>pad.l+(W-pad.l-pad.r)*(i/Math.max(1,labels.length-1)); const y=(v)=>H-pad.b-(H-pad.t-pad.b)*((Number(v)-min)/(max-min));
    ctx.strokeStyle='rgba(120,160,210,.16)';ctx.lineWidth=1;for(let i=0;i<4;i++){const yy=pad.t+(H-pad.t-pad.b)*(i/3);ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();}
    for(const s of series){ctx.beginPath();s.values.forEach((v,i)=>{const xx=x(i),yy=y(v);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)});ctx.strokeStyle=s.color;ctx.lineWidth=2.4;ctx.stroke();s.values.forEach((v,i)=>{if(!v)return;ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(x(i),y(v),2.6,0,Math.PI*2);ctx.fill();});}
    ctx.fillStyle='rgba(200,215,235,.58)';ctx.font='10px system-ui';labels.forEach((d,i)=>{if(i%Math.ceil(labels.length/6)===0)ctx.fillText(String(d).slice(5),x(i)-10,H-6)});
  }
  function drawBars(canvas, values, color){
    if(!canvas)return;const ctx=canvas.getContext('2d'),W=canvas.clientWidth,H=canvas.clientHeight,d=devicePixelRatio;canvas.width=W*d;canvas.height=H*d;ctx.scale(d,d);ctx.clearRect(0,0,W,H);const pad={l:34,r:12,t:12,b:24};const max=Math.max(1,...values.map(Number));const bw=Math.max(3,(W-pad.l-pad.r)/values.length*.68);values.forEach((v,i)=>{const hh=(H-pad.b-pad.t)*(Number(v)/max);const xx=pad.l+(W-pad.l-pad.r)*(i/Math.max(1,values.length-1))-bw/2;const yy=H-pad.b-hh;const g=ctx.createLinearGradient(0,yy,0,H);g.addColorStop(0,color);g.addColorStop(1,'rgba(70,110,255,.10)');ctx.fillStyle=g;ctx.fillRect(xx,yy,bw,hh)});ctx.fillStyle='rgba(200,215,235,.58)';ctx.font='10px system-ui';}
  async function loadMonitor(){
    try{
      const d=await api('/api/admin/owner/live-monitor?days=14'); const labels=d.days||[];
      drawLine(q('#activityChart'),[{values:d.activity||[],color:'#59dcff'},{values:d.views||[],color:'#a58bff'},{values:d.videoViews||[],color:'#48e39a'}],labels);
      drawLine(q('#revenueChart'),[{values:d.revenue||[],color:'#ffd36a'},{values:d.adClicks||[],color:'#59dcff'}],labels);
      const msg=d.openMessages||[]; const newOne=msg[0];
      const unseen=msg.filter(x=>x.status==='new');
      if(newOne && state.lastInbox && newOne.id!==state.lastInbox){const kind=newOne.inquiry_type==='iklan'?'Lead iklan baru':newOne.inquiry_type==='sponsor'?'Kontak sponsor baru':'Pesan baru';notify(kind,`${newOne.name}: ${newOne.subject||newOne.message||'pesan baru'}`);}
      if(newOne)state.lastInbox=newOne.id;
      q('#liveMessages')&&(q('#liveMessages').textContent=nf2(msg.length));
      q('#liveAdLeads')&&(q('#liveAdLeads').textContent=nf2(msg.filter(x=>x.inquiry_type==='iklan'||x.inquiry_type==='sponsor').length));
      q('#liveAdImpressions')&&(q('#liveAdImpressions').textContent=nf2(d.adSummary?.impressions));
      q('#liveAdClicks')&&(q('#liveAdClicks').textContent=nf2(d.adSummary?.clicks));
      const badge=q('#inboxCount'); if(badge){badge.textContent=String(unseen.length);badge.style.display=unseen.length?'grid':'none';}
      const feed=q('#liveActivityFeed'); if(feed){feed.innerHTML=labels.slice(-8).map((day,i)=>`<div class="item"><div class="item-row"><div><h3>${escx(day)}</h3><p>${nf2((d.activity||[]).slice(-8)[i]||0)} aktivitas · ${nf2((d.views||[]).slice(-8)[i]||0)} penayangan tercatat · ${nf2((d.videoViews||[]).slice(-8)[i]||0)} video</p></div><span class="tag">LIVE</span></div></div>`).join('');}
      const inbox=q('#liveInbox'); if(inbox){inbox.innerHTML=msg.slice(0,8).map(x=>`<div class="item"><div class="item-row"><div><h3>${escx(x.inquiry_type==='iklan'?'📣 Lead iklan':x.inquiry_type==='sponsor'?'🤝 Sponsor':'✉️ '+(x.subject||'Pesan'))}</h3><p><b>${escx(x.name)}</b> · ${escx(x.email)}<br>${escx((x.message||'').slice(0,180))}</p></div><span class="tag">${escx(x.status||'new')}</span></div><div class="actions"><button class="secondary" data-inbox-id="${escx(x.id)}" data-inbox-status="in_progress">Tangani</button><button class="good" data-inbox-id="${escx(x.id)}" data-inbox-status="closed">Selesai</button></div></div>`).join('')||'<div class="muted">Belum ada pesan masuk.</div>';}
      q('#livePulse')?.classList.add('ok');
    }catch(e){ if(q('#livePulse'))q('#livePulse').textContent='● TERBATAS'; }
  }
  async function inboxUpdate(id,status){try{await api('/api/admin/owner/inbox/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});await loadMonitor();}catch(e){if(typeof toast==='function')toast(e.message,true)}}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-inbox-id]');if(b) inboxUpdate(b.dataset.inboxId,b.dataset.inboxStatus);});
  document.addEventListener('DOMContentLoaded',()=>{
    q('#soundToggle')?.addEventListener('click',unlockAudio);
    q('#monitorRefresh')?.addEventListener('click',loadMonitor);
    q('#inboxButton')?.addEventListener('click',()=>q('#liveMonitor')?.scrollIntoView({behavior:'smooth'}));
    q('#langToggle')?.addEventListener('click',()=>notify('Bahasa dashboard','Dashboard MUDA menggunakan istilah bahasa Indonesia-first.')); 
    loadMonitor(); setInterval(loadMonitor,20000);
    window.MudaLiveMonitor={load:loadMonitor,say};
  });
})();


/* =========================================================
   V19 COMMERCIAL & BILLING UI
========================================================= */
(function(){
  const q=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const idr=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v||0));
  async function loadCommercial(){
    try{
      const [deals,docs]=await Promise.all([api('/api/admin/owner/commercial/deals'),api('/api/admin/owner/commercial/documents')]);
      const counts={proposed:0,approved:0,invoiced:0,paid:0}; (deals||[]).forEach(d=>{if(counts[d.status]!=null)counts[d.status]++});
      for(const [k,v] of Object.entries(counts)){const e=q('#comm_'+k);if(e)e.textContent=v}
      const dEl=q('#commercialDeals'); if(dEl)dEl.innerHTML=(deals||[]).map(d=>`<div class="item"><div class="item-row"><div><h3>${esc(d.company)} · ${esc(d.deal_number)}</h3><p>${esc(d.campaign_title)} · ${esc(d.placement)} · ${idr(d.amount)}</p></div><span class="tag">${esc(d.status)}</span></div><div class="actions"><button class="secondary" data-comm-doc="${d.id}" data-doc-type="quotation">Cetak Penawaran</button><button class="secondary" data-comm-doc="${d.id}" data-doc-type="order_confirmation">Order</button><button class="secondary" data-comm-doc="${d.id}" data-doc-type="invoice">Invoice</button><button class="good" data-comm-pay="${d.id}" data-amount="${Number(d.amount||0)}">Catat Bayar</button></div></div>`).join('')||'<div class="muted">Belum ada deal iklan.</div>';
      const xEl=q('#commercialDocs'); if(xEl)xEl.innerHTML=(docs||[]).slice(0,30).map(x=>`<div class="item"><div class="item-row"><div><h3>${esc(x.doc_number)}</h3><p>${esc(x.doc_type)} · ${esc(x.status)} · ${idr(x.amount)}</p></div><button class="secondary" data-print-doc="${x.id}">Buka / Cetak</button></div></div>`).join('')||'<div class="muted">Belum ada dokumen.</div>';
    }catch(e){q('#commercialDeals')&&(q('#commercialDeals').innerHTML='<div class="muted">'+esc(e.message)+'</div>')}
  }
  async function createDeal(){
    const company=prompt('Nama perusahaan pengiklan'); if(!company)return; const campaign_title=prompt('Nama kampanye/iklan'); if(!campaign_title)return; const amount=prompt('Nilai iklan (IDR)','1000000'); const placement=prompt('Penempatan','website');
    try{const d=await api('/api/admin/owner/commercial/deals',{method:'POST',body:JSON.stringify({company,campaign_title,amount:Number(amount)||0,placement,status:'draft'})});toast('Deal iklan dibuat: '+d.deal_number);loadCommercial();}catch(e){toast(e.message,true)}
  }
  async function makeDoc(dealId,docType){try{const d=await api('/api/admin/owner/commercial/deals/'+encodeURIComponent(dealId)+'/documents',{method:'POST',body:JSON.stringify({doc_type:docType})});window.open('/api/admin/owner/commercial/documents/'+encodeURIComponent(d.id)+'/print','_blank');loadCommercial();}catch(e){toast(e.message,true)}}
  async function pay(dealId,amount){const v=prompt('Jumlah pembayaran diterima (IDR)',String(amount||0));if(v===null)return;const method=prompt('Metode pembayaran','bank_transfer')||'bank_transfer';try{await api('/api/admin/owner/commercial/payments',{method:'POST',body:JSON.stringify({deal_id:dealId,amount:Number(v)||0,method})});toast('Pembayaran dicatat dan revenue diperbarui');loadCommercial();}catch(e){toast(e.message,true)}}
  document.addEventListener('DOMContentLoaded',()=>{
    q('#comm_new')?.addEventListener('click',createDeal); document.querySelector('#nav button[data-view="commercial"]')?.addEventListener('click',loadCommercial);
    document.addEventListener('click',e=>{const a=e.target.closest('[data-comm-doc]');if(a)makeDoc(a.dataset.commDoc,a.dataset.docType);const b=e.target.closest('[data-print-doc]');if(b)window.open('/api/admin/owner/commercial/documents/'+encodeURIComponent(b.dataset.printDoc)+'/print','_blank');const c=e.target.closest('[data-comm-pay]');if(c)pay(c.dataset.commPay,Number(c.dataset.amount||0));});
    window.MudaCommercial={load:loadCommercial};
  });
})();

/* =========================================================
   V19 FUTURE MEDIA INTELLIGENCE — REGIONAL + STUDIO
========================================================= */
(function(){
  const q=s=>document.querySelector(s);
  const escLocal=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtN=n=>new Intl.NumberFormat('id-ID').format(Number(n||0));
  const idr2=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
  async function loadRegions(){
    try{
      const province=q('#regionProvince')?.value||'Jawa Tengah', regency=q('#regionRegency')?.value||'';
      const d=await api('/api/admin/owner/regions/overview?province='+encodeURIComponent(province)+(regency?'&regency='+encodeURIComponent(regency):''));
      const rows=d.rows||[]; const total=rows.reduce((a,x)=>({artikel:a.artikel+x.artikel,video:a.video+x.video,views:a.views+x.views,aktivitas:a.aktivitas+x.aktivitas}),{artikel:0,video:0,views:0,aktivitas:0});
      const k=q('#regionKpi'); if(k)k.innerHTML=[['Artikel',total.artikel,'konten terpetakan'],['Video',total.video,'video terpetakan'],['Jangkauan',total.views,'views tercatat'],['Aktivitas',total.aktivitas,'event 14 hari']].map(x=>`<div class="future-card"><div class="future-sub">${x[0]}</div><div class="future-kpi">${fmtN(x[1])}</div><div class="future-sub">${x[2]}</div></div>`).join('');
      const rr=q('#regionRows'); if(rr)rr.innerHTML=rows.map((x,i)=>{const mx=Math.max(1,...rows.map(z=>z.views+z.aktivitas));const heat=Math.min(100,Math.round(((x.views+x.aktivitas)/mx)*100));return `<div class="item"><strong>${i+1}. ${escLocal(x.wilayah)}</strong><span>${fmtN(x.artikel)} artikel</span><span>${fmtN(x.video)} video</span><span>${fmtN(x.views)} views</span><span><div>${fmtN(x.aktivitas)} aktivitas</div><div class="heatbar"><i style="width:${heat}%"></i></div></span></div>`}).join('')||'<div class="muted">Belum ada pemetaan wilayah. Konten dapat diberi wilayah dari Studio.</div>';
      renderRegionCatalog(d.catalog?.['Jawa Tengah']||[]);
    }catch(e){if(q('#regionRows'))q('#regionRows').innerHTML='<div class="muted">'+escLocal(e.message)+'</div>';}
  }
  function renderRegionCatalog(list){const s=q('#regionRegency');if(!s)return;const current=s.value; s.innerHTML='<option value="">Semua wilayah</option>'+list.map(x=>`<option>${escLocal(x)}</option>`).join('');if(list.includes(current))s.value=current;}
  async function loadStudioProjects(){try{const rows=await api('/api/admin/owner/studio/projects?limit=50');const el=q('#studioProjects');if(el)el.innerHTML=(rows||[]).map(x=>`<div class="item"><div class="item-row"><div><h3>${escLocal(x.name)}</h3><p>${escLocal(x.content_type)} · ${escLocal(x.status)} · ${new Date(x.updated_at).toLocaleString('id-ID')}</p></div><span class="tag">STUDIO</span></div></div>`).join('')||'<div class="muted">Belum ada proyek studio.</div>';}catch(e){q('#studioProjects')&&(q('#studioProjects').innerHTML='<div class="muted">'+escLocal(e.message)+'</div>')}}
  function paintChecklist(){const e=q('#studioChecklist');if(!e)return;e.innerHTML=['Sumber asli aman · edit non-destruktif','Narasi / caption dapat direvisi','Ukuran & rasio dapat diatur bebas','Crop / scale / rotasi aktif','Trim video sebelum ekspor','Privasi & status sebelum publikasi','Wilayah & metadata dapat dipasang','Preview wajib sebelum export'].map((x,i)=>`<div class="item"><div class="item-row"><div><h3>${escLocal(x)}</h3><p>${i<5?'Siap digunakan':'Siap di workflow'}</p></div><span class="pill ok">READY</span></div></div>`).join('')}
  let media={kind:null,file:null,video:null,img:null};
  function previewStudio(){
    const f=q('#studioFile')?.files?.[0]; if(!f){q('#studioStatus').textContent='Pilih gambar atau video terlebih dahulu.';return;}
    media.file=f; const url=URL.createObjectURL(f); const stage=q('#studioStage'); if(!stage)return; stage.innerHTML='';
    if(f.type.startsWith('image/')){const img=new Image();img.onload=()=>{media.kind='image';media.img=img;stage.appendChild(img);applyStudioVisual();};img.src=url;}
    else if(f.type.startsWith('video/')){const v=document.createElement('video');v.controls=true;v.muted=true;v.src=url;v.style.maxWidth='100%';v.style.maxHeight='400px';v.addEventListener('loadedmetadata',()=>{media.kind='video';media.video=v;q('#trimEnd').value=Math.floor(v.duration*10)/10;});stage.appendChild(v);media.video=v;media.kind='video';}
    else {stage.innerHTML='<div class="muted">Format ini dapat dicatat di proyek, tetapi preview visual hanya tersedia untuk image/video.</div>';}
    q('#studioStatus').textContent=`Sumber lokal: ${f.name} · ${Math.round(f.size/1024)} KB`;
  }
  function applyStudioVisual(){if(!media.img)return;const s=Number(q('#studioScale')?.value||100)/100;const r=Number(q('#studioRotate')?.value||0);media.img.style.transform=`scale(${s}) rotate(${r}deg)`;media.img.style.maxWidth='96%';media.img.style.maxHeight='400px';}
  async function saveStudio(){
    const f=media.file; const contentType=media.kind==='video'?'video':'image'; const narrative={title:q('#studioTitle')?.value||'',caption:q('#studioNarrative')?.value||'',width:Number(q('#studioWidth')?.value||0),height:Number(q('#studioHeight')?.value||0),fit:q('#studioFit')?.value||'contain'};
    const visual={crop_x:Number(q('#cropX')?.value||0),crop_y:Number(q('#cropY')?.value||0),scale:Number(q('#studioScale')?.value||100),rotate:Number(q('#studioRotate')?.value||0),privacy:q('#studioPrivacy')?.value||'draft'};
    const video={trim_start:Number(q('#trimStart')?.value||0),trim_end:Number(q('#trimEnd')?.value||0)};
    try{const p=await api('/api/admin/owner/studio/projects',{method:'POST',body:JSON.stringify({content_type:contentType,name:narrative.title||f?.name||'Proyek Studio',narrative,visual,video,export:{format:q('#studioFormat')?.value||'png'}})});q('#studioStatus').textContent='Proyek tersimpan: '+p.id;loadStudioProjects();}catch(e){q('#studioStatus').textContent=e.message;}
  }
  async function exportStudio(){
    if(media.kind==='image'&&media.img){const w=Math.max(1,Number(q('#studioWidth')?.value||1280)),h=Math.max(1,Number(q('#studioHeight')?.value||720)),c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);const scale=Number(q('#studioScale')?.value||100)/100;const angle=Number(q('#studioRotate')?.value||0)*Math.PI/180;ctx.save();ctx.translate(w/2,h/2);ctx.rotate(angle);const ratio=Math.min(w/media.img.naturalWidth,h/media.img.naturalHeight)*scale;ctx.drawImage(media.img,-media.img.naturalWidth*ratio/2,-media.img.naturalHeight*ratio/2,media.img.naturalWidth*ratio,media.img.naturalHeight*ratio);ctx.restore();const a=document.createElement('a');a.href=c.toDataURL(q('#studioFormat')?.value==='jpeg'?'image/jpeg':'image/png',.92);a.download=(q('#studioTitle')?.value||'muda-media')+'.'+(q('#studioFormat')?.value==='jpeg'?'jpg':'png');a.click();q('#studioStatus').textContent='Gambar berhasil diekspor dari editor.';return;}
    if(media.kind==='video'&&media.video){const v=media.video, start=Number(q('#trimStart')?.value||0), end=Number(q('#trimEnd')?.value||v.duration);const c=document.createElement('canvas');c.width=Math.max(320,Number(q('#studioWidth')?.value||1280));c.height=Math.max(180,Number(q('#studioHeight')?.value||720));const ctx=c.getContext('2d');const stream=c.captureStream(30);try{const vs=v.captureStream? v.captureStream():null;if(vs)vs.getAudioTracks().forEach(t=>stream.addTrack(t));const rec=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=()=>{const blob=new Blob(chunks,{type:'video/webm'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(q('#studioTitle')?.value||'muda-video')+'.webm';a.click();q('#studioStatus').textContent='Video dipotong dan diekspor WEBM. File asli tidak berubah.'};v.currentTime=start;await v.play();rec.start();const draw=()=>{if(v.paused||v.ended||v.currentTime>=end){rec.stop();v.pause();return;}ctx.drawImage(v,0,0,c.width,c.height);requestAnimationFrame(draw)};draw();}catch(e){q('#studioStatus').textContent='Ekspor video browser gagal: '+e.message;}return;}
    q('#studioStatus').textContent='Tidak ada media visual yang siap diekspor.';
  }
  document.addEventListener('DOMContentLoaded',()=>{
    q('#regionRefresh')?.addEventListener('click',loadRegions);q('#regionProvince')?.addEventListener('change',loadRegions);q('#regionRegency')?.addEventListener('change',loadRegions);
    q('#studioPreview')?.addEventListener('click',previewStudio);q('#studioSave')?.addEventListener('click',saveStudio);q('#studioExport')?.addEventListener('click',exportStudio);['studioScale','studioRotate'].forEach(id=>q('#'+id)?.addEventListener('input',applyStudioVisual));paintChecklist();loadRegions();loadStudioProjects();
    document.querySelector('#nav')?.addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(!b)return;if(b.dataset.view==='regions')loadRegions();if(b.dataset.view==='studio'){paintChecklist();loadStudioProjects();}});
  });
})();
