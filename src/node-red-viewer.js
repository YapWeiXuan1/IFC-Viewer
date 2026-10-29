import * as OBC from '@thatopen/components';
import * as THREE from 'three';

export async function createViewer(
  container,
  base = '/ifc-viewer/'
) {
  const components = new OBC.Components();
  const world = components.get(OBC.Worlds).create();

  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = null;

  world.renderer = new OBC.SimpleRenderer(
    components,
    container
  );

  world.camera = new OBC.OrthoPerspectiveCamera(
    components
  );

  components.init();

  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(base + 'worker.mjs');

  world.camera.controls.addEventListener('update', () => {
    void fragments.core.update();
  });

  fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
  });

  const cache = new Map();
  let activeModel;

  function bounds() {
    if (!activeModel) return null;

    activeModel.object.updateWorldMatrix(true, false);

    return activeModel.box.clone().applyMatrix4(
      activeModel.object.matrixWorld
    );
  }

  async function zoom() {
    const box = bounds();
    if (!box || box.isEmpty()) return;

    await world.camera.controls.fitToBox(box, false);
    await fragments.core.update(true);
  }

  async function setCameraView(direction) {
    const box = bounds();
    if (!box || box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());

    const distance = Math.max(
      box.getSize(new THREE.Vector3()).length(),
      1
    ) * 1.5;

    const directions = {
      front: [0, 0, 1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0.0001]
    };

    const d = directions[direction];
    if (!d) return;

    await world.camera.controls.setLookAt(
      center.x + d[0] * distance,
      center.y + d[1] * distance,
      center.z + d[2] * distance,
      center.x,
      center.y,
      center.z,
      false
    );

    await zoom();
  }

  async function loadModel(key, filename) {
    let model = cache.get(key);

    if (!model) {
      const response = await fetch(
        base + 'fragments/' + filename
      );

      if (!response.ok) {
        throw new Error(
          `${filename}: HTTP ${response.status}`
        );
      }

      const bytes = new Uint8Array(
        await response.arrayBuffer()
      );

      model = await fragments.core.load(bytes, {
        modelId: key
      });

      model.object.visible = false;
      cache.set(key, model);
    }

    for (const [id, item] of cache) {
      item.object.visible = id === key;
    }

    activeModel = model;

    await fragments.core.update(true);
    await setCameraView('front');
  }

  const observer = new ResizeObserver(() => {
    if (container.clientWidth && container.clientHeight) {
      world.renderer.resize();
      void fragments.core.update(true);
    }
  });

  observer.observe(container);

  return {
    loadModel,
    zoom,
    setCameraView,

    getRenderer: () => ({
      renderingCamera: world.camera.three,
      domElement: world.renderer.three.domElement
    }),

    dispose: () => {
      observer.disconnect();
      components.dispose();
    }
  };
}