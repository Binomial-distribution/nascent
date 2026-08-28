import { BleUplink, NlBle, NlConst } from "./protocol.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function bytesToJson(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return JSON.parse(textDecoder.decode(bytes));
}

export function hasNativeBle() {
  return typeof window !== "undefined" && typeof window.NascentNative?.connect === "function";
}

/** website | pwa | android-app */
export function currentShell() {
  if (hasNativeBle()) return "android-app";
  if (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) {
    return "pwa";
  }
  return "website";
}

/**
 * 与行空板 K10 的 BLE 连接。
 *
 * UUID、设备名全部来自 contract.yaml 生成的 NlBle。
 * 网站 / PWA 走 Web Bluetooth；Android App 壳走原生 GATT 桥
 *（系统 WebView 没有 navigator.bluetooth）。
 */
export class BleClient {
  constructor() {
    this._device = null;
    this._server = null;
    this._downChar = null;
    this._upChar = null;
    this._token = null;
    this._connected = false;
    this._usingNative = false;
    this._uplinkListeners = new Set();
    this._connectedListeners = new Set();

    if (typeof window !== "undefined") {
      window.__nascentNativeOnUplink = (raw) => this._onNativeUplink(raw);
      window.__nascentNativeOnDisconnected = () => this._onDisconnected();
    }
  }

  get token() {
    return this._token;
  }

  get connected() {
    return this._connected;
  }

  get available() {
    return hasNativeBle() || (typeof navigator !== "undefined" && Boolean(navigator.bluetooth));
  }

  onUplink(fn) {
    this._uplinkListeners.add(fn);
    return () => this._uplinkListeners.delete(fn);
  }

  onConnected(fn) {
    this._connectedListeners.add(fn);
    return () => this._connectedListeners.delete(fn);
  }

  async connect() {
    if (hasNativeBle()) {
      await this._connectNative();
      return;
    }
    await this._connectWebBluetooth();
  }

  async send(cmd) {
    const token = this._token;
    if (!token) throw new Error("尚未取得会话令牌");
    const body = { ...cmd.toJson(), auth: token };
    if (this._usingNative) {
      const err = window.NascentNative.send(JSON.stringify(body));
      if (err) throw new Error(err);
      return;
    }
    if (!this._downChar) throw new Error("尚未连接设备");
    await this._downChar.writeValueWithResponse(textEncoder.encode(JSON.stringify(body)));
  }

  async disconnect() {
    if (this._usingNative) {
      try {
        window.NascentNative.disconnect();
      } catch {
        // ignore
      }
      this._usingNative = false;
      this._forgetLink();
      this._setConnected(false);
      return;
    }

    if (this._upChar) {
      this._upChar.removeEventListener("characteristicvaluechanged", this._onNotify);
      try {
        await this._upChar.stopNotifications();
      } catch {
        // 断连过程中特征可能已经失效。
      }
    }
    if (this._device) {
      this._device.removeEventListener("gattserverdisconnected", this._onDisconnected);
      try {
        this._device.gatt?.disconnect();
      } catch {
        // ignore
      }
    }
    this._forgetLink();
    this._setConnected(false);
  }

  async _connectNative() {
    await this.disconnect();
    const info = await new Promise((resolve, reject) => {
      window.__nascentNativeConnect = { resolve, reject };
      window.NascentNative.connect(JSON.stringify({
        deviceName: NlBle.deviceName,
        serviceUuid: NlBle.serviceUuid,
        infoUuid: NlBle.infoUuid,
        uplinkUuid: NlBle.uplinkUuid,
        downlinkUuid: NlBle.downlinkUuid,
        minMtu: NlBle.minMtu,
      }));
    });
    try {
      this._acceptInfo(info);
    } catch (err) {
      try { window.NascentNative.disconnect(); } catch { /* ignore */ }
      throw err;
    }
    this._usingNative = true;
    this._setConnected(true);
  }

  async _connectWebBluetooth() {
    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      throw new Error("当前环境不能连行空板。请用 Chrome / Edge 打开网站，或使用 Nascent App。");
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { name: NlBle.deviceName },
        { services: [NlBle.serviceUuid] },
      ],
      optionalServices: [NlBle.serviceUuid],
    });

    await this.disconnect();

    this._device = device;
    device.addEventListener("gattserverdisconnected", this._onDisconnected);

    const server = await device.gatt.connect();
    this._server = server;
    const service = await server.getPrimaryService(NlBle.serviceUuid);

    const infoChar = await service.getCharacteristic(NlBle.infoUuid);
    this._acceptInfo(bytesToJson(await infoChar.readValue()));

    this._downChar = await service.getCharacteristic(NlBle.downlinkUuid);
    this._upChar = await service.getCharacteristic(NlBle.uplinkUuid);
    this._upChar.addEventListener("characteristicvaluechanged", this._onNotify);
    await this._upChar.startNotifications();

    this._setConnected(true);
  }

  _acceptInfo(info) {
    this._token = info.token ?? null;
    const proto = info.proto;
    const deviceMajor = Number.parseInt(String(proto ?? "").split(".")[0], 10);
    if (deviceMajor !== NlConst.versionMajor) {
      throw new Error(`协议主版本不一致：设备 ${proto}，控制端 ${NlConst.protoVersion}`);
    }
  }

  _onNativeUplink(raw) {
    try {
      const json = typeof raw === "string" ? JSON.parse(raw) : raw;
      const uplink = BleUplink.fromJson(json);
      for (const fn of this._uplinkListeners) fn(uplink);
    } catch {
      // 单帧解析失败就丢掉。
    }
  }

  _onNotify = (event) => {
    try {
      const uplink = BleUplink.fromJson(bytesToJson(event.target.value));
      for (const fn of this._uplinkListeners) fn(uplink);
    } catch {
      // 单帧解析失败就丢掉。12Hz 下一帧很快就到。
    }
  };

  _onDisconnected = () => {
    this._usingNative = false;
    this._forgetLink();
    this._setConnected(false);
  };

  _forgetLink() {
    this._token = null;
    this._downChar = null;
    this._upChar = null;
    this._server = null;
    this._device = null;
  }

  _setConnected(ok) {
    if (this._connected === ok) return;
    this._connected = ok;
    for (const fn of this._connectedListeners) fn(ok);
  }
}
