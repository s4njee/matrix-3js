import { Uniform, WebGLRenderTarget, WebGLRenderer } from 'three'
import { BlendFunction, Effect } from 'postprocessing'

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform float amount;
  uniform float seed;
  uniform float columns;

  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void mainUv(inout vec2 uv) {
    float blockY = floor(uv.y * (10.0 + seed * 20.0)) / 10.0;
    float blockX = floor(uv.x / columns) * columns;
    float noise = rand(vec2(blockY + blockX, seed + time));
    float glitchLine = step(1.0 - amount * 0.3, noise);
    uv.x += glitchLine * (rand(vec2(blockY, time + blockX)) - 0.5) * amount * 0.15;
    uv = clamp(uv, 0.001, 0.999);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float shift = amount * 0.015 * (rand(vec2(time, seed)) - 0.5);
    vec4 cr = texture2D(inputBuffer, clamp(vec2(uv.x + shift, uv.y), 0.001, 0.999));
    vec4 cb = texture2D(inputBuffer, clamp(vec2(uv.x - shift, uv.y), 0.001, 0.999));
    vec4 color = vec4(cr.r, inputColor.g, cb.b, inputColor.a);

    float flicker = rand(vec2(time * 100.0, uv.y * 50.0));
    color.rgb *= 1.0 - amount * 0.08 * step(0.97, flicker);
    outputColor = color;
  }
`

interface MonolithPixelGlitchOptions {
  columns?: number
  duration?: number
  strength?: number
}

export class MonolithPixelGlitchEffect extends Effect {
  private readonly amountUniform: Uniform<number>
  private readonly seedUniform: Uniform<number>
  private readonly timeUniform: Uniform<number>
  private active = false
  private elapsed = 0
  private duration: number
  private strength: number

  constructor({
    columns = 0.05,
    duration = 0.4,
    strength = 1,
  }: MonolithPixelGlitchOptions = {}) {
    const timeUniform = new Uniform(0)
    const amountUniform = new Uniform(0)
    const seedUniform = new Uniform(0)

    super('MonolithPixelGlitchEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['time', timeUniform],
        ['amount', amountUniform],
        ['seed', seedUniform],
        ['columns', new Uniform(columns)],
      ]),
    })

    this.timeUniform = timeUniform
    this.amountUniform = amountUniform
    this.seedUniform = seedUniform
    this.duration = duration
    this.strength = strength
  }

  trigger() {
    this.active = true
    this.elapsed = 0
    this.seedUniform.value = Math.random() * 100
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    const delta = deltaTime ?? 0
    this.timeUniform.value += delta

    if (!this.active) {
      this.amountUniform.value = 0
      return
    }

    this.elapsed += delta
    const progress = this.elapsed / this.duration

    if (progress >= 1) {
      this.active = false
      this.amountUniform.value = 0
      return
    }

    const intensity = progress < 0.3
      ? progress / 0.3
      : 1 - (progress - 0.3) / 0.7

    this.amountUniform.value = intensity * this.strength
  }
}
