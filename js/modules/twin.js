// js/modules/twin.js - 3D Digital Twin 模組 (語法加固防崩潰 + 局部座標著色 + 彩色神域金銀銅階級)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { AppState, ALL_MUSCLE_ITEMS } from '../config.js';

let scene, camera, renderer, controls, raycaster, mouse;
let humanModel = null;
let mixer = null;
let activeSelectedMuscle = null;
let animationFrameId = null;
let customShaderMaterials = [];
let clock = new THREE.Clock();

// 安全獲取體重，避免模組引用衝突引發崩潰
function safeGetUserWeight() {
  try {
    const storedKg = parseFloat(localStorage.getItem('gym_user_weight_kg'));
    return (!isNaN(storedKg) && storedKg > 0) ? storedKg : 70.8;
  } catch (_) {
    return 70.8;
  }
}

// 預設正面最佳視角 (鏡頭與焦點下移至 0.70，徹底解決頭頂出界截斷問題)
const DEFAULT_VIEW = {
  camPos: new THREE.Vector3(0, 0.70, 2.75),
  target: new THREE.Vector3(0, 0.70, 0)
};

// 以模型「局部中心原點 (0,0,0)」為基準的解剖邊界 (解決背部著色跑到腿部的問題)
const MUSCLE_BOUNDS = {
  '胸': { minY: 0.30, maxY: 0.58, minZ: 0.01, maxZ: 5.0, xAbsMin: 0.0, xAbsMax: 0.22, color: new THREE.Color(0x22d3ee) },
  '背': { minY: 0.22, maxY: 0.60, minZ: -5.0, maxZ: -0.01, xAbsMin: 0.0, xAbsMax: 0.22, color: new THREE.Color(0xa78bfa) },
  '腹': { minY: 0.02, maxY: 0.30, minZ: 0.01, maxZ: 5.0, xAbsMin: 0.0, xAbsMax: 0.13, color: new THREE.Color(0x06b6d4) },
  '膊': { minY: 0.45, maxY: 0.68, minZ: -5.0, maxZ: 5.0, xAbsMin: 0.18, xAbsMax: 0.42, color: new THREE.Color(0x38bdf8) },
  '二頭': { minY: 0.25, maxY: 0.48, minZ: 0.00, maxZ: 5.0, xAbsMin: 0.22, xAbsMax: 0.45, color: new THREE.Color(0x22d3ee) },
  '三頭': { minY: 0.25, maxY: 0.48, minZ: -5.0, maxZ: 0.00, xAbsMin: 0.22, xAbsMax: 0.45, color: new THREE.Color(0xa78bfa) },
  '腳': { minY: -0.85, maxY: 0.02, minZ: -5.0, maxZ: 5.0, xAbsMin: 0.0, xAbsMax: 0.30, color: new THREE.Color(0x3b82f6) },
  '帶氧': { minY: -10.0, maxY: 10.0, minZ: -10.0, maxZ: 10.0, xAbsMin: 0.0, xAbsMax: 10.0, color: new THREE.Color(0x10b981), isWholeBody: true }
};

export function initTwinView() {
  activeSelectedMuscle = null;
  renderTwinInterface();
  setTimeout(initThreeScene, 60);
}

// 力量推比 + 生理衰退評分模型
export function calculateMuscleScores() {
  const userWeightKg = safeGetUserWeight();
  const scores = {};
  const today = new Date();

  const strengthBenchmarks = {
    '胸': { benchmarkRatio: 1.25, minRatio: 0.4 },
    '背': { benchmarkRatio: 1.25, minRatio: 0.4 },
    '腳': { benchmarkRatio: 1.80, minRatio: 0.6 },
    '膊': { benchmarkRatio: 0.75, minRatio: 0.25 },
    '二頭': { benchmarkRatio: 0.55, minRatio: 0.15 },
    '三頭': { benchmarkRatio: 0.55, minRatio: 0.15 },
    '腹': { benchmarkRatio: 0.60, minRatio: 0.20 },
    '帶氧': { benchmarkRatio: 1.00, minRatio: 0.30 }
  };

  const muscleList = ALL_MUSCLE_ITEMS || ['胸', '背', '膊', '二頭', '三頭', '腳', '腹', '帶氧'];
  muscleList.forEach(m => {
    scores[m] = {
      score: 40,
      best1RM: 0,
      ratio: 0,
      status: '未有紀錄',
      bestLoadText: '--',
      daysAgo: 99
    };
  });

  const history = AppState?.historicalWorkouts || {};
  const todayLogs = AppState?.workoutLogs || [];

  todayLogs.forEach(l => {
    const m = l.muscle_group;
    if (!scores[m]) return;
    scores[m].daysAgo = 0;
    const w = parseFloat(l.weight_kg || l.weight) || 0;
    const r = parseInt(l.reps, 10) || 0;
    if (w > 0 && r > 0) {
      const est1RM = Math.round(w * (1 + r / 30) * 10) / 10;
      if (est1RM > scores[m].best1RM) {
        scores[m].best1RM = est1RM;
        scores[m].bestLoadText = `${w}kg × ${r}下`;
      }
    }
  });

  Object.keys(history).forEach(d => {
    const dayData = history[d];
    const diffDays = Math.max(0, Math.round((today - new Date(d)) / (1000 * 3600 * 24)));
    (dayData?.logs || []).forEach(l => {
      const m = l.muscle_group;
      if (!scores[m]) return;
      if (diffDays < scores[m].daysAgo) scores[m].daysAgo = diffDays;

      if (m === '帶氧') {
        const spd = parseFloat(l.speed) || 6.0;
        const inc = parseFloat(l.incline) || 0.0;
        const power = spd * (1 + inc * 0.1);
        if (power > scores[m].best1RM) {
          scores[m].best1RM = Math.round(power * 10) / 10;
          scores[m].bestLoadText = `速${spd} 斜${inc}%`;
        }
      } else {
        const w = parseFloat(l.weight_kg || l.weight) || 0;
        const r = parseInt(l.reps, 10) || 0;
        if (w > 0 && r > 0) {
          const est1RM = Math.round(w * (1 + r / 30) * 10) / 10;
          if (est1RM > scores[m].best1RM) {
            scores[m].best1RM = est1RM;
            scores[m].bestLoadText = `${w}kg × ${r}下`;
          }
        }
      }
    });
  });

  muscleList.forEach(m => {
    const cfg = strengthBenchmarks[m] || { benchmarkRatio: 1.0, minRatio: 0.3 };
    const best1RM = scores[m].best1RM;
    const daysAgo = scores[m].daysAgo;

    if (best1RM === 0) {
      scores[m].score = 40;
      scores[m].status = '基礎潛能';
      return;
    }

    let baseScore = 50;
    if (m === '帶氧') {
      baseScore = Math.min(98, Math.max(50, Math.round(45 + best1RM * 5)));
      scores[m].ratio = (best1RM / 10).toFixed(1);
    } else {
      const ratio = Number((best1RM / userWeightKg).toFixed(2));
      scores[m].ratio = ratio;
      baseScore = 50 + ((ratio - cfg.minRatio) / (cfg.benchmarkRatio - cfg.minRatio)) * 35;
      baseScore = Math.max(45, Math.min(98, Math.round(baseScore)));
    }

    // 生理衰退 (14天後每天0.7%，最多25%)
    let decayFactor = 1.0;
    if (daysAgo > 14) {
      const extraDays = daysAgo - 14;
      decayFactor = 1.0 - Math.min(0.25, extraDays * 0.007);
    }

    const finalScore = Math.round(baseScore * decayFactor);
    scores[m].score = finalScore;
    scores[m].status = `${scores[m].ratio}x 推比`;
  });

  return scores;
}

// 加權計算總戰力與彩色神域/金銀銅封號
export function calculateOverallTitle(scores) {
  const weights = { '腳': 0.25, '胸': 0.20, '背': 0.20, '膊': 0.12, '二頭': 0.08, '三頭': 0.08, '腹': 0.07 };
  let totalWeightedScore = 0;
  let totalW = 0;
  let maxDaysAgo = 0;

  Object.keys(weights).forEach(m => {
    totalWeightedScore += (scores[m]?.score || 40) * weights[m];
    totalW += weights[m];
    if (scores[m]?.daysAgo < 90 && scores[m]?.daysAgo > maxDaysAgo) maxDaysAgo = scores[m].daysAgo;
  });

  const overallScore = Math.round(totalWeightedScore / totalW);
  const isDormant = maxDaysAgo >= 28;
  const statusPrefix = isDormant ? '沉睡中的・' : '';

  let title = '鍛鍊原石';
  let tier = '起點級';
  let badgeStyle = '';
  let textGradient = '';

  if (overallScore >= 94) {
    title = `${statusPrefix}終焉的破壞神・絕對強者`;
    tier = '神域級';
    textGradient = 'bg-gradient-to-r from-red-500 via-yellow-400 via-green-400 via-cyan-400 via-indigo-500 to-purple-500 bg-clip-text text-transparent animate-pulse';
    badgeStyle = 'border-purple-500/60 bg-gradient-to-r from-purple-950/40 via-cyan-950/40 to-pink-950/40 shadow-[0_0_22px_rgba(168,85,247,0.5)]';
  } else if (overallScore >= 88) {
    title = `${statusPrefix}超越極限的・金屬霸王`;
    tier = '精英級';
    textGradient = 'bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-500 bg-clip-text text-transparent';
    badgeStyle = 'border-amber-400/60 bg-amber-950/40 shadow-[0_0_18px_rgba(251,191,36,0.4)]';
  } else if (overallScore >= 80) {
    title = `${statusPrefix}千錘百煉的・深淵狂戰士`;
    tier = '頂尖級';
    textGradient = 'bg-gradient-to-r from-slate-100 via-gray-200 to-slate-400 bg-clip-text text-transparent';
    badgeStyle = 'border-slate-300/60 bg-slate-900/60 shadow-[0_0_15px_rgba(226,232,240,0.35)]';
  } else if (overallScore >= 70) {
    title = `${statusPrefix}突破界限的・鋼鐵格鬥家`;
    tier = '強者級';
    textGradient = 'bg-gradient-to-r from-orange-300 via-amber-400 to-orange-600 bg-clip-text text-transparent';
    badgeStyle = 'border-orange-500/50 bg-orange-950/40 shadow-[0_0_14px_rgba(249,115,22,0.3)]';
  } else if (overallScore >= 60) {
    title = `${statusPrefix}覺醒之姿的・超新星`;
    tier = '銳進級';
    textGradient = 'bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent';
    badgeStyle = 'border-cyan-500/40 bg-cyan-950/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]';
  } else {
    title = '蓄勢待發的・鍛鍊原石';
    tier = '初階級';
    textGradient = 'text-slate-400';
    badgeStyle = 'border-slate-800 bg-slate-950/60';
  }

  return { overallScore, title, tier, badgeStyle, textGradient };
}

function initThreeScene() {
  const canvasContainer = document.getElementById('threeCanvasContainer');
  if (!canvasContainer) return;

  canvasContainer.innerHTML = "";
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  customShaderMaterials = [];
  clock = new THREE.Clock();

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
  camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
}

// 採用局部座標 vLocalPosition 著色，防止世界坐標位移造成部位下移
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
    varying vec3 vLocalPosition;
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vLocalPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

    varying vec3 vLocalPosition;
    varying vec3 vNormal;

    void main() {
      bool inY = (vLocalPosition.y >= yMin && vLocalPosition.y <= yMax);
      bool inZ = (vLocalPosition.z >= zMin && vLocalPosition.z <= zMax);
      float absX = abs(vLocalPosition.x);
      bool inX = (xAbsMin < 0.0) ? true : (absX >= xAbsMin && absX <= xAbsMax);

      bool isTargetMuscle = (highlightActive > 0.5) && (isWholeBody > 0.5 || (inY && inZ && inX));

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      float fresnel = 1.0 - abs(dot(vNormal, viewDir));
      fresnel = pow(fresnel, 1.8);

      if (isTargetMuscle) {
        float pulse = 0.88 + 0.12 * sin(time * 6.0);
        vec3 col = glowColor * pulse * 1.6;
        gl_FragColor = vec4(col, 0.95);
      } else {
        float alpha = (highlightActive > 0.5) ? 0.16 : (0.35 + 0.35 * fresnel);
        vec3 col = (highlightActive > 0.5) ? vec3(0.06, 0.12, 0.20) : (baseColor + 0.3 * fresnel);
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

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(humanModel);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
      }

      const box = new THREE.Box3().setFromObject(humanModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const targetHeight = 1.45;
      const scaleFactor = targetHeight / (size.y || 1);
      humanModel.scale.setScalar(scaleFactor);

      box.setFromObject(humanModel);
      box.getCenter(center);

      humanModel.position.x += (0 - center.x);
      humanModel.position.y += (0.70 - center.y);
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
    { geo: new THREE.BoxGeometry(0.44, 0.26, 0.20), pos: [0, 0.40, 0] },
    { geo: new THREE.BoxGeometry(0.34, 0.28, 0.16), pos: [0, 0.15, 0] },
    { geo: new THREE.BoxGeometry(0.44, 0.38, 0.12), pos: [0, 0.38, -0.05] },
    { geo: new THREE.SphereGeometry(0.11, 16, 16), pos: [-0.30, 0.48, 0] },
    { geo: new THREE.SphereGeometry(0.11, 16, 16), pos: [0.30, 0.48, 0] },
    { geo: new THREE.CylinderGeometry(0.07, 0.06, 0.26, 16), pos: [-0.32, 0.28, 0] },
    { geo: new THREE.CylinderGeometry(0.07, 0.06, 0.26, 16), pos: [0.32, 0.28, 0] },
    { geo: new THREE.CylinderGeometry(0.11, 0.08, 0.60, 16), pos: [-0.15, -0.32, 0] },
    { geo: new THREE.CylinderGeometry(0.11, 0.08, 0.60, 16), pos: [0.15, -0.32, 0] }
  ];

  parts.forEach(p => {
    const mat = createCyberGlowShaderMaterial();
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.position.set(...p.pos);
    humanModel.add(mesh);
  });

  const headGeo = new THREE.SphereGeometry(0.13, 20, 20);
  const headMesh = new THREE.Mesh(headGeo, createCyberGlowShaderMaterial());
  headMesh.position.set(0, 0.72, 0);
  humanModel.add(headMesh);

  humanModel.position.y = 0.70;
  scene.add(humanModel);
}

function animate(timestamp) {
  animationFrameId = requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (controls) controls.update();

  if (mixer) {
    mixer.update(delta);
  } else if (humanModel) {
    const breath = Math.sin((timestamp || 0) * 0.0025);
    humanModel.position.y = 0.70 + breath * 0.012;
  }

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

  const muscleList = ALL_MUSCLE_ITEMS || ['胸', '背', '膊', '二頭', '三頭', '腳', '腹', '帶氧'];
  muscleList.forEach(m => {
    const cardEl = document.getElementById(`twin-card-${m}`);
    if (!cardEl) return;
    const isSelected = activeSelectedMuscle === m;
    const isDimmed = activeSelectedMuscle && !isSelected;

    cardEl.className = `p-1.5 sm:p-2 rounded-xl border backdrop-blur-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-1 ${
      isSelected
        ? 'border-cyan-400 bg-cyan-950/80 shadow-[0_0_12px_rgba(6,182,212,0.5)] scale-[1.03]'
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
            <span class="text-sm">🏋️</span>
            <span class="text-slate-200 text-[11px] font-mono truncate">
              <b class="text-cyan-300">${activeSelectedMuscle}</b>：推估1RM <b class="text-white">${info.best1RM}kg</b> (推比 ${info.ratio}) • 最佳: ${info.bestLoadText}${info.daysAgo > 14 ? `<span class="text-amber-400 font-bold ml-1">(${info.daysAgo}天未練•已生理衰退)</span>` : ''}
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
  const overall = calculateOverallTitle(scores);

  const leftMuscles = ['胸', '膊', '二頭', '腹'];
  const rightMuscles = ['背', '三頭', '腳', '帶氧'];

  const getScoreColor = (score) => {
    if (score >= 94) return '#f43f5e';
    if (score >= 88) return '#fbbf24';
    if (score >= 80) return '#e2e8f0';
    if (score >= 70) return '#f97316';
    if (score >= 60) return '#06b6d4';
    return '#94a3b8';
  };

  const renderCard = (m, alignRight = false) => {
    const item = scores[m] || { score: 40 };
    const color = getScoreColor(item.score);

    return `
      <div id="twin-card-${m}" onclick="event.stopPropagation(); window.twinMod.toggleSelectMuscle('${m}')"
           class="p-2 sm:p-2.5 rounded-xl border border-slate-800/80 bg-slate-900/60 hover:border-slate-700 backdrop-blur-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-1">
        <span class="text-xs font-bold text-white block truncate ${alignRight ? 'order-2 text-right' : 'order-1 text-left'}">${m}</span>
        <span class="text-base font-black font-mono leading-none ${alignRight ? 'order-1 text-left' : 'order-2 text-right'}" style="color: ${color};">${item.score}</span>
      </div>
    `;
  };

  container.innerHTML = `
    <!-- 全景科技掃描背景容器 -->
    <div onclick="window.twinMod.resetSelection()" class="relative w-full rounded-2xl border border-cyan-500/30 bg-slate-950/95 overflow-hidden shadow-2xl p-2 select-none flex flex-col justify-between" style="min-height: 520px;">
      
      <div class="absolute inset-0 bg-[linear-gradient(to_right,#06b6d408_1px,transparent_1px),linear-gradient(to_bottom,#06b6d408_1px,transparent_1px)] bg-[size:1.2rem_1.2rem] pointer-events-none"></div>
      <div class="absolute inset-x-6 top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80 animate-pulse pointer-events-none"></div>

      <!-- 四角 HUD 標記 -->
      <div class="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-400/80 pointer-events-none"></div>
      <div class="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-400/80 pointer-events-none"></div>
      <div class="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-400/80 pointer-events-none"></div>
      <div class="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-400/80 pointer-events-none"></div>

      <!-- 左上角 HUD 階級界定規則面板 -->
      <div class="relative z-10 flex justify-between items-center px-1.5 pt-0.5 pb-1 border-b border-slate-800/80 text-[9px] font-mono">
        <div class="flex items-center gap-1.5">
          <span class="text-cyan-400 font-bold">階級界定:</span>
          <span class="bg-gradient-to-r from-pink-400 to-yellow-300 bg-clip-text text-transparent font-bold">神域 94+</span><span>•</span>
          <span class="text-amber-400 font-bold">精英 88+</span><span>•</span>
          <span class="text-slate-200 font-bold">頂尖 80+</span><span>•</span>
          <span class="text-orange-400">強者 70+</span><span>•</span>
          <span class="text-cyan-400">銳進 60+</span>
        </div>
        <span class="text-slate-500 hidden sm:inline">>14天未練生理衰退</span>
      </div>

      <!-- 手機直屏 HUD：左欄 (22%) | 3D 人體畫布 (56%) | 右欄 (22%) -->
      <div class="relative z-10 flex items-center justify-between gap-1 my-auto py-1 w-full">
        
        <!-- 左側資訊卡欄 -->
        <div class="w-[22%] flex flex-col gap-2.5 flex-shrink-0">
          ${leftMuscles.map(m => renderCard(m, false)).join('')}
        </div>

        <!-- 中間 3D 視窗 -->
        <div onclick="event.stopPropagation()" class="w-[56%] flex flex-col items-center justify-center mx-auto relative">
          
          <div class="w-full h-80 sm:h-96 relative flex items-center justify-center cursor-grab active:cursor-grabbing">
            <div id="threeCanvasContainer" class="w-full h-full flex items-center justify-center"></div>
            
            <!-- 全息重設視點按鈕 -->
            <button type="button" 
                    onclick="event.stopPropagation(); window.twinMod.resetCameraView()" 
                    title="重歸正面視點" 
                    class="absolute top-0 right-0 w-8 h-8 rounded-xl bg-slate-900/85 hover:bg-cyan-950 border border-cyan-500/50 hover:border-cyan-400 text-cyan-300 transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.35)] flex items-center justify-center active:scale-90 group backdrop-blur-md z-20">
              <svg class="w-4 h-4 group-hover:rotate-180 transition-transform duration-500 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
            </button>
          </div>

          <!-- 人體正下方：個人封號徽章 -->
          <div class="w-full mt-1 px-2 py-1.5 rounded-xl border backdrop-blur-md flex flex-col items-center justify-center text-center transition-all ${overall.badgeStyle}">
            <div class="flex items-center gap-1.5 leading-none mb-0.5">
              <span class="text-[9px] font-mono tracking-widest uppercase opacity-85">${overall.tier}</span>
              <span class="text-[9px] font-mono font-bold text-cyan-300">★ 總合戰力 ${overall.overallScore}</span>
            </div>
            <span class="text-xs sm:text-sm font-black tracking-wider ${overall.textGradient} drop-shadow-[0_0_10px_rgba(255,255,255,0.3)] truncate max-w-full px-1">
              ${overall.title}
            </span>
          </div>

        </div>

        <!-- 右側資訊卡欄 -->
        <div class="w-[22%] flex flex-col gap-2.5 flex-shrink-0">
          ${rightMuscles.map(m => renderCard(m, true)).join('')}
        </div>

      </div>

      <!-- 底部就地資訊列 -->
      <div onclick="event.stopPropagation()" id="twinBottomInfoBar" class="relative z-10 min-h-[36px] flex items-center justify-between"></div>

    </div>
  `;
}

const twinExports = {
  initTwinView,
  calculateMuscleScores,
  calculateOverallTitle,
  renderTwinInterface,
  toggleSelectMuscle,
  resetSelection,
  resetCameraView
};

window.twinMod = twinExports;
Object.assign(window, twinExports);
