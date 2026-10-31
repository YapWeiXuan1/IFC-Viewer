import { buildIfcElementIndex } from './ifc-indexer.js';
import { createMapping, deleteMapping, getAssetById, getAssets, getMappingStatus, getMappings, updateMapping } from './services/fobeApi.js';

const PAGE_SIZE = 25;
const LOCATION_ALIASES = {
  'white-box': ['white box', 'whitebox', 'd108g'],
  'black-box': ['black box', 'blackbox', 'd108c'],
  'research-room': ['research room', 'd108b'],
  foyer: ['foyer']
};

const modelLocation = { white: 'white-box', black: 'black-box', research: 'research-room', foyer: 'foyer' };
const value = (item, fallback = 'Not available') => typeof item === 'string' && item.trim() ? item : fallback;
export function displayIfcName(element) {
  const raw = String(element?.name || '').trim();
  if (!raw) return 'Unnamed IFC element';
  const first = raw.split(':')[0].replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return first || raw;
}
function appendLine(parent, className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
}

// Native select popups are owned by the browser, so their width and height
// cannot be constrained reliably. This small adapter keeps the select as the
// source of truth for existing mapping/filter logic while presenting a
// viewport-aware listbox for the controls that need it.
function createViewportCombobox(select, { searchable = false } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'workspace-combobox';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'workspace-combobox-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', select.labels?.[0]?.textContent?.trim() || 'Choose an option');
  const label = document.createElement('span');
  label.className = 'workspace-combobox-label';
  const chevron = document.createElement('span');
  chevron.className = 'workspace-combobox-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';
  trigger.append(label, chevron);
  const menu = document.createElement('div');
  menu.className = 'workspace-combobox-menu';
  menu.id = `${select.id}-menu`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);

  select.classList.add('workspace-native-select');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.labels?.[0]?.addEventListener('click', event => {
    event.preventDefault();
    trigger.focus();
    if (menu.hidden) open();
  });
  select.after(wrapper);
  wrapper.appendChild(trigger);
  document.body.appendChild(menu);

  function options() { return [...select.options]; }
  function selectedOption() { return options().find(option => option.value === select.value) || options()[0]; }
  function sync() {
    const option = selectedOption();
    label.textContent = option?.textContent || 'No options available';
    label.title = option?.textContent || '';
    trigger.disabled = Boolean(select.disabled || !options().length);
  }
  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    const edge = 8;
    const below = window.innerHeight - rect.bottom - edge;
    const above = rect.top - edge;
    const openAbove = below < 160 && above > below;
    const available = Math.max(120, openAbove ? above : below);
    const width = Math.max(0, Math.min(rect.width, window.innerWidth - edge * 2));
    const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.min(280, available)}px`;
    menu.style.left = `${left}px`;
    menu.style.top = openAbove ? 'auto' : `${Math.min(window.innerHeight - edge, rect.bottom + 4)}px`;
    menu.style.bottom = openAbove ? `${Math.max(edge, window.innerHeight - rect.top + 4)}px` : 'auto';
    menu.classList.toggle('opens-upward', openAbove);
  }
  let filterQuery = '';
  let filterInput = null;
  function renderOptions(query = filterQuery) {
    filterQuery = query;
    menu.replaceChildren();
    if (searchable) {
      filterInput = document.createElement('input');
      filterInput.type = 'search';
      filterInput.className = 'workspace-combobox-filter';
      filterInput.placeholder = `Search ${trigger.getAttribute('aria-label')}`;
      filterInput.value = filterQuery;
      filterInput.setAttribute('aria-label', `Search ${trigger.getAttribute('aria-label')} options`);
      filterInput.addEventListener('input', event => {
        renderOptions(event.target.value);
        filterInput.focus();
      });
      menu.appendChild(filterInput);
    }
    const queryText = filterQuery.trim().toLocaleLowerCase();
    const matchingOptions = options().filter(option => !queryText || option.textContent.toLocaleLowerCase().includes(queryText));
    for (const option of matchingOptions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'workspace-combobox-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === select.value));
      item.disabled = option.disabled;
      item.title = option.textContent;
      const itemLabel = document.createElement('span');
      itemLabel.textContent = option.textContent;
      item.appendChild(itemLabel);
      item.addEventListener('click', () => {
        if (option.disabled) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        trigger.focus();
      });
      menu.appendChild(item);
    }
    if (!matchingOptions.length) {
      const empty = document.createElement('p');
      empty.className = 'workspace-combobox-empty';
      empty.textContent = 'No matching options.';
      menu.appendChild(empty);
    }
  }
  function focusOption(direction = 1) {
    const items = [...menu.querySelectorAll('.workspace-combobox-option:not(:disabled)')];
    if (!items.length) return;
    const selectedIndex = items.findIndex(item => item.getAttribute('aria-selected') === 'true');
    const index = selectedIndex < 0 ? (direction > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, selectedIndex + direction));
    items[index].focus();
  }
  function open(direction = 1) {
    if (trigger.disabled) return;
    filterQuery = '';
    renderOptions();
    positionMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (searchable) filterInput?.focus(); else focusOption(direction);
  }
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); open(-1); }
    if (event.key === 'Escape') close();
  });
  menu.addEventListener('keydown', event => {
    if (event.target === filterInput) {
      if (event.key === 'ArrowDown') { event.preventDefault(); menu.querySelector('.workspace-combobox-option:not(:disabled)')?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); [...menu.querySelectorAll('.workspace-combobox-option:not(:disabled)')].at(-1)?.focus(); }
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
      return;
    }
    const items = [...menu.querySelectorAll('.workspace-combobox-option:not(:disabled)')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1 + items.length) % items.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
    if (event.key === 'Tab') close();
  });
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target) && !menu.contains(event.target)) close();
  });
  window.addEventListener('resize', () => { if (!menu.hidden) positionMenu(); });
  window.addEventListener('scroll', () => { if (!menu.hidden) positionMenu(); }, true);
  select.addEventListener('change', sync);
  sync();
  return { sync, close };
}
function locationKey(location) {
  const normalized = String(location || '').toLocaleLowerCase();
  return Object.entries(LOCATION_ALIASES).find(([, aliases]) => aliases.some(alias => normalized.includes(alias)))?.[0] || 'other';
}

function identity(element) {
  const modelKey = element?.identity?.modelKey || element?.modelKey;
  const globalId = element?.identity?.globalId || element?.ifcGlobalId;
  return modelKey && globalId ? { modelKey, globalId } : null;
}

export function includesInIfcScope(element, scope, mappings = []) {
  const id = identity(element);
  const isMapped = id && mappings.some(mapping => mapping.model_key === id.modelKey && mapping.ifc_global_id === id.globalId);
  if (isMapped || scope === 'all') return true;
  if (scope === 'review') return element?.candidate?.classification !== 'BUILDING_COMPONENT';
  return element?.candidate?.classification === 'LIKELY_ASSET';
}

export function setupMappingWorkspace({ getModel, ensureModel, selectIfcInViewer, modelCatalog }) {
  const root = document.getElementById('mapping-workspace');
  const viewerSlot = document.getElementById('workspace-viewer-slot');
  const viewerCenter = document.querySelector('.center');
  const centerHome = document.createComment('BIM viewer home');
  const ifcSearch = document.getElementById('workspace-ifc-search');
  const ifcModel = document.getElementById('workspace-model');
  const ifcScope = document.getElementById('workspace-ifc-scope');
  const ifcList = document.getElementById('workspace-ifc-list');
  const assetQuery = document.getElementById('workspace-asset-query');
  const assetLocation = document.getElementById('workspace-asset-location');
  const assetCollection = document.getElementById('workspace-asset-collection');
  const assetStatus = document.getElementById('workspace-asset-status');
  const filterToggle = document.getElementById('workspace-filter-toggle');
  const filterPopover = document.getElementById('workspace-filter-popover');
  const filterCount = document.getElementById('workspace-filter-count');
  const activeFilters = document.getElementById('workspace-active-filters');
  const resetFilters = document.getElementById('workspace-reset-filters');
  const assetList = document.getElementById('workspace-asset-list');
  const count = document.getElementById('workspace-result-count');
  const previous = document.getElementById('workspace-previous');
  const nextPage = document.getElementById('workspace-next');
  const page = document.getElementById('workspace-page');
  const candidate = document.getElementById('workspace-candidate');
  const reviewIfc = document.getElementById('workspace-review-ifc');
  const detailsPane = candidate.closest('.workspace-details-pane');
  const assetsPane = assetList.closest('.workspace-assets-pane');
  const save = document.getElementById('workspace-save');
  const remove = document.getElementById('workspace-remove');
  const message = document.getElementById('workspace-message');
  const dropdowns = {};
  const state = { open: false, mode: 'single', generation: 0, indexes: new Map(), assets: null, mappings: [], mappingApiAvailable: false, selectedIfc: null, selectedAsset: null, page: 0, ifcVisibleLimit: 150, locationFilterSource: 'auto', batch: [], activeBatchKey: null };

  message.textContent = '';
  ifcScope.replaceChildren(
    new Option('Likely Assets', 'likely'),
    new Option('Include Needs Review', 'review'),
    new Option('All IFC Elements', 'all')
  );
  const modeControls = document.createElement('div');
  modeControls.className = 'workspace-batch-controls';
  const modeToggle = document.createElement('button'); modeToggle.type = 'button';
  const addToBatch = document.createElement('button'); addToBatch.type = 'button'; addToBatch.textContent = 'Add selected to batch';
  const clearBatch = document.createElement('button'); clearBatch.type = 'button'; clearBatch.textContent = 'Clear batch';
  const batchCount = document.createElement('span');
  const selectionIndicator = document.createElement('span'); selectionIndicator.className = 'workspace-selection-indicator';
  modeControls.append(modeToggle, addToBatch, clearBatch, batchCount, selectionIndicator);
  ifcList.before(modeControls);
  const assignButton = document.createElement('button');
  assignButton.type = 'button'; assignButton.className = 'workspace-assign-button'; assignButton.textContent = 'Assign to Selected IFC'; assignButton.disabled = true;
  assetList.after(assignButton);

  function batchKey(element) { const id = identity(element); return id && `${id.modelKey}:${id.globalId}`; }
  function batchEntry(element) { return state.batch.find(entry => entry.key === batchKey(element)); }
  function renderWorkspace() {
    root.dataset.mappingMode = state.mode;
    modeToggle.textContent = 'Single Mapping';
    modeToggle.classList.toggle('active', state.mode === 'single');
    addToBatch.hidden = false; clearBatch.hidden = false;
    addToBatch.classList.toggle('active', state.mode === 'batch');
    clearBatch.disabled = state.batch.length === 0;
    batchCount.textContent = state.mode === 'batch' ? `${state.batch.length} IFC element${state.batch.length === 1 ? '' : 's'} selected` : '';
    const searchHeading = assetsPane.querySelector('h3');
    if (searchHeading) searchHeading.textContent = 'Manual itemit Search';
    let subtitle = assetsPane.querySelector('.workspace-assignment-subtitle');
    if (!subtitle) { subtitle = document.createElement('p'); subtitle.className = 'workspace-assignment-subtitle'; searchHeading?.after(subtitle); }
    const activeEntry = state.batch.find(item => item.key === state.activeBatchKey);
    subtitle.hidden = !(state.mode === 'batch' && activeEntry);
    subtitle.textContent = activeEntry ? `Assigning to: ${displayIfcName(activeEntry.element)} · Tag ${activeEntry.element.tag || identity(activeEntry.element)?.globalId?.slice(-6) || 'not available'}` : '';
  }
  function addBatch(element) {
    const key = batchKey(element);
    if (!key || batchEntry(element)) return;
    state.batch.push({ key, element, asset: null, result: null });
    state.activeBatchKey ||= key;
    renderIfcList(); renderBatchQueue(); renderWorkspace();
  }
  function removeBatch(key) {
    state.batch = state.batch.filter(entry => entry.key !== key);
    if (state.activeBatchKey === key) state.activeBatchKey = state.batch[0]?.key || null;
    renderIfcList(); renderBatchQueue(); renderWorkspace();
  }
  modeToggle.addEventListener('click', () => { state.mode = 'single'; renderIfcList(); renderBatchQueue(); renderWorkspace(); });
  addToBatch.addEventListener('click', () => { state.mode = 'batch'; if (state.selectedIfc) addBatch(state.selectedIfc); else renderWorkspace(); });
  clearBatch.addEventListener('click', () => { state.batch = []; state.activeBatchKey = null; renderIfcList(); renderBatchQueue(); renderWorkspace(); });
  assignButton.addEventListener('click', () => {
    const entry = state.batch.find(item => item.key === state.activeBatchKey);
    if (!entry || !state.selectedAsset) return;
    const duplicate = state.batch.find(item => item.key !== entry.key && item.asset?.id === state.selectedAsset.id && identity(item.element)?.modelKey === identity(entry.element)?.modelKey);
    if (duplicate) { setMessage('That itemit asset is already proposed for another IFC element in this model.', 'error'); return; }
    entry.asset = state.selectedAsset; entry.result = null;
    const nextPending = state.batch.find(item => !item.asset);
    if (nextPending) { state.activeBatchKey = nextPending.key; state.selectedIfc = nextPending.element; state.selectedAsset = null; renderSelected(); }
    renderBatchQueue(); renderAssets(); renderWorkspace();
  });

  for (const model of modelCatalog) {
    const option = document.createElement('option');
    option.value = model.key;
    option.textContent = model.name;
    ifcModel.appendChild(option);
  }
  dropdowns.model = createViewportCombobox(ifcModel);
  dropdowns.ifcScope = createViewportCombobox(ifcScope);
  dropdowns.location = createViewportCombobox(assetLocation);
  dropdowns.collection = createViewportCombobox(assetCollection, { searchable: true });
  dropdowns.status = createViewportCombobox(assetStatus);
  document.body.appendChild(filterPopover);

  function positionFilterPopover() {
    const rect = filterToggle.getBoundingClientRect();
    const edge = 8;
    const width = Math.min(Math.max(320, rect.width * 4), window.innerWidth - edge * 2);
    const below = window.innerHeight - rect.bottom - edge;
    const above = rect.top - edge;
    const opensUpward = below < 250 && above > below;
    const available = Math.max(160, opensUpward ? above : below);
    filterPopover.style.width = `${width}px`;
    filterPopover.style.maxHeight = `${Math.min(300, available)}px`;
    filterPopover.style.left = `${Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge))}px`;
    filterPopover.style.top = opensUpward ? 'auto' : `${Math.min(window.innerHeight - edge, rect.bottom + 6)}px`;
    filterPopover.style.bottom = opensUpward ? `${Math.max(edge, window.innerHeight - rect.top + 6)}px` : 'auto';
    filterPopover.classList.toggle('opens-upward', opensUpward);
  }
  function closeFilterPopover({ restoreFocus = false } = {}) {
    if (filterPopover.hidden) return;
    filterPopover.hidden = true;
    filterToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) filterToggle.focus();
  }
  function openFilterPopover() {
    positionFilterPopover();
    filterPopover.hidden = false;
    filterToggle.setAttribute('aria-expanded', 'true');
    filterPopover.querySelector('.workspace-combobox-trigger')?.focus();
  }
  filterToggle.addEventListener('click', () => filterPopover.hidden ? openFilterPopover() : closeFilterPopover());
  filterToggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openFilterPopover(); }
    if (event.key === 'Escape') closeFilterPopover({ restoreFocus: true });
  });
  filterPopover.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeFilterPopover({ restoreFocus: true }); }
  });
  document.addEventListener('pointerdown', event => {
    if (!filterToggle.contains(event.target) && !filterPopover.contains(event.target) && !event.target.closest?.('.workspace-combobox-menu')) closeFilterPopover();
  });
  window.addEventListener('resize', () => { if (!filterPopover.hidden) positionFilterPopover(); });
  window.addEventListener('scroll', () => { if (!filterPopover.hidden) positionFilterPopover(); }, true);

  function active(generation, selectedIfc = state.selectedIfc) {
    return state.open && state.generation === generation && selectedIfc === state.selectedIfc;
  }
  function setMessage(text, tone = '') {
    message.textContent = text;
    message.className = `workspace-message ${tone}`.trim();
  }
  function currentIdentity() { return identity(state.selectedIfc); }
  function mappingForCurrent() {
    const key = currentIdentity();
    return key && state.mappings.find(item => item.model_key === key.modelKey && item.ifc_global_id === key.globalId);
  }
  function renderSelected() {
    const item = state.selectedIfc;
    const id = currentIdentity();
    if (!item || !id) {
      selectionIndicator.textContent = 'No IFC element selected';
      reviewIfc.textContent = 'Select an IFC element.';
      return;
    }
    selectionIndicator.textContent = `Selected: ${displayIfcName(item)}`;
    reviewIfc.replaceChildren();
    appendLine(reviewIfc, 'review-label', 'IFC element');
    appendLine(reviewIfc, 'review-name', displayIfcName(item));
    appendLine(reviewIfc, 'review-meta', `Model: ${id.modelKey}`);
    appendLine(reviewIfc, 'review-meta', `Mapping status: ${state.mappingApiAvailable ? (mappingForCurrent()?.mapping_status || 'Not mapped') : 'Mapping Status Unavailable'}`);
    appendLine(reviewIfc, 'review-meta', `Tag: ${value(item.tag || item.objectType || id.globalId.slice(-6))}`);
  }
  function renderBatchQueue() {
    let queue = detailsPane.querySelector('.workspace-batch-queue');
    if (!queue) { queue = document.createElement('section'); queue.className = 'workspace-batch-queue'; candidate.closest('.workspace-review').after(queue); }
    queue.replaceChildren();
    if (state.mode !== 'batch') { queue.hidden = true; return; }
    queue.hidden = false;
    const heading = document.createElement('h3'); heading.textContent = 'Selection Summary'; queue.appendChild(heading);
    const progress = document.createElement('p');
    progress.className = 'workspace-queue-progress';
    progress.textContent = `${state.batch.filter(entry => entry.asset).length} of ${state.batch.length} assigned`;
    queue.appendChild(progress);
    for (const [index, entry] of state.batch.entries()) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'workspace-batch-item';
      row.classList.toggle('selected', entry.key === state.activeBatchKey);
      const id = identity(entry.element);
      const identifier = entry.element.tag || entry.element.objectType || id?.globalId?.slice(-6) || 'No identifier';
      const existing = state.mappings.find(mapping => mapping.model_key === id?.modelKey && mapping.ifc_global_id === id?.globalId);
      const status = entry.result?.status || (entry.asset ? 'Assigned' : existing ? 'Already Mapped' : entry.key === state.activeBatchKey ? 'Active' : 'Pending');
      row.textContent = `${index + 1}. ${displayIfcName(entry.element)} · ${id?.modelKey || 'Unknown'} · ${identifier} — ${status}${entry.asset ? `: ${value(entry.asset.name)}` : ''}`;
      row.addEventListener('click', () => { state.activeBatchKey = entry.key; state.selectedIfc = entry.element; state.selectedAsset = entry.asset || null; renderSelected(); renderBatchQueue(); renderAssets(); assignButton.disabled = !state.selectedAsset; });
      const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'workspace-queue-remove'; removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', event => { event.stopPropagation(); if (window.confirm(`Remove ${displayIfcName(entry.element)} from this batch?`)) removeBatch(entry.key); });
      const line = document.createElement('div'); line.append(row, removeButton); queue.appendChild(line);
    }
  }
  function renderReview() {
    if (state.mode !== 'batch') return;
    reviewIfc.replaceChildren(); candidate.replaceChildren();
    const table = document.createElement('div'); table.className = 'workspace-batch-review';
    for (const entry of state.batch) {
      const row = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${displayIfcName(entry.element)} → ${value(entry.asset?.name, 'No itemit asset')} — ${entry.result?.status || (entry.asset ? 'Ready' : 'Pending')}`;
      const meta = document.createElement('p');
      meta.textContent = `IFC GlobalId: ${identity(entry.element)?.globalId || 'Unknown'} · Serial: ${value(entry.asset?.serial)} · Location: ${value(entry.asset?.current_location)}`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit pair'; edit.addEventListener('click', () => { state.activeBatchKey = entry.key; state.selectedIfc = entry.element; renderSelected(); renderBatchQueue(); renderAssets(); renderWorkspace(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remove pair'; remove.addEventListener('click', () => removeBatch(entry.key));
      row.append(summary, meta, edit, remove); table.appendChild(row);
    }
    reviewIfc.appendChild(table);
  }
  function renderIfcList() {
    ifcList.replaceChildren();
    const index = state.indexes.get(ifcModel.value);
    if (!index) { ifcList.textContent = 'Loading IFC elements…'; return; }
    const query = ifcSearch.value.trim().toLocaleLowerCase();
    const matching = index.elements.filter(element => [element.name, element.normalizedName, element.ifcType, element.identity.globalId]
      .filter(Boolean).some(field => String(field).toLocaleLowerCase().includes(query)));
    const filtered = matching.filter(element => includesInIfcScope(element, ifcScope.value, state.mappings));
    const elements = filtered.slice(0, state.ifcVisibleLimit);
    const countNote = document.createElement('p');
    countNote.className = 'workspace-list-note';
    countNote.textContent = `${filtered.length} filtered IFC elements.`;
    ifcList.appendChild(countNote);
    for (const element of elements) {
      const button = document.createElement('button');
      button.className = 'workspace-ifc-item';
      button.classList.toggle('selected', currentIdentity()?.globalId === element.identity.globalId && currentIdentity()?.modelKey === element.identity.modelKey);
      const content = document.createElement('span'); content.className = 'ifc-card-content';
      appendLine(content, 'list-row-title', displayIfcName(element));
      const identifier = element.tag || element.objectType || element.predefinedType || 'No distinguishing identifier';
      appendLine(content, 'list-row-meta', element.ifcType);
      appendLine(content, 'list-row-meta', `Tag: ${identifier}`);
      button.appendChild(content);
      const mapping = state.mappings.find(item => item.model_key === element.identity.modelKey && item.ifc_global_id === element.identity.globalId);
      const status = document.createElement('span'); status.className = 'list-row-status';
      status.textContent = state.mappingApiAvailable ? (mapping ? 'Mapped' : 'Not mapped') : 'Status unavailable';
      button.appendChild(status);
      button.disabled = !element.identity.globalId;
      button.addEventListener('click', () => {
        void selectIfc(element);
        void selectIfcInViewer(element);
      });
      {
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(batchEntry(element));
        checkbox.setAttribute('aria-label', `Add ${displayIfcName(element)} to batch`);
        checkbox.className = 'ifc-batch-checkbox';
        checkbox.addEventListener('click', event => event.stopPropagation());
        checkbox.addEventListener('change', () => { state.mode = 'batch'; checkbox.checked ? addBatch(element) : removeBatch(batchKey(element)); });
        button.prepend(checkbox);
      }
      ifcList.appendChild(button);
    }
    if (filtered.length > elements.length) {
      const more = document.createElement('button');
      more.className = 'secondary workspace-load-more';
      more.textContent = `Show 150 more (${filtered.length - elements.length} remaining)`;
      more.addEventListener('click', () => {
        state.ifcVisibleLimit += 150;
        renderIfcList();
      });
      ifcList.appendChild(more);
    }
    if (!elements.length) ifcList.textContent = 'No asset-oriented IFC elements match this search. Select “All IFC Elements” to inspect building elements.';
  }
  async function ensureIndex(modelKey) {
    if (state.indexes.has(modelKey)) return state.indexes.get(modelKey);
    const model = getModel(modelKey) || await ensureModel(modelKey);
    if (!model) throw new Error('Unable to load this BIM model.');
    const index = await buildIfcElementIndex(model, modelKey);
    state.indexes.set(modelKey, index);
    return index;
  }
  async function resolveIndexedElement(element) {
    const id = identity(element);
    if (!id) return element;
    try {
      const index = await ensureIndex(id.modelKey);
      return index.elements.find(item => item.identity.globalId === id.globalId) || element;
    } catch (error) {
      // Keep the stable identity usable for manual mapping, but do not invent
      // missing IFC metadata if the read-only index cannot be built.
      setMessage(`IFC metadata index unavailable: ${error.message}`, 'error');
      return element;
    }
  }
  async function loadIfcModel() {
    try {
      ifcList.textContent = 'Loading IFC elements…';
      await Promise.all([ensureIndex(ifcModel.value), ensureAssets()]);
      renderIfcList();
    } catch (error) { ifcList.textContent = error.message; }
  }
  function collectionValues(asset) {
    const raw = asset.collection || asset.collections;
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  }
  function populateFilters() {
    const selectedLocation = assetLocation.value;
    const selectedCollection = assetCollection.value;
    const locations = new Set(state.assets.map(asset => locationKey(asset.current_location)));
    assetLocation.replaceChildren(new Option('All locations', ''));
    for (const key of [...locations].sort()) assetLocation.add(new Option(key.replace('-', ' '), key));
    if ([...assetLocation.options].some(option => option.value === selectedLocation)) assetLocation.value = selectedLocation;
    const collections = new Set(state.assets.flatMap(collectionValues));
    assetCollection.replaceChildren(new Option(collections.size ? 'All Collections' : 'Collections unavailable from FOBE-API', ''));
    assetCollection.disabled = collections.size === 0;
    for (const name of [...collections].sort()) assetCollection.add(new Option(name, name));
    if ([...assetCollection.options].some(option => option.value === selectedCollection)) assetCollection.value = selectedCollection;
    dropdowns.location.sync();
    dropdowns.collection.sync();
  }
  async function ensureAssets() {
    if (!state.assets) state.assets = await getAssets({ limit: 500 });
    if (state.mappingApiAvailable) return;
    try {
      state.mappings = await getMappings();
      state.mappingApiAvailable = true;
    } catch (error) {
      // Inventory searching remains read-only and useful if an older API
      // process has not yet been restarted with Phase 2 mapping routes.
      state.mappings = [];
      state.mappingApiAvailable = false;
      setMessage(`Inventory loaded, but mapping status is unavailable: ${error.message}`, 'error');
    }
    populateFilters();
  }
  function candidateStatus(asset) {
    if (!state.mappingApiAvailable) return 'Mapping Status Unavailable';
    const statuses = state.mappings.filter(mapping => mapping.itemit_item_id === asset.id).map(mapping => mapping.mapping_status);
    return statuses.length ? [...new Set(statuses)].join(', ') : 'Unmapped';
  }
  function filteredAssets() {
    const query = assetQuery.value.trim().toLocaleLowerCase();
    return (state.assets || []).filter(asset => {
      if (query && ![asset.name, asset.serial].some(field => String(field || '').toLocaleLowerCase().includes(query))) return false;
      if (assetLocation.value && locationKey(asset.current_location) !== assetLocation.value) return false;
      if (assetCollection.value && !collectionValues(asset).includes(assetCollection.value)) return false;
      if (assetStatus.value && candidateStatus(asset) !== assetStatus.value) return false;
      return true;
    });
  }
  function selectedFilterLabel(control) {
    return control.options[control.selectedIndex]?.textContent || control.value;
  }
  function currentAssetFilters() {
    return [
      { control: assetLocation, dropdown: dropdowns.location, label: 'Location' },
      { control: assetCollection, dropdown: dropdowns.collection, label: 'Collection' },
      { control: assetStatus, dropdown: dropdowns.status, label: 'Status' }
    ].filter(entry => entry.control.value).map(entry => ({ ...entry, value: entry.control.value, text: selectedFilterLabel(entry.control) }));
  }
  function renderActiveFilters() {
    const filters = currentAssetFilters();
    filterCount.hidden = filters.length === 0;
    filterCount.textContent = String(filters.length);
    filterToggle.classList.toggle('has-active-filters', filters.length > 0);
    filterToggle.setAttribute('aria-label', filters.length ? `Filters, ${filters.length} active` : 'Filters');
    resetFilters.hidden = filters.length === 0;
    activeFilters.replaceChildren();
    for (const filter of filters) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'workspace-filter-chip';
      chip.title = `Remove ${filter.label}: ${filter.text}`;
      chip.setAttribute('aria-label', `Remove ${filter.label}: ${filter.text}`);
      chip.textContent = `${filter.label}: ${filter.text} ×`;
      chip.addEventListener('click', () => {
        filter.control.value = '';
        filter.dropdown.sync();
        if (filter.control === assetLocation) state.locationFilterSource = 'user';
        state.page = 0;
        renderAssets();
      });
      activeFilters.appendChild(chip);
    }
  }
  function renderAssets() {
    assetList.replaceChildren();
    const assets = filteredAssets();
    const totalPages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages - 1);
    const start = state.page * PAGE_SIZE;
    const pageAssets = assets.slice(start, start + PAGE_SIZE);
    renderActiveFilters();
    count.textContent = `${assets.length} search results`;
    page.textContent = `Page ${state.page + 1} of ${totalPages}`;
    previous.disabled = state.page === 0;
    nextPage.disabled = state.page >= totalPages - 1;
    for (const asset of pageAssets) {
      const button = document.createElement('button');
      button.className = 'workspace-asset-item';
      button.classList.toggle('selected', state.selectedAsset?.id === asset.id);
      appendLine(button, 'list-row-title', value(asset.name));
      appendLine(button, 'list-row-meta', `Serial: ${value(asset.serial)}`);
      appendLine(button, 'list-row-meta', `Location: ${value(asset.current_location)}`);
      appendLine(button, 'list-row-status', candidateStatus(asset));
      button.addEventListener('click', () => void selectAsset(asset.id));
      assetList.appendChild(button);
    }
    if (!pageAssets.length) assetList.textContent = 'No assets match the current filters.';
  }
  async function selectAsset(itemId) {
    const generation = state.generation;
    candidate.textContent = 'Loading itemit record…';
    try {
      const asset = await getAssetById(itemId);
      if (!active(generation)) return;
      state.selectedAsset = asset;
      candidate.replaceChildren();
      appendLine(candidate, 'review-label', 'itemit asset');
      for (const [label, field] of [['Name', asset.name], ['Serial', asset.serial], ['Location', asset.current_location], ['Collection', collectionValues(asset).join(', ')], ['Mapping status', candidateStatus(asset)], ['UUID', asset.id]]) {
        const line = document.createElement('p'); line.textContent = `${label}: ${value(field)}`; candidate.appendChild(line);
      }
      save.disabled = !currentIdentity();
      assignButton.disabled = state.mode !== 'batch' || !state.activeBatchKey;
      renderAssets();
      renderBatchQueue();
      renderWorkspace();
    } catch (error) { if (active(generation)) candidate.textContent = error.message; }
  }
  async function refreshCurrentMapping() {
    const selectedIfc = state.selectedIfc;
    const id = currentIdentity();
    if (!id) return;
    if (!state.mappingApiAvailable) {
      candidate.textContent = 'Mapping status cannot be retrieved. Restart FOBE-API with the Phase 2 mapping routes before creating or changing mappings.';
      remove.disabled = true;
      save.disabled = true;
      return;
    }
    const generation = state.generation;
    try {
      const mapping = await getMappingStatus(id);
      if (!active(generation, selectedIfc)) return;
      state.mappings = [
        ...state.mappings.filter(row => row.model_key !== id.modelKey || row.ifc_global_id !== id.globalId),
        mapping
      ];
      state.selectedAsset = await getAssetById(mapping.itemit_item_id);
      if (!active(generation, selectedIfc)) return;
      await selectAsset(state.selectedAsset.id);
      setMessage(`Existing mapping: ${mapping.mapping_status} via ${mapping.mapping_method}.`, 'success');
      remove.disabled = false;
      save.textContent = 'Confirm remap';
    } catch (error) {
      if (!active(generation, selectedIfc)) return;
      if (error.status === 404 && state.mappingApiAvailable) {
        state.selectedAsset = null; candidate.textContent = 'No current mapping. Select an asset to create a provisional mapping.';
        remove.disabled = true; save.textContent = 'Create provisional mapping'; save.disabled = true;
      } else setMessage(error.message, 'error');
    }
  }
  async function selectIfc(element) {
    state.generation += 1;
    const generation = state.generation;
    state.selectedIfc = element;
    const selectedIdentity = identity(element);
    if (selectedIdentity) {
      ifcModel.value = selectedIdentity.modelKey;
      dropdowns.model.sync();
    }
    state.selectedAsset = null;
    state.page = 0;
    state.ifcVisibleLimit = 150;
    renderSelected();
    renderIfcList();
    await ensureAssets();
    if (!active(generation, element)) return;
    renderSelected();
    renderIfcList();
    const suggested = modelLocation[selectedIdentity?.modelKey];
    if (state.locationFilterSource === 'auto' && suggested && [...assetLocation.options].some(option => option.value === suggested)) {
      assetLocation.value = suggested;
      dropdowns.location.sync();
    }
    renderAssets();
    await refreshCurrentMapping();
    renderWorkspace();
  }
  async function saveMapping() {
    if (state.mode === 'batch') return saveBatchMappings();
    const id = currentIdentity();
    if (!id || !state.selectedAsset?.id) return;
    if (!state.mappingApiAvailable) {
      setMessage('Mapping writes are disabled because mapping status could not be verified.', 'error');
      return;
    }
    const existing = mappingForCurrent();
    const action = existing ? 'replace the current mapping' : 'create this mapping';
    if (!window.confirm(`Confirm ${action}?\n\nIFC: ${id.modelKey}:${id.globalId}\nitemit asset: ${state.selectedAsset.name || state.selectedAsset.id} (${state.selectedAsset.id})`)) return;
    save.disabled = true;
    try {
      if (existing) await updateMapping({ modelKey: id.modelKey, globalId: id.globalId, changes: { itemit_item_id: state.selectedAsset.id, mapping_status: 'PROVISIONAL', mapping_method: 'MANUAL' } });
      else await createMapping({ model_key: id.modelKey, ifc_global_id: id.globalId, itemit_item_id: state.selectedAsset.id, mapping_status: 'PROVISIONAL', mapping_method: 'MANUAL' });
      state.mappings = await getMappings();
      renderAssets();
      await refreshCurrentMapping();
      setMessage('Mapping saved and revalidated.', 'success');
      remove.disabled = false;
    } catch (error) { setMessage(error.message, 'error'); }
    finally { save.disabled = false; }
  }
  async function saveBatchMappings() {
    if (!state.mappingApiAvailable) { setMessage('Batch writes are disabled because mapping status could not be verified.', 'error'); return; }
    const pending = state.batch.filter(entry => entry.asset && entry.result?.status !== 'Success');
    if (!pending.length) return;
    if (!window.confirm(`Confirm ${pending.length} independent mapping write${pending.length === 1 ? '' : 's'}? Successful writes cannot be rolled back as a batch.`)) return;
    save.disabled = true;
    for (const entry of pending) {
      const id = identity(entry.element);
      try {
        const existing = state.mappings.find(row => row.model_key === id.modelKey && row.ifc_global_id === id.globalId);
        if (existing) await updateMapping({ modelKey: id.modelKey, globalId: id.globalId, changes: { itemit_item_id: entry.asset.id, mapping_status: 'PROVISIONAL', mapping_method: 'MANUAL' } });
        else await createMapping({ model_key: id.modelKey, ifc_global_id: id.globalId, itemit_item_id: entry.asset.id, mapping_status: 'PROVISIONAL', mapping_method: 'MANUAL' });
        entry.result = { status: 'Success' };
      } catch (error) {
        entry.result = { status: error.status === 409 ? 'Conflict' : 'Failed', message: error.message };
      }
    }
    try { state.mappings = await getMappings(); } catch { /* preserve per-pair results */ }
    save.disabled = false;
    renderReview(); renderBatchQueue(); renderAssets();
    setMessage('Batch submission finished. Failed or conflicting pairs remain available for correction.', 'success');
  }
  async function removeMapping() {
    const id = currentIdentity();
    if (!id || !window.confirm('Remove this IFC-to-itemit mapping?')) return;
    try {
      await deleteMapping(id); state.mappings = await getMappings(); state.selectedAsset = null;
      candidate.textContent = 'Mapping removed. Select an asset to create a new mapping.'; remove.disabled = true; save.disabled = true;
      renderAssets(); setMessage('Mapping removed.', 'success');
    } catch (error) { setMessage(error.message, 'error'); }
  }
  async function activate(element = null) {
    if (viewerCenter.parentNode !== viewerSlot) {
      viewerCenter.before(centerHome);
      viewerSlot.appendChild(viewerCenter);
    }
    state.open = true;
    root.classList.remove('hidden');
    if (element) await selectIfc(await resolveIndexedElement(element)); else await loadIfcModel();
    renderWorkspace();
  }
  function deactivate() {
    state.open = false;
    state.generation += 1;
    closeFilterPopover();
    root.classList.add('hidden');
    if (centerHome.parentNode) centerHome.replaceWith(viewerCenter);
  }
  function clearSelection() {
    state.generation += 1;
    state.selectedIfc = null;
    state.selectedAsset = null;
    if (state.open) {
      renderSelected();
      candidate.textContent = 'Choose a 3D element or IFC list entry.';
      save.disabled = true;
      remove.disabled = true;
      renderWorkspace();
    }
  }

  ifcSearch.addEventListener('input', () => { state.ifcVisibleLimit = 150; renderIfcList(); });
  ifcModel.addEventListener('change', () => {
    state.generation += 1;
    state.selectedIfc = null;
    state.selectedAsset = null;
    state.page = 0;
    state.ifcVisibleLimit = 150;
    state.batch = state.batch.filter(entry => identity(entry.element)?.modelKey === ifcModel.value);
    state.activeBatchKey = state.batch[0]?.key || null;
    renderSelected();
    candidate.textContent = 'Choose an IFC element from the selected model.';
    save.disabled = true;
    remove.disabled = true;
    setMessage('Choose an IFC element from the selected model before creating a mapping.');
    void loadIfcModel();
    renderBatchQueue();
    renderWorkspace();
  });
  ifcScope.addEventListener('change', () => { state.ifcVisibleLimit = 150; renderIfcList(); });
  assetQuery.addEventListener('input', () => { state.page = 0; renderAssets(); });
  assetLocation.addEventListener('change', () => { state.locationFilterSource = 'user'; state.page = 0; renderAssets(); });
  [assetCollection, assetStatus].forEach(control => control.addEventListener('change', () => { state.page = 0; renderAssets(); }));
  resetFilters.addEventListener('click', () => {
    assetLocation.value = '';
    assetCollection.value = ''; assetStatus.value = '';
    dropdowns.location.sync();
    dropdowns.collection.sync();
    dropdowns.status.sync();
    state.locationFilterSource = 'user'; state.page = 0; renderAssets();
  });
  previous.addEventListener('click', () => { state.page -= 1; renderAssets(); });
  nextPage.addEventListener('click', () => { state.page += 1; renderAssets(); });
  save.addEventListener('click', () => void saveMapping());
  remove.addEventListener('click', () => void removeMapping());
  return {
    activate,
    deactivate,
    clearSelection,
    setSelection: element => {
      if (!state.open) return;
      void resolveIndexedElement(element).then(indexed => selectIfc(indexed));
    }
  };
}
