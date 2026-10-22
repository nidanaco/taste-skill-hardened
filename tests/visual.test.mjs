import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Browser, sleep } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/cdp.mjs';
import { servePublic } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/public-server.mjs';
import { restrictPage } from '../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/lib/network-policy.mjs';

const tests = fileURLToPath(new URL('./', import.meta.url));
const skill = fileURLToPath(new URL('../plugins/taste-skill-hardened/skills/taste-frontend-hardened/', import.meta.url));
const output = process.env.TASTE_VISUAL_OUT && resolve(process.env.TASTE_VISUAL_OUT);
let dir, root, browser, server, oldTmp;
const observations = { pages: [], inspectors: [] };
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'taste-visual-')); root = join(dir, 'public'); mkdirSync(root);
  oldTmp = process.env.TASTE_SKILL_TMP; process.env.TASTE_SKILL_TMP = dir;
  for (const host of ['codex', 'claude']) copyFileSync(join(tests, 'fixtures', host + '-workshop.html'), join(root, host + '.html'));
  for (const name of ['charts.html', 'charts-fixture.js']) copyFileSync(join(tests, 'fixtures', name), join(root, name));
  for (const name of ['charts.js', 'app.css', 'base.css']) copyFileSync(join(skill, 'assets', name), join(root, name));
  for (const css of ['app', 'base']) writeFileSync(join(root, 'controls-' + css + '.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Flex input regression</title><link rel="stylesheet" href="' + css + '.css"><style>main{width:100%;padding:16px}form{display:flex;flex-wrap:wrap}input{font-size:2rem;flex:1 1 14rem}</style><main><form><label for="email">Email</label><input class="input" id="email" type="email" required></form></main></html>');
  if (output) mkdirSync(output, { recursive: true });
  server = await servePublic({ root, entry: join(root, 'codex.html') });
  browser = await Browser.launch({ allowedOrigin: server.url });
});
after(async () => {
  if (browser) await browser.close(); if (server) await server.close();
  if (output) writeFileSync(join(output, 'visual-results.json'), JSON.stringify(observations, null, 2) + '\n');
  if (oldTmp === undefined) delete process.env.TASTE_SKILL_TMP; else process.env.TASTE_SKILL_TMP = oldTmp;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const modes = [
  { name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 844 },
  { name: 'reduced', width: 390, height: 844, reducedMotion: true },
  { name: 'text200', width: 390, height: 844, text200: true },
];
for (const host of ['codex', 'claude', 'charts']) for (const mode of modes.filter(m => host !== 'charts' || !['tablet', 'text200'].includes(m.name))) {
  test(host + ' visual/interaction regression: ' + mode.name, async () => {
    const page = await browser.newPage(mode), url = new URL(host + '.html', server.url).href;
    const off = await restrictPage(page, url), record = { host, mode: mode.name, width: mode.width };
    try {
      await page.goto(url, { settleMs: 100 }); await page.eval('document.fonts.ready.then(() => true)');
      if (mode.text200) await page.eval(() => { document.documentElement.style.fontSize = '200%'; });
      await sleep(80);
      record.layout = await page.eval(() => {
        const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0; };
        const elements = [...document.querySelectorAll('h1,h2,p,a,label,input,button')];
        const cards = [...document.querySelectorAll('.card')].map(e => { const r = e.getBoundingClientRect(); return { y: r.y, height: r.height }; });
        const outside = elements.filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(e => e.tagName);
        return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, hidden: elements.filter(e => !visible(e)).map(e => e.tagName), outside, cards,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, animations: document.getAnimations().filter(a => a.playState === 'running').length };
      });
      assert.ok(record.layout.pageWidth <= mode.width + 1, JSON.stringify(record.layout));
      assert.deepEqual(record.layout.hidden, []); assert.deepEqual(record.layout.outside, []);
      if (mode.reducedMotion) { assert.equal(record.layout.reduced, true); assert.equal(record.layout.animations, 0); }
      // Inspect all rendered leaf text, including nested chart figures and SVG ticks.
      record.contrast = await page.eval(() => {
        const rgba = s => { const m = s.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : [0,0,0,0]; };
        const composite = (a,b) => { const alpha = a[3] + b[3] * (1-a[3]); return alpha ? [0,1,2].map(i => (a[i]*a[3]+b[i]*b[3]*(1-a[3]))/alpha).concat(alpha) : [0,0,0,0]; };
        const background = e => { const chain=[]; for(let n=e;n;n=n.parentElement) chain.unshift(n); return chain.reduce((out,n)=>composite(rgba(getComputedStyle(n).backgroundColor),out),[255,255,255,1]); };
        const lum = c => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const ratio = (a,b) => { const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), rows=[]; let node;
        while (node=walker.nextNode()) {
          const e=node.parentElement; if(!node.textContent.trim()||['SCRIPT','STYLE'].includes(e.tagName))continue;
          const s=getComputedStyle(e),r=e.getBoundingClientRect(); if(!r.width||!r.height||s.visibility==='hidden'||+s.opacity===0)continue;
          const bg=background(e),fg=composite(rgba(e.namespaceURI==='http://www.w3.org/2000/svg'?s.fill:s.color),bg);
          const minimum=parseFloat(s.fontSize)>=24||parseFloat(s.fontSize)>=18.6667&&parseInt(s.fontWeight)>=700?3:4.5;
          rows.push({text:node.textContent.trim(),ratio:ratio(fg,bg),minimum});
        }
        const i=document.querySelector('input');
        return {rows,inputBoundary:i?ratio(rgba(getComputedStyle(i).borderTopColor),background(i.parentElement)):null};
      });
      assert.deepEqual(record.contrast.rows.filter(r=>r.ratio<r.minimum), []);
      if (output) await page.screenshot({ path: join(output, host + '-' + mode.name + '.png'), format: 'png', fullPage: true });
      if (host !== 'charts') {
        assert.ok(record.contrast.inputBoundary >= 3);
        const cards = record.layout.cards; assert.equal(cards.length, 2);
        if (mode.width <= 390) assert.ok(cards[1].y >= cards[0].y + cards[0].height - 1); else assert.ok(Math.abs(cards[1].y-cards[0].y)<1);
        record.form = await page.eval(() => {
          const f=document.querySelector('form'),i=document.querySelector('input'),button=f.querySelector('button');
          i.value=''; const empty=i.validity.valueMissing; i.value='invalid'; const invalid=i.validity.typeMismatch;
          i.value='synthetic@example.invalid'; const valid=i.checkValidity(); i.value='';
          return { empty,invalid,valid,action:f.getAttribute('action'),method:f.method,type:i.type,name:i.name,required:i.required,label:i.labels[0].textContent,
            available:[...document.querySelectorAll('.card p:last-of-type')].map(e=>e.textContent),brand:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),sizes:[i,button].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})) };
        });
        assert.ok(record.form.empty && record.form.invalid && record.form.valid && record.form.required);
        assert.equal(record.form.action,'/book'); assert.equal(record.form.method,'post'); assert.equal(record.form.type,'email'); assert.equal(record.form.name,'email'); assert.equal(record.form.label,'Email address');
        assert.deepEqual(record.form.available,['6 places available','4 places available']); assert.equal(record.form.brand,'#174c3c'); assert.ok(record.form.sizes.every(r=>r.w>=44&&r.h>=44));
        record.keyboard=[];
        await page.send('Page.bringToFront');
        for(let index=0;index<4;index++) {
          await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          // Native focus scrolling can settle on a later compositor frame. Keep
          // subpixel rounding within 1 CSS px, matching the overflow check.
          await page.eval(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
          record.keyboard.push(await page.eval(()=>{const e=document.activeElement,s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,focus:e.matches(':focus-visible'),outline:s.outlineStyle,width:parseFloat(s.outlineWidth),rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},inViewport:r.top>=-1&&r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1};}));
          if(output && index===3)await page.screenshot({path:join(output,host+'-'+mode.name+'-focus.png'),format:'png',fullPage:true});
        }
        assert.equal(record.keyboard.map(r=>r.tag).join(','),'A,A,INPUT,BUTTON');
        assert.ok(record.keyboard.every(r=>r.focus&&r.outline==='solid'&&r.width>=2&&r.inViewport),JSON.stringify(record.keyboard));
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
        assert.equal(await page.eval('document.activeElement.id'), 'email');
        const pos=await page.eval(()=>{const e=document.querySelector('a');e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
        assert.equal(await page.eval('location.hash'),'#booking');
      } else {
        record.charts = await page.eval(()=>({tracks:[...document.querySelectorAll('#bullet li')].map(e=>({track:e.children[1].getBoundingClientRect().width,bar:e.children[1].children[0].getBoundingClientRect().width})),titles:[...document.querySelectorAll('#bars rect title')].map(e=>e.textContent)}));
        assert.ok(record.charts.tracks.length===2&&record.charts.tracks.every(r=>r.track>=100&&r.bar>0),JSON.stringify(record.charts));
        assert.deepEqual(record.charts.titles,['Ceramics: 12','Drawing: 8','Woodwork: 16']);
        const hit=await page.eval(()=>{const e=document.querySelector('#line [fill="transparent"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+20};});
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hit});await sleep(150);
        record.tooltip=await page.eval(()=>{const t=document.querySelector('.chart-tip'),r=t.getBoundingClientRect();return {text:t.textContent,opacity:+getComputedStyle(t).opacity,inBounds:r.left>=0&&r.right<=innerWidth};});
        assert.equal(record.tooltip.text,'Wed9');assert.ok(record.tooltip.opacity>.9&&record.tooltip.inBounds);
        if(output)await page.screenshot({path:join(output,'charts-'+mode.name+'-tooltip.png'),format:'png',fullPage:true});
      }
      assert.deepEqual(page.consoleErrors,[]);assert.deepEqual(page.blockedRequests,[]);
    } finally {observations.pages.push(record);off();await page.close();}
  });
}

for(const style of ['base','app']) test(style+' foundation keeps enlarged flex inputs within 320px',async()=>{
  const page=await browser.newPage({width:320,height:844}),url=new URL('controls-'+style+'.html',server.url).href;
  const off=await restrictPage(page,url);
  try {await page.goto(url,{settleMs:50});const m=await page.eval(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,input:document.querySelector('input').getBoundingClientRect().right}));assert.ok(m.page<=m.viewport&&m.input<=m.viewport,JSON.stringify(m));}
  finally{off();await page.close();}
});

test('shipping inspector completes six repeated fresh-profile runs without socket crashes',{timeout:90000},async()=>{
  await browser.close();browser=null;
  const base=output?join(output,'inspector'):join(dir,'inspector');mkdirSync(base,{recursive:true});
  for(let index=0;index<6;index++){
    const host=index%2?'claude':'codex';
    const p=spawnSync(process.execPath,[join(skill,'scripts/inspect.mjs'),join(root,host+'.html'),'--public-root',root,'--out',base,'--json'],{encoding:'utf8',timeout:40000});
    let report;try{report=JSON.parse(p.stdout)}catch{report={stdout:p.stdout}};
    observations.inspectors.push({host,exit_code:p.status,stderr:p.stderr,report});
    assert.equal(p.status,0,p.stderr+p.stdout);assert.deepEqual(report.findings,[]);assert.equal(report.viewports.length,4);
    assert.ok(readdirSync(dir).every(name=>!name.startsWith('taste-hardened-chrome-')), 'owned browser profile remained after inspector exit');
  }
});
