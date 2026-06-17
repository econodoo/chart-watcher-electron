// This preload runs inside each <webview> (source page).
// It provides a message bridge between the source page's JS agent and the shell renderer.

import { ipcRenderer } from 'electron';

// Forward agent messages to the shell renderer via IPC
window.addEventListener('message', (event) => {
  // Only accept messages from the agent (same origin)
  if (event.source !== window) return;
  if (!event.data || !event.data.evt) return;

  // Forward to host (shell renderer)
  ipcRenderer.sendToHost('agent-message', event.data);
});

// Receive commands from the shell renderer
ipcRenderer.on('agent-command', (_event, command) => {
  // Forward to the page's agent
  window.postMessage(command, '*');
});

// Signal preload is ready
ipcRenderer.sendToHost('preload-ready');
