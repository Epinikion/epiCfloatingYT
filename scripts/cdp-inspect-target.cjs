'use strict';

async function main() {
  const port = Number(process.argv[2]) || 9333;
  const type = process.argv[3] || 'webview';
  const closeApp = process.argv.includes('--close');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === type);
  if (!target) throw new Error(`Target ${type} not found`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    callback(message);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const result = await command('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const video=document.querySelector('video');
      const rect=video?.getBoundingClientRect();
      const style=video&&getComputedStyle(video);
      const webview=document.querySelector('webview');
      const webviewRect=webview?.getBoundingClientRect();
      const webviewStyle=webview&&getComputedStyle(webview);
      const theaterControls=[...document.querySelectorAll('button,[role="button"],.ytp-size-button')].filter(element=>/theat(?:er|re)|kino|ytp-size-button/i.test([element.className?.toString?.(),element.getAttribute('aria-label'),element.getAttribute('title')].filter(Boolean).join(' '))).map(element=>{const controlRect=element.getBoundingClientRect(),controlStyle=getComputedStyle(element);return{tag:element.tagName.toLowerCase(),class:element.className?.toString?.()||'',ariaLabel:element.getAttribute('aria-label'),title:element.getAttribute('title'),display:controlStyle.display,visibility:controlStyle.visibility,opacity:controlStyle.opacity,rect:{x:controlRect.x,y:controlRect.y,width:controlRect.width,height:controlRect.height}}});
      return {
        location:location.href,
        title:document.title,
        bodyText:document.body?.innerText?.slice(0,1000),
        buttons:[...document.querySelectorAll('button,[role="button"]')].map(x=>(x.innerText||x.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,30),
        buttonDetails:[...document.querySelectorAll('button,[role="button"]')].slice(0,30).map(x=>({tag:x.tagName.toLowerCase(),id:x.id,class:x.className?.toString?.()||'',label:(x.innerText||x.getAttribute('aria-label')||'').trim().slice(0,80)})),
        video:video&&{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},intrinsic:{width:video.videoWidth,height:video.videoHeight},readyState:video.readyState,paused:video.paused,currentTime:video.currentTime,duration:video.duration,style:{width:style.width,height:style.height,objectFit:style.objectFit,position:style.position}},
        viewport:{width:innerWidth,height:innerHeight},
        preload:{filters:Boolean(document.querySelector('#__floating-sharpen-filters')),rootClass:document.documentElement.className,rootAttributes:[...document.documentElement.attributes].map(x=>[x.name,x.value])},
        theaterControls,
        webview:webview&&{rect:{x:webviewRect.x,y:webviewRect.y,width:webviewRect.width,height:webviewRect.height},client:{width:webview.clientWidth,height:webview.clientHeight},style:{width:webviewStyle.width,height:webviewStyle.height,display:webviewStyle.display,position:webviewStyle.position}},
      };
    })()`,
  });
  if (closeApp && type === 'page') await command('Runtime.evaluate', { expression: `window.floatingApi?.close()` });
  socket.close();
  console.log(JSON.stringify(result.result.value, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
