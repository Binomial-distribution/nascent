import { BleUplink, NlConst } from "./protocol.js";

/**
 * 两条设备通道（BLE / WiFi WebSocket）的共同部分。
 *
 * 抽出来的理由和固件侧 `downlink_gate` 一样：协议主版本门控和上行解析
 * 是两条通道都必须做对的事，抄成两份之后只改了一边的修补就会让另一条
 * 变成弱点。这一层不碰任何传输细节，只管监听者、令牌和版本。
 */
export class ChannelBase {
  constructor() {
    this._token = null;
    this._connected = false;
    this._uplinkListeners = new Set();
    this._connectedListeners = new Set();
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

  /** 单帧解析失败就丢掉。12Hz 下一帧很快就到，没必要为一帧坏包中断连接。 */
  _emitUplink(json) {
    try {
      const uplink = BleUplink.fromJson(json);
      for (const fn of this._uplinkListeners) fn(uplink);
    } catch {
      // 忽略这一帧
    }
  }

  _setConnected(ok) {
    if (this._connected === ok) return;
    this._connected = ok;
    for (const fn of this._connectedListeners) fn(ok);
  }
}
