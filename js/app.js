// js/app.js - 總入口調度
import { initApiKeyFromUrl } from './api.js';
import { initTrackerView } from './modules/tracker.js';
import { initCalendarView } from './modules/calendar.js';
import { initAiView, populateAiMachineSelector } from './modules/ai.js';
import { initSettingsPageView } from './modules/settings.js';

export function switchMainView(viewName) {
  const views = {
    tracker: document.getElementById('viewTrackerPage'),
    calendar: document.getElementById('viewCalendarPage'),
    ai: document.getElementById('viewAiPage'),
    settings: document.getElementById('viewSettingsPage')
  };

  const tabs = {
    tracker: document.getElementById('navTabTracker'),
    calendar: document.getElementById('navTabCalendar'),
    ai: document.getElementById('navTabAi'),
    settings: document.getElementById('navTabSettings')
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

  if (viewName === 'calendar') {
    initCalendarView();
  } else if (viewName === 'settings') {
    initSettingsPageView();
  } else if (viewName === 'ai') {
    initAiView();
    populateAiMachineSelector();
  }
}

window.switchMainView = switchMainView;

window.addEventListener('DOMContentLoaded', () => {
  initApiKeyFromUrl();
  initTrackerView();
});