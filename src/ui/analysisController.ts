import { SPHSystem } from '../physics/sphSystem';
import { Renderer } from '../webgl/renderer';
import {
  ColoringMode, ColorStop, ColormapPreset, AnalysisRegion, RegionStats, HistogramData, Particle, Vec2
} from '../types';
import { generateId, vec2 } from '../utils/math';

interface DragState {
  isDragging: boolean;
  stopIndex: number;
  startX: number;
}

export class AnalysisController {
  private canvas: HTMLCanvasElement;
  private sphSystem: SPHSystem;
  private renderer: Renderer;

  private coloringMode: ColoringMode = 'velocity';
  private colorStops: ColorStop[] = [];
  private colormapPresets: ColormapPreset[] = [];
  private customPresets: ColormapPreset[] = [];

  private analysisRegions: AnalysisRegion[] = [];
  private regionStats: Map<string, RegionStats> = new Map();
  private isDrawingRegion: boolean = false;
  private regionStartPos: Vec2 | null = null;
  private regionEndPos: Vec2 | null = null;
  private statsUpdateTimer: number = 0;
  private readonly STATS_INTERVAL: number = 1000;

  private histogramCanvas: HTMLCanvasElement | null = null;
  private histogramCtx: CanvasRenderingContext2D | null = null;
  private histogramData: HistogramData | null = null;
  private readonly HISTOGRAM_BINS: number = 20;

  private gradientBar: HTMLDivElement | null = null;
  private stopHandles: HTMLDivElement[] = [];
  private dragState: DragState = { isDragging: false, stopIndex: -1, startX: 0 };
  private activeColorPicker: HTMLInputElement | null = null;
  private activeStopIndex: number = -1;

  private viewOffset: Vec2 = { x: 0, y: 0 };
  private viewScale: number = 1;

  constructor(
    canvas: HTMLCanvasElement,
    sphSystem: SPHSystem,
    renderer: Renderer
  ) {
    this.canvas = canvas;
    this.sphSystem = sphSystem;
    this.renderer = renderer;

    this.initDefaultPresets();
    this.applyPreset(this.colormapPresets[0]);
    this.renderer.setColoringMode(this.coloringMode);
  }

  setView(offset: Vec2, scale: number): void {
    this.viewOffset = offset;
    this.viewScale = scale;
    this.updateRegionLabels();
  }

  private initDefaultPresets(): void {
    this.colormapPresets = [
      {
        name: '冷暖',
        stops: [
          { position: 0, color: '#0000ff' },
          { position: 0.5, color: '#ffffff' },
          { position: 1, color: '#ff0000' }
        ]
      },
      {
        name: '彩虹',
        stops: [
          { position: 0, color: '#8b00ff' },
          { position: 0.2, color: '#0000ff' },
          { position: 0.4, color: '#00ff00' },
          { position: 0.6, color: '#ffff00' },
          { position: 0.8, color: '#ff8c00' },
          { position: 1, color: '#ff0000' }
        ]
      },
      {
        name: '灰度',
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' }
        ]
      }
    ];

    const saved = localStorage.getItem('colormapCustomPresets');
    if (saved) {
      try {
        this.customPresets = JSON.parse(saved);
      } catch {
        this.customPresets = [];
      }
    }
  }

  getAllPresets(): ColormapPreset[] {
    return [...this.colormapPresets, ...this.customPresets];
  }

  applyPreset(preset: ColormapPreset): void {
    this.colorStops = preset.stops.map(s => ({ ...s }));
    this.renderer.updateColormapTexture(this.colorStops);
    this.updateGradientBar();
    this.updateStopHandles();
  }

  saveCustomPreset(name: string): boolean {
    if (this.customPresets.length >= 10 || this.colorStops.length === 0) return false;
    this.customPresets.push({
      name,
      stops: this.colorStops.map(s => ({ ...s }))
    });
    localStorage.setItem('colormapCustomPresets', JSON.stringify(this.customPresets));
    return true;
  }

  deleteCustomPreset(name: string): void {
    this.customPresets = this.customPresets.filter(p => p.name !== name);
    localStorage.setItem('colormapCustomPresets', JSON.stringify(this.customPresets));
  }

  getColorStops(): ColorStop[] {
    return [...this.colorStops];
  }

  setColoringMode(mode: ColoringMode): void {
    this.coloringMode = mode;
    this.renderer.setColoringMode(mode);
  }

  getColoringMode(): ColoringMode {
    return this.coloringMode;
  }

  addColorStop(position: number, color: string): boolean {
    if (this.colorStops.length >= 8) return false;
    this.colorStops.push({ position, color });
    this.colorStops.sort((a, b) => a.position - b.position);
    this.renderer.updateColormapTexture(this.colorStops);
    this.updateGradientBar();
    this.updateStopHandles();
    return true;
  }

  removeColorStop(index: number): void {
    if (this.colorStops.length <= 2) return;
    this.colorStops.splice(index, 1);
    this.renderer.updateColormapTexture(this.colorStops);
    this.updateGradientBar();
    this.updateStopHandles();
  }

  updateColorStopPosition(index: number, position: number): void {
    if (index < 0 || index >= this.colorStops.length) return;
    this.colorStops[index].position = Math.max(0, Math.min(1, position));
    this.colorStops.sort((a, b) => a.position - b.position);
    this.renderer.updateColormapTexture(this.colorStops);
    this.updateGradientBar();
  }

  updateColorStopColor(index: number, color: string): void {
    if (index < 0 || index >= this.colorStops.length) return;
    this.colorStops[index].color = color;
    this.renderer.updateColormapTexture(this.colorStops);
    this.updateGradientBar();
  }

  setupUI(): void {
    this.setupColoringModeButtons();
    this.setupGradientEditor();
    this.setupPresetSelector();
    this.setupSavePreset();
    this.setupRegionTool();
    this.setupHistogram();
    this.updateRegionList();
  }

  private setupColoringModeButtons(): void {
    const buttons = document.querySelectorAll('.coloring-mode-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as ColoringMode;
        if (mode) {
          this.setColoringMode(mode);
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
  }

  private setupGradientEditor(): void {
    this.gradientBar = document.getElementById('gradientBar') as HTMLDivElement;
    if (!this.gradientBar) return;

    this.gradientBar.addEventListener('click', (e) => {
      if (this.dragState.isDragging) return;
      const rect = this.gradientBar!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const position = Math.max(0, Math.min(1, x / rect.width));
      const color = this.interpolateColorAt(position);
      if (this.addColorStop(position, color)) {
        this.updateStopHandles();
      }
    });

    this.updateGradientBar();
    this.updateStopHandles();
  }

  private updateGradientBar(): void {
    if (!this.gradientBar) return;
    if (this.colorStops.length === 0) {
      this.gradientBar.style.background = '#888';
      return;
    }
    const sorted = [...this.colorStops].sort((a, b) => a.position - b.position);
    const stops = sorted.map(s => `${s.color} ${(s.position * 100).toFixed(1)}%`).join(', ');
    this.gradientBar.style.background = `linear-gradient(to right, ${stops})`;
  }

  private interpolateColorAt(position: number): string {
    if (this.colorStops.length === 0) return '#888888';
    if (this.colorStops.length === 1) return this.colorStops[0].color;

    const sorted = [...this.colorStops].sort((a, b) => a.position - b.position);
    if (position <= sorted[0].position) return sorted[0].color;
    if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].color;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (position >= sorted[i].position && position <= sorted[i + 1].position) {
        const range = sorted[i + 1].position - sorted[i].position;
        const t = range > 0 ? (position - sorted[i].position) / range : 0;
        const c1 = this.hexToRgb(sorted[i].color);
        const c2 = this.hexToRgb(sorted[i + 1].color);
        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
    }
    return '#888888';
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 128, g: 128, b: 128 };
  }

  private updateStopHandles(): void {
    const container = document.getElementById('colorStopHandles');
    if (!container || !this.gradientBar) return;

    container.innerHTML = '';
    this.stopHandles = [];

    const sorted = [...this.colorStops].sort((a, b) => a.position - b.position);

    sorted.forEach((stop, index) => {
      const handle = document.createElement('div');
      handle.className = 'color-stop-handle';
      handle.style.left = `${(stop.position * 100).toFixed(1)}%`;
      handle.style.borderBottomColor = stop.color;
      handle.title = `位置: ${(stop.position * 100).toFixed(0)}%, 右键删除`;

      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button === 2) {
          e.preventDefault();
          this.removeColorStop(index);
          return;
        }
        this.dragState = {
          isDragging: true,
          stopIndex: index,
          startX: e.clientX
        };
        document.addEventListener('mousemove', this.onStopDrag.bind(this));
        document.addEventListener('mouseup', this.onStopDragEnd.bind(this));
      });

      handle.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.removeColorStop(index);
      });

      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.showColorPicker(index, handle);
      });

      handle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showColorPicker(index, handle);
      });

      container.appendChild(handle);
      this.stopHandles.push(handle);
    });
  }

  private onStopDrag(e: MouseEvent): void {
    if (!this.dragState.isDragging || !this.gradientBar) return;
    const rect = this.gradientBar.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.updateColorStopPosition(this.dragState.stopIndex, position);
    const sorted = [...this.colorStops].sort((a, b) => a.position - b.position);
    const newIndex = sorted.findIndex(s =>
      Math.abs(s.position - position) < 0.001 && s.color === this.colorStops[this.dragState.stopIndex].color
    );
    if (newIndex >= 0) {
      this.dragState.stopIndex = newIndex;
    }
    this.updateStopHandles();
  }

  private onStopDragEnd(): void {
    this.dragState.isDragging = false;
    this.dragState.stopIndex = -1;
    document.removeEventListener('mousemove', this.onStopDrag.bind(this));
    document.removeEventListener('mouseup', this.onStopDragEnd.bind(this));
  }

  private showColorPicker(stopIndex: number, handle: HTMLDivElement): void {
    this.activeStopIndex = stopIndex;

    if (this.activeColorPicker) {
      this.activeColorPicker.remove();
    }

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = this.colorStops[stopIndex].color;
    picker.style.position = 'absolute';
    picker.style.opacity = '0';
    picker.style.pointerEvents = 'none';
    document.body.appendChild(picker);

    picker.addEventListener('input', () => {
      this.updateColorStopColor(this.activeStopIndex, picker.value);
      this.updateStopHandles();
    });

    picker.addEventListener('change', () => {
      setTimeout(() => {
        if (this.activeColorPicker) {
          this.activeColorPicker.remove();
          this.activeColorPicker = null;
        }
      }, 100);
    });

    this.activeColorPicker = picker;
    picker.click();
  }

  private setupPresetSelector(): void {
    const selector = document.getElementById('colormapPreset') as HTMLSelectElement;
    if (!selector) return;

    this.refreshPresetSelector();

    selector.addEventListener('change', () => {
      const name = selector.value;
      const allPresets = this.getAllPresets();
      const preset = allPresets.find(p => p.name === name);
      if (preset) {
        this.applyPreset(preset);
      }
    });
  }

  private refreshPresetSelector(): void {
    const selector = document.getElementById('colormapPreset') as HTMLSelectElement;
    if (!selector) return;

    selector.innerHTML = '';

    const defaultGroup = document.createElement('optgroup');
    defaultGroup.label = '预设';
    this.colormapPresets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      defaultGroup.appendChild(opt);
    });
    selector.appendChild(defaultGroup);

    if (this.customPresets.length > 0) {
      const customGroup = document.createElement('optgroup');
      customGroup.label = '自定义';
      this.customPresets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        customGroup.appendChild(opt);
      });
      selector.appendChild(customGroup);
    }
  }

  private setupSavePreset(): void {
    const saveBtn = document.getElementById('btnSavePreset');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const name = prompt('输入预设名称:');
        if (name && name.trim()) {
          if (this.saveCustomPreset(name.trim())) {
            this.refreshPresetSelector();
            alert('预设已保存!');
          } else {
            alert('保存失败: 最多保存10个自定义预设');
          }
        }
      });
    }

    const delBtn = document.getElementById('btnDeletePreset');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        const selector = document.getElementById('colormapPreset') as HTMLSelectElement;
        if (!selector) return;
        const name = selector.value;
        if (this.customPresets.find(p => p.name === name)) {
          if (confirm(`确定要删除预设 "${name}" 吗?`)) {
            this.deleteCustomPreset(name);
            this.refreshPresetSelector();
          }
        } else {
          alert('只能删除自定义预设');
        }
      });
    }
  }

  private setupRegionTool(): void {
    const addBtn = document.getElementById('btnAddRegion');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.enableRegionDrawing();
      });
    }

    const clearBtn = document.getElementById('btnClearRegions');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearAllRegions();
      });
    }
  }

  private enableRegionDrawing(): void {
    if (this.analysisRegions.length >= 5) {
      alert('最多只能创建5个分析区域');
      return;
    }
    this.canvas.style.cursor = 'crosshair';

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.isDrawingRegion = true;
      this.regionStartPos = this.getCanvasPos(e);
      this.regionEndPos = { ...this.regionStartPos };
      this.showTempRegionBox();
    };

    const onMove = (e: MouseEvent) => {
      if (!this.isDrawingRegion) return;
      e.stopImmediatePropagation();
      this.regionEndPos = this.getCanvasPos(e);
      this.updateTempRegionBox();
    };

    const onUp = (e: MouseEvent) => {
      if (!this.isDrawingRegion) return;
      e.stopImmediatePropagation();
      this.isDrawingRegion = false;
      this.hideTempRegionBox();
      this.canvas.style.cursor = 'default';

      if (this.regionStartPos && this.regionEndPos) {
        const x1 = Math.min(this.regionStartPos.x, this.regionEndPos.x);
        const y1 = Math.min(this.regionStartPos.y, this.regionEndPos.y);
        const x2 = Math.max(this.regionStartPos.x, this.regionEndPos.x);
        const y2 = Math.max(this.regionStartPos.y, this.regionEndPos.y);
        const width = x2 - x1;
        const height = y2 - y1;

        if (width > 10 && height > 10 && this.analysisRegions.length < 5) {
          const region: AnalysisRegion = {
            id: generateId(),
            x: x1,
            y: y1,
            width,
            height,
            label: `${this.analysisRegions.length + 1}`
          };
          this.analysisRegions.push(region);
          this.renderer.setAnalysisRegions(this.analysisRegions);
          this.updateRegionLabels();
          this.updateRegionList();
          this.computeRegionStats();
        }
      }

      this.regionStartPos = null;
      this.regionEndPos = null;
      this.canvas.removeEventListener('mousedown', onDown);
      this.canvas.removeEventListener('mousemove', onMove);
      this.canvas.removeEventListener('mouseup', onUp);
      this.canvas.removeEventListener('mouseleave', onUp);
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    this.canvas.addEventListener('mouseup', onUp);
    this.canvas.addEventListener('mouseleave', onUp);
  }

  private getCanvasPos(e: MouseEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return vec2(
      (e.clientX - rect.left) * dpr / this.viewScale - this.viewOffset.x,
      (e.clientY - rect.top) * dpr / this.viewScale - this.viewOffset.y
    );
  }

  private showTempRegionBox(): void {
    let box = document.getElementById('tempRegionBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tempRegionBox';
      box.className = 'analysis-region temp';
      document.body.appendChild(box);
    }
    box.style.display = 'block';
  }

  private updateTempRegionBox(): void {
    const box = document.getElementById('tempRegionBox');
    if (!box || !this.regionStartPos || !this.regionEndPos) return;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const screenX1 = (this.regionStartPos.x + this.viewOffset.x) * this.viewScale / dpr;
    const screenY1 = (this.regionStartPos.y + this.viewOffset.y) * this.viewScale / dpr;
    const screenX2 = (this.regionEndPos.x + this.viewOffset.x) * this.viewScale / dpr;
    const screenY2 = (this.regionEndPos.y + this.viewOffset.y) * this.viewScale / dpr;

    const left = rect.left + Math.min(screenX1, screenX2);
    const top = rect.top + Math.min(screenY1, screenY2);
    const width = Math.abs(screenX2 - screenX1);
    const height = Math.abs(screenY2 - screenY1);

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  }

  private hideTempRegionBox(): void {
    const box = document.getElementById('tempRegionBox');
    if (box) {
      box.style.display = 'none';
    }
  }

  private updateRegionList(): void {
    const container = document.getElementById('regionList');
    if (!container) return;

    container.innerHTML = '';

    this.analysisRegions.forEach((region) => {
      const item = document.createElement('div');
      item.className = 'region-item';
      item.dataset.regionId = region.id;

      const header = document.createElement('div');
      header.className = 'region-header';

      const label = document.createElement('span');
      label.className = 'region-label';
      label.textContent = `区域 ${region.label}`;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'region-close';
      closeBtn.textContent = '×';
      closeBtn.title = '移除区域';
      closeBtn.addEventListener('click', () => {
        this.removeRegion(region.id);
      });

      header.appendChild(label);
      header.appendChild(closeBtn);
      item.appendChild(header);

      const stats = this.regionStats.get(region.id);
      if (stats) {
        const statsDiv = document.createElement('div');
        statsDiv.className = 'region-stats';
        statsDiv.innerHTML = `
          <div><span>粒子数:</span> <b>${stats.particleCount}</b></div>
          <div><span>平均速度:</span> <b>${stats.avgVelocity.toFixed(1)}</b></div>
          <div><span>最大速度:</span> <b>${stats.maxVelocity.toFixed(1)}</b></div>
          <div><span>平均密度:</span> <b>${stats.avgDensity.toFixed(0)}</b></div>
          <div><span>平均压力:</span> <b>${stats.avgPressure.toFixed(0)}</b></div>
          <div><span>平均温度:</span> <b>${stats.avgTemperature.toFixed(1)}°</b></div>
        `;
        item.appendChild(statsDiv);
      }

      container.appendChild(item);
    });
  }

  private removeRegion(id: string): void {
    this.analysisRegions = this.analysisRegions.filter(r => r.id !== id);
    this.regionStats.delete(id);
    this.renderer.setAnalysisRegions(this.analysisRegions);
    this.updateRegionLabels();
    this.updateRegionList();
  }

  private clearAllRegions(): void {
    this.analysisRegions = [];
    this.regionStats.clear();
    this.renderer.setAnalysisRegions(this.analysisRegions);
    this.updateRegionLabels();
    this.updateRegionList();
  }

  private updateRegionLabels(): void {
    let overlay = document.getElementById('regionLabelOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'regionLabelOverlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;';
      const parent = this.canvas.parentElement;
      if (parent) parent.appendChild(overlay);
      else document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    const canvasRect = this.canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const offsetX = canvasRect.left - overlayRect.left;
    const offsetY = canvasRect.top - overlayRect.top;
    const dpr = window.devicePixelRatio || 1;

    this.analysisRegions.forEach(region => {
      const label = document.createElement('div');
      label.className = 'analysis-region-label';
      label.textContent = region.label;
      const screenX = offsetX + (region.x + this.viewOffset.x) * this.viewScale / dpr;
      const screenY = offsetY + (region.y + this.viewOffset.y) * this.viewScale / dpr;
      label.style.left = `${Math.max(0, screenX)}px`;
      label.style.top = `${Math.max(0, screenY - 22)}px`;
      overlay.appendChild(label);
    });
  }

  private computeRegionStats(): void {
    const particles = this.sphSystem.getParticles();

    this.analysisRegions.forEach(region => {
      let count = 0;
      let sumVel = 0, maxVel = 0;
      let sumDensity = 0, sumPressure = 0, sumTemp = 0;

      for (const p of particles) {
        if (p.position.x >= region.x && p.position.x <= region.x + region.width &&
            p.position.y >= region.y && p.position.y <= region.y + region.height) {
          count++;
          const speed = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
          sumVel += speed;
          if (speed > maxVel) maxVel = speed;
          sumDensity += p.density;
          sumPressure += p.pressure;
          sumTemp += p.temperature;
        }
      }

      const stats: RegionStats = {
        particleCount: count,
        avgVelocity: count > 0 ? sumVel / count : 0,
        maxVelocity: maxVel,
        avgDensity: count > 0 ? sumDensity / count : 0,
        avgPressure: count > 0 ? sumPressure / count : 0,
        avgTemperature: count > 0 ? sumTemp / count : 20
      };

      this.regionStats.set(region.id, stats);
    });

    this.updateRegionList();
  }

  private setupHistogram(): void {
    this.histogramCanvas = document.getElementById('histogramCanvas') as HTMLCanvasElement;
    if (this.histogramCanvas) {
      this.histogramCtx = this.histogramCanvas.getContext('2d');
    }
  }

  private computeHistogram(): void {
    const particles = this.sphSystem.getParticles();
    if (particles.length === 0) return;

    const values: number[] = [];
    let minVal = Infinity, maxVal = -Infinity, sum = 0;

    for (const p of particles) {
      let val: number;
      switch (this.coloringMode) {
        case 'velocity':
          val = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
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
          val = 0;
      }
      values.push(val);
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
      sum += val;
    }

    const mean = sum / values.length;
    let variance = 0;
    for (const v of values) {
      variance += (v - mean) * (v - mean);
    }
    variance /= values.length;
    const stdDev = Math.sqrt(variance);

    const bins = new Array(this.HISTOGRAM_BINS).fill(0);
    const range = maxVal - minVal;
    const invBinWidth = range > 0.0001 ? this.HISTOGRAM_BINS / range : 0;

    for (const v of values) {
      let binIdx = Math.floor((v - minVal) * invBinWidth);
      if (binIdx >= this.HISTOGRAM_BINS) binIdx = this.HISTOGRAM_BINS - 1;
      if (binIdx < 0) binIdx = 0;
      bins[binIdx]++;
    }

    this.histogramData = {
      bins,
      minValue: minVal,
      maxValue: maxVal,
      mean,
      stdDev
    };

    this.drawHistogram();
    this.updateHistogramStats();
  }

  private drawHistogram(): void {
    if (!this.histogramCanvas || !this.histogramCtx || !this.histogramData) return;

    const ctx = this.histogramCtx;
    const w = this.histogramCanvas.width;
    const h = this.histogramCanvas.height;
    const padding = { top: 5, right: 5, bottom: 5, left: 5 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(30, 30, 60, 0.8)';
    ctx.fillRect(0, 0, w, h);

    const { bins, minValue, maxValue } = this.histogramData;
    const maxCount = Math.max(...bins, 1);
    const binWidth = chartW / this.HISTOGRAM_BINS;

    for (let i = 0; i < this.HISTOGRAM_BINS; i++) {
      const barHeight = (bins[i] / maxCount) * chartH;
      const x = padding.left + i * binWidth;
      const y = padding.top + (chartH - barHeight);

      const t = (i + 0.5) / this.HISTOGRAM_BINS;
      const color = this.interpolateColorAt(t);

      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y, binWidth - 2, barHeight);
    }

    ctx.strokeStyle = 'rgba(100, 150, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding.left, padding.top, chartW, chartH);
  }

  private updateHistogramStats(): void {
    if (!this.histogramData) return;

    const minEl = document.getElementById('histMinValue');
    const maxEl = document.getElementById('histMaxValue');
    const meanEl = document.getElementById('histMeanValue');
    const stdEl = document.getElementById('histStdValue');

    const format = (v: number) => {
      if (Math.abs(v) >= 1000) return v.toFixed(0);
      if (Math.abs(v) >= 10) return v.toFixed(1);
      return v.toFixed(2);
    };

    if (minEl) minEl.textContent = format(this.histogramData.minValue);
    if (maxEl) maxEl.textContent = format(this.histogramData.maxValue);
    if (meanEl) meanEl.textContent = format(this.histogramData.mean);
    if (stdEl) stdEl.textContent = format(this.histogramData.stdDev);
  }

  update(dt: number): void {
    if (this.analysisRegions.length > 0) {
      this.updateRegionLabels();
    }
    this.statsUpdateTimer += dt * 1000;
    if (this.statsUpdateTimer >= this.STATS_INTERVAL) {
      this.statsUpdateTimer = 0;
      if (this.analysisRegions.length > 0) {
        this.computeRegionStats();
      }
      this.computeHistogram();
    }
  }

  getAnalysisRegions(): AnalysisRegion[] {
    return [...this.analysisRegions];
  }

  getRegionStats(): Map<string, RegionStats> {
    return new Map(this.regionStats);
  }

  getHistogramData(): HistogramData | null {
    return this.histogramData;
  }
}
