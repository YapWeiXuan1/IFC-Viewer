import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMapping,
  getMappingStatus
} from '../src/services/fobeApi.js';

test('mapping client uses stable model key and GlobalId routes', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const responses = [
    { model_key: 'foyer', ifc_global_id: 'abc/123', itemit_item_id: 'asset-1' },
    { model_key: 'foyer', ifc_global_id: 'abc/123', itemit_item_id: 'asset-1' }
  ];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const body = responses.shift();
    return { ok: true, status: body ? 200 : 204, async json() { return body; } };
  };

  try {
    await getMappingStatus({ modelKey: 'foyer', globalId: 'abc/123' });
    await createMapping({ model_key: 'foyer', ifc_global_id: 'abc/123', itemit_item_id: 'asset-1' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls[0].url, '/api/mappings/status?model_key=foyer&ifc_global_id=abc%2F123');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(JSON.parse(calls[1].options.body).ifc_global_id, 'abc/123');
});

