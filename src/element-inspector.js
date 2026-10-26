
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

    const items = await model.getItemsData([itemId], {
      attributesDefault: true
    });

    const item = items?.[0] ?? null;

    this.current = {
      modelId: model.modelId,
      itemId,
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
