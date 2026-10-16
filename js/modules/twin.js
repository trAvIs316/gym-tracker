// js/modules/twin.js - 3D Digital Twin 模組 (排除 3D 視窗區域的空白取消機制)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { AppState, ALL_MUSCLE_ITEMS } from '../config.js';

let scene, camera, renderer, controls, raycaster, mouse;
let humanModel = null;
let activeSelectedMuscle = null;
let animationFrameId = null;
let customShaderMaterials = [];

// 預設正面最佳視角
const DEFAULT_VIEW = {
  camPos: new THREE.Vector3(0, 0.85, 2.65),
  target: new THREE.Vector3(0, 0.85, 0)
};

// 精準校對的解剖空間範圍
const MUSCLE_BOUNDS = {
  '胸': {
    minY: 1.15, maxY: 1.36,
    minZ: 0.01, maxZ: 10.0,
    xAbsMin: 0.0, xAbsMax: 0.20,
    color: new THREE.Color(0x22d3ee),
    isWholeBody: false
  },
  '背': {
    minY: 1.05, maxY: 1.40,
    minZ: -10.0, maxZ: -0.01,
    xAbsMin: 0.0, xAbsMax: 0.20,
    color: new THREE.Color(0x818cf8),
    isWholeBody: false
  },
  '腹': {
    minY: 0.90, maxY: 1.16,
    minZ: 0.01, maxZ: 10.0,
    xAbsMin: 0.0, xAbsMax: 0.12,
    color: new THREE.Color(0x06b6d4),
    isWholeBody: false
  },
  '膊': {
    minY: 1.25, maxY: 1.48,
    minZ: -10.0, maxZ: 10.0,
    xAbsMin: 0.16, xAbsMax: 0.42,
    color: new THREE.Color(0x38bdf8),
    isWholeBody: false
  },
  '二頭': {
    minY: 1.12, maxY: 1.34,
    minZ: 0.00, maxZ: 10.0,
    xAbsMin: 0.21, xAbsMax: 0.42,
    color: new THREE.Color(0x22d3ee),
    isWholeBody: false
  },
  '三頭': {
    minY: 1.12, maxY: 1.34,
    minZ: -10.0, maxZ: 0.00,
    xAbsMin: 0.21, xAbsMax: 0.42,
    color: new THREE.Color(0x818cf8),
    isWholeBody: false
  },
  '腳': {
    minY: 0.00, maxY: 0.86,
    minZ: -10.0, maxZ: 10.0,
    xAbsMin: 0.0, xAbsMax: 0.28,
    color: new THREE.Color(0x3b82f6),
    isWholeBody: false
  },
  '帶氧': {
    minY: -10.0, maxY: 10.0,
    minZ: -10.0, maxZ: 10.0,
    xAbsMin: 0.0, xAbsMax: 10.0,
    color: new THREE.Color(0x10b981),
    isWholeBody: true
  }
};

export function initTwinView() {
  activeSelectedMuscle = null;
  renderTwinInterface();
  setTimeout(initThreeScene, 60);
}

export function calculateMuscleScores() {
  const scores = {};
  ALL_MUSCLE_ITEMS.forEach(m => scores[m] = { score: 45, sets: 0, status: '需活化' });

  const history = AppState.historicalWorkouts || {};
  const todayLogs = AppState.workoutLogs || [];

  const processSet = (muscle) => {
    if (scores[muscle]) scores[muscle].sets += 1;
  };

  todayLogs.forEach(l => processSet(l.muscle_group));
  Object.keys(history).slice(0, 7).forEach(d => {
    const logs = history[d]?.logs || [];
    logs.forEach(l => processSet(l.muscle_group));
  });

  ALL_MUSCLE_ITEMS.forEach(m => {
    const s = scores[m].sets;
    let finalScore = 40 + (s * 4);
    if (finalScore > 98) finalScore = 98;
    scores[m].score = finalScore;
    if (finalScore >= 80) scores[m].status = '巔峰刺激';
    else if (finalScore >= 65) scores[m].status = '充足負荷';
    else scores[m].status = '待訓練';
  });

  return scores;
}

function initThreeScene() {
  const canvasContainer = document.getElementById('threeCanvasContainer');
  if (!canvasContainer) return;

  canvasContainer.innerHTML = "";
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  customShaderMaterials = [];

  const width = canvasContainer.clientWidth || 240;
  const height = canvasContainer.clientHeight || 420;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.copy(DEFAULT_VIEW.camPos);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.display = "block";
  renderer.domElement.style.margin = "0 auto";
  canvasContainer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  
  controls.enablePan = true;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;

  controls.minDistance = 1.0;
  controls.maxDistance = 5.0;
  controls.maxPolarAngle = Math.PI * 0.80;
  controls.minPolarAngle = Math.PI * 0.20;
  controls.target.copy(DEFAULT_VIEW.target);

  const ambientLight = new THREE.AmbientLight(0x06b6d4, 1.4);
  scene.add(ambientLight);

  const frontKeyLight = new THREE.DirectionalLight(0x38bdf8, 2.5);
  frontKeyLight.position.set(0, 2, 3);
  scene.add(frontKeyLight);

  const backRimLight = new THREE.DirectionalLight(0x6366f1, 2.0);
  backRimLight.position.set(0, -1, -3);
  scene.add(backRimLight);

  loadModel();
  animate();

  window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
  const canvasContainer = document.getElementById('threeCanvasContainer');
  if (!canvasContainer || !camera || !renderer) return;
  const width = canvasContainer.clientWidth;
  const height = canvasContainer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function createCyberGlowShaderMaterial() {
  const uniforms = {
    baseColor: { value: new THREE.Color(0x06b6d4) },
    glowColor: { value: new THREE.Color(0x22d3ee) },
    highlightActive: { value: 0.0 },
    isWholeBody: { value: 0.0 },
    yMin: { value: -10.0 },
    yMax: { value: 10.0 },
    zMin: { value: -10.0 },
    zMax: { value: 10.0 },
    xAbsMin: { value: -1.0 },
    xAbsMax: { value: 10.0 },
    time: { value: 0.0 }
  };

  const vertexShader = `
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    uniform vec3 baseColor;
    uniform vec3 glowColor;
    uniform float highlightActive;
    uniform float isWholeBody;
    uniform float yMin;
    uniform float yMax;
    uniform float zMin;
    uniform float zMax;
    uniform float xAbsMin;
    uniform float xAbsMax;
    uniform float time;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      bool inY = (vWorldPosition.y >= yMin && vWorldPosition.y <= yMax);
      bool inZ = (vWorldPosition.z >= zMin && vWorldPosition.z <= zMax);
      float absX = abs(vWorldPosition.x);
      bool inX = (xAbsMin < 0.0) ? true : (absX >= xAbsMin && absX <= xAbsMax);

      bool isTargetMuscle = (highlightActive > 0.5) && (isWholeBody > 0.5 || (inY && inZ && inX));

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      float fresnel = 1.0 - abs(dot(vNormal, viewDir));
      fresnel = pow(fresnel, 1.8);

      if (isTargetMuscle) {
        float pulse = 0.88 + 0.12 * sin(time * 6.0);
        vec3 col = glowColor * pulse * 1.5;
        gl_FragColor = vec4(col, 0.95);
      } else {
        float alpha = (highlightActive > 0.5) ? 0.18 : (0.35 + 0.35 * fresnel);
        vec3 col = (highlightActive > 0.5) ? vec3(0.06, 0.12, 0.22) : (baseColor + 0.3 * fresnel);
        gl_FragColor = vec4(col, alpha);
      }
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    wireframe: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  customShaderMaterials.push(mat);
  return mat;
}

function loadModel() {
  const loader = new GLTFLoader();
  loader.load(
    './assets/human_anatomy.glb',
    (gltf) => {
      humanModel = gltf.scene;

      const box = new THREE.Box3().setFromObject(humanModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const targetHeight = 1.55;
      const scaleFactor = targetHeight / (size.y || 1);
      humanModel.scale.setScalar(scaleFactor);

      box.setFromObject(humanModel);
      box.getCenter(center);

      humanModel.position.x += (0 - center.x);
      humanModel.position.y += (0.85 - center.y);
      humanModel.position.z += (0 - center.z);

      humanModel.traverse((child) => {
        if (child.isMesh) {
          child.material = createCyberGlowShaderMaterial();
        }
      });

      scene.add(humanModel);
    },
    undefined,
    () => {
      generateProceduralCyberBody();
    }
  );
}

function generateProceduralCyberBody() {
  humanModel = new THREE.Group();

  const parts = [
    { geo: new THREE.BoxGeometry(0.44, 0.26, 0.20), pos: [0, 1.22, 0] },
    { geo: new THREE.BoxGeometry(0.34, 0.28, 0.16), pos: [0, 0.94, 0] },
    { geo: new THREE.BoxGeometry(0.44, 0.38, 0.12), pos: [0, 1.18, -0.05] },
    { geo: new THREE.SphereGeometry(0.11, 16, 16), pos: [-0.30, 1.28, 0] },
    { geo: new THREE.SphereGeometry(0.11, 16, 16), pos: [0.30, 1.28, 0] },
    { geo: new THREE.CylinderGeometry(0.07, 0.06, 0.26, 16), pos: [-0.32, 1.08, 0] },
    { geo: new THREE.CylinderGeometry(0.07, 0.06, 0.26, 16), pos: [0.32, 1.08, 0] },
    { geo: new THREE.CylinderGeometry(0.11, 0.08, 0.60, 16), pos: [-0.15, 0.48, 0] },
    { geo: new THREE.CylinderGeometry(0.11, 0.08, 0.60, 16), pos: [0.15, 0.48, 0] }
  ];

  parts.forEach(p => {
    const mat = createCyberGlowShaderMaterial();
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.position.set(...p.pos);
    humanModel.add(mesh);
  });

  const headGeo = new THREE.SphereGeometry(0.13, 20, 20);
  const headMesh = new THREE.Mesh(headGeo, createCyberGlowShaderMaterial());
  headMesh.position.set(0, 1.52, 0);
  humanModel.add(headMesh);

  scene.add(humanModel);
}

function animate(timestamp) {
  animationFrameId = requestAnimationFrame(animate);
  if (controls) controls.update();

  const timeVal = (timestamp || 0) * 0.001;
  customShaderMaterials.forEach(m => {
    if (m.uniforms?.time) m.uniforms.time.value = timeVal;
  });

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

export function resetCameraView() {
  if (camera && controls) {
    camera.position.copy(DEFAULT_VIEW.camPos);
    controls.target.copy(DEFAULT_VIEW.target);
    controls.update();
  }
}

export function toggleSelectMuscle(muscle) {
  activeSelectedMuscle = (activeSelectedMuscle === muscle) ? null : muscle;

  const config = activeSelectedMuscle ? MUSCLE_BOUNDS[activeSelectedMuscle] : null;

  customShaderMaterials.forEach(mat => {
    if (!mat.uniforms) return;
    if (config) {
      mat.uniforms.highlightActive.value = 1.0;
      mat.uniforms.isWholeBody.value = config.isWholeBody ? 1.0 : 0.0;
      mat.uniforms.glowColor.value.copy(config.color);
      mat.uniforms.yMin.value = config.minY !== undefined ? config.minY : -10.0;
      mat.uniforms.yMax.value = config.maxY !== undefined ? config.maxY : 10.0;
      mat.uniforms.zMin.value = config.minZ !== undefined ? config.minZ : -10.0;
      mat.uniforms.zMax.value = config.maxZ !== undefined ? config.maxZ : 10.0;
      mat.uniforms.xAbsMin.value = config.xAbsMin !== undefined ? config.xAbsMin : -1.0;
      mat.uniforms.xAbsMax.value = config.xAbsMax !== undefined ? config.xAbsMax : 10.0;
    } else {
      mat.uniforms.highlightActive.value = 0.0;
      mat.uniforms.isWholeBody.value = 0.0;
    }
  });

  updateSidebarAndBottomUI();
}

export function resetSelection() {
  if (activeSelectedMuscle !== null) {
    toggleSelectMuscle(null);
  }
}

function updateSidebarAndBottomUI() {
  const scores = calculateMuscleScores();

  ALL_MUSCLE_ITEMS.forEach(m => {
    const cardEl = document.getElementById(`twin-card-${m}`);
    if (!cardEl) return;
    const isSelected = activeSelectedMuscle === m;
    const isDimmed = activeSelectedMuscle && !isSelected;

    cardEl.className = `p-2 sm:p-2.5 rounded-xl border backdrop-blur-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-1.5 ${
      isSelected
        ? 'border-cyan-400 bg-cyan-950/70 shadow-[0_0_15px_rgba(6,182,212,0.5)] scale-[1.03]'
        : isDimmed
          ? 'border-slate-800/40 bg-slate-950/20 opacity-30'
          : 'border-slate-800/80 bg-slate-900/60 hover:border-slate-700'
    }`;
  });

  const bottomBar = document.getElementById('twinBottomInfoBar');
  if (bottomBar) {
    if (activeSelectedMuscle) {
      const info = scores[activeSelectedMuscle];
      bottomBar.innerHTML = `
        <div class="w-full bg-slate-900/90 border border-cyan-500/40 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs backdrop-blur-md animate-fadeIn">
          <div class="truncate flex items-center gap-1.5">
            <span class="text-sm">🎯</span>
            <span class="text-slate-200 text-[11px] font-mono truncate">
              <b class="text-cyan-300">${activeSelectedMuscle}</b>：${info.sets}組/週 [${info.status}] —${info.score < 70 ? '刺激不足，建議下次增加主力刺激。' : '負荷狀態良好，維持漸進超負荷即可！'}
            </span>
          </div>
          <button onclick="event.stopPropagation(); window.twinMod.resetSelection()" class="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex-shrink-0 ml-2">重設</button>
        </div>
      `;
    } else {
      bottomBar.innerHTML = ``;
    }
  }
}

export function renderTwinInterface() {
  const container = document.getElementById('twinContainer');
  if (!container) return;

  const scores = calculateMuscleScores();
  const leftMuscles = ['胸', '膊', '二頭', '腹'];
  const rightMuscles = ['背', '三頭', '腳', '帶氧'];

  const getColor = (score) => {
    if (score >= 80) return '#10b981';
    if (score >= 65) return '#06b6d4';
    return '#6366f1';
  };

  const renderCard = (m, alignRight = false) => {
    const item = scores[m];
    const color = getColor(item.score);

    return `
      <div id="twin-card-${m}" onclick="event.stopPropagation(); window.twinMod.toggleSelectMuscle('${m}')"
           class="p-2 sm:p-2.5 rounded-xl border border-slate-800/80 bg-slate-900/60 hover:border-slate-700 backdrop-blur-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-1.5">
        <div class="${alignRight ? 'text-right order-2' : 'text-left order-1'} min-w-0">
          <span class="text-xs font-bold text-white block truncate leading-tight">${m}</span>
          <span class="text-[9px] text-slate-400 block leading-tight font-mono">${item.sets}組 • ${item.status}</span>
        </div>
        <div class="${alignRight ? 'order-1 text-left' : 'order-2 text-right'} flex-shrink-0">
          <span class="text-base font-black font-mono leading-none" style="color: ${color};">${item.score}</span>
        </div>
      </div>
    `;
  };

  container.innerHTML = `
    <!-- 全景科技掃描背景容器 (點擊外部空白處才取消選取) -->
    <div onclick="window.twinMod.resetSelection()" class="relative w-full rounded-2xl border border-cyan-500/30 bg-slate-950/95 overflow-hidden shadow-2xl p-2.5 sm:p-3 select-none flex flex-col justify-between" style="min-height: 510px;">
      
      <div class="absolute inset-0 bg-[linear-gradient(to_right,#06b6d408_1px,transparent_1px),linear-gradient(to_bottom,#06b6d408_1px,transparent_1px)] bg-[size:1.2rem_1.2rem] pointer-events-none"></div>
      <div class="absolute inset-x-6 top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80 animate-pulse pointer-events-none"></div>

      <div class="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-400/80 pointer-events-none"></div>
      <div class="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-400/80 pointer-events-none"></div>
      <div class="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-400/80 pointer-events-none"></div>
      <div class="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-400/80 pointer-events-none"></div>

      <div class="relative z-10 flex items-center justify-between gap-1 sm:gap-2 my-auto py-2 w-full">
        
        <!-- 左側資訊卡欄 -->
        <div class="w-[28%] flex flex-col gap-2 sm:gap-2.5 flex-shrink-0">
          ${leftMuscles.map(m => renderCard(m, false)).join('')}
        </div>

        <!-- 中間 3D 視窗 (加入 event.stopPropagation()，阻止點擊冒泡，保證旋轉或點擊 3D 視窗絕不取消部位選取) -->
        <div onclick="event.stopPropagation()" class="w-[44%] h-72 sm:h-88 relative flex items-center justify-center cursor-grab active:cursor-grabbing mx-auto">
          <div id="threeCanvasContainer" class="w-full h-full flex items-center justify-center"></div>
          
          <!-- 全息指針重設視角按鈕 -->
          <button type="button" 
                  onclick="event.stopPropagation(); window.twinMod.resetCameraView()" 
                  title="重歸正面視點" 
                  class="absolute top-0 right-0 w-8 h-8 rounded-xl bg-slate-900/85 hover:bg-cyan-950 border border-cyan-500/50 hover:border-cyan-400 text-cyan-300 transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.35)] flex items-center justify-center active:scale-90 group backdrop-blur-md z-20">
            <svg class="w-4 h-4 group-hover:rotate-180 transition-transform duration-500 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
        </div>

        <!-- 右側資訊卡欄 -->
        <div class="w-[28%] flex flex-col gap-2 sm:gap-2.5 flex-shrink-0">
          ${rightMuscles.map(m => renderCard(m, true)).join('')}
        </div>

      </div>

      <!-- 底部就地資訊列 (同樣阻擋冒泡，點擊重設按鈕才解除) -->
      <div onclick="event.stopPropagation()" id="twinBottomInfoBar" class="relative z-10 min-h-[36px] flex items-center justify-between"></div>

    </div>
  `;
}

const twinExports = {
  initTwinView,
  calculateMuscleScores,
  renderTwinInterface,
  toggleSelectMuscle,
  resetSelection,
  resetCameraView
};

window.twinMod = twinExports;
Object.assign(window, twinExports);