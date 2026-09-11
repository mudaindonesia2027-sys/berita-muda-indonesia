(() => {
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const supported=!!Recognition;
  const speak=text=>{if(!window.speechSynthesis||!text)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='id-ID';u.rate=.98;speechSynthesis.speak(u)};
  function listen(){
    if(!Recognition)return null;
    const r=new Recognition();r.lang='id-ID';r.interimResults=false;r.maxAlternatives=1;return r;
  }
  async function adminVoice(){
    const input=document.getElementById('ownerCommandText');
    const btn=document.getElementById('voiceCommandBtn');
    if(!input||!btn)return;
    const r=listen();
    if(!r){window.toast?.('Voice recognition tidak didukung browser ini',true);return;}
    btn.textContent='🎧 Mendengar…';btn.disabled=true;
    r.onresult=e=>{input.value=e.results?.[0]?.[0]?.transcript||'';window.toast?.('Voice diterjemahkan. Menjalankan Command Bus…');document.querySelector('button[onclick="submitOwnerCommand()"]')?.click()};
    r.onerror=e=>window.toast?.(e.error||'Voice recognition gagal',true);
    r.onend=()=>{btn.textContent='🎙️ Voice';btn.disabled=false};
    try{r.start()}catch{}
  }
  function publicVoice(){
    if(!supported||location.pathname.startsWith('/admin'))return;
    const btn=document.getElementById('mudaVoiceButton');
    if(btn||document.body.dataset.voiceReady)return;
    document.body.dataset.voiceReady='1';
    const b=document.createElement('button');b.id='mudaVoiceButton';b.type='button';b.title='Cari dengan suara';b.textContent='🎙️';Object.assign(b.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'9999',width:'56px',height:'56px',borderRadius:'50%',border:'0',cursor:'pointer',fontSize:'23px',boxShadow:'0 12px 32px rgba(0,0,0,.3)'});
    b.onclick=()=>{const r=listen();if(!r)return;b.textContent='🎧';r.onresult=e=>{b.textContent='🎙️';const q=e.results?.[0]?.[0]?.transcript||'';const clean=q.replace(/^(cari|carikan|tolong cari|berita tentang)\s+/i,'').trim();const input=document.querySelector('#searchInput,input[type="search"],input[name="q"]');if(input&&clean){input.value=clean;if(window.MudaApp?.search)window.MudaApp.search(clean);else location.href='/?q='+encodeURIComponent(clean);speak('Mencari berita '+clean)}};r.onerror=r.onend=()=>{b.textContent='🎙️'};r.start()};document.body.appendChild(b);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(location.pathname.startsWith('/admin')){document.getElementById('voiceCommandBtn')?.addEventListener('click',adminVoice);window.MudaVoice={speak,supported}}else publicVoice();
  });
  window.MudaVoice=Object.assign(window.MudaVoice||{},{speak,supported});
})();
