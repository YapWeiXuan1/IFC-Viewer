const DEFAULT_ASSET_TYPE_HINTS = [
  'IFCAIRTERMINAL', 'IFCAUDIOVISUALAPPLIANCE', 'IFCBOILER', 'IFCCHILLER',
  'IFCCONTROLLER', 'IFCDISTRIBUTIONBOARD', 'IFCELECTRICAPPLIANCE',
  'IFCELECTRICMOTOR', 'IFCFAN', 'IFCFILTER', 'IFCFLOWMETER', 'IFCPUMP',
  'IFCSENSOR', 'IFCSWITCHINGDEVICE', 'IFCTRANSFORMER', 'IFCUNITARYEQUIPMENT',
  'IFCVALVE', 'IFCWINDOW', 'IFCDOOR', 'IFCLIGHTFIXTURE'
];
const IDENTIFYING_PROPERTY = /name|description|serial|tag|asset|manufacturer|model|type|reference|barcode|identifier|number/i;
const BUILDING_COMPONENT_TYPES = new Set([
  'IFCBEAM', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCCOLUMN', 'IFCCOVERING',
  'IFCCURTAINWALL', 'IFCDOOR', 'IFCFOOTING', 'IFCGRID', 'IFCMEMBER',
  'IFCOPENINGELEMENT', 'IFCPLATE', 'IFCRAILING', 'IFCRAMP', 'IFCROOF', 'IFCSITE',
  'IFCSLAB', 'IFCSTAIR', 'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWINDOW'
]);
const BUILDING_COMPONENT_NAME = /\b(partition|wall|floor|ceiling|slab|beam|column|curtain\s*wall|room\s*boundary|opening)\b/i;
const MANAGEABLE_NAME = /\b(computer|monitor|table|chair|desk|cabinet|storage|projector|display|screen|printer|scanner|server|switch|router|pump|fan|sensor|controller|boiler|chiller|transformer|valve|panel|equipment|device|appliance|unit)\b/i;

function valueOf(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}
function textOf(value) {
  const raw = valueOf(value);
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
function getAttribute(item, name) {
  return textOf(item?.[name]) || textOf(item?.[name.toLowerCase()]) || null;
}
function collectProperties(value, path = '', output = {}, limit = 100) {
  if (Object.keys(output).length >= limit || value == null) return output;
  const raw = valueOf(value);
  if (['string', 'number', 'boolean'].includes(typeof raw)) {
    if (path && IDENTIFYING_PROPERTY.test(path)) output[path] = raw;
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'type' && key !== 'value') collectProperties(child, path ? `${path}.${key}` : key, output, limit);
    if (Object.keys(output).length >= limit) break;
  }
  return output;
}
function buildRoomLookup(tree, dataByLocalId) {
  const rooms = new Map();
  function visit(node, inheritedRoom = null) {
    if (!node) return;
    const item = node.localId == null ? null : dataByLocalId.get(node.localId);
    const room = String(node.category || '').toUpperCase() === 'IFCSPACE'
      ? { globalId: getAttribute(item, 'GlobalId'), name: getAttribute(item, 'Name') }
      : inheritedRoom;
    if (node.localId != null && room) rooms.set(node.localId, room);
    for (const child of node.children || []) visit(child, room);
  }
  visit(tree);
  return rooms;
}
function collectSpatialLocalIds(tree, ids = new Set()) {
  if (!tree) return ids;
  if (tree.localId != null) ids.add(tree.localId);
  for (const child of tree.children || []) collectSpatialLocalIds(child, ids);
  return ids;
}
export function classifyCandidate({ ifcType, name, objectType, predefinedType, properties }, options = {}) {
  const types = new Set((options.likelyAssetTypes || DEFAULT_ASSET_TYPE_HINTS).map(type => String(type).toUpperCase()));
  const normalizedType = String(ifcType || '').toUpperCase();
  const searchableText = [name, objectType, predefinedType, ...Object.values(properties || {})].filter(Boolean).join(' ');
  if (BUILDING_COMPONENT_TYPES.has(normalizedType) || BUILDING_COMPONENT_NAME.test(searchableText)) {
    return { classification: 'BUILDING_COMPONENT', reason: BUILDING_COMPONENT_TYPES.has(normalizedType) ? 'building-ifc-type' : 'building-name-or-type' };
  }
  const typeMatch = types.has(normalizedType);
  const propertyMatch = Object.keys(properties || {}).some(key => /serial|asset|barcode|tag|identifier/i.test(key));
  const nameMatch = MANAGEABLE_NAME.test(searchableText);
  return {
    classification: typeMatch || propertyMatch || nameMatch ? 'LIKELY_ASSET' : 'NEEDS_REVIEW',
    reason: typeMatch ? 'configured-ifc-type' : propertyMatch ? 'identifying-property' : nameMatch ? 'manageable-name-or-type' : 'insufficient-asset-evidence'
  };
}
function countByType(elements) {
  return elements.reduce((counts, element) => {
    const type = element.ifcType || 'UNKNOWN';
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
}
async function getDataByLocalId(model, localIds) {
  const entries = [];
  for (let start = 0; start < localIds.length; start += 200) {
    const ids = localIds.slice(start, start + 200);
    const items = await model.getItemsData(ids, {
      attributesDefault: true,
      relations: { IsDefinedBy: { attributes: true, relations: true }, ContainedInStructure: { attributes: true, relations: false } }
    });
    entries.push(...ids.map((id, index) => [id, items[index] || {}]));
  }
  return new Map(entries);
}

/** Read-only Smart Mapping analysis index. Local IDs are inspection-only. */
export async function buildIfcElementIndex(model, modelKey, options = {}) {
  if (!model || !modelKey) throw new Error('A loaded model and stable model key are required.');
  const geometryIds = Array.from(await model.getItemsIdsWithGeometry());
  const spatialTree = await model.getSpatialStructure();
  const metadataIds = Array.from(new Set([...geometryIds, ...collectSpatialLocalIds(spatialTree)]));
  const dataByLocalId = await getDataByLocalId(model, metadataIds);
  const [guids, categories] = await Promise.all([
    model.getGuidsByLocalIds(geometryIds), model.getItemsWithGeometryCategories()
  ]);
  const roomByLocalId = buildRoomLookup(spatialTree, dataByLocalId);
  const elements = geometryIds.map((sourceLocalId, index) => {
    const item = dataByLocalId.get(sourceLocalId) || {};
    const globalId = guids[index] || getAttribute(item, 'GlobalId');
    const ifcType = categories[index] || getAttribute(item, 'Entity') || getAttribute(item, 'Type') || 'UNKNOWN';
    const name = getAttribute(item, 'Name');
    const identifyingProperties = collectProperties(item);
    return {
      identity: globalId ? { modelKey, globalId, stableKey: `${modelKey}:${globalId}` } : { modelKey, globalId: null, stableKey: null },
      sourceLocalId,
      ifcType,
      name,
      description: getAttribute(item, 'Description'),
      objectType: getAttribute(item, 'ObjectType'),
      predefinedType: getAttribute(item, 'PredefinedType'),
      tag: getAttribute(item, 'Tag'),
      room: roomByLocalId.get(sourceLocalId) || null,
      roomSource: roomByLocalId.has(sourceLocalId) ? 'IFC_SPACE' : 'UNKNOWN',
      identifyingProperties,
      normalizedName: [name, getAttribute(item, 'ObjectType')].filter(Boolean).join(' ').toLocaleLowerCase(),
      candidate: classifyCandidate({ ifcType, name, objectType: getAttribute(item, 'ObjectType'), predefinedType: getAttribute(item, 'PredefinedType'), properties: identifyingProperties }, options)
    };
  });
  return {
    schemaVersion: '1.0', generatedAt: new Date().toISOString(), modelKey, modelId: model.modelId,
    elementCount: elements.length,
    stableIdentityCount: elements.filter(element => element.identity.globalId).length,
    typeCounts: countByType(elements), elements
  };
}
export function downloadIfcElementIndex(index) {
  const blob = new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${index.modelKey}-ifc-element-index.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { DEFAULT_ASSET_TYPE_HINTS, BUILDING_COMPONENT_TYPES };
