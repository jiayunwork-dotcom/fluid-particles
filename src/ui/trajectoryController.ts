import { TrajectoryFrame, TrajectoryData, TrajectoryState, SelectionBox, Vec2 } from '../types';
import { Renderer } from '../webgl/renderer';
import { SPHSystem } from '../physics/sphSystem';

export class TrajectoryController {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private sphSystem: SPHSystem;

  private trajectoryData: TrajectoryData | null = null;
  private trajectoryState: TrajectoryState = {
    isRecording: false,
    isPlaying: false,
    currentFrameIndex: 0,
    playbackSpeed: 1.0,
    selectedParticleIndices: [],
    playheadTime: 0
  };

  private frameCounter: number = 0;
  private recordFrameInterval: number = 3;
  private lastPlaybackTime: number = 0;
  private baseFrameInterval: number = 1000 / 30;

  private selectionBox: SelectionBox = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    isSelecting: false
  };

  private onStateChange: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: Renderer,
    sphSystem: SPHSystem
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.sphSystem = sphSystem;
  }

  setOnStateChange(callback: () => void): void {
    this.onStateChange = callback;
  }

  startRecording(): void {
    if (this.trajectoryState.isPlaying) return;

    const particleCount = this.sphSystem.getParticleCount();
    const now = performance.now();

    this.trajectoryData = {
      version: 1,
      particleCount: particleCount,
      totalFrames: 0,
      frameInterval: this.recordFrameInterval,
      startTime: now,
      endTime: now,
      frames: []
    };

    this.trajectoryState.isRecording = true;
    this.trajectoryState.currentFrameIndex = 0;
    this.frameCounter = 0;
    this.trajectoryState.selectedParticleIndices = [];

    this.updateUI();
    this.notifyStateChange();
  }

  stopRecording(): void {
    if (!this.trajectoryState.isRecording || !this.trajectoryData) return;

    this.trajectoryState.isRecording = false;
    this.trajectoryData.endTime = performance.now();
    this.trajectoryData.totalFrames = this.trajectoryData.frames.length;

    this.updateUI();
    this.notifyStateChange();
  }

  recordFrame(): void {
    if (!this.trajectoryState.isRecording || !this.trajectoryData) return;

    this.frameCounter++;
    if (this.frameCounter % this.recordFrameInterval !== 0) return;

    const particles = this.sphSystem.getParticles();
    const count = Math.min(particles.length, this.trajectoryData.particleCount);

    const positions = new Float32Array(count * 2);
    const velocities = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      positions[i * 2] = p.position.x;
      positions[i * 2 + 1] = p.position.y;
      velocities[i * 2] = p.velocity.x;
      velocities[i * 2 + 1] = p.velocity.y;
    }

    const frame: TrajectoryFrame = {
      timestamp: performance.now(),
      frameIndex: this.trajectoryData.frames.length,
      positions,
      velocities
    };

    this.trajectoryData.frames.push(frame);
    this.trajectoryData.totalFrames = this.trajectoryData.frames.length;

    this.updateRecordedFramesUI();
    this.notifyStateChange();
  }

  startPlayback(): void {
    if (!this.trajectoryData || this.trajectoryData.frames.length < 2) return;

    this.trajectoryState.isPlaying = true;
    this.trajectoryState.currentFrameIndex = 0;
    this.lastPlaybackTime = performance.now();
    this.trajectoryState.playheadTime = 0;

    this.sphSystem.setPaused(true);

    this.updateUI();
    this.notifyStateChange();
  }

  stopPlayback(): void {
    this.trajectoryState.isPlaying = false;
    this.trajectoryState.currentFrameIndex = 0;
    this.trajectoryState.playheadTime = 0;

    this.updateUI();
    this.notifyStateChange();
  }

  exitPlayback(): void {
    this.trajectoryState.isPlaying = false;
    this.trajectoryState.currentFrameIndex = 0;
    this.trajectoryState.playheadTime = 0;
    this.trajectoryState.selectedParticleIndices = [];
    this.selectionBox.isSelecting = false;

    this.sphSystem.setPaused(false);

    this.hideSelectionBox();
    this.updateUI();
    this.notifyStateChange();
  }

  updatePlayback(currentTime: number): void {
    if (!this.trajectoryState.isPlaying || !this.trajectoryData) return;

    const deltaTime = (currentTime - this.lastPlaybackTime) * this.trajectoryState.playbackSpeed;
    this.lastPlaybackTime = currentTime;
    this.trajectoryState.playheadTime += deltaTime;

    const maxTime = (this.trajectoryData.frames.length - 1) * this.baseFrameInterval;
    if (this.trajectoryState.playheadTime >= maxTime) {
      this.trajectoryState.playheadTime = 0;
    }

    const frameIndex = Math.floor(this.trajectoryState.playheadTime / this.baseFrameInterval);
    const clampedIndex = Math.min(frameIndex, this.trajectoryData.frames.length - 1);

    if (clampedIndex !== this.trajectoryState.currentFrameIndex) {
      this.trajectoryState.currentFrameIndex = clampedIndex;
      this.updateTimelineUI();
    }

    this.render();
  }

  render(): void {
    if (!this.trajectoryData) return;

    this.renderer.renderTrajectory(
      this.trajectoryData.frames,
      this.trajectoryState.currentFrameIndex,
      this.trajectoryState.selectedParticleIndices,
      this.trajectoryData.particleCount
    );
  }

  setCurrentFrame(index: number): void {
    if (!this.trajectoryData) return;
    const clampedIndex = Math.max(0, Math.min(index, this.trajectoryData.frames.length - 1));
    this.trajectoryState.currentFrameIndex = clampedIndex;
    this.trajectoryState.playheadTime = clampedIndex * this.baseFrameInterval;
    this.updateFrameDisplay();
    this.render();
    this.notifyStateChange();
  }

  setPlaybackSpeed(speed: number): void {
    this.trajectoryState.playbackSpeed = Math.max(0.25, Math.min(4, speed));
    this.updateSpeedUI();
    this.notifyStateChange();
  }

  clearTrajectory(): void {
    this.trajectoryData = null;
    this.trajectoryState = {
      isRecording: false,
      isPlaying: false,
      currentFrameIndex: 0,
      playbackSpeed: 1.0,
      selectedParticleIndices: [],
      playheadTime: 0
    };
    this.selectionBox.isSelecting = false;

    this.hideSelectionBox();
    this.updateUI();
    this.notifyStateChange();
  }

  startSelection(e: MouseEvent): void {
    if (!this.trajectoryState.isPlaying || !this.trajectoryData) return;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.selectionBox = {
      startX: (e.clientX - rect.left) * dpr,
      startY: (e.clientY - rect.top) * dpr,
      endX: (e.clientX - rect.left) * dpr,
      endY: (e.clientY - rect.top) * dpr,
      isSelecting: true
    };

    this.showSelectionBox(e.clientX, e.clientY, 0, 0);
  }

  updateSelection(e: MouseEvent): void {
    if (!this.selectionBox.isSelecting) return;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.selectionBox.endX = (e.clientX - rect.left) * dpr;
    this.selectionBox.endY = (e.clientY - rect.top) * dpr;

    const minX = Math.min(this.selectionBox.startX, this.selectionBox.endX) / dpr;
    const minY = Math.min(this.selectionBox.startY, this.selectionBox.endY) / dpr;
    const width = Math.abs(this.selectionBox.endX - this.selectionBox.startX) / dpr;
    const height = Math.abs(this.selectionBox.endY - this.selectionBox.startY) / dpr;

    this.showSelectionBox(minX + rect.left, minY + rect.top, width, height);
  }

  endSelection(e: MouseEvent): void {
    if (!this.selectionBox.isSelecting || !this.trajectoryData) {
      this.selectionBox.isSelecting = false;
      this.hideSelectionBox();
      return;
    }

    const minX = Math.min(this.selectionBox.startX, this.selectionBox.endX);
    const maxX = Math.max(this.selectionBox.startX, this.selectionBox.endX);
    const minY = Math.min(this.selectionBox.startY, this.selectionBox.endY);
    const maxY = Math.max(this.selectionBox.startY, this.selectionBox.endY);

    const currentFrame = this.trajectoryData.frames[this.trajectoryState.currentFrameIndex];
    if (!currentFrame) {
      this.selectionBox.isSelecting = false;
      this.hideSelectionBox();
      return;
    }

    const selectedIndices: number[] = [];
    let totalSpeed = 0;

    for (let i = 0; i < this.trajectoryData.particleCount; i++) {
      const posIdx = i * 2;
      const velIdx = i * 2;
      const x = currentFrame.positions[posIdx];
      const y = currentFrame.positions[posIdx + 1];

      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        selectedIndices.push(i);
        const vx = currentFrame.velocities[velIdx];
        const vy = currentFrame.velocities[velIdx + 1];
        totalSpeed += Math.sqrt(vx * vx + vy * vy);
      }
    }

    this.trajectoryState.selectedParticleIndices = selectedIndices;

    this.updateSelectionUI(selectedIndices, totalSpeed);
    this.selectionBox.isSelecting = false;
    this.hideSelectionBox();
    this.render();
    this.notifyStateChange();
  }

  exportJSON(): void {
    if (!this.trajectoryData || this.trajectoryData.frames.length === 0) return;

    const exportData = {
      version: this.trajectoryData.version,
      particleCount: this.trajectoryData.particleCount,
      totalFrames: this.trajectoryData.totalFrames,
      frameInterval: this.trajectoryData.frameInterval,
      startTime: this.trajectoryData.startTime,
      endTime: this.trajectoryData.endTime,
      frames: this.trajectoryData.frames.map(frame => ({
        timestamp: frame.timestamp,
        frameIndex: frame.frameIndex,
        positions: Array.from(frame.positions),
        velocities: Array.from(frame.velocities)
      }))
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `trajectory-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  importJSON(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);

          if (!data.frames || data.frames.length === 0) {
            reject(new Error('无效的轨迹数据'));
            return;
          }

          this.trajectoryData = {
            version: data.version || 1,
            particleCount: data.particleCount,
            totalFrames: data.totalFrames || data.frames.length,
            frameInterval: data.frameInterval || 3,
            startTime: data.startTime || 0,
            endTime: data.endTime || 0,
            frames: data.frames.map((f: any) => ({
              timestamp: f.timestamp,
              frameIndex: f.frameIndex,
              positions: new Float32Array(f.positions),
              velocities: new Float32Array(f.velocities)
            }))
          };

          this.trajectoryState.currentFrameIndex = 0;
          this.trajectoryState.selectedParticleIndices = [];

          this.updateUI();
          this.notifyStateChange();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  private showSelectionBox(left: number, top: number, width: number, height: number): void {
    const box = document.getElementById('selectionBox');
    if (box) {
      box.style.display = 'block';
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    }
  }

  private hideSelectionBox(): void {
    const box = document.getElementById('selectionBox');
    if (box) {
      box.style.display = 'none';
    }
  }

  private updateUI(): void {
    this.updateRecordButton();
    this.updatePlayButton();
    this.updateRecordedFramesUI();
    this.updateTimelineUI();
    this.updateFrameDisplay();
    this.updateSpeedUI();
    this.updateRecordingIndicator();
    this.updateExitButton();
    this.updateSelectionUI([], 0);
  }

  private updateRecordButton(): void {
    const btn = document.getElementById('btnTrajRecord') as HTMLButtonElement;
    if (btn) {
      btn.textContent = this.trajectoryState.isRecording ? '⏹ 停止录制' : '⏺ 录制轨迹';
      btn.style.background = this.trajectoryState.isRecording
        ? 'rgba(220, 80, 80, 0.6)'
        : '';
    }
  }

  private updatePlayButton(): void {
    const btn = document.getElementById('btnTrajPlay') as HTMLButtonElement;
    if (btn) {
      const hasData = this.trajectoryData && this.trajectoryData.frames.length >= 2;
      btn.disabled = !hasData;
      btn.style.opacity = hasData ? '1' : '0.5';
      btn.textContent = this.trajectoryState.isPlaying ? '⏸ 暂停' : '▶ 播放轨迹';
    }
  }

  private updateRecordedFramesUI(): void {
    const el = document.getElementById('trajRecordedFrames');
    if (el) {
      const count = this.trajectoryData?.frames.length || 0;
      el.textContent = `${count} 帧`;
    }
  }

  private updateTimelineUI(): void {
    const timeline = document.getElementById('trajTimeline') as HTMLInputElement;
    if (timeline) {
      const hasData = this.trajectoryData && this.trajectoryData.frames.length > 0;
      timeline.disabled = !hasData;
      if (hasData) {
        timeline.max = (this.trajectoryData!.frames.length - 1).toString();
        timeline.value = this.trajectoryState.currentFrameIndex.toString();
      }
    }
    this.updateFrameDisplay();
  }

  private updateFrameDisplay(): void {
    const el = document.getElementById('trajFrameValue');
    if (el) {
      const total = this.trajectoryData?.frames.length || 0;
      const current = total > 0 ? this.trajectoryState.currentFrameIndex + 1 : 0;
      el.textContent = `${current}/${total}`;
    }
  }

  private updateSpeedUI(): void {
    const el = document.getElementById('trajSpeedValue');
    if (el) {
      el.textContent = `${this.trajectoryState.playbackSpeed.toFixed(2)}x`;
    }
  }

  private updateRecordingIndicator(): void {
    const indicator = document.getElementById('trajectoryIndicator');
    const frameCount = document.getElementById('trajFrameCount');
    if (indicator && frameCount) {
      if (this.trajectoryState.isRecording) {
        indicator.style.display = 'flex';
        frameCount.textContent = `${this.trajectoryData?.frames.length || 0} 帧`;
      } else {
        indicator.style.display = 'none';
      }
    }
  }

  private updateExitButton(): void {
    const btn = document.getElementById('btnTrajExit') as HTMLButtonElement;
    if (btn) {
      btn.style.display = this.trajectoryState.isPlaying ? 'block' : 'none';
    }
  }

  private updateSelectionUI(indices: number[], totalSpeed: number): void {
    const countEl = document.getElementById('trajSelectedCount');
    const speedEl = document.getElementById('trajAvgSpeed');

    if (countEl) {
      countEl.textContent = `${indices.length} 个`;
    }
    if (speedEl) {
      const avgSpeed = indices.length > 0 ? totalSpeed / indices.length : 0;
      speedEl.textContent = avgSpeed.toFixed(2);
    }
  }

  calculateSelectedParticleStats(): { count: number; avgSpeed: number } {
    if (!this.trajectoryData || this.trajectoryState.selectedParticleIndices.length === 0) {
      return { count: 0, avgSpeed: 0 };
    }

    const currentFrame = this.trajectoryData.frames[this.trajectoryState.currentFrameIndex];
    if (!currentFrame) {
      return { count: 0, avgSpeed: 0 };
    }

    let totalSpeed = 0;
    for (const idx of this.trajectoryState.selectedParticleIndices) {
      const velIdx = idx * 2;
      const vx = currentFrame.velocities[velIdx];
      const vy = currentFrame.velocities[velIdx + 1];
      totalSpeed += Math.sqrt(vx * vx + vy * vy);
    }

    return {
      count: this.trajectoryState.selectedParticleIndices.length,
      avgSpeed: totalSpeed / this.trajectoryState.selectedParticleIndices.length
    };
  }

  isRecording(): boolean {
    return this.trajectoryState.isRecording;
  }

  isPlaying(): boolean {
    return this.trajectoryState.isPlaying;
  }

  hasData(): boolean {
    return this.trajectoryData !== null && this.trajectoryData.frames.length > 0;
  }

  getTrajectoryData(): TrajectoryData | null {
    return this.trajectoryData;
  }

  getState(): TrajectoryState {
    return { ...this.trajectoryState };
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange();
    }
  }
}
