import { AppState } from './config.js';

// 1. XSS 防護與字串清洗
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 2. 日期字串正規化 (YYYY-MM-DD)
export function normalizeDateStr(str) {
  if (!str) return "";
  const parts = String(str).replace(/'/g, "").trim().split(/[-\/]/);
  return parts.length >= 3 ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}` : str;
}

// 3. 判斷器材是否為帶氧設備
export function isCardioEquipment(name, muscle, item = null) {
  if (item && (item.unit === "--" || (Number(item.weight) === 0 && Number(item.reps) === 0 && item.speed !== undefined))) return true;
  if (muscle === "帶氧") return true;
  if (!name) return false;
  const lower = name.toLowerCase();
  return ["跑", "樓梯", "划船", "單車", "踏步", "treadmill", "stair", "bike", "cardio"].some(k => lower.includes(k));
}

// 4. 體重讀取 (來自 localStorage，預設 70.8kg)
export function getUserWeight() {
  const storedKg = parseFloat(localStorage.getItem('gym_user_weight_kg'));
  return (!isNaN(storedKg) && storedKg > 0) ? storedKg : 70.8;
}

// 5. 帶氧運動卡路里計算 (ACSGM VO2 公式)
export function calculateCardioCalories(speedKmh, inclinePct, durationSec) {
  if (!durationSec || durationSec <= 0) return 0;
  const userWeightKg = getUserWeight();
  const speed = Math.max(0, parseFloat(speedKmh) || 0);
  const incline = Math.max(0, parseFloat(inclinePct) || 0) / 100;
  const speedMMin = speed * (1000 / 60);
  const durationMin = durationSec / 60;
  const vo2 = (speed <= 6.0) 
    ? ((0.1 * speedMMin) + (1.8 * speedMMin * incline) + 3.5)
    : ((0.2 * speedMMin) + (0.9 * speedMMin * incline) + 3.5);
  return Math.round((vo2 * userWeightKg / 1000) * 5 * durationMin);
}

// 6. 重訓力量消耗卡路里計算 (METs 相對負荷法)
export function calculateStrengthCalories(weightKg, reps, durationSec) {
  const userWeightKg = getUserWeight();
  const wKg = Math.max(0, parseFloat(weightKg) || 0);
  const r = Math.max(1, parseInt(reps, 10) || 1);
  const durSec = (durationSec && durationSec >= 5) ? durationSec : (r * 3.5);
  const durationMin = durSec / 60;

  const relativeLoad = wKg / userWeightKg;
  let baseMet = 5.0;
  if (relativeLoad >= 1.0) baseMet = 6.5;
  else if (relativeLoad >= 0.5) baseMet = 5.5;
  else baseMet = 4.5;

  const cal = ((baseMet * 3.5 * userWeightKg) / 200) * durationMin;
  return Math.max(1, Math.round(cal * 10) / 10);
}

// 7. 手機相片純客戶端壓縮至 Base64 (防止 iOS 旋轉與黑底問題)
export function compressImageToBase64(file, maxWidth = 640, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.match(/image.*/)) {
      return reject(new Error("非圖片檔案"));
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}