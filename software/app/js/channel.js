import { BleUplink, NlConst } from "./protocol.js";

/**
 * 下行 JSON 去掉 null 字段，避免 BLE MTU 被 `wifi_ssid: null` 这类占位撑满。
 * `set_wifi` 的密码只在有值时出现在载荷里。
 */
export function encodeDownlink(cmd, token) {
  const body = { ...cmd.toJson(), auth: token };
  for (const key of Object.keys(body)) {
    if (body[key] == null) delete body[key];
  }
  return body;
}

/**
 * 两条设备通道（BLE / WiFi WebSocket）的共同部分。
 *
 * 抽出来的理由和固件侧 `downlink_gate` 一样：协议主版本门控和上行解析
 * 是两条通道都必须做对的事，抄成两份之后只改了一边的修补就会让另一条
 * 变成弱点。这一层不碰任何传输细节，只管监听者、令牌和版本。
 */
function emptyUplinkStats() {
  return { notifies: 0, parsed: 0, lastError: "", lastBytes: 0 };
}

export class ChannelBase {
  constructor() {
    this._token = null;
    this._connected = false;
    this._uplinkListeners = new Set();
    this._connectedListeners = new Set();
    this._statsListeners = new Set();
    this._uplinkStats = emptyUplinkStats();
  }

  /** 联调用：Notify 次数 vs 解析成功次数。ts 一直是 — 时看这里。 */
  get uplinkStats() {
    return this._uplinkStats;
  }

  get token() {
    return this._token;
  }

  get connected() {
    return this._connected;
  }

  onUplink(fn) {
    this._uplinkListeners.add(fn);
    return () => this._uplinkListeners.delete(fn);
  }

  onConnected(fn) {
    this._connectedListeners.add(fn);
    return () => this._connectedListeners.delete(fn);
  }

  /** Notify 到了但解不出 JSON 时，联调页需要刷新计数，不能只等合法上行。 */
  onStats(fn) {
    this._statsListeners.add(fn);
    return () => this._statsListeners.delete(fn);
  }

  /**
   * 接受设备的握手信息：`{ proto, token }`。
   *
   * BLE 从 Info 特征读到它，WebSocket 是连上后设备主动推的第一帧。
   * 只校验**主**版本：minor 变更按契约是向后兼容的字段追加，
   * 卡 minor 会让一次纯文档级的协议改动把所有旧固件挡在门外。
   */
  _acceptInfo(info) {
    this._token = info?.token ?? null;
    const proto = info?.proto;
    const deviceMajor = Number.parseInt(String(proto ?? "").split(".")[0], 10);
    if (deviceMajor !== NlConst.versionMajor) {
      throw new Error(`协议主版本不一致：设备 ${proto}，控制端 ${NlConst.protoVersion}`);
    }
  }

  _noteNotify(byteLength) {
    this._uplinkStats.notifies += 1;
    this._uplinkStats.lastBytes = Number(byteLength) || 0;
  }

  _noteUplinkError(err) {
    this._uplinkStats.lastError = String(err?.message || err || "parse failed");
    for (const fn of this._statsListeners) fn(this._uplinkStats);
  }

  /** 单帧解析失败就丢掉。12Hz 下一帧很快就到，没必要为一帧坏包中断连接。 */
  _emitUplink(json) {
    try {
      const uplink = BleUplink.fromJson(json);
      this._uplinkStats.parsed += 1;
      this._uplinkStats.lastError = "";
      for (const fn of this._uplinkListeners) fn(uplink);
    } catch (err) {
      this._noteUplinkError(err);
    }
  }

  _setConnected(ok) {
    if (this._connected === ok) return;
    this._connected = ok;
    if (!ok) this._uplinkStats = emptyUplinkStats();
    for (const fn of this._connectedListeners) fn(ok);
  }
}
