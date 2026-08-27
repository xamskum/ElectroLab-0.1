/** localStorage progress / settings */

export interface ProgressData {
  maxLevel: number;
  sound: boolean;
  completedLevels: number[];
}

const KEY = 'electrolab_save_v1';

export function loadSave(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { maxLevel: 1, sound: true, completedLevels: [] };
}

export function saveProgress(data: ProgressData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export function markLevelComplete(level: number) {
  const s = loadSave();
  if (!s.completedLevels.includes(level)) s.completedLevels.push(level);
  s.maxLevel = Math.max(s.maxLevel, level);
  saveProgress(s);
}
