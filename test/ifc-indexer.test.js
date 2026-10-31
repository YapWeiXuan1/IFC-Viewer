import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIfcElementIndex, classifyCandidate } from '../src/ifc-indexer.js';

function createModel() {
  const items = new Map([
    [1, { GlobalId: { value: 'SPACE-GUID' }, Name: { value: 'Plant Room' } }],
    [2, { GlobalId: { value: 'PUMP-GUID' }, Name: { value: 'Primary pump' }, ObjectType: { value: 'Circulation pump' }, Tag: { value: 'P-01' }, Description: { value: 'Heating circulation pump' }, Pset_Asset: { SerialNumber: { value: 'P-01' } } }]
  ]);
  return {
    modelId: 'foyer',
    async getItemsIdsWithGeometry() { return [2]; }, async getLocalIds() { return [1, 2]; },
    async getItemsData(ids) { return ids.map(id => items.get(id)); }, async getGuidsByLocalIds() { return ['PUMP-GUID']; },
    async getItemsWithGeometryCategories() { return ['IFCPUMP']; },
    async getSpatialStructure() { return { category: 'IFCBUILDING', localId: null, children: [{ category: 'IFCSPACE', localId: 1, children: [{ category: 'IFCPUMP', localId: 2 }] }] }; }
  };
}
test('uses model key and GlobalId as stable identity', async () => {
  const [element] = (await buildIfcElementIndex(createModel(), 'foyer')).elements;
  assert.deepEqual(element.identity, { modelKey: 'foyer', globalId: 'PUMP-GUID', stableKey: 'foyer:PUMP-GUID' });
  assert.equal(element.sourceLocalId, 2);
  assert.equal(element.room.name, 'Plant Room');
  assert.equal(element.identifyingProperties['Pset_Asset.SerialNumber'], 'P-01');
  assert.equal(element.objectType, 'Circulation pump');
  assert.equal(element.tag, 'P-01');
});
test('retains missing-GlobalId elements for review instead of using a local ID', async () => {
  const model = createModel();
  model.getGuidsByLocalIds = async () => [null];
  model.getItemsData = async (ids) => ids.map(id => id === 1
    ? { Name: { value: 'Plant Room' } }
    : { Name: { value: 'Primary pump' } });
  const [element] = (await buildIfcElementIndex(model, 'foyer', { likelyAssetTypes: [] })).elements;
  assert.equal(element.identity.stableKey, null);
  assert.equal(element.sourceLocalId, 2);
});

test('asset classifier keeps furniture and generic equipment but excludes ordinary partitions', () => {
  assert.equal(classifyCandidate({ ifcType: 'IfcFurnishingElement', name: 'Table (White Box):Table D108G:447608', properties: {} }).classification, 'LIKELY_ASSET');
  assert.equal(classifyCandidate({ ifcType: 'IfcFurnishingElement', name: 'Computer:Computer:931735', properties: {} }).classification, 'LIKELY_ASSET');
  assert.equal(classifyCandidate({ ifcType: 'IfcFurnishingElement', name: 'Partition D108C:Partition D108C:390177', properties: {} }).classification, 'BUILDING_COMPONENT');
  assert.equal(classifyCandidate({ ifcType: 'IfcWall', name: 'Internal wall', properties: {} }).classification, 'BUILDING_COMPONENT');
  assert.equal(classifyCandidate({ ifcType: 'IfcBuildingElementProxy', name: 'AV control device', properties: {} }).classification, 'LIKELY_ASSET');
  assert.equal(classifyCandidate({ ifcType: 'IfcBuildingElementProxy', name: 'Unidentified proxy', properties: {} }).classification, 'NEEDS_REVIEW');
});
