(() => {
  const speak = t => window.MudaVoice?.speak ? window.MudaVoice.speak(t) : (window.speechSynthesis && speechSynthesis.speak(new SpeechSynthesisUtterance(t)));
  const box = document.createElement('section');
  box.id = 'muda-intelligence-center';
  box.innerHTML = `<div style="padding:18px;border-radius:16px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;margin:18px 0"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><b style="font-size:18px">🧠 MUDA INTELLIGENCE CENTER</b><div style="opacity:.8;margin-top:4px">Revenue · Analytics · Voice · System Insights</div></div><button id="mudaVoiceAdmin" style="padding:10px 14px;border-radius:10px;border:0;cursor:pointer">🎙️ Voice Command</button></div><div id="mudaIntelGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px"><div>📊 Analytics<br><b id="miAnalytics">Ready</b></div><div>💰 Revenue<br><b id="miRevenue">Data aman</b></div><div>📢 Ads<br><b id="miAds">Monitoring</b></div><div>⚡ System<br><b id="miSystem">Checking</b></div></div></div>`;
  document.addEventListener('DOMContentLoaded', () => {
    const anchor = document.querySelector('main, .dashboard, #dashboard');
    (anchor || document.body).prepend(box);
    fetch('/api/admin/health', {headers:{Authorization:`Bearer ${localStorage.getItem('access_token') || ''}`}}).then(r=>r.json()).then(d=>{ const el=document.getElementById('miSystem'); if(el) el.textContent=d.ok?'Healthy':'Attention'; }).catch(()=>{});
    document.getElementById('mudaVoiceAdmin')?.addEventListener('click', () => {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!R) return alert('Voice recognition belum didukung browser ini.');
      const r=new R(); r.lang='id-ID'; r.onresult=e=>{
        const q=e.results[0][0].transcript.toLowerCase();
        if(q.includes('refresh')) document.getElementById('refreshAllBtn')?.click();
        else if(q.includes('breaking') && q.includes('jalankan')) document.getElementById('runBreakingBtn')?.click();
        else if(q.includes('kesehatan') || q.includes('health')) document.getElementById('refreshHealthBtn')?.click();
        else if(q.includes('sync')) document.getElementById('syncBtn')?.click();
        else speak('Perintah belum tersedia.');
      }; r.start();
    });
  });
})();
