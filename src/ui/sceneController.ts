import { SPHSystem } from '../physics/sphSystem';
import { Renderer } from '../webgl/renderer';
import { UIController } from './uiController';
import { AnalysisController } from './analysisController';
import {
  SceneData, ForceField, Obstacle, Emitter, Sink,
  MaterialParams, RenderMode, ColoringMode, ColorStop, Vec2
} from '../types';
import { generateId, vec2 } from '../utils/math';

const STORAGE_KEY = 'fluid-scenes';
const MAX_SCENES = 10;

export class SceneController {
  private sphSystem: SPHSystem;
  private renderer: Renderer;
  private uiController: UIController;
  private analysisController: AnalysisController;

  private scenes: SceneData[] = [];
  private builtinSceneIds: Set<string> = new Set();

  private onSceneListChange: (() => void) | null = null;

  constructor(
    sphSystem: SPHSystem,
    renderer: Renderer,
    uiController: UIController,
    analysisController: AnalysisController
  ) {
    this.sphSystem = sphSystem;
    this.renderer = renderer;
    this.uiController = uiController;
    this.analysisController = analysisController;

    this.initBuiltinScenes();
    this.loadFromStorage();
  }

  setOnSceneListChange(callback: () => void): void {
    this.onSceneListChange = callback;
  }

  private initBuiltinScenes(): void {
    const bounds = this.sphSystem.getBounds();
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const centerX = bounds.min.x + width / 2;
    const centerY = bounds.min.y + height / 2;

    const waterfall = this.createWaterfallScene(centerX, centerY, width, height, bounds.min.y);
    const vortex = this.createVortexScene(centerX, centerY, width, height);
    const hourglass = this.createHourglassScene(centerX, centerY, width, height);

    this.builtinSceneIds.add(waterfall.id);
    this.builtinSceneIds.add(vortex.id);
    this.builtinSceneIds.add(hourglass.id);

    this.scenes.push(waterfall, vortex, hourglass);
  }

  private createWaterfallScene(centerX: number, centerY: number, width: number, height: number, minY: number): SceneData {
    const emitter: Emitter = {
      id: generateId(),
      position: vec2(centerX, minY + 100),
      rate: 60,
      velocity: vec2(0, 500),
      lastEmit: 0
    };

    const emitterField: ForceField = {
      id: emitter.id,
      type: 'emitter',
      position: { ...emitter.position },
      strength: 0,
      radius: 30
    };

    const repelId = generateId();
    const repelField: ForceField = {
      id: repelId,
      type: 'repel',
      position: vec2(centerX, height - 80),
      strength: 8000,
      radius: 150
    };

    return {
      id: generateId(),
      name: '瀑布',
      createdAt: Date.now(),
      particleCount: 6000,
      materialParams: {
        restDensity: 1000,
        viscosity: 50,
        stiffness: 2000,
        surfaceTension: 20,
        gravity: -1200
      },
      simParams: {
        boundaryRestitution: 0.3
      },
      forceFields: [emitterField, repelField],
      obstacles: [],
      emitters: [emitter],
      sinks: [],
      renderMode: 'fluid',
      particleSize: 8,
      coloringMode: 'velocity',
      colormapPresetName: '冷暖',
      colorStops: [
        { position: 0, color: '#0000ff' },
        { position: 0.5, color: '#ffffff' },
        { position: 1, color: '#ff0000' }
      ]
    };
  }

  private createVortexScene(centerX: number, centerY: number, width: number, height: number): SceneData {
    const vortexId = generateId();
    const vortexField: ForceField = {
      id: vortexId,
      type: 'vortex',
      position: vec2(centerX, centerY),
      strength: 5000,
      radius: Math.min(width, height) * 0.4,
      clockwise: false
    };

    return {
      id: generateId(),
      name: '漩涡',
      createdAt: Date.now(),
      particleCount: 5000,
      materialParams: {
        restDensity: 900,
        viscosity: 150,
        stiffness: 1500,
        surfaceTension: 10,
        gravity: 0
      },
      simParams: {
        boundaryRestitution: 0.7
      },
      forceFields: [vortexField],
      obstacles: [],
      emitters: [],
      sinks: [],
      renderMode: 'sprite',
      particleSize: 6,
      coloringMode: 'velocity',
      colormapPresetName: '彩虹',
      colorStops: [
        { position: 0, color: '#8b00ff' },
        { position: 0.2, color: '#0000ff' },
        { position: 0.4, color: '#00ff00' },
        { position: 0.6, color: '#ffff00' },
        { position: 0.8, color: '#ff8c00' },
        { position: 1, color: '#ff0000' }
      ]
    };
  }

  private createHourglassScene(centerX: number, centerY: number, width: number, height: number): SceneData {
    const gapSize = 30;
    const obsWidth = width * 0.4;

    const leftObsId = generateId();
    const rightObsId = generateId();

    const leftObstacle: Obstacle = {
      id: leftObsId,
      position: vec2(centerX - obsWidth / 2 - gapSize / 2, centerY - 15),
      points: [
        vec2(0, 0),
        vec2(obsWidth, 0),
        vec2(obsWidth, 30),
        vec2(0, 30)
      ],
      velocity: vec2(0, 0)
    };

    const rightObstacle: Obstacle = {
      id: rightObsId,
      position: vec2(centerX + gapSize / 2, centerY - 15),
      points: [
        vec2(0, 0),
        vec2(obsWidth, 0),
        vec2(obsWidth, 30),
        vec2(0, 30)
      ],
      velocity: vec2(0, 0)
    };

    return {
      id: generateId(),
      name: '沙漏',
      createdAt: Date.now(),
      particleCount: 4000,
      materialParams: {
        restDensity: 1600,
        viscosity: 350,
        stiffness: 4000,
        surfaceTension: 0,
        gravity: -600
      },
      simParams: {
        boundaryRestitution: 0.2
      },
      forceFields: [],
      obstacles: [leftObstacle, rightObstacle],
      emitters: [],
      sinks: [],
      renderMode: 'sprite',
      particleSize: 5,
      coloringMode: 'density',
      colormapPresetName: '灰度',
      colorStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' }
      ]
    };
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.scenes)) {
          for (const scene of data.scenes) {
            if (!this.isBuiltinScene(scene.id)) {
              this.scenes.push(scene);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load scenes from storage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      const userScenes = this.scenes.filter(s => !this.isBuiltinScene(s.id));
      const data = {
        version: 1,
        scenes: userScenes
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save scenes to storage:', e);
    }
  }

  isBuiltinScene(id: string): boolean {
    return this.builtinSceneIds.has(id);
  }

  getAllScenes(): SceneData[] {
    return [...this.scenes];
  }

  private getActiveColormapPresetName(): string {
    const allPresets = this.analysisController.getAllPresets();
    const currentStops = this.analysisController.getColorStops();

    for (const preset of allPresets) {
      if (preset.stops.length === currentStops.length) {
        let match = true;
        for (let i = 0; i < preset.stops.length; i++) {
          if (preset.stops[i].position !== currentStops[i].position ||
              preset.stops[i].color !== currentStops[i].color) {
            match = false;
            break;
          }
        }
        if (match) return preset.name;
      }
    }
    return '';
  }

  saveCurrentScene(name: string): SceneData | null {
    const userScenes = this.scenes.filter(s => !this.isBuiltinScene(s.id));
    if (userScenes.length >= MAX_SCENES) {
      const oldest = userScenes.reduce((a, b) => a.createdAt < b.createdAt ? a : b);
      this.scenes = this.scenes.filter(s => s.id !== oldest.id);
    }

    const scene: SceneData = {
      id: generateId(),
      name,
      createdAt: Date.now(),
      particleCount: this.sphSystem.getParticleCount(),
      materialParams: this.sphSystem.getMaterialParams(),
      simParams: {
        boundaryRestitution: this.sphSystem.getSimParams().boundaryRestitution
      },
      forceFields: this.sphSystem.getForceFields(),
      obstacles: this.sphSystem.getObstacles(),
      emitters: this.sphSystem.getEmitters(),
      sinks: this.sphSystem.getSinks(),
      renderMode: this.renderer.getRenderMode(),
      particleSize: this.renderer.getParticleSize(),
      coloringMode: this.analysisController.getColoringMode(),
      colormapPresetName: this.getActiveColormapPresetName(),
      colorStops: this.analysisController.getColorStops()
    };

    this.scenes.push(scene);
    this.saveToStorage();
    this.onSceneListChange?.();
    return scene;
  }

  deleteScene(id: string): boolean {
    if (this.isBuiltinScene(id)) return false;

    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return false;

    this.scenes = this.scenes.filter(s => s.id !== id);
    this.saveToStorage();
    this.onSceneListChange?.();
    return true;
  }

  renameScene(id: string, newName: string): boolean {
    if (this.isBuiltinScene(id)) return false;

    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return false;

    scene.name = newName;
    this.saveToStorage();
    this.onSceneListChange?.();
    return true;
  }

  loadScene(id: string): string | null {
    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return null;

    this.sphSystem.clearForceFields();

    for (const field of scene.forceFields) {
      this.sphSystem.addForceField({ ...field });
    }

    for (const obstacle of scene.obstacles) {
      this.sphSystem.addObstacle({
        ...obstacle,
        points: obstacle.points.map(p => ({ ...p }))
      });
    }

    for (const emitter of scene.emitters) {
      this.sphSystem.addEmitter({ ...emitter });
    }

    for (const sink of scene.sinks) {
      this.sphSystem.addSink({ ...sink });
    }

    this.sphSystem.setMaterialParams({ ...scene.materialParams });
    this.updateMaterialSliders(scene.materialParams);

    const simParams = this.sphSystem.getSimParams();
    simParams.boundaryRestitution = scene.simParams.boundaryRestitution;
    this.sphSystem.setSimParams(simParams);
    this.updateSlider('boundaryRestitution', 'boundaryRestitutionValue', scene.simParams.boundaryRestitution, true);

    this.renderer.setRenderMode(scene.renderMode);
    this.updateRenderModeButtons(scene.renderMode);

    this.renderer.setParticleSize(scene.particleSize);
    this.updateSlider('particleSize', 'particleSizeValue', scene.particleSize, true);

    this.analysisController.setColoringMode(scene.coloringMode);
    this.updateColoringModeButtons(scene.coloringMode);

    if (scene.colormapPresetName) {
      const allPresets = this.analysisController.getAllPresets();
      const preset = allPresets.find(p => p.name === scene.colormapPresetName);
      if (preset) {
        this.analysisController.applyPreset(preset);
        this.updateColormapSelector(scene.colormapPresetName);
      } else if (scene.colorStops && scene.colorStops.length > 0) {
        this.applyColorStopsDirectly(scene.colorStops);
      }
    } else if (scene.colorStops && scene.colorStops.length > 0) {
      this.applyColorStopsDirectly(scene.colorStops);
    }

    this.sphSystem.setParticleCount(scene.particleCount);
    this.updateSlider('particleCount', 'particleCountValue', scene.particleCount, false);

    return scene.name;
  }

  private applyColorStopsDirectly(stops: ColorStop[]): void {
    const currentStops = this.analysisController.getColorStops();
    while (currentStops.length > 0) {
      this.analysisController.removeColorStop(0);
      if (this.analysisController.getColorStops().length === currentStops.length) break;
    }
    for (let i = 0; i < stops.length; i++) {
      this.analysisController.addColorStop(stops[i].position, stops[i].color);
    }
  }

  private updateMaterialSliders(params: MaterialParams): void {
    this.updateSlider('restDensity', 'restDensityValue', params.restDensity, false);
    this.updateSlider('viscosity', 'viscosityValue', params.viscosity, false);
    this.updateSlider('stiffness', 'stiffnessValue', params.stiffness, false);
    this.updateSlider('surfaceTension', 'surfaceTensionValue', params.surfaceTension, false);
    this.updateSlider('gravity', 'gravityValue', params.gravity, false);

    const presetBtns = document.querySelectorAll('.preset-btn');
    presetBtns.forEach(b => b.classList.remove('active'));
  }

  private updateSlider(sliderId: string, valueId: string, value: number, isFloat: boolean): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const valueDisplay = document.getElementById(valueId);
    if (slider) {
      slider.value = value.toString();
    }
    if (valueDisplay) {
      valueDisplay.textContent = isFloat ? value.toFixed(2) : value.toString();
    }
  }

  private updateRenderModeButtons(mode: RenderMode): void {
    const btns = document.querySelectorAll('.render-btn');
    btns.forEach(btn => {
      const btnMode = btn.getAttribute('data-render');
      if (btnMode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private updateColoringModeButtons(mode: ColoringMode): void {
    const btns = document.querySelectorAll('.coloring-mode-btn');
    btns.forEach(btn => {
      const btnMode = btn.getAttribute('data-mode');
      if (btnMode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private updateColormapSelector(name: string): void {
    const selector = document.getElementById('colormapPreset') as HTMLSelectElement;
    if (selector) {
      selector.value = name;
    }
  }

  exportAllScenes(): void {
    const userScenes = this.scenes.filter(s => !this.isBuiltinScene(s.id));
    const data = {
      version: 1,
      exportedAt: Date.now(),
      scenes: userScenes
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `fluid-scenes-${this.formatDateForFilename(Date.now())}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  importScenes(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          let imported = 0;

          if (data && Array.isArray(data.scenes)) {
            for (const scene of data.scenes) {
              const exists = this.scenes.some(s => s.name === scene.name);
              if (!exists && !this.isBuiltinScene(scene.id)) {
                const userScenes = this.scenes.filter(s => !this.isBuiltinScene(s.id));
                if (userScenes.length >= MAX_SCENES) break;

                scene.id = generateId();
                scene.createdAt = Date.now();
                this.scenes.push(scene);
                imported++;
              }
            }
          }

          this.saveToStorage();
          this.onSceneListChange?.();
          resolve(imported);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  }

  private formatDateForFilename(timestamp: number): string {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}`;
  }

  showLoadedToast(name: string): void {
    let toast = document.getElementById('sceneLoadedToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sceneLoadedToast';
      toast.className = 'scene-loaded-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = `已加载: ${name}`;
    toast.style.display = 'block';
    toast.classList.add('visible');

    setTimeout(() => {
      if (toast) {
        toast.classList.remove('visible');
        setTimeout(() => {
          if (toast) toast.style.display = 'none';
        }, 300);
      }
    }, 1500);
  }
}
