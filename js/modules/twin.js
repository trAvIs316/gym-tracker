// js/modules/twin.js - 3D Digital Twin 模組 (正面0度對齊 + 對稱解剖座標校準 + 呼吸同步著色)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { AppState, ALL_MUSCLE_ITEMS } from '../config.js';

let scene, camera, renderer, controls;
let pivotGroup = null;
let humanModel = null;
let mixer = null;
let activeSelectedMuscle = null;
let animationFrameId = null;
let customShaderMaterials = [];
let clock = new THREE.Clock();

// 🎯 修正為 0：保持模型原始正面朝向鏡頭，同時讓 X軸(左右) 與 Z軸(前後) 100% 恢復對稱！
const MODEL_FACING_ROTATION_Y = 0;

// 動態測量的模型真實世界邊界
let modelBoundsData = {
  minY: -0.75,
  maxY: 0.75,
  height: 1.50,
  maxAbsX: 0.45
};

// 預設最佳視角
const DEFAULT_VIEW = {
  camPos: new THREE.Vector3(0, 0.0, 2.35),
  target: new THREE.Vector3(0, 0.0, 0)
};

// 🎯 校準後的對稱解剖百分比 (0.0 = 腳底, 1.0 = 頭頂；xRatio: 0.0 = 脊椎中線, 1.0 = 手指最外側)

const MUSCLE_PERCENT_BOUNDS = {
  '胸': { yMinPct: 0.65, yMaxPct: 0.83, zMin: 0.01, zMax: 5.0, xMinRatio: 0.00, xMaxRatio: 0.36, color: new THREE.Color(0x22d3ee) },
  '背': { yMinPct: 0.58, yMaxPct: 0.85, zMin: -5.0, zMax: -0.01, xMinRatio: 0.00, xMaxRatio: 0.38, color: new THREE.Color(0xa78bfa) },
  '腹': { yMinPct: 0.46, yMaxPct: 0.63, zMin: 0.01, zMax: 5.0, xMinRatio: 0.00, xMaxRatio: 0.25, color: new THREE.Color(0x06b6d4) },
  '膊': { yMinPct: 0.75, yMaxPct: 0.90, zMin: -5.0, zMax: 5.0, xMinRatio: 0.34, xMaxRatio: 0.62, color: new THREE.Color(0x38bdf8) },
  '二頭': { yMinPct: 0.70, yMaxPct: 0.85, zMin: -1, zMax: -0.01, xMinRatio: 0.35, xMaxRatio: 0.75, color: new THREE.Color(0x22d3ee) }, // 👈 上移至上手臂前側
  '三頭': { yMinPct: 0.70, yMaxPct: 0.85, zMin: -5.0, zMax: -0.01, xMinRatio: 0.35, xMaxRatio: 0.75, color: new THREE.Color(0xa78bfa) }, // 👈 上移至上手臂後側
  '腳': { yMinPct: 0.00, yMaxPct: 0.48, zMin: -5.0, zMax: 5.0, xMinRatio: 0.00, xMaxRatio: 0.65, color: new THREE.Color(0x3b82f6) },
  '帶氧': { yMinPct: -1.0, yMaxPct: 2.0, zMin: -10.0, zMax: 10.0, xMinRatio: 0.0, xMaxRatio: 2.0, color: new THREE.Color(0x10b981), isWholeBody: true }
};

export function initTwinView() {
  try {
    activeSelectedMuscle = null;
    renderTwinInterface();
    setTimeout(initThreeScene, 60);
  } catch (err) {
    console.error("Twin 初始化異常:", err);
  }
}

function safeGetUserWeight() {
  try {
    const storedKg = parseFloat(localStorage.getItem('gym_user_weight_kg'));
    return (!isNaN(storedKg) && storedKg > 0) ? storedKg : 70.8;
  } catch (_) {
    return 70.8;
  }
}

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
    scores[m] = { score: 40, best1RM: 0, ratio: 0, status: '未有紀錄', bestLoadText: '--', daysAgo: 99 };
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

    let decayFactor = 1.0;
    if (daysAgo > 14) {
      const extraDays = daysAgo - 14;
      decayFactor = 1.0 - Math.min(0.25, extraDays * 0.007);
    }

    const finalScore = Math.round(baseScore * decayFactor);
    scores[m].score = finalScore;
    scores[m].status = `${scores[m].ratio}x 推比`; });  
	return scores; 
	}  
	
export function calculateOverallTitle(scores) {
  const weights = { '腳': 0.25, '胸': 0.20, '背': 0.20, '膊': 0.12, '二頭': 0.08, '三頭': 0.08, '腹': 0.07 };
  let totalWeightedScore = 0;
  let totalW = 0;
  let minDaysAgo = 99;
  let maxDaysAgo = 0;

  // 計算綜合戰力及找出最近/最久遠的操練日數
  Object.keys(weights).forEach(m => {
    const s = scores && scores[m] ? scores[m].score : 40;
    const w = weights[m];
    totalWeightedScore += s * w;
    totalW += w;
    const dAgo = scores && scores[m] ? scores[m].daysAgo : 99;
    if (dAgo < minDaysAgo) minDaysAgo = dAgo;
    if (dAgo < 90 && dAgo > maxDaysAgo) maxDaysAgo = dAgo;
  });

  const overallScore = totalW > 0 ? Math.round(totalWeightedScore / totalW) : 40;

  // 🎮 狀態與動態稱號判定引擎 (優先級由高至低)
  let specialPrefix = '';

  if (minDaysAgo === 0 && maxDaysAgo >= 14) {
    specialPrefix = '沉睡甦醒・破封而出的巨獸'; // 久休復出 (今日剛練)
  } 
  else if (minDaysAgo === 0 && maxDaysAgo >= 3 && maxDaysAgo < 14) {
    specialPrefix = '浴火重生・跨越極限的不死鳥'; // 大病初癒 (今日剛練)
  } 
  // 🆕 新增：正在停訓 / 生病休養中的狀態 (今日無練，且最近一次操練已是 3-13 天前)
  else if (minDaysAgo >= 3 && minDaysAgo < 14) {
    specialPrefix = '閉關休養・正在蓄力的小休期'; 
  }
  else if (minDaysAgo >= 14) {
    specialPrefix = '長期沈睡・等待喚醒的封印'; 
  }

  // 基礎戰力階級與稱號配置
  let title = '鍛鍊原石';
  let tier = '起點級';
  let badgeStyle = '';
  let textInlineStyle = '';
  let scoreColorStyle = '';

  if (overallScore >= 94) {
    title = specialPrefix ? `${specialPrefix}` : '終焉的破壞神・絕對強者';
    tier = '神域級';
    scoreColorStyle = 'background: linear-gradient(90deg, #ff007f, #ffff00, #00f0ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent;';
    textInlineStyle = 'background: linear-gradient(90deg, #ff007f, #ff7f00, #ffff00, #00ff7f, #00f0ff, #7f00ff, #ff007f); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 15px rgba(255,127,0,0.4);';
    badgeStyle = 'border-pink-500/60 bg-gradient-to-r from-purple-950/40 via-cyan-950/40 to-pink-950/40 shadow-[0_0_22px_rgba(244,114,182,0.5)]';
  } else if (overallScore >= 88) {
    title = specialPrefix ? `${specialPrefix}` : '超越極限的・金屬霸王';
    tier = '精英級';
    scoreColorStyle = 'color: #fbbf24; text-shadow: 0 0 12px rgba(251,191,36,0.6);';
    textInlineStyle = 'background: linear-gradient(90deg, #fef08a, #f59e0b, #d97706); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 12px rgba(251,191,36,0.5);';
    badgeStyle = 'border-amber-400/60 bg-amber-950/40 shadow-[0_0_18px_rgba(251,191,36,0.4)]';
  } else if (overallScore >= 80) {
    title = specialPrefix ? `${specialPrefix}` : '千錘百煉的・深淵狂戰士';
    tier = '頂尖級';
    scoreColorStyle = 'color: #f1f5f9; text-shadow: 0 0 10px rgba(241,245,249,0.5);';
    textInlineStyle = 'background: linear-gradient(90deg, #ffffff, #e2e8f0, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 10px rgba(226,232,240,0.4);';
    badgeStyle = 'border-slate-300/60 bg-slate-900/60 shadow-[0_0_15px_rgba(226,232,240,0.35)]';
  } else if (overallScore >= 70) {
    title = specialPrefix ? `${specialPrefix}` : '突破界限的・鋼鐵格鬥家';
    tier = '強者級';
    scoreColorStyle = 'color: #fb923c; text-shadow: 0 0 10px rgba(251,146,60,0.5);';
    textInlineStyle = 'background: linear-gradient(90deg, #fed7aa, #f97316, #c2410c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 10px rgba(249,115,22,0.4);';
    badgeStyle = 'border-orange-500/50 bg-orange-950/40 shadow-[0_0_14px_rgba(249,115,22,0.3)]';
  } else if (overallScore >= 60) {
    title = specialPrefix ? `${specialPrefix}` : '覺醒之姿的・超新星';
    tier = '銳進級';
    scoreColorStyle = 'color: #38bdf8;';
    textInlineStyle = 'color: #38bdf8; text-shadow: 0 0 8px rgba(56,189,248,0.5);';
    badgeStyle = 'border-cyan-500/40 bg-cyan-950/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]';
  } else {
    title = specialPrefix ? `${specialPrefix}` : '蓄勢待發的・鍛鍊原石';
    tier = '初階級';
    scoreColorStyle = 'color: #94a3b8;';
    textInlineStyle = 'color: #94a3b8;';
    badgeStyle = 'border-slate-800 bg-slate-950/60';
  }

  return { overallScore, title, tier, badgeStyle, textInlineStyle, scoreColorStyle };
}

function initThreeScene() {
  const canvasContainer = document.getElementById('threeCanvasContainer');
  if (!canvasContainer) return;

  canvasContainer.innerHTML = "";
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  customShaderMaterials = [];
  clock = new THREE.Clock();

  const width = canvasContainer.clientWidth || 240;
  const height = canvasContainer.clientHeight || 360;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 100);
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
  controls.minDistance = 0.5;
  controls.maxDistance = 15.0;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.minPolarAngle = Math.PI * 0.15;
  controls.target.copy(DEFAULT_VIEW.target);
  controls.update();

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

// 著色器：扣除呼吸位移，維持對稱世界座標判定
function createCyberGlowShaderMaterial() {
  const uniforms = {
    baseColor: { value: new THREE.Color(0x06b6d4) },
    glowColor: { value: new THREE.Color(0x22d3ee) },
    highlightActive: { value: 0.0 },
    isWholeBody: { value: 0.0 },
    modelMinY: { value: modelBoundsData.minY },
    modelHeight: { value: modelBoundsData.height },
    modelMaxAbsX: { value: modelBoundsData.maxAbsX },
    breathOffset: { value: 0.0 },
    yMinPct: { value: -1.0 },
    yMaxPct: { value: 2.0 },
    zMin: { value: -10.0 },
    zMax: { value: 10.0 },
    xMinRatio: { value: 0.0 },
    xMaxRatio: { value: 2.0 },
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
    uniform float modelMinY;
    uniform float modelHeight;
    uniform float modelMaxAbsX;
    uniform float breathOffset;
    uniform float yMinPct;
    uniform float yMaxPct;
    uniform float zMin;
    uniform float zMax;
    uniform float xMinRatio;
    uniform float xMaxRatio;
    uniform float time;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      float staticY = vWorldPosition.y - breathOffset;
      float yPct = clamp((staticY - modelMinY) / max(modelHeight, 0.001), 0.0, 1.0);
      float xRatio = abs(vWorldPosition.x) / max(modelMaxAbsX, 0.001);

      bool inY = (yPct >= yMinPct && yPct <= yMaxPct);
      bool inZ = (vWorldPosition.z >= zMin && vWorldPosition.z <= zMax);
      bool inX = (xRatio >= xMinRatio && xRatio <= xMaxRatio);

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

      pivotGroup = new THREE.Group();
      pivotGroup.position.set(0, 0, 0);
      scene.add(pivotGroup);

      // 保持 0 度正面向前
      humanModel.position.set(0, 0, 0);
      humanModel.rotation.set(0, MODEL_FACING_ROTATION_Y, 0);
      humanModel.scale.set(1, 1, 1);
      humanModel.updateMatrixWorld(true);

      const rawBox = new THREE.Box3().setFromObject(humanModel);
      const rawSize = rawBox.getSize(new THREE.Vector3());

      const targetHeight = 1.50;
      const scaleFactor = targetHeight / Math.max(rawSize.y, 0.001);
      humanModel.scale.setScalar(scaleFactor);
      humanModel.updateMatrixWorld(true);

      const scaledBox = new THREE.Box3().setFromObject(humanModel);
      const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

      humanModel.position.x = -scaledCenter.x;
      humanModel.position.y = -scaledCenter.y;
      humanModel.position.z = -scaledCenter.z;
      humanModel.updateMatrixWorld(true);

      pivotGroup.add(humanModel);
      pivotGroup.updateMatrixWorld(true);

      const finalBox = new THREE.Box3().setFromObject(pivotGroup);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      modelBoundsData.minY = finalBox.min.y;
      modelBoundsData.maxY = finalBox.max.y;
      modelBoundsData.height = Math.max(0.1, finalSize.y);
      modelBoundsData.maxAbsX = Math.max(0.1, finalSize.x * 0.5);

      humanModel.traverse((child) => {
        if (child.isMesh) {
          const mat = createCyberGlowShaderMaterial();
          mat.uniforms.modelMinY.value = modelBoundsData.minY;
          mat.uniforms.modelHeight.value = modelBoundsData.height;
          mat.uniforms.modelMaxAbsX.value = modelBoundsData.maxAbsX;
          child.material = mat;
        }
      });

      const fovRad = THREE.MathUtils.degToRad(camera.fov);
      const idealDistance = (modelBoundsData.height * 0.5) / Math.tan(fovRad * 0.5) * 1.22;
      DEFAULT_VIEW.camPos.set(0, 0, idealDistance);
      DEFAULT_VIEW.target.set(0, 0, 0);

      resetCameraView();
    },
    undefined,
    () => {
      generateProceduralCyberBody();
    }
  );
}

function generateProceduralCyberBody() {
  pivotGroup = new THREE.Group();
  humanModel = new THREE.Group();

  modelBoundsData.minY = -0.75;
  modelBoundsData.maxY = 0.75;
  modelBoundsData.height = 1.50;
  modelBoundsData.maxAbsX = 0.35;

  const parts = [
    { geo: new THREE.BoxGeometry(0.40, 0.26, 0.18), pos: [0, 0.35, 0] },
    { geo: new THREE.BoxGeometry(0.32, 0.28, 0.15), pos: [0, 0.05, 0] },
    { geo: new THREE.BoxGeometry(0.40, 0.36, 0.12), pos: [0, 0.32, -0.05] },
    { geo: new THREE.SphereGeometry(0.10, 16, 16), pos: [-0.28, 0.42, 0] },
    { geo: new THREE.SphereGeometry(0.10, 16, 16), pos: [0.28, 0.42, 0] },
    { geo: new THREE.CylinderGeometry(0.06, 0.05, 0.26, 16), pos: [-0.30, 0.20, 0] },
    { geo: new THREE.CylinderGeometry(0.06, 0.05, 0.26, 16), pos: [0.30, 0.20, 0] },
    { geo: new THREE.CylinderGeometry(0.10, 0.07, 0.60, 16), pos: [-0.14, -0.40, 0] },
    { geo: new THREE.CylinderGeometry(0.10, 0.07, 0.60, 16), pos: [0.14, -0.40, 0] }
  ];

  parts.forEach(p => {
    const mat = createCyberGlowShaderMaterial();
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.position.set(...p.pos);
    humanModel.add(mesh);
  });

  const headGeo = new THREE.SphereGeometry(0.12, 20, 20);
  const headMesh = new THREE.Mesh(headGeo, createCyberGlowShaderMaterial());
  headMesh.position.set(0, 0.63, 0);
  humanModel.add(headMesh);

  pivotGroup.add(humanModel);
  scene.add(pivotGroup);
  resetCameraView();
}

function animate(timestamp) {
  animationFrameId = requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (controls) controls.update();

  let currentBreathOffset = 0.0;
  if (mixer) {
    mixer.update(delta);
  } else if (pivotGroup) {
    const breath = Math.sin((timestamp || 0) * 0.0025);
    currentBreathOffset = breath * 0.015;
    pivotGroup.position.y = currentBreathOffset;
  }

  const timeVal = (timestamp || 0) * 0.001;
  customShaderMaterials.forEach(m => {
    if (m.uniforms) {
      m.uniforms.time.value = timeVal;
      m.uniforms.breathOffset.value = currentBreathOffset;
    }
  });

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

export function resetCameraView() {
  if (camera && controls) {
    camera.position.copy(DEFAULT_VIEW.camPos);
    controls.target.copy(DEFAULT_VIEW.target);
    camera.lookAt(DEFAULT_VIEW.target);
    controls.update();
  }
}

export function toggleSelectMuscle(muscle) {
  activeSelectedMuscle = (activeSelectedMuscle === muscle) ? null : muscle;
  const config = activeSelectedMuscle ? MUSCLE_PERCENT_BOUNDS[activeSelectedMuscle] : null;

  customShaderMaterials.forEach(mat => {
    if (!mat.uniforms) return;
    if (config) {
      mat.uniforms.highlightActive.value = 1.0;
      mat.uniforms.isWholeBody.value = config.isWholeBody ? 1.0 : 0.0;
      mat.uniforms.glowColor.value.copy(config.color);
      mat.uniforms.yMinPct.value = config.yMinPct !== undefined ? config.yMinPct : -1.0;
      mat.uniforms.yMaxPct.value = config.yMaxPct !== undefined ? config.yMaxPct : 2.0;
      mat.uniforms.zMin.value = config.zMin !== undefined ? config.zMin : -10.0;
      mat.uniforms.zMax.value = config.maxZ !== undefined ? config.maxZ : 10.0;
      mat.uniforms.xMinRatio.value = config.xMinRatio !== undefined ? config.xMinRatio : 0.0;
      mat.uniforms.xMaxRatio.value = config.xMaxRatio !== undefined ? config.xMaxRatio : 2.0;
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

    cardEl.className = `p-2 sm:p-2.5 rounded-xl border backdrop-blur-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-1.5 ${
      isSelected
        ? 'border-cyan-400 bg-cyan-950/80 shadow-[0_0_15px_rgba(6,182,212,0.6)] scale-[1.04]'
        : isDimmed
          ? 'border-slate-800/40 bg-slate-950/20 opacity-30'
          : 'border-slate-800/80 bg-slate-900/60 hover:border-slate-700'
    }`;
  });

  const bottomBar = document.getElementById('twinBottomInfoBar');
  if (bottomBar) {
    if (activeSelectedMuscle) {
      const info = scores[activeSelectedMuscle] || { best1RM: 0, ratio: 0, bestLoadText: '--', daysAgo: 0 };
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

  const getScoreStyle = (score) => {
    if (score >= 94) {
      return 'background: linear-gradient(90deg, #ff007f, #ff7f00, #ffff00, #00ff7f, #00f0ff, #7f00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 900;';
    }
    if (score >= 88) return 'color: #fbbf24; text-shadow: 0 0 10px rgba(251,191,36,0.6);';
    if (score >= 80) return 'color: #f1f5f9; text-shadow: 0 0 8px rgba(241,245,249,0.5);';
    if (score >= 70) return 'color: #fb923c; text-shadow: 0 0 8px rgba(251,146,60,0.5);';
    if (score >= 60) return 'color: #38bdf8;';
    return 'color: #94a3b8;';
  };

  const renderCard = (m) => {
    const item = scores[m] || { score: 40 };
    const scoreStyle = getScoreStyle(item.score);

    return `
      <div id="twin-card-${m}" onclick="event.stopPropagation(); window.twinMod.toggleSelectMuscle('${m}')"
           class="p-2 sm:p-2.5 rounded-xl border border-slate-800/80 bg-slate-900/60 hover:border-slate-700 backdrop-blur-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-1.5">
        <span class="text-sm font-bold text-white block truncate leading-none">${m}</span>
        <span class="text-lg font-black font-mono leading-none tracking-tight" style="${scoreStyle}">${item.score}</span>
      </div>
    `;
  };

  container.innerHTML = `
    <!-- 全景科技掃描背景容器 -->
    <div onclick="window.twinMod.resetSelection()" class="relative w-full rounded-2xl border border-cyan-500/30 bg-slate-950/95 overflow-hidden shadow-2xl p-2.5 sm:p-3 select-none flex flex-col justify-between" style="min-height: 540px;">
      
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
          <span style="background: linear-gradient(90deg, #ff007f, #ffff00, #00f0ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800;">神域 94+</span><span>•</span>
          <span class="text-amber-400 font-bold">精英 88+</span><span>•</span>
          <span class="text-slate-200 font-bold">頂尖 80+</span><span>•</span>
          <span class="text-orange-400">強者 70+</span><span>•</span>
          <span class="text-cyan-400">銳進 60+</span>
        </div>
        <span class="text-slate-500 hidden sm:inline">>14天未練生理衰退</span>
      </div>

      <!-- 手機直屏 HUD：左欄 (23%) | 3D 人體畫布 (54%) | 右欄 (23%) -->
      <div class="relative z-10 flex items-center justify-between gap-1 sm:gap-2 my-auto py-1 w-full">
        
        <!-- 左側資訊卡欄 (先部位、後分數) -->
        <div class="w-[23%] flex flex-col gap-2.5 flex-shrink-0">
          ${leftMuscles.map(m => renderCard(m)).join('')}
        </div>

        <!-- 中間 3D 視窗 (垂直與水平完全居中) -->
        <div onclick="event.stopPropagation()" class="w-[54%] flex flex-col items-center justify-center mx-auto relative">
          
          <div class="w-full h-84 sm:h-96 relative flex items-center justify-center cursor-grab active:cursor-grabbing">
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

          <!-- 🏆 人體正下方：四層縱向霸氣戰力徽章 (保留你自訂的 4 行字體排版) -->
          <div class="w-full mt-1 px-2 py-2 rounded-xl border backdrop-blur-md flex flex-col items-center justify-center text-center transition-all ${overall.badgeStyle}">
            
            <!-- 第 1 行：*綜合戰力* -->
            <span class="text-[12px] font-mono tracking-widest text-slate-400 uppercase leading-none mb-1">
              *綜合戰力*
            </span>

            <!-- 第 2 行：［分數］- 置中、大字、霓虹高亮 -->
            <div class="flex items-center justify-center gap-1 leading-none my-0.5">
              <span class="text-xs font-mono text-cyan-400/80"></span>
              <span class="text-2xl sm:text-3xl font-black font-mono tracking-tight" style="${overall.scoreColorStyle}">
                ${overall.overallScore}
              </span>
              <span class="text-xs font-mono text-cyan-400/80"></span>
            </div>

            <!-- 第 3 行：《級別》 -->
            <span class="text-xs sm:text-sm font-black tracking-wider truncate max-w-full px-1 mt-0.5 leading-snug" style="${overall.textInlineStyle}">
              《 ${overall.tier} 》
            </span>

            <!-- 第 4 行：霸氣封號 -->
<span class="text-[11px] sm:text-xs font-black tracking-wider whitespace-normal break-words w-full px-3 mt-1 leading-tight" style="${overall.textInlineStyle}">
  ${overall.title}
</span>

          </div>

        </div>

        <!-- 右側資訊卡欄 (先部位、後分數) -->
        <div class="w-[23%] flex flex-col gap-2.5 flex-shrink-0">
          ${rightMuscles.map(m => renderCard(m)).join('')}
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
