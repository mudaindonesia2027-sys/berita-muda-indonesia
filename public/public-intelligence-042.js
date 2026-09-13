(() => {
  'use strict';
  // 042: keep the intelligence layer available, but do not let it hijack the initial viewport.
  const $ = (s, r=document) => r.querySelector(s);
  function mountProofNavigation(){
    const rail = $('#publicIntelligence041');
    if (!rail || rail.dataset.reframed042) return;
    rail.dataset.reframed042='1';
    const footer = $('.public-footer-cta');
    const main = $('.public-main');
    if (main && footer) main.insertBefore(rail, footer);
  }
  function addJump(){
    const nav=$('.main-nav .nav-inner');
    if(!nav || $('#intelJump042')) return;
    const btn=document.createElement('button');
    btn.id='intelJump042'; btn.className='nav-item'; btn.type='button'; btn.textContent='Intelijen';
    btn.addEventListener('click',()=>$('#publicIntelligence041')?.scrollIntoView({behavior:'smooth',block:'start'}));
    nav.appendChild(btn);
  }
  function tidyHours(){
    const clock=$('#clockMain'); if(!clock) return;
    clock.setAttribute('aria-label','Waktu perangkat');
  }
  function init(){mountProofNavigation();addJump();tidyHours();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(init,50)); else setTimeout(init,50);
  window.addEventListener('muda:intelligence-mounted', init);
})();
