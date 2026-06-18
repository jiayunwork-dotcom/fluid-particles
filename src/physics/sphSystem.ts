import { Particle, Vec2, MaterialParams, SimParams, ForceField, Obstacle, Emitter, Sink } from '../types';
import { SpatialHash } from './spatialHash';
import {
  vec2, vec2Add, vec2Sub, vec2Mul, vec2Div,
  vec2Dot, vec2Length, vec2LengthSq, vec2Normalize,
  vec2Dist, vec2DistSq, vec2Perp,
  clamp, poly6Kernel, spikyKernelGradient, viscosityKernelLaplacian, generateId
} from '../utils/math';

export class SPHSystem {
  private particles: Particle[] = [];
  private spatialHash: SpatialHash;
  private materialParams: MaterialParams;
  private simParams: SimParams;
  private forceFields: ForceField[] = [];
  private obstacles: Obstacle[] = [];
  private emitters: Emitter[] = [];
  private sinks: Sink[] = [];
  private bounds: { min: Vec2; max: Vec2 };
  private h: number = 25;
  private poly6Coeff: number = 0;
  private spikyGradCoeff: number = 0;
  private viscLapCoeff: number = 0;
  private isPaused: boolean = false;
  private neighborArray: number[] = [];

  constructor(
    particleCount: number,
    bounds: { min: Vec2; max: Vec2 },
    materialParams: MaterialParams,
    simParams: SimParams
  ) {
    this.bounds = bounds;
    this.materialParams = materialParams;
    this.simParams = simParams;
    this.h = simParams.smoothingRadius;
    this.spatialHash = new SpatialHash(this.h);
    this.calculateKernelCoefficients();
    this.neighborArray = new Array(5000);
    this.initializeParticles(particleCount);
  }

  private calculateKernelCoefficients(): void {
    const h = this.h;
    this.poly6Coeff = 315 / (64 * Math.PI * Math.pow(h, 9));
    this.spikyGradCoeff = -45 / (Math.PI * Math.pow(h, 6));
    this.viscLapCoeff = 45 / (Math.PI * Math.pow(h, 6));
  }

  private initializeParticles(count: number): void {
    this.particles = [];
    
    const width = this.bounds.max.x - this.bounds.min.x;
    const height = this.bounds.max.y - this.bounds.min.y;
    const spacing = this.h * 0.6;
    
    const cols = Math.floor(width * 0.5 / spacing);
    const rows = Math.ceil(count / cols);
    const startX = this.bounds.min.x + width * 0.25;
    const startY = this.bounds.min.y + height * 0.2;
    
    let placed = 0;
    for (let row = 0; row < rows && placed < count; row++) {
      for (let col = 0; col < cols && placed < count; col++) {
        const jitterX = (Math.random() - 0.5) * spacing * 0.3;
        const jitterY = (Math.random() - 0.5) * spacing * 0.3;
        
        const pos = vec2(
          startX + col * spacing + jitterX,
          startY - row * spacing + jitterY
        );
        
        this.particles.push({
          position: pos,
          velocity: vec2(0, 0),
          prevPosition: { ...pos },
          prevVelocity: vec2(0, 0),
          density: 0,
          pressure: 0,
          force: vec2(0, 0)
        });
        
        placed++;
      }
    }
    
    this.simParams.particleCount = this.particles.length;
  }

  reset(): void {
    this.initializeParticles(this.simParams.particleCount);
  }

  setParticleCount(count: number): void {
    this.initializeParticles(count);
  }

  getParticleCount(): number {
    return this.particles.length;
  }

  getParticles(): Particle[] {
    return this.particles;
  }

  setMaterialParams(params: MaterialParams): void {
    this.materialParams = { ...params };
  }

  getMaterialParams(): MaterialParams {
    return { ...this.materialParams };
  }

  setSimParams(params: Partial<SimParams>): void {
    this.simParams = { ...this.simParams, ...params };
    if (params.smoothingRadius) {
      this.h = params.smoothingRadius;
      this.spatialHash.setCellSize(this.h);
      this.calculateKernelCoefficients();
    }
  }

  getSimParams(): SimParams {
    return { ...this.simParams };
  }

  setBounds(bounds: { min: Vec2; max: Vec2 }): void {
    this.bounds = bounds;
  }

  getBounds(): { min: Vec2; max: Vec2 } {
    return { ...this.bounds };
  }

  addForceField(field: ForceField): void {
    this.forceFields.push(field);
  }

  removeForceField(id: string): void {
    this.forceFields = this.forceFields.filter(f => f.id !== id);
  }

  getForceFields(): ForceField[] {
    return [...this.forceFields];
  }

  clearForceFields(): void {
    this.forceFields = [];
    this.obstacles = [];
    this.emitters = [];
    this.sinks = [];
  }

  addObstacle(obstacle: Obstacle): void {
    this.obstacles.push(obstacle);
  }

  removeObstacle(id: string): void {
    this.obstacles = this.obstacles.filter(o => o.id !== id);
  }

  getObstacles(): Obstacle[] {
    return [...this.obstacles];
  }

  addEmitter(emitter: Emitter): void {
    this.emitters.push(emitter);
  }

  removeEmitter(id: string): void {
    this.emitters = this.emitters.filter(e => e.id !== id);
  }

  getEmitters(): Emitter[] {
    return [...this.emitters];
  }

  addSink(sink: Sink): void {
    this.sinks.push(sink);
  }

  removeSink(id: string): void {
    this.sinks = this.sinks.filter(s => s.id !== id);
  }

  getSinks(): Sink[] {
    return [...this.sinks];
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  update(dt: number): void {
    if (this.isPaused) return;
    
    const particleCount = this.particles.length;
    let maxSubsteps = 2;
    let effectiveDt = this.simParams.dt;
    
    if (particleCount > 6000) {
      maxSubsteps = 1;
      effectiveDt = this.simParams.dt * 1.5;
    }
    if (particleCount > 8500) {
      maxSubsteps = 1;
      effectiveDt = this.simParams.dt * 2;
    }
    
    const clampedDt = Math.min(dt, effectiveDt * 3);
    const substeps = Math.min(Math.ceil(clampedDt / effectiveDt), maxSubsteps);
    const stepDt = clampedDt / substeps;
    
    for (let i = 0; i < substeps; i++) {
      this.step(stepDt);
    }
  }

  private step(dt: number): void {
    this.buildSpatialHash();
    this.computeDensityAndPressure();
    this.computeForces();
    this.integrate(dt);
    this.applyBoundaryConditions();
    this.handleEmittersAndSinks(dt);
  }

  private buildSpatialHash(): void {
    this.spatialHash.clear();
    for (let i = 0; i < this.particles.length; i++) {
      this.spatialHash.insert(i, this.particles[i].position);
    }
  }

  private computeDensityAndPressure(): void {
    const h = this.h;
    const hSq = h * h;
    const restDensity = this.materialParams.restDensity;
    const stiffness = this.materialParams.stiffness;
    const poly6Coeff = this.poly6Coeff;
    const particles = this.particles;
    const particleCount = particles.length;
    const neighbors = this.neighborArray;
    const invRestDensity = 1 / restDensity;

    for (let i = 0; i < particleCount; i++) {
      const pi = particles[i];
      let density = 0;
      let neighborCount = this.spatialHash.getNeighborsFast(pi.position, neighbors);
      const pxi = pi.position.x, pyi = pi.position.y;

      if (neighborCount > neighbors.length) neighborCount = neighbors.length;

      for (let j = 0; j < neighborCount; j++) {
        const idx = neighbors[j];
        if (idx < 0 || idx >= particleCount) continue;
        
        const pj = particles[idx];
        const dx = pxi - pj.position.x;
        const dy = pyi - pj.position.y;
        const rSq = dx * dx + dy * dy;
        
        if (rSq < hSq) {
          const diff = hSq - rSq;
          density += poly6Coeff * diff * diff * diff;
        }
      }

      pi.density = density;
      const x = density * invRestDensity;
      const x2 = x * x;
      const x4 = x2 * x2;
      const x6 = x4 * x2;
      const x7 = x6 * x;
      pi.pressure = stiffness * (x7 - 1);
      pi.pressure = Math.max(pi.pressure, -stiffness * 0.5);
    }
  }

  private computeForces(): void {
    const h = this.h;
    const hSq = h * h;
    const viscosity = this.materialParams.viscosity;
    const gravity = this.materialParams.gravity;
    const spikyGradCoeff = this.spikyGradCoeff;
    const viscLapCoeff = this.viscLapCoeff;
    const particles = this.particles;
    const particleCount = particles.length;
    const forceFields = this.forceFields;
    const neighbors = this.neighborArray;

    for (let i = 0; i < particleCount; i++) {
      const pi = particles[i];
      let fx = 0, fy = 0;
      let neighborCount = this.spatialHash.getNeighborsFast(pi.position, neighbors);
      const pxi = pi.position.x, pyi = pi.position.y;

      if (neighborCount > neighbors.length) neighborCount = neighbors.length;

      for (let j = 0; j < neighborCount; j++) {
        const idx = neighbors[j];
        if (i === idx) continue;
        if (idx < 0 || idx >= particleCount) continue;
        
        const pj = particles[idx];
        const dx = pxi - pj.position.x;
        const dy = pyi - pj.position.y;
        const rSq = dx * dx + dy * dy;
        
        if (rSq < hSq && rSq > 0.0001) {
          const r = Math.sqrt(rSq);
          const diff = h - r;
          const invR = 1 / r;
          
          const pressureTerm = (pi.pressure + pj.pressure) / (2 * pj.density + 0.0001);
          const pressureGradMag = spikyGradCoeff * diff * diff;
          const dirX = dx * invR;
          const dirY = dy * invR;
          fx += pressureTerm * pressureGradMag * dirX;
          fy += pressureTerm * pressureGradMag * dirY;
          
          const viscLap = viscLapCoeff * diff;
          const invDensity = 1 / (pj.density + 0.0001);
          fx += viscosity * (pj.velocity.x - pi.velocity.x) * viscLap * invDensity;
          fy += viscosity * (pj.velocity.y - pi.velocity.y) * viscLap * invDensity;
        }
      }

      pi.force.x = fx;
      pi.force.y = fy + gravity;
    }

    if (forceFields.length > 0) {
      this.applyForceFieldsFast();
    }
    
    if (this.materialParams.surfaceTension > 0 && particleCount <= 6000) {
      this.applySurfaceTensionFast();
    }
  }

  private applyForceFields(): void {
    for (const field of this.forceFields) {
      for (const particle of this.particles) {
        const force = this.computeFieldForce(field, particle.position);
        particle.force.x += force.x;
        particle.force.y += force.y;
      }
    }
  }

  private applyForceFieldsFast(): void {
    const particles = this.particles;
    const fields = this.forceFields;
    
    for (let f = 0; f < fields.length; f++) {
      const field = fields[f];
      const fieldType = field.type;
      const fx = field.position.x;
      const fy = field.position.y;
      const radius = field.radius;
      const strength = field.strength;
      const radiusSq = radius * radius;
      
      if (fieldType === 'gravity' || fieldType === 'repel') {
        const sign = fieldType === 'gravity' ? 1 : -1;
        
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const dx = fx - p.position.x;
          const dy = fy - p.position.y;
          const distSq = dx * dx + dy * dy;
          
          if (distSq < radiusSq && distSq > 1) {
            const dist = Math.sqrt(distSq);
            const falloff = 1 - dist / radius;
            const forceMag = sign * strength * falloff * falloff / (dist * 0.1 + 1);
            const invDist = 1 / dist;
            p.force.x += dx * invDist * forceMag;
            p.force.y += dy * invDist * forceMag;
          }
        }
      } else if (fieldType === 'vortex') {
        const cw = field.clockwise ? 1 : -1;
        
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const dx = p.position.x - fx;
          const dy = p.position.y - fy;
          const distSq = dx * dx + dy * dy;
          
          if (distSq < radiusSq && distSq > 1) {
            const dist = Math.sqrt(distSq);
            const falloff = 1 - dist / radius;
            const forceMag = strength * falloff * falloff;
            const invDist = 1 / dist;
            const tx = -dy * invDist * cw;
            const ty = dx * invDist * cw;
            p.force.x += tx * forceMag;
            p.force.y += ty * forceMag;
          }
        }
      } else if (fieldType === 'flow' && field.direction && field.points && field.points.length >= 2) {
        const p1 = field.points[0];
        const p2 = field.points[1];
        const lx = p2.x - p1.x;
        const ly = p2.y - p1.y;
        const lineLenSq = lx * lx + ly * ly;
        
        if (lineLenSq > 1) {
          const lineLen = Math.sqrt(lineLenSq);
          const dirX = lx / lineLen;
          const dirY = ly / lineLen;
          const perpX = -dirY;
          const perpY = dirX;
          const halfWidth = radius;
          
          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const tpx = p.position.x - p1.x;
            const tpy = p.position.y - p1.y;
            
            const proj = tpx * dirX + tpy * dirY;
            if (proj < 0 || proj > lineLen) continue;
            
            const perpDist = Math.abs(tpx * perpX + tpy * perpY);
            if (perpDist > halfWidth) continue;
            
            const falloff = 1 - perpDist / halfWidth;
            const forceMag = strength * falloff;
            p.force.x += field.direction!.x * forceMag;
            p.force.y += field.direction!.y * forceMag;
          }
        }
      } else if (fieldType === 'brush' && field.brushPoints && field.brushPoints.length > 0) {
        const brushPoints = field.brushPoints;
        
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          let totalFx = 0, totalFy = 0;
          let totalWeight = 0;
          
          for (let b = 0; b < brushPoints.length; b++) {
            const bp = brushPoints[b];
            const dx = p.position.x - bp.position.x;
            const dy = p.position.y - bp.position.y;
            const distSq = dx * dx + dy * dy;
            
            if (distSq < radiusSq) {
              const dist = Math.sqrt(distSq);
              const falloff = 1 - dist / radius;
              const weight = falloff * falloff;
              totalFx += bp.direction.x * bp.strength * weight;
              totalFy += bp.direction.y * bp.strength * weight;
              totalWeight += weight;
            }
          }
          
          if (totalWeight > 0) {
            p.force.x += totalFx / totalWeight;
            p.force.y += totalFy / totalWeight;
          }
        }
      }
    }
  }

  private computeFieldForce(field: ForceField, pos: Vec2): Vec2 {
    switch (field.type) {
      case 'gravity':
        return this.computeGravityForce(field, pos);
      case 'repel':
        return this.computeRepelForce(field, pos);
      case 'vortex':
        return this.computeVortexForce(field, pos);
      case 'flow':
        return this.computeFlowForce(field, pos);
      case 'brush':
        return this.computeBrushForce(field, pos);
      default:
        return vec2(0, 0);
    }
  }

  private computeGravityForce(field: ForceField, pos: Vec2): Vec2 {
    const dir = vec2Sub(field.position, pos);
    const dist = vec2Length(dir);
    
    if (dist > field.radius || dist < 1) return vec2(0, 0);
    
    const falloff = 1 - dist / field.radius;
    const strength = field.strength * falloff * falloff / (dist * 0.1 + 1);
    
    return vec2Mul(vec2Normalize(dir), strength);
  }

  private computeRepelForce(field: ForceField, pos: Vec2): Vec2 {
    const dir = vec2Sub(pos, field.position);
    const dist = vec2Length(dir);
    
    if (dist > field.radius || dist < 1) return vec2(0, 0);
    
    const falloff = 1 - dist / field.radius;
    const strength = field.strength * falloff * falloff / (dist * 0.1 + 1);
    
    return vec2Mul(vec2Normalize(dir), strength);
  }

  private computeVortexForce(field: ForceField, pos: Vec2): Vec2 {
    const toCenter = vec2Sub(pos, field.position);
    const dist = vec2Length(toCenter);
    
    if (dist > field.radius || dist < 1) return vec2(0, 0);
    
    const tangent = field.clockwise 
      ? vec2(-toCenter.y, toCenter.x)
      : vec2(toCenter.y, -toCenter.x);
    
    const falloff = 1 - dist / field.radius;
    const strength = field.strength * falloff * falloff;
    
    return vec2Mul(vec2Normalize(tangent), strength);
  }

  private computeFlowForce(field: ForceField, pos: Vec2): Vec2 {
    if (!field.direction || !field.points || field.points.length < 2) {
      return vec2(0, 0);
    }
    
    const p1 = field.points[0];
    const p2 = field.points[1];
    const lineVec = vec2Sub(p2, p1);
    const lineLen = vec2Length(lineVec);
    
    if (lineLen < 1) return vec2(0, 0);
    
    const lineDir = vec2Div(lineVec, lineLen);
    const perpDir = vec2Perp(lineDir);
    
    const toPoint = vec2Sub(pos, p1);
    const projLen = vec2Dot(toPoint, lineDir);
    
    if (projLen < 0 || projLen > lineLen) return vec2(0, 0);
    
    const perpDist = Math.abs(vec2Dot(toPoint, perpDir));
    const halfWidth = field.radius;
    
    if (perpDist > halfWidth) return vec2(0, 0);
    
    const falloff = 1 - perpDist / halfWidth;
    const strength = field.strength * falloff;
    
    return vec2Mul(field.direction, strength);
  }

  private computeBrushForce(field: ForceField, pos: Vec2): Vec2 {
    if (!field.brushPoints || field.brushPoints.length === 0) {
      return vec2(0, 0);
    }
    
    let totalForce = vec2(0, 0);
    let totalWeight = 0;
    
    for (const bp of field.brushPoints) {
      const dist = vec2Dist(pos, bp.position);
      if (dist < field.radius) {
        const falloff = 1 - dist / field.radius;
        const weight = falloff * falloff;
        totalForce.x += bp.direction.x * bp.strength * weight;
        totalForce.y += bp.direction.y * bp.strength * weight;
        totalWeight += weight;
      }
    }
    
    if (totalWeight > 0) {
      return vec2Div(totalForce, totalWeight);
    }
    
    return vec2(0, 0);
  }

  private applySurfaceTension(): void {
    const tension = this.materialParams.surfaceTension;
    if (tension <= 0) return;
    
    const h = this.h;
    const hSq = h * h;
    
    for (let i = 0; i < this.particles.length; i++) {
      const pi = this.particles[i];
      const neighbors = this.spatialHash.getNeighbors(pi.position);
      let colorGradient = vec2(0, 0);
      let colorLaplacian = 0;
      
      for (const j of neighbors) {
        if (i === j) continue;
        
        const pj = this.particles[j];
        const rVec = vec2Sub(pi.position, pj.position);
        const rSq = vec2LengthSq(rVec);
        
        if (rSq < hSq && rSq > 0.0001) {
          const r = Math.sqrt(rSq);
          const diff = h - r;
          
          const gradMag = this.spikyGradCoeff * diff * diff;
          const gradDir = vec2Div(rVec, r);
          colorGradient.x += gradMag * gradDir.x / (pj.density + 0.0001);
          colorGradient.y += gradMag * gradDir.y / (pj.density + 0.0001);
          
          colorLaplacian += this.viscLapCoeff * diff / (pj.density + 0.0001);
        }
      }
      
      const gradLen = vec2Length(colorGradient);
      if (gradLen > 0.1) {
        const tensionForce = vec2Mul(
          vec2Normalize(colorGradient),
          -tension * colorLaplacian
        );
        pi.force.x += tensionForce.x;
        pi.force.y += tensionForce.y;
      }
    }
  }

  private applySurfaceTensionFast(): void {
    const tension = this.materialParams.surfaceTension;
    const h = this.h;
    const hSq = h * h;
    const spikyGradCoeff = this.spikyGradCoeff;
    const viscLapCoeff = this.viscLapCoeff;
    const particles = this.particles;
    const particleCount = particles.length;
    const neighbors = this.neighborArray;
    
    for (let i = 0; i < particleCount; i++) {
      const pi = particles[i];
      let neighborCount = this.spatialHash.getNeighborsFast(pi.position, neighbors);
      let cgx = 0, cgy = 0;
      let colorLaplacian = 0;
      const pxi = pi.position.x, pyi = pi.position.y;

      if (neighborCount > neighbors.length) neighborCount = neighbors.length;
      
      for (let j = 0; j < neighborCount; j++) {
        const idx = neighbors[j];
        if (i === idx) continue;
        if (idx < 0 || idx >= particleCount) continue;
        
        const pj = particles[idx];
        const dx = pxi - pj.position.x;
        const dy = pyi - pj.position.y;
        const rSq = dx * dx + dy * dy;
        
        if (rSq < hSq && rSq > 0.0001) {
          const r = Math.sqrt(rSq);
          const diff = h - r;
          const invR = 1 / r;
          const invDensity = 1 / (pj.density + 0.0001);
          
          const gradMag = spikyGradCoeff * diff * diff;
          cgx += gradMag * dx * invR * invDensity;
          cgy += gradMag * dy * invR * invDensity;
          
          colorLaplacian += viscLapCoeff * diff * invDensity;
        }
      }
      
      const gradLenSq = cgx * cgx + cgy * cgy;
      if (gradLenSq > 0.01) {
        const gradLen = Math.sqrt(gradLenSq);
        const invGradLen = 1 / gradLen;
        const forceMag = -tension * colorLaplacian;
        pi.force.x += cgx * invGradLen * forceMag;
        pi.force.y += cgy * invGradLen * forceMag;
      }
    }
  }

  private integrate(dt: number): void {
    const maxVel = this.simParams.maxVelocity;
    const maxVelSq = maxVel * maxVel;
    
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      
      p.prevPosition.x = p.position.x;
      p.prevPosition.y = p.position.y;
      p.prevVelocity.x = p.velocity.x;
      p.prevVelocity.y = p.velocity.y;
      
      const density = p.density > 0.1 ? p.density : 1;
      const invDensity = 1 / density;
      const ax = p.force.x * invDensity;
      const ay = p.force.y * invDensity;
      
      p.velocity.x += ax * dt;
      p.velocity.y += ay * dt;
      
      const speedSq = p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y;
      if (speedSq > maxVelSq) {
        const speed = Math.sqrt(speedSq);
        const scale = maxVel / speed;
        p.velocity.x *= scale;
        p.velocity.y *= scale;
      }
      
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
    }
  }

  private applyBoundaryConditions(): void {
    const restitution = this.simParams.boundaryRestitution;
    const min = this.bounds.min;
    const max = this.bounds.max;
    
    for (const p of this.particles) {
      if (p.position.x < min.x) {
        p.position.x = min.x;
        p.velocity.x = Math.abs(p.velocity.x) * restitution;
      } else if (p.position.x > max.x) {
        p.position.x = max.x;
        p.velocity.x = -Math.abs(p.velocity.x) * restitution;
      }
      
      if (p.position.y < min.y) {
        p.position.y = min.y;
        p.velocity.y = Math.abs(p.velocity.y) * restitution;
      } else if (p.position.y > max.y) {
        p.position.y = max.y;
        p.velocity.y = -Math.abs(p.velocity.y) * restitution;
      }
    }
    
    this.handleObstacleCollisions();
  }

  private handleObstacleCollisions(): void {
    const restitution = this.simParams.boundaryRestitution;
    
    for (const obstacle of this.obstacles) {
      const points = obstacle.points;
      
      for (const p of this.particles) {
        let minDist = Infinity;
        let closestNormal = vec2(0, 0);
        let closestPoint = vec2(0, 0);
        
        for (let i = 0; i < points.length; i++) {
          const p1 = vec2Add(points[i], obstacle.position);
          const p2 = vec2Add(points[(i + 1) % points.length], obstacle.position);
          
          const result = this.pointToSegment(p.position, p1, p2);
          
          if (result.distance < minDist) {
            minDist = result.distance;
            closestNormal = result.normal;
            closestPoint = result.point;
          }
        }
        
        if (minDist < 5 && this.isPointInsidePolygon(p.position, points.map(pt => vec2Add(pt, obstacle.position)))) {
          p.position = vec2Add(closestPoint, vec2Mul(closestNormal, 5));
          
          const velDotNormal = vec2Dot(p.velocity, closestNormal);
          if (velDotNormal < 0) {
            p.velocity.x -= (1 + restitution) * velDotNormal * closestNormal.x;
            p.velocity.y -= (1 + restitution) * velDotNormal * closestNormal.y;
          }
          
          if (obstacle.velocity) {
            p.velocity.x += obstacle.velocity.x * 0.5;
            p.velocity.y += obstacle.velocity.y * 0.5;
          }
        }
      }
    }
  }

  private pointToSegment(p: Vec2, a: Vec2, b: Vec2): { distance: number; point: Vec2; normal: Vec2 } {
    const ab = vec2Sub(b, a);
    const ap = vec2Sub(p, a);
    const t = clamp(vec2Dot(ap, ab) / (vec2LengthSq(ab) + 0.0001), 0, 1);
    
    const closest = vec2Add(a, vec2Mul(ab, t));
    const diff = vec2Sub(p, closest);
    const dist = vec2Length(diff);
    
    const normal = dist > 0.001 
      ? vec2Div(diff, dist)
      : vec2Normalize(vec2(-ab.y, ab.x));
    
    return { distance: dist, point: closest, normal };
  }

  private isPointInsidePolygon(point: Vec2, polygon: Vec2[]): boolean {
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

  private handleEmittersAndSinks(dt: number): void {
    for (const emitter of this.emitters) {
      const now = Date.now() / 1000;
      const emitInterval = 1 / emitter.rate;
      
      if (now - emitter.lastEmit > emitInterval) {
        emitter.lastEmit = now;
        this.emitParticle(emitter);
      }
    }
    
    const toRemove: number[] = [];
    
    for (const sink of this.sinks) {
      for (let i = 0; i < this.particles.length; i++) {
        const dist = vec2Dist(this.particles[i].position, sink.position);
        if (dist < sink.radius) {
          toRemove.push(i);
        }
      }
    }
    
    if (toRemove.length > 0) {
      toRemove.sort((a, b) => b - a);
      for (const idx of toRemove) {
        this.particles.splice(idx, 1);
      }
    }
  }

  private emitParticle(emitter: Emitter): void {
    if (this.particles.length >= 15000) return;
    
    const jitter = vec2(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );
    
    this.particles.push({
      position: vec2Add(emitter.position, jitter),
      velocity: { ...emitter.velocity },
      prevPosition: vec2Add(emitter.position, jitter),
      prevVelocity: { ...emitter.velocity },
      density: this.materialParams.restDensity,
      pressure: 0,
      force: vec2(0, 0)
    });
  }

  applyMouseForce(position: Vec2, direction: Vec2, strength: number, radius: number): void {
    for (const p of this.particles) {
      const dist = vec2Dist(p.position, position);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        const force = vec2Mul(direction, strength * falloff * falloff);
        p.velocity.x += force.x * 0.016;
        p.velocity.y += force.y * 0.016;
      }
    }
  }

  findNearestForceField(pos: Vec2, maxDist: number = 20): ForceField | null {
    let nearest: ForceField | null = null;
    let minDist = maxDist;
    
    for (const field of this.forceFields) {
      const dist = vec2Dist(pos, field.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = field;
      }
    }
    
    return nearest;
  }
}
