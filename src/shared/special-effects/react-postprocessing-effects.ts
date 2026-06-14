import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, WebGLRenderTarget, WebGLRenderer } from 'three';

const hueSaturationFragment = /* glsl */ `
  uniform float hue;
  uniform float saturation;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 color = inputColor;
    float angle = hue;
    float s = sin(angle);
    float c = cos(angle);
    vec3 weights = vec3(0.2126, 0.7152, 0.0722);
    mat3 hueRotation = mat3(
      weights.x + c * (1.0 - weights.x) + s * (-weights.x),
      weights.x + c * (-weights.x) + s * 0.143,
      weights.x + c * (-weights.x) + s * (-(1.0 - weights.x)),
      weights.y + c * (-weights.y) + s * (-weights.y),
      weights.y + c * (1.0 - weights.y) + s * 0.140,
      weights.y + c * (-weights.y) + s * weights.y,
      weights.z + c * (-weights.z) + s * (1.0 - weights.z),
      weights.z + c * (-weights.z) + s * (-0.283),
      weights.z + c * (1.0 - weights.z) + s * weights.z
    );
    color.rgb = hueRotation * color.rgb;
    float luma = dot(color.rgb, weights);
    color.rgb = mix(vec3(luma), color.rgb, 1.0 + saturation);
    outputColor = color;
  }
`;

const barrelBlurFragment = /* glsl */ `
  uniform float amount;
  uniform vec2 offset;
  uniform float samples;

  vec2 barrelDistort(vec2 uv, float distortion) {
    vec2 centered = uv - 0.5 - offset;
    float radius = dot(centered, centered);
    return uv + centered * radius * distortion;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < 10; i += 1) {
      if (float(i) >= samples) break;
      float t = samples <= 1.0 ? 0.0 : float(i) / max(samples - 1.0, 1.0);
      float distortion = mix(0.0, amount, t);
      vec2 distortedUv = clamp(barrelDistort(uv, distortion), 0.0, 1.0);
      float weight = 1.0 - t * 0.6;
      color += texture2D(inputBuffer, distortedUv) * weight;
      totalWeight += weight;
    }

    outputColor = color / max(totalWeight, 0.0001);
  }
`;

const scanlineFragment = /* glsl */ `
  uniform float time;
  uniform float density;
  uniform float opacity;
  uniform float scrollSpeed;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 color = texture2D(inputBuffer, uv);
    float wave = sin((uv.y + time * scrollSpeed) * density * 300.0) * 0.5 + 0.5;
    float lineMask = smoothstep(0.15, 0.85, wave);
    float shading = mix(0.45, 1.0, lineMask);
    color.rgb *= mix(1.0, shading, opacity);
    outputColor = vec4(color.rgb, inputColor.a);
  }
`;

const databendFragment = /* glsl */ `
  uniform float time;
  uniform float intensity;
  uniform float threshold;
  uniform float sliceCount;
  uniform float colorDrift;
  uniform float staticAmount;

  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void mainImage(const in vec4 inputColor, const in vec2 vUv, out vec4 outputColor) {
    vec2 uv = vUv;
    float bandY = uv.y * sliceCount;
    float slice = floor(bandY);
    float bandBlend = smoothstep(0.15, 0.85, fract(bandY));
    float timeCoarse = floor(time * 5.0);
    float timeFine = floor(time * 8.0);
    float coarseShift = rand(vec2(floor(uv.y * 18.0), timeCoarse)) - 0.5;
    float fineShift = rand(vec2(slice, timeFine)) - 0.5;
    float sliceShift = mix(coarseShift, fineShift, 0.35 + 0.25 * bandBlend) * 0.14 * intensity;
    uv.x = fract(uv.x + sliceShift);

    float bendNoise = rand(vec2(floor(uv.x * 24.0), slice + floor(time * 4.0))) - 0.5;
    uv.y += bendNoise * 0.022 * intensity;
    uv = clamp(uv, 0.001, 0.999);

    vec4 base = texture2D(inputBuffer, uv);
    float brightness = luma(base.rgb);
    float sortMask = smoothstep(threshold, 1.0, brightness);
    float smearNoise = rand(vec2(slice * 1.73, floor(time * 6.0)));
    float smear = sortMask * intensity * (0.012 + 0.022 * smearNoise);

    vec2 sortUv = clamp(vec2(fract(uv.x + smear), uv.y), 0.001, 0.999);
    vec4 sorted = texture2D(inputBuffer, sortUv);

    float blockNoise = rand(vec2(floor(uv.x * 14.0) + slice, floor(time * 7.0)));
    vec2 blockUv = uv;
    if (blockNoise > 0.915) {
      blockUv.x = fract(blockUv.x + (blockNoise - 0.5) * 0.14 * intensity);
      blockUv.y = clamp(blockUv.y + (rand(vec2(slice * 0.37, floor(time * 9.0))) - 0.5) * 0.032 * intensity, 0.001, 0.999);
    }
    vec4 blocky = texture2D(inputBuffer, blockUv);

    float channelJitter = (rand(vec2(slice + 4.0, floor(time * 6.0))) - 0.5) * colorDrift * intensity * 5.5;
    float red = texture2D(inputBuffer, clamp(uv + vec2(channelJitter, 0.0), 0.001, 0.999)).r;
    float green = sorted.g;
    float blue = texture2D(inputBuffer, clamp(uv - vec2(channelJitter * 1.5, 0.0), 0.001, 0.999)).b;

    vec3 databent = vec3(red, green, blue);
    databent = mix(databent, sorted.rgb, sortMask * 0.34);
    databent = mix(databent, blocky.rgb, 0.2 * intensity);

    float posterize = 9.0 + floor(intensity * 4.0);
    databent = floor(databent * posterize) / posterize;

    float scanFlicker = 1.0 - 0.035 * intensity * step(0.965, rand(vec2(slice, floor(time * 14.0))));
    databent *= scanFlicker;

    float staticNoise = rand(vec2(floor(vUv.x * 420.0) + floor(time * 48.0), floor(vUv.y * 320.0)));
    float staticFlicker = rand(vec2(floor(vUv.y * 180.0), floor(time * 36.0))) - 0.5;
    vec3 staticLayer = vec3(0.84 + staticNoise * 0.32 + staticFlicker * 0.18);
    vec3 tvMix = mix(base.rgb, databent, 0.74);
    tvMix = mix(tvMix, tvMix * staticLayer, staticAmount);

    outputColor = vec4(tvMix, inputColor.a);
  }
`;

const glitchBurstFragment = /* glsl */ `
  uniform float time;
  uniform float amount;
  uniform float seed;
  uniform float columns;

  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void mainImage(const in vec4 inputColor, const in vec2 vUv, out vec4 outputColor) {
    vec2 uv = vUv;
    float blockY = floor(uv.y * (10.0 + seed * 20.0)) / 10.0;
    float noise = rand(vec2(blockY, seed + time));
    float glitchLine = step(1.0 - amount * 0.3, noise);
    uv.x += glitchLine * (rand(vec2(blockY, time)) - 0.5) * amount * 0.15;

    float shift = amount * 0.015 * (rand(vec2(time, seed)) - 0.5);
    vec4 cr = texture2D(inputBuffer, clamp(vec2(uv.x + shift, uv.y), 0.0, 1.0));
    vec4 cg = texture2D(inputBuffer, uv);
    vec4 cb = texture2D(inputBuffer, clamp(vec2(uv.x - shift, uv.y), 0.0, 1.0));
    vec4 color = vec4(cr.r, cg.g, cb.b, cg.a);

    float columnMask = step(0.001, columns);
    float columnsNoise = columnMask * step(0.5, fract(floor(vUv.x / max(columns, 0.001)) * 0.5));
    color.rgb = mix(color.rgb, color.rgb * 0.92, columnsNoise * amount * 0.08);

    float flicker = rand(vec2(time * 100.0, uv.y * 50.0));
    color.rgb *= 1.0 - amount * 0.08 * step(0.97, flicker);
    outputColor = color;
  }
`;

const pixelMosaicFragment = /* glsl */ `
  uniform vec2 resolution;
  uniform float pixelSize;
  uniform float time;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float animatedSize = pixelSize + 0.5 * sin(time * 0.6);
    float ps = max(animatedSize, 2.0);

    vec2 pixelCount = resolution / ps;
    vec2 cell = floor(uv * pixelCount);
    vec2 cellCenter = (cell + 0.5) / pixelCount;

    vec4 color = texture2D(inputBuffer, cellCenter);

    vec2 cellUv = fract(uv * pixelCount);
    float gridX = smoothstep(0.0, 0.06, cellUv.x) * smoothstep(0.0, 0.06, 1.0 - cellUv.x);
    float gridY = smoothstep(0.0, 0.06, cellUv.y) * smoothstep(0.0, 0.06, 1.0 - cellUv.y);
    float grid = gridX * gridY;
    color.rgb *= mix(0.82, 1.0, grid);

    float levels = 24.0;
    color.rgb = floor(color.rgb * levels + 0.5) / levels;

    outputColor = color;
  }
`;

const thermalVisionFragment = /* glsl */ `
  uniform float time;
  uniform vec2 resolution;

  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 thermalRamp(float t) {
    vec3 c0 = vec3(0.0, 0.0, 0.12);
    vec3 c1 = vec3(0.08, 0.02, 0.58);
    vec3 c2 = vec3(0.52, 0.0, 0.72);
    vec3 c3 = vec3(0.90, 0.05, 0.15);
    vec3 c4 = vec3(1.0, 0.55, 0.0);
    vec3 c5 = vec3(1.0, 0.92, 0.2);
    vec3 c6 = vec3(1.0, 1.0, 1.0);

    if (t < 0.15) return mix(c0, c1, t / 0.15);
    if (t < 0.30) return mix(c1, c2, (t - 0.15) / 0.15);
    if (t < 0.50) return mix(c2, c3, (t - 0.30) / 0.20);
    if (t < 0.70) return mix(c3, c4, (t - 0.50) / 0.20);
    if (t < 0.88) return mix(c4, c5, (t - 0.70) / 0.18);
    return mix(c5, c6, (t - 0.88) / 0.12);
  }

  void mainImage(const in vec4 inputColor, const in vec2 vUv, out vec4 outputColor) {
    vec4 baseSrc = texture2D(inputBuffer, vUv);
    float baseLuma = dot(baseSrc.rgb, vec3(0.2126, 0.7152, 0.0722));
    float heat = clamp(baseLuma * 1.8, 0.0, 1.0);

    float shimmerIntensity = 0.0005 + (pow(heat, 2.0) * 0.006);
    vec2 shimmer = vec2(
      sin(vUv.y * 40.0 + time * 3.0) * shimmerIntensity,
      cos(vUv.x * 35.0 + time * 2.5) * (shimmerIntensity * 0.8)
    );

    vec2 uv = vUv + shimmer;
    vec4 src = texture2D(inputBuffer, uv);
    float distortedLuma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    float finalHeat = clamp(distortedLuma * 1.8, 0.0, 1.0);

    vec3 thermal = thermalRamp(finalHeat);
    float noise = (rand(vUv * resolution + time * 100.0) - 0.5) * 0.06;
    thermal += noise;

    outputColor = vec4(thermal, inputColor.a);
  }
`;

const screenXrayFragment = /* glsl */ `
  uniform float time;
  uniform vec2 resolution;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 texel = 1.0 / resolution;
    vec3 weights = vec3(0.2126, 0.7152, 0.0722);

    float center = dot(inputColor.rgb, weights);
    float north = dot(texture2D(inputBuffer, clamp(uv + vec2(0.0, texel.y), 0.0, 1.0)).rgb, weights);
    float south = dot(texture2D(inputBuffer, clamp(uv - vec2(0.0, texel.y), 0.0, 1.0)).rgb, weights);
    float east = dot(texture2D(inputBuffer, clamp(uv + vec2(texel.x, 0.0), 0.0, 1.0)).rgb, weights);
    float west = dot(texture2D(inputBuffer, clamp(uv - vec2(texel.x, 0.0), 0.0, 1.0)).rgb, weights);

    float edge = abs(center - north) + abs(center - south) + abs(center - east) + abs(center - west);
    float pulse = 0.78 + 0.22 * sin(time * 7.5);
    float scanline = 0.82 + 0.18 * sin((uv.y * resolution.y * 0.22) - (time * 14.0));

    vec3 base = mix(vec3(0.03, 0.07, 0.12), vec3(0.05, 0.42, 0.58), smoothstep(0.02, 0.55, center));
    vec3 highlight = vec3(0.72, 1.0, 1.0) * smoothstep(0.08, 0.55, center + edge * 0.8) * pulse;
    vec3 color = (base + highlight) * scanline;

    outputColor = vec4(color, inputColor.a);
  }
`;

export class SharedHueSaturationEffect extends Effect {
  private readonly hueUniform: Uniform<number>;
  private readonly saturationUniform: Uniform<number>;

  constructor({ hue = 0, saturation = 0 } = {}) {
    const hueUniform = new Uniform(hue);
    const saturationUniform = new Uniform(saturation);

    super('SharedHueSaturationEffect', hueSaturationFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['hue', hueUniform],
        ['saturation', saturationUniform],
      ]),
    });

    this.hueUniform = hueUniform;
    this.saturationUniform = saturationUniform;
  }

  setHue(value: number) {
    this.hueUniform.value = value;
  }

  setSaturation(value: number) {
    this.saturationUniform.value = value;
  }
}

export class SharedBarrelBlurEffect extends Effect {
  private readonly amountUniform: Uniform<number>;
  private readonly offsetUniform: Uniform<Vector2>;
  private readonly samplesUniform: Uniform<number>;

  constructor({ amount = 0.12, offset = new Vector2(0, 0), samples = 10 } = {}) {
    const amountUniform = new Uniform(amount);
    const offsetUniform = new Uniform(offset);
    const samplesUniform = new Uniform(samples);

    super('SharedBarrelBlurEffect', barrelBlurFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['amount', amountUniform],
        ['offset', offsetUniform],
        ['samples', samplesUniform],
      ]),
    });

    this.amountUniform = amountUniform;
    this.offsetUniform = offsetUniform;
    this.samplesUniform = samplesUniform;
  }

  setAmount(value: number) {
    this.amountUniform.value = value;
  }

  setOffset(value: Vector2) {
    this.offsetUniform.value.copy(value);
  }

  setSamples(value: number) {
    this.samplesUniform.value = value;
  }
}

export class SharedScanlineEffect extends Effect {
  private readonly densityUniform: Uniform<number>;
  private readonly opacityUniform: Uniform<number>;
  private readonly scrollSpeedUniform: Uniform<number>;
  private readonly timeUniform: Uniform<number>;

  constructor() {
    const densityUniform = new Uniform(4);
    const opacityUniform = new Uniform(1);
    const scrollSpeedUniform = new Uniform(0.08);
    const timeUniform = new Uniform(0);

    super('SharedScanlineEffect', scanlineFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['density', densityUniform],
        ['opacity', opacityUniform],
        ['scrollSpeed', scrollSpeedUniform],
        ['time', timeUniform],
      ]),
    });

    this.densityUniform = densityUniform;
    this.opacityUniform = opacityUniform;
    this.scrollSpeedUniform = scrollSpeedUniform;
    this.timeUniform = timeUniform;
  }

  setDensity(value: number) {
    this.densityUniform.value = value;
  }

  setOpacity(value: number) {
    this.opacityUniform.value = value;
  }

  setScrollSpeed(value: number) {
    this.scrollSpeedUniform.value = value;
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    this.timeUniform.value += deltaTime ?? 0;
  }
}

export class SharedDatabendEffect extends Effect {
  private readonly timeUniform: Uniform<number>;

  constructor() {
    const timeUniform = new Uniform(0);

    super('SharedDatabendEffect', databendFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['time', timeUniform],
        ['intensity', new Uniform(0.7)],
        ['threshold', new Uniform(0.5)],
        ['sliceCount', new Uniform(44)],
        ['colorDrift', new Uniform(0.006)],
        ['staticAmount', new Uniform(0.09)],
      ]),
    });

    this.timeUniform = timeUniform;
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    this.timeUniform.value += deltaTime ?? 0;
  }
}

export class SharedGlitchBurstEffect extends Effect {
  private readonly amountUniform: Uniform<number>;
  private readonly seedUniform: Uniform<number>;
  private readonly timeUniform: Uniform<number>;
  private active = false;
  private duration = 0.4;
  private elapsed = 0;
  private strength = 1;

  constructor() {
    const amountUniform = new Uniform(0);
    const seedUniform = new Uniform(0);
    const timeUniform = new Uniform(0);

    super('SharedGlitchBurstEffect', glitchBurstFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['amount', amountUniform],
        ['columns', new Uniform(0.05)],
        ['seed', seedUniform],
        ['time', timeUniform],
      ]),
    });

    this.amountUniform = amountUniform;
    this.seedUniform = seedUniform;
    this.timeUniform = timeUniform;
  }

  setDuration(value: number) {
    this.duration = Math.max(value, 0.01);
  }

  setStrength(value: number) {
    this.strength = value;
  }

  trigger() {
    this.active = true;
    this.elapsed = 0;
    this.seedUniform.value = Math.random() * 100;
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    const delta = deltaTime ?? 0;
    this.timeUniform.value += delta;

    if (!this.active) {
      this.amountUniform.value = 0;
      return;
    }

    this.elapsed += delta;
    const progress = this.elapsed / this.duration;

    if (progress >= 1) {
      this.active = false;
      this.amountUniform.value = 0;
      return;
    }

    const burst = progress < 0.3
      ? progress / 0.3
      : 1 - ((progress - 0.3) / 0.7);

    this.amountUniform.value = burst * this.strength;
  }
}

export class SharedPixelMosaicEffect extends Effect {
  private readonly resolutionUniform: Uniform<Vector2>;
  private readonly timeUniform: Uniform<number>;

  constructor() {
    const resolutionUniform = new Uniform(new Vector2(window.innerWidth, window.innerHeight));
    const timeUniform = new Uniform(0);

    super('SharedPixelMosaicEffect', pixelMosaicFragment, {
      // Force pixel mosaic into its own EffectPass so it runs after earlier
      // color adjustments like hue/saturation instead of being fused with them.
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['resolution', resolutionUniform],
        ['pixelSize', new Uniform(7.5)],
        ['time', timeUniform],
      ]),
    });

    this.resolutionUniform = resolutionUniform;
    this.timeUniform = timeUniform;
  }

  setSize(width: number, height: number) {
    this.resolutionUniform.value.set(width, height);
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    this.timeUniform.value += deltaTime ?? 0;
  }
}

export class SharedThermalVisionEffect extends Effect {
  private readonly resolutionUniform: Uniform<Vector2>;
  private readonly timeUniform: Uniform<number>;

  constructor() {
    const resolutionUniform = new Uniform(new Vector2(window.innerWidth, window.innerHeight));
    const timeUniform = new Uniform(0);

    super('SharedThermalVisionEffect', thermalVisionFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['resolution', resolutionUniform],
        ['time', timeUniform],
      ]),
    });

    this.resolutionUniform = resolutionUniform;
    this.timeUniform = timeUniform;
  }

  setSize(width: number, height: number) {
    this.resolutionUniform.value.set(width, height);
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    this.timeUniform.value += deltaTime ?? 0;
  }
}

export class SharedScreenXrayEffect extends Effect {
  private readonly resolutionUniform: Uniform<Vector2>;
  private readonly timeUniform: Uniform<number>;

  constructor() {
    const resolutionUniform = new Uniform(new Vector2(window.innerWidth, window.innerHeight));
    const timeUniform = new Uniform(0);

    super('SharedScreenXrayEffect', screenXrayFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<any>>([
        ['resolution', resolutionUniform],
        ['time', timeUniform],
      ]),
    });

    this.resolutionUniform = resolutionUniform;
    this.timeUniform = timeUniform;
  }

  setSize(width: number, height: number) {
    this.resolutionUniform.value.set(width, height);
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    this.timeUniform.value += deltaTime ?? 0;
  }
}
