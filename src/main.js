import './style.css';
import { createIfcViewer } from './viewer.js';
import { ElementInspector } from "./element-inspector.js";
import { setupModelPicker } from "./model-picker.js";
import { createCameraViews } from './camera-views.js';
const BASE_URL = import.meta.env.BASE_URL;

const models = [
  { key: 'building', name: 'Building Overview', file: 'building.ifc', frag: 'building.frag', glyph: '▦' },
  { key: 'foyer', name: 'Foyer', file: 'foyer.ifc', frag: 'foyer.frag', glyph: '⌂' },
  { key: 'black', name: 'Black Room', file: 'black-room.ifc', frag: 'black-room.frag', glyph: '▣' },
  { key: 'white', name: 'White Room', file: 'white-room.ifc', frag: 'white-room.frag', glyph: '□' },
  { key: 'research', name: 'Research Room', file: 'research-room.ifc', frag: 'research-room.frag', glyph: '◇' },
];
const byId = id => document.getElementById(id);
const cache = new Map();
const pending = new Map();
const conversions = new Map();
let viewer;
let activeKey = null;
let cameraViews;
let switchGeneration = 0;
let conversionBusy = false;
let inspector;
let picker;

function status(message, state = 'ok') {
  const statusElement = byId('status');
  const statusDot = byId('status-dot');

  if (statusElement) {
    statusElement.textContent = message;
  }

  if (statusDot) {
    statusDot.className = `dot ${state}`;
  }

  if (state === 'error') {
    console.error('[BIM Studio]', message);
  } else {
    console.log('[BIM Studio]', message);
  }
}
function overlay(message) {
  byId('viewer-overlay').textContent = message || '';
  byId('viewer-overlay').classList.toggle('hidden', !message);
}
function updateCacheInfo() {
  byId('cache-info').textContent = `${cache.size} / ${models.length} models cached`;
}
function updateNavigation() {
  for (const m of models) {
    const el = byId(`nav-${m.key}`);
    el.classList.toggle('active', m.key === activeKey);
    el.querySelector('.model-sub').textContent = cache.has(m.key) ? 'Cached · ready' : pending.has(m.key) ? 'Loading…' : 'Not loaded';
  }
}
function setActiveTab(name) {
  byId('properties-pane').classList.toggle('hidden', name !== 'properties');
  byId('converter-pane').classList.toggle('hidden', name !== 'converter');
  byId('tab-properties').classList.toggle('active', name === 'properties');
  byId('tab-converter').classList.toggle('active', name === 'converter');
}
async function bytesFrom(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function ensureLoaded(m) {
  if (cache.has(m.key)) return cache.get(m.key);
  if (pending.has(m.key)) return pending.get(m.key);
  const task = (async () => {
    const bytes = await bytesFrom(
      `${BASE_URL}fragments/${m.frag}`
    );
    const model = await viewer.fragments.core.load(bytes, { modelId: m.key });
    cache.set(m.key, model);
    model.object.visible = m.key === activeKey;
    updateCacheInfo();
    return model;
  })();
  pending.set(m.key, task);
  updateNavigation();
  try { return await task; } finally { pending.delete(m.key); updateNavigation(); }
}
async function switchModel(key) {
  const m = models.find(item => item.key === key);
  if (!m) return;
  const generation = ++switchGeneration;
  const start = performance.now();
  byId('active-title').textContent = m.name;
  byId('active-state').textContent = 'Loading…';
  overlay(`Loading ${m.name}…`);
  try {
    const model = await ensureLoaded(m);
    if (generation !== switchGeneration) return;
    if (picker) {
      await picker.clearSelection();
    }

    if (generation !== switchGeneration) return;

    activeKey = key;

    for (const [k, item] of cache) {
      item.object.visible = k === key;
    }
    if (cameraViews) {
      await cameraViews.setView('iso');
    }
    document.querySelectorAll(
      '.camera-view-btn'
    ).forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.view === 'iso'
      );
    });
    await viewer.fragments.core.update(true);
    if (generation !== switchGeneration) return;
    byId('active-state').textContent = 'Ready';
    byId('switch-time').textContent = `Switch: ${Math.round(performance.now() - start)} ms`;
    status(`${m.name} ready`);
    overlay(null);
    updateNavigation();
  } catch (e) {
    console.error(e);
    if (generation !== switchGeneration) return;
    byId('active-state').textContent = 'Unavailable';
    overlay(`${m.name} is unavailable. Convert its IFC and copy ${m.frag} to public/fragments/.`);
    status(e.message, 'error');
  }
}
async function preloadOthers() {
  for (const m of models) {
    if (m.key === activeKey || cache.has(m.key)) continue;
    try { await ensureLoaded(m); } catch (e) { console.warn(`Preload skipped ${m.name}:`, e.message); }
  }
  status('Background preload finished');
}
async function convertModel(m) {
  if (conversionBusy) return;
  conversionBusy = true;
  const label = byId(`convert-result-${m.key}`);
  const btn = byId(`convert-${m.key}`);
  btn.disabled = true;
  label.textContent = 'Reading IFC and converting…';
  status(`Converting ${m.name}…`);
  try {
    const bytes = await bytesFrom(
      `${BASE_URL}models/${m.file}`
    );
    // Use a separate ID to avoid collision with the cached production model.
    const conversionId = `conversion-${m.key}`;
    const converted = await viewer.ifcLoader.load(bytes, false, conversionId);
    converted.object.visible = false;
    const buffer = await converted.getBuffer(false);
    conversions.set(m.key, buffer);
    byId(`download-${m.key}`).disabled = false;
    label.textContent = `Converted successfully · ${(buffer.byteLength / 1048576).toFixed(1)} MB · ready to download`;
    status(`${m.name} converted`);
  } catch (e) {
    console.error(e);
    label.textContent = `Conversion failed: ${e.message}`;
    status(e.message, 'error');
  } finally { btn.disabled = false; conversionBusy = false; }
}
function downloadModel(m) {
  const buffer = conversions.get(m.key);
  if (!buffer) return;
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = m.frag; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderControls() {
  const list = byId('model-list');
  const converters = byId('converter-list');
  for (const m of models) {
    const button = document.createElement('button');
    button.className = 'model-button'; button.id = `nav-${m.key}`;
    button.innerHTML = `<span class="model-glyph">${m.glyph}</span><span><span class="model-name">${m.name}</span><span class="model-sub" style="display:block">Not loaded</span></span>`;
    button.onclick = () => switchModel(m.key);
    list.appendChild(button);
    const card = document.createElement('div'); card.className = 'convert-card';
    card.innerHTML = `<strong>${m.name}</strong><small>${m.file} → ${m.frag}</small><div class="actions"><button id="convert-${m.key}">Convert IFC</button><button class="secondary" id="download-${m.key}" disabled>Download .frag</button></div><span class="result" id="convert-result-${m.key}">Not converted this session</span>`;
    converters.appendChild(card);
    byId(`convert-${m.key}`).onclick = () => convertModel(m);
    byId(`download-${m.key}`).onclick = () => downloadModel(m);
  }
}
async function start() {
  renderControls();
  byId('tab-properties').onclick = () => setActiveTab('properties');
  byId('tab-converter').onclick = () => setActiveTab('converter');
  byId('preload-btn').onclick = () => void preloadOthers();
  byId('reload-btn').onclick = () => void viewer?.fragments.core.update(true);
  try {
    viewer = await createIfcViewer(byId('viewer'));

    cameraViews = createCameraViews(
      viewer,
      () => cache.get(activeKey)
    );

    document.querySelectorAll(
      ".camera-view-btn"
    ).forEach(button => {

      button.addEventListener("click", async () => {
        const direction = button.dataset.view;

        try {
          await cameraViews.setView(direction);

          document.querySelectorAll(
            ".camera-view-btn"
          ).forEach(item => {
            item.classList.remove("active");
          });

          button.classList.add("active");

        } catch (error) {
          console.error(
            "Failed to change camera view:",
            error
          );
        }
      });

    });

    inspector = new ElementInspector({

      onSelected: (element) => {
        const panel = byId("element-details");

        if (!panel) return;

        if (!element) {
          panel.replaceChildren();

          const message = document.createElement("p");
          message.textContent = "No element selected";
          panel.appendChild(message);
          return;
        }

        panel.replaceChildren();

        const heading = document.createElement("h3");
        heading.textContent = "Selected BIM Element";

        const modelInfo = document.createElement("p");
        modelInfo.textContent =
          `Model: ${element.modelId}`;

        const itemInfo = document.createElement("p");
        itemInfo.textContent =
          `Local ID: ${element.itemId}`;

        const properties = document.createElement("pre");
        properties.textContent = JSON.stringify(
          element.properties,
          null,
          2
        );

        panel.append(
          heading,
          modelInfo,
          itemInfo,
          properties
        );
      }
    });
    picker = setupModelPicker({
      viewer,
      getActiveModel: () => cache.get(activeKey),
      inspector
    });
    status('3D engine initialized');
    const params = new URLSearchParams(
      window.location.search
    );

    const requestedKey = params.get('model');

    const initialKey = models.some(
      model => model.key === requestedKey
    )
      ? requestedKey
      : 'building';

    await switchModel(initialKey);
    // Load other models in the background; first-view responsiveness comes first.
    void preloadOthers();
  } catch (e) {
    console.error(e); overlay(`Viewer initialization failed: ${e.message}`); status(e.message, 'error');
  }
}
void start();
