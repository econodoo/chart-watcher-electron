// ChartWatch Agent — injected into source webviews
(function() {
  'use strict';
  if ((window as any).__CW_AGENT__) return;
  (window as any).__CW_AGENT__ = true;

  interface SelectorStep { strategy: 'id' | 'data' | 'css' | 'xpath' | 'text'; expression: string; }
  interface ObserveTarget { stickerId: string; cascade: SelectorStep[]; element?: Element | null; lastHtml?: string; }

  const observed = new Map<string, ObserveTarget>();
  let pickerActive = false;
  let lockedEl: Element | null = null;   // locked selection (click or arrow)
  let hoveredEl: Element | null = null;  // mouse hover target

  // ── Selector engine ──
  function resolve(cascade: SelectorStep[]): Element | null {
    for (const s of cascade) { const el = resolveOne(s); if (el) return el; }
    return null;
  }
  function resolveOne(s: SelectorStep): Element | null {
    try {
      switch (s.strategy) {
        case 'id': return document.getElementById(s.expression);
        case 'data': return document.querySelector(`[${s.expression}]`);
        case 'css': return document.querySelector(s.expression);
        case 'xpath': { const r = document.evaluate(s.expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null); return r.singleNodeValue as Element | null; }
        case 'text': { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) { if (w.currentNode.textContent?.includes(s.expression)) return w.currentNode.parentElement; } return null; }
        default: return null;
      }
    } catch { return null; }
  }

  function buildCascade(el: Element): SelectorStep[] {
    const c: SelectorStep[] = [];
    if (el.id) c.push({ strategy: 'id', expression: el.id });
    for (const a of Array.from(el.attributes)) { if (a.name.startsWith('data-') && a.value) { c.push({ strategy: 'data', expression: `${a.name}="${a.value}"` }); break; } }
    c.push({ strategy: 'css', expression: getCssPath(el) });
    c.push({ strategy: 'xpath', expression: getXPath(el) });
    return c;
  }

  function getCssPath(el: Element): string {
    const p: string[] = []; let cur: Element | null = el;
    while (cur && cur !== document.body) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { p.unshift('#' + cur.id); break; }
      if (cur.className && typeof cur.className === 'string') { const cls = cur.className.trim().split(/\s+/).slice(0, 2).filter(Boolean); if (cls.length) s += '.' + cls.join('.'); }
      const par = cur.parentElement;
      if (par) { const sibs = Array.from(par.children).filter(c => c.tagName === cur!.tagName); if (sibs.length > 1) s += `:nth-child(${sibs.indexOf(cur) + 1})`; }
      p.unshift(s); cur = cur.parentElement;
    }
    return p.join(' > ');
  }

  function getXPath(el: Element): string {
    const p: string[] = []; let cur: Element | null = el;
    while (cur && cur !== document.body) {
      let idx = 1; let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      p.unshift(`${cur.tagName.toLowerCase()}[${idx}]`); cur = cur.parentElement;
    }
    return '//' + p.join('/');
  }

  // ── Mutation watcher ──
  let mt: number | null = null;
  const obs = new MutationObserver(() => { if (mt) return; mt = window.setTimeout(() => { mt = null; checkObs(); }, 100); });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  function checkObs(): void {
    for (const [sid, t] of observed) {
      if (!t.element || !document.body.contains(t.element)) t.element = resolve(t.cascade);
      if (!t.element) { send({ evt: 'stale', stickerId: sid, reason: 'not found' }); continue; }
      const html = t.element.outerHTML;
      if (html !== t.lastHtml) { t.lastHtml = html; send({ evt: 'mutation', stickerId: sid, html, innerText: t.element.textContent?.slice(0, 500) || '', ts: Date.now() }); }
    }
  }

  // ═══ PICKER ═══

  let hlEl: HTMLDivElement | null = null;
  let lbEl: HTMLDivElement | null = null;
  let bannerEl: HTMLDivElement | null = null;
  let infoEl: HTMLDivElement | null = null;

  function enterPick(): void {
    if (pickerActive) return;
    pickerActive = true; lockedEl = null; hoveredEl = null;
    createUI();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function exitPick(): void {
    pickerActive = false; lockedEl = null; hoveredEl = null;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    destroyUI();
  }

  function createUI(): void {
    hlEl = mkDiv('__cw_hl__', { position:'fixed', border:'2.5px solid #00E676', background:'rgba(0,230,118,0.1)', pointerEvents:'none', transition:'all 50ms ease', zIndex:'999998', display:'none', borderRadius:'3px' });
    lbEl = mkDiv('__cw_lb__', { position:'fixed', background:'#00E676', color:'#000', padding:'3px 10px', fontSize:'11px', fontFamily:'Consolas,monospace', borderRadius:'3px', zIndex:'999999', display:'none', pointerEvents:'none', whiteSpace:'nowrap', boxShadow:'0 2px 8px rgba(0,0,0,0.3)' });
    bannerEl = mkDiv('__cw_banner__', { position:'fixed', top:'0', left:'0', right:'0', padding:'8px 16px', textAlign:'center', fontSize:'13px', fontFamily:'system-ui',
      background:'linear-gradient(135deg,#00E676,#00C853)', color:'#000', fontWeight:'600', zIndex:'1000000', boxShadow:'0 2px 12px rgba(0,0,0,0.3)' });
    bannerEl.innerHTML = '🎯 <b>Hover</b> to preview · <b>Click</b> to lock selection · <b>↑↓←→</b> navigate · <b>Enter</b> confirm · <b>Esc</b> cancel';
    infoEl = mkDiv('__cw_info__', { position:'fixed', bottom:'0', left:'0', right:'0', padding:'6px 16px', fontSize:'12px', fontFamily:'Consolas,monospace',
      background:'rgba(0,0,0,0.85)', color:'#00E676', zIndex:'1000000', pointerEvents:'none', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' });
    infoEl.textContent = 'Hover over an element…';
    document.body.appendChild(hlEl); document.body.appendChild(lbEl); document.body.appendChild(bannerEl); document.body.appendChild(infoEl);
  }

  function destroyUI(): void {
    ['__cw_hl__','__cw_lb__','__cw_banner__','__cw_info__'].forEach(id => document.getElementById(id)?.remove());
    hlEl = lbEl = bannerEl = infoEl = null;
  }

  function mkDiv(id: string, style: Record<string, string>): HTMLDivElement {
    const d = document.createElement('div'); d.id = id; Object.assign(d.style, style); return d;
  }

  function isCw(el: Element | null): boolean { return !!el && (el.id || '').startsWith('__cw_'); }

  function highlight(el: Element): void {
    if (!hlEl || !lbEl) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    Object.assign(hlEl.style, { display:'block', top:`${r.top}px`, left:`${r.left}px`, width:`${r.width}px`, height:`${r.height}px` });
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = (!id && el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
    const sz = `${Math.round(r.width)}×${Math.round(r.height)}`;
    const txt = (el.textContent?.trim() || '').slice(0, 30);
    lbEl.textContent = `${tag}${id}${cls}  ${sz}`;
    Object.assign(lbEl.style, { display:'block', top:`${Math.max(0, r.top - 28)}px`, left:`${Math.max(0, r.left)}px` });

    // Update info bar
    if (infoEl) {
      const cssPath = getCssPath(el);
      const xPath = getXPath(el);
      infoEl.textContent = `css: ${cssPath}  ·  xpath: ${xPath}${txt ? '  ·  "' + txt + '"' : ''}`;
    }
  }

  // Show a static highlight for an existing selection (not in picker mode)
  function showStaticHighlight(cascade: SelectorStep[]): void {
    const el = resolve(cascade);
    if (!el) return;
    // Create persistent highlight
    const existing = document.getElementById('__cw_static_hl__');
    if (existing) existing.remove();
    const r = el.getBoundingClientRect();
    const hl = mkDiv('__cw_static_hl__', {
      position:'fixed', border:'2px dashed #448AFF', background:'rgba(68,138,255,0.08)',
      pointerEvents:'none', zIndex:'999990', borderRadius:'3px',
      top:`${r.top}px`, left:`${r.left}px`, width:`${r.width}px`, height:`${r.height}px`
    });
    // Add label
    const lb = mkDiv('__cw_static_lb__', {
      position:'fixed', background:'#448AFF', color:'#fff', padding:'2px 8px', fontSize:'10px',
      fontFamily:'Consolas,monospace', borderRadius:'2px', zIndex:'999991', pointerEvents:'none',
      top:`${Math.max(0, r.top - 22)}px`, left:`${r.left}px`
    });
    const cssExpr = cascade.find(s => s.strategy === 'css')?.expression || '';
    lb.textContent = `Current: ${cssExpr}`;
    document.body.appendChild(hl);
    document.body.appendChild(lb);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── Picker events ──

  function onMove(e: MouseEvent): void {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isCw(el)) return;
    hoveredEl = el;
    // Only update highlight from mouse if NOT locked
    if (!lockedEl) highlight(el);
  }

  function onClick(e: MouseEvent): void {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isCw(el)) return;

    if (!lockedEl) {
      // First click = LOCK the selection (freeze it)
      lockedEl = el;
      hoveredEl = el;
      highlight(el);
      if (bannerEl) bannerEl.innerHTML = '🔒 <b>Locked</b> — <b>↑↓←→</b> to navigate · <b>Enter</b> to confirm · <b>Click</b> elsewhere to re-lock · <b>Esc</b> cancel';
    } else {
      // Second click on different element = re-lock to new element
      // Click on same element = confirm
      if (el === lockedEl) {
        confirmPick(lockedEl);
      } else {
        lockedEl = el;
        highlight(el);
      }
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      exitPick();
      send({ evt: 'pickCancelled' });
      return;
    }

    const current = lockedEl || hoveredEl;
    if (!current) return;

    let next: Element | null = null;

    switch (e.key) {
      case 'ArrowUp':
        next = current.parentElement;
        if (!next || next === document.body || next === document.documentElement) next = current;
        break;
      case 'ArrowDown':
        // First non-CW child
        next = Array.from(current.children).find(c => !isCw(c)) || current;
        break;
      case 'ArrowLeft':
        next = current.previousElementSibling;
        while (next && isCw(next)) next = next.previousElementSibling;
        if (!next) next = current;
        break;
      case 'ArrowRight':
        next = current.nextElementSibling;
        while (next && isCw(next)) next = next.nextElementSibling;
        if (!next) next = current;
        break;
      case 'Enter':
        e.preventDefault();
        confirmPick(current);
        return;
      default:
        return;
    }

    e.preventDefault();
    if (next && next !== current) {
      lockedEl = next;
      highlight(next);
      if (bannerEl) {
        const path = getCssPath(next).split(' > ').slice(-3).join(' > ');
        bannerEl.innerHTML = `🔒 <b>${path}</b> — <b>↑↓←→</b> navigate · <b>Enter</b> confirm · <b>Esc</b> cancel`;
      }
    }
  }

  function confirmPick(el: Element): void {
    const cascade = buildCascade(el);
    const r = el.getBoundingClientRect();
    send({ evt: 'picked', cascade, innerText: el.textContent?.slice(0, 200) || '',
      rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
    exitPick();
  }

  // ── Crop ──
  let currentCropCascade: SelectorStep[] | null = null;
  let cropRetryTimer: number | null = null;

  function doCrop(cascade: SelectorStep[], attempt: number = 0): void {
    // Clear any pending retry
    if (cropRetryTimer) { clearTimeout(cropRetryTimer); cropRetryTimer = null; }
    currentCropCascade = cascade;

    // Undo previous crop first
    undoCrop();

    const el = resolve(cascade);
    if (!el) {
      // Target not found — retry with increasing delay (page might still be loading)
      const delays = [2000, 5000, 10000];
      if (attempt < delays.length) {
        const delay = delays[attempt];
        send({ evt: 'cropRetrying', attempt: attempt + 1, delay });
        cropRetryTimer = window.setTimeout(() => doCrop(cascade, attempt + 1), delay);
      } else {
        send({ evt: 'cropFailed', reason: 'Element not found after retries' });
      }
      return;
    }

    // Walk from target UP to body, hide all siblings at each level
    const hiddenEls: HTMLElement[] = [];
    let current: Element | null = el;

    while (current && current.parentElement) {
      const parent: Element = current.parentElement;
      const siblings: Element[] = Array.from(parent.children);
      for (const sibling of siblings) {
        if (sibling === current) continue;
        if (sibling.tagName === 'STYLE' || sibling.tagName === 'SCRIPT' || sibling.tagName === 'LINK') continue;
        if ((sibling.id || '').startsWith('__cw_')) continue;
        const htmlSib = sibling as HTMLElement;
        htmlSib.dataset.cwHidden = 'true';
        htmlSib.style.setProperty('display', 'none', 'important');
        hiddenEls.push(htmlSib);
      }
      if (parent === document.body || parent === document.documentElement) break;
      current = parent;
    }

    document.body.style.setProperty('margin', '0', 'important');
    document.body.style.setProperty('padding', '0', 'important');
    document.body.style.setProperty('overflow', 'auto', 'important');
    (el as HTMLElement).dataset.cwCropTarget = 'true';
    el.scrollIntoView({ block: 'start' });
    (window as any).__cw_hidden__ = hiddenEls;
    send({ evt: 'cropApplied', count: hiddenEls.length });
  }

  function undoCrop(): void {
    if (cropRetryTimer) { clearTimeout(cropRetryTimer); cropRetryTimer = null; }
    const hidden: HTMLElement[] = (window as any).__cw_hidden__ || [];
    for (const el of hidden) {
      el.style.removeProperty('display');
      delete el.dataset.cwHidden;
    }
    (window as any).__cw_hidden__ = [];
    document.querySelector('[data-cw-crop-target]')?.removeAttribute('data-cw-crop-target');
    document.body.style.removeProperty('margin');
    document.body.style.removeProperty('padding');
    document.body.style.removeProperty('overflow');
  }

  function reapplyCrop(): void {
    if (currentCropCascade) doCrop(currentCropCascade, 0);
  }

  // ── Bridge ──
  function send(data: Record<string, any>): void { window.postMessage(data, '*'); }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const m = event.data; if (!m?.cmd) return;
    switch (m.cmd) {
      case 'observe': observed.set(m.stickerId, { stickerId: m.stickerId, cascade: m.cascade, element: resolve(m.cascade) }); checkObs(); break;
      case 'unobserve': observed.delete(m.stickerId); break;
      case 'enterPick': undoCrop(); enterPick(); break;
      case 'exitPick': exitPick(); break;
      case 'showSelection': if (m.cascade) showStaticHighlight(m.cascade); break;
      case 'previewCrop': if (m.cascade) doCrop(m.cascade); break;
      case 'applyCrop': if (m.cascade) doCrop(m.cascade); break;
      case 'reapplyCrop': reapplyCrop(); break;
      case 'undoCrop': undoCrop(); break;
    }
  });

  send({ evt: 'ready' });
})();
