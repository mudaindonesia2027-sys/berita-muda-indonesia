(() => {
  const $=s=>document.querySelector(s);
  const out=$('#experienceCheckResult');
  $('#previewPublicExperience')?.addEventListener('click',()=>window.open('/','_blank','noopener,noreferrer'));
  $('#runExperienceCheck')?.addEventListener('click',async()=>{
    if(!out)return;out.textContent='Memeriksa public intelligence…';
    const checks=['/api/articles?limit=3','/api/trending?limit=3','/api/live/events?limit=3'];
    const results=[]; for(const u of checks){try{const r=await fetch(u,{credentials:'include'});results.push(`${u} ${r.ok?'OK':'FAIL '+r.status}`)}catch(e){results.push(`${u} FAIL`)}}
    out.textContent='Experience check · '+results.join(' · ');
  });
})();
