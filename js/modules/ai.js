// js/modules/ai.js - 完整還原 CSCS & ISSN 深度科學 Prompt 與圖表分析
import { AppState } from '../config.js';
import { sendGasRequest } from '../api.js';
import { escapeHtml, getUserWeight, normalizeDateStr, isCardioEquipment } from '../utils.js';
import { getAccurateElapsedWorkoutSeconds } from './tracker.js';

let aiChartInstance = null;
let isChatEventBound = false;

export function initAiView() {
  populateAiMachineSelector();
  if (!isChatEventBound) {
    document.getElementById('inputChatMessage')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });
    isChatEventBound = true;
  }
}

export function populateAiMachineSelector() {
  const selector = document.getElementById('aiMachineSelector');
  if (!selector) return;

  const allMachines = Object.keys(AppState.customMachineSettings);
  if (allMachines.length === 0) {
    selector.innerHTML = '<option value="">(尚未登記器材)</option>';
    return;
  }

  selector.innerHTML = allMachines.map(m => {
    const isSelected = (m === AppState.currentSelectedMachine);
    return `<option value="${escapeHtml(m)}" ${isSelected ? 'selected' : ''}>${escapeHtml(m)}</option>`;
  }).join('');

  if (!AppState.currentSelectedMachine && allMachines.length > 0) {
    AppState.currentSelectedMachine = allMachines[0];
  }
}

export function onAiMachineSelectorChange(machineName) {
  if (!machineName) return;
  AppState.currentSelectedMachine = machineName;
  const s = AppState.customMachineSettings[machineName];
  if (s && s.muscle_group) AppState.currentMuscleGroup = s.muscle_group;
}

export function renderChartOnCanvas(type, labels, datasets) {
  const canvasEl = document.getElementById('aiAnalyticsCanvas');
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  if (aiChartInstance) aiChartInstance.destroy();

  aiChartInstance = new Chart(ctx, {
    type: type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(51, 65, 85, 0.4)' } },
        y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(51, 65, 85, 0.4)' } }
      }
    }
  });
}

export async function triggerGeminiAnalysis(type) {
  const contentEl = document.getElementById('aiAdviceContent');
  const chartContainer = document.getElementById('aiChartContainer');
  const chartTitle = document.getElementById('aiChartTitle');

  contentEl.innerHTML = `
    <div class="flex items-center gap-2 text-indigo-400 py-2">
      <span class="animate-spin text-base">⏳</span>
      <span class="font-bold">CSCS & ISSN 智能教練正在深入計算推比與營養數據，請稍候...</span>
    </div>
  `;
  chartContainer.classList.remove('hidden');

  const userWeightKg = getUserWeight();
  const userWeightLb = Math.round(userWeightKg * 2.20462262);

  if (type === 'machine_progress') {
    const selector = document.getElementById('aiMachineSelector');
    const targetMachine = (selector && selector.value) ? selector.value : (AppState.currentSelectedMachine || Object.keys(AppState.customMachineSettings)[0]);

    if (!targetMachine) {
      alert("尚未登記或選擇任何器材！");
      chartContainer.classList.add('hidden');
      contentEl.innerText = "請先新增或選擇器材。";
      return;
    }

    chartTitle.innerText = `${targetMachine} 總容量與 1RM 追蹤趨勢`;

    const datesMap = {};
    Object.keys(AppState.historicalWorkouts).sort().forEach(d => {
      const dayLogs = AppState.historicalWorkouts[d]?.logs || [];
      dayLogs.filter(l => l.exercise_name === targetMachine).forEach(l => {
        const w = parseFloat(l.weight_kg || l.weight) || 0;
        const r = parseInt(l.reps, 10) || 0;
        const vol = w * r;
        const est1RM = Math.round(w * (1 + r / 30) * 10) / 10;
        if (!datesMap[d]) datesMap[d] = { volume: 0, max1RM: 0, sets: 0 };
        datesMap[d].volume += vol;
        datesMap[d].sets += 1;
        if (est1RM > datesMap[d].max1RM) datesMap[d].max1RM = est1RM;
      });
    });

    const todayStr = normalizeDateStr(document.getElementById('displayDate').innerText);
    AppState.workoutLogs.filter(l => l.exercise_name === targetMachine).forEach(l => {
      const w = parseFloat(l.weight_kg || l.weight) || 0;
      const r = parseInt(l.reps, 10) || 0;
      const vol = w * r;
      const est1RM = Math.round(w * (1 + r / 30) * 10) / 10;
      if (!datesMap[todayStr]) datesMap[todayStr] = { volume: 0, max1RM: 0, sets: 0 };
      datesMap[todayStr].volume += vol;
      datesMap[todayStr].sets += 1;
      if (est1RM > datesMap[todayStr].max1RM) datesMap[todayStr].max1RM = est1RM;
    });

    const labels = Object.keys(datesMap);
    if (labels.length === 0) {
      contentEl.innerText = `器材【${targetMachine}】目前尚無足夠組數資料！請先在主頁面進行至少 1 組記錄。`;
      chartContainer.classList.add('hidden');
      return;
    }

    const volumes = labels.map(l => datesMap[l].volume);
    const oneRMs = labels.map(l => datesMap[l].max1RM);

    renderChartOnCanvas('line', labels, [
      { label: '總容量 (kg)', data: volumes, borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.2)', tension: 0.3 },
      { label: '推估 1RM (kg)', data: oneRMs, borderColor: '#f59e0b', borderDash: [5, 5], tension: 0.3 }
    ]);

    const historySummary = labels.map(l => `${l}: 容量${datesMap[l].volume}kg, 1RM ${datesMap[l].max1RM}kg (${datesMap[l].sets}組)`).join(' | ');

    const prompt = `你是一位具備 CSCS（肌力與體能訓練專家）及 ISSN（國際運動營養學會）認證的 AI 力量訓練科學教練兼運動營養數據分析師。

### 格式與語氣核心要求：
1. **嚴禁任何客氣寒暄語**（絕對不要出現「你好」、「我是你的...」、「很高興為你分析」等開場白，第一句立刻切入分析）。
2. **輸出結構化且易讀**：善用清晰的小標題（##）、Point Form（條列清單 * ）、**粗體強調關鍵數字**、*斜體*、適量 Emoji（🏋️, 🔥, 🍽️, 📈, ⚖️）及 Markdown 格式。

### 學員固定檔案：
- 身高：173 cm | 基準體重：${userWeightLb}lb (${userWeightKg} kg) | 目標：肌肥大 (Hypertrophy) | BMR：1,650-1,700 kcal

### 分析器材：【${targetMachine}】
- 歷史與今日組數：${historySummary}
- 今日：總容量 ${datesMap[todayStr] ? datesMap[todayStr].volume : 0} kg, 1RM ${datesMap[todayStr] ? datesMap[todayStr].max1RM : 0} kg。

請嚴格按以下 4 大區塊輸出（直接以 ## 開頭）：
## 🏋️ 訓練表現與推比分析
- 以 ${userWeightKg}kg 體重計算主力動作推比 [推比 = 組重量 / ${userWeightKg}kg]。
- 診斷力量水平與神經徵召。

## 🔥 總容量負荷與做組強度
- 條列漸進超負荷達成情況與容量（Volume）推移。

## 🍽️ 客製化練後飲食補充處方
- **蛋白質**：練後 2 小時內補充 **30g - 40g** 高生物價蛋白質（附食物選項如乳清或雞胸肉，達白胺酸 Leucine 刺激門檻）。
- **碳水化合物**：依做組負荷給予 **0.8 - 1.2g/kg** 碳水補充量（精確至克數與食物對照）。
- **水份電解質**：補充指引。

## 📈 下週期超負荷指令
- 明確指定下回起始重量調整（如加 2.5kg）或目標次數。`;

    const res = await sendGasRequest("callGemini", { prompt });
    if (res.status === "success") {
      contentEl.innerHTML = marked.parse(res.reply.trim());
    } else {
      contentEl.innerText = `AI 點評失敗: ${res.message}`;
    }

  } else if (type === 'today_workout') {
    chartTitle.innerText = "今日訓練各器材總容量 (Volume Load) 對比";

    const todayStr = normalizeDateStr(document.getElementById('displayDate').innerText);
    let todayLogs = (AppState.workoutLogs && AppState.workoutLogs.length > 0) 
      ? AppState.workoutLogs 
      : (AppState.historicalWorkouts[todayStr]?.logs || []);

    if (!todayLogs || todayLogs.length === 0) {
      contentEl.innerText = "今日尚未完成任何組數記錄！請先開始訓練並完成至少 1 組器材。";
      chartContainer.classList.add('hidden');
      return;
    }

    const machineMap = {};
    let totalWorkoutCal = 0;
    let totalStrengthSets = 0;
    let totalCardioSets = 0;

    todayLogs.forEach(l => {
      const mName = l.exercise_name || "未知器材";
      const isCardio = isCardioEquipment(mName, l.muscle_group, l);
      if (!machineMap[mName]) machineMap[mName] = { volume: 0, sets: 0, isCardio: isCardio, calories: 0, maxWeight: 0, maxReps: 0 };

      machineMap[mName].sets += 1;
      const cal = parseFloat(l.calories) || 0;
      machineMap[mName].calories += cal;
      totalWorkoutCal += cal;

      if (isCardio) {
        totalCardioSets += 1;
      } else {
        totalStrengthSets += 1;
        const w = parseFloat(l.weight_kg || l.weight) || 0;
        const r = parseInt(l.reps, 10) || 0;
        machineMap[mName].volume += (w * r);
        if (w > machineMap[mName].maxWeight) {
          machineMap[mName].maxWeight = w;
          machineMap[mName].maxReps = r;
        }
      }
    });

    const labels = Object.keys(machineMap);
    const volumes = labels.map(k => machineMap[k].volume);

    renderChartOnCanvas('bar', labels, [
      { label: '器材總容量 (kg)', data: volumes, backgroundColor: 'rgba(99, 102, 241, 0.7)', borderColor: '#6366f1', borderRadius: 6 }
    ]);

    const histData = AppState.historicalWorkouts[todayStr];
    const totalMin = histData?.total_duration_min 
      ? Math.round(histData.total_duration_min) 
      : Math.round(getAccurateElapsedWorkoutSeconds() / 60);

    const machinesSummaryText = labels.map(k => {
      return `${k}: ${machineMap[k].sets}組/段 (容量:${machineMap[k].volume}kg, 最高:${machineMap[k].maxWeight}kg×${machineMap[k].maxReps}下, 🔥${Math.round(machineMap[k].calories)}kcal)`;
    }).join(' | ');

    const muscleGroupToday = histData?.muscle_group || AppState.currentMuscleGroup;
    const timelineText = (AppState.timelineEvents && AppState.timelineEvents.length > 0)
      ? AppState.timelineEvents.slice(-8).join(" -> ")
      : (histData?.timeline_text || "今日已完成結算存檔");

    const prompt = `你是一位具備 CSCS（肌力與體能訓練專家）及 ISSN（國際運動營養學會）認證的 AI 力量訓練科學教練兼運動營養數據分析師。

### 格式與語氣核心要求：
1. **嚴禁任何客氣寒暄語**（直接開門見山，第一句立刻進報告）。
2. **輸出結構化且易讀**：大量使用 Point Form（條列清單）、**粗體強調關鍵數字**、*斜體*、適量 Emoji（🏋️, 🔥, 🍽️, 📈, ⚖️）及 Markdown 格式。

### 學員固定檔案：
- 身高：173 cm | 基準體重：${userWeightLb}lb (${userWeightKg} kg) | 目標：肌肥大 (Hypertrophy) | BMR：1,650-1,700 kcal

### 今日全場訓練數據：
- 當日部位：${muscleGroupToday}
- 訓練總時長：約 ${totalMin} 分鐘 (重訓 ${totalStrengthSets} 組, 帶氧 ${totalCardioSets} 段)
- 系統累計消耗：約 ${Math.round(totalWorkoutCal)} kcal
- 器材明細：${machinesSummaryText}
- 時間線流水帳：${timelineText}

請嚴格按以下 4 大區塊輸出（直接以 ## 開頭）：
## 🏋️ 全場訓練質量與容量總評
- 評估部位刺激密度與總噸位。
- 計算主力動作推比 [組重量 / ${userWeightKg}kg]。

## 🔥 總消耗卡路里推算
- 結合代謝當量（METs 5.0-6.0 及高強度 7.0-8.5），列出精確淨消耗區間。

## 🍽️ 當日與練後飲食補充處方
- **蛋白質**：練後 2 小時內補充 **30g - 40g** 高生物價蛋白質（附具體食物選項與克數）。
- **碳水化合物**：依做組負荷給予 **0.8 - 1.2g/kg**（約 ${Math.round(userWeightKg * 0.8)}g - ${Math.round(userWeightKg * 1.2)}g 碳水），附白飯、香蕉、貝果等對照。
- **水份電解質**：補充量。

## 📈 下週期超負荷指令
- 明確列出哪些器材下次增加 2.5kg 或增加 1-2 下。`;

    const res = await sendGasRequest("callGemini", { prompt });
    if (res.status === "success") {
      contentEl.innerHTML = marked.parse(res.reply.trim());
    } else {
      contentEl.innerText = `AI 點評失敗: ${res.message}`;
    }
  }
}

export async function sendChatMessage() {
  const inputEl = document.getElementById('inputChatMessage');
  const text = inputEl.value.trim();
  if (!text) return;

  const container = document.getElementById('chatMessagesContainer');
  const btn = document.getElementById('btnSendChat');

  container.innerHTML += `
    <div class="flex justify-end select-text">
      <div class="bg-indigo-600 text-white p-2.5 rounded-xl max-w-[85%] text-xs shadow-md select-text cursor-text">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
  inputEl.value = "";
  btn.disabled = true;

  const loadingId = "chat_loading_" + Date.now();
  container.innerHTML += `
    <div id="${loadingId}" class="bg-slate-900 p-2.5 rounded-xl border border-slate-800 text-slate-400 max-w-[85%] text-xs flex items-center gap-1 select-none">
      <span class="animate-spin text-sm">⏳</span> <span>CSCS & ISSN 教練深度分析中...</span>
    </div>
  `;
  container.scrollTop = container.scrollHeight;

  const userWeightKg = getUserWeight();
  const userWeightLb = Math.round(userWeightKg * 2.20462262);

  const todayStr = normalizeDateStr(document.getElementById('displayDate').innerText);
  const histToday = AppState.historicalWorkouts[todayStr];
  const todayLogs = (AppState.workoutLogs && AppState.workoutLogs.length > 0)
    ? AppState.workoutLogs
    : (histToday?.logs || []);

  const machineSummaryMap = {};
  let totalDayCalories = 0;
  let totalStrengthSets = 0;
  let totalCardioSets = 0;

  todayLogs.forEach(l => {
    const mName = l.exercise_name || "未知器材";
    const isCardio = isCardioEquipment(mName, l.muscle_group, l);
    const cal = parseFloat(l.calories) || 0;
    totalDayCalories += cal;

    if (!machineSummaryMap[mName]) {
      machineSummaryMap[mName] = { sets: 0, volume: 0, isCardio: isCardio, maxWeight: 0, maxReps: 0 };
    }
    machineSummaryMap[mName].sets += 1;

    if (isCardio) {
      totalCardioSets += 1;
    } else {
      totalStrengthSets += 1;
      const w = parseFloat(l.weight_kg || l.weight) || 0;
      const r = parseInt(l.reps, 10) || 0;
      machineSummaryMap[mName].volume += (w * r);
      if (w > machineSummaryMap[mName].maxWeight) {
        machineSummaryMap[mName].maxWeight = w;
        machineSummaryMap[mName].maxReps = r;
      }
    }
  });

  const allMachinesOverview = Object.keys(machineSummaryMap).map(k => {
    const item = machineSummaryMap[k];
    return item.isCardio
      ? `【${k}】${item.sets}段帶氧`
      : `【${k}】${item.sets}組 (最高 ${item.maxWeight}kg×${item.maxReps}下, 總容量 ${item.volume}kg)`;
  }).join('； ') || "今日尚無訓練組數";

  const totalMin = histToday?.total_duration_min 
    ? Math.round(histToday.total_duration_min) 
    : Math.round(getAccurateElapsedWorkoutSeconds() / 60);

  const muscleGroupToday = histToday?.muscle_group || AppState.currentMuscleGroup;

  const allDatesSet = new Set([
    ...Object.keys(AppState.historicalWorkouts || {}),
    ...Object.keys(AppState.restDaysMap || {})
  ]);
  const sortedHistoryDates = Array.from(allDatesSet).sort().reverse();

  const recentHistoryList = sortedHistoryDates.slice(0, 14).map(d => {
    const h = AppState.historicalWorkouts[d];
    if (h && h.logs && h.logs.length > 0) {
      let dCal = 0;
      const dMachines = {};
      h.logs.forEach(l => {
        dCal += (parseFloat(l.calories) || 0);
        const name = l.exercise_name || '動作';
        dMachines[name] = (dMachines[name] || 0) + 1;
      });
      const mSummary = Object.entries(dMachines).map(([nm, cnt]) => `${nm} ${cnt}組/段`).join(', ');
      return `• 【${d}】部位:${h.muscle_group || '綜合'} | 時長:${h.total_duration_min || '--'}分 | 總組數:${h.logs.length}組 | 消耗:約${Math.round(dCal)}kcal | 器材:[${mSummary}]`;
    }
    const r = AppState.restDaysMap ? AppState.restDaysMap[d] : null;
    if (r) {
      return `• 【${d}】非訓練日 (${r.type}) | 原因備註: ${r.notes || '無'}`;
    }
    return null;
  }).filter(Boolean).join('\n') || "暫無過往歷史紀錄";

  const fullPrompt = `你是一位具備 CSCS（肌力與體能訓練專家）及 ISSN（國際運動營養學會）認證的 AI 力量訓練科學教練兼運動營養數據分析師。你的職責是綜觀學員全場訓練數據，進行力量超負荷分析，並提供精確到「克數（g）」與「大卡（kcal）」的運動後飲食營養補充處方。

### 格式與語氣核心要求：
1. **嚴禁任何客氣寒暄語**（絕對禁止「你好！」、「我是你的...」、「收到你的問題」等無效開場白，第一句直接切入重點回答）。
2. **輸出結構化且易讀**：大量使用小標題（##）、Point Form（條列清單 * ）、**粗體強調關鍵字與數值**、*斜體*、適量 Emoji 及清晰段落，若涉及多組數對照可適度使用 Markdown 表格。

### 學員固定個人生理檔案（已鎖定）：
- 身高：173 cm
- 基準體重 BW：${userWeightLb}lb (${userWeightKg} kg)
- 核心目標：肌肥大（增肌 Hypertrophy，維持精瘦體態）
- 基礎代謝率 BMR 約略值：約 1,650 - 1,700 kcal / 日

### 系統當前基準日期：
- 今天日期是：${todayStr}

### 今日全場訓練實況匯總 (${todayStr})：
- 訓練部位：${muscleGroupToday}
- 總時長：約 ${totalMin} 分鐘 (重訓 ${totalStrengthSets} 組，帶氧 ${totalCardioSets} 段)
- 系統累計總消耗：約 ${Math.round(totalDayCalories)} kcal
- 完成器材及表現明細：${allMachinesOverview}

### 過往歷史訓練與休假資料庫 (最近紀錄)：
${recentHistoryList}

---
### 核心指導準則（請嚴格遵守並作深度充分闡述）：
1. **精準識別問題時間與全場表現**：
   - 若學員詢問「今日」，依【今日全場訓練實況匯總】分析。
   - 若學員詢問「昨日 / 前日 / 上次 / 某月某日 / 一星期規律」，請務必依【過往歷史訓練與休假資料庫】中相應日期的資料回答。
   - 不要只盯著單一動作！評估學員總容量與主力動作的推比水準 [組重量(kg) / ${userWeightKg}kg]，給予客觀深度的 CSCS 訓練強度與疲勞評估。
2. **超負荷與痛症/弱點排查**：
   - 若涉及痛症或疲勞，從動作解剖學、力竭程度與累積容量詳細排查可能誘發的項目。
   - 指出哪些動作需要漸進超負荷（加重 2.5kg 或增加 1-2 下）。
3. **ISSN 克數級營養補充處方**：
   - 練後黃金窗口：建議攝入 **30g - 40g 高生物價蛋白質**（如乳清 1.5 匙或熟雞胸 150g），達白胺酸 Leucine 門檻以最大化肌肉蛋白質合成（MPS）。
   - 碳水儲備：依消耗給予 **0.8 - 1.2g/kg**（約 ${Math.round(userWeightKg * 0.8)}g - ${Math.round(userWeightKg * 1.2)}g 碳水）補充指引，並詳細對照白飯、香蕉、Bagel 等具體食物。
   - 水分與電解質補充提醒。
4. **日常問題應對**：若學員提問非健身話題，以簡短生活常識自然應對即可，切勿生硬拒絕或報錯。

---
學員提問：${text}

請以繁體中文回答，進行詳盡、專業且具備運動科學根據的深度解析：`;

  const res = await sendGasRequest("callGemini", { prompt: fullPrompt });
  const loadingEl = document.getElementById(loadingId);

  if (res.status === "success") {
    if (loadingEl) {
      loadingEl.className = "bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-200 max-w-[90%] prose-gym select-text cursor-text";
      loadingEl.innerHTML = marked.parse(res.reply.trim());
    }
  } else {
    if (loadingEl) {
      loadingEl.className = "bg-rose-950/60 p-2.5 rounded-xl border border-rose-800/60 text-rose-300 max-w-[85%] select-text";
      loadingEl.innerText = `無法取得教練回覆: ${res.message || '請檢查網路連線或 API Key 設定'}`;
    }
  }

  btn.disabled = false;
  container.scrollTop = container.scrollHeight;
}

const aiExports = {
  initAiView,
  populateAiMachineSelector,
  onAiMachineSelectorChange,
  triggerGeminiAnalysis,
  sendChatMessage
};

window.aiMod = aiExports;
Object.assign(window, aiExports);