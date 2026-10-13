// The onboarding globe's scene, as a pure function of three.js so the same code runs
// on the phone (OnboardGlobe, expo-gl) and in a desktop browser preview.
//
// DEPTH-INDEPENDENT BY DESIGN. The mock's version hid the far side of the planet
// with the depth buffer: its atmosphere was a BackSide sphere whose back faces sat
// behind the dark body. On the Helio P35 test phone expo-gl gave no working depth
// test, so every back face drew and the globe came out as a white sun. Here nothing
// relies on depth:
//   • the atmosphere (the mock's BackSide shader, unchanged) drops every fragment
//     whose view ray hits the planet — an analytic ray/sphere test standing in for
//     the depth test;
//   • land dots and nation lights compute whether they face the camera and fade out
//     on the far hemisphere themselves.
// All transparent layers run with depthTest off, so every GPU draws the same picture.
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export const NATIONS: ReadonlyArray<readonly [number, number]> = [
  [35.68, 139.69], [41.01, 28.98], [40.71, -74.0], [37.57, 126.98], [-33.87, 151.21], [31.77, 35.21], [25.03, 121.56], [40.41, 49.87],
  [40.18, 44.51], [50.45, 30.52], [59.93, 30.32], [9.03, 38.74], [48.86, 2.35], [52.52, 13.4], [51.5, -0.13], [55.75, 37.62],
  [39.9, 116.4], [28.61, 77.2], [19.08, 72.88], [13.76, 100.5], [1.35, 103.82], [-6.21, 106.85], [14.6, 120.98], [30.04, 31.24],
  [-1.29, 36.82], [6.52, 3.38], [-26.2, 28.05], [33.59, -7.6], [-23.55, -46.63], [-34.6, -58.38], [-12.05, -77.04], [4.71, -74.07],
  [19.43, -99.13], [34.05, -118.24], [41.88, -87.63], [45.5, -73.57], [64.15, -21.94], [24.71, 46.68], [25.2, 55.27], [35.69, 51.39],
  [33.31, 44.37], [41.3, 69.24], [47.92, 106.92], [21.03, 105.85], [27.72, 85.32], [-36.85, 174.76], [-17.83, 31.05], [15.5, 32.56],
  [14.69, -17.45], [5.6, -0.19], [36.75, 3.06], [38.72, -9.14], [40.42, -3.7], [41.9, 12.5], [59.33, 18.07], [60.17, 24.94],
  [52.37, 4.9], [50.08, 14.44], [47.5, 19.04], [44.43, 26.1], [37.98, 23.73], [-4.44, 15.27], [12.36, -1.53], [3.87, 11.52],
];

function toXYZ(lat: number, lon: number, r: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180,
    theta = ((lon + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

// Facing factor shared by every layer: 1 where the surface looks at the camera,
// 0 at the limb and beyond. Perspective-correct (uses the real view vector).
// GLSL needs these on their own lines, so the newlines are escapes in one string
// rather than a multi-line literal. highp where the device has it, mediump where
// it does not - the renderer asks for mediump globally, which is not enough for
// the limb test below.
const PREC =
  '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

const FACING = 'float facing(vec3 objNormal, vec4 mv){vec3 n=normalize(normalMatrix*objNormal);return dot(n,normalize(-mv.xyz));}';

// The mock's own shaders, unchanged, so the picture matches the design exactly:
// a dark body, a bright peach-white atmosphere hugging the silhouette and fading
// outward (BackSide shell, r = 1.08), and a faint violet inner rim (r = 1.0).
// The ONE addition: the atmosphere drops any fragment whose view ray hits the body
// (analytic ray/sphere test) — what the depth buffer did in the browser.
const BODY_R = 0.992;
const ATMO_R = 1.08;
const RIM_VS = 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const ATMO_VS =
  'varying vec3 vN;varying vec3 vPos;varying vec3 vCtr;' +
  'void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.0);vPos=mv.xyz;vCtr=(modelViewMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;gl_Position=projectionMatrix*mv;}';
// WHY highp, AND WHY NO HARD DISCARD.
// The renderer asks for mediump, and this test decides a pixel by the sign of
// b*b-c. At the limb that quantity passes through zero, while b*b is around 8 -
// so in mediump the rounding error swamps the answer and neighbouring pixels
// fall on opposite sides at random. On the phone that read as a speckled, torn
// fringe where the glow meets the planet. highp gives the test the headroom to
// be right, and instead of an all-or-nothing discard the hit now fades over a
// narrow band (EDGE_SOFT, in the same units as the test), so the boundary is
// smooth on a device with no multisampling to smooth it for us.
const EDGE_SOFT = 0.02;
const ATMO_FS =
  PREC +
  'varying vec3 vN;varying vec3 vPos;varying vec3 vCtr;' +
  'void main(){vec3 d=normalize(vPos);float b=dot(d,vCtr);float c=dot(vCtr,vCtr)-' +
  (BODY_R * BODY_R).toFixed(5) +
  ';float hit=b*b-c;' +
  'float cover=smoothstep(' + EDGE_SOFT.toFixed(4) + ',-' + EDGE_SOFT.toFixed(4) + ',hit);' +
  'if(cover<=0.002)discard;' +
  'float i=pow(0.72-dot(vN,vec3(0.0,0.0,1.0)),3.5);i*=cover;' +
  'gl_FragColor=vec4(vec3(0.79,0.66,0.30)*i*0.9+vec3(0.35,0.18,0.7)*i*0.5,i);}';
const RIM_FS = PREC + 'varying vec3 vN;void main(){float i=pow(1.0-abs(dot(vN,vec3(0.0,0.0,1.0))),4.0);gl_FragColor=vec4(vec3(0.49,0.36,0.93)*i,i*0.55);}';

const LAND_VS = `uniform float uSize;uniform float uScale;varying float vVis;${FACING}
void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vVis=smoothstep(0.0,0.3,facing(position,mv));gl_PointSize=max(1.0,uSize*(uScale/-mv.z));gl_Position=projectionMatrix*mv;}`;
const LAND_FS = `uniform vec3 uColor;uniform float uOpacity;varying float vVis;
void main(){if(vVis<0.01)discard;float d=length(gl_PointCoord-0.5);if(d>0.5)discard;gl_FragColor=vec4(uColor,uOpacity*vVis);}`;

const LIGHT_VS = `attribute float phase;attribute float speed;uniform float uTime;uniform float uPR;varying float vA;${FACING}
void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);float vis=smoothstep(0.05,0.35,facing(position,mv));float tw=0.5+0.5*sin(uTime*speed+phase);tw=pow(tw,3.0);vA=(0.12+0.88*tw)*vis;gl_PointSize=(7.0+16.0*tw)*(3.0/-mv.z)*uPR;gl_Position=projectionMatrix*mv;}`;
const LIGHT_FS = `uniform vec3 uColor;varying float vA;
void main(){if(vA<0.01)discard;float d=length(gl_PointCoord-0.5);if(d>0.5)discard;float a=smoothstep(0.5,0.05,d);float core=smoothstep(0.16,0.0,d);gl_FragColor=vec4(uColor+vec3(core*0.7),a*vA);}`;

export interface GlobeParts {
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  group: THREE_NS.Group;
  setTime(seconds: number): void;
}

/**
 * @param W,H   drawing-buffer size in device px
 * @param pr    device px per layout px (the mock sized lights in CSS px × DPR)
 * @param land  land-dot xyz (landPositions())
 * @param paint globePaint() of a light theme: ocean body, ink land dots, gold lights, no glow shells. [] = night.
 */
export function buildGlobe(T: THREE, W: number, H: number, pr: number, land: Float32Array, showLand = false, paint: number[] = []): GlobeParts {
  const lt = paint.length > 0;
  if (lt) showLand = true;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, W / Math.max(1, H), 0.1, 50);
  const group = new T.Group();
  scene.add(group);

  const shell = (r: number, vs: string, fs: string, side: THREE_NS.Side) =>
    new T.Mesh(
      new T.SphereGeometry(r, 64, 64),
      new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, side, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending }),
    );

  // Body first (opaque), then everything else painted over it in order.
  const body = new T.Mesh(new T.SphereGeometry(BODY_R, 96, 96), new T.MeshBasicMaterial({ color: lt ? new T.Color().setRGB(paint[3], paint[4], paint[5], T.SRGBColorSpace) : 0x07031a, depthTest: false }));
  body.renderOrder = 0;
  group.add(body);

  const landGeo = new T.BufferGeometry();
  landGeo.setAttribute('position', new T.BufferAttribute(land, 3));
  const landPts = new T.Points(
    landGeo,
    new T.ShaderMaterial({
      vertexShader: LAND_VS,
      fragmentShader: LAND_FS,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // three's PointsMaterial attenuation: size × (bufferHeight/2) / depth.
      uniforms: { uSize: { value: 0.011 }, uScale: { value: H / 2 }, uColor: { value: lt ? new T.Color(paint[6], paint[7], paint[8]) : new T.Color(0x8d7cc0) }, uOpacity: { value: lt ? 0.9 : 0.7 } },
    }),
  );
  landPts.renderOrder = 1;
  // The design as it shipped showed no land (its texture URL 404s); matching it.
  if (showLand) group.add(landPts);

  const edge = shell(1.0, RIM_VS, RIM_FS, T.FrontSide);
  edge.renderOrder = 2;
  // The rim and halo glow additively: on a light page they vanish, so light themes skip them.
  if (!lt) group.add(edge);
  const halo = shell(ATMO_R, ATMO_VS, ATMO_FS, T.BackSide);
  halo.renderOrder = 3;
  if (!lt) group.add(halo);

  const n = NATIONS.length,
    pos = new Float32Array(n * 3),
    phase = new Float32Array(n),
    speed = new Float32Array(n);
  NATIONS.forEach(([lat, lon], i) => {
    pos.set(toXYZ(lat, lon, 1.003), i * 3);
    phase[i] = Math.random() * Math.PI * 2;
    speed[i] = 0.6 + Math.random() * 1.4;
  });
  const lg = new T.BufferGeometry();
  lg.setAttribute('position', new T.BufferAttribute(pos, 3));
  lg.setAttribute('phase', new T.BufferAttribute(phase, 1));
  lg.setAttribute('speed', new T.BufferAttribute(speed, 1));
  const lightMat = new T.ShaderMaterial({
    vertexShader: LIGHT_VS,
    // On a light page the lights blend normally, premultiplied (straight alpha washes them out).
    fragmentShader: lt ? LIGHT_FS.replace('gl_FragColor=vec4(uColor+vec3(core*0.7),a*vA);', 'gl_FragColor=vec4((uColor+vec3(core*0.7))*a*vA,a*vA);') : LIGHT_FS,
    premultipliedAlpha: lt,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: lt ? T.NormalBlending : T.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: pr }, uColor: { value: lt ? new T.Color(paint[9], paint[10], paint[11]) : new T.Color(0xc9a84c) } },
  });
  const lights = new T.Points(lg, lightMat);
  lights.renderOrder = 4;
  group.add(lights);

  // Globe centre on the view's bottom edge, width ≈ 1.08× the view (mock's fit()).
  const halfH = 1.16 / camera.aspect;
  camera.position.set(0, 0, halfH / Math.tan((camera.fov * Math.PI) / 360));
  group.position.y = -halfH * 0.98;
  camera.updateProjectionMatrix();

  return {
    scene,
    camera,
    group,
    setTime: (s) => {
      lightMat.uniforms.uTime.value = s;
    },
  };
}
