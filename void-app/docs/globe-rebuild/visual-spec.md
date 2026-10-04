# Void Globe — exact visual spec for a raw-WebGL1 rebuild (no three.js)

Target look: three r128, `physicallyCorrectLights = false`, `LinearEncoding` output, **no color management, no tone mapping, no fog**. Every hex color below is used as `component/255` directly in the shader — never apply an sRGB→linear conversion to colors or textures, and write straight to the default framebuffer. (The current code runs on modern three but forces this exact look: `ColorManagement.enabled = false`, `outputColorSpace = LinearSRGBColorSpace`, every light intensity × π to cancel the shader's 1/π, and the point light's r128 range attenuation baked in as ×0.933.)

Sources: `C:/the void/void-main/void-app/src/features/globe/globeScene.ts`, `C:/the void/void-main/void-app/src/features/globe/textures.ts`.

---

## 1. GL context and raster

- Context: `antialias: false` (deliberate for mobile; MSAA was removed — see b50feb6 comment), `powerPreference: 'high-performance'`, `precision: highp` **everywhere** (mediump visibly bands the terminator on the lit sphere).
- Clear color: **`0x04020c`, alpha 1** → `glClearColor(4/255, 2/255, 12/255, 1)`. Clear color+depth each frame.
- `pixelRatio = 1`; all sizes are in drawing-buffer pixels.
- **RASTER_CAP = 1.6**:
  ```
  density     = max(1, drawingBufferW / max(1, viewW))        // device px per layout pt
  rasterScale = density > 1.6 ? 1.6 / density : 1
  renderW     = round(drawingBufferW * rasterScale)
  renderH     = round(drawingBufferH * rasterScale)
  ```
  Render at `renderW × renderH` (viewport), let the surface scale it up to full buffer size. Same formula re-applied on every resize (or a rotation hands the raster back to full density).

## 2. Camera

- Perspective: **fov 46°** (vertical), aspect `viewW / max(1, viewH)`, **near 0.1, far 1000**.
- Position `(0, 0, globeZoom)`, no rotation, looking down −Z. World space ≡ view space translated by `(0,0,−globeZoom)`.
- `globeZoom` starts at **2.9** and eases toward `input.tZoom` (initial 2.9). Zoom clamping is done by the gesture code *outside* these files — the scene itself only eases to whatever `tZoom` it is handed.

## 3. Scene contents, draw order, depth

Opaque pass first (stars, globe), then transparent (atmosphere, markers), honoring renderOrder:

| order | object | blend | depthTest | depthWrite |
|---|---|---|---|---|
| 0 | star field ×2 | opaque | on | on |
| 1 | earth sphere | opaque | on | on |
| 2 | atmosphere shell | normal alpha (src_alpha, 1−src_alpha) | on | on (three default; the planet-occlusion is done analytically in the shader, NOT via depth — see §6) |
| 3 | country markers | normal alpha | **off** | **off** |

Marker Points are a **child of the globe mesh** (they rotate with it); stars and atmosphere are scene-level (static). Markers have frustum culling disabled.

## 4. Star fields

Two point clouds, identical construction, parameters `[count, size, color]`:

1. `[3000, 0.04, 0x0d0835]`
2. `[400, 0.07, 0x1e1270]`

Position generation (exact code — note it fills **every float**, x, y and z alike):
```js
const p = new Float32Array(n * 3);
for (let i = 0; i < p.length; i++) p[i] = (Math.random() - 0.5) * 200;   // uniform in [-100, 100] per component
```
Material = three `PointsMaterial`, i.e. **unlit, untextured square points**, constant color, opacity 1, size attenuation ON:
```
gl_PointSize = size * (renderH * 0.5) / -mvPosition.z;      // renderH = the raster-capped render height
fragColor    = vec4(color, 1.0);
```
(`renderH * 0.5` is three's `scale` uniform.) Most stars come out sub-pixel and get clamped up to the GL minimum point size (~1px) — that's part of the look. Stars behind/inside the planet are hidden by the globe's opaque draw + depth. Colors: `0x0d0835 = (13,8,53)/255`, `0x1e1270 = (30,18,112)/255`.

## 5. Earth sphere

### Geometry
- Unit sphere radius **1**, **72 × 72 segments** (48 leaves a faceted limb; 80 is wasted cost). three r128 `SphereGeometry(1, 72, 72)` construction, needed for matching UVs:
  ```
  for iy in 0..72:  v = iy/72
    for ix in 0..72:  u = ix/72
      theta = v * PI;  phi = u * 2PI
      x = -cos(phi) * sin(theta)
      y =  cos(theta)
      z =  sin(phi) * sin(theta)
      normal = (x,y,z);  uv = (u + uOffset, 1 - v)
  ```
  where `uOffset = +1/(2*72)` on the top pole row (iy==0) and `−1/(2*72)` on the bottom pole row only. Smooth vertex normals = position (unit sphere).
- The texture is uploaded with rows **pre-flipped** (`flipY = false` + author-time row flip), i.e. the net result equals a standard equirectangular earth texture sampled with three's default `flipY = true` convention. In a raw rebuild: standard equirectangular sampling with v=0 at the south pole of the image after your chosen flip — match a reference screenshot once.

### Texture
- Real map: bundled **2048×1024 RGBA** night-lights map (`assets/globe/earth-night.jpg` → pre-decoded `earth-night.rgba.bin`). Sampling: LINEAR mag, LINEAR_MIPMAP_LINEAR min, mipmaps on, CLAMP_TO_EDGE both axes, **max anisotropy the GPU reports** (this is most of the perceived sharpness at the limb). **No sRGB tagging** — bytes used as-is (tagging sRGB crushes the night map ~2.5× darker; measured).
- Fallback (only before the map decodes, on a cold first launch): procedural **512×256** texture — vertical gradient `#0a0733 → #140b3a → #0a0733` mirrored at y=0.5 (`k = t<=0.5 ? t/0.5 : (1-t)/0.5`, lerp c0→c1 by k), then **900** alpha-blended rects: per rect `a = 0.03 + rand()*0.07`, `w = 6 + rand()*40`, origin `(rand()*512, rand()*256)`, size `w × w*0.5` (clamped to bounds), blended toward RGB **(90, 60, 190)**: `px = px*(1-a) + C*a`. Alpha 255. Same sampler settings.

### Material — MeshPhongMaterial, exact parameters
```
map:               nightTex          // diffuse
emissiveMap:       nightTex          // SAME texture
emissive:          0xffffff
emissiveIntensity: 0.85
specular:          0x3a1e90          // (58,30,144)/255
shininess:         18
color:             0xffffff (default) → diffuseColor = texel.rgb
specularStrength:  1 (no specularMap)
opacity:           1, opaque
```
The emissiveMap is load-bearing: a night map as diffuse-only is black (nothing lights it); the same texture driving emission is what makes cities/coastlines self-luminous, with the three lights adding shape on top.

## 6. Lights and the EXACT fragment equation

Scene lights (r128 semantics — effective values after the π/0.933 compensation already baked into the modern branch):

| light | color | intensity | position | notes |
|---|---|---|---|---|
| Ambient | `0x0a0620` = (10,6,32)/255 | **3** | — | |
| Directional "sun" | `0xd4a84c` = (212,168,76)/255 | **1.8** | from `(5,2,4)` toward origin → `L = (5,2,4)/√45 = (0.745356, 0.298142, 0.596285)` | world-fixed; does NOT rotate with globe |
| Point "rim" | `0x5b21d4` = (91,33,212)/255 | **2** | `(-4,-2,-5)` | distance 100, decay 1 → attenuation `max(0, 1 − d/100)`; at the globe surface d≈6.7 ⇒ **≈0.933** |

Lighting is computed in **view space**; with the camera unrotated, transform light positions/directions by translating z by −globeZoom (directional L is unaffected). Normals: `N = normalize(normalMatrix * objectNormal)`; `V = normalize(−viewPosition)`.

r128 non-physically-correct Blinn-Phong, fully expanded (the shader's internal π and 1/π cancel):

```glsl
vec3 texel   = texture2D(map, vUv).rgb;          // raw bytes, linear, NO decode
vec3 diffuse = texel;                            // material.color is white
vec3 emissive = 0.85 * texel;                    // emissive 0xffffff * intensity * emissiveMap

// ambient
vec3 indirect = vec3(10.0,6.0,32.0)/255.0 * 3.0; // ambientColor * intensity

vec3 outDiffuse  = vec3(0.0);
vec3 outSpecular = vec3(0.0);

// per light (sun: L fixed, atten = 1;  rim: L = normalize(lightPosView - fragPosView),
//            atten = saturate(1.0 - distance(lightPosView, fragPosView) / 100.0)):
vec3 lightCol = color * intensity * atten;       // sun: (212,168,76)/255*1.8   rim: (91,33,212)/255*2*atten
float dotNL   = saturate(dot(N, L));
outDiffuse   += dotNL * lightCol * diffuse;

// specular: F_Schlick * G_implicit(0.25) * D_BlinnPhong, times the legacy π:
vec3  H     = normalize(L + V);
float dotNH = saturate(dot(N, H));
float dotVH = saturate(dot(V, H));
vec3  F     = specular + (1.0 - specular) * exp2((-5.55473 * dotVH - 6.98316) * dotVH); // Schlick approx
float GD    = 0.25 * (shininess * 0.5 + 1.0) * pow(dotNH, shininess);  // shininess=18 → 2.5 * pow(dotNH,18)
outSpecular += dotNL * lightCol * F * GD;        // specularStrength = 1

gl_FragColor = vec4(emissive + indirect * diffuse + outDiffuse + outSpecular, 1.0);
```
For the globe: `specular = vec3(58,30,144)/255`, `shininess = 18.0`. No tone mapping, no encoding conversion on output.

## 7. Atmosphere shell

- Sphere radius **1.06**, **32 × 32** segments, at the origin (scene-level; static — a uniform sphere, rotation irrelevant).
- `THREE.BackSide`: render with **front-face culling** (you see the inside of the shell), but the normals stay the geometric **outward** normals (three does NOT flip them for BackSide — this is what produces the rim-glow falloff).
- Same Phong equation as §6 with:
  ```
  color (diffuse):   0x3b1e8a = (59,30,138)/255
  emissive:          0x1a0840 = (26,8,64)/255, emissiveIntensity 1, no maps
  specular:          0x111111 (three default), shininess 30 (default)
  opacity:           0.12, transparent, normal alpha blending
  ```
  `gl_FragColor = vec4(emissive + indirect*diffuse + outDiffuse + outSpecular, 0.12)`.
- **Analytic planet occlusion** (replaces the depth test; required — the Helio P35 test phone has no working depth, and the far half of a BackSide shell sits behind the planet). Injected at the top of main(), in view space:
  ```glsl
  uniform vec3 uCtr;                       // globe center in view space = (0, 0, -globeZoom), updated every frame
  vec3  d = normalize(-vViewPosition);     // fragment -> camera... (three's vViewPosition = -viewPos, so d is the view ray direction)
  float b = dot(d, uCtr);
  float c = dot(uCtr, uCtr) - 1.0;         // unit planet radius
  if (b*b - c > 0.0) discard;              // ray from camera through this fragment hits the planet → drop it
  ```
  Exact replacement text in the code: `{ vec3 d = normalize(-vViewPosition); float b = dot(d, uCtr); float c = dot(uCtr, uCtr) - 1.0; if (b * b - c > 0.0) discard; }`

## 8. Country markers

### Placement
Lat/lon → unit sphere (exact):
```js
const phi = (90 - lat) * PI/180, th = (lon + 180) * PI/180;
v = ( -r*sin(phi)*cos(th),  r*cos(phi),  r*sin(phi)*sin(th) );   // r = 1.02
```
One position per country (~199–205), one GL_POINTS draw call, **child of the globe** (uses the globe's rotation in its modelView). Attributes: `position` (vec3), `aIdx` (float = index i), `aHot` (float 0/1, hovered flag).

### Shaders (verbatim)
Vertex:
```glsl
attribute float aIdx; attribute float aHot; uniform float uPt; uniform float uProj;
varying float vHot; varying float vVis;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * position);
  vVis = smoothstep(0.0, 0.15, dot(n, normalize(-mv.xyz)));   // far-hemisphere fade (no depth reliance)
  vHot = aHot;
  float s = aHot > 0.5 ? 0.08 : 0.05 + 0.01 * sin(uPt + aIdx * 0.3);   // world-size pulse
  gl_PointSize = s * uProj / -mv.z;
  gl_Position = projectionMatrix * mv;
}
```
Fragment:
```glsl
uniform sampler2D uMap; uniform sampler2D uMapHot; varying float vHot; varying float vVis;
void main(){
  if (vVis < 0.01) discard;
  vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
  vec4 t = vHot > 0.5 ? texture2D(uMapHot, uv) : texture2D(uMap, uv);
  gl_FragColor = vec4(t.rgb, t.a * (vHot > 0.5 ? 1.0 : 0.85) * vVis);
}
```
State: `transparent` (normal alpha blend), `depthWrite: false`, `depthTest: false`, renderOrder 3 (last).

Uniforms per frame: `uPt = pt` (see §9); `uProj = drawingBufferHeight / (2 * tan(fov * PI / 360))` — note this intentionally uses the **full** buffer height, not the raster-capped render height (a Sprite of world size s projects to `s * uProj / depth` px; on web the two heights are equal).

### Marker sprite texture (markerTexture) — exact
**128×128** radial gradient centered at (64,64), radius 64, rasterised exactly like a canvas 2D radial gradient: **interpolate stops in premultiplied-alpha space, then un-premultiply** (divide RGB by A; 0 where A=0). Per pixel: `d = hypot(x+0.5-64, y+0.5-64) / 64`, find bracketing stops, lerp premultiplied. Stops as `[offset, r, g, b, alpha]`:

Normal (`hot=false`):
```
[0,    200, 165,  76, 1   ]
[0.12, 160, 128,  52, 0.9 ]
[0.3,   90,  65,  20, 0.35]
[0.6,    0,   0,   0, 0.05]
[1,      0,   0,   0, 0   ]
```
Hovered (`hot=true`):
```
[0,    255, 235, 100, 1   ]
[0.12, 220, 170,  50, 1   ]
[0.3,  140, 100,  20, 0.5 ]
[0.6,    0,   0,   0, 0.05]
[1,      0,   0,   0, 0   ]
```
`d <= stops[0].offset` → first stop; `d` beyond last → last stop. Store `round(r), round(g), round(b), round(a*255)`. Sampler: LINEAR mag, LINEAR_MIPMAP_LINEAR min, mipmaps on (CanvasTexture defaults), **not** premultiplied on upload (the un-premultiply above mimics getImageData), no flip.

### Hover state
`setHover(i)`: zero the whole `aHot` array, set `aHot[i]=1` (one hot marker max). Hot marker: size 0.08 (no pulse), alpha factor 1.0 (vs 0.85), hot texture.

### Picking (hit/hover), screen space
For each marker: world pos = `markerPos[i]` × globe matrixWorld; reject far side if `dot(normalize(worldPos), normalize(camPos - worldPos)) < 0.05`; project to NDC, map to view px `sx = (ndc.x+1)/2*viewW`, `sy = (1-ndc.y)/2*viewH`; nearest within **16 pt** (compare squared distance to 256) wins; none → −1.

## 9. frame(ts) — animation, inertia, governor

Persistent state: `cRotX, cRotY` (current rotation, start 0), `globeZoom` (start 2.9), `pt` (pulse phase, start 0), `gT` (last frame ts, 0), `gLast` (last drawn ts, 0). Input: `{ drag, tRotX, tRotY, rVelX, rVelY, tZoom }` (targets/velocities written by the gesture layer; `tRotX/Y` start 0, `tZoom` 2.9).

```js
if (disposed) return false;
// IDLE GOVERNOR: ~30fps while drifting, full rate while interacting
const busy = input.drag || |input.rVelX| > 1e-4 || |input.rVelY| > 1e-4
          || |input.tZoom - globeZoom| > 1e-3;
if (!busy && ts - gLast < 28) return false;          // frame SKIPPED → drew = false
gLast = ts;

const dt = clamp(gT ? (ts - gT) / 16.667 : 1, 0.2, 3);  // 60fps-normalised, resume-safe
gT = ts;
pt += 0.034 * dt;                                     // marker pulse phase

if (!input.drag) {
  input.tRotY += 0.0015 * dt;                         // auto-rotation (east-west spin)
  const d = Math.pow(0.92, dt);                       // inertia decay
  input.rVelX *= d;  input.rVelY *= d;
  input.tRotX += input.rVelX * 0.04 * dt;             // fling carries the target
  input.tRotY += input.rVelY * 0.04 * dt;
}
const e = k => 1 - Math.pow(1 - k, dt);               // frame-rate-independent ease
cRotX    += (input.tRotX - cRotX) * e(0.18);
cRotY    += (input.tRotY - cRotY) * e(0.18);
globeZoom += (input.tZoom - globeZoom) * e(0.15);
camera.z = globeZoom;
globe.rotation = Euler(cRotX, cRotY, 0, 'XYZ');        // R = Rx(cRotX) · Ry(cRotY), applied to globe + its marker child
atmoCenterUniform = (0, 0, -globeZoom);
markerUniforms: uPt = pt, uProj = bufH / (2*tan(fov*PI/360));
render(); gl.endFrameEXP();
return true;                                          // drew = true
```
`frame()` returns **false** only when disposed or when the idle governor skips (not busy and <28 ms since last draw); every rendered frame returns **true**.

## 10. Misc contract points

- The scene is built immediately on the fallback (or directly on the real map when the boot warmup has the decoded pixels cached — "born textured"); the real 2048×1024 map is swapped into **both** `map` and `emissiveMap` when ready (swapping only `map` puts the globe back in the dark), then the fallback texture is disposed. On decode failure the fallback simply stays.
- Nothing may rely on the depth buffer to hide geometry behind the planet (broken depth on the Helio P35): atmosphere uses the analytic discard, markers use the facing fade, stars rely on draw order + the globe's opaque overdraw.
- `resize(bw, bh, w, h)` re-applies the RASTER_CAP formula and updates camera aspect `w/max(1,h)`.
- Startup log lines worth keeping for parity debugging: raster size/density/scale, drawing buffer size, texture path taken.
