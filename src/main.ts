import './style.css';
import { crystalValleyBiome } from './config/crystalValley.biome';
import { Engine } from './core/Engine';
import { WaterSystem } from './world/WaterSystem';
import { RockSystem } from './world/RockSystem';
import { FoliageSystem } from './world/FoliageSystem';
import { ArchitectureSystem } from './world/ArchitectureSystem';
import { AIManager } from './ai/AIManager';
import { ParticleSystem } from './vfx/ParticleSystem';
import { SpatialAudio } from './audio/SpatialAudio';
import { RaycastPicker } from './interaction/RaycastPicker';
import { HudController } from './ui/HudController';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('luna-canvas') as HTMLCanvasElement | null;
  const hudRoot = document.getElementById('hud-root');
  if (!canvas || !hudRoot) {
    throw new Error('Missing #luna-canvas or #hud-root in index.html');
  }

  const engine = new Engine(canvas, crystalValleyBiome, 'medium');

  const water = new WaterSystem(
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    engine.assets,
    engine.bus,
  );
  const rocks = new RockSystem(
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    engine.assets,
  );
  const foliage = new FoliageSystem(
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    engine.assets,
    engine.bus,
    engine.getQualityProfile(),
  );
  const architecture = new ArchitectureSystem(
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    engine.assets,
    engine.bus,
  );

  engine.registerSystem(water);
  engine.registerSystem(rocks);
  engine.registerSystem(foliage);
  engine.registerSystem(architecture);

  // Initialize terrain-dependent world systems so rock obstacles exist before AI init
  water.init();
  rocks.init();
  foliage.init();
  architecture.init();
  architecture.applyQuality(engine.getQualityProfile());

  const combinedObstacles = [
    ...rocks.obstacles,
    ...foliage.obstacles,
    ...architecture.obstacles,
  ];

  const aiManager = new AIManager(
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    combinedObstacles,
    engine.assets,
    engine.bus,
  );
  const particles = new ParticleSystem(
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    engine.assets,
    engine.bus,
  );
  const audio = new SpatialAudio(
    engine.cameraRig.camera,
    engine.scene,
    crystalValleyBiome,
    engine.terrain.heightfield,
    engine.bus,
  );
  const picker = new RaycastPicker(
    canvas,
    engine.cameraRig.camera,
    engine.bus,
  );

  engine.registerSystem(aiManager);
  engine.registerSystem(particles);
  engine.registerSystem(audio);
  engine.registerSystem(picker);

  aiManager.init();
  particles.init();
  audio.init();
  picker.init();

  engine.cameraRig.setFollowResolver((id) => aiManager.resolveEntityObject(id));

  const interactables = [
    ...(water.waterMesh ? [water.waterMesh] : []),
    ...architecture.interactiveLanterns,
    ...foliage.interactiveTrees,
    ...aiManager.getClickableMeshes(),
    ...(engine.terrain.mesh ? [engine.terrain.mesh] : []),
  ];
  picker.setTargets(interactables);

  // Sync foliage instance counts & lantern point lights when quality tier changes
  engine.bus.on('quality:change', () => {
    const profile = engine.getQualityProfile();
    foliage.applyQuality(profile);
    architecture.applyQuality(profile);
  });

  const hud = new HudController(hudRoot, crystalValleyBiome, engine.bus);
  hud.init();

  if (import.meta.env.DEV) {
    const { DebugPanel } = await import('./debug/DebugPanel');
    const debugPanel = new DebugPanel(engine);
    debugPanel.init();
    engine.registerSystem({
      name: 'DebugPanel',
      init: () => {},
      update: () => debugPanel.update(),
      dispose: () => debugPanel.dispose(),
    });
  }

  if (window.__LUNA_DEBUG__) {
    window.__LUNA_DEBUG__.isReady = true;
    window.__LUNA_DEBUG__.getGrassCount = () => foliage.getActiveGrassCount();
    const origDispose = window.__LUNA_DEBUG__.disposeScene;
    window.__LUNA_DEBUG__.disposeScene = () => {
      hud.dispose();
      origDispose();
    };
  }

  engine.startLoop();
}

void bootstrap();
