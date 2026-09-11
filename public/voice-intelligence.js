(() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  const speak = text => {
    if (window.speechSynthesis && text) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  };
  const listen = ({onStart,onResult,onEnd,onError}={}) => {
    if (!Recognition) throw new Error('Browser tidak mendukung SpeechRecognition.');
    recognition?.abort();
    recognition = new Recognition();
    recognition.lang='id-ID';
    recognition.interimResults=false;
    recognition.maxAlternatives=1;
    recognition.onstart=onStart||null;
    recognition.onend=onEnd||null;
    recognition.onerror=onError||null;
    recognition.onresult=e => {
      const transcript=e.results?.[0]?.[0]?.transcript?.trim()||'';
      onResult?.(transcript);
    };
    recognition.start();
    return recognition;
  };
  window.MudaVoice = {speak, listen, supported:!!Recognition};
})();
