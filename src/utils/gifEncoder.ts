export class GifEncoder {
  private width: number;
  private height: number;
  private frames: ImageData[] = [];
  private delay: number;
  private quality: number;

  constructor(width: number, height: number, options: { delay?: number; quality?: number } = {}) {
    this.width = width;
    this.height = height;
    this.delay = options.delay ?? 100;
    this.quality = options.quality ?? 10;
  }

  addFrame(imageData: ImageData): void {
    this.frames.push(imageData);
  }

  render(): Blob {
    if (this.frames.length === 0) {
      throw new Error('No frames to render');
    }

    const parts: Uint8Array[] = [];
    
    parts.push(this.writeHeader());
    parts.push(this.writeLogicalScreenDescriptor());
    parts.push(this.writeNetscapeExtension());

    for (let i = 0; i < this.frames.length; i++) {
      parts.push(this.writeGraphicControlExtension());
      parts.push(this.writeImageDescriptor());
      
      const { indices, palette } = this.quantize(this.frames[i]);
      parts.push(palette);
      parts.push(this.writeImageData(indices));
    }

    parts.push(new Uint8Array([0x3B]));

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }

    return new Blob([result], { type: 'image/gif' });
  }

  private writeHeader(): Uint8Array {
    const header = new Uint8Array(6);
    header.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    return header;
  }

  private writeLogicalScreenDescriptor(): Uint8Array {
    const lsd = new Uint8Array(7);
    lsd[0] = this.width & 0xFF;
    lsd[1] = (this.width >> 8) & 0xFF;
    lsd[2] = this.height & 0xFF;
    lsd[3] = (this.height >> 8) & 0xFF;
    lsd[4] = 0xF7;
    lsd[5] = 0;
    lsd[6] = 0;
    return lsd;
  }

  private writeNetscapeExtension(): Uint8Array {
    const ext = new Uint8Array(19);
    ext[0] = 0x21;
    ext[1] = 0xFF;
    ext[2] = 0x0B;
    ext.set([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30], 3);
    ext[14] = 0x03;
    ext[15] = 0x01;
    ext[16] = 0xFF;
    ext[17] = 0xFF;
    ext[18] = 0x00;
    return ext;
  }

  private writeGraphicControlExtension(): Uint8Array {
    const gce = new Uint8Array(8);
    gce[0] = 0x21;
    gce[1] = 0xF9;
    gce[2] = 0x04;
    gce[3] = 0x00;
    const delayCs = Math.round(this.delay / 10);
    gce[4] = delayCs & 0xFF;
    gce[5] = (delayCs >> 8) & 0xFF;
    gce[6] = 0x00;
    gce[7] = 0x00;
    return gce;
  }

  private writeImageDescriptor(): Uint8Array {
    const id = new Uint8Array(10);
    id[0] = 0x2C;
    id[1] = 0;
    id[2] = 0;
    id[3] = 0;
    id[4] = 0;
    id[5] = this.width & 0xFF;
    id[6] = (this.width >> 8) & 0xFF;
    id[7] = this.height & 0xFF;
    id[8] = (this.height >> 8) & 0xFF;
    id[9] = 0x87;
    return id;
  }

  private quantize(imageData: ImageData): { indices: Uint8Array; palette: Uint8Array } {
    const pixels = imageData.data;
    const pixelCount = this.width * this.height;
    
    const colorMap = new Map<number, number>();
    const palette: number[] = [];
    const indices = new Uint8Array(pixelCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const pi = i * 4;
      let r = pixels[pi];
      let g = pixels[pi + 1];
      let b = pixels[pi + 2];
      
      const q = this.quality;
      r = Math.floor(r / q) * q;
      g = Math.floor(g / q) * q;
      b = Math.floor(b / q) * q;
      
      const colorKey = (r << 16) | (g << 8) | b;
      
      let colorIndex = colorMap.get(colorKey);
      if (colorIndex === undefined) {
        if (palette.length >= 256 * 3) {
          colorIndex = this.findClosestColor(r, g, b, palette);
        } else {
          colorIndex = palette.length / 3;
          palette.push(r, g, b);
        }
        colorMap.set(colorKey, colorIndex);
      }
      
      indices[i] = colorIndex;
    }
    
    const paletteArray = new Uint8Array(256 * 3);
    paletteArray.set(palette);
    
    return { indices, palette: paletteArray };
  }

  private findClosestColor(r: number, g: number, b: number, palette: number[]): number {
    let minDist = Infinity;
    let closest = 0;
    
    for (let i = 0; i < palette.length; i += 3) {
      const dr = r - palette[i];
      const dg = g - palette[i + 1];
      const db = b - palette[i + 2];
      const dist = dr * dr + dg * dg + db * db;
      
      if (dist < minDist) {
        minDist = dist;
        closest = i / 3;
      }
    }
    
    return closest;
  }

  private writeImageData(indices: Uint8Array): Uint8Array {
    const minCodeSize = 8;
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    
    const output: number[] = [];
    let bitBuffer = 0;
    let bitCount = 0;
    
    const codeTable: Map<string, number> = new Map();
    let nextCode = eoiCode + 1;
    let codeSize = minCodeSize + 1;
    
    const writeCode = (code: number) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      
      while (bitCount >= 8) {
        output.push(bitBuffer & 0xFF);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    };
    
    writeCode(clearCode);
    
    let current = String.fromCharCode(indices[0]);
    codeTable.set(current, nextCode++);
    
    for (let i = 1; i < indices.length; i++) {
      const pixel = indices[i];
      const combined = current + String.fromCharCode(pixel);
      
      if (codeTable.has(combined)) {
        current = combined;
      } else {
        writeCode(codeTable.get(current)!);
        
        if (nextCode < 4096) {
          codeTable.set(combined, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) {
            codeSize++;
          }
        } else {
          writeCode(clearCode);
          codeTable.clear();
          nextCode = eoiCode + 1;
          codeSize = minCodeSize + 1;
          for (let j = 0; j < clearCode; j++) {
            codeTable.set(String.fromCharCode(j), j);
          }
        }
        
        current = String.fromCharCode(pixel);
      }
    }
    
    writeCode(codeTable.get(current)!);
    writeCode(eoiCode);
    
    if (bitCount > 0) {
      output.push(bitBuffer & 0xFF);
    }
    
    const blocks: number[] = [minCodeSize];
    for (let i = 0; i < output.length; i += 255) {
      const blockSize = Math.min(255, output.length - i);
      blocks.push(blockSize);
      for (let j = 0; j < blockSize; j++) {
        blocks.push(output[i + j]);
      }
    }
    blocks.push(0);
    
    return new Uint8Array(blocks);
  }
}

export function encodeGif(
  frames: ImageData[],
  options: { delay?: number; quality?: number } = {}
): Blob {
  if (frames.length === 0) {
    throw new Error('No frames provided');
  }
  
  const encoder = new GifEncoder(frames[0].width, frames[0].height, options);
  
  for (const frame of frames) {
    encoder.addFrame(frame);
  }
  
  return encoder.render();
}
