import { BleClient, hasNativeBle } from "./ble.js";
import { WsClient } from "./ws.js";

export { hasNativeBle };

/** website | pwa | android-app */
export function currentShell() {
  if (hasNativeBle()) return "android-app";
  if (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) {
    return "pwa";
  }
  return "website";
}

export const CHANNEL = Object.freeze({ BLE: "ble", WIFI: "wifi" });

export const CHANNEL_LABEL = Object.freeze({
  [CHANNEL.BLE]: "蓝牙（默认）",
  [CHANNEL.WIFI]: "WiFi（备用）",
});

/**
 * 选路层：对外只有一个"设备连接"，内部决定走 BLE 还是 WiFi WebSocket。
 *
 * `send` / `onUplink` / `onConnected` / `connected` / `token` 的形状与
 * 0.3.0 之前的 BleClient 一致，所以 `session.js` 与安全总督那一层不用动——
 * 换传输不该牵动"发指令必须过总督"这条规则。
 *
 * 玩具地址只存在内存里，刷新页面就没了。这与本应用其余部分的做法一致
 *（心绪、笔记、收藏都只保存在本次运行内），不为一个备用通道的便利
 * 开一个新的持久化面。
 */
export class TransportClient {
  constructor() {
    this._ble = new BleClient();
    this._ws = new WsClient();
    this._channel = CHANNEL.BLE;
    this._address = "";

    this._uplinkListeners = new Set();
    this._connectedListeners = new Set();

    // 两条通道的事件都转发到同一组监听者。只有一条会处于连接状态，
    // 所以不需要区分事件来自哪一条。
    this._statsListeners = new Set();

    for (const c of [this._ble, this._ws]) {
      c.onUplink((u) => {
        for (const fn of this._uplinkListeners) fn(u);
      });
      c.onConnected((ok) => {
        for (const fn of this._connectedListeners) fn(ok);
      });
      c.onStats((stats) => {
        for (const fn of this._statsListeners) fn(stats);
      });
    }
  }

  get channel() {
    return this._channel;
  }

  get address() {
    return this._address;
  }

  set address(v) {
    this._address = String(v ?? "").trim();
  }

  /** 当前选中的那条通道。 */
  get active() {
    return this._channel === CHANNEL.WIFI ? this._ws : this._ble;
  }

  get token() {
    return this.active.token;
  }

  get uplinkStats() {
    return this.active.uplinkStats;
  }

  get connected() {
    return this._ble.connected || this._ws.connected;
  }

  get available() {
    return this.active.available;
  }

  /** 当前通道不可用时的原因，直接给用户看。可用时返回 null。 */
  get unavailableReason() {
    return this.active.unavailableReason;
  }

  onUplink(fn) {
    this._uplinkListeners.add(fn);
    return () => this._uplinkListeners.delete(fn);
  }

  onConnected(fn) {
    this._connectedListeners.add(fn);
    return () => this._connectedListeners.delete(fn);
  }

  onStats(fn) {
    this._statsListeners.add(fn);
    return () => this._statsListeners.delete(fn);
  }

  /**
   * 切换通道。已连接时先断开：设备侧两条传输也是互斥的
   *（ESP32-S3 只有一路射频），控制端同时挂着两条只会自欺欺人。
   */
  async setChannel(next) {
    if (next !== CHANNEL.BLE && next !== CHANNEL.WIFI) return;
    if (next === this._channel) return;
    await this.disconnect();
    this._channel = next;
  }

  async connect() {
    // 换通道要走 setChannel，这里只连当前那条，并确保另一条是断的。
    if (this._channel === CHANNEL.WIFI) {
      await this._ble.disconnect();
      await this._ws.connect({ address: this._address });
      return;
    }
    await this._ws.disconnect();
    await this._ble.connect();
  }

  async disconnect() {
    await this._ble.disconnect();
    await this._ws.disconnect();
  }

  async send(cmd) {
    await this.active.send(cmd);
  }
}
