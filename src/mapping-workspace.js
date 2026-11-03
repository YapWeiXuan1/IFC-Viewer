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
  return node;
}

// Native select popups are owned by the browser, so their width and height
// cannot be constrained reliably. This small adapter keeps the select as the
// source of truth for existing mapping/filter logic while presenting a
// viewport-aware listbox for the controls that need it.
function createViewportCombobox(select, { searchable = false, maxMenuHeight = 280 } = {}) {
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
  chevron.textContent = '▾';
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
    menu.style.maxHeight = `${Math.min(maxMenuHeight, available)}px`;
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

export function getBatchProgress(batch = []) {
  const assigned = batch.filter(entry => entry.asset?.id).length;
  const conflicts = batch.filter(entry => entry.result?.status === 'Conflict').length;
  return { total: batch.length, assigned, pending: batch.length - assigned, conflicts };
}

export function findBatchAssetConflict(batch = [], assetId, exceptKey = null) {
  if (!assetId) return null;
  return batch.find(entry => entry.key !== exceptKey && entry.asset?.id === assetId) || null;
}

export function nextUnassignedBatchEntry(batch = [], afterKey = null) {
  if (!batch.length) return null;
  const start = Math.max(0, batch.findIndex(entry => entry.key === afterKey));
  for (let offset = 1; offset <= batch.length; offset += 1) {
    const entry = batch[(start + offset) % batch.length];
    if (!entry.asset?.id) return entry;
  }
  return null;
}

export function validateBatchProposals(batch = []) {
  const errors = [];
  const ifcKeys = new Set();
  const assetIds = new Set();
  for (const entry of batch) {
    if (!entry?.key || ifcKeys.has(entry.key)) errors.push('Each submitted IFC element must have a unique model key and GlobalId.');
    ifcKeys.add(entry?.key);
    const assetId = entry?.asset?.id;
    if (!assetId) continue;
    if (assetIds.has(assetId)) errors.push('Each submitted itemit asset UUID must be assigned to only one IFC element.');
    assetIds.add(assetId);
  }
  return [...new Set(errors)];
}

export function resolveOverviewElementToRoom(element, roomIndexes = []) {
  const globalId = identity(element)?.globalId;
  if (!globalId) return null;
  const matches = roomIndexes
    .map(index => index?.elements?.find(candidate => candidate.identity?.globalId === globalId))
    .filter(Boolean);
  return matches.length === 1 ? matches[0] : null;
}

export function includesInIfcScope(element, scope, mappings = []) {
  const id = identity(element);
  const isMapped = id && mappings.some(mapping => mapping.model_key === id.modelKey && mapping.ifc_global_id === id.globalId);
  if (isMapped || scope === 'all') return true;
  if (scope === 'review') return element?.candidate?.classification !== 'BUILDING_COMPONENT';
  return element?.candidate?.classification === 'LIKELY_ASSET';
}

export function setupMappingWorkspace({ getModel, ensureModel, selectIfcInViewer, focusIfcInViewer, modelCatalog }) {
  const root = document.getElementById('mapping-workspace');
  const viewerSlot = document.getElementById('workspace-viewer-slot');
  const viewerCenter = document.querySelector('.center');
  const centerHome = document.createComment('BIM viewer home');
  const ifcSearch = document.getElementById('workspace-ifc-search');
  const ifcModel = document.getElementById('workspace-model');
  const ifcScope = document.getElementById('workspace-ifc-scope');
  const ifcStatus = document.getElementById('workspace-ifc-status');
  const ifcFilterToggle = document.getElementById('workspace-ifc-filter-toggle');
  const ifcFilterPopover = document.getElementById('workspace-ifc-filter-popover');
  const ifcFilterCount = document.getElementById('workspace-ifc-filter-count');
  const resetIfcFilters = document.getElementById('workspace-ifc-reset-filters');
  const applyIfcFilters = document.getElementById('workspace-ifc-filter-apply');
  const ifcList = document.getElementById('workspace-ifc-list');
  const ifcResultCount = document.getElementById('workspace-ifc-result-count');
  const assetQuery = document.getElementById('workspace-asset-query');
  const assetLocation = document.getElementById('workspace-asset-location');
  const assetCollection = document.getElementById('workspace-asset-collection');
  const assetStatus = document.getElementById('workspace-asset-status');
  const filterToggle = document.getElementById('workspace-filter-toggle');
  const filterPopover = document.getElementById('workspace-filter-popover');
  const filterCount = document.getElementById('workspace-filter-count');
  const activeFilters = document.getElementById('workspace-active-filters');
  const resetFilters = document.getElementById('workspace-reset-filters');
  const applyFilters = document.getElementById('workspace-filter-apply');
  const assetList = document.getElementById('workspace-asset-list');
  const count = document.getElementById('workspace-result-count');
  const previous = document.getElementById('workspace-previous');
  const nextPage = document.getElementById('workspace-next');
  const page = document.getElementById('workspace-page');
  const pagination = page.closest('.workspace-pagination');
  const candidate = document.getElementById('workspace-candidate');
  const reviewIfc = document.getElementById('workspace-review-ifc');
  const detailsPane = candidate.closest('.workspace-details-pane');
  const assetsPane = assetList.closest('.workspace-assets-pane');
  const save = document.getElementById('workspace-save');
  const remove = document.getElementById('workspace-remove');
  const message = document.getElementById('workspace-message');
  const mappingActions = detailsPane.querySelector('.workspace-actions');
  mappingActions.before(message);
  const dropdowns = {};
  const state = { open: false, mode: 'single', generation: 0, indexes: new Map(), assets: null, mappings: [], mappingApiAvailable: false, selectedIfc: null, selectedAsset: null, page: 0, ifcVisibleLimit: 150, locationFilterSource: 'auto', batch: [], activeBatchKey: null, batchReviewOpen: false, visibleIfcElements: [], filteredIfcElements: [], filteredIfcTotal: 0 };

  message.textContent = '';
  ifcScope.replaceChildren(
    new Option('Likely Assets', 'likely'),
    new Option('Include Needs Review', 'review'),
    new Option('All IFC Elements', 'all')
  );
  const modeControls = document.createElement('div');
  modeControls.className = 'workspace-batch-controls';
  const modeLabel = document.createElement('span'); modeLabel.className = 'workspace-mode-label'; modeLabel.textContent = 'Mapping mode';
  const modeToggle = document.createElement('button'); modeToggle.type = 'button'; modeToggle.textContent = 'Single';
  const batchModeToggle = document.createElement('button'); batchModeToggle.type = 'button'; batchModeToggle.textContent = 'Batch';
  modeControls.append(modeLabel, modeToggle, batchModeToggle);
  const batchToolbar = document.createElement('section'); batchToolbar.className = 'workspace-batch-toolbar'; batchToolbar.hidden = true;
  const batchToolbarHeader = document.createElement('div'); batchToolbarHeader.className = 'workspace-batch-toolbar-header';
  const batchToolbarTitle = document.createElement('strong'); batchToolbarTitle.textContent = 'Batch selection';
  const batchSelectionCount = document.createElement('span'); batchSelectionCount.className = 'workspace-batch-selection-count';
  batchToolbarHeader.append(batchToolbarTitle, batchSelectionCount);
  const batchToolbarActions = document.createElement('div'); batchToolbarActions.className = 'workspace-batch-toolbar-actions';
  const selectVisibleLabel = document.createElement('label'); selectVisibleLabel.className = 'workspace-select-visible';
  const selectVisible = document.createElement('input'); selectVisible.type = 'checkbox'; selectVisible.className = 'workspace-select-visible-checkbox';
  const selectVisibleText = document.createElement('span'); selectVisibleText.textContent = 'Select all';
  selectVisibleLabel.append(selectVisible, selectVisibleText);
  const clearBatch = document.createElement('button'); clearBatch.type = 'button'; clearBatch.className = 'secondary workspace-batch-clear'; clearBatch.textContent = 'Clear';
  batchToolbarActions.append(selectVisibleLabel, clearBatch);
  batchToolbar.append(batchToolbarHeader, batchToolbarActions);
  ifcList.before(modeControls, batchToolbar);
  const assignButton = document.createElement('button');
  assignButton.type = 'button'; assignButton.className = 'workspace-assign-button'; assignButton.textContent = 'Assign & Next'; assignButton.disabled = true;
  const assetFooter = document.createElement('div'); assetFooter.className = 'workspace-asset-footer';
  assetList.after(assetFooter);
  assetFooter.append(pagination, assignButton);

  function batchKey(element) { const id = identity(element); return id && `${id.modelKey}:${id.globalId}`; }
  function batchEntry(element) {
    const id = identity(element);
    return state.batch.find(entry => entry.key === batchKey(element)
      || (id?.modelKey === 'building' && entry.element?.overviewSource?.modelKey === 'building' && entry.element.overviewSource.globalId === id.globalId));
  }
  function eligibleBatchElements(elements = state.visibleIfcElements) {
    return elements.filter(element => Boolean(batchKey(element)));
  }
  function renderBatchToolbar(elements = state.filteredIfcElements) {
    const eligible = eligibleBatchElements(elements);
    const selected = eligible.filter(element => Boolean(batchEntry(element))).length;
    batchToolbar.hidden = state.mode !== 'batch';
    selectVisible.disabled = eligible.length === 0;
    selectVisible.checked = eligible.length > 0 && selected === eligible.length;
    selectVisible.indeterminate = selected > 0 && selected < eligible.length;
    batchSelectionCount.textContent = `${state.batch.length} selected · ${eligible.length} filtered · ${state.filteredIfcTotal} total`;
    clearBatch.disabled = state.batch.length === 0;
  }
  async function setVisibleBatchSelection(elements, selected) {
    const eligible = eligibleBatchElements(elements);
    if (selected) {
      const additions = await Promise.all(eligible
        .filter(element => !batchEntry(element))
        .map(element => resolveIndexedElement(element)));
      for (const element of additions) {
        const key = batchKey(element);
        if (key && !batchEntry(element)) state.batch.push({ key, element, asset: null, result: null });
      }
      state.activeBatchKey ||= state.batch[0]?.key || null;
    } else {
      const visibleKeys = new Set(eligible.map(batchKey));
      state.batch = state.batch.filter(entry => !visibleKeys.has(entry.key));
      if (!state.batch.some(entry => entry.key === state.activeBatchKey)) state.activeBatchKey = state.batch[0]?.key || null;
    }
    renderIfcList(); renderBatchQueue(); renderWorkspace();
  }
  function viewerTarget(element) {
    if (!element?.overviewSource) return element;
    return {
      ...element,
      sourceLocalId: element.overviewSource.sourceLocalId,
      identity: { ...element.identity, modelKey: element.overviewSource.modelKey }
    };
  }
  function focusActiveIfc(element) {
    return Promise.resolve(focusIfcInViewer?.(viewerTarget(element)));
  }
  function batchConflict(assetId, exceptKey = state.activeBatchKey) { return findBatchAssetConflict(state.batch, assetId, exceptKey); }
  function batchReservationLabel(entry) {
    const id = identity(entry?.element);
    const tag = entry?.element?.tag || entry?.element?.objectType || id?.globalId?.slice(-6) || 'not available';
    return `Already assigned in this batch · Tag ${tag}`;
  }
  function renderCandidate(asset = state.selectedAsset) {
    candidate.replaceChildren();
    if (!asset?.id) { candidate.textContent = 'Select an itemit asset.'; return; }
    appendLine(candidate, 'review-label', 'itemit asset');
    appendLine(candidate, 'review-name', value(asset.name));
    const metadata = document.createElement('span'); metadata.className = 'review-summary-fields';
    for (const [label, field] of [['Serial', asset.serial], ['Location', asset.current_location], ['Mapping status', candidateStatus(asset)]]) {
      appendLine(metadata, 'review-meta', `${label}: ${value(field)}`);
    }
    candidate.appendChild(metadata);
    const persisted = state.mappings.find(mapping => mapping.itemit_item_id === asset.id);
    if (persisted) appendLine(candidate, 'review-linked-ifc', linkedIfcLabel(persisted));
  }
  function activateBatchEntry(entry, { focus = false } = {}) {
    if (!entry) return;
    state.activeBatchKey = entry.key;
    state.selectedIfc = entry.element;
    state.selectedAsset = entry.asset || null;
    renderCandidate(); renderSelected(); renderBatchQueue(); renderAssets(); renderWorkspace();
    assignButton.disabled = !state.selectedAsset;
    if (focus) void focusActiveIfc(entry.element).catch(error => console.warn('Unable to focus the active batch IFC element.', error));
  }
  function renderWorkspace() {
    root.dataset.mappingMode = state.mode;
    modeToggle.classList.toggle('active', state.mode === 'single');
    batchModeToggle.classList.toggle('active', state.mode === 'batch');
    renderBatchToolbar();
    save.textContent = state.mode === 'batch' ? 'Submit batch mappings' : (mappingForCurrent() ? 'Confirm remap' : 'Create provisional mapping');
    const searchHeading = assetsPane.querySelector('h3');
    let subtitle = assetsPane.querySelector('.workspace-assignment-subtitle');
    if (!subtitle) { subtitle = document.createElement('p'); subtitle.className = 'workspace-assignment-subtitle'; searchHeading?.after(subtitle); }
    const activeEntry = state.batch.find(item => item.key === state.activeBatchKey);
    subtitle.hidden = true;
    subtitle.textContent = '';
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
    if (state.activeBatchKey === key) {
      const next = state.batch.find(entry => !entry.asset?.id) || state.batch[0] || null;
      state.activeBatchKey = next?.key || null;
      if (next) activateBatchEntry(next, { focus: true });
    }
    renderIfcList(); renderBatchQueue(); renderWorkspace();
  }
  modeToggle.addEventListener('click', async () => {
    state.mode = 'single';
    renderIfcList(); renderBatchQueue(); renderWorkspace();
    if (!state.selectedIfc) return;
    try {
      await focusActiveIfc(state.selectedIfc);
      const selectedKey = batchKey(state.selectedIfc);
      ifcList.querySelectorAll('.workspace-ifc-item').forEach(item => {
        if (item.dataset.ifcKey === selectedKey) item.focus({ preventScroll: false });
      });
    } catch (error) {
      console.warn('Unable to focus the selected IFC element.', error);
    }
  });
  batchModeToggle.addEventListener('click', () => {
    state.mode = 'batch';
    renderIfcList(); renderBatchQueue(); renderWorkspace();
  });
  selectVisible.addEventListener('change', () => void setVisibleBatchSelection(state.filteredIfcElements, selectVisible.checked));
  clearBatch.addEventListener('click', () => {
    if (state.batch.length && !window.confirm('Clear this batch and discard its unsaved assignments?')) return;
    state.batch = []; state.activeBatchKey = null; renderIfcList(); renderBatchQueue(); renderWorkspace();
  });
  assignButton.addEventListener('click', () => {
    const entry = state.batch.find(item => item.key === state.activeBatchKey);
    if (!entry || !state.selectedAsset) return;
    const duplicate = batchConflict(state.selectedAsset.id, entry.key);
    if (duplicate) { setMessage('Already assigned in this batch. Choose another itemit asset or change the existing proposal.', 'error'); return; }
    entry.asset = state.selectedAsset; entry.result = null;
    const nextPending = nextUnassignedBatchEntry(state.batch, entry.key);
    if (nextPending) {
      activateBatchEntry(nextPending, { focus: true });
      setMessage('');
    } else {
      renderBatchQueue(); renderAssets(); renderWorkspace();
      setMessage('');
    }
  });

  for (const model of modelCatalog) {
    const option = document.createElement('option');
    option.value = model.key;
    option.textContent = model.name;
    ifcModel.appendChild(option);
  }
  dropdowns.model = createViewportCombobox(ifcModel);
  dropdowns.ifcScope = createViewportCombobox(ifcScope);
  dropdowns.ifcStatus = createViewportCombobox(ifcStatus);
  dropdowns.location = createViewportCombobox(assetLocation);
  dropdowns.collection = createViewportCombobox(assetCollection, { searchable: true, maxMenuHeight: 260 });
  dropdowns.status = createViewportCombobox(assetStatus);
  function currentIfcFilterCount() {
    return Number(ifcScope.value !== 'likely') + Number(Boolean(ifcStatus.value));
  }
  function renderIfcFilterState() {
    const activeCount = currentIfcFilterCount();
    ifcFilterCount.hidden = activeCount === 0;
    ifcFilterCount.textContent = String(activeCount);
    ifcFilterToggle.classList.toggle('has-active-filters', activeCount > 0);
    ifcFilterToggle.setAttribute('aria-label', activeCount ? `IFC filters, ${activeCount} active` : 'IFC filters');
    resetIfcFilters.hidden = activeCount === 0;
  }
  function closeIfcFilterPopover({ restoreFocus = false } = {}) {
    if (ifcFilterPopover.hidden) return;
    [dropdowns.ifcScope, dropdowns.ifcStatus].forEach(dropdown => dropdown?.close());
    ifcFilterPopover.hidden = true;
    ifcFilterToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) ifcFilterToggle.focus();
  }
  function openIfcFilterPopover() {
    ifcFilterPopover.hidden = false;
    ifcFilterToggle.setAttribute('aria-expanded', 'true');
    ifcFilterPopover.querySelector('.workspace-combobox-trigger')?.focus();
  }
  ifcFilterToggle.addEventListener('click', () => ifcFilterPopover.hidden ? openIfcFilterPopover() : closeIfcFilterPopover());
  ifcFilterToggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openIfcFilterPopover(); }
    if (event.key === 'Escape') closeIfcFilterPopover({ restoreFocus: true });
  });
  ifcFilterPopover.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeIfcFilterPopover({ restoreFocus: true }); }
  });
  resetIfcFilters.addEventListener('click', () => {
    ifcScope.value = 'likely';
    ifcStatus.value = '';
    dropdowns.ifcScope.sync();
    dropdowns.ifcStatus.sync();
    state.ifcVisibleLimit = 150;
    renderIfcFilterState();
    renderIfcList();
  });
  applyIfcFilters.addEventListener('click', () => closeIfcFilterPopover({ restoreFocus: true }));
  renderIfcFilterState();
  function closeFilterPopover({ restoreFocus = false } = {}) {
    if (filterPopover.hidden) return;
    [dropdowns.location, dropdowns.collection, dropdowns.status].forEach(dropdown => dropdown?.close());
    filterPopover.hidden = true;
    filterToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) filterToggle.focus();
  }
  function openFilterPopover() {
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
  applyFilters.addEventListener('click', () => closeFilterPopover({ restoreFocus: true }));

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
  function mappingForElement(element) {
    const id = identity(element);
    return id && state.mappings.find(item => item.model_key === id.modelKey && item.ifc_global_id === id.globalId);
  }
  function mappingStatus(mapping) {
    if (!state.mappingApiAvailable) return 'UNAVAILABLE';
    return String(mapping?.mapping_status || 'UNMAPPED').toUpperCase();
  }
  function mappingStatusLabel(status) {
    return ({ UNMAPPED: 'Not mapped', PROVISIONAL: 'Provisional', CONFIRMED: 'Confirmed', UNAVAILABLE: 'Status unavailable' })[status] || status;
  }
  function linkedIfcLabel(mapping) {
    if (!mapping) return '';
    const index = state.indexes.get(mapping.model_key);
    const element = index?.elements.find(item => item.identity.globalId === mapping.ifc_global_id);
    const tag = element?.tag || element?.objectType || mapping.ifc_global_id?.slice(-6) || 'not available';
    return `Linked IFC: ${element ? displayIfcName(element) : mapping.model_key} — Tag ${tag}`;
  }
  async function refreshMappingCache() {
    try {
      const mappings = await getMappings();
      state.mappings = mappings;
      state.mappingApiAvailable = true;
      return true;
    } catch (error) {
      state.mappings = [];
      state.mappingApiAvailable = false;
      setMessage(`Mapping status unavailable: ${error.message}`, 'error');
      return false;
    }
  }
  function renderSelected() {
    const item = state.selectedIfc;
    const id = currentIdentity();
    if (!item || !id) {
      reviewIfc.textContent = 'Select an IFC element.';
      return;
    }
    reviewIfc.replaceChildren();
    appendLine(reviewIfc, 'review-label', 'IFC element');
    appendLine(reviewIfc, 'review-name', displayIfcName(item));
    const metadata = document.createElement('span'); metadata.className = 'review-summary-fields';
    for (const text of [
      `Type: ${value(item.ifcType)}`,
      `Tag: ${value(item.tag || item.objectType || id.globalId.slice(-6))}`,
      `Room: ${value(item.room?.name, 'Unknown')}`,
      `Model: ${id.modelKey}`,
      `Status: ${mappingStatusLabel(mappingStatus(mappingForCurrent()))}`
    ]) appendLine(metadata, 'review-meta', text);
    reviewIfc.appendChild(metadata);
  }
  function renderBatchQueue() {
    let queue = detailsPane.querySelector('.workspace-batch-queue');
    if (!queue) { queue = document.createElement('section'); queue.className = 'workspace-batch-queue'; candidate.closest('.workspace-review').after(queue); }
    queue.replaceChildren();
    if (state.mode !== 'batch') { queue.hidden = true; return; }
    queue.hidden = false;
    const progressState = getBatchProgress(state.batch);
    const heading = document.createElement('h3'); heading.textContent = 'Batch mapping queue'; queue.appendChild(heading);
    const progress = document.createElement('p');
    progress.className = 'workspace-queue-progress';
    progress.textContent = `${progressState.assigned} of ${progressState.total} assigned · ${progressState.pending} pending${progressState.conflicts ? ` · ${progressState.conflicts} conflict${progressState.conflicts === 1 ? '' : 's'}` : ''}`;
    queue.appendChild(progress);
    for (const [index, entry] of state.batch.entries()) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'workspace-batch-item';
      row.classList.toggle('selected', entry.key === state.activeBatchKey);
      const id = identity(entry.element);
      const identifier = entry.element.tag || entry.element.objectType || id?.globalId?.slice(-6) || 'No identifier';
      const existing = state.mappings.find(mapping => mapping.model_key === id?.modelKey && mapping.ifc_global_id === id?.globalId);
      const status = entry.result?.status || (entry.asset ? 'Assigned' : existing ? 'Already Mapped' : entry.key === state.activeBatchKey ? 'Active / Pending' : 'Pending');
      row.classList.add(`queue-state-${String(status).toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
      const order = document.createElement('span'); order.className = 'workspace-queue-order'; order.textContent = String(index + 1);
      const record = document.createElement('span'); record.className = 'workspace-queue-record';
      appendLine(record, 'workspace-queue-name', displayIfcName(entry.element));
      appendLine(record, 'workspace-queue-meta', `Tag · ${identifier}`);
      if (entry.asset) appendLine(record, 'workspace-queue-asset', value(entry.asset.name));
      const badge = document.createElement('span'); badge.className = 'workspace-queue-status'; badge.textContent = status;
      row.append(order, record, badge);
      row.addEventListener('click', () => activateBatchEntry(entry, { focus: true }));
      const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'workspace-queue-remove'; removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', event => { event.stopPropagation(); if (window.confirm(`Remove ${displayIfcName(entry.element)} from this batch?`)) removeBatch(entry.key); });
      const line = document.createElement('div'); line.className = 'workspace-queue-line'; line.append(row, removeButton); queue.appendChild(line);
    }
    const review = document.createElement('details'); review.className = 'workspace-batch-review'; review.open = state.batchReviewOpen;
    const summary = document.createElement('summary'); summary.textContent = 'Review Batch Mappings';
    summary.addEventListener('click', () => { window.setTimeout(() => { state.batchReviewOpen = review.open; }, 0); });
    const table = document.createElement('table'); table.className = 'workspace-batch-review-table';
    const head = document.createElement('thead'); head.innerHTML = '<tr><th>IFC element</th><th>Tag</th><th>itemit asset</th><th>Serial</th><th>Status</th></tr>';
    const body = document.createElement('tbody');
    for (const entry of state.batch) {
      const row = document.createElement('tr');
      const id = identity(entry.element);
      const status = entry.result?.status || (entry.asset ? 'Ready' : 'Pending');
      for (const text of [
        displayIfcName(entry.element),
        entry.element.tag || entry.element.objectType || id?.globalId?.slice(-6) || 'Not available',
        value(entry.asset?.name, '—'),
        value(entry.asset?.serial, '—'),
        status
      ]) { const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell); }
      row.addEventListener('click', () => activateBatchEntry(entry, { focus: true }));
      body.appendChild(row);
    }
    table.append(head, body); review.append(summary, table); queue.appendChild(review);
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
    if (!index) { state.visibleIfcElements = []; state.filteredIfcElements = []; state.filteredIfcTotal = 0; renderBatchToolbar(); ifcResultCount.textContent = ''; ifcList.textContent = 'Loading IFC elements…'; return; }
    const query = ifcSearch.value.trim().toLocaleLowerCase();
    const matching = index.elements.filter(element => [element.name, element.normalizedName, element.ifcType, element.identity.globalId, element.tag, element.objectType]
      .filter(Boolean).some(field => String(field).toLocaleLowerCase().includes(query)));
    const filtered = matching.filter(element => {
      if (!includesInIfcScope(element, ifcScope.value, state.mappings)) return false;
      return !ifcStatus.value || mappingStatus(mappingForElement(element)) === ifcStatus.value;
    });
    ifcResultCount.textContent = `${filtered.length} IFC element${filtered.length === 1 ? '' : 's'}`;
    const elements = filtered.slice(0, state.ifcVisibleLimit);
    state.visibleIfcElements = elements;
    state.filteredIfcElements = filtered;
    state.filteredIfcTotal = filtered.length;
    renderBatchToolbar(filtered);
    for (const element of elements) {
      const button = document.createElement('button');
      button.className = 'workspace-ifc-item';
      button.dataset.ifcKey = batchKey(element);
      button.classList.toggle('selected', currentIdentity()?.globalId === element.identity.globalId && currentIdentity()?.modelKey === element.identity.modelKey);
      button.classList.toggle('batch-selected', state.mode === 'batch' && Boolean(batchEntry(element)));
      const content = document.createElement('span'); content.className = 'ifc-card-content';
      appendLine(content, 'list-row-title', displayIfcName(element));
      const tag = element.tag || element.objectType || element.predefinedType;
      const identifier = tag || element.sourceLocalId || 'No distinguishing identifier';
      const metadata = document.createElement('span'); metadata.className = 'ifc-card-metadata';
      appendLine(metadata, 'ifc-card-type', element.ifcType || 'IFC element');
      appendLine(metadata, 'ifc-card-tag', `${tag ? 'Tag' : 'Express ID'} · ${identifier}`);
      content.appendChild(metadata);
      button.appendChild(content);
      const mapping = mappingForElement(element);
      const statusKey = mappingStatus(mapping);
      const status = document.createElement('span'); status.className = 'list-row-status';
      status.classList.add(`mapping-status-${statusKey.toLocaleLowerCase()}`);
      status.textContent = mappingStatusLabel(statusKey);
      button.appendChild(status);
      button.title = `${displayIfcName(element)} · ${element.ifcType || 'IFC element'} · Tag ${identifier}`;
      button.disabled = !element.identity.globalId;
      button.addEventListener('click', async () => {
        const resolved = await resolveIndexedElement(element);
        if (!resolved) return;
        await selectIfc(resolved);
        if (state.mode === 'single') void focusActiveIfc(resolved);
        else void selectIfcInViewer(viewerTarget(resolved));
      });
      if (state.mode === 'batch') {
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(batchEntry(element));
        checkbox.setAttribute('aria-label', `Add ${displayIfcName(element)} to batch`);
        checkbox.className = 'ifc-batch-checkbox';
        checkbox.disabled = button.disabled;
        const typeIcon = document.createElement('span'); typeIcon.className = 'ifc-type-icon'; typeIcon.setAttribute('aria-hidden', 'true');
        checkbox.addEventListener('click', event => event.stopPropagation());
        checkbox.addEventListener('change', async () => {
          state.mode = 'batch';
          const resolved = await resolveIndexedElement(element);
          if (!resolved) { checkbox.checked = false; renderWorkspace(); return; }
          checkbox.checked ? addBatch(resolved) : removeBatch(batchKey(resolved));
        });
        button.prepend(checkbox, typeIcon);
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
      const indexed = index.elements.find(item => item.identity.globalId === id.globalId) || element;
      if (id.modelKey !== 'building') return indexed;
      const roomIndexes = await Promise.all(modelCatalog
        .filter(model => model.key !== 'building')
        .map(model => ensureIndex(model.key)));
      const canonical = resolveOverviewElementToRoom(indexed, roomIndexes);
      if (!canonical) {
        setMessage('This Building Overview element could not be resolved to exactly one room model. Mapping is blocked to avoid writing a building-level record.', 'error');
        return null;
      }
      return {
        ...canonical,
        overviewSource: { modelKey: id.modelKey, globalId: id.globalId, sourceLocalId: indexed.sourceLocalId }
      };
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
    if (!await refreshMappingCache()) {
      // Inventory searching remains read-only and useful if an older API
      // process has not yet been restarted with Phase 2 mapping routes.
      setMessage('Inventory loaded, but mapping status is unavailable.', 'error');
    }
    populateFilters();
  }
  function candidateStatus(asset) {
    if (!state.mappingApiAvailable) return 'Mapping Status Unavailable';
    const statuses = state.mappings.filter(mapping => mapping.itemit_item_id === asset.id).map(mapping => mapping.mapping_status);
    return statuses.length ? [...new Set(statuses)].map(status => mappingStatusLabel(String(status).toUpperCase())).join(', ') : 'Not mapped';
  }
  function filteredAssets() {
    const query = assetQuery.value.trim().toLocaleLowerCase();
    return (state.assets || []).filter(asset => {
      if (query && ![asset.name, asset.serial].some(field => String(field || '').toLocaleLowerCase().includes(query))) return false;
      if (assetLocation.value && locationKey(asset.current_location) !== assetLocation.value) return false;
      if (assetCollection.value && !collectionValues(asset).includes(assetCollection.value)) return false;
      if (assetStatus.value) {
        const mappedStatuses = state.mappings
          .filter(mapping => mapping.itemit_item_id === asset.id)
          .map(mapping => String(mapping.mapping_status).toUpperCase());
        if (assetStatus.value === 'UNMAPPED' ? mappedStatuses.length > 0 : !mappedStatuses.includes(assetStatus.value)) return false;
      }
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
      const reservedBy = state.mode === 'batch' ? findBatchAssetConflict(state.batch, asset.id, state.activeBatchKey) : null;
      const ownedByActiveEntry = state.mode === 'batch' && state.batch.find(entry => entry.key === state.activeBatchKey)?.asset?.id === asset.id;
      const persistedMapping = state.mappings.find(mapping => mapping.itemit_item_id === asset.id);
      appendLine(button, 'list-row-title', value(asset.name));
      const metadata = document.createElement('span'); metadata.className = 'asset-card-metadata';
      appendLine(metadata, 'list-row-meta asset-card-serial', `Serial: ${value(asset.serial)}`);
      appendLine(metadata, 'list-row-meta asset-card-location', `Location: ${value(asset.current_location)}`);
      button.appendChild(metadata);
      const assetStatusNode = appendLine(button, 'list-row-status', reservedBy ? batchReservationLabel(reservedBy) : ownedByActiveEntry ? 'Currently assigned' : candidateStatus(asset));
      if (persistedMapping) assetStatusNode.classList.add(`mapping-status-${mappingStatus(persistedMapping).toLocaleLowerCase()}`);
      button.classList.toggle('batch-conflict', Boolean(reservedBy));
      button.disabled = Boolean(reservedBy);
      if (reservedBy) button.title = `Already proposed for ${displayIfcName(reservedBy.element)} (${batchReservationLabel(reservedBy)}).`;
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
      const reservedBy = state.mode === 'batch' ? findBatchAssetConflict(state.batch, asset.id, state.activeBatchKey) : null;
      if (reservedBy) {
        setMessage(`${batchReservationLabel(reservedBy)}.`, 'error');
        return;
      }
      const persistedMapping = state.mappings.find(mapping => mapping.itemit_item_id === asset.id);
      const current = currentIdentity();
      if (persistedMapping && (!current || persistedMapping.model_key !== current.modelKey || persistedMapping.ifc_global_id !== current.globalId)) {
        candidate.textContent = `${mappingStatusLabel(mappingStatus(persistedMapping))}. ${linkedIfcLabel(persistedMapping)}.`;
        setMessage('This itemit asset already has a persisted mapping. Use the explicit replace workflow on its linked IFC element.', 'error');
        return;
      }
      state.selectedAsset = asset;
      renderCandidate(asset);
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
      renderSelected();
      await selectAsset(state.selectedAsset.id);
      // The selected record and its status are already shown in the summary card.
      // Do not expose implementation details such as the mapping method as a toast.
      setMessage('', 'success');
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
    if (selectedIdentity?.modelKey === 'building') {
      state.selectedIfc = null;
      state.selectedAsset = null;
      renderSelected();
      setMessage('Building Overview is view-only for mapping. Select an element that resolves to a room model.', 'error');
      return;
    }
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
      const verified = await refreshMappingCache();
      renderAssets();
      renderIfcList();
      if (verified) {
        await refreshCurrentMapping();
        setMessage('Mapping saved and revalidated.', 'success');
        remove.disabled = false;
      } else {
        setMessage('Mapping write completed, but persisted status could not be verified. Mapping actions remain blocked until status is available.', 'error');
      }
    } catch (error) { setMessage(error.message, 'error'); }
    finally { save.disabled = false; }
  }
  async function saveBatchMappings() {
    if (!state.mappingApiAvailable) { setMessage('Batch writes are disabled because mapping status could not be verified.', 'error'); return; }
    const draftErrors = validateBatchProposals(state.batch);
    if (draftErrors.length) {
      setMessage(draftErrors.join(' '), 'error');
      renderBatchQueue(); renderAssets();
      return;
    }
    const pending = state.batch.filter(entry => entry.asset && (!entry.result || entry.result.status === 'Failed'));
    if (!pending.length) {
      setMessage('No eligible proposed mappings are ready to submit. Correct any conflicts before retrying.', 'error');
      return;
    }
    if (!window.confirm(`Confirm ${pending.length} independent mapping write${pending.length === 1 ? '' : 's'}? Successful writes cannot be rolled back as a batch.`)) return;
    save.disabled = true;
    const written = [];
    for (const entry of pending) {
      const id = identity(entry.element);
      try {
        const existing = state.mappings.find(row => row.model_key === id.modelKey && row.ifc_global_id === id.globalId);
        if (existing) await updateMapping({ modelKey: id.modelKey, globalId: id.globalId, changes: { itemit_item_id: entry.asset.id, mapping_status: 'PROVISIONAL', mapping_method: 'MANUAL' } });
        else await createMapping({ model_key: id.modelKey, ifc_global_id: id.globalId, itemit_item_id: entry.asset.id, mapping_status: 'PROVISIONAL', mapping_method: 'MANUAL' });
        entry.result = { status: 'Awaiting verification' };
        written.push(entry);
      } catch (error) {
        entry.result = { status: error.status === 409 ? 'Conflict' : 'Failed', message: error.message };
      }
    }
    const verified = await refreshMappingCache();
    if (verified) {
      for (const entry of written) {
        const id = identity(entry.element);
        const persisted = state.mappings.find(mapping => mapping.model_key === id.modelKey && mapping.ifc_global_id === id.globalId && mapping.itemit_item_id === entry.asset.id);
        entry.result = persisted ? { status: 'Success', mappingStatus: persisted.mapping_status } : { status: 'Unverified' };
      }
    } else {
      for (const entry of written) entry.result = { status: 'Unverified' };
    }
    save.disabled = false;
    renderReview(); renderBatchQueue(); renderAssets(); renderIfcList();
    setMessage(verified ? 'Batch submission finished. Failed or conflicting pairs remain available for correction.' : 'Batch writes completed, but persisted statuses could not be verified. Unverified pairs were not marked as saved.', verified ? 'success' : 'error');
  }
  async function removeMapping() {
    const id = currentIdentity();
    if (!id || !window.confirm('Remove this IFC-to-itemit mapping?')) return;
    try {
      await deleteMapping(id);
      const verified = await refreshMappingCache();
      state.selectedAsset = null;
      candidate.textContent = 'Mapping removed. Select an asset to create a new mapping.'; remove.disabled = true; save.disabled = true;
      renderSelected(); renderAssets(); renderIfcList(); setMessage(verified ? 'Mapping removed.' : 'Mapping removal completed, but status could not be verified.', verified ? 'success' : 'error');
    } catch (error) { setMessage(error.message, 'error'); }
  }
  async function activate(element = null) {
    if (viewerCenter.parentNode !== viewerSlot) {
      viewerCenter.before(centerHome);
      viewerSlot.appendChild(viewerCenter);
    }
    state.open = true;
    root.classList.remove('hidden');
    if (element) {
      const resolved = await resolveIndexedElement(element);
      if (resolved) await selectIfc(resolved);
    } else await loadIfcModel();
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
    setMessage('');
    void loadIfcModel();
    renderBatchQueue();
    renderWorkspace();
  });
  ifcScope.addEventListener('change', () => { state.ifcVisibleLimit = 150; renderIfcFilterState(); renderIfcList(); });
  ifcStatus.addEventListener('change', () => { state.ifcVisibleLimit = 150; renderIfcFilterState(); renderIfcList(); });
  assetQuery.addEventListener('input', () => { state.page = 0; renderAssets(); });
  assetLocation.addEventListener('change', () => { state.locationFilterSource = 'user'; state.page = 0; renderAssets(); });
  [assetCollection, assetStatus].forEach(control => control.addEventListener('change', () => { state.page = 0; renderAssets(); }));
  resetFilters.addEventListener('click', () => {
    assetLocation.value = '';
    assetCollection.value = ''; assetStatus.value = 'Unmapped';
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
      void resolveIndexedElement(element).then(indexed => {
        if (indexed) return selectIfc(indexed);
        clearSelection();
      });
    }
  };
}
