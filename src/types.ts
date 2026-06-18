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
  temperature: number;
}

export type ColoringMode = 'velocity' | 'density' | 'pressure' | 'temperature';

export interface ColorStop {
  position: number;
  color: string;
}

export interface ColormapPreset {
  name: string;
  stops: ColorStop[];
}

export interface AnalysisRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface RegionStats {
  particleCount: number;
  avgVelocity: number;
  maxVelocity: number;
  avgDensity: number;
  avgPressure: number;
  avgTemperature: number;
}

export interface HistogramData {
  bins: number[];
  minValue: number;
  maxValue: number;
  mean: number;
  stdDev: number;
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

export interface TrajectoryFrame {
  timestamp: number;
  frameIndex: number;
  positions: Float32Array;
  velocities: Float32Array;
}

export interface TrajectoryData {
  version: number;
  particleCount: number;
  totalFrames: number;
  frameInterval: number;
  startTime: number;
  endTime: number;
  frames: TrajectoryFrame[];
}

export interface TrajectoryState {
  isRecording: boolean;
  isPlaying: boolean;
  currentFrameIndex: number;
  playbackSpeed: number;
  selectedParticleIndices: number[];
  playheadTime: number;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  isSelecting: boolean;
}
