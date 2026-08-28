import { BleClient } from "./ble.js";
import { Governor } from "./governor.js";

export const ble = new BleClient();
export const governor = new Governor();

let connected = false;
let uplink = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn({ connected, uplink });
}

export function subscribe(fn) {
  listeners.add(fn);
  fn({ connected, uplink });
  return () => listeners.delete(fn);
}

export function getConnected() {
  return connected;
}

export function getUplink() {
  return uplink;
}

ble.onConnected((ok) => {
  connected = ok;
  if (!ok) uplink = null;
  notify();
});

ble.onUplink((u) => {
  uplink = u;
  governor.ingest(u);
  notify();
});

/**
 * 发指令的唯一入口。所有界面都必须走这里，不许直接摸 BleClient——
 * 绕过去就等于绕过了安全总督。
 *
 * 返回 null 表示已发出，否则是拒绝理由，直接展示给用户。
 */
export async function sendCommand(cmd, { automatic = false } = {}) {
  const reason = governor.reject(cmd, { automatic });
  if (reason != null) return reason;
  try {
    await ble.send(cmd);
    return null;
  } catch (err) {
    return `发送失败：${err.message || err}`;
  }
}
