/** 情景人设列表：隐藏、置顶、左滑露出操作。 */

export const PERSONA_SWIPE_PX = 136;
export const PERSONA_SWIPE_HOLD_MS = 3000;

export function visibleScenarioItems(items, hiddenKeys = []) {
  const hidden = new Set(hiddenKeys);
  return items.filter((item) => !hidden.has(item.key));
}

export function sortScenarioItems(items, pinnedKeys = []) {
  const order = new Map(pinnedKeys.map((key, index) => [key, index]));
  return [...items].sort((a, b) => {
    const ai = order.has(a.key) ? order.get(a.key) : Number.POSITIVE_INFINITY;
    const bi = order.has(b.key) ? order.get(b.key) : Number.POSITIVE_INFINITY;
    return ai - bi;
  });
}

export function togglePinnedKey(pinnedKeys, key) {
  const list = Array.isArray(pinnedKeys) ? [...pinnedKeys] : [];
  const index = list.indexOf(key);
  if (index >= 0) list.splice(index, 1);
  else list.unshift(key);
  return list;
}
