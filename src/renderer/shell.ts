// ═══ Chart Watcher Shell ═══
// Runs in the renderer process. Communicates with main via window.api (preload bridge).
// Types defined in ../types.d.ts

interface Source { id: string; name: string; entry_url: string; partition_key: string; auto_start: boolean; }
interface Component { id: string; title: string; type: 'WholeSite' | 'Crop' | 'Clone'; source_id: string; selectors: string; }
interface Tab { id: string; workspace_id: string; name: string; sort_order: number; grid_cols: number; grid_rows: number; }
interface Placement { id: string; tab_id: string; component_id: string; col: number; row: number; col_span: number; row_span: number; }

// ── State ──
let sources: Source[] = [];
let components: Component[] = [];
let tabs: Tab[] = [];
let activeTabId: string = '';
let placements: Placement[] = [];
let selectedCardId: string | null = null;
let designMode = true;

const GRID_COLS = 12;
const GRID_ROWS = 8;
const THEMES = ['colorful', 'stealth', 'colorblind'];
let currentThemeIdx = 0;

// ── DOM refs ──
const $ = (sel: string) => document.querySelector(sel)!;
const $$ = (sel: string) => document.querySelectorAll(sel);

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load data
  sources = await window.api.getSources();
  components = await window.api.getComponents();
  tabs = await window.api.getTabs();

  // Load saved theme
  const savedTheme = await window.api.getSetting('theme');
  if (savedTheme) {
    currentThemeIdx = THEMES.indexOf(savedTheme);
    if (currentThemeIdx < 0) currentThemeIdx = 0;
    applyTheme(THEMES[currentThemeIdx]);
  }

  // Render UI
  renderSources();
  renderComponents();
  renderTabs();

  // Select first tab
  if (tabs.length > 0) {
    await selectTab(tabs[0].id);
  }

  // Wire toolbar
  $('#btn-add-source').addEventListener('click', showAddSourceDialog);
  $('#btn-add-component').addEventListener('click', showAddComponentDialog);
  $('#btn-toggle-mode').addEventListener('click', toggleMode);
  $('#btn-toggle-left').addEventListener('click', () => $('#left-panel').classList.toggle('collapsed'));
  $('#btn-toggle-right').addEventListener('click', () => $('#right-panel').classList.toggle('collapsed'));
  $('#btn-add-tab').addEventListener('click', addTab);
  $('#btn-apply-layout').addEventListener('click', applyLayoutChanges);
  $('#btn-delete-card').addEventListener('click', deleteSelectedCard);

  // Theme selector
  const themeSelect = $('#theme-select') as HTMLSelectElement;
  themeSelect.value = THEMES[currentThemeIdx];
  themeSelect.addEventListener('change', () => {
    currentThemeIdx = THEMES.indexOf(themeSelect.value);
    applyTheme(themeSelect.value);
    window.api.setSetting('theme', themeSelect.value);
  });

  // Main process events
  window.api.onCycleTheme(() => {
    currentThemeIdx = (currentThemeIdx + 1) % THEMES.length;
    applyTheme(THEMES[currentThemeIdx]);
    themeSelect.value = THEMES[currentThemeIdx];
    window.api.setSetting('theme', THEMES[currentThemeIdx]);
  });

  window.api.onReloadSources(() => reloadAllSources());

  // Clock
  setInterval(() => {
    ($('#status-clock') as HTMLElement).textContent = new Date().toLocaleTimeString();
  }, 1000);

  // Grid resize
  window.addEventListener('resize', () => repositionAllCards());

  // Launch sources
  for (const src of sources) {
    if (src.auto_start) launchSource(src);
  }

  console.log(`[Shell] Initialized: ${sources.length} sources, ${components.length} components, ${tabs.length} tabs`);
});

// ═══ THEME ═══

function applyTheme(name: string): void {
  const link = $('#theme-link') as HTMLLinkElement;
  link.href = `styles/${name}.css`;
}

// ═══ SOURCES ═══

function renderSources(): void {
  const list = $('#source-list');
  list.innerHTML = '';
  for (const src of sources) {
    const el = document.createElement('div');
    el.className = 'source-item';
    el.innerHTML = `
      <span class="status-dot" data-source-id="${src.id}"></span>
      <span class="source-name">${esc(src.name)}</span>
    `;
    list.appendChild(el);
  }
  renderStatusDots();
}

function renderStatusDots(): void {
  const dotsContainer = $('#status-dots');
  dotsContainer.innerHTML = '';
  for (const src of sources) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.dataset.sourceId = src.id;
    dot.title = src.name;
    dotsContainer.appendChild(dot);
  }
}

function updateSourceStatus(sourceId: string, status: 'ready' | 'loading' | 'error' | 'stale'): void {
  document.querySelectorAll(`.status-dot[data-source-id="${sourceId}"]`).forEach(dot => {
    dot.className = `status-dot ${status}`;
  });
}

// ═══ WEBVIEW SOURCE MANAGEMENT ═══

const sourceWebviews = new Map<string, HTMLElement>();

function launchSource(src: Source): void {
  if (sourceWebviews.has(src.id)) return;

  const host = $('#webview-host');
  const wv = document.createElement('webview');
  wv.setAttribute('src', src.entry_url);
  wv.setAttribute('partition', src.partition_key || `persist:${src.id}`);
  wv.setAttribute('preload', `file://${getPreloadPath('webview-preload.js')}`);
  wv.setAttribute('webpreferences', 'contextIsolation=yes');
  wv.style.width = '1px';
  wv.style.height = '1px';

  wv.addEventListener('dom-ready', () => {
    updateSourceStatus(src.id, 'ready');
    injectAgent(wv);
    console.log(`[Source] ${src.name} loaded`);
  });

  wv.addEventListener('did-fail-load', () => {
    updateSourceStatus(src.id, 'error');
    console.error(`[Source] ${src.name} failed to load`);
  });

  // Listen for agent messages (via preload IPC bridge)
  wv.addEventListener('ipc-message', (event: any) => {
    if (event.channel === 'agent-message') {
      handleAgentMessage(src.id, event.args[0]);
    }
    if (event.channel === 'preload-ready') {
      console.log(`[Source] ${src.name} preload ready`);
    }
  });

  host.appendChild(wv);
  sourceWebviews.set(src.id, wv);
  updateSourceStatus(src.id, 'loading');
}

function injectAgent(wv: HTMLElement): void {
  // Read and inject the agent script
  const agentCode = getAgentCode();
  (wv as any).executeJavaScript(agentCode).catch((err: Error) => {
    console.error('[Agent] Injection failed:', err);
  });
}

function getAgentCode(): string {
  // The compiled agent code — loaded inline for simplicity
  // In production, read from dist/agent/chartwatch-agent.js
  return `
    // Agent will be loaded via preload bridge
    console.log('[ChartWatch Agent] Ready');
  `;
}

function getPreloadPath(filename: string): string {
  // Resolve preload path relative to dist
  const basePath = window.location.pathname.replace('/renderer/index.html', '');
  return basePath + '/preload/' + filename;
}

function sendToSource(sourceId: string, command: Record<string, any>): void {
  const wv = sourceWebviews.get(sourceId);
  if (!wv) return;
  (wv as any).send('agent-command', command);
}

function reloadAllSources(): void {
  for (const [id, wv] of sourceWebviews) {
    (wv as any).reload();
    updateSourceStatus(id, 'loading');
  }
}

// ═══ AGENT MESSAGE ROUTING ═══

function handleAgentMessage(sourceId: string, msg: any): void {
  switch (msg.evt) {
    case 'ready':
      updateSourceStatus(sourceId, 'ready');
      break;
    case 'mutation':
      routeMutation(sourceId, msg.stickerId, msg.html, msg.innerText);
      break;
    case 'stale':
      updateSourceStatus(sourceId, 'stale');
      break;
    case 'picked':
      handlePicked(sourceId, msg);
      break;
  }
}

function routeMutation(sourceId: string, stickerId: string, html: string, innerText: string): void {
  // Find cards bound to this source and update
  document.querySelectorAll(`.card[data-source-id="${sourceId}"]`).forEach(card => {
    const body = card.querySelector('.clone-content');
    if (body) {
      body.textContent = innerText || html;
    }
    const dot = card.querySelector('.card-status');
    if (dot) dot.className = 'card-status ready';
  });

  ($('#status-mutation') as HTMLElement).textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ═══ COMPONENTS ═══

function renderComponents(): void {
  const list = $('#component-list');
  list.innerHTML = '';
  for (const comp of components) {
    const el = document.createElement('div');
    el.className = 'component-item';
    el.innerHTML = `
      <span class="icon">${comp.type === 'WholeSite' ? '🌐' : comp.type === 'Crop' ? '✂️' : '📋'}</span>
      <span class="component-name">${esc(comp.title)}</span>
    `;
    list.appendChild(el);
  }
}

// ═══ TABS ═══

function renderTabs(): void {
  const tabList = $('#tab-list');
  tabList.innerHTML = '';
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
    el.textContent = tab.name;
    el.addEventListener('click', () => selectTab(tab.id));
    tabList.appendChild(el);
  }
}

async function selectTab(tabId: string): Promise<void> {
  activeTabId = tabId;
  placements = await window.api.getPlacements(tabId);
  renderTabs();
  renderCards();
}

async function addTab(): Promise<void> {
  const name = prompt('Tab name:', `Tab ${tabs.length + 1}`);
  if (!name) return;

  const tab: Tab = {
    id: crypto.randomUUID(),
    workspace_id: tabs[0]?.workspace_id || '',
    name,
    sort_order: tabs.length,
    grid_cols: GRID_COLS,
    grid_rows: GRID_ROWS,
  };

  // Save tab (would need IPC handler — simplified)
  tabs.push(tab);
  await selectTab(tab.id);
}

// ═══ CARDS ═══

function renderCards(): void {
  const container = $('#card-container');
  container.innerHTML = '';

  const emptyState = $('#empty-state') as HTMLElement;
  emptyState.style.display = placements.length === 0 ? 'flex' : 'none';

  for (const p of placements) {
    const comp = components.find(c => c.id === p.component_id);
    if (!comp) continue;

    const card = createCard(p, comp);
    container.appendChild(card);
    positionCard(card, p);
  }
}

function createCard(placement: Placement, comp: Component): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = `card-${placement.id}`;
  card.dataset.placementId = placement.id;
  card.dataset.componentId = comp.id;
  card.dataset.sourceId = comp.source_id;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${esc(comp.title)}</span>
      <span class="card-status"></span>
    </div>
    <div class="card-body">
      ${getCardContent(comp)}
    </div>
  `;

  card.addEventListener('click', () => selectCard(placement.id));

  // WholeSite: create webview inside card
  if (comp.type === 'WholeSite') {
    const src = sources.find(s => s.id === comp.source_id);
    if (src) {
      const body = card.querySelector('.card-body')!;
      body.innerHTML = '';
      const wv = document.createElement('webview');
      wv.setAttribute('src', src.entry_url);
      wv.setAttribute('partition', src.partition_key || `persist:${src.id}`);
      wv.style.width = '100%';
      wv.style.height = '100%';
      wv.addEventListener('dom-ready', () => {
        const dot = card.querySelector('.card-status');
        if (dot) dot.className = 'card-status ready';
      });
      body.appendChild(wv);
    }
  }

  return card;
}

function getCardContent(comp: Component): string {
  switch (comp.type) {
    case 'Clone':
      return '<div class="clone-content">Waiting for data...</div>';
    case 'Crop':
      return '<div class="placeholder">Crop view</div>';
    default:
      return '<div class="placeholder">Loading...</div>';
  }
}

function positionCard(card: HTMLElement, p: Placement): void {
  const container = $('#card-container') as HTMLElement;
  const W = container.clientWidth;
  const H = container.clientHeight;
  const cellW = W / GRID_COLS;
  const cellH = H / GRID_ROWS;

  card.style.left = `${p.col * cellW}px`;
  card.style.top = `${p.row * cellH}px`;
  card.style.width = `${p.col_span * cellW - 4}px`;
  card.style.height = `${p.row_span * cellH - 4}px`;
}

function repositionAllCards(): void {
  for (const p of placements) {
    const card = document.getElementById(`card-${p.id}`);
    if (card) positionCard(card, p);
  }
}

function selectCard(placementId: string): void {
  // Deselect previous
  $$('.card.selected').forEach(c => c.classList.remove('selected'));

  selectedCardId = placementId;
  const card = document.getElementById(`card-${placementId}`);
  card?.classList.add('selected');

  // Update inspector
  const p = placements.find(pl => pl.id === placementId);
  if (p) {
    (document.getElementById('inp-row') as HTMLInputElement).value = String(p.row);
    (document.getElementById('inp-col') as HTMLInputElement).value = String(p.col);
    (document.getElementById('inp-rowspan') as HTMLInputElement).value = String(p.row_span);
    (document.getElementById('inp-colspan') as HTMLInputElement).value = String(p.col_span);

    const comp = components.find(c => c.id === p.component_id);
    ($('#inspector-content') as HTMLElement).innerHTML = `
      <p><strong>${esc(comp?.title || '—')}</strong></p>
      <p class="dim">${comp?.type || '—'} · Source: ${sources.find(s => s.id === comp?.source_id)?.name || '—'}</p>
    `;
  }
}

async function applyLayoutChanges(): Promise<void> {
  if (!selectedCardId) return;
  const p = placements.find(pl => pl.id === selectedCardId);
  if (!p) return;

  p.row = parseInt((document.getElementById('inp-row') as HTMLInputElement).value) || 0;
  p.col = parseInt((document.getElementById('inp-col') as HTMLInputElement).value) || 0;
  p.row_span = parseInt((document.getElementById('inp-rowspan') as HTMLInputElement).value) || 2;
  p.col_span = parseInt((document.getElementById('inp-colspan') as HTMLInputElement).value) || 3;

  await window.api.upsertPlacement(p);

  const card = document.getElementById(`card-${p.id}`);
  if (card) positionCard(card, p);
}

async function deleteSelectedCard(): Promise<void> {
  if (!selectedCardId) return;
  if (!confirm('Delete this component placement?')) return;

  await window.api.deletePlacement(selectedCardId);
  placements = placements.filter(p => p.id !== selectedCardId);
  selectedCardId = null;
  renderCards();
}

// ═══ MODE ═══

function toggleMode(): void {
  designMode = !designMode;
  document.body.classList.toggle('view-mode', !designMode);
  ($('#mode-label') as HTMLElement).textContent = designMode ? 'Design' : 'View';
  ($('#mode-icon') as HTMLElement).textContent = designMode ? '✏️' : '👁️';
  ($('#status-mode') as HTMLElement).textContent = designMode ? 'Design' : 'View';
}

// ═══ DIALOGS ═══

function showAddSourceDialog(): void {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h2>Add Source</h2>
      <label>Name</label>
      <input id="dlg-source-name" placeholder="e.g., SSI iBoard" />
      <label>URL</label>
      <input id="dlg-source-url" placeholder="https://iboard.ssi.com.vn/" />
      <div class="dialog-actions">
        <button class="btn-cancel" id="dlg-cancel">Cancel</button>
        <button class="btn-primary" id="dlg-ok">Add Source</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#dlg-cancel')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#dlg-ok')!.addEventListener('click', async () => {
    const name = (document.getElementById('dlg-source-name') as HTMLInputElement).value.trim();
    const url = (document.getElementById('dlg-source-url') as HTMLInputElement).value.trim();
    if (!name || !url) return;

    const src: Source = {
      id: crypto.randomUUID(),
      name,
      entry_url: url,
      partition_key: `persist:${name.toLowerCase().replace(/\s+/g, '-')}`,
      auto_start: true,
    };

    await window.api.upsertSource(src);
    sources.push(src);
    renderSources();
    launchSource(src);
    overlay.remove();
  });
}

function showAddComponentDialog(): void {
  if (sources.length === 0) {
    alert('Add a source first.');
    return;
  }

  const sourceOptions = sources.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h2>Add Component</h2>
      <label>Source</label>
      <select id="dlg-comp-source">${sourceOptions}</select>
      <label>Title</label>
      <input id="dlg-comp-title" placeholder="e.g., SSI Full Board" />
      <label>Render Mode</label>
      <select id="dlg-comp-mode">
        <option value="WholeSite">WholeSite (full page)</option>
        <option value="Crop">Crop (isolate element)</option>
        <option value="Clone">Clone (mirror data)</option>
      </select>
      <div class="dialog-actions">
        <button class="btn-cancel" id="dlg-cancel">Cancel</button>
        <button class="btn-primary" id="dlg-ok">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#dlg-cancel')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#dlg-ok')!.addEventListener('click', async () => {
    const sourceId = (document.getElementById('dlg-comp-source') as HTMLSelectElement).value;
    const title = (document.getElementById('dlg-comp-title') as HTMLInputElement).value.trim()
      || sources.find(s => s.id === sourceId)?.name || 'Component';
    const type = (document.getElementById('dlg-comp-mode') as HTMLSelectElement).value as Component['type'];

    const comp: Component = {
      id: crypto.randomUUID(),
      title,
      type,
      source_id: sourceId,
      selectors: '[]',
    };

    await window.api.upsertComponent(comp);
    components.push(comp);
    renderComponents();

    // Auto-place on current tab
    if (activeTabId) {
      const placement: Placement = {
        id: crypto.randomUUID(),
        tab_id: activeTabId,
        component_id: comp.id,
        col: 0, row: 0,
        col_span: type === 'WholeSite' ? 6 : 3,
        row_span: type === 'WholeSite' ? 4 : 2,
      };

      await window.api.upsertPlacement(placement);
      placements.push(placement);
      renderCards();
    }

    overlay.remove();
  });
}

// ═══ PICKER ═══

let pickerResolve: ((cascade: any[] | null) => void) | null = null;

function handlePicked(sourceId: string, msg: any): void {
  if (pickerResolve) {
    pickerResolve(msg.cascade);
    pickerResolve = null;
  }
}

// ═══ HELPERS ═══

function esc(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

function uuid(): string {
  return crypto.randomUUID();
}
