// ChartWatch Agent — injected into source pages via webview.executeJavaScript()
// Communicates with shell via window.postMessage (picked up by webview-preload)

(function() {
  'use strict';
  if ((window as any).__CW_AGENT__) return;
  (window as any).__CW_AGENT__ = true;

  // ── Types ──
  interface SelectorStep {
    strategy: 'id' | 'data' | 'css' | 'xpath' | 'text';
    expression: string;
  }

  interface ObserveTarget {
    stickerId: string;
    cascade: SelectorStep[];
    element?: Element | null;
    lastHtml?: string;
  }

  // ── State ──
  const observed: Map<string, ObserveTarget> = new Map();
  let pickerActive = false;
  let pickerOverlay: HTMLDivElement | null = null;
  let hoveredEl: Element | null = null;

  // ── Selector engine ──

  function resolveElement(cascade: SelectorStep[]): Element | null {
    for (const step of cascade) {
      const el = resolveStep(step);
      if (el) return el;
    }
    return null;
  }

  function resolveStep(step: SelectorStep): Element | null {
    try {
      switch (step.strategy) {
        case 'id':
          return document.getElementById(step.expression);
        case 'data':
          return document.querySelector(`[${step.expression}]`);
        case 'css':
          return document.querySelector(step.expression);
        case 'xpath': {
          const result = document.evaluate(
            step.expression, document, null,
            XPathResult.FIRST_ORDERED_NODE_TYPE, null
          );
          return result.singleNodeValue as Element | null;
        }
        case 'text': {
          const walker = document.createTreeWalker(
            document.body, NodeFilter.SHOW_TEXT, null
          );
          while (walker.nextNode()) {
            if (walker.currentNode.textContent?.includes(step.expression)) {
              return walker.currentNode.parentElement;
            }
          }
          return null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  function buildCascade(el: Element): SelectorStep[] {
    const cascade: SelectorStep[] = [];

    // 1. ID
    if (el.id) {
      cascade.push({ strategy: 'id', expression: el.id });
    }

    // 2. Data attributes
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-') && attr.value) {
        cascade.push({ strategy: 'data', expression: `${attr.name}="${attr.value}"` });
        break;
      }
    }

    // 3. CSS path
    const cssPath = getCssPath(el);
    if (cssPath) {
      cascade.push({ strategy: 'css', expression: cssPath });
    }

    // 4. XPath
    const xpath = getXPath(el);
    if (xpath) {
      cascade.push({ strategy: 'xpath', expression: xpath });
    }

    return cascade;
  }

  function getCssPath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${current.id}`;
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length > 0 && classes[0]) {
          selector += '.' + classes.join('.');
        }
      }
      // nth-child for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          c => c.tagName === current!.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-child(${idx})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getXPath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.body) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }
    return '//' + parts.join('/');
  }

  // ── Mutation watcher ──

  let mutationTimer: number | null = null;
  const THROTTLE_MS = 100; // 10Hz

  const observer = new MutationObserver(() => {
    if (mutationTimer) return;
    mutationTimer = window.setTimeout(() => {
      mutationTimer = null;
      checkObserved();
    }, THROTTLE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  function checkObserved(): void {
    for (const [stickerId, target] of observed) {
      // Re-resolve if element is gone
      if (!target.element || !document.body.contains(target.element)) {
        target.element = resolveElement(target.cascade);
      }

      if (!target.element) {
        send({ evt: 'stale', stickerId, reason: 'Element not found' });
        continue;
      }

      const html = target.element.outerHTML;
      if (html !== target.lastHtml) {
        target.lastHtml = html;
        send({
          evt: 'mutation',
          stickerId,
          html,
          innerText: target.element.textContent?.slice(0, 500) || '',
          ts: Date.now(),
        });
      }
    }
  }

  // ── Picker overlay ──

  function createOverlay(): void {
    if (pickerOverlay) return;
    pickerOverlay = document.createElement('div');
    Object.assign(pickerOverlay.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '999999', cursor: 'crosshair',
      background: 'transparent', pointerEvents: 'none',
    });

    const highlight = document.createElement('div');
    highlight.id = '__cw_highlight__';
    Object.assign(highlight.style, {
      position: 'fixed', border: '2px solid #00C853',
      background: 'rgba(0, 200, 83, 0.15)',
      pointerEvents: 'none', transition: 'all 80ms ease',
      zIndex: '999998', display: 'none',
    });

    const label = document.createElement('div');
    label.id = '__cw_label__';
    Object.assign(label.style, {
      position: 'fixed', background: '#00C853', color: '#000',
      padding: '2px 8px', fontSize: '11px', fontFamily: 'monospace',
      borderRadius: '2px', zIndex: '999999', display: 'none',
      pointerEvents: 'none',
    });

    document.body.appendChild(highlight);
    document.body.appendChild(label);
    document.body.appendChild(pickerOverlay);

    document.addEventListener('mousemove', onPickerMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKey, true);
  }

  function destroyOverlay(): void {
    document.removeEventListener('mousemove', onPickerMove, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKey, true);
    document.getElementById('__cw_highlight__')?.remove();
    document.getElementById('__cw_label__')?.remove();
    pickerOverlay?.remove();
    pickerOverlay = null;
    hoveredEl = null;
  }

  function onPickerMove(e: MouseEvent): void {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id?.startsWith('__cw_')) return;
    hoveredEl = el;

    const rect = el.getBoundingClientRect();
    const highlight = document.getElementById('__cw_highlight__');
    const label = document.getElementById('__cw_label__');
    if (highlight) {
      Object.assign(highlight.style, {
        display: 'block',
        top: rect.top + 'px', left: rect.left + 'px',
        width: rect.width + 'px', height: rect.height + 'px',
      });
    }
    if (label) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      label.textContent = `${tag}${el.id ? '#' + el.id : cls} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
      Object.assign(label.style, {
        display: 'block',
        top: Math.max(0, rect.top - 20) + 'px',
        left: rect.left + 'px',
      });
    }
  }

  function onPickerClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!hoveredEl) return;

    const cascade = buildCascade(hoveredEl);
    const rect = hoveredEl.getBoundingClientRect();

    send({
      evt: 'picked',
      cascade,
      innerText: hoveredEl.textContent?.slice(0, 200) || '',
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
  }

  function onPickerKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      exitPick();
      send({ evt: 'pickCancelled' });
    }
  }

  function enterPick(): void {
    pickerActive = true;
    createOverlay();
  }

  function exitPick(): void {
    pickerActive = false;
    destroyOverlay();
  }

  // ── Bridge ──

  function send(data: Record<string, any>): void {
    window.postMessage(data, '*');
  }

  // Receive commands from shell (via webview-preload → postMessage)
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || !msg.cmd) return;

    switch (msg.cmd) {
      case 'observe':
        observed.set(msg.stickerId, {
          stickerId: msg.stickerId,
          cascade: msg.cascade,
          element: resolveElement(msg.cascade),
        });
        checkObserved();
        break;

      case 'unobserve':
        observed.delete(msg.stickerId);
        break;

      case 'enterPick':
        enterPick();
        break;

      case 'exitPick':
        exitPick();
        break;

      case 'applyCrop':
        applyCrop(msg.cascade);
        break;
    }
  });

  // ── Crop mode ──

  function applyCrop(cascade: SelectorStep[]): void {
    const el = resolveElement(cascade);
    if (!el) return;

    // Hide everything except the target element chain
    const style = document.createElement('style');
    style.id = '__cw_crop_style__';
    style.textContent = `
      body > *:not(style) { display: none !important; }
      body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
    `;
    document.head.appendChild(style);

    // Show the target + ancestors
    let current: Element | null = el;
    while (current && current !== document.documentElement) {
      (current as HTMLElement).style.setProperty('display', '', 'important');
      current = current.parentElement;
    }
  }

  // Signal ready
  send({ evt: 'ready' });

})();
