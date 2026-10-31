const configuredBaseUrl = import.meta.env?.VITE_FOBE_API_BASE_URL || '/api';
const apiBaseUrl = configuredBaseUrl.replace(/\/$/, '');

export class FobeApiError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'FobeApiError';
    this.status = status;
    this.cause = cause;
  }
}

async function requestJson(path, { method = 'GET', body, signal } = {}) {
  let response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      signal,
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (cause) {
    throw new FobeApiError(
      'Unable to connect to FOBE-API. Start the FastAPI service or check its address.',
      { cause }
    );
  }

  let responseBody = null;
  if (response.status !== 204) {
    try {
      responseBody = await response.json();
    } catch (cause) {
      throw new FobeApiError('FOBE-API returned an invalid JSON response.', {
        status: response.status,
        cause
      });
    }
  }

  if (!response.ok) {
    const detail = typeof responseBody?.detail === 'string' ? `: ${responseBody.detail}` : '';
    throw new FobeApiError(`FOBE-API request failed (${response.status})${detail}`, {
      status: response.status
    });
  }

  return responseBody;
}

function filterAssets(assets, search) {
  const query = search?.trim().toLocaleLowerCase();
  if (!query) return assets;

  return assets.filter(asset => [asset?.name, asset?.serial]
    .filter(value => typeof value === 'string')
    .some(value => value.toLocaleLowerCase().includes(query)));
}

export async function getAssets({ search, limit = 100, offset = 0, activeOnly = true } = {}) {
  // FOBE-API v0.1 supports only active_only and limit. Search and offset are
  // applied locally so the UI does not send unsupported query parameters.
  const params = new URLSearchParams({
    active_only: String(activeOnly),
    limit: String(Math.min(Math.max(Number(limit) || 100, 1), 500))
  });
  const assets = await requestJson(`/assets?${params.toString()}`);

  if (!Array.isArray(assets)) {
    throw new FobeApiError('FOBE-API returned an invalid asset list.');
  }

  return filterAssets(assets, search).slice(Math.max(Number(offset) || 0, 0));
}

export async function getAssetById(itemId) {
  if (!itemId) throw new FobeApiError('An item UUID is required.');

  const asset = await requestJson(`/assets/${encodeURIComponent(itemId)}`);
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new FobeApiError('FOBE-API returned an invalid asset record.');
  }
  return asset;
}

export async function getApiHealth() {
  const health = await requestJson('/health');
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    throw new FobeApiError('FOBE-API returned an invalid health response.');
  }
  return health;
}

export async function getMappingStatus({ modelKey, globalId }) {
  if (!modelKey || !globalId) throw new FobeApiError('A model key and IFC GlobalId are required.');
  const params = new URLSearchParams({ model_key: modelKey, ifc_global_id: globalId });
  return requestJson(`/mappings/status?${params.toString()}`);
}

export async function getMappings({ modelKey, itemitItemId } = {}) {
  const params = new URLSearchParams();
  if (modelKey) params.set('model_key', modelKey);
  if (itemitItemId) params.set('itemit_item_id', itemitItemId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const mappings = await requestJson(`/mappings${suffix}`);
  if (!Array.isArray(mappings)) throw new FobeApiError('FOBE-API returned an invalid mapping list.');
  return mappings;
}

export async function createMapping(mapping) {
  return requestJson('/mappings', { method: 'POST', body: mapping });
}

export async function updateMapping({ modelKey, globalId, changes }) {
  if (!modelKey || !globalId) throw new FobeApiError('A model key and IFC GlobalId are required.');
  return requestJson(`/mappings/${encodeURIComponent(modelKey)}/${encodeURIComponent(globalId)}`, {
    method: 'PUT', body: changes
  });
}

export async function deleteMapping({ modelKey, globalId }) {
  if (!modelKey || !globalId) throw new FobeApiError('A model key and IFC GlobalId are required.');
  await requestJson(`/mappings/${encodeURIComponent(modelKey)}/${encodeURIComponent(globalId)}`, {
    method: 'DELETE'
  });
}
