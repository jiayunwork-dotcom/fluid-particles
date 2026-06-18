import { Particle, ForceField, Obstacle, Vec2, RenderMode } from '../types';
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
  private particlePositionBuffer: WebGLBuffer | null = null;
  private particleVelocityBuffer: WebGLBuffer | null = null;
  private particleSpeedBuffer: WebGLBuffer | null = null;
  private particleBufferSize: number = 0;
  
  private quadPositions: Float32Array;
  private quadTexCoords: Float32Array;
  
  private maxParticles: number = 15000;

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
    
    this.particlePositionBuffer = createBuffer(gl, this.particlePositionData, gl.DYNAMIC_DRAW);
    this.particleVelocityBuffer = createBuffer(gl, this.particleVelocityData, gl.DYNAMIC_DRAW);
    this.particleSpeedBuffer = createBuffer(gl, this.particleSpeedData, gl.DYNAMIC_DRAW);
    this.particleBufferSize = this.maxParticles;
    
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
    
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      posData[i * 2] = p.position.x;
      posData[i * 2 + 1] = p.position.y;
      velData[i * 2] = p.velocity.x;
      velData[i * 2 + 1] = p.velocity.y;
      speedData[i] = vec2Length(p.velocity);
    }
    
    if (this.particlePositionBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData.subarray(0, count * 2));
    }
    if (this.particleVelocityBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVelocityBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, velData.subarray(0, count * 2));
    }
    if (this.particleSpeedBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleSpeedBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, speedData.subarray(0, count));
    }
    
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
    
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const sizeLoc = gl.getUniformLocation(program, 'u_particleSize');
    const maxSpeedLoc = gl.getUniformLocation(program, 'u_maxSpeed');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const motionBlurLoc = gl.getUniformLocation(program, 'u_motionBlur');
    const viewOffsetLoc = gl.getUniformLocation(program, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(program, 'u_viewScale');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVelocityBuffer);
    gl.enableVertexAttribArray(velLoc);
    gl.vertexAttribPointer(velLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleSpeedBuffer);
    gl.enableVertexAttribArray(speedLoc);
    gl.vertexAttribPointer(speedLoc, 1, gl.FLOAT, false, 0, 0);
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform1f(sizeLoc, this.particleSize);
    gl.uniform1f(maxSpeedLoc, this.maxSpeed);
    gl.uniform1f(alphaLoc, 1.0);
    gl.uniform1i(motionBlurLoc, this.motionBlur ? 1 : 0);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    
    gl.drawArrays(gl.POINTS, 0, count);
    
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
    gl.clearColor(0, 0, 0, 1);
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
    gl.uniform1f(dRadiusLoc, this.particleSize * 1.5);
    gl.uniform2f(dViewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(dViewScaleLoc, this.viewScale);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    
    gl.drawArrays(gl.POINTS, 0, count);
    
    this.blurTexture(this.textures.depth, this.textures.blurH, this.framebuffers.blurH, { x: 1, y: 0 });
    this.blurTexture(this.textures.blurH, this.textures.blurV, this.framebuffers.blurV, { x: 0, y: 1 });
    this.blurTexture(this.textures.blurV, this.textures.blurH, this.framebuffers.blurH, { x: 1, y: 0 });
    this.blurTexture(this.textures.blurH, this.textures.blurV, this.framebuffers.blurV, { x: 0, y: 1 });
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.normal);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
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
    
    gl.uniform3f(sLightLoc, 0.3, 0.5, 1.0);
    gl.uniform3f(sBaseColorLoc, 0.2, 0.5, 0.9);
    gl.uniform3f(sEnvColorLoc, 0.6, 0.8, 1.0);
    gl.uniform1f(sFresnelLoc, 3.0);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
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
    gl.clearColor(0, 0, 0, 1);
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

  private renderForceFields(fields: ForceField[]): void {
    const gl = this.gl;
    const program = this.programs.forceField;
    const lineProgram = this.programs.line;
    
    for (const field of fields) {
      if (field.type === 'brush') {
        this.renderBrushField(field);
      } else if (field.type === 'flow') {
        this.renderFlowField(field);
      } else if (field.type === 'obstacle') {
        continue;
      } else {
        this.renderPointField(field);
      }
    }
  }

  private renderPointField(field: ForceField): void {
    const gl = this.gl;
    const lineProgram = this.programs.line;
    const center = field.position;
    const radius = field.radius;
    const numArrows = 12;
    
    let color: [number, number, number, number];
    switch (field.type) {
      case 'gravity':
        color = [0.4, 0.6, 1.0, this.forceFieldAlpha];
        break;
      case 'repel':
        color = [1.0, 0.5, 0.3, this.forceFieldAlpha];
        break;
      case 'vortex':
        color = [0.6, 1.0, 0.6, this.forceFieldAlpha];
        break;
      case 'emitter':
        color = [1.0, 0.8, 0.4, this.forceFieldAlpha];
        break;
      case 'sink':
        color = [0.6, 0.3, 0.8, this.forceFieldAlpha];
        break;
      default:
        color = [1.0, 1.0, 1.0, this.forceFieldAlpha];
    }
    
    gl.useProgram(lineProgram);
    
    const posLoc = gl.getAttribLocation(lineProgram, 'a_position');
    const resLoc = gl.getUniformLocation(lineProgram, 'u_resolution');
    const colorLoc = gl.getUniformLocation(lineProgram, 'u_color');
    const viewOffsetLoc = gl.getUniformLocation(lineProgram, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(lineProgram, 'u_viewScale');
    const lineWidthLoc = gl.getUniformLocation(lineProgram, 'u_lineWidth');
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform4f(colorLoc, color[0], color[1], color[2], color[3]);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    gl.uniform1f(lineWidthLoc, 2);
    
    for (let i = 0; i < numArrows; i++) {
      const angle = (i / numArrows) * Math.PI * 2;
      const arrowLength = radius * 0.3;
      
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
      
      const arrowData = new Float32Array([
        startX, startY,
        endX, endY
      ]);
      
      const arrowBuffer = createBuffer(gl, arrowData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.drawArrays(gl.LINES, 0, 2);
      
      const headLength = arrowLength * 0.3;
      const headAngle = Math.PI / 6;
      const lineAngle = Math.atan2(endY - startY, endX - startX);
      
      const headData = new Float32Array([
        endX, endY,
        endX - headLength * Math.cos(lineAngle - headAngle), endY - headLength * Math.sin(lineAngle - headAngle),
        endX, endY,
        endX - headLength * Math.cos(lineAngle + headAngle), endY - headLength * Math.sin(lineAngle + headAngle)
      ]);
      
      const headBuffer = createBuffer(gl, headData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, headBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.drawArrays(gl.LINES, 0, 4);
      
      gl.deleteBuffer(arrowBuffer);
      gl.deleteBuffer(headBuffer);
    }
    
    const circleSegments = 32;
    const circleData = new Float32Array(circleSegments * 2);
    for (let i = 0; i < circleSegments; i++) {
      const angle = (i / circleSegments) * Math.PI * 2;
      circleData[i * 2] = center.x + Math.cos(angle) * radius;
      circleData[i * 2 + 1] = center.y + Math.sin(angle) * radius;
    }
    
    const circleBuffer = createBuffer(gl, circleData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, circleBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.uniform4f(colorLoc, color[0], color[1], color[2], color[3] * 0.3);
    gl.drawArrays(gl.LINE_LOOP, 0, circleSegments);
    
    gl.deleteBuffer(circleBuffer);
  }

  private renderFlowField(field: ForceField): void {
    if (!field.points || field.points.length < 2) return;
    
    const gl = this.gl;
    const lineProgram = this.programs.line;
    const p1 = field.points[0];
    const p2 = field.points[1];
    const width = field.radius;
    
    const lineVec = { x: p2.x - p1.x, y: p2.y - p1.y };
    const lineLen = Math.sqrt(lineVec.x * lineVec.x + lineVec.y * lineVec.y);
    if (lineLen < 1) return;
    
    const dirX = lineVec.x / lineLen;
    const dirY = lineVec.y / lineLen;
    const perpX = -dirY;
    const perpY = dirX;
    
    const numLines = 5;
    const numArrows = Math.floor(lineLen / 30);
    
    gl.useProgram(lineProgram);
    
    const posLoc = gl.getAttribLocation(lineProgram, 'a_position');
    const resLoc = gl.getUniformLocation(lineProgram, 'u_resolution');
    const colorLoc = gl.getUniformLocation(lineProgram, 'u_color');
    const viewOffsetLoc = gl.getUniformLocation(lineProgram, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(lineProgram, 'u_viewScale');
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform4f(colorLoc, 0.5, 0.8, 1.0, this.forceFieldAlpha * 0.3);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    
    const boundaryData = new Float32Array([
      p1.x + perpX * width, p1.y + perpY * width,
      p2.x + perpX * width, p2.y + perpY * width,
      p2.x - perpX * width, p2.y - perpY * width,
      p1.x - perpX * width, p1.y - perpY * width
    ]);
    
    const boundaryBuffer = createBuffer(gl, boundaryData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, boundaryBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.drawArrays(gl.LINE_LOOP, 0, 4);
    gl.deleteBuffer(boundaryBuffer);
    
    gl.uniform4f(colorLoc, 0.5, 0.8, 1.0, this.forceFieldAlpha);
    
    for (let i = 0; i < numArrows; i++) {
      const t = (i + 0.5) / numArrows;
      const baseX = p1.x + lineVec.x * t;
      const baseY = p1.y + lineVec.y * t;
      const arrowLen = Math.min(lineLen * 0.08, 20);
      
      const arrowData = new Float32Array([
        baseX - dirX * arrowLen * 0.5, baseY - dirY * arrowLen * 0.5,
        baseX + dirX * arrowLen * 0.5, baseY + dirY * arrowLen * 0.5
      ]);
      
      const arrowBuffer = createBuffer(gl, arrowData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.drawArrays(gl.LINES, 0, 2);
      
      const headLength = arrowLen * 0.4;
      const headAngle = Math.PI / 6;
      const lineAngle = Math.atan2(dirY, dirX);
      
      const headData = new Float32Array([
        baseX + dirX * arrowLen * 0.5, baseY + dirY * arrowLen * 0.5,
        baseX + dirX * arrowLen * 0.5 - headLength * Math.cos(lineAngle - headAngle),
        baseY + dirY * arrowLen * 0.5 - headLength * Math.sin(lineAngle - headAngle),
        baseX + dirX * arrowLen * 0.5, baseY + dirY * arrowLen * 0.5,
        baseX + dirX * arrowLen * 0.5 - headLength * Math.cos(lineAngle + headAngle),
        baseY + dirY * arrowLen * 0.5 - headLength * Math.sin(lineAngle + headAngle)
      ]);
      
      const headBuffer = createBuffer(gl, headData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, headBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.drawArrays(gl.LINES, 0, 4);
      
      gl.deleteBuffer(arrowBuffer);
      gl.deleteBuffer(headBuffer);
    }
  }

  private renderBrushField(field: ForceField): void {
    if (!field.brushPoints || field.brushPoints.length < 2) return;
    
    const gl = this.gl;
    const lineProgram = this.programs.line;
    
    gl.useProgram(lineProgram);
    
    const posLoc = gl.getAttribLocation(lineProgram, 'a_position');
    const resLoc = gl.getUniformLocation(lineProgram, 'u_resolution');
    const colorLoc = gl.getUniformLocation(lineProgram, 'u_color');
    const viewOffsetLoc = gl.getUniformLocation(lineProgram, 'u_viewOffset');
    const viewScaleLoc = gl.getUniformLocation(lineProgram, 'u_viewScale');
    
    gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
    gl.uniform4f(colorLoc, 1.0, 0.6, 0.8, this.forceFieldAlpha * 0.5);
    gl.uniform2f(viewOffsetLoc, this.viewOffset.x, this.viewOffset.y);
    gl.uniform1f(viewScaleLoc, this.viewScale);
    
    const pathData = new Float32Array(field.brushPoints.length * 2);
    for (let i = 0; i < field.brushPoints.length; i++) {
      pathData[i * 2] = field.brushPoints[i].position.x;
      pathData[i * 2 + 1] = field.brushPoints[i].position.y;
    }
    
    const pathBuffer = createBuffer(gl, pathData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, pathBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.drawArrays(gl.LINE_STRIP, 0, field.brushPoints.length);
    gl.deleteBuffer(pathBuffer);
    
    gl.uniform4f(colorLoc, 1.0, 0.6, 0.8, this.forceFieldAlpha);
    
    const arrowStep = 5;
    for (let i = 0; i < field.brushPoints.length; i += arrowStep) {
      const bp = field.brushPoints[i];
      const arrowLen = 8;
      const dir = bp.direction;
      const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
      if (dirLen < 0.01) continue;
      
      const ndx = dir.x / dirLen;
      const ndy = dir.y / dirLen;
      
      const endX = bp.position.x + ndx * arrowLen;
      const endY = bp.position.y + ndy * arrowLen;
      
      const arrowData = new Float32Array([
        bp.position.x, bp.position.y,
        endX, endY
      ]);
      
      const arrowBuffer = createBuffer(gl, arrowData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.drawArrays(gl.LINES, 0, 2);
      gl.deleteBuffer(arrowBuffer);
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

  captureFrame(): ImageData {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    
    const flipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * width * 4;
      const dstRow = y * width * 4;
      for (let x = 0; x < width * 4; x++) {
        flipped[dstRow + x] = pixels[srcRow + x];
      }
    }
    
    return new ImageData(new Uint8ClampedArray(flipped), width, height);
  }
}
