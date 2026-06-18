export function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  
  return shader;
}

export function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
  transformFeedbackVaryings?: string[]
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create program');
  }
  
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  
  if (transformFeedbackVaryings && gl instanceof WebGL2RenderingContext) {
    gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.INTERLEAVED_ATTRIBS);
  }
  
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  
  return program;
}

export function createProgramFromSources(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string,
  transformFeedbackVaryings?: string[]
): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  return createProgram(gl, vs, fs, transformFeedbackVaryings);
}

export function createBuffer(gl: WebGLRenderingContext, data: ArrayBufferView | ArrayBuffer | null, usage: number = gl.STATIC_DRAW): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('Failed to create buffer');
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data as BufferSource, usage);
  return buffer;
}

export function createIndexBuffer(gl: WebGLRenderingContext, data: BufferSource | null, usage: number = gl.STATIC_DRAW): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('Failed to create index buffer');
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage);
  return buffer;
}

export interface TextureOptions {
  width: number;
  height: number;
  internalFormat?: number;
  format?: number;
  type?: number;
  data?: ArrayBufferView | null;
  minFilter?: number;
  magFilter?: number;
  wrapS?: number;
  wrapT?: number;
}

export function createTexture(gl: WebGLRenderingContext, options: TextureOptions): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Failed to create texture');
  }
  
  const {
    width,
    height,
    internalFormat = gl.RGBA,
    format = gl.RGBA,
    type = gl.UNSIGNED_BYTE,
    data = null,
    minFilter = gl.LINEAR,
    magFilter = gl.LINEAR,
    wrapS = gl.CLAMP_TO_EDGE,
    wrapT = gl.CLAMP_TO_EDGE
  } = options;
  
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  
  return texture;
}

export function createFramebuffer(gl: WebGLRenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    throw new Error('Failed to create framebuffer');
  }
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: ${status}`);
  }
  
  return fbo;
}

export function getWebGLContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl = canvas.getContext('webgl', {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true
  });
  
  if (!gl) {
    throw new Error('WebGL is not supported');
  }
  
  return gl;
}

export function resizeCanvas(canvas: HTMLCanvasElement, gl: WebGLRenderingContext): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  
  gl.viewport(0, 0, canvas.width, canvas.height);
}
