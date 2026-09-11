(() => {
  const speak = text => {
    if (window.speechSynthesis && text) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  };
  window.MudaIntelligence = {
    speak,
    run: async text => {
      if (typeof window.MudaOwnerV13Run === 'function') return window.MudaOwnerV13Run(text);
      const token = sessionStorage.getItem('muda_owner_os_token') || '';
      const r = await fetch('/api/admin/owner/command', {
        method: 'POST',
        headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        body: JSON.stringify({text})
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    }
  };
})();
