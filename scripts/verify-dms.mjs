// Media-upload + direct-messages audit for void2-final.html.
// Run through the shared harness:  node scripts/verify-ui.mjs --only=dms --profile=<dir>
// Storage / PostgREST calls are STUBBED inside the page (window.fetch), so this
// checks request shape and UI state, not the live backend.
export async function dmsAudit({ ev, sleep, summary, shot }) {
  const ex0 = summary.exceptions.length;
  const out = {};
  const noDemo = `(()=>{const c=document.body.cloneNode(true);c.querySelectorAll('script,style').forEach(n=>n.remove());
    const t=c.textContent||'';const m=t.match(/.{0,40}\\b(DEMO|MOCK)\\b.{0,40}/i);return m?m[0]:null;})()`;
  out.demoMockTextAtBoot = await ev(noDemo);

  out.upload = await ev(`(async()=>{try{
    const R={};
    localStorage.setItem('void_terms_accepted',JSON.stringify(new Date().toISOString()));
    const uid='11111111-2222-4333-8444-555555555555';
    VoidAuth.save({access_token:'test-bearer-token',refresh_token:'r',user:{id:uid}});
    const reqs=[];let failStorage=false;const realFetch=window.__realFetch||window.fetch;window.__realFetch=realFetch;
    const J=(o,s)=>new Response(JSON.stringify(o),{status:s||200,headers:{'Content-Type':'application/json'}});
    window.fetch=async(url,opt={})=>{url=String(url);const h=opt.headers||{};
      if(url.includes('/storage/v1/object/post-media/')){
        reqs.push({kind:'storage',url,method:opt.method,auth:h.Authorization,apikey:!!h.apikey,ct:h['Content-Type'],isBlob:opt.body instanceof Blob,size:opt.body&&opt.body.size});
        await new Promise(r=>setTimeout(r,400));
        return failStorage?J({statusCode:'500',message:'boom'},500):J({Key:'post-media/x'});}
      if(url.endsWith('/storage/v1/object/post-media')){reqs.push({kind:'storage-delete',url,method:opt.method,body:opt.body});return J([]);}
      if(url.includes('/rest/v1/rpc/create_post')){const b=JSON.parse(opt.body);reqs.push({kind:'create_post',url,auth:h.Authorization,body:b});return J(b.p_id);}
      if(url.includes('/rest/v1/profiles?id=eq.'))return J([{id:uid,handle:'tester'}]);
      if(url.includes('/rest/v1/conversation_members'))return J([]);
      if(url.includes('/rest/v1/blocks'))return J({code:'PGRST205',message:"Could not find the table 'public.blocks' in the schema cache"},404);
      if(url.includes('/auth/v1/'))return J({});
      return realFetch(url,opt);};
    window.__dmsReqs=reqs;
    // draft: 1 image (canvas png), 1 video, 1 voice take
    const cv=document.createElement('canvas');cv.width=3000;cv.height=1500;const g=cv.getContext('2d');g.fillStyle='#7c3aed';g.fillRect(0,0,3000,1500);
    const png=await new Promise(r=>cv.toBlob(r,'image/png'));
    const img=new File([png],'a.png',{type:'image/png'});
    const vid=new File([new Uint8Array(4096)],'v.mp4',{type:'video/mp4'});
    const aud=new Blob([new Uint8Array(2048)],{type:'audio/webm;codecs=opus'});
    composerMedia=[{file:img,url:URL.createObjectURL(img),kind:'image'},{file:vid,url:URL.createObjectURL(vid),kind:'video'}];
    composerAudio={blob:aud,url:URL.createObjectURL(aud),dur:3};
    document.getElementById('composer-text').value='verify drop';
    const p=submitComposerPost();
    await new Promise(r=>setTimeout(r,150));
    const pend=allPosts.find(x=>x._pending);
    R.pendingCard={inAllPosts:!!pend,kind:pend&&pend._pendingKind,domLoader:!!document.querySelector('.post-pending'),
      pendingHasBlob:!!(pend&&[pend._img,pend._video,pend._audio].some(u=>String(u||'').startsWith('blob:')))};
    await p;await new Promise(r=>setTimeout(r,300));
    R.requests=reqs.map(q=>Object.assign({},q,q.body&&q.kind==='create_post'?{body:q.body}:{}));
    const st=reqs.filter(q=>q.kind==='storage');
    const base=SUPABASE_URL+'/storage/v1/object/post-media/'+uid+'/';
    const uuidRe='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    R.assert={
      threeUploads:st.length===3,
      urlsUnderUidPrefix:st.every(q=>q.url.startsWith(base)&&new RegExp('^'+uuidRe+'\\\\.(webp|jpg|mp4|weba)$').test(q.url.slice(base.length))),
      bearer:st.every(q=>q.auth==='Bearer test-bearer-token'&&q.apikey),
      method:st.every(q=>q.method==='POST'),
      contentTypes:st.map(q=>q.ct),
      imageCompressed:!!st[0]&&/^image\\/(webp|jpeg)$/.test(st[0].ct)&&st[0].isBlob,
      createPostCalled:reqs.filter(q=>q.kind==='create_post').length===1,
      createPostMediaPublicUrls:(reqs.find(q=>q.kind==='create_post')||{body:{p_media:[]}}).body.p_media.every(m=>m.url.startsWith(SUPABASE_URL+'/storage/v1/object/public/post-media/'+uid+'/')),
      noBlobInPayload:!JSON.stringify(reqs.filter(q=>q.kind==='create_post')).includes('blob:'),
    };
    const saved=allPosts.find(x=>x.body==='verify drop');
    R.savedPost=saved&&{id:saved.id,style:saved.style,pending:!!saved._pending,img:saved._img,video:saved._video,audio:saved._audio,audioDur:saved._audioDur};
    R.draftCleared=!composerMedia.length&&!composerAudio&&!document.getElementById('composer-text').value;
    // Failure path: storage 500 -> no post, draft kept, honest toast.
    reqs.length=0;failStorage=true;
    const img2=new File([png],'b.png',{type:'image/png'});
    composerMedia=[{file:img2,url:URL.createObjectURL(img2),kind:'image'}];
    document.getElementById('composer-text').value='should fail';
    const before=allPosts.length;
    await submitComposerPost();await new Promise(r=>setTimeout(r,200));
    R.failure={toast:(document.getElementById('void-toast')||{}).textContent,draftKept:composerMedia.length===1&&document.getElementById('composer-text').value==='should fail',
      noPostAdded:allPosts.length===before&&!allPosts.some(x=>x.body==='should fail'),createPostCalled:reqs.some(q=>q.kind==='create_post')};
    await new Promise(r=>setTimeout(r,500));R.failure.composerReopened=document.getElementById('composer-overlay').classList.contains('open');
    closeComposer();composerMedia=[];document.getElementById('composer-text').value='';
    // Server rows -> app posts (feed / thread / profile read these fields)
    const row={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',author_id:uid,body:'',rank_score:0,created_at:new Date().toISOString(),profiles:{handle:'tester',display_name:'Tester'},
      post_media:[{url:SUPABASE_URL+'/storage/v1/object/public/post-media/'+uid+'/x.weba',ordinal:1,kind:'audio',duration_s:7},{url:SUPABASE_URL+'/storage/v1/object/public/post-media/'+uid+'/y.webp',ordinal:0,kind:'image'}]};
    const ap=sbPostToApp(row);allPosts.push(ap);
    const html=renderPost(ap,5);
    openThread(ap.id);await new Promise(r=>setTimeout(r,300));
    R.mapping={style:ap.style,img:ap._img,audio:ap._audio,dur:ap._audioDur,mine:!!ap._user,cardHasAudioSrc:html.includes('x.weba'),
      threadHasMedia:!!document.querySelector('#thread-overlay .post-media, #thread-overlay .au-pill'),threadHasAudio:!!document.querySelector('#thread-overlay .au-pill[data-src$="x.weba"]')};
    try{closeThread();}catch(e){}
    return R;}catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);

  out.messages = await ev(`(async()=>{try{
    switchTab('messages');await new Promise(r=>setTimeout(r,1500));
    const list=document.getElementById('conv-list');
    const R={state:DM_STATE,listText:list&&list.innerText.replace(/\\s+/g,' ').trim(),
      header:document.querySelector('#screen-messages .msg-enc-badge')?.textContent.trim(),
      chatNote:document.querySelector('#chat-window .chat-user-status')?.textContent.trim(),
      seedGlobals:{VOID_USERS:typeof window.VOID_USERS,MSG_SEED:typeof window.MSG_SEED,xorCipher:typeof window.xorCipher}};
    const q=document.getElementById('msg-search');q.value='zz';renderConvList();await new Promise(r=>setTimeout(r,600));
    R.searchText=list.innerText.replace(/\\s+/g,' ').trim();q.value='';renderConvList();
    return R;}catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
  if (shot) await shot('dms-messages');
  out.demoMockTextAfter = await ev(noDemo);
  await ev(`(()=>{if(window.__realFetch)window.fetch=window.__realFetch;try{VoidAuth.save(null)}catch(e){}})()`);
  out.exceptionsDuring = summary.exceptions.slice(ex0).map(x => x.text && String(x.text).split('\n')[0]);
  return out;
}
