import { Vec2 } from '../types';

export class SpatialHash {
  private cellSize: number;
  private grid: Map<number, number[]>;
  private cellCoords: Map<number, number>;
  private reusableNeighbors: number[];

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.cellCoords = new Map();
    this.reusableNeighbors = [];
  }

  private getCellKey(cx: number, cy: number): number {
    return cx * 73856093 ^ cy * 19349663;
  }

  clear(): void {
    this.grid.clear();
    this.cellCoords.clear();
  }

  insert(index: number, position: Vec2): void {
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);
    const key = this.getCellKey(cx, cy);
    this.cellCoords.set(index, key);
    
    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    cell.push(index);
  }

  getNeighbors(position: Vec2): number[] {
    const neighbors: number[] = [];
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = this.getCellKey(cx + dx, cy + dy);
        const cell = this.grid.get(key);
        if (cell) {
          neighbors.push(...cell);
        }
      }
    }

    return neighbors;
  }

  getNeighborsFast(position: Vec2, out: number[]): number {
    out.length = 0;
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = this.getCellKey(cx + dx, cy + dy);
        const cell = this.grid.get(key);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            out.push(cell[i]);
          }
        }
      }
    }

    return out.length;
  }

  getCellSize(): number {
    return this.cellSize;
  }

  setCellSize(size: number): void {
    this.cellSize = size;
  }
}
