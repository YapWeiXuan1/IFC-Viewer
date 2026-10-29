
import * as OBC from "@thatopen/components";

export async function createIfcViewer(container) {
  const components = new OBC.Components();

  const worlds = components.get(OBC.Worlds);
  const world = worlds.create();

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

  // Fragments uses a worker to manage BIM geometry.
  const fragments = components.get(OBC.FragmentsManager);

  fragments.init(
    `${import.meta.env.BASE_URL}worker.mjs`
  );

  // Update visible geometry when the camera moves.
  world.camera.controls.addEventListener(
    "update",
    () => fragments.core.update()
  );

  // Automatically attach loaded Fragments models.
  fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    fragments.core.update(true);
  });

  // IFC conversion is only needed when generating .frag.
  const ifcLoader = components.get(OBC.IfcLoader);

  await ifcLoader.setup({
    autoSetWasm: false,

    wasm: {
      path: new URL(
        `${import.meta.env.BASE_URL}wasm/`,
        window.location.origin
      ).href,

      absolute: true
    }
  });

  await world.camera.controls.setLookAt(
    25, 25, 25,
    0, 0, 0
  );

  return {
    components,
    world,
    fragments,
    ifcLoader
  };
}
