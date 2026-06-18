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

    const stream: number[] = [];
    
    this.writeString(stream, 'GIF89a');
    
    stream.push(this.width & 0xFF, (this.width >> 8) & 0xFF);
    stream.push(this.height & 0xFF, (this.height >> 8) & 0xFF);
    stream.push(0xF7);
    stream.push(0);
    stream.push(0);
    
    for (let i = 0; i < 256; i++) {
      stream.push((i * 85) & 0xFF, (i * 85) & 0xFF, (i * 85) & 0xFF);
    }
    
    this.writeNetscapeExt(stream);

    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i];
      this.writeGraphicCtrlExt(stream);
      this.writeImageDesc(stream);
      
      const indexedPixels = this.quantize(frame);
      this.writeLSD(stream, indexedPixels);
    }
    
    stream.push(0x3B);
    
    return new Blob([new Uint8Array(stream)], { type: 'image/gif' });
  }

  private writeString(stream: number[], str: string): void {
    for (let i = 0; i < str.length; i++) {
      stream.push(str.charCodeAt(i));
    }
  }

  private writeNetscapeExt(stream: number[]): void {
    stream.push(0x21);
    stream.push(0xFF);
    stream.push(0x0B);
    this.writeString(stream, 'NETSCAPE2.0');
    stream.push(0x03);
    stream.push(0x01);
    stream.push(0xFF);
    stream.push(0xFF);
    stream.push(0);
  }

  private writeGraphicCtrlExt(stream: number[]): void {
    stream.push(0x21);
    stream.push(0xF9);
    stream.push(0x04);
    stream.push(0x00);
    
    const delay = Math.max(2, Math.round(this.delay / 10));
    stream.push(delay & 0xFF);
    stream.push((delay >> 8) & 0xFF);
    
    stream.push(0x00);
    stream.push(0);
  }

  private writeImageDesc(stream: number[]): void {
    stream.push(0x2C);
    stream.push(0);
    stream.push(0);
    stream.push(0);
    stream.push(0);
    stream.push(this.width & 0xFF);
    stream.push((this.width >> 8) & 0xFF);
    stream.push(this.height & 0xFF);
    stream.push((this.height >> 8) & 0xFF);
    stream.push(0);
  }

  private quantize(imageData: ImageData): Uint8Array {
    const pixels = imageData.data;
    const pixelCount = this.width * this.height;
    const indexedPixels = new Uint8Array(pixelCount);
    const q = this.quality;
    
    for (let i = 0; i < pixelCount; i++) {
      const pi = i * 4;
      const r = Math.min(255, Math.max(0, Math.floor(pixels[pi] / q) * q));
      const g = Math.min(255, Math.max(0, Math.floor(pixels[pi + 1] / q) * q));
      const b = Math.min(255, Math.max(0, Math.floor(pixels[pi + 2] / q) * q));
      
      const index = Math.floor((r * 7 + g * 4 + b * 2) / 13);
      indexedPixels[i] = Math.min(255, Math.max(0, index));
    }
    
    return indexedPixels;
  }

  private writeLSD(stream: number[], indexedPixels: Uint8Array): void {
    const minCodeSize = 8;
    stream.push(minCodeSize);
    
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const codeSize = minCodeSize + 1;
    
    const size = indexedPixels.length;
    const output: number[] = [];
    let bitBuffer = 0;
    let bitCount = 0;
    
    const writeCode = (code: number) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        output.push(bitBuffer & 0xFF);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    };
    
    const table: { [key: string]: number } = {};
    let nextCode = eoiCode + 1;
    
    for (let i = 0; i < clearCode; i++) {
      table[String.fromCharCode(i)] = i;
    }
    
    writeCode(clearCode);
    
    let current = '';
    
    for (let i = 0; i < size; i++) {
      const pixel = indexedPixels[i];
      const combined = current + String.fromCharCode(pixel);
      
      if (table[combined] !== undefined) {
        current = combined;
      } else {
        writeCode(table[current]);
        
        if (nextCode < 4096) {
          table[combined] = nextCode++;
        } else {
          writeCode(clearCode);
          for (let j = 0; j < clearCode; j++) {
            table[String.fromCharCode(j)] = j;
          }
          for (const key of Object.keys(table)) {
            if (key.length > 1) delete table[key];
          }
          nextCode = eoiCode + 1;
        }
        
        current = String.fromCharCode(pixel);
      }
    }
    
    if (current !== '') {
      writeCode(table[current]);
    }
    
    writeCode(eoiCode);
    
    if (bitCount > 0) {
      output.push(bitBuffer & 0xFF);
    }
    
    for (let i = 0; i < output.length; i += 255) {
      const blockSize = Math.min(255, output.length - i);
      stream.push(blockSize);
      for (let j = 0; j < blockSize; j++) {
        stream.push(output[i + j]);
      }
    }
    stream.push(0);
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
