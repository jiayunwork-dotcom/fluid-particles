import { Vec2 } from '../types';

export class SpatialHash {
  private cellSize: number;
  private invCellSize: number;
  private grid: { [key: number]: number[] };
  private cellKeys: number[];
  private cellCount: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.grid = {};
    this.cellKeys = [];
    this.cellCount = 0;
  }

  private getCellKey(cx: number, cy: number): number {
    return (cx << 16) ^ cy;
  }

  clear(): void {
    for (let i = 0; i < this.cellCount; i++) {
      const key = this.cellKeys[i];
      this.grid[key].length = 0;
    }
    this.cellCount = 0;
  }

  insert(index: number, position: Vec2): void {
    const cx = Math.floor(position.x * this.invCellSize);
    const cy = Math.floor(position.y * this.invCellSize);
    const key = this.getCellKey(cx, cy);
    
    let cell = this.grid[key];
    if (!cell) {
      cell = [];
      this.grid[key] = cell;
      this.cellKeys[this.cellCount++] = key;
    }
    cell.push(index);
  }

  getNeighbors(position: Vec2): number[] {
    const neighbors: number[] = [];
    const cx = Math.floor(position.x * this.invCellSize);
    const cy = Math.floor(position.y * this.invCellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = this.getCellKey(cx + dx, cy + dy);
        const cell = this.grid[key];
        if (cell && cell.length > 0) {
          for (let i = 0; i < cell.length; i++) {
            neighbors.push(cell[i]);
          }
        }
      }
    }

    return neighbors;
  }

  getNeighborsFast(position: Vec2, out: number[]): number {
    let count = 0;
    const cx = Math.floor(position.x * this.invCellSize);
    const cy = Math.floor(position.y * this.invCellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = this.getCellKey(cx + dx, cy + dy);
        const cell = this.grid[key];
        if (cell && cell.length > 0) {
          for (let i = 0; i < cell.length; i++) {
            out[count++] = cell[i];
          }
        }
      }
    }

    return count;
  }

  getCellSize(): number {
    return this.cellSize;
  }

  setCellSize(size: number): void {
    this.cellSize = size;
    this.invCellSize = 1 / size;
  }
}
