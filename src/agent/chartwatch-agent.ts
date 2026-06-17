// ChartWatch Agent — injected into source webviews
// Communicates via window.postMessage (picked up by webview-preload)
(function() {
  'use strict';
  if ((window as any).__CW_AGENT__) return;
  (window as any).__CW_AGENT__ = true;

  interface SelectorStep { strategy: 'id' | 'data' | 'css' | 'xpath' | 'text'; expression: string; }
  interface ObserveTarget { stickerId: string; cascade: SelectorStep[]; element?: Element | null; lastHtml?: string; }

  const observed = new Map<string, ObserveTarget>();
  let pickerActive = false;
  let selectedEl: Element | null = null;  // keyboard-navigable selected element
  let hoveredEl: Element | null = null;   // mouse-hovered element

  // ── Selector engine ──
  function resolveElement(cascade: SelectorStep[]): Element | null {
    for (const step of cascade) { const el = resolveStep(step); if (el) return el; }
    return null;
  }
  function resolveStep(step: SelectorStep): Element | null {
    try {
      switch (step.strategy) {
        case 'id': return document.getElementById(step.expression);
        case 'data': return document.querySelector(`[${step.expression}]`);
        case 'css': return document.querySelector(step.expression);
        case 'xpath': { const r = document.evaluate(step.expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null); return r.singleNodeValue as Element | null; }
        case 'text': { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) { if (w.currentNode.textContent?.includes(step.expression)) return w.currentNode.parentElement; } return null; }
        default: return null;
      }
    } catch { return null; }
  }

  function buildCascade(el: Element): SelectorStep[] {
    const cascade: SelectorStep[] = [];
    if (el.id) cascade.push({ strategy: 'id', expression: el.id });
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') && a.value) { cascade.push({ strategy: 'data', expression: `${a.name}="${a.value}"` }); break; }
    }
    cascade.push({ strategy: 'css', expression: getCssPath(el) });
    cascade.push({ strategy: 'xpath', expression: getXPath(el) });
    return cascade;
  }

  function getCssPath(el: Element): string {
    const parts: string[] = []; let cur: Element | null = el;
    while (cur && cur !== document.body) {
      let sel = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      if (cur.className && typeof cur.className === 'string') { const cls = cur.className.trim().split(/\s+/).slice(0, 2); if (cls[0]) sel += '.' + cls.join('.'); }
      const parent = cur.parentElement;
      if (parent) { const sibs = Array.from(parent.children).filter(c => c.tagName === cur!.tagName); if (sibs.length > 1) sel += `:nth-child(${sibs.indexOf(cur) + 1})`; }
      parts.unshift(sel); cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function getXPath(el: Element): string {
    const parts: string[] = []; let cur: Element | null = el;
    while (cur && cur !== document.body) {
      let idx = 1; let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`); cur = cur.parentElement;
    }
    return '//' + parts.join('/');
  }

  // ── Mutation watcher ──
  let mutTimer: number | null = null;
  const observer = new MutationObserver(() => { if (mutTimer) return; mutTimer = window.setTimeout(() => { mutTimer = null; checkObserved(); }, 100); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });

  function checkObserved(): void {
    for (const [sid, t] of observed) {
      if (!t.element || !document.body.contains(t.element)) t.element = resolveElement(t.cascade);
      if (!t.element) { send({ evt: 'stale', stickerId: sid, reason: 'not found' }); continue; }
      const html = t.element.outerHTML;
      if (html !== t.lastHtml) { t.lastHtml = html; send({ evt: 'mutation', stickerId: sid, html, innerText: t.element.textContent?.slice(0, 500) || '', ts: Date.now() }); }
    }
  }

  // ═══ PICKER ═══
  // UX: hover highlights, arrows navigate DOM tree, Enter confirms, Escape cancels, click confirms

  let highlightEl: HTMLDivElement | null = null;
  let labelEl: HTMLDivElement | null = null;
  let bannerEl: HTMLDivElement | null = null;

  function enterPick(): void {
    if (pickerActive) return;
    pickerActive = true; selectedEl = null; hoveredEl = null;
    createPickerUI();
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
    send({ evt: 'pickerEntered' });
  }

  function exitPick(): void {
    if (!pickerActive) return;
    pickerActive = false; selectedEl = null; hoveredEl = null;
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
    destroyPickerUI();
  }

  function createPickerUI(): void {
    // Highlight box
    highlightEl = document.createElement('div'); highlightEl.id = '__cw_hl__';
    Object.assign(highlightEl.style, { position:'fixed', border:'2px solid #00E676', background:'rgba(0,230,118,0.12)', pointerEvents:'none', transition:'all 60ms ease', zIndex:'999998', display:'none', borderRadius:'2px' });

    // Label
    labelEl = document.createElement('div'); labelEl.id = '__cw_lb__';
    Object.assign(labelEl.style, { position:'fixed', background:'#00E676', color:'#000', padding:'3px 10px', fontSize:'11px', fontFamily:'Consolas,monospace', borderRadius:'3px', zIndex:'999999', display:'none', pointerEvents:'none', whiteSpace:'nowrap', boxShadow:'0 2px 8px rgba(0,0,0,0.3)' });

    // Banner with instructions
    bannerEl = document.createElement('div'); bannerEl.id = '__cw_banner__';
    Object.assign(bannerEl.style, { position:'fixed', top:'0', left:'0', right:'0', padding:'8px 16px', textAlign:'center', fontSize:'13px', fontFamily:'system-ui,sans-serif',
      background:'linear-gradient(135deg,#00E676,#00C853)', color:'#000', fontWeight:'600', zIndex:'1000000', boxShadow:'0 2px 12px rgba(0,0,0,0.3)' });
    bannerEl.innerHTML = '🎯 <b>Picker Mode</b> — Hover to highlight · <b>↑↓</b> parent/child · <b>←→</b> siblings · <b>Enter</b> to select · <b>Esc</b> to cancel';

    document.body.appendChild(highlightEl);
    document.body.appendChild(labelEl);
    document.body.appendChild(bannerEl);
  }

  function destroyPickerUI(): void {
    document.getElementById('__cw_hl__')?.remove(); highlightEl = null;
    document.getElementById('__cw_lb__')?.remove(); labelEl = null;
    document.getElementById('__cw_banner__')?.remove(); bannerEl = null;
  }

  function highlightElement(el: Element | null): void {
    if (!el || !highlightEl || !labelEl) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    Object.assign(highlightEl.style, { display:'block', top:`${r.top}px`, left:`${r.left}px`, width:`${r.width}px`, height:`${r.height}px` });

    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = (!id && el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
    const size = `${Math.round(r.width)}×${Math.round(r.height)}`;
    const text = el.textContent?.trim().slice(0, 40) || '';
    labelEl.textContent = `${tag}${id}${cls}  ${size}  ${text ? '"' + text + '"' : ''}`;
    Object.assign(labelEl.style, { display:'block', top:`${Math.max(0, r.top - 28)}px`, left:`${Math.max(0, r.left)}px` });
  }

  function isCwElement(el: Element | null): boolean {
    if (!el) return false;
    const id = el.id || '';
    return id.startsWith('__cw_');
  }

  // ── Picker event handlers ──

  function onPickMove(e: MouseEvent): void {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isCwElement(el)) return;
    hoveredEl = el;
    // Only update highlight from mouse if no keyboard selection active
    if (!selectedEl) highlightElement(el);
  }

  function onPickClick(e: MouseEvent): void {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    // Confirm whatever is currently highlighted
    const target = selectedEl || hoveredEl;
    if (target) confirmPick(target);
  }

  function onPickKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      exitPick();
      send({ evt: 'pickCancelled' });
      return;
    }

    // Start keyboard navigation from hovered element if no selection yet
    const current = selectedEl || hoveredEl;
    if (!current) return;

    let next: Element | null = null;

    switch (e.key) {
      case 'ArrowUp':
        // Go to parent
        next = current.parentElement;
        if (next === document.body || next === document.documentElement) next = current;
        break;

      case 'ArrowDown':
        // Go to first child element
        next = current.firstElementChild;
        if (!next) next = current; // stay if no children
        break;

      case 'ArrowLeft':
        // Previous sibling
        next = current.previousElementSibling;
        if (!next) next = current; // stay if no prev sibling
        break;

      case 'ArrowRight':
        // Next sibling
        next = current.nextElementSibling;
        if (!next) next = current; // stay if no next sibling
        break;

      case 'Enter':
        e.preventDefault();
        confirmPick(current);
        return;

      default:
        return; // Don't prevent default for other keys
    }

    e.preventDefault();
    if (next && !isCwElement(next)) {
      selectedEl = next;
      highlightElement(next);
      // Update banner with current selection path
      if (bannerEl) {
        const path = getCssPath(next).split(' > ').slice(-3).join(' > ');
        bannerEl.innerHTML = `🎯 <b>Selected:</b> ${path} — <b>↑</b>parent <b>↓</b>child <b>←→</b>siblings <b>Enter</b>=confirm <b>Esc</b>=cancel`;
      }
    }
  }

  function confirmPick(el: Element): void {
    const cascade = buildCascade(el);
    const rect = el.getBoundingClientRect();
    send({
      evt: 'picked',
      cascade,
      innerText: el.textContent?.slice(0, 200) || '',
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
    exitPick();
  }

  // ── Bridge ──
  function send(data: Record<string, any>): void { window.postMessage(data, '*'); }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data; if (!msg || !msg.cmd) return;
    switch (msg.cmd) {
      case 'observe': observed.set(msg.stickerId, { stickerId: msg.stickerId, cascade: msg.cascade, element: resolveElement(msg.cascade) }); checkObserved(); break;
      case 'unobserve': observed.delete(msg.stickerId); break;
      case 'enterPick': enterPick(); break;
      case 'exitPick': exitPick(); break;
      case 'applyCrop': if (msg.cascade) { const el = resolveElement(msg.cascade); if (el) doCrop(el); } break;
    }
  });

  function doCrop(el: Element): void {
    const s = document.createElement('style'); s.id = '__cw_crop__';
    s.textContent = 'body>*:not(style):not([id^="__cw_"]){visibility:hidden!important;height:0!important;overflow:hidden!important}body{margin:0!important;padding:0!important}';
    document.head.appendChild(s);
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      (cur as HTMLElement).style.setProperty('visibility','visible','important');
      (cur as HTMLElement).style.setProperty('height','auto','important');
      (cur as HTMLElement).style.setProperty('overflow','visible','important');
      cur = cur.parentElement;
    }
    el.scrollIntoView({ block: 'start' });
  }

  send({ evt: 'ready' });
})();
