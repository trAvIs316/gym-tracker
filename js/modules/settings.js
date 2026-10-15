// js/modules/settings.js - 設定、體重換算與 PIN 碼同步模組
import { AppState } from '../config.js';
import { getGymApiKey } from '../api.js';
import { getUserWeight } from '../utils.js';
import { fetchMachineSettingsFromSheets, silentSyncGoogleSheetHistory, refreshActiveEquipmentList } from './tracker.js';

let modalWeightUnit = localStorage.getItem('gym_user_weight_unit') || 'KG';
let currentInputPin = "";

export function initSettingsPageView() {
  const savedKey = getGymApiKey();
  currentInputPin = savedKey;
  updatePinMaskDisplay();

  const baseKg = getUserWeight();
  modalWeightUnit = localStorage.getItem('gym_user_weight_unit') || 'KG';
  setModalWeightUnit(modalWeightUnit, false);

  const weightEl = document.getElementById('inputUserWeight');
  if (weightEl) {
    weightEl.value = (modalWeightUnit === 'LB') ? Math.round(baseKg * 2.20462262) : baseKg;
  }

  const hintEl = document.getElementById('pinStatusHint');
  if (hintEl) {
    hintEl.innerText = savedKey ? "目前已設定密碼 (以 • 遮蔽保護)" : "尚未設定密碼，請輸入純數字 PIN 碼";
  }
}

export function toggleModalWeightUnit() {
  const targetUnit = (modalWeightUnit === 'KG') ? 'LB' : 'KG';
  setModalWeightUnit(targetUnit, true);
}

export function setModalWeightUnit(unit, shouldConvert = true) {
  const oldUnit = modalWeightUnit;
  modalWeightUnit = unit;
  localStorage.setItem('gym_user_weight_unit', unit);

  const isLb = (unit === 'LB');
  const slider = document.getElementById('modalWeightUnitSlider');
  const labelKg = document.getElementById('modalWeightLabelKg');
  const labelLb = document.getElementById('modalWeightLabelLb');
  const btnMinus = document.getElementById('btnModalWeightMinus');
  const btnPlus = document.getElementById('btnModalWeightPlus');

  if (slider) slider.className = `absolute left-0.5 top-0.5 w-[calc(50%-2px)] h-6 bg-indigo-600 rounded-full transition-transform duration-200 shadow-md ${isLb ? 'translate-x-[calc(100%+2px)]' : ''}`;
  if (labelKg) labelKg.className = `relative z-10 w-1/2 text-center text-[10px] font-black ${isLb ? 'text-slate-400' : 'text-white'}`;
  if (labelLb) labelLb.className = `relative z-10 w-1/2 text-center text-[10px] font-black ${isLb ? 'text-white' : 'text-slate-400'}`;

  if (btnMinus) btnMinus.innerText = isLb ? "-2" : "-1";
  if (btnPlus) btnPlus.innerText = isLb ? "+2" : "+1";

  const inputEl = document.getElementById('inputUserWeight');
  if (inputEl && shouldConvert && oldUnit !== unit) {
    const curVal = parseFloat(inputEl.value);
    if (!isNaN(curVal) && curVal > 0) {
      if (unit === 'LB') {
        inputEl.value = Math.round(curVal * 2.20462262);
      } else {
        inputEl.value = Math.round((curVal / 2.20462262) * 2) / 2;
      }
    }
  }
}

export function stepUserWeight(amount) {
  const el = document.getElementById('inputUserWeight');
  if (!el) return;
  const cur = parseFloat(el.value) || (modalWeightUnit === 'LB' ? 156 : 70.8);
  const step = modalWeightUnit === 'LB' ? (amount * 2) : amount;
  el.value = Math.max(10, Math.round((cur + step) * 10) / 10);
}

export function pressPinDigit(digit) {
  if (currentInputPin.length >= 12) return;
  currentInputPin += digit;
  updatePinMaskDisplay();
}

export function backspacePinDigit() {
  currentInputPin = currentInputPin.slice(0, -1);
  updatePinMaskDisplay();
}

export function clearPinInput() {
  currentInputPin = "";
  updatePinMaskDisplay();
}

export function updatePinMaskDisplay() {
  const displayEl = document.getElementById('pinDisplayMask');
  if (!displayEl) return;
  if (!currentInputPin) {
    displayEl.innerText = "------";
    displayEl.className = "h-12 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-center tracking-[0.4em] text-xl font-mono text-slate-700 font-black px-3 select-none";
  } else {
    displayEl.innerText = "•".repeat(currentInputPin.length);
    displayEl.className = "h-12 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-center tracking-[0.4em] text-xl font-mono text-indigo-400 font-black px-3 select-none";
  }
}

export function saveSettingsPage() {
  const weightEl = document.getElementById('inputUserWeight');
  if (weightEl) {
    const inputVal = parseFloat(weightEl.value);
    if (!isNaN(inputVal) && inputVal > 0) {
      const finalKg = (modalWeightUnit === 'LB') 
        ? Number((inputVal / 2.20462262).toFixed(1)) 
        : inputVal;
      localStorage.setItem('gym_user_weight_kg', finalKg);
    }
  }

  const clean = currentInputPin.trim();
  if (!clean) {
    localStorage.removeItem('gym_api_key');
    localStorage.removeItem('gym_historical_workouts_cache');
    AppState.historicalWorkouts = {};
    refreshActiveEquipmentList();
    alert("✅ 設定與體重已儲存 (密碼已清空)！");
    return;
  }

  localStorage.setItem('gym_api_key', clean);
  alert("✅ 設定與個人體重已成功更新！");

  fetchMachineSettingsFromSheets();
  silentSyncGoogleSheetHistory();
}

const settingsExports = {
  initSettingsPageView,
  toggleModalWeightUnit,
  stepUserWeight,
  pressPinDigit,
  backspacePinDigit,
  clearPinInput,
  saveSettingsPage
};

window.settingsMod = settingsExports;
Object.assign(window, settingsExports);