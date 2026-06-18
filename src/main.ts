import { SPHSystem } from './physics/sphSystem';
import { Renderer } from './webgl/renderer';
import { UIController } from './ui/uiController';
import { MaterialParams, SimParams, Vec2 } from './types';
import { vec2 } from './utils/math';

class FluidSimulationApp {
  private canvas: HTMLCanvasElement;
  private sphSystem: SPHSystem;
  private renderer: Renderer;
  private uiController: UIController;
  
  private lastTime: number = 0;
  private frameCount: number = 0;
  private fps: number = 0;
  private fpsUpdateTime: number = 0;
  private animationFrameId: number = 0;
  private recordFrameCounter: number = 0;
  private recordInterval: number = 0;

  constructor() {
    this.canvas = document.getElementById('glCanvas') as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error('Canvas element not found');
    }
    
    this.resizeCanvas();
    
    const bounds = this.getSimulationBounds();
    
    const materialParams: MaterialParams = {
      restDensity: 1000,
      viscosity: 50,
      stiffness: 2000,
      surfaceTension: 20,
      gravity: -900
    };
    
    const simParams: SimParams = {
      particleCount: 5000,
      smoothingRadius: 30,
      boundaryRestitution: 0.5,
      dt: 0.025,
      maxVelocity: 800
    };
    
    this.sphSystem = new SPHSystem(5000, bounds, materialParams, simParams);
    this.renderer = new Renderer(this.canvas);
    this.uiController = new UIController(this.canvas, this.sphSystem, this.renderer);
    
    this.renderer.setMaxSpeed(simParams.maxVelocity);
    
    window.addEventListener('resize', () => this.onResize());
    
    this.start();
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
  }

  private getSimulationBounds(): { min: Vec2; max: Vec2 } {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width * dpr;
    const height = rect.height * dpr;
    
    return {
      min: vec2(0, 0),
      max: vec2(width, height)
    };
  }

  private onResize(): void {
    this.resizeCanvas();
    const bounds = this.getSimulationBounds();
    this.sphSystem.setBounds(bounds);
  }

  private start(): void {
    this.lastTime = performance.now();
    this.animate();
  }

  private animate(): void {
    const currentTime = performance.now();
    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.033);
    this.lastTime = currentTime;
    
    this.sphSystem.update(dt);
    
    const particles = this.sphSystem.getParticles();
    const forceFields = this.sphSystem.getForceFields();
    const obstacles = this.sphSystem.getObstacles();
    
    this.renderer.render(particles, forceFields, obstacles);
    
    if (this.uiController.isRecordingState()) {
      this.recordFrameCounter++;
      if (this.recordFrameCounter >= 2) {
        this.recordFrameCounter = 0;
        const frame = this.renderer.captureFrame();
        this.uiController.addRecordedFrame(frame);
      }
    }
    
    this.updateFPS(dt);
    
    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  private updateFPS(dt: number): void {
    this.frameCount++;
    this.fpsUpdateTime += dt;
    
    if (this.fpsUpdateTime >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsUpdateTime);
      this.frameCount = 0;
      this.fpsUpdateTime = 0;
      
      const fpsDisplay = document.getElementById('fpsDisplay');
      if (fpsDisplay) {
        fpsDisplay.textContent = `${this.fps} fps`;
      }
      
      const particleCountDisplay = document.getElementById('particleCountValue');
      if (particleCountDisplay) {
        const countSlider = document.getElementById('particleCount') as HTMLInputElement;
        if (countSlider && parseInt(countSlider.value) !== this.sphSystem.getParticleCount()) {
          particleCountDisplay.textContent = `${this.sphSystem.getParticleCount()}`;
        }
      }
    }
  }

  public getSPHSystem(): SPHSystem {
    return this.sphSystem;
  }

  public getRenderer(): Renderer {
    return this.renderer;
  }

  public getUIController(): UIController {
    return this.uiController;
  }
}

let app: FluidSimulationApp | null = null;

document.addEventListener('DOMContentLoaded', () => {
  try {
    app = new FluidSimulationApp();
    console.log('Fluid simulation initialized successfully');
  } catch (error) {
    console.error('Failed to initialize fluid simulation:', error);
    alert('初始化失败: ' + (error as Error).message);
  }
});

export { FluidSimulationApp, app };
