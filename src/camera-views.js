
import * as THREE from "three";

export function createCameraViews(viewer, getActiveModel) {
  const camera = viewer.world.camera;
  const controls = camera.controls;

  async function setView(direction) {
    const model = getActiveModel();

    if (!model) {
      console.warn("No active BIM model");
      return;
    }

    // Calculate the center and size of the active model.
    const bounds = new THREE.Box3().setFromObject(
      model.object
    );

    if (bounds.isEmpty()) {
      console.warn("Model bounds are not available");
      return;
    }

    const center = bounds.getCenter(
      new THREE.Vector3()
    );

    const size = bounds.getSize(
      new THREE.Vector3()
    );

    const distance = Math.max(
      size.length() * 1.2,
      10
    );

    // Y-up coordinate system.
    const directions = {
      top:    [0, 1, 0],
      bottom: [0, -1, 0],
      left:   [-1, 0, 0],
      right:  [1, 0, 0],
      front:  [0, 0, 1],
      back:   [0, 0, -1],
      iso:    [1, 0.8, 1]
    };

    const vector = directions[direction];

    if (!vector) {
      console.warn("Unknown view:", direction);
      return;
    }

    const offset = new THREE.Vector3(
      ...vector
    ).normalize().multiplyScalar(distance);

    // Avoid camera roll in top/bottom views.
    const up = (
      direction === "top" ||
      direction === "bottom"
    )
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1, 0);

    camera.three.up.copy(up);

    // Keep camera-controls orientation consistent.
    controls.camera?.up.copy(up);

    await controls.setLookAt(
      center.x + offset.x,
      center.y + offset.y,
      center.z + offset.z,
      center.x,
      center.y,
      center.z,
      true
    );

    await viewer.fragments.core.update(true);
  }

  return { setView };
}
