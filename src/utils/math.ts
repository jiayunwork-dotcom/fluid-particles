import { Vec2 } from '../types';

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Mul(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vec2Div(v: Vec2, s: number): Vec2 {
  return { x: v.x / s, y: v.y / s };
}

export function vec2Dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function vec2Length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2LengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vec2Dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function vec2DistSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

export function vec2Perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function poly6Kernel(rSq: number, h: number): number {
  if (rSq >= h * h) return 0;
  const diff = h * h - rSq;
  return (315 / (64 * Math.PI * Math.pow(h, 9))) * diff * diff * diff;
}

export function spikyKernelGradient(r: number, h: number): number {
  if (r >= h || r === 0) return 0;
  const diff = h - r;
  return -(45 / (Math.PI * Math.pow(h, 6))) * diff * diff;
}

export function viscosityKernelLaplacian(r: number, h: number): number {
  if (r >= h) return 0;
  return (45 / (Math.PI * Math.pow(h, 6))) * (h - r);
}

export function velocityToColor(speed: number, maxSpeed: number): [number, number, number] {
  const t = Math.min(speed / maxSpeed, 1);
  if (t < 0.25) {
    const s = t / 0.25;
    return [0, 0.4 * s, 0.8 + 0.2 * s];
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [0, 0.4 + 0.6 * s, 1 - s];
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [s, 1, 0];
  } else {
    const s = (t - 0.75) / 0.25;
    return [1, 1 - s * 0.5, 0];
  }
}
