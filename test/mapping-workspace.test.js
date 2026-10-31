import test from 'node:test';
import assert from 'node:assert/strict';
import { displayIfcName, includesInIfcScope } from '../src/mapping-workspace.js';

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
