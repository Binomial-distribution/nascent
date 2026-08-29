import { Governor } from "./governor.js";
import { TransportClient } from "./transport.js";

/**
 * 与玩具的唯一那条连接。可能走 BLE 也可能走 WiFi WebSocket，由
 * TransportClient 选路；这一层和界面都不需要知道当前是哪一条。
 *
 * 0.3.0 之前它叫 `ble`，现在改名是因为"蓝牙"不再等于"设备连接"。
 */
export const link = new TransportClient();
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

link.onConnected((ok) => {
  connected = ok;
  if (!ok) uplink = null;
  notify();
});

link.onUplink((u) => {
  uplink = u;
  governor.ingest(u);
  notify();
});

link.onStats(() => {
  notify();
});

/**
 * 发指令的唯一入口。所有界面都必须走这里，不许直接摸传输层——
 * 绕过去就等于绕过了安全总督。
 *
 * 返回 null 表示已发出，否则是拒绝理由，直接展示给用户。
 */
export async function sendCommand(cmd, { automatic = false } = {}) {
  const reason = governor.reject(cmd, { automatic });
  if (reason != null) return reason;
  try {
    await link.send(cmd);
    return null;
  } catch (err) {
    return `发送失败：${err.message || err}`;
  }
}
