import './style.css';
import * as THREE from 'three';
import { createIfcViewer } from './viewer.js';
import { ElementInspector } from "./element-inspector.js";
import { setupModelPicker } from "./model-picker.js";
import { setupMappingWorkspace } from './mapping-workspace.js';
import { getAssetById, getMappingStatus } from './services/fobeApi.js';
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
const fragmentFallbackModels = new Set();
const dashboardIndexes = new Map();
let viewer;
let activeKey = null;
let cameraViews;
let switchGeneration = 0;
let conversionBusy = false;
let inspector;
let picker;
let mappingWorkspace;
let elementInfoGeneration = 0;

function refreshViewerLayout() {
  requestAnimationFrame(() => {
    if (!viewer) return;
    // SimpleRenderer also observes its container, but this keeps a drag and a
    // preset switch in lockstep with the canvas and camera aspect ratio.
    viewer.world.renderer.resize();
    viewer.world.camera.updateAspect();
    viewer.fragments.core.update(true);
  });
}

async function frameModel(model) {
  if (!model?.box || model.box.isEmpty()) return;
  const sphere = model.box.getBoundingSphere(new THREE.Sphere());
  // A modest margin keeps room edges and selected elements clear of the viewport.
  // Mapping uses a smaller viewport than Dashboard, so leave deliberate room
  // around the building rather than making the model press against its edges.
  sphere.radius *= 1.3;
  await viewer.world.camera.controls.fitToSphere(sphere, true);
  await viewer.fragments.core.update(true);
}


function status(message, state = 'ok') {
  const statusElement = byId('status');
  const statusDot = byId('status-dot');
  if (statusElement) statusElement.textContent = message;
  if (statusDot) statusDot.className = `dot ${state}`;
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
  refreshViewerLayout();
}

function setAppView(view) {
  const mapping = view === 'mapping';
  byId('app').classList.toggle('mapping-mode', mapping);
  byId('nav-dashboard').classList.toggle('active', !mapping);
  byId('nav-mapping').classList.toggle('active', mapping);
  if (mapping) void mappingWorkspace?.activate(inspector?.current);
  else mappingWorkspace?.deactivate();
  refreshViewerLayout();
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
    let model;
    try {
      const bytes = await bytesFrom(`${BASE_URL}fragments/${m.frag}`);
      model = await viewer.fragments.core.load(bytes, { modelId: m.key });
    } catch (fragmentError) {
      // A bad or version-incompatible pre-generated fragment must not make a
      // source IFC unavailable. The loaded source model remains read-only and
      // can later be exported through the existing converter flow.
      console.warn(`Fragment load failed for ${m.key}; loading source IFC instead.`, fragmentError);
      const sourceBytes = await bytesFrom(`${BASE_URL}models/${m.file}`);
      model = await viewer.ifcLoader.load(sourceBytes, false, m.key);
      fragmentFallbackModels.add(m.key);
    }
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
    await viewer.fragments.core.update(true);
    if (generation !== switchGeneration) return;
    await frameModel(model);
    if (generation !== switchGeneration) return;
    byId('active-state').textContent = 'Ready';
    byId('switch-time').textContent = `Switch: ${Math.round(performance.now() - start)} ms`;
    status(`${m.name} ready${fragmentFallbackModels.has(m.key) ? ' (source IFC fallback; regenerate its .frag)' : ''}`);
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
    const bytes = await bytesFrom(`${BASE_URL}models/${m.file}`);
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
    button.onclick = () => {
      void switchModel(m.key);
    };
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
  byId('nav-mapping').onclick = () => setAppView('mapping');
  byId('preload-btn').onclick = () => void preloadOthers();
  byId('reload-btn').onclick = () => void viewer?.fragments.core.update(true);
  try {
    viewer = await createIfcViewer(byId('viewer'));
    cameraViews = createCameraViews(viewer, () => cache.get(activeKey));
    document.querySelectorAll('.camera-view-btn').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await cameraViews.setView(button.dataset.view);
          document.querySelectorAll('.camera-view-btn').forEach(item => {
            item.classList.toggle('active', item === button);
          });
        } catch (error) {
          console.error('Failed to change camera view:', error);
          status('Unable to change camera view.', 'error');
        }
      });
    });
    inspector = new ElementInspector({

      onSelected: (element) => {
        const panel = byId("element-details");

        if (!panel) return;

        if (!element) {
          mappingWorkspace?.clearSelection();
          panel.replaceChildren();

          const message = document.createElement("p");
          message.textContent = "No element selected";
          panel.appendChild(message);
          return;
        }

        const infoGeneration = ++elementInfoGeneration;
        panel.replaceChildren();

        const heading = document.createElement("h3");
        heading.textContent = "Selected BIM Element";

        const modelInfo = document.createElement("p");
        modelInfo.textContent =
          `Model: ${element.modelId}`;

        const itemInfo = document.createElement("p");
        itemInfo.textContent =
          `Local ID: ${element.itemId}`;

        const globalIdInfo = document.createElement("p");
        globalIdInfo.textContent = `IFC GlobalId: ${element.ifcGlobalId || 'Not available in this model data'}`;

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
          globalIdInfo,
          properties
        );

        const mappingContainer = document.createElement('div');
        mappingContainer.className = 'element-mapping';
        const openWorkspace = document.createElement('button');
        openWorkspace.className = 'mapping-button';
        openWorkspace.textContent = 'Map this IFC element';
        openWorkspace.disabled = !element.ifcGlobalId;
        openWorkspace.addEventListener('click', () => setAppView('mapping'));
        mappingContainer.appendChild(openWorkspace);
        panel.appendChild(mappingContainer);
        mappingWorkspace?.setSelection(element);
        // Dashboard renders confirmed mapping data only; manual search and
        // mapping management live exclusively in the Asset Mapping view.
        void (async () => {
          let indexed = element;
          try {
            const model = cache.get(element.modelKey);
            if (model) {
              const index = dashboardIndexes.get(element.modelKey) || await buildIfcElementIndex(model, element.modelKey);
              dashboardIndexes.set(element.modelKey, index);
              indexed = index.elements.find(item => item.identity.globalId === element.ifcGlobalId) || element;
            }
          } catch (error) { console.warn('Dashboard IFC metadata unavailable', error); }
          if (infoGeneration !== elementInfoGeneration) return;
          const metadata = document.createElement('p');
          metadata.textContent = `IFC: ${indexed.name || 'Not available'} · ${indexed.ifcType || 'Not available'} · ObjectType: ${indexed.objectType || 'Not available'} · Tag: ${indexed.tag || 'Not available'} · Room: ${indexed.room?.name || 'Unknown'} (${indexed.roomSource || 'UNKNOWN'}) · Classification: ${indexed.candidate?.classification || 'Not available'}`;
          panel.appendChild(metadata);
          try {
            const mapping = await getMappingStatus({ modelKey: element.modelKey, globalId: element.ifcGlobalId });
            const asset = await getAssetById(mapping.itemit_item_id);
            if (infoGeneration !== elementInfoGeneration) return;
            const mapped = document.createElement('p');
            mapped.textContent = `Mapped itemit asset: ${asset.name || 'Unnamed'} · ${asset.id} · Serial: ${asset.serial || 'Not available'} · Location: ${asset.current_location || 'Not available'} · ${mapping.mapping_status}`;
            panel.appendChild(mapped);
          } catch (error) {
            if (infoGeneration !== elementInfoGeneration) return;
            const mapped = document.createElement('p');
            mapped.textContent = error.status === 404 ? 'Not Mapped' : 'Mapping status unavailable';
            panel.appendChild(mapped);
          }
        })();
      }
    });
    picker = setupModelPicker({
      viewer,
      getActiveModel: () => cache.get(activeKey),
      inspector
    });
    mappingWorkspace = setupMappingWorkspace({
      getModel: key => cache.get(key),
      ensureModel: async key => ensureLoaded(models.find(model => model.key === key)),
      selectIfcInViewer: async element => {
        const modelKey = element.identity?.modelKey || element.modelKey;
        if (!modelKey || element.sourceLocalId == null) return;
        if (activeKey !== modelKey) await switchModel(modelKey);
        const model = cache.get(modelKey);
        await picker?.select(model, element.sourceLocalId);
      },
      modelCatalog: models
    });
    status('3D engine initialized');
    const requestedModel = new URLSearchParams(window.location.search).get('model');
    await switchModel(models.some(model => model.key === requestedModel) ? requestedModel : 'building');
    // Load other models in the background; first-view responsiveness comes first.
    void preloadOthers();
  } catch (e) {
    console.error(e); overlay(`Viewer initialization failed: ${e.message}`); status(e.message, 'error');
  }
}
void start();
