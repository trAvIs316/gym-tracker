// js/modules/calendar.js - 零語法錯誤、支援年份月份自由切換與非訓練日管理
import { AppState, REST_TYPE_CONFIG } from '../config.js';
import { sendGasRequest, getGymApiKey } from '../api.js';
import { escapeHtml, normalizeDateStr, isCardioEquipment } from '../utils.js';

let calendarSelectedYear = new Date().getFullYear();
let calendarSelectedMonth = new Date().getMonth();
let calendarActiveSelectedDate = "";
let isCalendarInitialized = false;

export function initCalendarView() {
  if (!getGymApiKey()) {
    if (window.switchMainView) window.switchMainView('settings');
    return;
  }

  const yearSelect = document.getElementById('calYearSelect');
  const monthSelect = document.getElementById('calMonthSelect');
  if (!yearSelect || !monthSelect) return;

  // 只在第一次進入月曆時設定預設為今天，避免切換後被洗掉
  if (!isCalendarInitialized) {
    const today = new Date();
    calendarSelectedYear = today.getFullYear();
    calendarSelectedMonth = today.getMonth();
    calendarActiveSelectedDate = normalizeDateStr(
      document.getElementById('displayDate')?.innerText || today.toISOString().split('T')[0]
    );
    isCalendarInitialized = true;
  }

  populateYearMonthDropdowns();
  renderCalendarGrid();
  selectCalendarDate(calendarActiveSelectedDate, false);
}

function populateYearMonthDropdowns() {
  const yearSelect = document.getElementById('calYearSelect');
  const monthSelect = document.getElementById('calMonthSelect');
  if (!yearSelect || !monthSelect) return;

  const currentYear = new Date().getFullYear();
  const minYear = Math.min(currentYear - 4, calendarSelectedYear - 1);
  const maxYear = Math.max(currentYear + 2, calendarSelectedYear + 1);

  let yearHtml = "";
  for (let y = minYear; y <= maxYear; y++) {
    yearHtml += `<option value="${y}" ${y === calendarSelectedYear ? 'selected' : ''}>${y} 年</option>`;
  }
  yearSelect.innerHTML = yearHtml;
  yearSelect.value = String(calendarSelectedYear);

  let monthHtml = "";
  for (let m = 0; m < 12; m++) {
    monthHtml += `<option value="${m}" ${m === calendarSelectedMonth ? 'selected' : ''}>${m + 1} 月</option>`;
  }
  monthSelect.innerHTML = monthHtml;
  monthSelect.value = String(calendarSelectedMonth);
}

export function onCalendarSelectChange() {
  const ySelect = document.getElementById('calYearSelect');
  const mSelect = document.getElementById('calMonthSelect');
  if (ySelect) calendarSelectedYear = parseInt(ySelect.value, 10);
  if (mSelect) calendarSelectedMonth = parseInt(mSelect.value, 10);
  renderCalendarGrid();
}

export function changeMonth(offset) {
  calendarSelectedMonth += Number(offset);
  if (calendarSelectedMonth < 0) {
    calendarSelectedMonth = 11;
    calendarSelectedYear--;
  } else if (calendarSelectedMonth > 11) {
    calendarSelectedMonth = 0;
    calendarSelectedYear++;
  }

  populateYearMonthDropdowns();
  renderCalendarGrid();
}

export function renderCalendarGrid() {
  const grid = document.getElementById('calendarDaysGrid');
  if (!grid) return;
  grid.innerHTML = "";

  const firstDayIndex = new Date(calendarSelectedYear, calendarSelectedMonth, 1).getDay();
  const daysInMonth = new Date(calendarSelectedYear, calendarSelectedMonth + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    grid.innerHTML += `<div class="h-11 rounded-xl bg-slate-950/20 border border-transparent opacity-20"></div>`;
  }

  const todayStr = normalizeDateStr(document.getElementById('displayDate')?.innerText || "");

  for (let day = 1; day <= daysInMonth; day++) {
    const fullDateStr = `${calendarSelectedYear}-${String(calendarSelectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = (fullDateStr === todayStr);
    const isSelected = (fullDateStr === calendarActiveSelectedDate);

    const restData = AppState.restDaysMap ? AppState.restDaysMap[fullDateStr] : null;
    const hasWorkout = !restData && (AppState.historicalWorkouts[fullDateStr]?.logs?.length > 0);

    const borderClass = isSelected 
      ? 'border-2 border-indigo-500 bg-indigo-950/40 shadow-md shadow-indigo-950/60' 
      : (isToday ? 'border border-sky-500/80 bg-slate-900' : 'border border-slate-800 bg-slate-950/60');
    const textClass = isToday ? 'text-sky-400 font-black' : 'text-slate-300';

    let dotHtml = `<span class="w-1.5 h-1.5"></span>`;
    if (restData) {
      const restCfg = REST_TYPE_CONFIG[restData.type] || REST_TYPE_CONFIG["其他原因"] || { dotClass: "bg-amber-400" };
      dotHtml = `<span class="w-1.5 h-1.5 rounded-full ${restCfg.dotClass}"></span>`;
    } else if (hasWorkout) {
      dotHtml = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/80"></span>`;
    }

    grid.innerHTML += `
      <div onclick="window.calendarMod.selectCalendarDate('${fullDateStr}')" 
           class="h-11 rounded-xl ${borderClass} flex flex-col items-center justify-between py-1 cursor-pointer hover:border-slate-600 transition-all active:scale-95">
        <span class="text-[11px] font-mono leading-none ${textClass}">${day}</span>
        ${dotHtml}
      </div>
    `;
  }
}

export function selectCalendarDate(dateStr, shouldRenderGrid = true) {
  const cleanDate = normalizeDateStr(dateStr);
  calendarActiveSelectedDate = cleanDate;

  const titleEl = document.getElementById('selectedDateTitle');
  if (titleEl) titleEl.innerText = cleanDate;

  if (shouldRenderGrid) {
    renderCalendarGrid();
  }

  const container = document.getElementById('selectedDateDetailsContainer');
  const badge = document.getElementById('daySummaryBadge');
  if (!container || !badge) return;

  const workout = AppState.historicalWorkouts[cleanDate];
  const restData = AppState.restDaysMap ? AppState.restDaysMap[cleanDate] : null;

  if (!workout?.logs?.length) {
    if (restData) {
      const restCfg = REST_TYPE_CONFIG[restData.type] || REST_TYPE_CONFIG["其他原因"] || { label: restData.type, emoji: "📝", badgeClass: "bg-slate-900 text-slate-300 border-slate-700" };
      badge.className = `text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border ${restCfg.badgeClass}`;
      badge.innerText = `${restCfg.emoji} ${restCfg.label}`;

      container.innerHTML = `
        <div class="p-3.5 bg-slate-950/90 rounded-2xl border border-slate-800 space-y-3">
          <div class="flex justify-between items-center pb-2 border-b border-slate-800/80">
            <span class="text-xs font-bold text-slate-200 flex items-center gap-1.5">${restCfg.emoji} 已登記非訓練日：${escapeHtml(restData.type)}</span>
            <button type="button" onclick="window.calendarMod.clearRestDayLog('${cleanDate}')" class="text-[11px] text-rose-400 hover:text-rose-300 font-bold">🗑️ 清除記錄</button>
          </div>
          <div class="text-xs text-slate-300">
            備註原因：<span class="text-slate-400">${escapeHtml(restData.notes || '無特別備註')}</span>
          </div>
        </div>
      `;
    } else {
      badge.className = "text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-slate-800 text-slate-400";
      badge.innerText = "該日無操練";

      container.innerHTML = `
        <div class="p-3.5 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2.5">
          <div class="text-xs font-bold text-slate-300">📝 登記此日未做 Gym 原因 (點擊即儲存)</div>
          <input type="text" id="inputRestNotes_${cleanDate.replace(/-/g, '')}" placeholder="選填備註 (例: 感冒發燒、OT加班、肌肉酸痛)" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 select-text">
          <div class="grid grid-cols-3 gap-1.5 pt-1">
            ${Object.keys(REST_TYPE_CONFIG).map(k => {
              const item = REST_TYPE_CONFIG[k];
              return `
                <button type="button" onclick="window.calendarMod.submitRestDayLog('${cleanDate}', '${k}')" 
                        class="py-2 px-1 rounded-xl text-xs font-bold bg-slate-900 border border-slate-700/80 hover:border-indigo-500 active:scale-95 text-slate-200 transition-all flex flex-col items-center gap-1">
                  <span>${item.emoji}</span>
                  <span class="text-[10px]">${item.label}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
    return;
  }

  const totalDayCalories = workout.logs.reduce((acc, cur) => acc + (parseFloat(cur.calories) || 0), 0);
  badge.className = "text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/50 flex items-center gap-1";
  badge.innerHTML = `<span>完成 ${workout.logs.length} 組/段</span> • <span class="text-amber-400">🔥${Math.round(totalDayCalories)} kcal</span>`;

  const muscleGroups = {};
  workout.logs.forEach(l => {
    const mg = l.muscle_group || '其他';
    if (!muscleGroups[mg]) muscleGroups[mg] = {};
    if (!muscleGroups[mg][l.exercise_name]) muscleGroups[mg][l.exercise_name] = [];
    muscleGroups[mg][l.exercise_name].push(l);
  });

  const muscleGroupsHtml = Object.entries(muscleGroups).map(([muscleName, machineDict]) => {
    let totalSets = 0;
    let muscleTotalCal = 0;
    Object.values(machineDict).forEach(sets => {
      totalSets += sets.length;
      sets.forEach(s => muscleTotalCal += (parseFloat(s.calories) || 0));
    });
    const safeMuscleName = escapeHtml(muscleName);

    const machinesHtml = Object.entries(machineDict).map(([mName, sets]) => {
      const isCardio = isCardioEquipment(mName, muscleName, sets[0]);
      const safeMName = escapeHtml(mName);
      const machineCal = sets.reduce((sum, s) => sum + (parseFloat(s.calories) || 0), 0);

      const setRows = sets.map((s, idx) => {
        const sideTag = (s.side === "L") ? '<span class="text-amber-400 mr-1 font-bold">[左手 L]</span>' : (s.side === "R" ? '<span class="text-amber-400 mr-1 font-bold">[右手 R]</span>' : '');
        const dur = s.set_duration_sec || s.duration_sec || 0;
        const extra = [s.speed ? `速:${s.speed}` : '', s.incline ? `斜:${s.incline}%` : ''].filter(Boolean).join(' | ');
        const calDisplay = s.calories ? `<span class="text-amber-400 font-bold ml-1">🔥${s.calories}kcal</span>` : '';

        const displayVal = isCardio 
          ? `${Math.floor(dur / 60)}分${dur % 60}秒 (${escapeHtml(extra)}) ${calDisplay}`
          : `${Number(s.weight)} ${escapeHtml(s.unit)} × ${Number(s.reps)} 下 ${calDisplay}`;

        return `
          <div class="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/50 last:border-none font-mono">
            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-slate-500 text-[11px] w-9">第 ${s.set_num || (idx + 1)} ${isCardio ? '段' : '組'}</span>
              ${sideTag}
              <span class="text-slate-100 font-bold">${displayVal}</span>
            </div>
            <div class="text-[11px] text-slate-400 flex items-center gap-1.5 flex-shrink-0">
              <span class="text-emerald-400/90">做 ${dur}s</span>
              <span class="text-slate-600">/</span>
              <span class="text-amber-400/90">休 ${s.rest_duration_sec || 0}s</span>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="bg-slate-950/80 p-3 rounded-xl border border-slate-800/90 space-y-1.5">
          <div class="flex justify-between items-center pb-1 border-b border-slate-800">
            <span class="font-bold text-slate-200 text-xs flex items-center gap-1.5"><span>🏋️</span> ${safeMName}</span>
            <div class="flex items-center gap-1.5">
              <span class="text-amber-400 font-mono text-[10px] bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">🔥${Math.round(machineCal)}kcal</span>
              <span class="text-indigo-400 font-mono text-[11px] bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">${sets.length} ${isCardio ? '段' : '組'}</span>
            </div>
          </div>
          <div class="space-y-0.5">${setRows}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="space-y-2 pt-1">
        <div class="flex items-center justify-between px-1">
          <span class="text-xs font-black text-indigo-400 uppercase tracking-wider flex items-center gap-1.5"><span class="w-1.5 h-3 bg-indigo-500 rounded-full inline-block"></span>${safeMuscleName} 部位訓練</span>
          <span class="text-[11px] text-slate-400 font-mono">小計: ${totalSets} ${muscleName === '帶氧' ? '段' : '組'} (🔥${Math.round(muscleTotalCal)}kcal)</span>
        </div>
        <div class="space-y-2">${machinesHtml}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="p-3 bg-indigo-950/20 border border-indigo-800/40 rounded-xl text-xs space-y-1.5 select-text">
      <div class="flex justify-between text-indigo-300 font-semibold">
        <span>訓練部位: <b class="text-white">${escapeHtml(workout.muscle_group || '綜合')}</b></span>
        <span>總時長: <b class="text-white">${workout.total_duration_min ? workout.total_duration_min + ' 分鐘' : '--'}</b></span>
      </div>
      <div class="flex justify-between items-center text-[11px] text-slate-400 font-mono">
        <span>時間: ${escapeHtml(workout.start_time || '--')} 至 ${escapeHtml(workout.end_time || '--')}</span>
        <span class="text-amber-300 font-bold bg-amber-950/80 border border-amber-700/50 px-2 py-0.5 rounded">總消耗: 🔥${Math.round(totalDayCalories)} kcal</span>
      </div>
    </div>
    <div class="space-y-4 select-text">${muscleGroupsHtml}</div>
    ${workout.ai_advice ? `<div class="p-3 bg-slate-950 border border-emerald-500/30 rounded-xl space-y-1 select-text"><span class="text-xs font-bold text-emerald-400 flex items-center gap-1">🤖 AI 教練建議</span><div class="prose-gym">${marked.parse(workout.ai_advice)}</div></div>` : ''}
  `;
}

export async function submitRestDayLog(dateStr, type) {
  const inputEl = document.getElementById(`inputRestNotes_${dateStr.replace(/-/g, '')}`);
  const notes = inputEl ? inputEl.value.trim() : "";

  if (!AppState.restDaysMap) AppState.restDaysMap = {};
  AppState.restDaysMap[dateStr] = { type: type, notes: notes };

  if (AppState.historicalWorkouts && AppState.historicalWorkouts[dateStr]) {
    delete AppState.historicalWorkouts[dateStr];
  }

  localStorage.setItem('gym_rest_days_cache', JSON.stringify(AppState.restDaysMap));
  renderCalendarGrid();
  selectCalendarDate(dateStr, false);

  await sendGasRequest("saveRestDay", { date: dateStr, type: type, notes: notes });
}

export async function clearRestDayLog(dateStr) {
  if (!confirm(`確定清除 ${dateStr} 的非訓練日記錄嗎？`)) return;
  if (AppState.restDaysMap) delete AppState.restDaysMap[dateStr];
  localStorage.setItem('gym_rest_days_cache', JSON.stringify(AppState.restDaysMap));
  renderCalendarGrid();
  selectCalendarDate(dateStr, false);

  await sendGasRequest("deleteRestDay", { date: dateStr });
}

const calendarExports = {
  initCalendarView,
  changeMonth,
  onCalendarSelectChange,
  selectCalendarDate,
  renderCalendarGrid,
  submitRestDayLog,
  clearRestDayLog
};

window.calendarMod = calendarExports;
Object.assign(window, calendarExports);