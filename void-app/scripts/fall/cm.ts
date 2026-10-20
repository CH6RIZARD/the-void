// Imported first: the app's GL view runs with colour management off (LoadingScreen.tsx); the figure's
// materials are made at import time, so this has to happen before voidFigure.ts loads.
import * as THREE from 'three';
(THREE as any).ColorManagement.enabled = false;
