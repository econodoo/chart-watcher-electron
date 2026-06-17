// ═══ Chart Watcher Shell ═══

interface Source { id: string; name: string; entry_url: string; partition_key: string; auto_start: boolean; }
interface Component { id: string; title: string; type: 'WholeSite' | 'Crop' | 'Clone'; source_id: string; selectors: string; }
interface Tab { id: string; workspace_id: string; name: string; sort_order: number; grid_cols: number; grid_rows: number; }
interface Placement { id: string; tab_id: string; component_id: string; col: number; row: number; col_span: number; row_span: number; }

// ── State ──
let sources: Source[] = [];
let components: Component[] = [];
let tabs: Tab[] = [];
let activeTabId = '';
let placements: Placement[] = [];
let selectedCardId: string | null = null;
let designMode = true;
const GRID_COLS = 12, GRID_ROWS = 8;
const THEMES = ['colorful', 'stealth', 'colorblind'];
let currentThemeIdx = 0;
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5];
const cardZooms = new Map<string, number>();
const sourceWebviews = new Map<string, any>();
let cachedAgentCode: string | null = null;

const $ = (s: string) => document.querySelector(s)!;

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', () => {
  // Wire toolbar
  $('#btn-add-source').addEventListener('click', showAddSourceDialog);
  $('#btn-add-source-2').addEventListener('click', showAddSourceDialog);
  $('#btn-add-component').addEventListener('click', showAddComponentDialog);
  $('#btn-toggle-mode').addEventListener('click', toggleMode);
  $('#btn-toggle-left').addEventListener('click', () => $('#left-panel').classList.toggle('collapsed'));
  $('#btn-toggle-right').addEventListener('click', () => $('#right-panel').classList.toggle('collapsed'));
  $('#btn-add-tab').addEventListener('click', addTab);
  $('#btn-recrop').addEventListener('click', recropAll);
  $('#btn-uncrop').addEventListener('click', uncropAll);
  $('#btn-apply-layout').addEventListener('click', applyLayoutChanges);
  $('#btn-delete-card').addEventListener('click', () => selectedCardId && removeCard(selectedCardId));
  $('#btn-configure-card')?.addEventListener('click', () => {
    if (!selectedCardId) return;
    const p = placements.find(x => x.id === selectedCardId);
    const c = p ? components.find(x => x.id === p.component_id) : null;
    if (p && c) openConfigureWorkspace(p, c);
  });

  const themeSelect = $('#theme-select') as HTMLSelectElement;
  themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value);
    window.api?.setSetting('theme', themeSelect.value);
  });

  setInterval(() => { const el = document.getElementById('status-clock'); if (el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
  window.addEventListener('resize', repositionAllCards);
  loadData(themeSelect);
});

async function loadData(themeSelect: HTMLSelectElement): Promise<void> {
  if (!window.api) { toast('Preload bridge missing — check DevTools', 'error'); return; }
  try {
    sources = await window.api.getSources();
    components = await window.api.getComponents();
    tabs = await window.api.getTabs();
  } catch (err) { toast(`DB error: ${err}`, 'error'); return; }
  try {
    const t = await window.api.getSetting('theme');
    if (t && THEMES.includes(t)) { currentThemeIdx = THEMES.indexOf(t); applyTheme(t); themeSelect.value = t; }
  } catch {}
  renderSources(); renderComponents(); renderTabs();
  if (tabs.length > 0) await selectTab(tabs[0].id);
  window.api.onCycleTheme?.(() => { currentThemeIdx = (currentThemeIdx + 1) % THEMES.length; applyTheme(THEMES[currentThemeIdx]); themeSelect.value = THEMES[currentThemeIdx]; window.api.setSetting('theme', THEMES[currentThemeIdx]); });
  window.api.onReloadSources?.(() => { sourceWebviews.forEach((wv, id) => { (wv as any).reload(); updateDot(id, 'loading'); }); toast('Reloading all sources…', 'info'); });
  for (const s of sources) if (s.auto_start) launchSource(s);
  toast(`Loaded ${sources.length} source${sources.length !== 1 ? 's' : ''}, ${components.length} component${components.length !== 1 ? 's' : ''}`, 'success');
}

function applyTheme(name: string): void { (document.getElementById('theme-link') as HTMLLinkElement).href = `styles/${name}.css`; currentThemeIdx = THEMES.indexOf(name); }

// ═══ TOAST ═══
function toast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const c = document.getElementById('toast-container'); if (!c) return;
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
  c.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
  console.log(`[${type}] ${msg}`);
}

// ═══ SOURCES ═══
function renderSources(): void {
  const list = $('#source-list'); list.innerHTML = '';
  for (const s of sources) {
    const el = document.createElement('div'); el.className = 'source-item';
    el.innerHTML = `<span class="status-dot" data-sid="${s.id}"></span><span class="source-name">${esc(s.name)}</span>
      <span class="source-actions"><button title="Reload" data-act="reload">↻</button><button title="Remove" data-act="remove">×</button></span>`;
    el.querySelector('[data-act="reload"]')!.addEventListener('click', (e) => { e.stopPropagation(); const wv = sourceWebviews.get(s.id); if (wv) { wv.reload(); updateDot(s.id, 'loading'); toast(`Reloading ${s.name}…`, 'info'); } });
    el.querySelector('[data-act="remove"]')!.addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`Remove source "${s.name}"?`)) removeSource(s.id); });
    list.appendChild(el);
  }
  renderStatusDots();
}

function renderStatusDots(): void {
  const c = $('#status-dots'); c.innerHTML = '';
  for (const s of sources) { const d = document.createElement('span'); d.className = 'status-dot'; d.dataset.sid = s.id; d.title = s.name; c.appendChild(d); }
}

function updateDot(id: string, status: string): void {
  document.querySelectorAll(`.status-dot[data-sid="${id}"]`).forEach(d => d.className = `status-dot ${status}`);
}

async function removeSource(id: string): Promise<void> {
  const wv = sourceWebviews.get(id); if (wv) { wv.remove(); sourceWebviews.delete(id); }
  sources = sources.filter(s => s.id !== id); renderSources();
  toast('Source removed', 'info');
}

// ═══ WEBVIEW SOURCES ═══
function launchSource(src: Source): void {
  if (sourceWebviews.has(src.id)) return;
  const wv = document.createElement('webview') as any;
  wv.setAttribute('src', src.entry_url);
  wv.setAttribute('partition', src.partition_key || `persist:${src.id}`);
  try { wv.setAttribute('preload', `file://${window.api.getWebviewPreloadPath()}`); } catch {}
  wv.style.cssText = 'width:1px;height:1px;';
  wv.addEventListener('dom-ready', () => { updateDot(src.id, 'ready'); injectAgent(wv, src.name); });
  wv.addEventListener('did-fail-load', () => { updateDot(src.id, 'error'); toast(`${src.name} failed to load`, 'error'); });
  wv.addEventListener('ipc-message', (ev: any) => { if (ev.channel === 'agent-message') handleAgentMsg(src.id, ev.args[0]); });
  document.getElementById('webview-host')!.appendChild(wv);
  sourceWebviews.set(src.id, wv); updateDot(src.id, 'loading');
}

async function injectAgent(wv: any, name: string): Promise<void> {
  try {
    if (!cachedAgentCode) { const r = await fetch(`file://${window.api.getAgentJsPath()}`); cachedAgentCode = await r.text(); }
    await wv.executeJavaScript(cachedAgentCode);
  } catch (err) { console.error(`[Agent] ${name}:`, err); }
}

// ═══ AGENT MESSAGES ═══
function handleAgentMsg(srcId: string, msg: any): void {
  if (msg.evt === 'ready') updateDot(srcId, 'ready');
  else if (msg.evt === 'mutation') {
    document.querySelectorAll(`.card[data-source-id="${srcId}"] .clone-content`).forEach(el => { el.textContent = msg.innerText || msg.html || ''; });
    (document.getElementById('status-mutation') as HTMLElement).textContent = `⚡ ${new Date().toLocaleTimeString()}`;
  }
  else if (msg.evt === 'stale') updateDot(srcId, 'stale');
}

// ═══ COMPONENTS ═══
function renderComponents(): void {
  const list = $('#component-list'); list.innerHTML = '';
  for (const c of components) {
    const icons: Record<string, string> = { WholeSite: '🌐', Crop: '✂️', Clone: '📋' };
    const el = document.createElement('div'); el.className = 'component-item';
    el.innerHTML = `<span class="comp-icon">${icons[c.type] || '📦'}</span><span class="component-name">${esc(c.title)}</span>`;
    list.appendChild(el);
  }
}

// ═══ TABS ═══
function renderTabs(): void {
  const tl = $('#tab-list'); tl.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div'); el.className = `tab ${t.id === activeTabId ? 'active' : ''}`;
    el.innerHTML = `<span class="tab-name">${esc(t.name)}</span>${tabs.length > 1 ? '<button class="tab-close" title="Close tab">×</button>' : ''}`;
    // Click = switch tab
    el.querySelector('.tab-name')!.addEventListener('click', () => selectTab(t.id));
    // Double-click = rename tab
    el.querySelector('.tab-name')!.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const newName = prompt('Rename tab:', t.name);
      if (newName && newName.trim()) { t.name = newName.trim(); renderTabs(); toast(`Tab renamed to "${t.name}"`, 'info'); }
    });
    // Close tab
    el.querySelector('.tab-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Close tab "${t.name}"?`)) closeTab(t.id);
    });
    tl.appendChild(el);
  }
}

async function selectTab(id: string): Promise<void> {
  activeTabId = id; placements = await window.api.getPlacements(id); renderTabs(); renderCards();
}

async function addTab(): Promise<void> {
  const name = prompt('Tab name:', `Tab ${tabs.length + 1}`); if (!name) return;
  const t: Tab = { id: crypto.randomUUID(), workspace_id: tabs[0]?.workspace_id || '', name, sort_order: tabs.length, grid_cols: GRID_COLS, grid_rows: GRID_ROWS };
  tabs.push(t); await selectTab(t.id); toast(`Tab "${name}" created`, 'success');
}

function closeTab(id: string): void {
  if (tabs.length <= 1) return;
  tabs = tabs.filter(t => t.id !== id); if (activeTabId === id) selectTab(tabs[0].id); else renderTabs();
}

// ═══ CARDS ═══
function renderCards(): void {
  const container = $('#card-container'); container.innerHTML = '';
  (document.getElementById('empty-state') as HTMLElement).style.display = placements.length === 0 ? 'flex' : 'none';
  for (const p of placements) {
    const comp = components.find(c => c.id === p.component_id); if (!comp) continue;
    const card = buildCard(p, comp); container.appendChild(card); positionCard(card, p);
  }
}

function buildCard(p: Placement, comp: Component): HTMLDivElement {
  const card = document.createElement('div'); card.className = 'card'; card.id = `card-${p.id}`;
  card.dataset.placementId = p.id; card.dataset.componentId = comp.id; card.dataset.sourceId = comp.source_id;
  const zoom = cardZooms.get(p.id) ?? (comp.type === 'WholeSite' ? 0.5 : 1.0);
  cardZooms.set(p.id, zoom);

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${esc(comp.title)}</span>
      <div class="card-controls">
        <button class="card-btn" data-act="zoom-out" title="Zoom out">−</button>
        <span class="card-zoom-label">${Math.round(zoom * 100)}%</span>
        <button class="card-btn" data-act="zoom-in" title="Zoom in">+</button>
        ${comp.type === 'Crop' ? `
          <button class="card-btn" data-act="uncrop" title="Uncrop — show full page to navigate">👁</button>
          <button class="card-btn" data-act="reapply" title="Reapply crop">↻</button>
        ` : ''}
        <button class="card-btn" data-act="configure" title="Configure">⚙</button>
        <button class="card-btn card-btn-close" data-act="remove" title="Remove">×</button>
      </div>
    </div>
    <div class="card-body">
      <div class="card-loading"><div class="spinner"></div><span>Loading…</span></div>
    </div>`;

  // Wire buttons
  card.querySelectorAll('.card-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = (btn as HTMLElement).dataset.act;
    if (act === 'zoom-in') changeZoom(p.id, 1);
    else if (act === 'zoom-out') changeZoom(p.id, -1);
    else if (act === 'configure') openConfigureWorkspace(p, comp);
    else if (act === 'remove') removeCard(p.id);
    else if (act === 'reapply') reapplyCropOnCard(card);
    else if (act === 'uncrop') uncropCard(card);
  }));

  card.addEventListener('click', () => selectCard(p.id));

  // Drag to reposition
  setupDrag(card, p);

  // Embed content
  if (comp.type === 'WholeSite' || comp.type === 'Crop') {
    embedWebview(card, comp, zoom);
  } else {
    card.querySelector('.card-body')!.innerHTML = '<div class="clone-content">Listening for live data…</div>';
    // Send observe commands for Clone
    setTimeout(() => sendCloneObserve(comp), 1000);
  }
  return card;
}

function embedWebview(card: HTMLElement, comp: Component, zoom: number): void {
  const src = sources.find(s => s.id === comp.source_id); if (!src) return;
  const body = card.querySelector('.card-body')!;
  const wv = document.createElement('webview') as any;
  wv.setAttribute('src', src.entry_url);
  wv.setAttribute('partition', src.partition_key || `persist:${src.id}`);
  try { wv.setAttribute('preload', `file://${window.api.getWebviewPreloadPath()}`); } catch {}
  wv.style.cssText = 'width:100%;height:100%;';
  wv.addEventListener('dom-ready', () => {
    body.querySelector('.card-loading')?.remove();
    wv.setZoomFactor(zoom);
    if (comp.type === 'Crop') applyCropCss(wv, comp);
  });
  body.appendChild(wv);
}

async function applyCropCss(wv: any, comp: Component): Promise<void> {
  const sels = JSON.parse(comp.selectors || '[]');
  if (sels.length === 0) return;
  // Inject the agent first (it handles the crop command)
  await injectAgent(wv, 'crop-card');
  // Delay to let page finish dynamic loading, then apply crop
  // Agent will auto-retry at 2s, 5s, 10s if element not found yet
  setTimeout(() => {
    try { wv.send('agent-command', { cmd: 'applyCrop', cascade: sels[0] }); } catch {}
  }, 1500);
}

function reapplyCropOnCard(card: HTMLElement): void {
  const wv = card.querySelector('webview') as any;
  if (!wv) return;
  try { wv.send('agent-command', { cmd: 'reapplyCrop' }); } catch {}
  toast('Crop reapplied', 'info');
}

function uncropCard(card: HTMLElement): void {
  const wv = card.querySelector('webview') as any;
  if (!wv) return;
  try { wv.send('agent-command', { cmd: 'undoCrop' }); } catch {}
  toast('Uncropped — navigate the page, then ↻ to recrop', 'info');
}

function sendCloneObserve(comp: Component): void {
  const wv = sourceWebviews.get(comp.source_id); if (!wv) return;
  const sels = JSON.parse(comp.selectors || '[]');
  for (let i = 0; i < sels.length; i++) {
    try { wv.send('agent-command', { cmd: 'observe', stickerId: `${comp.id}:${i}`, cascade: sels[i] }); } catch {}
  }
}

// ═══ ZOOM ═══
function changeZoom(pid: string, dir: number): void {
  const cur = cardZooms.get(pid) ?? 1; const idx = ZOOM_LEVELS.findIndex(z => z >= cur);
  const ni = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, (idx < 0 ? 5 : idx) + dir));
  const nz = ZOOM_LEVELS[ni]; cardZooms.set(pid, nz);
  const card = document.getElementById(`card-${pid}`); if (!card) return;
  const wv = card.querySelector('webview') as any; if (wv?.setZoomFactor) wv.setZoomFactor(nz);
  const lbl = card.querySelector('.card-zoom-label'); if (lbl) lbl.textContent = `${Math.round(nz * 100)}%`;
}

// ═══ DRAG TO REPOSITION ═══
function setupDrag(card: HTMLElement, placement: Placement): void {
  const header = card.querySelector('.card-header') as HTMLElement; if (!header) return;
  let dragging = false, startX = 0, startY = 0, origCol = 0, origRow = 0;
  let preview: HTMLDivElement | null = null;

  function startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('.card-controls')) return;
    if (!designMode) return;
    dragging = true; startX = e.clientX; startY = e.clientY;
    origCol = placement.col; origRow = placement.row;
    card.classList.add('dragging');
    preview = document.createElement('div'); preview.className = 'drop-preview';
    document.getElementById('card-container')!.appendChild(preview);
    updatePreview(placement);
    e.preventDefault();
  }

  function onMove(e: MouseEvent): void {
    if (!dragging) return;
    const container = document.getElementById('card-container')!;
    const cellW = container.clientWidth / GRID_COLS;
    const dashboard = document.getElementById('dashboard')!;
    const cellH = dashboard.clientHeight / GRID_ROWS;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const dc = Math.round(dx / cellW), dr = Math.round(dy / cellH);
    placement.col = Math.max(0, Math.min(GRID_COLS - placement.col_span, origCol + dc));
    placement.row = Math.max(0, origRow + dr); // No upper limit on row — dashboard scrolls
    if (preview) updatePreview(placement);
    positionCard(card, placement);
  }

  function dropCard(): void {
    if (!dragging) return;
    dragging = false; card.classList.remove('dragging');
    preview?.remove(); preview = null;
    window.api?.upsertPlacement(placement);
    updateInspector();
    extendDashboard();
  }

  function cancelDrag(): void {
    if (!dragging) return;
    dragging = false; card.classList.remove('dragging');
    preview?.remove(); preview = null;
    placement.col = origCol; placement.row = origRow;
    positionCard(card, placement);
  }

  header.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', dropCard);

  // Keyboard: Enter/Space = park, Escape = cancel
  document.addEventListener('keydown', (e) => {
    if (!dragging) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dropCard(); }
    if (e.key === 'Escape') { cancelDrag(); }
  });

  function updatePreview(p: Placement): void {
    if (!preview) return;
    const container = document.getElementById('card-container')!;
    const cw = container.clientWidth / GRID_COLS;
    const dashboard = document.getElementById('dashboard')!;
    const ch = dashboard.clientHeight / GRID_ROWS;
    preview.style.cssText = `left:${p.col*cw}px;top:${p.row*ch}px;width:${p.col_span*cw-4}px;height:${p.row_span*ch-4}px;`;
  }
}

// ═══ CARD HELPERS ═══
function positionCard(card: HTMLElement, p: Placement): void {
  const container = document.getElementById('card-container')!;
  const cw = container.clientWidth / GRID_COLS;
  const dashboard = document.getElementById('dashboard')!;
  const ch = dashboard.clientHeight / GRID_ROWS;
  card.style.left = `${p.col * cw}px`; card.style.top = `${p.row * ch}px`;
  card.style.width = `${p.col_span * cw - 4}px`; card.style.height = `${p.row_span * ch - 4}px`;
}

/** Extend card-container height if any cards go beyond the initial 8-row viewport */
function extendDashboard(): void {
  const dashboard = document.getElementById('dashboard')!;
  const container = document.getElementById('card-container')!;
  const overlay = document.getElementById('grid-overlay')!;
  const baseH = dashboard.clientHeight;
  let maxBottom = baseH;
  const ch = baseH / GRID_ROWS;
  for (const p of placements) {
    const bottom = (p.row + p.row_span) * ch;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  const totalH = Math.max(baseH, maxBottom + 20);
  container.style.minHeight = `${totalH}px`;
  overlay.style.minHeight = `${totalH}px`;
}

// ═══ RECROP / UNCROP ALL ═══
function recropAll(): void {
  let count = 0;
  document.querySelectorAll('.card').forEach(card => {
    const compId = (card as HTMLElement).dataset.componentId;
    const comp = components.find(c => c.id === compId);
    if (comp?.type !== 'Crop') return;
    const wv = card.querySelector('webview') as any;
    if (!wv) return;
    try { wv.send('agent-command', { cmd: 'reapplyCrop' }); count++; } catch {}
  });
  toast(`Recrop applied to ${count} card${count !== 1 ? 's' : ''}`, 'info');
}

function uncropAll(): void {
  let count = 0;
  document.querySelectorAll('.card').forEach(card => {
    const compId = (card as HTMLElement).dataset.componentId;
    const comp = components.find(c => c.id === compId);
    if (comp?.type !== 'Crop') return;
    const wv = card.querySelector('webview') as any;
    if (!wv) return;
    try { wv.send('agent-command', { cmd: 'undoCrop' }); count++; } catch {}
  });
  toast(`Uncropped ${count} card${count !== 1 ? 's' : ''} — navigate then ↻ Recrop`, 'info');
}

function repositionAllCards(): void { placements.forEach(p => { const c = document.getElementById(`card-${p.id}`); if (c) positionCard(c, p); }); extendDashboard(); }

function selectCard(pid: string): void {
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  selectedCardId = pid;
  document.getElementById(`card-${pid}`)?.classList.add('selected');
  updateInspector();
}

function updateInspector(): void {
  const sec = document.getElementById('inspector-layout-section') as HTMLElement;
  if (!selectedCardId) { sec.style.display = 'none'; (document.getElementById('inspector-hint') as HTMLElement).textContent = 'Click a card to inspect'; return; }
  const p = placements.find(x => x.id === selectedCardId); if (!p) return;
  const comp = components.find(c => c.id === p.component_id);
  const src = sources.find(s => s.id === comp?.source_id);
  sec.style.display = '';
  (document.getElementById('inspector-hint') as HTMLElement).innerHTML = `
    <p style="font-weight:600;color:var(--fg-primary);margin-bottom:4px">${esc(comp?.title || '—')}</p>
    <p class="inspector-detail"><b>Type:</b> ${comp?.type}</p>
    <p class="inspector-detail"><b>Source:</b> ${esc(src?.name || '—')}</p>
    <p class="inspector-detail"><b>Zoom:</b> ${Math.round((cardZooms.get(p.id) ?? 1) * 100)}%</p>`;
  (document.getElementById('inp-col') as HTMLInputElement).value = String(p.col);
  (document.getElementById('inp-row') as HTMLInputElement).value = String(p.row);
  (document.getElementById('inp-colspan') as HTMLInputElement).value = String(p.col_span);
  (document.getElementById('inp-rowspan') as HTMLInputElement).value = String(p.row_span);
}

async function applyLayoutChanges(): Promise<void> {
  if (!selectedCardId) return; const p = placements.find(x => x.id === selectedCardId); if (!p) return;
  p.col = +((document.getElementById('inp-col') as HTMLInputElement).value) || 0;
  p.row = +((document.getElementById('inp-row') as HTMLInputElement).value) || 0;
  p.col_span = +((document.getElementById('inp-colspan') as HTMLInputElement).value) || 3;
  p.row_span = +((document.getElementById('inp-rowspan') as HTMLInputElement).value) || 2;
  await window.api.upsertPlacement(p);
  const card = document.getElementById(`card-${p.id}`); if (card) positionCard(card, p);
  toast('Layout updated', 'success');
}

async function removeCard(pid: string): Promise<void> {
  await window.api.deletePlacement(pid);
  placements = placements.filter(p => p.id !== pid);
  if (selectedCardId === pid) { selectedCardId = null; updateInspector(); }
  renderCards(); toast('Component removed', 'info');
}

function toggleMode(): void {
  designMode = !designMode; document.body.classList.toggle('view-mode', !designMode);
  (document.getElementById('mode-label') as HTMLElement).textContent = designMode ? 'Design' : 'View';
  (document.getElementById('mode-icon') as HTMLElement).textContent = designMode ? '✏️' : '👁️';
  (document.getElementById('status-mode') as HTMLElement).textContent = designMode ? 'Design' : 'View';
  toast(designMode ? 'Design mode — drag cards, see grid' : 'View mode — clean wallboard', 'info');
}

// ═══ CONFIGURE WORKSPACE ═══
function openConfigureWorkspace(p: Placement, comp: Component): void {
  const src = sources.find(s => s.id === comp.source_id); if (!src) return;
  const originalSelectors = comp.selectors; // Save for cancel/revert

  const overlay = document.createElement('div'); overlay.className = 'workspace-overlay';
  overlay.innerHTML = `
    <div class="workspace-toolbar">
      <span class="workspace-title">⚙ ${esc(comp.title)} — ${esc(src.name)}</span>
      <div class="workspace-controls">
        ${comp.type === 'Crop' ? '<button id="ws-pick" class="btn-primary">🎯 Pick Element to Crop</button>' : ''}
        <button id="ws-reload" class="btn-cancel">↻ Reload</button>
        <button id="ws-cancel" class="btn-cancel">✕ Cancel</button>
        <button id="ws-done" class="btn-primary">✓ Done</button>
      </div>
    </div>
    <div class="workspace-body"></div>
    <div class="workspace-status"><span id="ws-status">Loading ${esc(src.name)}…</span></div>`;
  document.body.appendChild(overlay);

  const wsBody = overlay.querySelector('.workspace-body')!;
  const wv = document.createElement('webview') as any;
  wv.setAttribute('src', src.entry_url);
  wv.setAttribute('partition', src.partition_key || `persist:${src.id}`);
  try { wv.setAttribute('preload', `file://${window.api.getWebviewPreloadPath()}`); } catch {}
  wv.style.cssText = 'width:100%;height:100%;';

  // Track if agent is injected (needed for re-injection on reload)
  let agentReady = false;

  wv.addEventListener('dom-ready', async () => {
    const s = document.getElementById('ws-status');
    if (s) s.textContent = `${src.name} — Ready`;
    agentReady = false;
    await injectAgent(wv, src.name);
    agentReady = true;
    if (s) s.textContent = `${src.name} — Ready (agent loaded)`;
  });

  wsBody.appendChild(wv);

  // Done = save changes and close
  overlay.querySelector('#ws-done')!.addEventListener('click', () => {
    overlay.remove(); renderCards();
    toast('Configuration saved', 'success');
  });

  // Cancel = revert changes and close
  overlay.querySelector('#ws-cancel')!.addEventListener('click', () => {
    comp.selectors = originalSelectors; // Revert
    window.api.upsertComponent(comp);
    overlay.remove(); renderCards();
    toast('Changes cancelled', 'info');
  });

  // Reload = reload page AND re-inject agent
  overlay.querySelector('#ws-reload')?.addEventListener('click', () => {
    wv.reload();
    agentReady = false;
    const s = document.getElementById('ws-status');
    if (s) s.textContent = 'Reloading… (agent will re-inject automatically)';
  });

  // Escape key closes workspace
  const onEscWorkspace = (e: KeyboardEvent) => {
    // Only close workspace on Escape if picker is NOT active
    // (picker handles its own Escape)
    if (e.key === 'Escape' && !pickingActive) {
      comp.selectors = originalSelectors;
      window.api.upsertComponent(comp);
      overlay.remove(); renderCards();
      document.removeEventListener('keydown', onEscWorkspace);
      toast('Closed without saving', 'info');
    }
  };
  document.addEventListener('keydown', onEscWorkspace);

  // Crop picker
  let pickingActive = false;
  const pickBtn = overlay.querySelector('#ws-pick') as HTMLButtonElement | null;
  if (pickBtn) {
    pickBtn.addEventListener('click', () => {
      if (!agentReady) { toast('Wait for page to finish loading', 'error'); return; }

      const s = document.getElementById('ws-status');
      if (s) s.textContent = '🎯 Hover to highlight · Click to lock · ↑↓←→ to navigate · Enter to confirm · Esc to cancel';
      pickBtn.disabled = true;
      pickBtn.textContent = '🎯 Picking… (hover → click → arrows → Enter)';
      pickingActive = true;

      // Enter picker mode in the webview
      wv.send('agent-command', { cmd: 'enterPick' });

      // CRITICAL: focus the webview so keyboard events reach the agent
      setTimeout(() => { try { wv.focus(); } catch {} }, 200);

      const handler = (ev: any) => {
        if (ev.channel !== 'agent-message') return;
        const msg = ev.args[0];

        if (msg.evt === 'picked') {
          wv.removeEventListener('ipc-message', handler);
          pickingActive = false;
          comp.selectors = JSON.stringify([msg.cascade]);
          window.api.upsertComponent(comp);
          pickBtn.disabled = false;
          pickBtn.textContent = '🎯 Pick Element to Crop';
          const cssExpr = msg.cascade?.find((s: any) => s.strategy === 'css')?.expression || '';
          const xpathExpr = msg.cascade?.find((s: any) => s.strategy === 'xpath')?.expression || '';
          if (s) s.textContent = `✓ Selected: css="${cssExpr}" · xpath="${xpathExpr}"`;
          toast(`Element selected: ${cssExpr}`, 'success');
          // Show crop preview
          wv.send('agent-command', { cmd: 'previewCrop', cascade: msg.cascade });
        }

        if (msg.evt === 'pickCancelled') {
          wv.removeEventListener('ipc-message', handler);
          pickingActive = false;
          pickBtn.disabled = false;
          pickBtn.textContent = '🎯 Pick Element to Crop';
          if (s) s.textContent = 'Pick cancelled — element not changed';
        }
      };
      wv.addEventListener('ipc-message', handler);
    });

    // Show existing selection when opening configure for a Crop with saved selectors
    wv.addEventListener('dom-ready', () => {
      setTimeout(() => {
        const sels = JSON.parse(comp.selectors || '[]');
        if (sels.length > 0 && comp.type === 'Crop') {
          const cssExpr = sels[0]?.find((s: any) => s.strategy === 'css')?.expression || '';
          const xpathExpr = sels[0]?.find((s: any) => s.strategy === 'xpath')?.expression || '';
          const s = document.getElementById('ws-status');
          if (s && cssExpr) s.textContent = `Current crop: css="${cssExpr}" · xpath="${xpathExpr}" — Click 🎯 to change`;
          // Highlight the current selection in the page
          wv.send('agent-command', { cmd: 'showSelection', cascade: sels[0] });
        }
      }, 1500); // Wait for agent to be injected
    });
  }

  // Clean up escape listener when overlay is removed
  const obs = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      document.removeEventListener('keydown', onEscWorkspace);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true });
}

// ═══ DIALOGS ═══
function showAddSourceDialog(): void {
  const overlay = document.createElement('div'); overlay.className = 'dialog-overlay';
  overlay.innerHTML = `<div class="dialog"><h2>Add Source</h2>
    <label>Name</label><input id="d-name" placeholder="e.g. SSI iBoard" autofocus />
    <label>URL</label><input id="d-url" placeholder="https://iboard.ssi.com.vn/" />
    <div class="dialog-actions"><button class="btn-cancel" id="d-no">Cancel</button><button class="btn-primary" id="d-yes">Add</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#d-no')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#d-yes')!.addEventListener('click', async () => {
    const name = (document.getElementById('d-name') as HTMLInputElement).value.trim();
    const url = (document.getElementById('d-url') as HTMLInputElement).value.trim();
    if (!name || !url) { toast('Name and URL required', 'error'); return; }
    const s: Source = { id: crypto.randomUUID(), name, entry_url: url, partition_key: `persist:${name.toLowerCase().replace(/\s+/g,'-')}`, auto_start: true };
    await window.api.upsertSource(s); sources.push(s); renderSources(); launchSource(s);
    toast(`Source "${name}" added`, 'success'); overlay.remove();
  });
}

function showAddComponentDialog(): void {
  if (!sources.length) { toast('Add a source first', 'error'); return; }
  const opts = sources.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const overlay = document.createElement('div'); overlay.className = 'dialog-overlay';
  overlay.innerHTML = `<div class="dialog"><h2>Add Component</h2>
    <label>Source</label><select id="d-src">${opts}</select>
    <label>Title</label><input id="d-title" placeholder="Auto from source name" />
    <label>Render Mode</label><select id="d-mode">
      <option value="WholeSite">🌐 WholeSite — full page in card</option>
      <option value="Crop">✂️ Crop — pick one element to show</option>
      <option value="Clone">📋 Clone — mirror live text data</option></select>
    <div class="dialog-actions"><button class="btn-cancel" id="d-no">Cancel</button><button class="btn-primary" id="d-yes">Create</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#d-no')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#d-yes')!.addEventListener('click', async () => {
    const srcId = (document.getElementById('d-src') as HTMLSelectElement).value;
    const title = (document.getElementById('d-title') as HTMLInputElement).value.trim() || sources.find(s => s.id === srcId)?.name || 'Component';
    const type = (document.getElementById('d-mode') as HTMLSelectElement).value as Component['type'];
    const comp: Component = { id: crypto.randomUUID(), title, type, source_id: srcId, selectors: '[]' };
    await window.api.upsertComponent(comp); components.push(comp); renderComponents();
    if (activeTabId) {
      const p: Placement = { id: crypto.randomUUID(), tab_id: activeTabId, component_id: comp.id, col: findFreeCol(), row: 0, col_span: type === 'WholeSite' ? 6 : 4, row_span: type === 'WholeSite' ? 4 : 3 };
      await window.api.upsertPlacement(p); placements.push(p); renderCards();
    }
    toast(`"${title}" created (${type})`, 'success'); overlay.remove();
    // Auto-open configure for Crop
    if (type === 'Crop' && activeTabId) {
      const lastP = placements[placements.length - 1];
      if (lastP) openConfigureWorkspace(lastP, comp);
    }
  });
}

// ═══ HELPERS ═══
function esc(t: string): string { const e = document.createElement('span'); e.textContent = t; return e.innerHTML; }
function findFreeCol(): number { let max = 0; placements.forEach(p => { const r = p.col + p.col_span; if (r > max) max = r; }); return max >= GRID_COLS ? 0 : max; }
