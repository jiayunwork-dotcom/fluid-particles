export const particleSpriteVS = `
  attribute vec2 a_position;
  attribute vec2 a_velocity;
  attribute float a_speed;
  attribute float a_colorValue;
  
  uniform vec2 u_resolution;
  uniform float u_particleSize;
  uniform float u_maxSpeed;
  uniform vec2 u_viewOffset;
  uniform float u_viewScale;
  
  varying float v_speed;
  varying vec2 v_velocity;
  varying float v_colorValue;
  
  void main() {
    vec2 pos = (a_position + u_viewOffset) * u_viewScale;
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y;
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    gl_PointSize = u_particleSize * u_viewScale;
    
    v_speed = a_speed;
    v_velocity = a_velocity;
    v_colorValue = a_colorValue;
  }
`;

export const particleSpriteFS = `
  precision mediump float;
  
  varying float v_speed;
  varying vec2 v_velocity;
  varying float v_colorValue;
  
  uniform float u_maxSpeed;
  uniform float u_alpha;
  uniform bool u_motionBlur;
  uniform sampler2D u_colormap;
  uniform bool u_useColormap;
  
  vec3 velocityToColor(float speed, float maxSpeed) {
    float t = clamp(speed / maxSpeed, 0.0, 1.0);
    if (t < 0.25) {
      float s = t / 0.25;
      return vec3(0.0, 0.4 * s, 0.8 + 0.2 * s);
    } else if (t < 0.5) {
      float s = (t - 0.25) / 0.25;
      return vec3(0.0, 0.4 + 0.6 * s, 1.0 - s);
    } else if (t < 0.75) {
      float s = (t - 0.5) / 0.25;
      return vec3(s, 1.0, 0.0);
    } else {
      float s = (t - 0.75) / 0.25;
      return vec3(1.0, 1.0 - s * 0.5, 0.0);
    }
  }
  
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if (dist > 0.5) discard;
    
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    
    vec3 color;
    if (u_useColormap) {
      float t = clamp(v_colorValue, 0.0, 1.0);
      color = texture2D(u_colormap, vec2(t, 0.5)).rgb;
    } else {
      color = velocityToColor(v_speed, u_maxSpeed);
    }
    
    float glow = exp(-dist * 4.0) * 0.5;
    color += glow * color;
    
    gl_FragColor = vec4(color, alpha * u_alpha);
  }
`;

export const depthVS = `
  attribute vec2 a_position;
  
  uniform vec2 u_resolution;
  uniform float u_particleRadius;
  uniform vec2 u_viewOffset;
  uniform float u_viewScale;
  
  varying float v_depth;
  
  void main() {
    vec2 pos = (a_position + u_viewOffset) * u_viewScale;
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y;
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    gl_PointSize = u_particleRadius * 2.0 * u_viewScale;
    
    v_depth = 1.0;
  }
`;

export const depthFS = `
  precision mediump float;
  
  varying float v_depth;
  
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if (dist > 0.5) discard;
    
    float depth = 1.0 - smoothstep(0.0, 0.5, dist);
    depth = pow(depth, 0.8);
    depth *= 0.9;
    gl_FragColor = vec4(depth, depth, depth, depth);
  }
`;

export const blurVS = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

export const blurFS = `
  precision mediump float;
  
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform vec2 u_direction;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec4 result = vec4(0.0);
    
    float weights[5];
    weights[0] = 0.227027;
    weights[1] = 0.1945946;
    weights[2] = 0.1216216;
    weights[3] = 0.054054;
    weights[4] = 0.016216;
    
    result += texture2D(u_texture, v_texCoord) * weights[0];
    
    for (int i = 1; i < 5; i++) {
      float fi = float(i);
      vec2 offset = u_direction * texelSize * fi;
      result += texture2D(u_texture, v_texCoord + offset) * weights[i];
      result += texture2D(u_texture, v_texCoord - offset) * weights[i];
    }
    
    gl_FragColor = result;
  }
`;

export const normalVS = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

export const normalFS = `
  precision mediump float;
  
  uniform sampler2D u_depthTexture;
  uniform vec2 u_resolution;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    
    float depth = texture2D(u_depthTexture, v_texCoord).r;
    float depthL = texture2D(u_depthTexture, v_texCoord - vec2(texelSize.x, 0.0)).r;
    float depthR = texture2D(u_depthTexture, v_texCoord + vec2(texelSize.x, 0.0)).r;
    float depthT = texture2D(u_depthTexture, v_texCoord - vec2(0.0, texelSize.y)).r;
    float depthB = texture2D(u_depthTexture, v_texCoord + vec2(0.0, texelSize.y)).r;
    
    float dx = (depthR - depthL) * 0.5;
    float dy = (depthB - depthT) * 0.5;
    
    vec3 normal = normalize(vec3(-dx * 2.0, -dy * 2.0, 1.0));
    
    gl_FragColor = vec4(normal * 0.5 + 0.5, depth);
  }
`;

export const fluidShadeVS = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

export const fluidShadeFS = `
  precision mediump float;
  
  uniform sampler2D u_normalTexture;
  uniform vec3 u_lightDir;
  uniform vec3 u_baseColor;
  uniform vec3 u_envColor;
  uniform float u_fresnelPower;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec4 normalData = texture2D(u_normalTexture, v_texCoord);
    vec3 normal = normalize(normalData.rgb * 2.0 - 1.0);
    float depth = normalData.a;
    
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 lightDir = normalize(u_lightDir);
    vec3 halfDir = normalize(lightDir + viewDir);
    
    float diffuse = max(dot(normal, lightDir), 0.0);
    
    float nv = max(dot(normal, viewDir), 0.0);
    float fresnel = pow(1.0 - nv, u_fresnelPower);
    
    float specular = pow(max(dot(normal, halfDir), 0.0), 32.0);
    
    vec3 ambient = u_baseColor * 0.6;
    vec3 diffuseColor = u_baseColor * diffuse * 1.0;
    vec3 fresnelColor = u_envColor * fresnel * 1.5;
    vec3 specularColor = vec3(1.0, 0.95, 0.85) * specular * 1.0;
    
    vec3 finalColor = ambient + diffuseColor + fresnelColor + specularColor;
    
    float visible = smoothstep(0.0, 0.015, depth);
    float alpha = clamp(visible + depth, 0.0, 1.0);
    
    if (alpha < 0.01) {
      discard;
    }
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const forceFieldVS = `
  attribute vec2 a_position;
  attribute vec2 a_direction;
  attribute float a_strength;
  
  uniform vec2 u_resolution;
  uniform vec2 u_viewOffset;
  uniform float u_viewScale;
  
  varying float v_strength;
  varying vec2 v_direction;
  
  void main() {
    vec2 pos = (a_position + u_viewOffset) * u_viewScale;
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y;
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    gl_PointSize = 8.0;
    
    v_strength = a_strength;
    v_direction = a_direction;
  }
`;

export const forceFieldFS = `
  precision mediump float;
  
  varying float v_strength;
  varying vec2 v_direction;
  
  uniform float u_alpha;
  uniform vec3 u_color;
  
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if (dist > 0.5) discard;
    
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    gl_FragColor = vec4(u_color, alpha * u_alpha);
  }
`;

export const lineVS = `
  attribute vec2 a_position;
  attribute vec4 a_color;
  
  uniform vec2 u_resolution;
  uniform vec2 u_viewOffset;
  uniform float u_viewScale;
  uniform float u_lineWidth;
  uniform float u_useVertexColor;
  
  varying vec4 v_color;
  
  void main() {
    vec2 pos = (a_position + u_viewOffset) * u_viewScale;
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y;
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    v_color = a_color;
  }
`;

export const lineFS = `
  precision mediump float;
  
  uniform vec4 u_color;
  uniform float u_useVertexColor;
  
  varying vec4 v_color;
  
  void main() {
    if (u_useVertexColor > 0.5) {
      gl_FragColor = v_color;
    } else {
      gl_FragColor = u_color;
    }
  }
`;

export const obstacleVS = `
  attribute vec2 a_position;
  
  uniform vec2 u_resolution;
  uniform vec2 u_viewOffset;
  uniform float u_viewScale;
  
  void main() {
    vec2 pos = (a_position + u_viewOffset) * u_viewScale;
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y;
    
    gl_Position = vec4(clipSpace, 0.0, 1.0);
  }
`;

export const obstacleFS = `
  precision mediump float;
  
  uniform vec4 u_color;
  
  void main() {
    gl_FragColor = u_color;
  }
`;

export const backgroundVS = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

export const backgroundFS = `
  precision mediump float;
  
  uniform vec2 u_resolution;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 pos = v_texCoord;
    
    float gradient = pos.y * 0.3 + 0.05;
    
    vec3 color1 = vec3(0.02, 0.02, 0.08);
    vec3 color2 = vec3(0.05, 0.05, 0.15);
    
    vec3 finalColor = mix(color1, color2, pos.y);
    
    float gridSize = 50.0;
    vec2 grid = fract(pos * u_resolution / gridSize);
    float gridLine = min(
      step(grid.x, 0.02) + step(1.0 - grid.x, 0.02),
      1.0
    ) + min(
      step(grid.y, 0.02) + step(1.0 - grid.y, 0.02),
      1.0
    );
    gridLine = min(gridLine, 1.0) * 0.1;
    
    finalColor += vec3(gridLine * 0.3, gridLine * 0.4, gridLine * 0.6);
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
