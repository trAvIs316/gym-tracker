// js/modules/tracker.js - 完整訓練、計時、呼吸燈、拍照、帶氧與組數管理模組
import { CONFIG, ACTIVE_SESSION_KEY, ALL_MUSCLE_ITEMS, AppState } from '../config.js';
import { sendGasRequest, getGymApiKey } from '../api.js';
import {
  escapeHtml,
  getUserWeight,
  normalizeDateStr,
  isCardioEquipment,
  calculateCardioCalories,
  calculateStrengthCalories,
  compressImageToBase64
} from '../utils.js';
import { populateAiMachineSelector } from './ai.js';

let totalWorkoutTimerInterval = null;
let machineTimerInterval = null;
let backgroundTimerInterval = null;
let targetModalMachine = "";
let tempModalImgBase64 = "";
let editingSideTemp = "Both";

export function initTrackerView() {
  initCurrentDate();

  const cached = localStorage.getItem('gym_custom_machines_meta');
  if (cached) {
    try { AppState.customMachineSettings = JSON.parse(cached); } catch (e) {}
  }

  renderMuscleButtons();

  const hasKey = !!getGymApiKey();
  if (hasKey) {
    loadLocalHistoryToCache();
    silentSyncGoogleSheetHistory();
  } else {
    AppState.historicalWorkouts = {};
  }

  refreshActiveEquipmentList();
  renderCompletedMachinesList();
  renderWorkoutTimelineUI();

  restoreActiveSession();
  if (hasKey) {
    fetchMachineSettingsFromSheets();
  }

  bindTrackerEvents();
  updateLogSetButtonState();
  populateAiMachineSelector();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && AppState.isWorkoutStarted && !AppState.isWorkoutEnded) {
      updateLiveWorkoutTimeDisplay();
      if (AppState.isMachineActive && AppState.machineStartEpoch) updateMachineTimerDisplay();
    }
  });
}

function updateFinishWorkoutButtonUI() {
  const finishBtn = document.getElementById('btnFinishWorkout');
  if (!finishBtn) return;

  if (AppState.isWorkoutEnded) {
    finishBtn.className = "bg-slate-800 text-slate-500 border border-slate-700/50 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 whitespace-nowrap cursor-not-allowed opacity-50";
  } else if (!AppState.isWorkoutStarted) {
    // 未開始：淡暗紅色、提示不可按
    finishBtn.className = "bg-rose-950/40 text-rose-400/40 border border-rose-900/30 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 whitespace-nowrap cursor-not-allowed";
  } else {
    // 訓練進行中 (無論是運行中或暫停中)：鮮豔紅色、完全可點擊
    finishBtn.className = "bg-rose-600 hover:bg-rose-500 active:scale-95 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-950/40 flex items-center gap-1 whitespace-nowrap cursor-pointer";
  }
}

function initCurrentDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateEl = document.getElementById('displayDate');
  if (dateEl) dateEl.innerText = `${yyyy}-${mm}-${dd}`;

  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const dayEl = document.getElementById('displayDayName');
  if (dayEl) dayEl.innerText = `週${days[now.getDay()]}`;
}

export function persistActiveSession() {
  if (!AppState.isWorkoutStarted || AppState.isWorkoutEnded) return;
  const startTimeStamp = document.getElementById('startTimeStamp');
  const sessionData = {
    date: document.getElementById('displayDate').innerText,
    isWorkoutStarted: AppState.isWorkoutStarted,
    isWorkoutPaused: AppState.isWorkoutPaused,
    isWorkoutEnded: AppState.isWorkoutEnded,
    startTime: startTimeStamp ? startTimeStamp.innerText : "--:--:--",
    workoutStartEpoch: AppState.workoutStartEpoch,
    pausedDurationMs: AppState.pausedDurationMs,
    pauseStartEpoch: AppState.pauseStartEpoch,
    currentMuscleGroup: AppState.currentMuscleGroup,
    currentSelectedMachine: AppState.currentSelectedMachine,
    currentSelectedSide: AppState.currentSelectedSide,
    currentUnit: AppState.currentUnit,
    logs: AppState.workoutLogs,
    machineProgress: AppState.machineProgress,
    timelineEvents: AppState.timelineEvents,
    isMachineActive: AppState.isMachineActive,
    machineStartEpoch: AppState.machineStartEpoch,
    lastSetLogEpoch: AppState.lastSetLogEpoch,
    currentSetStartEpoch: AppState.currentSetStartEpoch,
    machinePausedMs: AppState.machinePausedMs,
    setPausedMs: AppState.setPausedMs
  };
  localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(sessionData));
}

function restoreActiveSession() {
  const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
  if (!raw) return;
  try {
    const session = JSON.parse(raw);
    const todayStr = document.getElementById('displayDate').innerText;

    if (session.isWorkoutEnded) {
      clearActiveSession();
      return;
    }

    if (session.isWorkoutStarted && session.date === todayStr) {
      AppState.isWorkoutStarted = true;
      AppState.isWorkoutPaused = !!session.isWorkoutPaused;
      AppState.isWorkoutEnded = false;
      const startTimeStamp = document.getElementById('startTimeStamp');
      if (startTimeStamp) startTimeStamp.innerText = session.startTime || "--:--:--";
      AppState.workoutStartEpoch = session.workoutStartEpoch || Date.now();
      AppState.pausedDurationMs = session.pausedDurationMs || 0;
      AppState.pauseStartEpoch = session.pauseStartEpoch || null;

      if (session.currentMuscleGroup) {
        AppState.currentMuscleGroup = session.currentMuscleGroup === "操胸" ? "胸" : session.currentMuscleGroup;
      }

      AppState.currentSelectedSide = session.currentSelectedSide || 'L';
      AppState.workoutLogs = session.logs || [];
      AppState.machineProgress = session.machineProgress || {};
      AppState.timelineEvents = session.timelineEvents || [];
      AppState.isMachineActive = !!session.isMachineActive;
      AppState.machineStartEpoch = session.machineStartEpoch || null;
      AppState.lastSetLogEpoch = session.lastSetLogEpoch || null;
      AppState.currentSetStartEpoch = session.currentSetStartEpoch || null;
      AppState.machinePausedMs = session.machinePausedMs || 0;
      AppState.setPausedMs = session.setPausedMs || 0;

      if (session.currentUnit) {
        setUnit(session.currentUnit, false);
      }

      const btnStartWorkout = document.getElementById('btnStartWorkout');
      const btnPauseWorkout = document.getElementById('btnPauseWorkout');
      btnStartWorkout?.classList.add('hidden');
      btnPauseWorkout?.classList.remove('hidden');

      if (AppState.isWorkoutPaused) {
        if (btnPauseWorkout) {
          btnPauseWorkout.innerText = "繼續";
          btnPauseWorkout.className = "bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-2.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/40";
        }
        document.getElementById('totalWorkoutTimer')?.classList.replace('text-emerald-400', 'text-amber-400');
      } else {
        startWorkoutTimerLoop();
        startBackgroundIndicator();
      }

      updateLiveWorkoutTimeDisplay();
      renderMuscleButtons();
      refreshActiveEquipmentList();
      if (session.currentSelectedMachine) selectMachine(session.currentSelectedMachine);

      if (AppState.isMachineActive && AppState.machineStartEpoch) {
        const btnToggleMachine = document.getElementById('btnToggleMachine');
        const btnToggleMachineText = document.getElementById('btnToggleMachineText');
        if (btnToggleMachineText) btnToggleMachineText.innerText = "結束此機";
        if (btnToggleMachine) {
          btnToggleMachine.className = "flex-1 w-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white rounded-xl font-bold text-xs shadow-md transition-all flex flex-col items-center justify-center p-2 gap-1 min-h-[90px] animate-pulse";
        }
        updateMachineTimerDisplay();
        clearInterval(machineTimerInterval);
        machineTimerInterval = setInterval(updateMachineTimerDisplay, 1000);
      }

      updateLogSetButtonState();
      renderCompletedMachinesList();
      renderWorkoutTimelineUI();
    }
  } catch (e) {
    console.error("還原失敗:", e);
  }
}

function clearActiveSession() {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

export async function fetchMachineSettingsFromSheets() {
  const curKey = getGymApiKey();
  if (!curKey) return;

  try {
    const res = await fetch(`${CONFIG.GAS_WEBAPP_URL}?apiKey=${encodeURIComponent(curKey)}`);
    const data = await res.json();
    if (data.status === "success" && data.machines && data.machines.length > 0) {
      data.machines.forEach(m => {
        const mGroup = m.muscle_group === "操胸" ? "胸" : m.muscle_group;
        AppState.customMachineSettings[m.machine_name] = {
          machine_id: m.machine_id || "",
          muscle_group: mGroup,
          image_url: m.image_url || "",
          seat: m.seat || "",
          handle: m.handle || "",
          backrest: m.backrest || "",
          default_speed: m.default_speed || "",
          default_incline: m.default_incline || "",
          notes: m.notes || "",
          is_unilateral: (m.is_unilateral === true || String(m.is_unilateral).toUpperCase() === "TRUE")
        };
      });
      localStorage.setItem('gym_custom_machines_meta', JSON.stringify(AppState.customMachineSettings));
      refreshActiveEquipmentList();
      populateAiMachineSelector();
    }
  } catch (err) {
    console.warn("無法連線 Sheets API", err);
  }
}

export async function silentSyncGoogleSheetHistory() {
  const curKey = getGymApiKey();
  if (!curKey) return;

  try {
    const res = await fetch(`${CONFIG.GAS_WEBAPP_URL}?action=getAllHistory&apiKey=${encodeURIComponent(curKey)}`);
    const data = await res.json();
    if (data.status === "success" && data.history) {
      const cleanHistory = {};
      for (const [rawDate, val] of Object.entries(data.history)) {
        cleanHistory[normalizeDateStr(rawDate)] = val;
      }
      AppState.historicalWorkouts = Object.assign(AppState.historicalWorkouts, cleanHistory);
      localStorage.setItem('gym_historical_workouts_cache', JSON.stringify(AppState.historicalWorkouts));
      if (data.restDays) {
        AppState.restDaysMap = data.restDays;
        localStorage.setItem('gym_rest_days_cache', JSON.stringify(AppState.restDaysMap));
      }
      if (AppState.currentSelectedMachine) loadMachineHistory(AppState.currentSelectedMachine);
      populateAiMachineSelector();
    }
  } catch (e) {
    console.warn("靜默同步失敗", e);
  }
}

export function loadLocalHistoryToCache() {
  if (!getGymApiKey()) {
    AppState.historicalWorkouts = {};
    return;
  }
  const raw = localStorage.getItem('gym_historical_workouts_cache');
  if (raw) {
    try { AppState.historicalWorkouts = JSON.parse(raw); } catch (e) {}
  }
  const rawRest = localStorage.getItem('gym_rest_days_cache');
  if (rawRest) {
    try { AppState.restDaysMap = JSON.parse(rawRest); } catch (e) {}
  }
  if (AppState.workoutLogs.length > 0) {
    const startTimeStamp = document.getElementById('startTimeStamp');
    const endTimeStamp = document.getElementById('endTimeStamp');
    AppState.historicalWorkouts[normalizeDateStr(document.getElementById('displayDate').innerText)] = {
      muscle_group: AppState.currentMuscleGroup,
      start_time: startTimeStamp ? startTimeStamp.innerText : "--",
      end_time: (endTimeStamp && endTimeStamp.innerText) ? endTimeStamp.innerText : "--",
      total_duration_min: parseFloat((getAccurateElapsedWorkoutSeconds() / 60).toFixed(1)),
      logs: AppState.workoutLogs
    };
  }
}

function saveWorkoutToLocalHistory(summaryPayload) {
  AppState.historicalWorkouts[normalizeDateStr(summaryPayload.date)] = {
    muscle_group: summaryPayload.muscle_group,
    start_time: summaryPayload.start_time,
    end_time: summaryPayload.end_time,
    total_duration_min: parseFloat((summaryPayload.total_duration_sec / 60).toFixed(1)),
    logs: summaryPayload.logs,
    ai_advice: ""
  };
  localStorage.setItem('gym_historical_workouts_cache', JSON.stringify(AppState.historicalWorkouts));
}

function saveMachineHistory(name, weight, reps, unit) {
  localStorage.setItem(`gym_hist_${name}`, JSON.stringify({ weight, reps, unit }));
}

export function renderMuscleButtons() {
  const container = document.getElementById('muscleButtonContainer');
  const label = document.getElementById('activeMuscleLabel');
  if (!container) return;
  if (label) label.innerText = AppState.currentMuscleGroup;

  container.innerHTML = ALL_MUSCLE_ITEMS.map(m => `
    <button type="button" onclick="window.trackerMod.selectMuscleGroup('${m}')"
            class="w-full py-2 rounded-xl text-xs font-bold border transition-all text-center ${
              AppState.currentMuscleGroup === m 
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-950/50 scale-[1.02]' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }">
      ${m}
    </button>
  `).join('');
}

export function selectMuscleGroup(muscleName) {
  if (AppState.isWorkoutEnded || muscleName === AppState.currentMuscleGroup) return;

  if (AppState.isMachineActive && AppState.currentSelectedMachine) {
    if (!confirm(`⚠️ 當前「${AppState.currentSelectedMachine}」正在運行計時中！切換訓練部位將會中斷當前器材。是否確定切換？`)) {
      return;
    }
    resetMachineTimerUI();
  }

  AppState.currentMuscleGroup = muscleName;
  renderMuscleButtons();
  refreshActiveEquipmentList();
  updateLogSetButtonState();
  persistActiveSession();
}

export function refreshActiveEquipmentList() {
  const myMachines = Object.keys(AppState.customMachineSettings).filter(name => {
    const item = AppState.customMachineSettings[name];
    return item && (item.muscle_group === AppState.currentMuscleGroup || !item.muscle_group);
  });

  renderMachineVisualCards(myMachines);

  if (myMachines.length > 0) {
    if (!AppState.currentSelectedMachine || !myMachines.includes(AppState.currentSelectedMachine)) {
      selectMachine(myMachines[0]);
    } else {
      selectMachine(AppState.currentSelectedMachine);
    }
  } else {
    AppState.currentSelectedMachine = "";
    const label = document.getElementById('currentMachineLabel');
    if (label) label.innerText = "未選擇";
    document.getElementById('currentMachineIdBadge')?.classList.add('hidden');
    document.getElementById('currentUnilateralBadge')?.classList.add('hidden');
    updateActiveMachineSettingBanner("");
    toggleCardioModeUI(false);
  }
  populateAiMachineSelector();
}

export function renderMachineVisualCards(machines) {
  const slider = document.getElementById('machineCardsSlider');
  if (!slider) return;

  if (machines.length === 0) {
    slider.innerHTML = `
      <div onclick="window.trackerMod.openAddNewMachineModal()" class="w-full py-5 text-center cursor-pointer border border-dashed border-slate-800 hover:border-emerald-500/50 rounded-2xl bg-slate-950/40 text-slate-500 hover:text-emerald-400 transition-all text-xs flex items-center justify-center gap-1.5">
        <span class="text-base font-bold">+</span>
        <span>此部位尚未有器材，點擊此處拍照/新增器材</span>
      </div>
    `;
    return;
  }

  slider.innerHTML = machines.map(name => {
    const setting = AppState.customMachineSettings[name] || {};
    const hasImg = setting.image_url && setting.image_url.length > 10;
    const safeName = escapeHtml(name);

    return `
      <div class="machine-card relative flex-shrink-0 w-44 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden cursor-pointer transition-all active:scale-95"
           id="card-${encodeURIComponent(name)}"
           onclick="window.trackerMod.selectMachine('${name.replace(/'/g, "\\'")}')">
        <div class="w-full h-32 bg-slate-900/90 flex items-center justify-center overflow-hidden border-b border-slate-800 p-1">
          ${hasImg ? `<img src="${escapeHtml(setting.image_url)}" class="w-full h-full object-contain rounded-lg">` : `<span class="text-3xl">🏋</span>`}
        </div>
        <div class="p-2 text-center">
          <div class="text-xs font-bold text-slate-200 truncate">${safeName}</div>
          <div class="flex items-center justify-center gap-1 mt-1">
            ${setting.machine_id ? `<span class="text-[9px] font-mono text-indigo-400 bg-indigo-950/80 px-1 rounded border border-indigo-800/40">${escapeHtml(setting.machine_id)}</span>` : ''}
            ${setting.is_unilateral ? `<span class="text-[9px] font-bold text-amber-400 bg-amber-950/60 px-1 rounded border border-amber-800/40">單手</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function selectMachine(machineName) {
  if (!machineName || AppState.isWorkoutEnded) return;

  if (AppState.isMachineActive && AppState.currentSelectedMachine && AppState.currentSelectedMachine !== machineName) {
    if (!confirm(`⚠ 當前「${AppState.currentSelectedMachine}」正在計時中！切換將會中斷當前計時。是否確定切換？`)) return;
    resetMachineTimerUI();
  }

  AppState.currentSelectedMachine = machineName;
  const label = document.getElementById('currentMachineLabel');
  if (label) label.innerText = machineName;

  const setting = AppState.customMachineSettings[machineName] || {};
  const idBadge = document.getElementById('currentMachineIdBadge');
  if (idBadge) {
    idBadge.innerText = setting.machine_id || "";
    idBadge.classList.toggle('hidden', !setting.machine_id);
  }

  const uniBadge = document.getElementById('currentUnilateralBadge');
  const sideContainer = document.getElementById('sideSelectorContainer');

  if (setting.is_unilateral) {
    uniBadge?.classList.remove('hidden');
    sideContainer?.classList.remove('hidden');
    selectSide(AppState.currentSelectedSide || 'L');
  } else {
    uniBadge?.classList.add('hidden');
    sideContainer?.classList.add('hidden');
    AppState.currentSelectedSide = 'Both';
  }

  document.querySelectorAll('.machine-card').forEach(c => {
    c.className = "machine-card relative flex-shrink-0 w-44 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden cursor-pointer transition-all active:scale-95";
  });
  const activeCard = document.getElementById(`card-${encodeURIComponent(machineName)}`);
  if (activeCard) {
    activeCard.className = "machine-card relative flex-shrink-0 w-44 bg-indigo-950/40 border-2 border-indigo-500 rounded-2xl overflow-hidden cursor-pointer transition-all shadow-lg shadow-indigo-950/50";
    activeCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  updateActiveMachineSettingBanner(machineName);
  if (!AppState.isMachineActive) resetMachineTimerUI();

  const isCardio = isCardioEquipment(machineName, AppState.currentMuscleGroup);
  toggleCardioModeUI(isCardio);

  if (isCardio) {
    if (setting.default_speed) document.getElementById('inputCardioSpeed').value = setting.default_speed;
    if (setting.default_incline) document.getElementById('inputCardioIncline').value = setting.default_incline;
  }

  const completedSets = AppState.machineProgress[machineName] || 0;
  const prefixEl = document.getElementById('currentSetLabelPrefix');
  if (prefixEl) {
    prefixEl.innerHTML = `第 <span id="currentSetNum" class="text-indigo-400 text-lg">${completedSets + 1}</span> ${isCardio ? '段' : '組'}`;
  }

  loadMachineHistory(machineName);
  updateLogSetButtonState();
  persistActiveSession();

  const aiSelector = document.getElementById('aiMachineSelector');
  if (aiSelector && aiSelector.value !== machineName) {
    aiSelector.value = machineName;
  }
}

export function selectSide(side) {
  AppState.currentSelectedSide = side;
  const btnL = document.getElementById('btnSideL');
  const btnR = document.getElementById('btnSideR');
  if (btnL) {
    btnL.className = side === 'L' 
      ? "py-1.5 rounded-lg text-xs font-bold transition-all bg-indigo-600 text-white shadow"
      : "py-1.5 rounded-lg text-xs font-bold transition-all bg-slate-900 border border-slate-800 text-slate-400 hover:text-white";
  }
  if (btnR) {
    btnR.className = side === 'R' 
      ? "py-1.5 rounded-lg text-xs font-bold transition-all bg-indigo-600 text-white shadow"
      : "py-1.5 rounded-lg text-xs font-bold transition-all bg-slate-900 border border-slate-800 text-slate-400 hover:text-white";
  }
  const lbl = document.getElementById('activeSideLabel');
  if (lbl) lbl.innerText = side === 'L' ? "左手 (Left)" : "右手 (Right)";
  persistActiveSession();
}

function toggleCardioModeUI(isCardio) {
  document.getElementById('weightRepsControlsContainer')?.classList.toggle('hidden', isCardio);
  document.getElementById('cardioControlsContainer')?.classList.toggle('hidden', !isCardio);
  document.getElementById('cardioModeTag')?.classList.toggle('hidden', !isCardio);
  document.getElementById('unitToggleTrack')?.classList.toggle('opacity-0', isCardio);
  document.getElementById('unitToggleTrack')?.classList.toggle('pointer-events-none', isCardio);
  document.getElementById('restStatusBanner')?.classList.toggle('hidden', isCardio);
  updateLogSetButtonState();
}

export function stepCardioValue(type, amount) {
  const el = document.getElementById(type === 'speed' ? 'inputCardioSpeed' : 'inputCardioIncline');
  if (!el) return;
  const next = Math.max(type === 'speed' ? 0.5 : 0, (parseFloat(el.value) || 0) + amount);
  el.value = (Math.round(next * 10) / 10).toFixed(1);
}

export function stepValue(type, amount) {
  const el = document.getElementById(type === 'weight' ? 'inputWeight' : 'inputReps');
  if (!el) return;
  const cur = parseFloat(el.value) || 0;
  el.value = type === 'weight' ? (Math.round(Math.max(0, cur + amount) * 10) / 10) : Math.max(1, cur + amount);
}

export function setUnit(unit, shouldConvert = true) {
  const oldUnit = AppState.currentUnit;
  AppState.currentUnit = unit;
  const unitText = document.getElementById('unitText');
  if (unitText) unitText.innerText = unit;
  const isLb = (unit === 'LB');

  document.getElementById('unitSlider')?.classList.toggle('translate-x-full', isLb);
  document.getElementById('labelLb')?.classList.toggle('text-white', isLb);
  document.getElementById('labelLb')?.classList.toggle('text-slate-400', !isLb);
  document.getElementById('labelKg')?.classList.toggle('text-white', !isLb);
  document.getElementById('labelKg')?.classList.toggle('text-slate-400', isLb);

  const weightInput = document.getElementById('inputWeight');
  if (weightInput && shouldConvert && oldUnit !== unit) {
    const curVal = parseFloat(weightInput.value);
    if (!isNaN(curVal) && curVal > 0) {
      if (unit === 'LB') {
        const converted = curVal * 2.20462262;
        weightInput.value = Math.round(converted * 2) / 2;
      } else {
        const converted = curVal / 2.20462262;
        weightInput.value = Math.round(converted * 2) / 2;
      }
    }
  }
  persistActiveSession();
}

function loadMachineHistory(name) {
  const container = document.getElementById('lastWorkoutSetsContainer');
  const dateBadge = document.getElementById('lastWorkoutDateBadge');
  const daysAgoText = document.getElementById('lastWorkoutDaysAgo');
  if (!name) return;

  if (!getGymApiKey()) {
    if (dateBadge) {
      dateBadge.innerText = "未設定 Key";
      dateBadge.className = "text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800";
    }
    if (daysAgoText) daysAgoText.innerText = "";
    if (container) container.innerHTML = `<span class="text-slate-600 text-[11px] italic">點擊下方「設定」頁面儲存 PIN 碼</span>`;
    return;
  }

  const setting = AppState.customMachineSettings[name] || {};
  const targetId = setting.machine_id || "";
  const isCardio = isCardioEquipment(name, setting.muscle_group);

  let foundDate = null;
  let matchedSets = [];

  if (AppState.historicalWorkouts) {
    const sortedDates = Object.keys(AppState.historicalWorkouts).sort().reverse();
    const todayStr = normalizeDateStr(document.getElementById('displayDate').innerText);

    for (const d of sortedDates) {
      if (d === todayStr && AppState.isWorkoutStarted && !AppState.isWorkoutEnded) continue;

      const dayData = AppState.historicalWorkouts[d];
      if (dayData && dayData.logs && dayData.logs.length > 0) {
        const setsOnDay = dayData.logs.filter(l => l.exercise_name === name || (targetId && l.machine_id === targetId));
        if (setsOnDay.length > 0) {
          foundDate = d;
          matchedSets = setsOnDay;
          break;
        }
      }
    }
  }

  if (!foundDate || matchedSets.length === 0) {
    if (dateBadge) {
      dateBadge.innerText = "全新器材";
      dateBadge.className = "text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800";
    }
    if (daysAgoText) daysAgoText.innerText = "(無歷史)";
    if (container) container.innerHTML = `<span class="text-slate-600 text-[11px] italic">此器材尚未有過往的操練歷史</span>`;
    
    const wEl = document.getElementById('inputWeight');
    const rEl = document.getElementById('inputReps');
    if (wEl) wEl.value = (AppState.currentUnit === 'LB') ? 45 : CONFIG.DEFAULT_WEIGHT_KG;
    if (rEl) rEl.value = CONFIG.DEFAULT_REPS;
    return;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const pastParts = foundDate.split('-');
  const pastDate = new Date(pastParts[0], pastParts[1] - 1, pastParts[2]);
  const diffDays = Math.round((now.getTime() - pastDate.getTime()) / (1000 * 3600 * 24));
  const daysAgoStr = diffDays <= 0 ? "今天" : (diffDays === 1 ? "昨天" : (diffDays === 2 ? "前天" : `${diffDays}日前`));

  if (dateBadge) {
    dateBadge.innerText = `📅 ${foundDate}`;
    dateBadge.className = "text-[11px] font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800/40 font-bold";
  }
  if (daysAgoText) daysAgoText.innerText = `(${daysAgoStr})`;

  if (container) {
    container.innerHTML = matchedSets.map((s, idx) => {
      const setNum = s.set_num || (idx + 1);
      if (isCardio) {
        const dur = s.set_duration_sec || s.duration_sec || 0;
        const m = Math.floor(dur / 60);
        const sec = dur % 60;
        const extra = [s.speed ? `速:${s.speed}` : '', s.incline ? `斜:${s.incline}%` : ''].filter(Boolean).join(' | ');
        const calDisplay = s.calories ? `<span class="text-amber-400 font-bold ml-1">🔥${s.calories}kcal</span>` : '';
        return `
          <div class="inline-flex items-center gap-2 bg-slate-900 border border-sky-900/50 px-2.5 py-1 rounded-lg font-mono text-xs shadow-sm">
            <span class="text-slate-400 font-semibold">第 ${setNum} 段:</span>
            <span class="text-sky-300 font-bold">${m > 0 ? m + '分' : ''}${sec}秒</span>
            <span class="text-sky-400/80 text-[11px]">${escapeHtml(extra)}</span>
            ${calDisplay}
          </div>
        `;
      } else {
        const sideTag = (s.side === "L") ? '<b class="text-amber-400 mr-0.5">L</b>' : (s.side === "R" ? '<b class="text-amber-400 mr-0.5">R</b>' : '');
        const calTag = (s.calories && Number(s.calories) > 0) ? `<span class="text-rose-400 ml-1 font-semibold text-[10px]">🔥${s.calories}kcal</span>` : '';
        return `
          <div class="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg font-mono text-xs shadow-sm">
            <span class="text-slate-400 font-semibold">${sideTag}第 ${setNum} 組:</span>
            <span class="text-amber-300 font-bold">${Number(s.weight)} ${escapeHtml(s.unit || 'KG')}</span>
            <span class="text-slate-500">×</span>
            <span class="text-white font-bold">${Number(s.reps)} 下</span>
            ${calTag}
          </div>
        `;
      }
    }).join('');
  }

  if (!isCardio && matchedSets.length > 0) {
    const firstSet = matchedSets[0];
    if (firstSet.unit) setUnit(firstSet.unit, false);
    if (firstSet.weight !== undefined) document.getElementById('inputWeight').value = firstSet.weight;
    if (firstSet.reps !== undefined) document.getElementById('inputReps').value = firstSet.reps;
  }
}

function updateActiveMachineSettingBanner(machineName) {
  const setting = AppState.customMachineSettings[machineName] || {};
  const isCardio = isCardioEquipment(machineName, AppState.currentMuscleGroup);
  const details = document.getElementById('currentMachineSettingDetails');
  if (!details) return;

  details.innerHTML = isCardio ? `
    <span>🏃 預設速度: <b class="text-sky-300">${escapeHtml(setting.default_speed || '6.0')} km/h</b></span>
    <span>📈 預設斜度: <b class="text-sky-300">${escapeHtml(setting.default_incline || '0.0')} %</b></span>
    <span class="text-slate-400">📝 備註: <b class="text-slate-300">${escapeHtml(setting.notes || '無')}</b></span>
  ` : `
    <span>💺 坐位: <b class="text-slate-200">${escapeHtml(setting.seat || '未設定')}</b></span>
    <span>↔️ 扶手: <b class="text-slate-200">${escapeHtml(setting.handle || '未設定')}</b></span>
    <span>📐 角度: <b class="text-slate-200">${escapeHtml(setting.backrest || '未設定')}</b></span>
    <span class="text-slate-400">📝 備註: <b class="text-slate-300">${escapeHtml(setting.notes || '無')}</b></span>
  `;
}

export function triggerImageZoomFromModal() {
  if (tempModalImgBase64 && tempModalImgBase64.length > 10) openImageLightbox(tempModalImgBase64);
}

export function openImageLightbox(src) {
  const overlay = document.getElementById('imageLightboxOverlay');
  const img = document.getElementById('lightboxImage');
  if (!overlay || !img) return;
  img.src = src;
  overlay.classList.remove('hidden');
}

export function closeImageLightbox() {
  document.getElementById('imageLightboxOverlay')?.classList.add('hidden');
}

export function renderModalMuscleButtons() {
  const container = document.getElementById('modalMuscleSelectContainer');
  if (!container) return;

  container.innerHTML = ALL_MUSCLE_ITEMS.map(m => `
    <button type="button" onclick="window.trackerMod.selectModalMuscle('${m}')"
            class="py-1.5 rounded-lg text-xs font-bold border transition-all text-center ${
              AppState.modalSelectedMuscle === m 
                ? 'bg-indigo-600 border-indigo-500 text-white shadow' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }">
      ${m}
    </button>
  `).join('');
}

export function selectModalMuscle(muscle) {
  AppState.modalSelectedMuscle = muscle;
  renderModalMuscleButtons();
}

export function openAddNewMachineModal() {
  targetModalMachine = "";
  tempModalImgBase64 = "";

  const titleEl = document.getElementById('modalMainTitle');
  if (titleEl) titleEl.innerText = "新增器材與相片";

  const iconEl = document.getElementById('modalTitleIcon');
  if (iconEl) iconEl.innerText = "➕";

  const idInput = document.getElementById('modalMachineIdInput');
  if (idInput) idInput.value = "";

  const idDisplay = document.getElementById('modalMachineIdDisplay');
  if (idDisplay) idDisplay.innerText = "ID: 儲存時自動生成";

  AppState.modalSelectedMuscle = AppState.currentMuscleGroup;
  renderModalMuscleButtons();

  const nameInput = document.getElementById('modalMachineNameInput');
  if (nameInput) nameInput.value = "";

  const uniCheck = document.getElementById('modalIsUnilateralCheckbox');
  if (uniCheck) uniCheck.checked = false;

  ['settingSeat', 'settingHandle', 'settingBackrest', 'settingDefaultSpeed', 'settingDefaultIncline', 'settingNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  document.getElementById('btnDeleteMachine')?.classList.add('hidden');
  resetModalImgPreview("");

  const modal = document.getElementById('machineSettingModal');
  if (modal) {
    modal.classList.remove('hidden');
  } else {
    console.error("找不到 #machineSettingModal 元素！請檢查 index.html");
  }
}

export function openEditMachineModal(name) {
  name = name || AppState.currentSelectedMachine;
  if (!name) {
    openAddNewMachineModal();
    return;
  }

  targetModalMachine = name;
  const s = AppState.customMachineSettings[name] || {};
  tempModalImgBase64 = s.image_url || "";

  const titleEl = document.getElementById('modalMainTitle');
  if (titleEl) titleEl.innerText = "修改器材設定與相片";

  const iconEl = document.getElementById('modalTitleIcon');
  if (iconEl) iconEl.innerText = "⚙️";

  const idInput = document.getElementById('modalMachineIdInput');
  if (idInput) idInput.value = s.machine_id || "";

  const idDisplay = document.getElementById('modalMachineIdDisplay');
  if (idDisplay) idDisplay.innerText = `ID: ${s.machine_id || '自動補齊'}`;

  AppState.modalSelectedMuscle = s.muscle_group || AppState.currentMuscleGroup;
  renderModalMuscleButtons();

  const nameInput = document.getElementById('modalMachineNameInput');
  if (nameInput) nameInput.value = name;

  const uniCheck = document.getElementById('modalIsUnilateralCheckbox');
  if (uniCheck) uniCheck.checked = !!s.is_unilateral;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  setVal('settingSeat', s.seat);
  setVal('settingHandle', s.handle);
  setVal('settingBackrest', s.backrest);
  setVal('settingDefaultSpeed', s.default_speed);
  setVal('settingDefaultIncline', s.default_incline);
  setVal('settingNotes', s.notes);

  document.getElementById('btnDeleteMachine')?.classList.remove('hidden');
  resetModalImgPreview(tempModalImgBase64);

  const modal = document.getElementById('machineSettingModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

export function closeMachineSettingModal() {
  document.getElementById('machineSettingModal')?.classList.add('hidden');
}

function resetModalImgPreview(urlOrBase64) {
  const preview = document.getElementById('modalMachineImgPreview');
  const placeholder = document.getElementById('modalMachineImgPlaceholder');
  const zoomHint = document.getElementById('zoomHintText');
  const has = !!(urlOrBase64 && urlOrBase64.length > 10);

  if (preview) { preview.src = has ? urlOrBase64 : ""; preview.classList.toggle('hidden', !has); }
  if (placeholder) placeholder.classList.toggle('hidden', has);
  if (zoomHint) zoomHint.classList.toggle('hidden', !has);
}

async function handleImageFileSelection(file) {
  if (!file) return;
  try {
    const fullDataUrl = await compressImageToBase64(file, 640, 0.7);
    tempModalImgBase64 = fullDataUrl;
    resetModalImgPreview(tempModalImgBase64);
  } catch (err) {
    console.error("手機相片處理出錯:", err);
    alert("相片處理失敗: " + (err.message || "檔案過大或不支援此格式"));
  }
}

export async function deleteMachineFromModal() {
  const machineName = targetModalMachine;
  const s = AppState.customMachineSettings[machineName] || {};
  const machineId = s.machine_id || "";
  if (!machineName || !confirm(`⚠️ 確定要徹底刪除器材「${machineName}」(${machineId}) 嗎？`)) return;

  delete AppState.customMachineSettings[machineName];
  localStorage.removeItem(`gym_hist_${machineName}`);
  localStorage.setItem('gym_custom_machines_meta', JSON.stringify(AppState.customMachineSettings));

  if (AppState.currentSelectedMachine === machineName) AppState.currentSelectedMachine = "";
  refreshActiveEquipmentList();
  closeMachineSettingModal();

  sendGasRequest("deleteMachineSetting", { machine_id: machineId, machine_name: machineName });
}

export async function saveMachineSettingsFromModal() {
  const machineName = document.getElementById('modalMachineNameInput').value.trim();
  if (!machineName) { alert("請輸入器材名稱！"); return; }

  const machineId = document.getElementById('modalMachineIdInput').value.trim();
  const isUnilateral = document.getElementById('modalIsUnilateralCheckbox').checked;
  const seatVal = document.getElementById('settingSeat').value.trim();
  const handleVal = document.getElementById('settingHandle').value.trim();
  const backrestVal = document.getElementById('settingBackrest').value.trim();
  const defSpeed = document.getElementById('settingDefaultSpeed').value.trim();
  const defIncline = document.getElementById('settingDefaultIncline').value.trim();
  const notesVal = document.getElementById('settingNotes').value.trim();

  if (!AppState.customMachineSettings[machineName]) AppState.customMachineSettings[machineName] = {};
  Object.assign(AppState.customMachineSettings[machineName], {
    machine_id: machineId,
    muscle_group: AppState.modalSelectedMuscle,
    is_unilateral: isUnilateral,
    seat: seatVal,
    handle: handleVal,
    backrest: backrestVal,
    default_speed: defSpeed,
    default_incline: defIncline,
    notes: notesVal
  });
  if (tempModalImgBase64) AppState.customMachineSettings[machineName].image_url = tempModalImgBase64;

  localStorage.setItem('gym_custom_machines_meta', JSON.stringify(AppState.customMachineSettings));
  refreshActiveEquipmentList();
  selectMachine(machineName);
  closeMachineSettingModal();

  const isNewUpload = tempModalImgBase64 && tempModalImgBase64.startsWith('data:image');
  const isExistingUrl = tempModalImgBase64 && tempModalImgBase64.startsWith('http');

  const payload = {
    machine_id: machineId,
    muscle_group: AppState.modalSelectedMuscle,
    machine_name: machineName,
    seat: seatVal,
    handle: handleVal,
    backrest: backrestVal,
    default_speed: defSpeed,
    default_incline: defIncline,
    notes: notesVal,
    is_unilateral: isUnilateral,
    image_base64: isNewUpload ? tempModalImgBase64 : "",
    image_url: isExistingUrl ? tempModalImgBase64 : ""
  };

  const res = await sendGasRequest("saveMachineSetting", payload);
  if (res && res.status === "success") {
    if (res.image_url) AppState.customMachineSettings[machineName].image_url = res.image_url;
    if (res.machine_id) AppState.customMachineSettings[machineName].machine_id = res.machine_id;
    localStorage.setItem('gym_custom_machines_meta', JSON.stringify(AppState.customMachineSettings));
    refreshActiveEquipmentList();
  }
}

export function getAccurateElapsedWorkoutSeconds() {
  if (!AppState.workoutStartEpoch) return 0;
  const now = Date.now();
  const currentPauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (now - AppState.pauseStartEpoch) : 0;
  return Math.max(0, Math.floor((now - AppState.workoutStartEpoch - (AppState.pausedDurationMs + currentPauseExtra)) / 1000));
}

function updateLiveWorkoutTimeDisplay() {
  const totalSec = getAccurateElapsedWorkoutSeconds();
  const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  const timerEl = document.getElementById('totalWorkoutTimer');
  if (timerEl) timerEl.innerText = `${hrs}:${mins}:${secs}`;
}

function updateMachineTimerDisplay() {
  if (!AppState.machineStartEpoch) return;
  const now = Date.now();
  const currentPauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (now - AppState.pauseStartEpoch) : 0;
  const totalMachineSec = Math.max(0, Math.floor((now - AppState.machineStartEpoch - (AppState.machinePausedMs + currentPauseExtra)) / 1000));

  const m = String(Math.floor(totalMachineSec / 60)).padStart(2, '0');
  const s = String(totalMachineSec % 60).padStart(2, '0');
  const timerEl = document.getElementById('machineTimerDisplay');
  if (timerEl) timerEl.innerText = `${m}:${s}`;

  const splitEl = document.getElementById('cardioSplitTimerDisplay');
  if (splitEl) {
    const splitSec = AppState.currentSetStartEpoch 
      ? Math.max(0, Math.floor((now - AppState.currentSetStartEpoch - (AppState.setPausedMs + currentPauseExtra)) / 1000))
      : totalMachineSec;
    splitEl.innerText = `${String(Math.floor(splitSec / 60)).padStart(2, '0')}:${String(splitSec % 60).padStart(2, '0')}`;
  }
}

function startWorkoutTimerLoop() {
  clearInterval(totalWorkoutTimerInterval);
  totalWorkoutTimerInterval = setInterval(() => {
    if (!AppState.isWorkoutPaused && !AppState.isWorkoutEnded) updateLiveWorkoutTimeDisplay();
  }, 1000);
}

function setBreathingOverlay(mode) {
  const overlay = document.getElementById('screenBreathingOverlay');
  if (!overlay) return;
  overlay.className = "fixed inset-0 pointer-events-none z-50 transition-all duration-700 " + (mode === 'yellow' ? 'breath-yellow' : (mode === 'red' ? 'breath-red' : ''));
}

function startBackgroundIndicator() {
  clearInterval(backgroundTimerInterval);
  backgroundTimerInterval = setInterval(() => {
    const banner = document.getElementById('restStatusBanner');
    const dot = document.getElementById('restStatusDot');
    const text = document.getElementById('restStatusText');
    const timer = document.getElementById('restStatusTimer');
    if (!banner) return;

    if (isCardioEquipment(AppState.currentSelectedMachine, AppState.currentMuscleGroup)) {
      banner.classList.add('hidden');
      setBreathingOverlay('off');
      return;
    }

    if (AppState.isWorkoutPaused || !AppState.isWorkoutStarted || AppState.isWorkoutEnded) {
      setBreathingOverlay('off');
      return;
    }

    if (AppState.lastSetLogEpoch) {
      const restDiff = Math.max(0, Math.floor((Date.now() - AppState.lastSetLogEpoch) / 1000));
      const m = String(Math.floor(restDiff / 60)).padStart(2, '0');
      const s = String(restDiff % 60).padStart(2, '0');
      timer.innerText = `${m}:${s}`;

      if (restDiff >= 120) {
        setBreathingOverlay('red');
        banner.className = "p-2.5 rounded-xl bg-rose-950/70 border border-rose-600 flex items-center justify-between transition-all";
        dot.className = "w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping";
        text.className = "text-xs font-bold text-rose-300";
        text.innerText = "⚠️ 休息過久 (已超 2 分鐘)";
        timer.className = "font-mono font-black text-sm text-rose-400";
      } else if (restDiff >= 90) {
        setBreathingOverlay('yellow');
        banner.className = "p-2.5 rounded-xl bg-amber-950/70 border border-amber-600 flex items-center justify-between transition-all";
        dot.className = "w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";
        text.className = "text-xs font-bold text-amber-300";
        text.innerText = "☕ 休息達 90 秒 (能量充足)";
        timer.className = "font-mono font-black text-sm text-amber-400";
      } else {
        setBreathingOverlay('off');
        banner.className = "p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-600 flex items-center justify-between transition-all";
        dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";
        text.className = "text-xs font-bold text-indigo-300";
        text.innerText = "☕ 組間休息中";
        timer.className = "font-mono font-black text-sm text-emerald-400";
      }
    } else if (AppState.currentSetStartEpoch) {
      setBreathingOverlay('off');
      const pauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (Date.now() - AppState.pauseStartEpoch) : 0;
      const setDiff = Math.max(0, Math.floor((Date.now() - AppState.currentSetStartEpoch - (AppState.setPausedMs + pauseExtra)) / 1000));
      banner.className = "p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between transition-all";
      dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500";
      text.className = "text-xs font-bold text-emerald-400";
      text.innerText = "💪 動作進行中";
      timer.className = "font-mono font-black text-sm text-emerald-400";
      timer.innerText = `${String(Math.floor(setDiff / 60)).padStart(2, '0')}:${String(setDiff % 60).padStart(2, '0')}`;
    } else {
      setBreathingOverlay('off');
      banner.className = "p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between transition-all";
      dot.className = "w-2.5 h-2.5 rounded-full bg-slate-600";
      text.className = "text-xs font-bold text-slate-400";
      text.innerText = "組間狀態：就緒";
      timer.className = "font-mono font-black text-sm text-slate-400";
      timer.innerText = "--:--";
    }
  }, 1000);
}

function updateLogSetButtonState() {
  const btn = document.getElementById('btnLogSet');
  const text = document.getElementById('btnLogSetText');
  if (!btn || !text) return;

  const isCardio = isCardioEquipment(AppState.currentSelectedMachine, AppState.currentMuscleGroup);

  if (AppState.isWorkoutEnded) {
    btn.disabled = true;
    btn.className = "w-full bg-slate-800 text-slate-500 opacity-40 cursor-not-allowed py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5";
    text.innerText = "今日訓練已結算 (不可記錄)";
  } else if (!AppState.isWorkoutStarted) {
    btn.disabled = true;
    btn.className = "w-full bg-slate-800 text-slate-500 opacity-40 cursor-not-allowed py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5";
    text.innerText = "請先點擊上方「開始訓練」";
  } else if (AppState.isWorkoutPaused) {
    btn.disabled = true;
    btn.className = "w-full bg-slate-800 text-slate-500 opacity-40 cursor-not-allowed py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5";
    text.innerText = "訓練暫停中 (請按繼續)";
  } else if (!AppState.isMachineActive) {
    btn.disabled = true;
    btn.className = "w-full bg-slate-800 text-slate-500 opacity-40 cursor-not-allowed py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5";
    text.innerText = "請先按右方「開始此機」";
  } else {
    btn.disabled = false;
    btn.className = "w-full bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white py-2.5 rounded-xl font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-1.5";
    text.innerText = isCardio ? "🏃 記錄此段並換速 (Log Split)" : "記錄此組 (Log Set)";
  }
}

async function autoLogCardioSplit(durationSec) {
  const nowTime = new Date().toTimeString().split(' ')[0];
  const setting = AppState.customMachineSettings[AppState.currentSelectedMachine] || {};
  const speed = parseFloat(document.getElementById('inputCardioSpeed').value) || 0;
  const incline = parseFloat(document.getElementById('inputCardioIncline').value) || 0;
  const calories = calculateCardioCalories(speed, incline, durationSec);
  const currentDone = AppState.machineProgress[AppState.currentSelectedMachine] || 0;
  const setNum = currentDone + 1;

  const pauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (Date.now() - AppState.pauseStartEpoch) : 0;
  const totalMachineSec = AppState.machineStartEpoch 
    ? Math.max(0, Math.floor((Date.now() - AppState.machineStartEpoch - (AppState.machinePausedMs + pauseExtra)) / 1000))
    : durationSec;

  const singleLog = {
    date: document.getElementById('displayDate').innerText,
    timestamp: nowTime,
    muscle_group: AppState.currentMuscleGroup,
    machine_id: setting.machine_id || "",
    exercise_name: AppState.currentSelectedMachine,
    side: "Both",
    set_num: setNum,
    weight: 0, unit: "--", weight_kg: 0, reps: 0,
    speed, incline, calories,
    set_duration_sec: durationSec, rest_duration_sec: 0,
    machine_duration_sec: totalMachineSec
  };

  AppState.workoutLogs.push(singleLog);
  AppState.machineProgress[AppState.currentSelectedMachine] = setNum;

  if (!AppState.machineStartLoggedToTimeline && AppState.pendingMachineTimelineEntry) {
    addTimelineEntry(AppState.pendingMachineTimelineEntry);
    AppState.machineStartLoggedToTimeline = true;
  }

  const durStr = durationSec >= 60 ? `${Math.floor(durationSec / 60)}分${durationSec % 60}秒` : `${durationSec}秒`;
  addTimelineEntry(`🏃 ${nowTime} ${AppState.currentSelectedMachine} 第${setNum}段: ${durStr} | 速:${speed} 斜:${incline}% (約消耗 ${calories} kcal)`);

  const setNumEl = document.getElementById('currentSetNum');
  if (setNumEl) setNumEl.innerText = setNum + 1;
  renderCompletedMachinesList();
  persistActiveSession();

  await sendGasRequest("saveSingleSet", singleLog);
}

function resetMachineTimerUI() {
  if (AppState.isMachineActive) {
    clearInterval(machineTimerInterval);
    AppState.isMachineActive = false;
  }
  AppState.machineStartEpoch = null;
  AppState.currentSetStartEpoch = null;
  AppState.lastSetLogEpoch = null;
  AppState.machinePausedMs = 0;
  AppState.setPausedMs = 0;
  AppState.machineStartLoggedToTimeline = false;
  AppState.pendingMachineTimelineEntry = null;
  setBreathingOverlay('off');

  const timerDisplay = document.getElementById('machineTimerDisplay');
  if (timerDisplay) timerDisplay.innerText = "00:00";
  const splitEl = document.getElementById('cardioSplitTimerDisplay');
  if (splitEl) splitEl.innerText = "00:00";

  const btnToggleMachine = document.getElementById('btnToggleMachine');
  const btnToggleMachineText = document.getElementById('btnToggleMachineText');
  if (btnToggleMachineText) btnToggleMachineText.innerText = "開始此機";
  if (btnToggleMachine) {
    btnToggleMachine.className = "flex-1 w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl font-bold text-xs shadow-md transition-all flex flex-col items-center justify-center p-2 gap-1 min-h-[90px]";
  }
  updateLogSetButtonState();
}

export function setEditModalSide(side) {
  editingSideTemp = side;
  const btnL = document.getElementById('btnEditSideL');
  const btnR = document.getElementById('btnEditSideR');
  if (btnL) btnL.className = side === 'L' ? "py-1 rounded bg-indigo-600 text-white font-bold" : "py-1 rounded bg-slate-800 text-slate-400 font-bold";
  if (btnR) btnR.className = side === 'R' ? "py-1 rounded bg-indigo-600 text-white font-bold" : "py-1 rounded bg-slate-800 text-slate-400 font-bold";
}

export function openEditSetModal(index) {
  const item = AppState.workoutLogs[index];
  if (!item) return;

  document.getElementById('editSetIndex').value = index;
  const isCardio = isCardioEquipment(item.exercise_name, item.muscle_group, item);

  document.getElementById('editSetModalTitle').innerText = `${isCardio ? "修改帶氧記錄" : "修改組數記錄"}: ${item.exercise_name} (第 ${item.set_num} ${isCardio ? '段' : '組'})`;
  document.getElementById('editStrengthFields')?.classList.toggle('hidden', isCardio);
  document.getElementById('editCardioFields')?.classList.toggle('hidden', !isCardio);

  if (isCardio) {
    const dur = item.set_duration_sec || item.duration_sec || 0;
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    document.getElementById('editCardioMinutesInput').value = mins;
    document.getElementById('editCardioSecondsInput').value = secs;
    document.getElementById('editCardioTimeText').innerText = `${mins} 分 ${secs} 秒`;
    document.getElementById('editCardioSpeedInput').value = item.speed !== undefined ? item.speed : 6.0;
    document.getElementById('editCardioInclineInput').value = item.incline !== undefined ? item.incline : 0.0;
    document.getElementById('editCardioMinutesInput').oninput = updateCardioEditText;
    document.getElementById('editCardioSecondsInput').oninput = updateCardioEditText;
  } else {
    document.getElementById('editUnitLabel').innerText = item.unit || 'KG';
    document.getElementById('editSetWeightInput').value = item.weight || 0;
    document.getElementById('editSetRepsInput').value = item.reps || 0;

    const currentSetting = AppState.customMachineSettings[item.exercise_name];
    const isUni = currentSetting ? !!currentSetting.is_unilateral : (item.side && item.side !== 'Both');

    document.getElementById('editSideGroup')?.classList.toggle('hidden', !isUni);
    if (isUni) setEditModalSide(item.side === 'R' ? 'R' : 'L');
    else editingSideTemp = "Both";
  }

  document.getElementById('editSetModal')?.classList.remove('hidden');
}

function updateCardioEditText() {
  const m = parseInt(document.getElementById('editCardioMinutesInput').value, 10) || 0;
  const s = parseInt(document.getElementById('editCardioSecondsInput').value, 10) || 0;
  document.getElementById('editCardioTimeText').innerText = `${m} 分 ${s} 秒`;
}

export function stepCardioEditTime(secondsToAdd) {
  let m = parseInt(document.getElementById('editCardioMinutesInput').value, 10) || 0;
  let s = parseInt(document.getElementById('editCardioSecondsInput').value, 10) || 0;
  const totalSec = Math.max(5, (m * 60 + s) + secondsToAdd);
  document.getElementById('editCardioMinutesInput').value = Math.floor(totalSec / 60);
  document.getElementById('editCardioSecondsInput').value = totalSec % 60;
  updateCardioEditText();
}

export function closeEditSetModal() {
  document.getElementById('editSetModal')?.classList.add('hidden');
}

export function stepEditValue(type, amount) {
  const el = document.getElementById(type === 'weight' ? 'editSetWeightInput' : 'editSetRepsInput');
  if (!el) return;
  const cur = parseFloat(el.value) || 0;
  el.value = type === 'weight' ? Math.max(0, Math.round((cur + amount) * 10) / 10) : Math.max(1, cur + amount);
}

export function saveEditSetModal() {
  const idx = parseInt(document.getElementById('editSetIndex').value, 10);
  const item = AppState.workoutLogs[idx];
  if (!item) { closeEditSetModal(); return; }

  const isCardio = isCardioEquipment(item.exercise_name, item.muscle_group, item);

  if (isCardio) {
    const m = parseInt(document.getElementById('editCardioMinutesInput').value, 10) || 0;
    const s = parseInt(document.getElementById('editCardioSecondsInput').value, 10) || 0;
    const speed = parseFloat(document.getElementById('editCardioSpeedInput').value) || 0;
    const incline = parseFloat(document.getElementById('editCardioInclineInput').value) || 0;
    const newTotalSec = (m * 60) + s;
    Object.assign(item, {
      set_duration_sec: newTotalSec, duration_sec: newTotalSec,
      speed, incline, calories: calculateCardioCalories(speed, incline, newTotalSec),
      weight: 0, reps: 0, unit: "--", weight_kg: 0
    });
  } else {
    const newWeight = parseFloat(document.getElementById('editSetWeightInput').value) || 0;
    const newReps = parseInt(document.getElementById('editSetRepsInput').value, 10) || 0;
    const weightKg = (item.unit === 'LB') ? Number((newWeight * 0.453592).toFixed(1)) : newWeight;
    const updatedCalories = calculateStrengthCalories(weightKg, newReps, item.set_duration_sec);

    Object.assign(item, {
      weight: newWeight, reps: newReps, side: editingSideTemp,
      weight_kg: weightKg,
      calories: updatedCalories
    });
    saveMachineHistory(item.exercise_name, newWeight, newReps, item.unit);
    if (AppState.currentSelectedMachine === item.exercise_name) {
      document.getElementById('inputWeight').value = newWeight;
      document.getElementById('inputReps').value = newReps;
    }
  }

  renderCompletedMachinesList();
  const todayStr = normalizeDateStr(document.getElementById('displayDate').innerText);
  if (AppState.historicalWorkouts[todayStr]) {
    AppState.historicalWorkouts[todayStr].logs = AppState.workoutLogs;
    localStorage.setItem('gym_historical_workouts_cache', JSON.stringify(AppState.historicalWorkouts));
  }
  persistActiveSession();
  closeEditSetModal();

  sendGasRequest("updateSingleSet", item);
}

export function deleteSetFromModal() {
  const idx = parseInt(document.getElementById('editSetIndex').value, 10);
  const item = AppState.workoutLogs[idx];
  if (!item) { closeEditSetModal(); return; }

  const isCardio = isCardioEquipment(item.exercise_name, item.muscle_group, item);
  if (!confirm(`確定刪除 ${item.exercise_name} 第 ${item.set_num} ${isCardio ? '段' : '組'}？`)) return;

  const exName = item.exercise_name;
  const deletedItem = Object.assign({}, item);
  AppState.workoutLogs.splice(idx, 1);

  let count = 0;
  AppState.workoutLogs.forEach(l => { if (l.exercise_name === exName) { count++; l.set_num = count; } });
  AppState.machineProgress[exName] = count;

  if (AppState.currentSelectedMachine === exName) {
    const setNumEl = document.getElementById('currentSetNum');
    if (setNumEl) setNumEl.innerText = count + 1;
    loadMachineHistory(exName);
  }

  renderCompletedMachinesList();
  const todayStr = normalizeDateStr(document.getElementById('displayDate').innerText);
  if (AppState.historicalWorkouts[todayStr]) {
    AppState.historicalWorkouts[todayStr].logs = AppState.workoutLogs;
    localStorage.setItem('gym_historical_workouts_cache', JSON.stringify(AppState.historicalWorkouts));
  }

  persistActiveSession();
  closeEditSetModal();

  sendGasRequest("deleteSingleSet", deletedItem);
}

function addTimelineEntry(text) {
  AppState.timelineEvents.push(text);
  renderWorkoutTimelineUI();
}

function renderWorkoutTimelineUI() {
  const container = document.getElementById('workoutTimelineContainer');
  if (!container) return;
  if (AppState.timelineEvents.length === 0) {
    container.innerHTML = `<div class="text-slate-500 text-center py-3 bg-slate-950/60 rounded-xl border border-dashed border-slate-800">開始訓練後，每組動作時間與休息秒數將自動在此串連成時間線</div>`;
    return;
  }
  container.innerHTML = AppState.timelineEvents.map(evt => {
    let colorClass = "text-slate-300";
    if (evt.includes("開始訓練") || evt.includes("結束訓練")) colorClass = "text-emerald-400 font-bold";
    else if (evt.includes("開始此機")) colorClass = "text-indigo-400 font-semibold";
    else if (evt.includes("結束此機")) colorClass = "text-rose-400";
    else if (evt.includes("帶氧") || evt.includes("速:")) colorClass = "text-sky-400 font-medium";
    return `<div class="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80 ${colorClass}">${escapeHtml(evt)}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function renderCompletedMachinesList() {
  const container = document.getElementById('completedMachinesList');
  const badge = document.getElementById('completedCountBadge');
  if (!container) return;

  const completedNames = Object.keys(AppState.machineProgress).filter(name => AppState.machineProgress[name] > 0);
  if (badge) badge.innerText = `${completedNames.length} 部器材`;

  if (completedNames.length === 0) {
    container.innerHTML = `<li class="text-slate-500 text-xs text-center py-4 bg-slate-950/60 rounded-xl border border-dashed border-slate-800">尚未有完成的器材紀錄，完成第 1 組後將顯示於此</li>`;
    return;
  }

  container.innerHTML = completedNames.map(name => {
    const setsCount = AppState.machineProgress[name];
    const thisLogs = AppState.workoutLogs.filter(l => l.exercise_name === name);
    const isCardio = isCardioEquipment(name, thisLogs[0]?.muscle_group, thisLogs[0]);
    const safeName = escapeHtml(name);

    let headerSummary = "";
    if (isCardio) {
      let totalSec = 0, totalCal = 0, weightedSpeed = 0;
      thisLogs.forEach(l => {
        const sec = l.set_duration_sec || 0;
        totalSec += sec;
        totalCal += (l.calories || 0);
        weightedSpeed += ((l.speed || 0) * sec);
      });
      const avgSpd = totalSec > 0 ? (weightedSpeed / totalSec).toFixed(1) : "0.0";
      headerSummary = `
        <div class="text-[11px] font-mono text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800/40 font-semibold flex items-center gap-1.5">
          <span>共${setsCount}段 (${Math.floor(totalSec / 60)}分${totalSec % 60}秒)</span>
          <span>•</span><span>均速 ${avgSpd}</span><span>•</span><span class="text-amber-400">🔥${Math.round(totalCal)}kcal</span>
        </div>
      `;
    } else {
      const totalMachineCal = thisLogs.reduce((acc, cur) => acc + (parseFloat(cur.calories) || 0), 0);
      headerSummary = `
        <div class="flex items-center gap-1.5">
          <span class="text-emerald-400 font-mono font-bold text-xs bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">✅ 已做 ${setsCount} 組</span>
          <span class="text-amber-400 font-mono font-bold text-xs bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40">🔥${Math.round(totalMachineCal)} kcal</span>
        </div>
      `;
    }

    const pills = AppState.workoutLogs.map((l, idx) => {
      if (l.exercise_name !== name) return null;
      const isC = isCardioEquipment(l.exercise_name, l.muscle_group, l);
      const dur = l.set_duration_sec || l.duration_sec || 0;
      const calStr = l.calories ? `<span class="text-amber-400 font-bold ml-1">🔥${l.calories}kcal</span>` : '';

      const label = isC 
        ? `段${l.set_num}: <b>${Math.floor(dur / 60) > 0 ? Math.floor(dur / 60) + '分' : ''}${dur % 60}秒</b> <span class="text-[10px] text-sky-400">(${escapeHtml([l.speed ? `速${l.speed}` : '', l.incline ? `斜${l.incline}%` : '', l.calories ? `🔥${l.calories}kcal` : ''].filter(Boolean).join(' '))})</span>`
        : `第${l.set_num}組: ${l.side === "L" ? '<span class="text-amber-400">L</span>' : (l.side === "R" ? '<span class="text-amber-400">R</span>' : '')} <b>${Number(l.weight)}${escapeHtml(l.unit)} × ${Number(l.reps)}</b> ${calStr}`;

      return `
        <button type="button" onclick="window.trackerMod.openEditSetModal(${idx})" 
                class="inline-flex items-center gap-1 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-indigo-500 px-2 py-1 rounded-lg text-slate-200 active:scale-90 transition-all font-mono text-[11px]">
          <span>${label}</span>
          <span class="text-indigo-400 text-[10px]">✏️</span>
        </button>
      `;
    }).filter(Boolean).join('');

    return `
      <li class="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2 transition-all">
        <div class="flex justify-between items-center flex-wrap gap-1">
          <span class="text-slate-200 font-bold">${safeName}</span>
          ${headerSummary}
        </div>
        <div class="flex flex-wrap gap-1.5 pt-0.5">${pills}</div>
      </li>
    `;
  }).join('');
}

function bindTrackerEvents() {
  const btnStartWorkout = document.getElementById('btnStartWorkout');
  const btnPauseWorkout = document.getElementById('btnPauseWorkout');
  const startTimeStamp = document.getElementById('startTimeStamp');
  const endTimeStamp = document.getElementById('endTimeStamp');
  const btnToggleMachine = document.getElementById('btnToggleMachine');
  const btnToggleMachineText = document.getElementById('btnToggleMachineText');

  // 修復 1：明確綁定「+ 新增器材」按鈕點擊事件
  const btnAddNewMachine = document.getElementById('btnAddNewMachine');
  if (btnAddNewMachine) {
    btnAddNewMachine.addEventListener('click', (e) => {
      e.preventDefault();
      openAddNewMachineModal();
    });
  }

  // 修復 2：明確綁定「⚙️ 設定」按鈕點擊事件（若當前未選器材，則自動打開新增視窗）
  const btnEditCurrentSetting = document.getElementById('btnEditCurrentSetting');
  if (btnEditCurrentSetting) {
    btnEditCurrentSetting.addEventListener('click', (e) => {
      e.preventDefault();
      if (AppState.currentSelectedMachine) {
        openEditMachineModal(AppState.currentSelectedMachine);
      } else {
        openAddNewMachineModal();
      }
    });
  }

  document.getElementById('modalCameraInput')?.addEventListener('change', (e) => handleImageFileSelection(e.target.files[0]));
  document.getElementById('modalGalleryInput')?.addEventListener('change', (e) => handleImageFileSelection(e.target.files[0]));

  document.getElementById('unitToggleTrack')?.addEventListener('click', () => {
    const targetUnit = (AppState.currentUnit === 'KG') ? 'LB' : 'KG';
    setUnit(targetUnit, true);
  });

  btnStartWorkout?.addEventListener('click', () => {
    if (AppState.isWorkoutEnded) { alert("今日訓練已經結束並存檔！若要重新記錄請重新整理。"); return; }
    if (!AppState.isWorkoutStarted) {
      AppState.isWorkoutStarted = true;
      AppState.isWorkoutPaused = false;
      const nowTime = new Date().toTimeString().split(' ')[0];
      if (startTimeStamp) startTimeStamp.innerText = nowTime;
      AppState.workoutStartEpoch = Date.now();
      AppState.pausedDurationMs = 0;
      AppState.pauseStartEpoch = null;
      AppState.currentSetStartEpoch = null;
      AppState.lastSetLogEpoch = null;
      AppState.machinePausedMs = 0;
      AppState.setPausedMs = 0;

      btnStartWorkout.classList.add('hidden');
      btnPauseWorkout?.classList.remove('hidden');

      // 啟用「結束訓練」按鈕 (變為鮮豔紅色可點擊狀態)
      const finishBtn = document.getElementById('btnFinishWorkout');
      if (finishBtn) {
        finishBtn.disabled = false;
        finishBtn.className = "bg-rose-600 hover:bg-rose-500 active:scale-95 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-950/40 flex items-center gap-1 whitespace-nowrap cursor-pointer";
      }

      startWorkoutTimerLoop();
      startBackgroundIndicator();
      updateLogSetButtonState();
      addTimelineEntry(`🟢 ${nowTime} 開始訓練`);
      persistActiveSession();

      sendGasRequest("logStartTime", {
        date: document.getElementById('displayDate').innerText,
        start_time: nowTime,
        muscle_group: AppState.currentMuscleGroup
      });
    }
  });

  btnPauseWorkout?.addEventListener('click', () => {
    if (AppState.isWorkoutEnded) return;
    AppState.isWorkoutPaused = !AppState.isWorkoutPaused;
    if (AppState.isWorkoutPaused) {
      AppState.pauseStartEpoch = Date.now();
      btnPauseWorkout.innerText = "繼續";
      btnPauseWorkout.className = "bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-2.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/40";
      document.getElementById('totalWorkoutTimer')?.classList.replace('text-emerald-400', 'text-amber-400');
      setBreathingOverlay('off');
    } else {
      if (AppState.pauseStartEpoch) {
        const pauseDiff = Date.now() - AppState.pauseStartEpoch;
        AppState.pausedDurationMs += pauseDiff;
        if (AppState.isMachineActive) {
          AppState.machinePausedMs += pauseDiff;
          AppState.setPausedMs += pauseDiff;
        }
        AppState.pauseStartEpoch = null;
      }
      btnPauseWorkout.innerText = "暫停";
      btnPauseWorkout.className = "bg-amber-600 hover:bg-amber-500 active:scale-95 text-white px-2.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-950/40";
      document.getElementById('totalWorkoutTimer')?.classList.replace('text-amber-400', 'text-emerald-400');
      updateLiveWorkoutTimeDisplay();
      if (AppState.isMachineActive) updateMachineTimerDisplay();
    }
    updateLogSetButtonState();
    persistActiveSession();
  });

  btnToggleMachine?.addEventListener('click', async () => {
    if (AppState.isWorkoutEnded) { alert("⚠️ 今日訓練已經結束並存檔！"); return; }
    if (!AppState.isWorkoutStarted) { alert("⚠️ 請先點擊最上方「開始訓練」。"); return; }
    if (AppState.isWorkoutPaused) { alert("⚠ 訓練處於暫停狀態，請按繼續！"); return; }
    if (!AppState.currentSelectedMachine) { alert("請先選擇或新增器材！"); return; }

    const now = Date.now();
    const nowTime = new Date().toTimeString().split(' ')[0];
    const isCardio = isCardioEquipment(AppState.currentSelectedMachine, AppState.currentMuscleGroup);

    if (!AppState.isMachineActive) {
      AppState.isMachineActive = true;
      AppState.machineStartEpoch = now;
      AppState.currentSetStartEpoch = now;
      AppState.machinePausedMs = 0;
      AppState.setPausedMs = 0;
      AppState.lastSetLogEpoch = null;
      setBreathingOverlay('off');

      AppState.machineStartLoggedToTimeline = false;
      AppState.pendingMachineTimelineEntry = `🏋️ ${nowTime} 開始此機: ${AppState.currentSelectedMachine} [${AppState.currentMuscleGroup}]`;

      if (btnToggleMachineText) btnToggleMachineText.innerText = "結束此機";
      btnToggleMachine.className = "flex-1 w-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white rounded-xl font-bold text-xs shadow-md transition-all flex flex-col items-center justify-center p-2 gap-1 min-h-[90px] animate-pulse";

      updateMachineTimerDisplay();
      clearInterval(machineTimerInterval);
      machineTimerInterval = setInterval(updateMachineTimerDisplay, 1000);
    } else {
      const pauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (now - AppState.pauseStartEpoch) : 0;
      const totalMachineSec = Math.max(0, Math.floor((now - AppState.machineStartEpoch - (AppState.machinePausedMs + pauseExtra)) / 1000));

      if (isCardio) {
        const splitSec = AppState.currentSetStartEpoch 
          ? Math.max(0, Math.floor((now - AppState.currentSetStartEpoch - (AppState.setPausedMs + pauseExtra)) / 1000))
          : totalMachineSec;
        if (splitSec >= 5) await autoLogCardioSplit(splitSec);
      }

      clearInterval(machineTimerInterval);
      AppState.isMachineActive = false;

      const m = Math.floor(totalMachineSec / 60);
      const s = totalMachineSec % 60;
      const durStr = m > 0 ? `${m}分${s}秒` : `${s}秒`;

      if (AppState.machineStartLoggedToTimeline) {
        addTimelineEntry(`⏹ ${nowTime} 結束此機: ${AppState.currentSelectedMachine} (總使用時間: ${durStr})`);
      }

      resetMachineTimerUI();
    }

    updateLogSetButtonState();
    persistActiveSession();
  });

  document.getElementById('btnLogSet')?.addEventListener('click', () => {
    if (AppState.isWorkoutEnded || !AppState.isWorkoutStarted || AppState.isWorkoutPaused || !AppState.isMachineActive || !AppState.currentSelectedMachine) return;

    const nowEpoch = Date.now();
    const nowTime = new Date().toTimeString().split(' ')[0];
    const isCardio = isCardioEquipment(AppState.currentSelectedMachine, AppState.currentMuscleGroup);
    const setting = AppState.customMachineSettings[AppState.currentSelectedMachine] || {};

    const pauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (nowEpoch - AppState.pauseStartEpoch) : 0;
    const setDurationSec = AppState.currentSetStartEpoch 
      ? Math.max(5, Math.round((nowEpoch - AppState.currentSetStartEpoch - (AppState.setPausedMs + pauseExtra)) / 1000))
      : 30;
    const restDurationSec = AppState.lastSetLogEpoch ? Math.max(0, Math.round((nowEpoch - AppState.lastSetLogEpoch) / 1000)) : 0;
    const setNum = (AppState.machineProgress[AppState.currentSelectedMachine] || 0) + 1;
    const durStr = setDurationSec >= 60 ? `${Math.floor(setDurationSec / 60)}分${setDurationSec % 60}秒` : `${setDurationSec}秒`;

    const machineDurationSec = AppState.machineStartEpoch 
      ? Math.max(0, Math.floor((nowEpoch - AppState.machineStartEpoch - (AppState.machinePausedMs + pauseExtra)) / 1000))
      : 0;

    const singleLog = {
      date: document.getElementById('displayDate').innerText,
      timestamp: nowTime,
      muscle_group: AppState.currentMuscleGroup,
      machine_id: setting.machine_id || "",
      exercise_name: AppState.currentSelectedMachine,
      side: setting.is_unilateral ? AppState.currentSelectedSide : "Both",
      set_num: setNum,
      set_duration_sec: setDurationSec,
      rest_duration_sec: isCardio ? 0 : restDurationSec,
      machine_duration_sec: machineDurationSec,
      weight: 0, unit: "--", weight_kg: 0, reps: 0, speed: 0, incline: 0, calories: 0
    };

    if (isCardio) {
      singleLog.speed = parseFloat(document.getElementById('inputCardioSpeed').value) || 0;
      singleLog.incline = parseFloat(document.getElementById('inputCardioIncline').value) || 0;
      singleLog.calories = calculateCardioCalories(singleLog.speed, singleLog.incline, setDurationSec);

      if (!AppState.machineStartLoggedToTimeline && AppState.pendingMachineTimelineEntry) {
        addTimelineEntry(AppState.pendingMachineTimelineEntry);
        AppState.machineStartLoggedToTimeline = true;
      }
      addTimelineEntry(`🏃 ${nowTime} ${AppState.currentSelectedMachine} 第${setNum}段: ${durStr} | 速:${singleLog.speed} 斜:${singleLog.incline}% (約消耗 ${singleLog.calories} kcal)`);
      AppState.currentSetStartEpoch = Date.now();
      AppState.setPausedMs = 0;
      AppState.lastSetLogEpoch = null;
    } else {
      singleLog.weight = parseFloat(document.getElementById('inputWeight').value) || 0;
      singleLog.unit = AppState.currentUnit;
      singleLog.weight_kg = Number((AppState.currentUnit === 'LB' ? singleLog.weight * 0.453592 : singleLog.weight).toFixed(1));
      singleLog.reps = parseInt(document.getElementById('inputReps').value, 10) || 0;
      singleLog.calories = calculateStrengthCalories(singleLog.weight_kg, singleLog.reps, setDurationSec);

      if (!AppState.machineStartLoggedToTimeline && AppState.pendingMachineTimelineEntry) {
        addTimelineEntry(AppState.pendingMachineTimelineEntry);
        AppState.machineStartLoggedToTimeline = true;
      }

      saveMachineHistory(AppState.currentSelectedMachine, singleLog.weight, singleLog.reps, AppState.currentUnit);
      const sideTag = (singleLog.side === "L") ? "(左手 L)" : (singleLog.side === "R" ? "(右手 R)" : "");
      if (setNum === 1) {
        addTimelineEntry(`💪 ${nowTime} ${AppState.currentSelectedMachine} ${sideTag} 第1組: ${singleLog.weight}${AppState.currentUnit}×${singleLog.reps}下 (做咗 ${durStr} | 🔥${singleLog.calories} kcal)`);
      } else {
        const restDurStr = restDurationSec >= 60 ? `${Math.floor(restDurationSec / 60)}分${restDurationSec % 60}秒` : `${restDurationSec}秒`;
        addTimelineEntry(`💪 ${nowTime} ${AppState.currentSelectedMachine} ${sideTag} 第${setNum}組: ${singleLog.weight}${AppState.currentUnit}×${singleLog.reps}下 (做咗 ${durStr} / 休息咗 ${restDurStr} | 🔥${singleLog.calories} kcal)`);
      }

      if (setting.is_unilateral) selectSide(singleLog.side === 'L' ? 'R' : 'L');
      AppState.lastSetLogEpoch = Date.now();
      AppState.currentSetStartEpoch = null;
      AppState.setPausedMs = 0;
    }

    AppState.workoutLogs.push(singleLog);
    AppState.machineProgress[AppState.currentSelectedMachine] = setNum;
    setBreathingOverlay('off');
    persistActiveSession();

    sendGasRequest("saveSingleSet", singleLog);

    const setNumEl = document.getElementById('currentSetNum');
    if (setNumEl) setNumEl.innerText = setNum + 1;
    renderCompletedMachinesList();
    if ('vibrate' in navigator) navigator.vibrate(50);
  });

  document.getElementById('btnFinishWorkout')?.addEventListener('click', async () => {
    if (!AppState.isWorkoutStarted) {
      alert("尚未開始訓練！請先點擊綠色「▶ 開始訓練」按鈕。");
      return;
    }

    if (AppState.isWorkoutEnded) return;

    if (AppState.workoutLogs.length === 0) {
      if (!confirm("⚠️ 尚未進行任何組數記錄，是否直接取消並重設本次訓練？\n（不會在 Google Sheets 留下空紀錄）")) {
        return;
      }

      AppState.isWorkoutStarted = false;
      AppState.isWorkoutPaused = false;
      AppState.workoutStartEpoch = null;
      AppState.pausedDurationMs = 0;
      AppState.pauseStartEpoch = null;

      clearInterval(totalWorkoutTimerInterval);
      clearInterval(machineTimerInterval);
      clearInterval(backgroundTimerInterval);
      setBreathingOverlay('off');

      const timerEl = document.getElementById('totalWorkoutTimer');
      if (timerEl) timerEl.innerText = "00:00:00";
      const startEl = document.getElementById('startTimeStamp');
      const endEl = document.getElementById('endTimeStamp');
      if (startEl) startEl.innerText = "--:--:--";
      if (endEl) endEl.innerText = "--:--:--";

      document.getElementById('btnStartWorkout')?.classList.remove('hidden');
      document.getElementById('btnPauseWorkout')?.classList.add('hidden');

      resetMachineTimerUI();
      clearActiveSession();
      updateFinishWorkoutButtonUI();
      updateLogSetButtonState();
      alert("✅ 已取消本次未開始的訓練。");
      return;
    }

    if (!confirm("確定結束今日訓練並儲存至 Google Sheet？結束後將鎖定今日記錄。")) return;

    if (AppState.isMachineActive) {
      const isCardio = isCardioEquipment(AppState.currentSelectedMachine, AppState.currentMuscleGroup);
      const now = Date.now();
      const pauseExtra = (AppState.isWorkoutPaused && AppState.pauseStartEpoch) ? (now - AppState.pauseStartEpoch) : 0;
      const totalMachineSec = Math.max(0, Math.floor((now - AppState.machineStartEpoch - (AppState.machinePausedMs + pauseExtra)) / 1000));

      if (isCardio) {
        const splitSec = AppState.currentSetStartEpoch 
          ? Math.max(0, Math.floor((now - AppState.currentSetStartEpoch - (AppState.setPausedMs + pauseExtra)) / 1000))
          : totalMachineSec;
        if (splitSec >= 5) await autoLogCardioSplit(splitSec);
      }

      clearInterval(machineTimerInterval);
      AppState.isMachineActive = false;

      const m = Math.floor(totalMachineSec / 60);
      const s = totalMachineSec % 60;
      const durStr = m > 0 ? `${m}分${s}秒` : `${s}秒`;
      const nowTime = new Date().toTimeString().split(' ')[0];

      if (AppState.machineStartLoggedToTimeline) {
        addTimelineEntry(`⏹ ${nowTime} 結束此機: ${AppState.currentSelectedMachine} (總使用時間: ${durStr})`);
      }
      resetMachineTimerUI();
    }

    AppState.isWorkoutEnded = true;
    AppState.isWorkoutStarted = false;
    AppState.isWorkoutPaused = false;
    clearInterval(totalWorkoutTimerInterval);
    clearInterval(backgroundTimerInterval);
    setBreathingOverlay('off');

    const totalSec = getAccurateElapsedWorkoutSeconds();
    const nowEndTime = new Date().toTimeString().split(' ')[0];
    const endTimeStamp = document.getElementById('endTimeStamp');
    if (endTimeStamp) endTimeStamp.innerText = nowEndTime;
    addTimelineEntry(`🏁 ${nowEndTime} 結束訓練 (總時長: ${Math.round(totalSec / 60)}分鐘)`);

    document.getElementById('btnPauseWorkout')?.classList.add('hidden');
    document.getElementById('badgeWorkoutEnded')?.classList.remove('hidden');

    const btnToggleMachine = document.getElementById('btnToggleMachine');
    const btnToggleMachineText = document.getElementById('btnToggleMachineText');
    if (btnToggleMachine) {
      btnToggleMachine.disabled = true;
      btnToggleMachine.className = "flex-1 w-full bg-slate-800 text-slate-500 opacity-40 cursor-not-allowed rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center p-2 gap-1 min-h-[90px]";
    }
    if (btnToggleMachineText) btnToggleMachineText.innerText = "訓練已結束";
    updateLogSetButtonState();

    const finishBtn = document.getElementById('btnFinishWorkout');
    const finishBtnText = document.getElementById('btnFinishWorkoutText');
    if (finishBtn) {
      finishBtn.className = "bg-slate-800 text-slate-400 px-3 py-2 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-not-allowed opacity-60";
    }
    if (finishBtnText) finishBtnText.innerText = "儲存中...";

    let muscleSummaries = Array.from(new Set(AppState.workoutLogs.map(l => l.muscle_group))).join(", ") || (AppState.currentMuscleGroup || "帶氧");

    const machineAggMap = {};
    AppState.workoutLogs.forEach(l => {
      const name = l.exercise_name || "未知器材";
      const isC = isCardioEquipment(name, l.muscle_group, l);
      if (!machineAggMap[name]) {
        machineAggMap[name] = { sets: 0, isCardio: isC, maxWeight: 0, maxReps: 0, totalVol: 0, totalSec: 0 };
      }
      machineAggMap[name].sets += 1;

      if (isC) {
        machineAggMap[name].totalSec += (l.set_duration_sec || l.duration_sec || 0);
      } else {
        const w = parseFloat(l.weight_kg || l.weight) || 0;
        const r = parseInt(l.reps, 10) || 0;
        machineAggMap[name].totalVol += (w * r);
        if (w > machineAggMap[name].maxWeight) {
          machineAggMap[name].maxWeight = w;
          machineAggMap[name].maxReps = r;
        }
      }
    });

    const compressedSummaryText = Object.keys(machineAggMap).map(name => {
      const item = machineAggMap[name];
      if (item.isCardio) {
        const m = Math.floor(item.totalSec / 60);
        const parts = [`${item.sets}段`];
        if (m > 0) parts.push(`${m}分鐘`);
        return `• ${name}: ${parts[0]} (${parts.slice(1).join(', ')})`;
      } else {
        return `• ${name}: ${item.sets}組 (峰值: ${item.maxWeight}kg×${item.maxReps}下 | 總容量: ${item.totalVol}kg)`;
      }
    }).join('\n');

    const summaryPayload = {
      date: document.getElementById('displayDate').innerText,
      start_time: document.getElementById('startTimeStamp')?.innerText || "--",
      end_time: nowEndTime,
      muscle_group: muscleSummaries,
      total_duration_sec: totalSec,
      timeline_text: compressedSummaryText,
      logs: AppState.workoutLogs
    };

    clearActiveSession();

    const res = await sendGasRequest("finishWorkout", summaryPayload);
    if (res && res.status === "success") {
      saveWorkoutToLocalHistory(summaryPayload);
      if (finishBtnText) finishBtnText.innerText = "已結束";
      alert("✅ 訓練數據及時間線已成功儲存至 Google Sheet！");
    } else {
      if (finishBtnText) finishBtnText.innerText = "已結束 (離線)";
      alert("已送出儲存請求，請確認網路與 API Key 設定。");
    }
  });
}

// 雙向掛載：同時支援 trackerMod.xxx() 與直接 xxx() 呼叫
const trackerExports = {
  selectMuscleGroup,
  selectMachine,
  selectSide,
  stepValue,
  stepCardioValue,
  openAddNewMachineModal,
  openEditMachineModal,
  closeMachineSettingModal,
  selectModalMuscle,
  saveMachineSettingsFromModal,
  deleteMachineFromModal,
  triggerImageZoomFromModal,
  openImageLightbox,
  closeImageLightbox,
  openEditSetModal,
  closeEditSetModal,
  setEditModalSide,
  stepEditValue,
  stepCardioEditTime,
  saveEditSetModal,
  deleteSetFromModal
};

window.trackerMod = window.trackerMod || {};
Object.assign(window.trackerMod, trackerExports);
Object.assign(window, trackerExports);
