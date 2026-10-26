import * as THREE from "three";

export function setupModelPicker({
  viewer,
  getActiveModel,
  inspector
}) {
  const canvas = viewer.world.renderer.three.domElement;

  let selection = null;
  let picking = false;

  const highlightMaterial = {
    color: new THREE.Color("#22c55e"),
    renderedFaces: 1,
    opacity: 0.8,
    transparent: true
  };

  async function clearSelection() {
    if (selection) {
      await selection.model.resetHighlight([
        selection.localId
      ]);

      selection = null;
    }

    inspector.clear();
    await viewer.fragments.core.update(true);
  }

  async function onClick(event) {
    if (picking) return;

    const model = getActiveModel();
    if (!model) return;

    picking = true;

    try {
      // Use client coordinates, not normalized device coordinates.
      const mouse = new THREE.Vector2(
        event.clientX,
        event.clientY
      );

      const hit = await model.raycast({
        camera: viewer.world.camera.three,
        mouse,
        dom: canvas
      });

      if (!hit) {
        await clearSelection();
        return;
      }

      // Clear the previous highlight.
      if (selection) {
        await selection.model.resetHighlight([
          selection.localId
        ]);
      }

      selection = {
        model,
        localId: hit.localId
      };

      await model.highlight(
        [hit.localId],
        highlightMaterial
      );

      await viewer.fragments.core.update(true);

      await inspector.select(model, hit.localId);

    } catch (error) {
      console.error("Element selection failed:", error);
    } finally {
      picking = false;
    }
  }

  canvas.addEventListener("click", onClick);

  return {
    clearSelection,
    dispose() {
      canvas.removeEventListener("click", onClick);
    }
  };
}
