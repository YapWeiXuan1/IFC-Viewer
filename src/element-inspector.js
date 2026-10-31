
export class ElementInspector {
  constructor({ onSelected }) {
    this.onSelected = onSelected;
    this.current = null;
  }

  async select(model, itemId) {
    if (!model || itemId == null) {
      this.clear();
      return null;
    }

    const [items, guids] = await Promise.all([
      model.getItemsData([itemId], { attributesDefault: true }),
      model.getGuidsByLocalIds([itemId])
    ]);

    const item = items?.[0] ?? null;

    this.current = {
      modelKey: model.modelId,
      modelId: model.modelId,
      itemId,
      // Fragments' GUID index is more reliable than the optional attribute
      // payload for a raycast-selected element.
      ifcGlobalId: guids?.[0] || getIfcGlobalId(item),
      properties: item
    };

    this.onSelected?.(this.current);

    return this.current;
  }

  clear() {
    this.current = null;
    this.onSelected?.(null);
  }
}

function getIfcGlobalId(item) {
  const globalId = item?.GlobalId;
  if (typeof globalId === 'string') return globalId;
  if (typeof globalId?.value === 'string') return globalId.value;
  return null;
}
