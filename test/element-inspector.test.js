import test from 'node:test';
import assert from 'node:assert/strict';
import { ElementInspector } from '../src/element-inspector.js';

test('selection uses the Fragments GUID index when GlobalId is absent from item data', async () => {
  let selected;
  const inspector = new ElementInspector({ onSelected: value => { selected = value; } });
  await inspector.select({
    modelId: 'foyer',
    async getItemsData() { return [{ Name: { value: 'Pump' } }]; },
    async getGuidsByLocalIds() { return ['2aBcD3']; }
  }, 121);
  assert.equal(selected.modelKey, 'foyer');
  assert.equal(selected.ifcGlobalId, '2aBcD3');
});
