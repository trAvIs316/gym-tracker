// js/config.js - 全域設定、常數與狀態共享

export const CONFIG = {
  GAS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbzCG1aWVi4tOSzcebh-dklZFgqsiuqlm6SrqSAKPI6tdPVdmKjpu79qj-gxK47OpdAxHg/exec",
  DEFAULT_WEIGHT_KG: 20,
  DEFAULT_REPS: 10
};

export const ACTIVE_SESSION_KEY = 'gym_active_workout_session';
export const ALL_MUSCLE_ITEMS = ["胸", "背", "膊", "二頭", "三頭", "腳", "腹", "帶氧"];

// 非訓練日類別與配色配置
export const REST_TYPE_CONFIG = {
  "主動休息": { label: "主動休息", emoji: "🛋️", badgeClass: "bg-indigo-950/80 text-indigo-300 border-indigo-700/50", dotClass: "bg-indigo-400" },
  "病假": { label: "生病/受傷", emoji: "🤒", badgeClass: "bg-amber-950/80 text-amber-300 border-amber-700/50", dotClass: "bg-amber-400" },
  "工作/事假": { label: "工作/事假", emoji: "💼", badgeClass: "bg-rose-950/80 text-rose-300 border-rose-700/50", dotClass: "bg-rose-400" },
  "旅行/出差": { label: "旅行/出差", emoji: "✈️", badgeClass: "bg-sky-950/80 text-sky-300 border-sky-800/50", dotClass: "bg-sky-400" },
  "其他原因": { label: "其他原因", emoji: "📝", badgeClass: "bg-slate-900 text-slate-300 border-slate-700", dotClass: "bg-slate-400" }
};

// 跨模組共用核心狀態 (AppState)
export const AppState = {
  currentMuscleGroup: "胸",
  modalSelectedMuscle: "胸",
  currentSelectedMachine: "",
  currentUnit: 'KG',
  currentSelectedSide: 'L',
  workoutLogs: [],
  machineProgress: {},
  customMachineSettings: {},

  isWorkoutStarted: false,
  isWorkoutPaused: false,
  isWorkoutEnded: false,
  workoutStartEpoch: null,
  pausedDurationMs: 0,
  pauseStartEpoch: null,

  isMachineActive: false,
  machineStartEpoch: null,
  machinePausedMs: 0,
  setPausedMs: 0,

  machineStartLoggedToTimeline: false,
  pendingMachineTimelineEntry: null,

  lastSetLogEpoch: null,
  currentSetStartEpoch: null,
  timelineEvents: [],
  historicalWorkouts: {},
  restDaysMap: {}
};