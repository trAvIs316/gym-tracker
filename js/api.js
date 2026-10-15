// js/api.js - 統一負責 API Key 管理與 Google Apps Script 通訊
import { CONFIG } from './config.js';

export function initApiKeyFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const k = params.get('key');
    if (k && k.trim() !== "") {
      localStorage.setItem('gym_api_key', k.trim());
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  } catch (_) {}
}

export function getGymApiKey() {
  return (localStorage.getItem('gym_api_key') || "").trim();
}

export async function sendGasRequest(action, data = {}) {
  const curKey = getGymApiKey();
  if (!curKey) {
    if (window.switchMainView) window.switchMainView('settings');
    return { status: "error", message: "Missing API Key" };
  }

  try {
    const payload = {
      action: action,
      apiKey: curKey,
      data: data
    };

    const res = await fetch(CONFIG.GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.warn("GAS 請求失敗:", err);
    return { status: "error", message: err.toString() };
  }
}