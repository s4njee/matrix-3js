export const VS = /* glsl */ `
  attribute float aColumnIndex;

  varying vec2 vUv;
  varying float vColumn;

  void main() {
    vUv = uv;
    vColumn = aColumnIndex;
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const FS = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform sampler2D uColumnState;
  uniform vec2 uAtlasSize;
  uniform float uCharCount;
  uniform float uGridCols;
  uniform float uGridRows;
  uniform float uTime;
  uniform vec3 uHeadColor;
  uniform vec3 uTrailColor;
  uniform vec3 uDimTrailColor;
  uniform vec3 uFogColor;
  uniform float uWobbleAmp;
  uniform float uWobbleFreq;

  varying vec2 vUv;
  varying float vColumn;

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec4 getColumnState(float col, float streamIndex) {
    float streamCount = 2.0;
    return texture2D(
      uColumnState,
      vec2((col + 0.5) / uGridCols, (streamIndex + 0.5) / streamCount)
    );
  }

  vec4 getRainSample(float col, float row, vec2 cellUv, vec4 columnState, float streamIndex) {
    float head = columnState.r;
    float trailLen = columnState.g;
    float phase = columnState.b;

    float wobble = sin(uTime * uWobbleFreq + phase) * uWobbleAmp;
    vec2 glyphUv = vec2(cellUv.x, 1.0 - cellUv.y);
    glyphUv = (glyphUv - 0.5) * vec2(0.86, 0.48) + 0.5;
    glyphUv.x -= wobble;
    if (glyphUv.x < 0.0 || glyphUv.x > 1.0) return vec4(0.0);

    float age = head - row;
    if (age < 0.0 || age > trailLen) return vec4(0.0);

    float scrambleSlot = floor(uTime * 6.0);
    float scrambleKey = hash21(vec2(col, row) + vec2(scrambleSlot * 17.0, streamIndex * 31.0));
    float baseKey = hash21(vec2(col + streamIndex * 13.0, row + floor(head)));
    float glyphKey = mix(baseKey, scrambleKey, step(0.75, scrambleKey));
    float glyphIdx = floor(glyphKey * uCharCount);
    float atlasCol = mod(glyphIdx, uAtlasSize.x);
    float atlasRow = floor(glyphIdx / uAtlasSize.x);
    vec2 atlasUv = vec2(
      (atlasCol + glyphUv.x) / uAtlasSize.x,
      1.0 - (atlasRow + 1.0) / uAtlasSize.y + glyphUv.y / uAtlasSize.y
    );

    float alpha = smoothstep(0.16, 0.48, texture2D(uAtlas, atlasUv).r);
    if (alpha <= 0.001) return vec4(0.0);

    float fade = 1.0 - age / trailLen;
    float fadeCurve = pow(max(fade, 0.0), 1.8);
    float brightness = fadeCurve * 0.975 + 0.025;
    vec3 trail = mix(uDimTrailColor, uTrailColor, fadeCurve);
    vec3 color = mix(uFogColor, trail, brightness);
    color = mix(color, uHeadColor, step(age, 0.5));

    return vec4(color * alpha, brightness);
  }

  void main() {
    float col = vColumn;
    float rowCoord = (1.0 - vUv.y) * uGridRows;
    float row = floor(rowCoord);

    if (col < 0.0 || col >= uGridCols || row < 0.0 || row >= uGridRows) {
      discard;
    }

    vec2 cellUv = vec2(vUv.x, fract(rowCoord));

    vec4 baseSample = getRainSample(col, row, cellUv, getColumnState(col, 0.0), 0.0);
    vec4 boostSample = getRainSample(col, row, cellUv, getColumnState(col, 1.0), 1.0);
    vec4 sampleColor = boostSample.a > baseSample.a ? boostSample : baseSample;

    if (sampleColor.a <= 0.0) {
      discard;
    }

    gl_FragColor = vec4(sampleColor.rgb, 1.0);
  }
`
