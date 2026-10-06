// UI sweep: every main route x 3 layouts x 2 themes x 1440/560 in a hidden Electron window.
// Flags low text contrast, sideways scroll, unnamed controls, images without alt and console errors.
// Usage: start a dev server (npm start), then
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/ui-sweep.cjs
// SWEEP_URL (default http://localhost:4200) and SWEEP_OUT (default <tmp>/lutstra-ui-sweep) override.
// Text over images is not measured (its background is an image), so check those screenshots by eye.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const BASE = process.env.SWEEP_URL || 'http://localhost:4200';
const OUT = process.env.SWEEP_OUT || path.join(require('os').tmpdir(), 'lutstra-ui-sweep');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const nav = (u) => `ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('${u}')`;
const NOTRANS = `if (!document.getElementById('nt')) document.head.insertAdjacentHTML('beforeend','<style id="nt">*,*::before,*::after{transition:none!important;animation:none!important}</style>')`;

const AUDIT = `(() => {
  const parse = (s) => { const m = s.match(/[0-9.]+/g); if (!m) return [0,0,0,0]; const n = m.map(Number); return s.startsWith('color(') ? [n[0]*255,n[1]*255,n[2]*255,n[3] ?? 1] : [n[0],n[1],n[2],n[3] ?? 1]; };
  const blend = (t, u) => { const a = t[3]; return [0,1,2].map(i => t[i]*a + u[i]*(1-a)).concat(1); };
  const bgOf = (el) => { const st = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('linear-gradient(rgba(0, 0, 0, 0)')) return null; const c = parse(cs.backgroundColor); if (c[3] > 0) { st.push(c); if (c[3] >= 1) break; } } let b = document.documentElement.dataset.theme === 'light' ? [255,255,255,1] : [17,18,20,1]; for (const c of st.reverse()) b = blend(c, b); return b; };
  const lum = (c) => c.slice(0,3).map(v => v/255).map(v => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
  const ratio = (a,b) => { const [h,l] = [lum(a),lum(b)].sort((x,y)=>y-x); return (h+0.05)/(l+0.05); };
  const hex = (c) => '#' + c.slice(0,3).map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const low = []; const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('svg') || el.closest('[aria-hidden=true]')) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el); if (parseFloat(cs.opacity) < 1) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const bg = bgOf(el); if (!bg) continue;
    const fg = blend(parse(cs.color), bg);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const disabled = el.closest('[disabled],[aria-disabled=true],.missing,.unavailable,tr.missing,.is-unavailable');
    const r = ratio(fg, bg);
    if (r < need && op > 0.99 && !disabled) { const key = el.className + '|' + hex(fg) + hex(bg); if (!seen.has(key)) { seen.add(key); low.push((el.tagName + '.' + String(el.className).split(' ')[0]).slice(0,40) + ' "' + el.textContent.trim().slice(0,18) + '" ' + hex(fg) + '/' + hex(bg) + '=' + r.toFixed(2)); } }
  }
  const unnamed = [...document.querySelectorAll('button, a[href], [role=button], input, select')].filter(vis).filter(e => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent.trim() || e.getAttribute('title') || e.labels?.length || e.getAttribute('placeholder'))).map(e => e.tagName + '.' + String(e.className).split(' ')[0]);
  const noalt = [...document.querySelectorAll('img')].filter(vis).filter(i => !i.hasAttribute('alt')).length;
  const hscroll = document.scrollingElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('main, .main-content, [class*=content]')].some(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'hidden' && getComputedStyle(e).overflowX !== 'clip');
  return JSON.stringify({ low: low.slice(0, 8), lowCount: low.length, unnamed: [...new Set(unnamed)].slice(0, 6), noalt, hscroll });
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, useContentSize: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const errors = [];
  win.webContents.on('console-message', (e) => { const m = e.message || ''; if ((e.level === 'error' || e.level === 3) && !m.includes('frame-ancestors')) errors.push(m.slice(0, 160)); });
  await win.loadURL(BASE);
  await js(`localStorage.setItem('lutsra.layout.mode','inset')`);
  await win.loadURL(BASE + '/artists'); await wait(3000);
  const artist = await js(`[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).find(h=>h.startsWith('/artists/'))`);
  await win.loadURL(BASE + '/playlists'); await wait(3000);
  const playlist = await js(`[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).find(h=>h.startsWith('/playlists/'))`);
  const routes = ['/home', '/songs', '/albums', '/albums/album-midnight', '/artists', artist, '/playlists', playlist, '/folders', '/settings', '/now-playing'];
  const report = [];
  for (const layout of ['inset', 'classic', 'liquid-glass']) {
    await js(`localStorage.setItem('lutsra.layout.mode','${layout}')`);
    await win.loadURL(BASE + '/songs'); await wait(3500);
    await js(`document.querySelectorAll('.songs-table tbody tr')[0].dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`); await wait(800);
    await js(`document.querySelector('.player-bar button[aria-label*=Pause], .play-pause-btn')?.click()`); await wait(300);
    await js(NOTRANS);
    for (const [w, h] of [[1440, 900], [560, 900]]) {
      win.setContentSize(w, h); await wait(500);
      for (const theme of ['dark', 'light']) {
        await js(`document.documentElement.setAttribute('data-theme','${theme}')`);
        for (const route of routes) {
          errors.length = 0;
          await js(nav(route)); await wait(route === '/folders' ? 3500 : 1800);
          await js(`document.documentElement.setAttribute('data-theme','${theme}')`); await wait(150);
          const a = JSON.parse(await js(AUDIT));
          const name = `${layout}-${theme}-${w}-${route.replace(/\//g, '_')}`;
          if (theme === 'dark' || w === 1440) { win.webContents.invalidate(); await wait(150); fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
          if (a.lowCount || a.unnamed.length || a.noalt || a.hscroll || errors.length) report.push(name + ' ' + JSON.stringify({ ...a, errors: [...new Set(errors)].slice(0, 3) }));
        }
      }
    }
    win.setContentSize(1440, 900);
  }
  fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n'));
  console.log('pages flagged:', report.length, '->', OUT);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
