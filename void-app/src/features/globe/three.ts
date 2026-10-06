// three.js behind a lazy require (textures.ts). This file exists for ONE reason:
// Metro resolves three's package "exports" by how it is asked for - an ESM import
// gets "import" (build/three.module.js, the copy globeScene/OnboardGlobe load) and a
// require() gets "require" (build/three.cjs). A bare require('three') in textures.ts
// would bundle and evaluate a SECOND three. require('./three') + this import keeps one.
import * as THREE from 'three';
export { THREE };
