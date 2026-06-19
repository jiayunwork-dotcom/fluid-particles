import { Particle, ForceField, Obstacle, Vec2, RenderMode, TrajectoryFrame, ColoringMode, ColorStop, AnalysisRegion } from '../types';
import { createProgramFromSources, createBuffer, createTexture, createFramebuffer, resizeCanvas } from './glUtils';
import {
  particleSpriteVS, particleSpriteFS,
  depthVS, depthFS,
  blurVS, blurFS,
  normalVS, normalFS,
  fluidShadeVS, fluidShadeFS,
  forceFieldVS, forceFieldFS,
  lineVS, lineFS,
  obstacleVS, obstacleFS,
  backgroundVS, backgroundFS
} from '../shaders/shaders';
import { vec2Length, vec2Add, vec2Sub, vec2Normalize, vec2Perp, generateId } from '../utils/math';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0, g: 0, b: 0 };
}

export class Renderer {
  private gl: WebGLRenderingContext;
  private canvas: HTMLCanvasElement;
  private programs: { [key: string]: WebGLProgram } = {};
  private buffers: { [key: string]: WebGLBuffer } = {};
  private textures: { [key: string]: WebGLTexture } = {};
  private framebuffers: { [key: string]: WebGLFramebuffer } = {};
  
  private renderMode: RenderMode = 'sprite';
  private particleSize: number = 8;
  private forceFieldAlpha: number = 0.6;
  private motionBlur: boolean = true;
  private maxSpeed: number = 500;
  
  private viewOffset: Vec2 = { x: 0, y: 0 };
  private viewScale: number = 1;
  
  private particlePositionData: Float32Array = new Float32Array(0);
  private particleVelocityData: Float32Array = new Float32Array(0);
  private particleSpeedData: Float32Array = new Float32Array(0);
  private particleColorValueData: Float32Array = new Float32Array(0);
  private particlePositionBuffer: WebGLBuffer | null = null;
  private particleVelocityBuffer: WebGLBuffer | null = null;
  private particleSpeedBuffer: WebGLBuffer | null = null;
  private particleColorValueBuffer: WebGLBuffer | null = null;
  private particleBufferSize: number = 0;
  
  private coloringMode: ColoringMode = 'velocity';
  private useColormap: boolean = true;
  private colormapTexture: WebGLTexture | null = null;
  private colormapStops: ColorStop[] = [];
  
  currentColorMin: number = 0;
  currentColorMax: number = 0;
  currentColorRange: number = 0;
  
  private analysisRegions: AnalysisRegion[] = [];
  
  private selectedParticleIndices: number[] = [];
  private selectedParticlePositionData: Float32Array = new Float32Array(0);
  private selectedParticlePositionBuffer: WebGLBuffer | null = null;
  private readonly MAX_SELECTED_PARTICLES: number = 200;
  
  private quadPositions: Float32Array;
  private quadTexCoords: Float32Array;
  
  private maxParticles: number = 15000;
  
  private lineVertexData: Float32Array = new Float32Array(0);
  private lineColorData: Float32Array = new Float32Array(0);
  private lineVertexBuffer: WebGLBuffer | null = null;
  private lineColorBuffer: WebGLBuffer | null = null;
  private lineCount: number = 0;
  private maxLines: number = 5000;
  
  private lineUniforms: { [key: string]: WebGLUniformLocation | null } = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
    
    if (!gl) {
      throw new Error('WebGL is not supported');
    }
    
    this.gl = gl;
    this.quadPositions = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
       1, -1,  1,  1,  -1, 1
    ]);
    this.quadTexCoords = new Float32Array([
      0, 0,  1, 0,  0, 1,
      1, 0,  1, 1,  0, 1
    ]);
    
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    
    this.programs.particleSprite = createProgramFromSources(gl, particleSpriteVS, particleSpriteFS);
    this.programs.depth = createProgramFromSources(gl, depthVS, depthFS);
    this.programs.blur = createProgramFromSources(gl, blurVS, blurFS);
    this.programs.normal = createProgramFromSources(gl, normalVS, normalFS);
    this.programs.fluidShade = createProgramFromSources(gl, fluidShadeVS, fluidShadeFS);
    this.programs.forceField = createProgramFromSources(gl, forceFieldVS, forceFieldFS);
    this.programs.line = createProgramFromSources(gl, lineVS, lineFS);
    this.programs.obstacle = createProgramFromSources(gl, obstacleVS, obstacleFS);
    this.programs.background = createProgramFromSources(gl, backgroundVS, backgroundFS);
    
    this.buffers.quadPosition = createBuffer(gl, this.quadPositions);
    this.buffers.quadTexCoord = createBuffer(gl, this.quadTexCoords);
    
    this.particlePositionData = new Float32Array(this.maxParticles * 2);
    this.particleVelocityData = new Float32Array(this.maxParticles * 2);
    this.particleSpeedData = new Float32Array(this.maxParticles);
    this.particleColorValueData = new Float32Array(this.maxParticles);
    
    this.particlePositionBuffer = createBuffer(gl, this.particlePositionData, gl.DYNAMIC_DRAW);
    this.particleVelocityBuffer = createBuffer(gl, this.particleVelocityData, gl.DYNAMIC_DRAW);
    this.particleSpeedBuffer = createBuffer(gl, this.particleSpeedData, gl.DYNAMIC_DRAW);
    this.particleColorValueBuffer = createBuffer(gl, this.particleColorValueData, gl.DYNAMIC_DRAW);
    this.particleBufferSize = this.maxParticles;
    
    this.colormapTexture = gl.createTexture();
    this.updateColormapTexture([
      { position: 0, color: '#0000ff' },
      { position: 1, color: '#ff0000' }
    ]);
    
    this.lineVertexData = new Float32Array(this.maxLines * 2 * 2);
    this.lineColorData = new Float32Array(this.maxLines * 2 * 4);
    this.lineVertexBuffer = createBuffer(gl, this.lineVertexData, gl.DYNAMIC_DRAW);
    this.lineColorBuffer = createBuffer(gl, this.lineColorData, gl.DYNAMIC_DRAW);
    
    this.selectedParticlePositionData = new Float32Array(this.MAX_SELECTED_PARTICLES * 2);
    this.selectedParticlePositionBuffer = createBuffer(gl, this.selectedParticlePositionData, gl.DYNAMIC_DRAW);
    
    const lineProg = this.programs.line;
    gl.useProgram(lineProg);
    this.lineUniforms.u_resolution = gl.getUniformLocation(lineProg, 'u_resolution');
    this.lineUniforms.u_viewOffset = gl.getUniformLocation(lineProg, 'u_viewOffset');
    this.lineUniforms.u_viewScale = gl.getUniformLocation(lineProg, 'u_viewScale');
    this.lineUniforms.u_useVertexColor = gl.getUniformLocation(lineProg, 'u_useVertexColor');
    this.lineUniforms.u_color = gl.getUniformLocation(lineProg, 'u_color');
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    this.createRenderTargets();
  }

  private createRenderTargets(): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    if (this.textures.depth) {
      gl.deleteTexture(this.textures.depth);
      gl.deleteFramebuffer(this.framebuffers.depth);
    }
    if (this.textures.blurH) {
      gl.deleteTexture(this.textures.blurH);
      gl.deleteFramebuffer(this.framebuffers.blurH);
    }
    if (this.textures.blurV) {
      gl.deleteTexture(this.textures.blurV);
      gl.deleteFramebuffer(this.framebuffers.blurV);
    }
    if (this.textures.normal) {
      gl.deleteTexture(this.textures.normal);
      gl.deleteFramebuffer(this.framebuffers.normal);
    }
    
    this.textures.depth = createTexture(gl, {
      width, height,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR
    });
    this.framebuffers.depth = createFramebuffer(gl, this.textures.depth);
    
    this.textures.blurH = createTexture(gl, {
      width, height,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR
    });
    this.framebuffers.blurH = createFramebuffer(gl, this.textures.blurH);
    
    this.textures.blurV = createTexture(gl, {
      width, height,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR
    });
    this.framebuffers.blurV = createFramebuffer(gl, this.textures.blurV);
    
    this.textures.normal = createTexture(gl, {
      width, height,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR
    });
    this.framebuffers.normal = createFramebuffer(gl, this.textures.normal);
  }

  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
  }

  setParticleSize(size: number): void {
    this.particleSize = size;
  }

  setForceFieldAlpha(alpha: number): void {
    this.forceFieldAlpha = alpha;
  }

  setMotionBlur(enabled: boolean): void {
    this.motionBlur = enabled;
  }

  setMaxSpeed(speed: number): void {
    this.maxSpeed = speed;
  }

  getRenderMode(): RenderMode {
    return this.renderMode;
  }

  getParticleSize(): number {
    return this.particleSize;
  }

  setColoringMode(mode: ColoringMode): void {
    this.coloringMode = mode;
    this.useColormap = true;
  }

  getColoringMode(): ColoringMode {
    return this.coloringMode;
  }

  updateColormapTexture(stops: ColorStop[]): void {
    this.colormapStops = stops;
    const gl = this.gl;
    const textureSize = 256;
    const pixels = new Uint8Array(textureSize * 4);

    const sortedStops = [...stops].sort((a, b) => a.position - b.position);

    for (let i = 0; i < textureSize; i++) {
      const t = i / (textureSize - 1);
      let r = 0, g = 0, b = 0;

      if (sortedStops.length === 0) {
        r = 128; g = 128; b = 128;
      } else if (sortedStops.length === 1) {
        const rgb = hexToRgb(sortedStops[0].color);
        r = Math.round(rgb.r * 255);
        g = Math.round(rgb.g * 255);
        b = Math.round(rgb.b * 255);
      } else {
        if (t <= sortedStops[0].position) {
          const rgb = hexToRgb(sortedStops[0].color);
          r = Math.round(rgb.r * 255);
          g = Math.round(rgb.g * 255);
          b = Math.round(rgb.b * 255);
        } else if (t >= sortedStops[sortedStops.length - 1].position) {
          const rgb = hexToRgb(sortedStops[sortedStops.length - 1].color);
          r = Math.round(rgb.r * 255);
          g = Math.round(rgb.g * 255);
          b = Math.round(rgb.b * 255);
        } else {
          for (let j = 0; j < sortedStops.length - 1; j++) {
            if (t >= sortedStops[j].position && t <= sortedStops[j + 1].position) {
              const range = sortedStops[j + 1].position - sortedStops[j].position;
              const localT = range > 0 ? (t - sortedStops[j].position) / range : 0;
              const rgb1 = hexToRgb(sortedStops[j].color);
              const rgb2 = hexToRgb(sortedStops[j + 1].color);
              r = Math.round((rgb1.r + (rgb2.r - rgb1.r) * localT) * 255);
              g = Math.round((rgb1.g + (rgb2.g - rgb1.g) * localT) * 255);
              b = Math.round((rgb1.b + (rgb2.b - rgb1.b) * localT) * 255);
              break;
            }
          }
        }
      }

      pixels[i * 4] = r;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = 255;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSize, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setAnalysisRegions(regions: AnalysisRegion[]): void {
    this.analysisRegions = regions;
  }

  setSelectedParticleIndices(indices: number[]): void {
    this.selectedParticleIndices = indices.slice(0, this.MAX_SELECTED_PARTICLES);
  }

  getSelectedParticleIndices(): number[] {
    return [...this.selectedParticleIndices];
  }

  setView(offset: Vec2, scale: number): void {
    this.viewOffset = offset;
    this.viewScale = scale;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getGL(): WebGLRenderingContext {
    return this.gl;
  }

  private particleCount: number = 0;
  
  render(
    particles: Particle[],
    forceFields: ForceField[],
    obstacles: Obstacle[]
  ): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    this.particleCount = this.updateParticleData(particles);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.02, 0.02, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    this.renderBackground();
    
    if (this.renderMode === 'sprite') {
      this.renderParticlesSprite();
    } else {
      this.renderFluid();
    }
    
    this.renderObstacles(obstacles);
    this.renderForceFields(forceFields);
  }

  private updateParticleData(particles: Particle[]): number {
    const count = Math.min(particles.length, this.maxParticles);
    const gl = this.gl;
    
    const posData = this.particlePositionData;
    const velData = this.particleVelocityData;
    const speedData = this.particleSpeedData;
    const colorValueData = this.particleColorValueData;
    
    let minVal = Infinity, maxVal = -Infinity;
    const values: number[] = [];
    
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const px = p.position.x;
      const py = p.position.y;
      const vx = p.velocity.x;
      const vy = p.velocity.y;
      
      posData[i * 2] = px;
      posData[i * 2 + 1] = py;
      velData[i * 2] = vx;
      velData[i * 2 + 1] = vy;
      const speed = Math.sqrt(vx * vx + vy * vy);
      speedData[i] = speed;
      
      let val: number;
      switch (this.coloringMode) {
        case 'velocity':
          val = speed;
          break;
        case 'density':
          val = p.density;
          break;
        case 'pressure':
          val = p.pressure;
          break;
        case 'temperature':
          val = p.temperature;
          break;
        default:
          val = speed;
      }
      values.push(val);
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
    
    const range = maxVal - minVal;
    const EPSILON = 0.0001;
    
    if (range > EPSILON) {
      const invRange = 1 / range;
      for (let i = 0; i < count; i++) {
        colorValueData[i] = (values[i] - minVal) * invRange;
      }
    } else {
      const neutralVal = 0.5;
      for (let i = 0; i < count; i++) {
        colorValueData[i] = neutralVal;
      }
    }
    // 保存min/max供外部调试使用
    this.currentColorMin = minVal;
    this.currentColorMax = maxVal;
    this.currentColorRange = range;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData.subarray(0, count * 2));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVelocityBuffer!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, velData.subarray(0, count * 2));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleSpeedBuffer!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, speedData.subarray(0, count));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleColorValueBuffer!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colorValueData.subarray(0, count));
    
    return count;
  }

  private renderBackground(): void {
    const gl = this.gl;
    const program = this.programs.background;
    
    gl.useProgram(program);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadPosition);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadTexCoord);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private renderParticlesSprite(): void {
    if (this.particleCount === 0) return;
    
    const gl = this.gl;
    const program = this.programs.particleSprite;
    const count = this.particleCount;
    
    gl.useProgram(program);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const velLoc = gl.getAttribLocation(program, 'a_velocity');
    const speedLoc = gl.getAttribLocation(program, 'a_speed');
    const colorValueLoc = gl.getAttribLocation(program, 'a_colorValue');
    
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const sizeLoc = gl.getUniformLocation(program, 'u_particleSize');
    const maxSpeedLoc = gl.getUniformLocation(program, 'u_maxSpeed');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const motionBlurLoc = gl.getUniformLocation(program, 'u_motionBlur');
    const viewOffsetLoc = gl.getUniformLocation(program, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(program, 'u_viewScale');
    const colormapLoc = gl.getUniformLocation(program, 'u_colormap');
    const useColormapLoc = gl.getUniformLocation(program, 'u_useColormap');
    const overrideColorLoc = gl.getUniformLocation(program, 'u_overrideColor');
    
    if (this.selectedParticleIndices.length > 0) {
      this.renderSelectedParticleRings(posLoc, resLoc, sizeLoc, maxSpeedLoc, alphaLoc, motionBlurLoc, viewOffsetLoc, viewScaleLoc, overrideColorLoc);
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVelocityBuffer);
    gl.enableVertexAttribArray(velLoc);
    gl.vertexAttribPointer(velLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleSpeedBuffer);
    gl.enableVertexAttribArray(speedLoc);
    gl.vertexAttribPointer(speedLoc, 1, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleColorValueBuffer);
    gl.enableVertexAttribArray(colorValueLoc);
    gl.vertexAttribPointer(colorValueLoc, 1, gl.FLOAT, false, 0, 0);
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform1f(sizeLoc, this.particleSize);
    gl.uniform1f(maxSpeedLoc, this.maxSpeed);
    gl.uniform1f(alphaLoc, 1.0);
    gl.uniform1i(motionBlurLoc, this.motionBlur ? 1 : 0);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    gl.uniform1i(useColormapLoc, this.useColormap ? 1 : 0);
    gl.uniform4f(overrideColorLoc, 0, 0, 0, 0);
    
    if (this.useColormap && this.colormapTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
      gl.uniform1i(colormapLoc, 0);
    }
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    
    gl.drawArrays(gl.POINTS, 0, count);
    
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    this.renderAnalysisRegions();
  }

  private renderSelectedParticleRings(
    posLoc: number,
    resLoc: WebGLUniformLocation | null,
    sizeLoc: WebGLUniformLocation | null,
    maxSpeedLoc: WebGLUniformLocation | null,
    alphaLoc: WebGLUniformLocation | null,
    motionBlurLoc: WebGLUniformLocation | null,
    viewOffsetLoc: WebGLUniformLocation | null,
    viewScaleLoc: WebGLUniformLocation | null,
    overrideColorLoc: WebGLUniformLocation | null
  ): void {
    const gl = this.gl;
    const selectedCount = this.selectedParticleIndices.length;
    if (selectedCount === 0) return;
    
    const selPosData = this.selectedParticlePositionData;
    const posData = this.particlePositionData;
    
    for (let i = 0; i < selectedCount; i++) {
      const idx = this.selectedParticleIndices[i];
      if (idx >= 0 && idx * 2 + 1 < posData.length) {
        selPosData[i * 2] = posData[idx * 2];
        selPosData[i * 2 + 1] = posData[idx * 2 + 1];
      }
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.selectedParticlePositionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, selPosData.subarray(0, selectedCount * 2));
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform1f(sizeLoc, this.particleSize + 2);
    gl.uniform1f(maxSpeedLoc, this.maxSpeed);
    gl.uniform1f(alphaLoc, 1.0);
    gl.uniform1i(motionBlurLoc, 0);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    gl.uniform4f(overrideColorLoc, 1.0, 1.0, 0.0, 1.0);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    
    gl.drawArrays(gl.POINTS, 0, selectedCount);
    
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private renderFluid(): void {
    if (this.particleCount === 0) return;
    
    const gl = this.gl;
    const count = this.particleCount;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depth);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    const depthProgram = this.programs.depth;
    gl.useProgram(depthProgram);
    
    const dPosLoc = gl.getAttribLocation(depthProgram, 'a_position');
    const dResLoc = gl.getUniformLocation(depthProgram, 'u_resolution');
    const dRadiusLoc = gl.getUniformLocation(depthProgram, 'u_particleRadius');
    const dViewOffsetLoc = gl.getUniformLocation(depthProgram, 'u_viewOffset');
    const dViewScaleLoc = gl.getUniformLocation(depthProgram, 'u_viewScale');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer);
    gl.enableVertexAttribArray(dPosLoc);
    gl.vertexAttribPointer(dPosLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.uniform2f(dResLoc, width, height);
    gl.uniform1f(dRadiusLoc, this.particleSize * 2.8);
    gl.uniform2f(dViewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(dViewScaleLoc, this.viewScale);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    
    gl.drawArrays(gl.POINTS, 0, count);
    
    this.blurTexture(this.textures.depth, this.textures.blurH, this.framebuffers.blurH, { x: 2, y: 0 });
    this.blurTexture(this.textures.blurH, this.textures.blurV, this.framebuffers.blurV, { x: 0, y: 2 });
    this.blurTexture(this.textures.blurV, this.textures.blurH, this.framebuffers.blurH, { x: 2, y: 0 });
    this.blurTexture(this.textures.blurH, this.textures.blurV, this.framebuffers.blurV, { x: 0, y: 2 });
    this.blurTexture(this.textures.blurV, this.textures.blurH, this.framebuffers.blurH, { x: 2, y: 0 });
    this.blurTexture(this.textures.blurH, this.textures.blurV, this.framebuffers.blurV, { x: 0, y: 2 });
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.normal);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.5, 0.5, 1.0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    const normalProgram = this.programs.normal;
    gl.useProgram(normalProgram);
    
    const nPosLoc = gl.getAttribLocation(normalProgram, 'a_position');
    const nTexLoc = gl.getAttribLocation(normalProgram, 'a_texCoord');
    const nDepthLoc = gl.getUniformLocation(normalProgram, 'u_depthTexture');
    const nResLoc = gl.getUniformLocation(normalProgram, 'u_resolution');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadPosition);
    gl.enableVertexAttribArray(nPosLoc);
    gl.vertexAttribPointer(nPosLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadTexCoord);
    gl.enableVertexAttribArray(nTexLoc);
    gl.vertexAttribPointer(nTexLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.blurV);
    gl.uniform1i(nDepthLoc, 0);
    gl.uniform2f(nResLoc, width, height);
    
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    
    const shadeProgram = this.programs.fluidShade;
    gl.useProgram(shadeProgram);
    
    const sPosLoc = gl.getAttribLocation(shadeProgram, 'a_position');
    const sTexLoc = gl.getAttribLocation(shadeProgram, 'a_texCoord');
    const sNormalLoc = gl.getUniformLocation(shadeProgram, 'u_normalTexture');
    const sLightLoc = gl.getUniformLocation(shadeProgram, 'u_lightDir');
    const sBaseColorLoc = gl.getUniformLocation(shadeProgram, 'u_baseColor');
    const sEnvColorLoc = gl.getUniformLocation(shadeProgram, 'u_envColor');
    const sFresnelLoc = gl.getUniformLocation(shadeProgram, 'u_fresnelPower');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadPosition);
    gl.enableVertexAttribArray(sPosLoc);
    gl.vertexAttribPointer(sPosLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadTexCoord);
    gl.enableVertexAttribArray(sTexLoc);
    gl.vertexAttribPointer(sTexLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.normal);
    gl.uniform1i(sNormalLoc, 0);
    
    gl.uniform3f(sLightLoc, 0.4, 0.6, 0.9);
    gl.uniform3f(sBaseColorLoc, 0.15, 0.45, 0.85);
    gl.uniform3f(sEnvColorLoc, 0.8, 0.9, 1.0);
    gl.uniform1f(sFresnelLoc, 2.5);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    this.renderAnalysisRegions();
  }

  private blurTexture(
    source: WebGLTexture,
    target: WebGLTexture,
    targetFBO: WebGLFramebuffer,
    direction: { x: number; y: number }
  ): void {
    const gl = this.gl;
    const program = this.programs.blur;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(program);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    const textureLoc = gl.getUniformLocation(program, 'u_texture');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const dirLoc = gl.getUniformLocation(program, 'u_direction');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadPosition);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quadTexCoord);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(textureLoc, 0);
    
    gl.uniform2f(resLoc, width, height);
    gl.uniform2f(dirLoc, direction.x, direction.y);
    
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private beginLines(): void {
    this.lineCount = 0;
  }

  private renderAnalysisRegions(): void {
    if (this.analysisRegions.length === 0) return;
    
    this.beginLines();
    
    for (const region of this.analysisRegions) {
      const x = region.x;
      const y = region.y;
      const w = region.width;
      const h = region.height;
      
      const r = 1.0, g = 0.9, b = 0.2, a = 0.9;
      
      this.addDashedLine(x, y, x + w, y, r, g, b, a);
      this.addDashedLine(x + w, y, x + w, y + h, r, g, b, a);
      this.addDashedLine(x + w, y + h, x, y + h, r, g, b, a);
      this.addDashedLine(x, y + h, x, y, r, g, b, a);
    }
    
    this.drawLines();
  }

  private addDashedLine(
    x1: number, y1: number, x2: number, y2: number,
    r: number, g: number, b: number, a: number,
    dashLength: number = 8, gapLength: number = 6
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.001) return;
    
    const dirX = dx / length;
    const dirY = dy / length;
    
    let traveled = 0;
    let drawing = true;
    
    while (traveled < length) {
      const segLen = drawing ? Math.min(dashLength, length - traveled) : Math.min(gapLength, length - traveled);
      const startX = x1 + dirX * traveled;
      const startY = y1 + dirY * traveled;
      const endX = startX + dirX * segLen;
      const endY = startY + dirY * segLen;
      
      if (drawing) {
        this.addLine(startX, startY, endX, endY, r, g, b, a);
      }
      
      traveled += segLen;
      drawing = !drawing;
    }
  }

  private addLine(x1: number, y1: number, x2: number, y2: number, 
                  r: number, g: number, b: number, a: number): void {
    if (this.lineCount >= this.maxLines) {
      this.growLineBuffer();
    }
    
    const idx = this.lineCount * 2;
    this.lineVertexData[idx * 2] = x1;
    this.lineVertexData[idx * 2 + 1] = y1;
    this.lineVertexData[(idx + 1) * 2] = x2;
    this.lineVertexData[(idx + 1) * 2 + 1] = y2;
    
    this.lineColorData[idx * 4] = r;
    this.lineColorData[idx * 4 + 1] = g;
    this.lineColorData[idx * 4 + 2] = b;
    this.lineColorData[idx * 4 + 3] = a;
    
    this.lineColorData[(idx + 1) * 4] = r;
    this.lineColorData[(idx + 1) * 4 + 1] = g;
    this.lineColorData[(idx + 1) * 4 + 2] = b;
    this.lineColorData[(idx + 1) * 4 + 3] = a;
    
    this.lineCount++;
  }

  private addArrow(x1: number, y1: number, x2: number, y2: number,
                   r: number, g: number, b: number, a: number,
                   headLength: number = 10, headAngle: number = Math.PI / 6): void {
    this.addLine(x1, y1, x2, y2, r, g, b, a);
    
    const lineAngle = Math.atan2(y2 - y1, x2 - x1);
    
    const hx1 = x2 - headLength * Math.cos(lineAngle - headAngle);
    const hy1 = y2 - headLength * Math.sin(lineAngle - headAngle);
    this.addLine(x2, y2, hx1, hy1, r, g, b, a);
    
    const hx2 = x2 - headLength * Math.cos(lineAngle + headAngle);
    const hy2 = y2 - headLength * Math.sin(lineAngle + headAngle);
    this.addLine(x2, y2, hx2, hy2, r, g, b, a);
  }

  private addCircle(cx: number, cy: number, radius: number, segments: number,
                    r: number, g: number, b: number, a: number): void {
    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      
      const x1 = cx + Math.cos(angle1) * radius;
      const y1 = cy + Math.sin(angle1) * radius;
      const x2 = cx + Math.cos(angle2) * radius;
      const y2 = cy + Math.sin(angle2) * radius;
      
      this.addLine(x1, y1, x2, y2, r, g, b, a);
    }
  }

  private growLineBuffer(): void {
    const gl = this.gl;
    this.maxLines = Math.floor(this.maxLines * 1.5);
    
    const newVertexData = new Float32Array(this.maxLines * 2 * 2);
    newVertexData.set(this.lineVertexData);
    this.lineVertexData = newVertexData;
    
    const newColorData = new Float32Array(this.maxLines * 2 * 4);
    newColorData.set(this.lineColorData);
    this.lineColorData = newColorData;
    
    if (this.lineVertexBuffer) {
      gl.deleteBuffer(this.lineVertexBuffer);
    }
    if (this.lineColorBuffer) {
      gl.deleteBuffer(this.lineColorBuffer);
    }
    
    this.lineVertexBuffer = createBuffer(gl, this.lineVertexData, gl.DYNAMIC_DRAW);
    this.lineColorBuffer = createBuffer(gl, this.lineColorData, gl.DYNAMIC_DRAW);
  }

  private drawLines(): void {
    if (this.lineCount === 0) return;
    
    const gl = this.gl;
    const program = this.programs.line;
    
    gl.useProgram(program);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineVertexData.subarray(0, this.lineCount * 4));
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineColorData.subarray(0, this.lineCount * 8));
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    
    gl.uniform2f(this.lineUniforms.u_resolution!, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.lineUniforms.u_viewOffset!, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(this.lineUniforms.u_viewScale!, this.viewScale);
    gl.uniform1f(this.lineUniforms.u_useVertexColor!, 1.0);
    
    gl.drawArrays(gl.LINES, 0, this.lineCount * 2);
  }

  private renderForceFields(fields: ForceField[]): void {
    if (fields.length === 0) return;
    
    this.beginLines();
    
    for (const field of fields) {
      if (field.type === 'brush') {
        this.buildBrushField(field);
      } else if (field.type === 'flow') {
        this.buildFlowField(field);
      } else if (field.type === 'obstacle') {
        continue;
      } else {
        this.buildPointField(field);
      }
    }
    
    this.drawLines();
  }

  private buildPointField(field: ForceField): void {
    const center = field.position;
    const radius = field.radius;
    const numArrows = 12;
    
    let cr: number, cg: number, cb: number, ca: number;
    switch (field.type) {
      case 'gravity':
        cr = 0.4; cg = 0.6; cb = 1.0; ca = this.forceFieldAlpha;
        break;
      case 'repel':
        cr = 1.0; cg = 0.5; cb = 0.3; ca = this.forceFieldAlpha;
        break;
      case 'vortex':
        cr = 0.6; cg = 1.0; cb = 0.6; ca = this.forceFieldAlpha;
        break;
      case 'emitter':
        cr = 1.0; cg = 0.8; cb = 0.4; ca = this.forceFieldAlpha;
        break;
      case 'sink':
        cr = 0.6; cg = 0.3; cb = 0.8; ca = this.forceFieldAlpha;
        break;
      default:
        cr = 1.0; cg = 1.0; cb = 1.0; ca = this.forceFieldAlpha;
    }
    
    const arrowLength = radius * 0.3;
    const headLength = arrowLength * 0.3;
    
    for (let i = 0; i < numArrows; i++) {
      const angle = (i / numArrows) * Math.PI * 2;
      
      let startX: number, startY: number, endX: number, endY: number;
      
      if (field.type === 'gravity') {
        startX = center.x + Math.cos(angle) * radius;
        startY = center.y + Math.sin(angle) * radius;
        endX = center.x + Math.cos(angle) * (radius - arrowLength);
        endY = center.y + Math.sin(angle) * (radius - arrowLength);
      } else if (field.type === 'repel') {
        startX = center.x + Math.cos(angle) * (radius - arrowLength);
        startY = center.y + Math.sin(angle) * (radius - arrowLength);
        endX = center.x + Math.cos(angle) * radius;
        endY = center.y + Math.sin(angle) * radius;
      } else if (field.type === 'vortex') {
        const tangentAngle = angle + (field.clockwise ? -Math.PI / 2 : Math.PI / 2);
        startX = center.x + Math.cos(angle) * radius * 0.7;
        startY = center.y + Math.sin(angle) * radius * 0.7;
        endX = startX + Math.cos(tangentAngle) * arrowLength;
        endY = startY + Math.sin(tangentAngle) * arrowLength;
      } else if (field.type === 'emitter' || field.type === 'sink') {
        startX = center.x + Math.cos(angle) * radius * 0.5;
        startY = center.y + Math.sin(angle) * radius * 0.5;
        endX = center.x + Math.cos(angle) * radius;
        endY = center.y + Math.sin(angle) * radius;
      } else {
        continue;
      }
      
      this.addArrow(startX, startY, endX, endY, cr, cg, cb, ca, headLength);
    }
    
    this.addCircle(center.x, center.y, radius, 32, cr, cg, cb, ca * 0.3);
  }

  private buildFlowField(field: ForceField): void {
    if (!field.points || field.points.length < 2) return;
    
    const p1 = field.points[0];
    const p2 = field.points[1];
    const width = field.radius;
    
    const lineVecX = p2.x - p1.x;
    const lineVecY = p2.y - p1.y;
    const lineLen = Math.sqrt(lineVecX * lineVecX + lineVecY * lineVecY);
    if (lineLen < 1) return;
    
    const dirX = lineVecX / lineLen;
    const dirY = lineVecY / lineLen;
    const perpX = -dirY;
    const perpY = dirX;
    
    const numArrows = Math.max(1, Math.floor(lineLen / 30));
    const arrowLen = Math.min(lineLen * 0.08, 20);
    const headLen = arrowLen * 0.4;
    
    const cr = 0.5, cg = 0.8, cb = 1.0;
    const boundaryAlpha = this.forceFieldAlpha * 0.3;
    const arrowAlpha = this.forceFieldAlpha;
    
    this.addLine(p1.x + perpX * width, p1.y + perpY * width,
                 p2.x + perpX * width, p2.y + perpY * width,
                 cr, cg, cb, boundaryAlpha);
    this.addLine(p2.x + perpX * width, p2.y + perpY * width,
                 p2.x - perpX * width, p2.y - perpY * width,
                 cr, cg, cb, boundaryAlpha);
    this.addLine(p2.x - perpX * width, p2.y - perpY * width,
                 p1.x - perpX * width, p1.y - perpY * width,
                 cr, cg, cb, boundaryAlpha);
    this.addLine(p1.x - perpX * width, p1.y - perpY * width,
                 p1.x + perpX * width, p1.y + perpY * width,
                 cr, cg, cb, boundaryAlpha);
    
    for (let i = 0; i < numArrows; i++) {
      const t = (i + 0.5) / numArrows;
      const baseX = p1.x + lineVecX * t;
      const baseY = p1.y + lineVecY * t;
      
      const startX = baseX - dirX * arrowLen * 0.5;
      const startY = baseY - dirY * arrowLen * 0.5;
      const endX = baseX + dirX * arrowLen * 0.5;
      const endY = baseY + dirY * arrowLen * 0.5;
      
      this.addArrow(startX, startY, endX, endY, cr, cg, cb, arrowAlpha, headLen);
    }
  }

  private buildBrushField(field: ForceField): void {
    if (!field.brushPoints || field.brushPoints.length < 2) return;
    
    const cr = 1.0, cg = 0.6, cb = 0.8;
    const pathAlpha = this.forceFieldAlpha * 0.5;
    const arrowAlpha = this.forceFieldAlpha;
    
    for (let i = 0; i < field.brushPoints.length - 1; i++) {
      const bp1 = field.brushPoints[i];
      const bp2 = field.brushPoints[i + 1];
      this.addLine(bp1.position.x, bp1.position.y,
                   bp2.position.x, bp2.position.y,
                   cr, cg, cb, pathAlpha);
    }
    
    const arrowStep = 5;
    const arrowLen = 8;
    
    for (let i = 0; i < field.brushPoints.length; i += arrowStep) {
      const bp = field.brushPoints[i];
      const dirLen = Math.sqrt(bp.direction.x * bp.direction.x + bp.direction.y * bp.direction.y);
      if (dirLen < 0.01) continue;
      
      const ndx = bp.direction.x / dirLen;
      const ndy = bp.direction.y / dirLen;
      
      const endX = bp.position.x + ndx * arrowLen;
      const endY = bp.position.y + ndy * arrowLen;
      
      this.addArrow(bp.position.x, bp.position.y, endX, endY,
                    cr, cg, cb, arrowAlpha, arrowLen * 0.4);
    }
  }

  private renderObstacles(obstacles: Obstacle[]): void {
    const gl = this.gl;
    const program = this.programs.obstacle;
    
    gl.useProgram(program);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const colorLoc = gl.getUniformLocation(program, 'u_color');
    const viewOffsetLoc = gl.getUniformLocation(program, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(program, 'u_viewScale');
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    
    for (const obstacle of obstacles) {
      const points = obstacle.points;
      const pos = obstacle.position;
      const vertices = new Float32Array(points.length * 2);
      
      for (let i = 0; i < points.length; i++) {
        vertices[i * 2] = points[i].x + pos.x;
        vertices[i * 2 + 1] = points[i].y + pos.y;
      }
      
      const buffer = createBuffer(gl, vertices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.uniform4f(colorLoc, 0.3, 0.3, 0.4, 0.8);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, points.length);
      
      gl.uniform4f(colorLoc, 0.6, 0.7, 0.9, 1.0);
      gl.drawArrays(gl.LINE_LOOP, 0, points.length);
      
      gl.deleteBuffer(buffer);
    }
  }

  renderTrajectory(
    frames: TrajectoryFrame[],
    endFrameIndex: number,
    selectedParticleIndices: number[],
    particleCount: number
  ): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.02, 0.02, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.renderBackground();

    const maxFrames = Math.min(endFrameIndex + 1, frames.length);
    if (maxFrames < 2) return;

    this.beginLines();

    const hasSelection = selectedParticleIndices.length > 0;
    const selectedSet = new Set(selectedParticleIndices);

    for (let pIdx = 0; pIdx < particleCount; pIdx++) {
      const isSelected = hasSelection && selectedSet.has(pIdx);
      const baseAlpha = hasSelection ? (isSelected ? 1.0 : 0.15) : 0.6;

      for (let fIdx = 0; fIdx < maxFrames - 1; fIdx++) {
        const frame1 = frames[fIdx];
        const frame2 = frames[fIdx + 1];

        if (!frame1 || !frame2) continue;

        const posIdx = pIdx * 2;
        const x1 = frame1.positions[posIdx];
        const y1 = frame1.positions[posIdx + 1];
        const x2 = frame2.positions[posIdx];
        const y2 = frame2.positions[posIdx + 1];

        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;

        const t = fIdx / (maxFrames - 1);
        let r: number, g: number, b: number;

        if (isSelected) {
          r = 1.0;
          g = 0.9;
          b = 0.0;
        } else {
          const gray = 0.3 + t * 0.7;
          r = gray;
          g = gray;
          b = gray;
        }

        this.addLine(x1, y1, x2, y2, r, g, b, baseAlpha);
      }
    }

    this.drawLines();

    if (maxFrames > 0) {
      const currentFrame = frames[maxFrames - 1];
      if (currentFrame) {
        this.renderTrajectoryParticles(currentFrame, particleCount, selectedParticleIndices);
      }
    }
  }

  private renderTrajectoryParticles(
    frame: TrajectoryFrame,
    particleCount: number,
    selectedParticleIndices: number[]
  ): void {
    const gl = this.gl;
    const count = Math.min(particleCount, this.maxParticles);
    const program = this.programs.particleSprite;

    const hasSelection = selectedParticleIndices.length > 0;
    const selectedSet = new Set(selectedParticleIndices);

    const posData = new Float32Array(count * 2);
    const velData = new Float32Array(count * 2);
    const speedData = new Float32Array(count);
    const colorData = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const posIdx = i * 2;
      const velIdx = i * 2;
      posData[posIdx] = frame.positions[posIdx];
      posData[posIdx + 1] = frame.positions[posIdx + 1];
      velData[velIdx] = frame.velocities[velIdx];
      velData[velIdx + 1] = frame.velocities[velIdx + 1];
      speedData[i] = Math.sqrt(
        frame.velocities[velIdx] * frame.velocities[velIdx] +
        frame.velocities[velIdx + 1] * frame.velocities[velIdx + 1]
      );

      if (hasSelection && selectedSet.has(i)) {
        colorData[i * 3] = 1.0;
        colorData[i * 3 + 1] = 0.9;
        colorData[i * 3 + 2] = 0.0;
      } else {
        const t = i / count;
        colorData[i * 3] = 0.7 + t * 0.3;
        colorData[i * 3 + 1] = 0.8 + t * 0.2;
        colorData[i * 3 + 2] = 1.0;
      }
    }

    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    const velLoc = gl.getAttribLocation(program, 'a_velocity');
    const speedLoc = gl.getAttribLocation(program, 'a_speed');

    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const sizeLoc = gl.getUniformLocation(program, 'u_particleSize');
    const maxSpeedLoc = gl.getUniformLocation(program, 'u_maxSpeed');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const motionBlurLoc = gl.getUniformLocation(program, 'u_motionBlur');
    const viewOffsetLoc = gl.getUniformLocation(program, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(program, 'u_viewScale');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVelocityBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, velData);
    gl.enableVertexAttribArray(velLoc);
    gl.vertexAttribPointer(velLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleSpeedBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, speedData);
    gl.enableVertexAttribArray(speedLoc);
    gl.vertexAttribPointer(speedLoc, 1, gl.FLOAT, false, 0, 0);

    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform1f(sizeLoc, this.particleSize * 1.2);
    gl.uniform1f(maxSpeedLoc, this.maxSpeed);
    gl.uniform1f(alphaLoc, 1.0);
    gl.uniform1i(motionBlurLoc, 0);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.drawArrays(gl.POINTS, 0, count);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  captureFrame(): ImageData {
    const gl = this.gl;
    const srcWidth = this.canvas.width;
    const srcHeight = this.canvas.height;
    
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / srcWidth);
    const dstWidth = Math.floor(srcWidth * scale);
    const dstHeight = Math.floor(srcHeight * scale);
    
    const srcPixels = new Uint8Array(srcWidth * srcHeight * 4);
    gl.readPixels(0, 0, srcWidth, srcHeight, gl.RGBA, gl.UNSIGNED_BYTE, srcPixels);
    
    const dstData = new Uint8ClampedArray(dstWidth * dstHeight * 4);
    const sx = srcWidth / dstWidth;
    const sy = srcHeight / dstHeight;
    
    for (let y = 0; y < dstHeight; y++) {
      const dstY = dstHeight - 1 - y;
      const srcY = Math.floor(y * sy);
      
      for (let x = 0; x < dstWidth; x++) {
        const srcX = Math.floor(x * sx);
        const srcIdx = (srcY * srcWidth + srcX) * 4;
        const dstIdx = (dstY * dstWidth + x) * 4;
        dstData[dstIdx] = srcPixels[srcIdx];
        dstData[dstIdx + 1] = srcPixels[srcIdx + 1];
        dstData[dstIdx + 2] = srcPixels[srcIdx + 2];
        dstData[dstIdx + 3] = srcPixels[srcIdx + 3];
      }
    }
    
    return new ImageData(dstData, dstWidth, dstHeight);
  }
}
