import { ChannelBase, encodeDownlink } from "./channel.js";
import { NlBle } from "./protocol.js";

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

/**
 * 与玩具侧 ESP32-S3 的 BLE 连接 —— 默认通道。
 *
 * 0.3.0 之前手机连的是行空板 K10，由它经 ESP-NOW 转发给玩具侧。
 * K10 已删除，现在直连玩具侧那块板。UUID 一个都没改：服务只是换了宿主，
 * 逻辑身份没变。设备名从 `Nascent-K10` 变成 `Nascent-Toy`。
 *
 * UUID、设备名全部来自 contract.yaml 生成的 NlBle。
 * 网站 / PWA 走 Web Bluetooth；Android App 壳走原生 GATT 桥
 *（系统 WebView 没有 navigator.bluetooth）。
 */
export class BleClient extends ChannelBase {
  constructor() {
    super();
    this._device = null;
    this._server = null;
    this._downChar = null;
    this._upChar = null;
    this._usingNative = false;

    if (typeof window !== "undefined") {
      window.__nascentNativeOnUplink = (raw) => this._onNativeUplink(raw);
      window.__nascentNativeOnDisconnected = () => this._onDisconnected();
    }
  }

  get available() {
    return hasNativeBle() || (typeof navigator !== "undefined" && Boolean(navigator.bluetooth));
  }

  /** 当前环境不可用时的原因，直接给用户看。可用时返回 null。 */
  get unavailableReason() {
    if (this.available) return null;
    return "当前浏览器不能直连玩具。请改用 Chrome / Edge 并从 localhost 或 HTTPS 打开，或安装 Nascent App。";
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
    const body = encodeDownlink(cmd, token);
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
      throw new Error(this.unavailableReason);
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

  _onNativeUplink(raw) {
    try {
      this._emitUplink(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch {
      // 解不出 JSON 的帧直接丢掉。
    }
  }

  _onNotify = (event) => {
    try {
      this._emitUplink(bytesToJson(event.target.value));
    } catch {
      // 解不出 JSON 的帧直接丢掉。
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
}
