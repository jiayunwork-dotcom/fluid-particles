import { SPHSystem } from '../physics/sphSystem';
import { Renderer } from '../webgl/renderer';
import {
  Vec2, ForceField, ForceFieldType, ToolType, Obstacle, Emitter, Sink,
  MaterialParams, SimParams, RenderMode, BrushPoint
} from '../types';
import { vec2, vec2Add, vec2Sub, vec2Mul, vec2Div, vec2Normalize, vec2Length, generateId } from '../utils/math';

export class UIController {
  private canvas: HTMLCanvasElement;
  private sphSystem: SPHSystem;
  private renderer: Renderer;
  
  private currentTool: ToolType = 'gravity';
  private isDrawing: boolean = false;
  private isDraggingObstacle: boolean = false;
  private draggedObstacle: Obstacle | null = null;
  private dragOffset: Vec2 = vec2(0, 0);
  private lastMousePos: Vec2 = vec2(0, 0);
  private mouseDownPos: Vec2 = vec2(0, 0);
  
  private drawingFlow: { start: Vec2; end: Vec2 } | null = null;
  private drawingObstacle: Vec2[] = [];
  private currentBrushPoints: BrushPoint[] = [];
  private lastBrushPos: Vec2 | null = null;
  
  private viewOffset: Vec2 = vec2(0, 0);
  private viewScale: number = 1;
  
  private isPaused: boolean = false;
  private isRecording: boolean = false;
  private recordFrames: number = 120;
  private recordFps: number = 30;
  private recordedFrames: ImageData[] = [];
  
  private forceStrength: number = 3000;
  private forceRadius: number = 100;
  private vortexClockwise: boolean = false;
  
  private onParamsChange: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    sphSystem: SPHSystem,
    renderer: Renderer
  ) {
    this.canvas = canvas;
    this.sphSystem = sphSystem;
    this.renderer = renderer;
    
    this.bindEvents();
  }

  setOnParamsChange(callback: () => void): void {
    this.onParamsChange = callback;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
    
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    
    this.setupToolbar();
    this.setupControlPanel();
    this.setupContextMenu();
  }

  private getCanvasPos(e: MouseEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return vec2(
      (e.clientX - rect.left) * dpr / this.viewScale - this.viewOffset.x,
      (e.clientY - rect.top) * dpr / this.viewScale - this.viewOffset.y
    );
  }

  private onMouseDown(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    this.mouseDownPos = { ...pos };
    this.lastMousePos = { ...pos };
    
    if (e.button === 2) {
      return;
    }
    
    if (e.button === 0) {
      if (e.shiftKey) {
        this.isDrawing = true;
        return;
      }
      
      const hitObstacle = this.hitTestObstacle(pos);
      if (hitObstacle) {
        this.isDraggingObstacle = true;
        this.draggedObstacle = hitObstacle;
        this.dragOffset = vec2Sub(pos, hitObstacle.position);
        return;
      }
      
      if (this.currentTool === 'eraser') {
        this.eraseAtPosition(pos);
        this.isDrawing = true;
      } else if (this.currentTool === 'brush') {
        this.isDrawing = true;
        this.currentBrushPoints = [];
        this.lastBrushPos = { ...pos };
      } else if (this.currentTool === 'flow') {
        this.isDrawing = true;
        this.drawingFlow = { start: { ...pos }, end: { ...pos } };
      } else if (this.currentTool === 'obstacle') {
        if (!this.isDrawing) {
          this.isDrawing = true;
          this.drawingObstacle = [{ ...pos }];
        }
      } else {
        this.placeForceField(pos);
        this.isDrawing = true;
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    const delta = vec2Sub(pos, this.lastMousePos);
    
    if (e.shiftKey && e.buttons & 1) {
      const strength = 5000;
      const radius = 80;
      const dir = vec2Normalize(delta);
      this.sphSystem.applyMouseForce(pos, dir, strength * vec2Length(delta), radius);
    }
    
    if (this.isDraggingObstacle && this.draggedObstacle) {
      const newPos = vec2Sub(pos, this.dragOffset);
      const vel = vec2Div(delta, 0.016);
      this.draggedObstacle.position = newPos;
      this.draggedObstacle.velocity = vel;
    } else if (this.isDrawing) {
      if (this.currentTool === 'eraser') {
        this.eraseAtPosition(pos);
      } else if (this.currentTool === 'brush' && this.lastBrushPos) {
        const dist = vec2Length(delta);
        if (dist > 5) {
          const dir = vec2Normalize(delta);
          this.currentBrushPoints.push({
            position: { ...pos },
            direction: dir,
            strength: this.forceStrength
          });
          this.lastBrushPos = { ...pos };
        }
      } else if (this.currentTool === 'flow' && this.drawingFlow) {
        this.drawingFlow.end = { ...pos };
      } else if (this.currentTool === 'obstacle') {
        const lastPoint = this.drawingObstacle[this.drawingObstacle.length - 1];
        if (vec2Length(vec2Sub(pos, lastPoint)) > 10) {
          this.drawingObstacle.push({ ...pos });
        }
      }
    }
    
    this.lastMousePos = { ...pos };
  }

  private onMouseUp(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    
    if (this.isDraggingObstacle) {
      this.isDraggingObstacle = false;
      if (this.draggedObstacle) {
        this.draggedObstacle.velocity = vec2(0, 0);
      }
      this.draggedObstacle = null;
    } else if (this.isDrawing) {
      if (this.currentTool === 'brush' && this.currentBrushPoints.length > 1) {
        const field: ForceField = {
          id: generateId(),
          type: 'brush',
          position: this.currentBrushPoints[0].position,
          strength: this.forceStrength,
          radius: this.forceRadius,
          brushPoints: [...this.currentBrushPoints]
        };
        this.sphSystem.addForceField(field);
        this.currentBrushPoints = [];
        this.lastBrushPos = null;
      } else if (this.currentTool === 'flow' && this.drawingFlow) {
        const dir = vec2Sub(this.drawingFlow.end, this.drawingFlow.start);
        const len = vec2Length(dir);
        if (len > 10) {
          const normDir = vec2Div(dir, len);
          const field: ForceField = {
            id: generateId(),
            type: 'flow',
            position: this.drawingFlow.start,
            strength: this.forceStrength,
            radius: this.forceRadius,
            direction: normDir,
            points: [this.drawingFlow.start, this.drawingFlow.end]
          };
          this.sphSystem.addForceField(field);
        }
        this.drawingFlow = null;
      } else if (this.currentTool === 'obstacle' && this.drawingObstacle.length > 2) {
        const obstacle: Obstacle = {
          id: generateId(),
          points: this.drawingObstacle.map(p => vec2Sub(p, this.drawingObstacle[0])),
          position: { ...this.drawingObstacle[0] },
          velocity: vec2(0, 0)
        };
        this.sphSystem.addObstacle(obstacle);
        this.drawingObstacle = [];
      }
      
      this.isDrawing = false;
    }
  }

  private onMouseLeave(e: MouseEvent): void {
    if (this.isDraggingObstacle) {
      this.isDraggingObstacle = false;
      this.draggedObstacle = null;
    }
    
    if (this.isDrawing) {
      if (this.currentTool === 'brush' && this.currentBrushPoints.length > 1) {
        const field: ForceField = {
          id: generateId(),
          type: 'brush',
          position: this.currentBrushPoints[0].position,
          strength: this.forceStrength,
          radius: this.forceRadius,
          brushPoints: [...this.currentBrushPoints]
        };
        this.sphSystem.addForceField(field);
      }
      this.currentBrushPoints = [];
      this.lastBrushPos = null;
      this.drawingFlow = null;
      this.isDrawing = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const mousePos = this.getCanvasPos(e);
    
    const newScale = Math.max(0.3, Math.min(3, this.viewScale * zoomFactor));
    const scaleRatio = newScale / this.viewScale;
    
    this.viewOffset.x = mousePos.x - (mousePos.x - this.viewOffset.x) * scaleRatio;
    this.viewOffset.y = mousePos.y - (mousePos.y - this.viewOffset.y) * scaleRatio;
    this.viewScale = newScale;
    
    this.renderer.setView(this.viewOffset, this.viewScale);
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    
    const menu = document.getElementById('contextMenu');
    if (menu) {
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      menu.style.display = 'block';
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePause();
    } else if (e.code === 'KeyR') {
      this.resetSimulation();
    } else if (e.code === 'Escape') {
      this.drawingObstacle = [];
      this.currentBrushPoints = [];
      this.drawingFlow = null;
      this.isDrawing = false;
      this.hideContextMenu();
    }
  }

  private setupToolbar(): void {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    
    const buttons = toolbar.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') as ForceFieldType;
        if (tool) {
          this.setCurrentTool(tool);
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
  }

  private setupControlPanel(): void {
    const particleCountSlider = document.getElementById('particleCount') as HTMLInputElement;
    const particleCountValue = document.getElementById('particleCountValue');
    if (particleCountSlider && particleCountValue) {
      particleCountSlider.addEventListener('input', () => {
        particleCountValue.textContent = particleCountSlider.value;
      });
      particleCountSlider.addEventListener('change', () => {
        this.sphSystem.setParticleCount(parseInt(particleCountSlider.value));
      });
    }
    
    const pauseBtn = document.getElementById('btnPause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePause());
    }
    
    const resetBtn = document.getElementById('btnReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetSimulation());
    }
    
    const presetBtns = document.querySelectorAll('.preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const material = btn.getAttribute('data-material');
        if (material) {
          this.applyMaterialPreset(material);
          presetBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
    
    this.setupSlider('restDensity', 'restDensityValue', (value) => {
      const params = this.sphSystem.getMaterialParams();
      params.restDensity = value;
      this.sphSystem.setMaterialParams(params);
    });
    
    this.setupSlider('viscosity', 'viscosityValue', (value) => {
      const params = this.sphSystem.getMaterialParams();
      params.viscosity = value;
      this.sphSystem.setMaterialParams(params);
    });
    
    this.setupSlider('stiffness', 'stiffnessValue', (value) => {
      const params = this.sphSystem.getMaterialParams();
      params.stiffness = value;
      this.sphSystem.setMaterialParams(params);
    });
    
    this.setupSlider('surfaceTension', 'surfaceTensionValue', (value) => {
      const params = this.sphSystem.getMaterialParams();
      params.surfaceTension = value;
      this.sphSystem.setMaterialParams(params);
    });
    
    this.setupSlider('gravity', 'gravityValue', (value) => {
      const params = this.sphSystem.getMaterialParams();
      params.gravity = value;
      this.sphSystem.setMaterialParams(params);
    });
    
    const renderBtns = document.querySelectorAll('.render-btn');
    renderBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-render') as RenderMode;
        if (mode) {
          this.renderer.setRenderMode(mode);
          renderBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
    
    this.setupSlider('particleSize', 'particleSizeValue', (value) => {
      this.renderer.setParticleSize(value);
    });
    
    this.setupSlider('forceFieldAlpha', 'forceFieldAlphaValue', (value) => {
      this.renderer.setForceFieldAlpha(value);
    }, true);
    
    const motionBlurCheck = document.getElementById('motionBlur') as HTMLInputElement;
    if (motionBlurCheck) {
      motionBlurCheck.addEventListener('change', () => {
        this.renderer.setMotionBlur(motionBlurCheck.checked);
      });
    }
    
    this.setupSlider('forceStrength', 'forceStrengthValue', (value) => {
      this.forceStrength = value;
    });
    
    this.setupSlider('forceRadius', 'forceRadiusValue', (value) => {
      this.forceRadius = value;
    });
    
    const vortexDir = document.getElementById('vortexDirection') as HTMLSelectElement;
    if (vortexDir) {
      vortexDir.addEventListener('change', () => {
        this.vortexClockwise = vortexDir.value === 'cw';
      });
    }
    
    this.setupSlider('boundaryRestitution', 'boundaryRestitutionValue', (value) => {
      const params = this.sphSystem.getSimParams();
      params.boundaryRestitution = value;
      this.sphSystem.setSimParams(params);
    }, true);
    
    const saveBtn = document.getElementById('btnSaveJSON');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveForceFields());
    }
    
    const loadBtn = document.getElementById('btnLoadJSON');
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (loadBtn && fileInput) {
      loadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => this.loadForceFields(e));
    }
    
    const recordBtn = document.getElementById('btnRecordGIF');
    if (recordBtn) {
      recordBtn.addEventListener('click', () => this.startRecording());
    }
    
    const stopRecordBtn = document.getElementById('btnStopRecord');
    if (stopRecordBtn) {
      stopRecordBtn.addEventListener('click', () => this.stopRecording());
    }
    
    this.setupSlider('recordFrames', 'recordFramesValue', (value) => {
      this.recordFrames = value;
    });
    
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('contextMenu');
      const toolbar = document.getElementById('toolbar');
      const controlPanel = document.getElementById('controlPanel');
      
      if (menu && 
          !menu.contains(e.target as Node) && 
          !(e.target as HTMLElement).closest('.toolbar') &&
          e.button !== 2) {
        menu.style.display = 'none';
      }
    });
  }

  private setupSlider(
    sliderId: string,
    valueId: string,
    callback: (value: number) => void,
    isFloat: boolean = false
  ): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const valueDisplay = document.getElementById(valueId);
    
    if (slider && valueDisplay) {
      slider.addEventListener('input', () => {
        const value = isFloat ? parseFloat(slider.value) : parseFloat(slider.value);
        valueDisplay.textContent = isFloat ? value.toFixed(2) : value.toString();
      });
      slider.addEventListener('change', () => {
        const value = isFloat ? parseFloat(slider.value) : parseFloat(slider.value);
        callback(value);
      });
    }
  }

  private setupContextMenu(): void {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    
    const items = menu.querySelectorAll('.context-item[data-tool]');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const tool = item.getAttribute('data-tool') as ForceFieldType;
        if (tool) {
          this.setCurrentTool(tool);
          this.updateToolbarActive(tool);
          this.hideContextMenu();
        }
      });
    });
    
    const clearAll = document.getElementById('clearAll');
    if (clearAll) {
      clearAll.addEventListener('click', () => {
        this.sphSystem.clearForceFields();
        this.hideContextMenu();
      });
    }
  }

  private hideContextMenu(): void {
    const menu = document.getElementById('contextMenu');
    if (menu) {
      menu.style.display = 'none';
    }
  }

  private updateToolbarActive(tool: ForceFieldType): void {
    const buttons = document.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-tool') === tool) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private setCurrentTool(tool: ForceFieldType): void {
    this.currentTool = tool;
    this.isDrawing = false;
    this.currentBrushPoints = [];
    this.drawingFlow = null;
    this.drawingObstacle = [];
  }

  private placeForceField(pos: Vec2): void {
    if (this.currentTool === 'gravity' || 
        this.currentTool === 'repel' || 
        this.currentTool === 'vortex') {
      const field: ForceField = {
        id: generateId(),
        type: this.currentTool,
        position: { ...pos },
        strength: this.forceStrength,
        radius: this.forceRadius,
        clockwise: this.vortexClockwise
      };
      this.sphSystem.addForceField(field);
    } else if (this.currentTool === 'emitter') {
      const emitter: Emitter = {
        id: generateId(),
        position: { ...pos },
        rate: 30,
        velocity: vec2(0, -200),
        lastEmit: 0
      };
      this.sphSystem.addEmitter(emitter);
      
      const field: ForceField = {
        id: emitter.id,
        type: 'emitter',
        position: { ...pos },
        strength: 0,
        radius: 30
      };
      this.sphSystem.addForceField(field);
    } else if (this.currentTool === 'sink') {
      const sink: Sink = {
        id: generateId(),
        position: { ...pos },
        radius: 40
      };
      this.sphSystem.addSink(sink);
      
      const field: ForceField = {
        id: sink.id,
        type: 'sink',
        position: { ...pos },
        strength: 0,
        radius: 40
      };
      this.sphSystem.addForceField(field);
    }
  }

  private eraseAtPosition(pos: Vec2): void {
    const fields = this.sphSystem.getForceFields();
    const eraseRadius = 30;
    
    for (const field of fields) {
      const dist = Math.sqrt(
        Math.pow(pos.x - field.position.x, 2) + 
        Math.pow(pos.y - field.position.y, 2)
      );
      if (dist < field.radius + eraseRadius) {
        this.sphSystem.removeForceField(field.id);
        
        if (field.type === 'emitter') {
          this.sphSystem.removeEmitter(field.id);
        } else if (field.type === 'sink') {
          this.sphSystem.removeSink(field.id);
        }
      }
    }
    
    const obstacles = this.sphSystem.getObstacles();
    for (const obstacle of obstacles) {
      const center = this.getObstacleCenter(obstacle);
      const dist = Math.sqrt(
        Math.pow(pos.x - center.x, 2) + 
        Math.pow(pos.y - center.y, 2)
      );
      if (dist < 50) {
        this.sphSystem.removeObstacle(obstacle.id);
      }
    }
  }

  private getObstacleCenter(obstacle: Obstacle): Vec2 {
    let sumX = 0, sumY = 0;
    for (const p of obstacle.points) {
      sumX += p.x + obstacle.position.x;
      sumY += p.y + obstacle.position.y;
    }
    return vec2(sumX / obstacle.points.length, sumY / obstacle.points.length);
  }

  private hitTestObstacle(pos: Vec2): Obstacle | null {
    const obstacles = this.sphSystem.getObstacles();
    
    for (const obstacle of obstacles) {
      const points = obstacle.points.map(p => vec2Add(p, obstacle.position));
      if (this.pointInPolygon(pos, points)) {
        return obstacle;
      }
    }
    
    return null;
  }

  private pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 0.0001) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  private togglePause(): void {
    this.isPaused = !this.isPaused;
    this.sphSystem.setPaused(this.isPaused);
    
    const pauseBtn = document.getElementById('btnPause');
    if (pauseBtn) {
      pauseBtn.textContent = this.isPaused ? '▶ 继续 (空格)' : '⏸ 暂停 (空格)';
    }
  }

  private resetSimulation(): void {
    this.sphSystem.reset();
    this.viewOffset = vec2(0, 0);
    this.viewScale = 1;
    this.renderer.setView(this.viewOffset, this.viewScale);
  }

  private applyMaterialPreset(material: string): void {
    let params: MaterialParams;
    
    switch (material) {
      case 'water':
        params = {
          restDensity: 1000,
          viscosity: 50,
          stiffness: 2000,
          surfaceTension: 20,
          gravity: -900
        };
        break;
      case 'oil':
        params = {
          restDensity: 900,
          viscosity: 150,
          stiffness: 1500,
          surfaceTension: 10,
          gravity: -700
        };
        break;
      case 'honey':
        params = {
          restDensity: 1400,
          viscosity: 400,
          stiffness: 3000,
          surfaceTension: 30,
          gravity: -1200
        };
        break;
      case 'sand':
        params = {
          restDensity: 1600,
          viscosity: 350,
          stiffness: 4000,
          surfaceTension: 0,
          gravity: -1500
        };
        break;
      default:
        return;
    }
    
    this.sphSystem.setMaterialParams(params);
    this.updateMaterialSliders(params);
  }

  private updateMaterialSliders(params: MaterialParams): void {
    const restDensity = document.getElementById('restDensity') as HTMLInputElement;
    const restDensityValue = document.getElementById('restDensityValue');
    if (restDensity && restDensityValue) {
      restDensity.value = params.restDensity.toString();
      restDensityValue.textContent = params.restDensity.toString();
    }
    
    const viscosity = document.getElementById('viscosity') as HTMLInputElement;
    const viscosityValue = document.getElementById('viscosityValue');
    if (viscosity && viscosityValue) {
      viscosity.value = params.viscosity.toString();
      viscosityValue.textContent = params.viscosity.toString();
    }
    
    const stiffness = document.getElementById('stiffness') as HTMLInputElement;
    const stiffnessValue = document.getElementById('stiffnessValue');
    if (stiffness && stiffnessValue) {
      stiffness.value = params.stiffness.toString();
      stiffnessValue.textContent = params.stiffness.toString();
    }
    
    const surfaceTension = document.getElementById('surfaceTension') as HTMLInputElement;
    const surfaceTensionValue = document.getElementById('surfaceTensionValue');
    if (surfaceTension && surfaceTensionValue) {
      surfaceTension.value = params.surfaceTension.toString();
      surfaceTensionValue.textContent = params.surfaceTension.toString();
    }
    
    const gravity = document.getElementById('gravity') as HTMLInputElement;
    const gravityValue = document.getElementById('gravityValue');
    if (gravity && gravityValue) {
      gravity.value = params.gravity.toString();
      gravityValue.textContent = params.gravity.toString();
    }
  }

  private saveForceFields(): void {
    const data = {
      forceFields: this.sphSystem.getForceFields(),
      obstacles: this.sphSystem.getObstacles(),
      emitters: this.sphSystem.getEmitters(),
      sinks: this.sphSystem.getSinks(),
      materialParams: this.sphSystem.getMaterialParams(),
      simParams: this.sphSystem.getSimParams()
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fluid-simulation.json';
    a.click();
    
    URL.revokeObjectURL(url);
  }

  private loadForceFields(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        
        this.sphSystem.clearForceFields();
        
        if (data.forceFields) {
          for (const field of data.forceFields) {
            this.sphSystem.addForceField(field);
          }
        }
        
        if (data.obstacles) {
          for (const obstacle of data.obstacles) {
            this.sphSystem.addObstacle(obstacle);
          }
        }
        
        if (data.emitters) {
          for (const emitter of data.emitters) {
            this.sphSystem.addEmitter(emitter);
          }
        }
        
        if (data.sinks) {
          for (const sink of data.sinks) {
            this.sphSystem.addSink(sink);
          }
        }
        
        if (data.materialParams) {
          this.sphSystem.setMaterialParams(data.materialParams);
          this.updateMaterialSliders(data.materialParams);
        }
        
        if (data.simParams) {
          this.sphSystem.setSimParams(data.simParams);
        }
        
      } catch (err) {
        console.error('Failed to load force fields:', err);
        alert('加载失败：无效的JSON文件');
      }
    };
    reader.readAsText(file);
    
    input.value = '';
  }

  private startRecording(): void {
    this.isRecording = true;
    this.recordedFrames = [];
    
    const indicator = document.getElementById('recordingIndicator');
    if (indicator) {
      indicator.style.display = 'flex';
    }
  }

  private stopRecording(): void {
    this.isRecording = false;
    
    const indicator = document.getElementById('recordingIndicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
    
    if (this.recordedFrames.length > 0) {
      this.exportGif();
    }
  }

  addRecordedFrame(frame: ImageData): void {
    if (this.isRecording && this.recordedFrames.length < this.recordFrames) {
      this.recordedFrames.push(frame);
    }
    
    if (this.recordedFrames.length >= this.recordFrames) {
      this.stopRecording();
    }
  }

  private exportGif(): void {
    alert(`录制完成！共 ${this.recordedFrames.length} 帧。\n（GIF编码需要额外的库支持，当前仅采集帧数据）`);
    
    const canvas = document.createElement('canvas');
    canvas.width = this.recordedFrames[0].width;
    canvas.height = this.recordedFrames[0].height;
    const ctx = canvas.getContext('2d');
    
    if (ctx && this.recordedFrames.length > 0) {
      ctx.putImageData(this.recordedFrames[0], 0, 0);
      
      const link = document.createElement('a');
      link.download = 'fluid-frame.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }

  isRecordingState(): boolean {
    return this.isRecording;
  }

  getViewScale(): number {
    return this.viewScale;
  }

  getViewOffset(): Vec2 {
    return { ...this.viewOffset };
  }

  getCurrentTool(): ToolType {
    return this.currentTool;
  }

  getDrawingFlow(): { start: Vec2; end: Vec2 } | null {
    return this.drawingFlow;
  }

  getDrawingObstacle(): Vec2[] {
    return [...this.drawingObstacle];
  }

  getCurrentBrushPoints(): BrushPoint[] {
    return [...this.currentBrushPoints];
  }
}
