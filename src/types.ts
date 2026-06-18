export interface Vec2 {
  x: number;
  y: number;
}

export interface Particle {
  position: Vec2;
  velocity: Vec2;
  prevPosition: Vec2;
  prevVelocity: Vec2;
  density: number;
  pressure: number;
  force: Vec2;
}

export type ForceFieldType = 'gravity' | 'repel' | 'vortex' | 'flow' | 'brush' | 'obstacle' | 'emitter' | 'sink';

export type ToolType = ForceFieldType | 'eraser';

export interface ForceField {
  id: string;
  type: ForceFieldType;
  position: Vec2;
  strength: number;
  radius: number;
  direction?: Vec2;
  clockwise?: boolean;
  points?: Vec2[];
  brushPoints?: BrushPoint[];
}

export interface BrushPoint {
  position: Vec2;
  direction: Vec2;
  strength: number;
}

export interface Obstacle {
  id: string;
  points: Vec2[];
  position: Vec2;
  velocity: Vec2;
}

export interface Emitter {
  id: string;
  position: Vec2;
  rate: number;
  velocity: Vec2;
  lastEmit: number;
}

export interface Sink {
  id: string;
  position: Vec2;
  radius: number;
}

export interface MaterialParams {
  restDensity: number;
  viscosity: number;
  stiffness: number;
  surfaceTension: number;
  gravity: number;
}

export interface SimParams {
  particleCount: number;
  smoothingRadius: number;
  boundaryRestitution: number;
  dt: number;
  maxVelocity: number;
}

export type RenderMode = 'sprite' | 'fluid';

export interface ForceFieldBrushState {
  isDrawing: boolean;
  lastPosition: Vec2 | null;
  currentField: ForceField | null;
}

export interface ObstacleDrawState {
  isDrawing: boolean;
  points: Vec2[];
}
