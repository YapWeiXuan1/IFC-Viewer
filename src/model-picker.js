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

  async function selectElement(model, localId) {
    if (picking || !model || localId == null) return;
    picking = true;
    try {
      // Clear the previous highlight.
      if (selection) {
        await selection.model.resetHighlight([
          selection.localId
        ]);
      }

      selection = {
        model,
        localId
      };

      await model.highlight(
        [localId],
        highlightMaterial
      );

      await viewer.fragments.core.update(true);

      await inspector.select(model, localId);

    } catch (error) {
      console.error("Element selection failed:", error);
    } finally {
      picking = false;
    }
  }

  async function onClick(event) {
    const model = getActiveModel();
    if (!model || picking) return;
    try {
      const hit = await model.raycast({
        camera: viewer.world.camera.three,
        mouse: new THREE.Vector2(event.clientX, event.clientY),
        dom: canvas
      });
      if (!hit) return await clearSelection();
      await selectElement(model, hit.localId);
    } catch (error) {
      console.error("Element selection failed:", error);
    }
  }

  canvas.addEventListener("click", onClick);

  return {
    clearSelection,
    select: selectElement,
    dispose() {
      canvas.removeEventListener("click", onClick);
    }
  };
}
