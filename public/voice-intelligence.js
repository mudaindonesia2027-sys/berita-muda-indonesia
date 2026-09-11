(() => {
  const supported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speak = text => {
    if (!window.speechSynthesis || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'id-ID'; u.rate = 1;
    speechSynthesis.speak(u);
  };
  const searchInput = () => document.querySelector('#searchInput, input[type="search"], input[name="q"]');
  function command(text) {
    const q = text.toLowerCase().trim();
    if (q.includes('breaking')) return location.href = '/?breaking=1';
    if (q.includes('trending') || q.includes('terpopuler')) return location.href = '/?trending=1';
    if (q.includes('video')) return location.href = '/?video=1';
    const cleaned = q.replace(/^(cari|carikan|tolong cari|berita tentang)\s+/i, '').trim();
    const input = searchInput();
    if (input && cleaned) {
      input.value = cleaned;
      if (window.MudaApp?.search) window.MudaApp.search(cleaned);
      else location.href = '/?q=' + encodeURIComponent(cleaned);
      speak(`Mencari berita ${cleaned}`);
    }
  }
  function addButton() {
    if (!supported || document.getElementById('mudaVoiceButton')) return;
    const btn = document.createElement('button');
    btn.id = 'mudaVoiceButton'; btn.type = 'button'; btn.title = 'Cari dengan suara'; btn.textContent = '🎙️';
    Object.assign(btn.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'9999',width:'58px',height:'58px',borderRadius:'50%',border:'0',cursor:'pointer',fontSize:'24px',boxShadow:'0 10px 30px rgba(0,0,0,.25)'});
    btn.onclick = () => {
      const r = new Recognition(); r.lang='id-ID'; r.interimResults=false; r.maxAlternatives=1;
      btn.textContent='🎧';
      r.onresult = e => { btn.textContent='🎙️'; command(e.results[0][0].transcript); };
      r.onerror = () => { btn.textContent='🎙️'; };
      r.onend = () => { btn.textContent='🎙️'; };
      r.start();
    };
    document.body.appendChild(btn);
  }
  function articleTTS() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-read-aloud]'); if (!b) return;
      const article = b.closest('article, main, .modal-card') || document.body;
      speak(article.innerText.slice(0, 12000));
    });
  }
  document.addEventListener('DOMContentLoaded', () => { addButton(); articleTTS(); });
  window.MudaVoice = { speak, command, supported };
})();
