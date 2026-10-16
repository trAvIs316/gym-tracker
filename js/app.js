// js/app.js - 總入口調度 (全域容錯防禦版)
import { initApiKeyFromUrl } from './api.js';
import { initTrackerView } from './modules/tracker.js';
import { initCalendarView } from './modules/calendar.js';
import { initAiView, populateAiMachineSelector } from './modules/ai.js';
import { initSettingsPageView } from './modules/settings.js';
import { initTwinView } from './modules/twin.js';

export function switchMainView(viewName) {
  const views = {
    tracker: document.getElementById('viewTrackerPage'),
    calendar: document.getElementById('viewCalendarPage'),
    ai: document.getElementById('viewAiPage'),
    settings: document.getElementById('viewSettingsPage'),
    twin: document.getElementById('viewTwinPage')
  };

  const tabs = {
    tracker: document.getElementById('navTabTracker'),
    calendar: document.getElementById('navTabCalendar'),
    ai: document.getElementById('navTabAi'),
    settings: document.getElementById('navTabSettings'),
    twin: document.getElementById('navTabTwin')
  };

  Object.keys(views).forEach(k => {
    if (views[k]) views[k].classList.toggle('hidden', k !== viewName);
    if (tabs[k]) {
      const isActive = (k === viewName);
      tabs[k].className = isActive 
        ? "w-12 h-12 rounded-full text-xl transition-all flex items-center justify-center bg-indigo-600 text-white shadow-md shadow-indigo-950/60 active:scale-90"
        : "w-12 h-12 rounded-full text-xl transition-all flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/60 active:scale-90";
    }
  });

  // 獨立 Try-Catch 保護：確保任何單一頁面錯誤絕不影響其他按鈕！
  try {
    if (viewName === 'calendar') {
      initCalendarView();
    } else if (viewName === 'settings') {
      initSettingsPageView();
    } else if (viewName === 'ai') {
      initAiView();
      populateAiMachineSelector();
    } else if (viewName === 'twin') {
      initTwinView();
    }
  } catch (err) {
    console.error(`切換至 ${viewName} 時發生異常:`, err);
  }
}

// 掛載至全域
window.switchMainView = switchMainView;

window.addEventListener('DOMContentLoaded', () => {
  try {
    initApiKeyFromUrl();
    initTrackerView();
  } catch (err) {
    console.error("Tracker 初始化異常:", err);
  }
});
