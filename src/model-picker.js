import * as THREE from "three";

export function setupModelPicker({
  viewer,
  getActiveModel,
  inspector
}) {
  const canvas = viewer.world.renderer.three.domElement;

  let selection = null;
  let picking = false;
  let focusGeneration = 0;

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

  async function focusElement(model, localId) {
    if (!model || localId == null) return;
    const generation = ++focusGeneration;
    // FragmentsModel#getMergedBox already returns an absolute/world-space box.
    // Applying model.matrixWorld again offsets the target a second time and can
    // leave the selected element outside the framed view.
    const worldBox = await model.getMergedBox([localId]);
    if (generation !== focusGeneration || !worldBox || worldBox.isEmpty()) return;

    const sphere = worldBox.getBoundingSphere(new THREE.Sphere());
    // Preserve enough context around small furniture without changing the
    // model's scale, coordinates, or normal mouse zoom behavior.
    sphere.radius = Math.min(Math.max(sphere.radius * 1.45, 0.5), 250);
    await viewer.world.camera.controls.fitToSphere(sphere, true);
    if (generation !== focusGeneration) return;
    await viewer.fragments.core.update(true);
  }

  function cancelFocus() {
    focusGeneration += 1;
    viewer.world.camera.controls.cancel?.();
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
  canvas.addEventListener("pointerdown", cancelFocus, { capture: true });
  canvas.addEventListener("wheel", cancelFocus, { passive: true });

  return {
    clearSelection,
    select: selectElement,
    focus: focusElement,
    dispose() {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("pointerdown", cancelFocus, { capture: true });
      canvas.removeEventListener("wheel", cancelFocus);
    }
  };
}
