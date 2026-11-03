import test from 'node:test';
import assert from 'node:assert/strict';
import { displayIfcName, findBatchAssetConflict, getBatchProgress, includesInIfcScope, nextUnassignedBatchEntry, resolveOverviewElementToRoom, validateBatchProposals } from '../src/mapping-workspace.js';

test('IFC scope keeps mapped building components manageable while filtering the default list', () => {
  const partition = { identity: { modelKey: 'black', globalId: 'partition' }, candidate: { classification: 'BUILDING_COMPONENT' } };
  const uncertain = { identity: { modelKey: 'black', globalId: 'proxy' }, candidate: { classification: 'NEEDS_REVIEW' } };
  assert.equal(includesInIfcScope(partition, 'likely'), false);
  assert.equal(includesInIfcScope(uncertain, 'likely'), false);
  assert.equal(includesInIfcScope(uncertain, 'review'), true);
  assert.equal(includesInIfcScope(partition, 'likely', [{ model_key: 'black', ifc_global_id: 'partition' }]), true);
});

test('IFC list label is presentation-only and omits room suffixes', () => {
  assert.equal(displayIfcName({ name: 'Table (White Box):Table D108G:447608' }), 'Table');
  assert.equal(displayIfcName({ name: 'Computer:Computer:931735' }), 'Computer');
  assert.equal(displayIfcName({ name: '' }), 'Unnamed IFC element');
});

test('batch proposal helpers retain stable entries and prevent duplicate itemit UUIDs', () => {
  const batch = [
    { key: 'white:ifc-1', asset: { id: 'item-1' } },
    { key: 'white:ifc-2', asset: null },
    { key: 'white:ifc-3', asset: { id: 'item-3' }, result: { status: 'Conflict' } },
    { key: 'white:ifc-4', asset: null }
  ];
  assert.deepEqual(getBatchProgress(batch), { total: 4, assigned: 2, pending: 2, conflicts: 1 });
  assert.equal(findBatchAssetConflict(batch, 'item-1', 'white:ifc-2')?.key, 'white:ifc-1');
  assert.equal(findBatchAssetConflict(batch, 'item-1', 'white:ifc-1'), null);
  assert.equal(nextUnassignedBatchEntry(batch, 'white:ifc-1')?.key, 'white:ifc-2');
  assert.equal(nextUnassignedBatchEntry(batch, 'white:ifc-3')?.key, 'white:ifc-4');
  assert.deepEqual(validateBatchProposals(batch), []);
  assert.deepEqual(validateBatchProposals([...batch, { key: 'white:ifc-4', asset: { id: 'item-1' } }]), [
    'Each submitted IFC element must have a unique model key and GlobalId.',
    'Each submitted itemit asset UUID must be assigned to only one IFC element.'
  ]);
});

test('Building Overview resolves to one room identity and refuses ambiguous matches', () => {
  const overviewElement = { identity: { modelKey: 'building', globalId: 'TABLE-GUID' } };
  const blackTable = { identity: { modelKey: 'black', globalId: 'TABLE-GUID' }, tag: '388970' };
  const whiteTable = { identity: { modelKey: 'white', globalId: 'TABLE-GUID' }, tag: '447608' };
  assert.equal(resolveOverviewElementToRoom(overviewElement, [{ elements: [blackTable] }]), blackTable);
  assert.equal(resolveOverviewElementToRoom(overviewElement, [{ elements: [blackTable] }, { elements: [whiteTable] }]), null);
  assert.equal(resolveOverviewElementToRoom(overviewElement, [{ elements: [] }]), null);
});
