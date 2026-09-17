// HTML for the ONE place a WebView is allowed: a tiny isolated YouTube player.
//
// The iframe gets the EXACT embed src attemptSource builds (controls=0, mute=1,
// playsinline, iv_load_policy=3, enablejsapi=1&origin=…) and the IFrame Player API
// attaches to it (`new YT.Player(existingIframe)`), so embed params stay byte-identical
// to the web while state comes from real API events instead of raw postMessage parsing.
//
// Page → RN   (window.ReactNativeWebView.postMessage JSON)
//   {e:'ready'}
//   {e:'state', s:<playerState>, t:<currentTime>, d:<duration>}   onStateChange
//   {e:'info',  s:<playerState>, t:<currentTime>, d:<duration>}   every 1s (web infoDelivery)
//   {e:'error', c:<code>}
// RN → page   injectJavaScript(`window.__cmd({f:'playVideo',a:[]})`)
import { YT_ORIGIN, YT_SHADOW_KICK_MS } from './constants';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function ytPlayerHtml(src: string, opts: { shadow?: boolean } = {}): string {
  const shadow = !!opts.shadow;
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
#f{position:absolute;left:0;top:0;width:100%;height:100%;border:0;pointer-events:none}</style>
</head><body>
<iframe id="f" src="${esc(src)}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
<script>
(function(){
  var P=null, SHADOW=${shadow ? 'true' : 'false'}, playing=false;
  function send(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}
  function num(fn){try{var v=P&&P[fn]&&P[fn]();return typeof v==='number'?v:null;}catch(e){return null;}}
  window.__cmd=function(c){
    if(!P||!c||typeof P[c.f]!=='function')return;
    try{P[c.f].apply(P,c.a||[]);}catch(e){}
  };
  window.onYouTubeIframeAPIReady=function(){
    P=new YT.Player('f',{events:{
      onReady:function(){send({e:'ready'});if(SHADOW)kick();},
      onStateChange:function(ev){if(ev.data===1)playing=true;send({e:'state',s:ev.data,t:num('getCurrentTime'),d:num('getDuration')});},
      onError:function(ev){send({e:'error',c:ev.data});}
    }});
  };
  // Shadow (audio) player: web ytShadowStart kick() — listening, unMute, setVolume 100,
  // playVideo, every ${YT_SHADOW_KICK_MS}ms until PLAYING.
  function kick(){if(!P||playing)return;try{P.unMute();P.setVolume(100);P.playVideo();}catch(e){}}
  if(SHADOW)setInterval(kick,${YT_SHADOW_KICK_MS});
  setInterval(function(){
    if(!P||typeof P.getPlayerState!=='function')return;
    var s=num('getPlayerState');
    send({e:'info',s:s,t:num('getCurrentTime'),d:num('getDuration')});
  },1000);
  var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();
</script></body></html>`;
}

export const YT_BASE_URL = YT_ORIGIN + '/';

export function ytCmd(f: string, a: unknown[] = []): string {
  return `window.__cmd&&window.__cmd(${JSON.stringify({ f, a })});true;`;
}

export type YtMsg =
  | { e: 'ready' }
  | { e: 'state' | 'info'; s: number | null; t: number | null; d: number | null }
  | { e: 'error'; c: number };

export function parseYtMsg(raw: string): YtMsg | null {
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && typeof d.e === 'string' ? (d as YtMsg) : null;
  } catch {
    return null;
  }
}

/** Common WebView props for every YouTube/iframe player (autoplay inline, no chrome, no scroll). */
export const PLAYER_WEBVIEW_PROPS = {
  originWhitelist: ['*'],
  javaScriptEnabled: true,
  domStorageEnabled: true,
  allowsInlineMediaPlayback: true,
  mediaPlaybackRequiresUserAction: false,
  allowsFullscreenVideo: false,
  allowsPictureInPictureMediaPlayback: false,
  allowsAirPlayForMediaPlayback: false,
  scrollEnabled: false,
  bounces: false,
  overScrollMode: 'never' as const,
  showsHorizontalScrollIndicator: false,
  showsVerticalScrollIndicator: false,
  automaticallyAdjustContentInsets: false,
  contentInsetAdjustmentBehavior: 'never' as const,
  setSupportMultipleWindows: false,
  androidLayerType: 'hardware' as const,
  mixedContentMode: 'always' as const,
  thirdPartyCookiesEnabled: true,
  sharedCookiesEnabled: true,
  keyboardDisplayRequiresUserAction: true,
  hideKeyboardAccessoryView: true,
  textInteractionEnabled: false,
};
