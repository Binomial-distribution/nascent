import { ChannelBase } from "./channel.js";
import { NlWifi } from "./protocol.js";

const HANDSHAKE_TIMEOUT_MS = 8000;

/**
 * 把用户填的地址补成完整的 WebSocket URL。
 *
 * 允许三种写法：`192.168.1.20`、`192.168.1.20:81`、`nascent.local`。
 * 端口和路径缺省时用契约里的 `NlWifi`，不在这里写死。
 */
export function toyWsUrl(address) {
  const host = String(address ?? "").trim().replace(/^wss?:\/\//i, "").replace(/\/+$/, "");
  if (!host) throw new Error("请先在设置里填写玩具的地址。");
  const hasPort = /:\d+$/.test(host);
  return `ws://${hasPort ? host : `${host}:${NlWifi.wsPort}`}${NlWifi.wsPath}`;
}

/**
 * 与玩具侧 ESP32-S3 的 WiFi WebSocket 连接 —— 备用通道。
 *
 * 载荷与 BLE 完全相同（见 protocol/wifi_ws.md），所以这个类和 BleClient
 * 对外的形状一致，`session.js` 不需要知道自己走的是哪条。
 *
 * 设备没有 Info 特征可读，握手信息由设备在连上后**主动推第一帧**，
 * 格式仍是 `{ proto, token }`。收到它之前不发任何指令。
 */
export class WsClient extends ChannelBase {
  constructor() {
    super();
    this._socket = null;
    this._handshaken = false;
  }

  get available() {
    return typeof WebSocket !== "undefined" && this.unavailableReason == null;
  }

  /** 当前环境不可用时的原因，直接给用户看。可用时返回 null。 */
  get unavailableReason() {
    if (typeof WebSocket === "undefined") return "当前环境没有 WebSocket。";
    // 玩具侧没有 TLS，只能提供 ws://。HTTPS 页面连 ws:// 会被浏览器按
    // 混合内容拦掉，且拦截发生在 JS 之外，报错信息毫无线索。
    // 与其让用户对着一个沉默失败的按钮猜，不如在这里就说清楚。
    if (typeof location !== "undefined" && location.protocol === "https:") {
      return "HTTPS 页面无法连接玩具的 ws:// 地址（浏览器按混合内容拦截）。请用 Nascent App，或从 http://localhost 打开网站。";
    }
    return null;
  }

  async connect({ address } = {}) {
    const reason = this.unavailableReason;
    if (reason) throw new Error(reason);

    const url = toyWsUrl(address);
    await this.disconnect();

    const socket = new WebSocket(url);
    this._socket = socket;
    this._handshaken = false;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`连接 ${url} 超时。确认玩具已上电、和手机在同一个 2.4GHz 局域网内。`));
      }, HANDSHAKE_TIMEOUT_MS);

      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
      };

      socket.addEventListener("error", () => {
        fail(new Error(`连不上 ${url}。确认地址正确、玩具已切到 WiFi 通道。`));
      });

      socket.addEventListener("close", () => {
        // 握手完成前关闭是失败；完成之后关闭走 _onClose 的正常断连路径。
        if (!this._handshaken) fail(new Error(`${url} 拒绝了连接。`));
      });

      socket.addEventListener("message", (event) => {
        if (this._handshaken) {
          this._onFrame(event.data);
          return;
        }
        clearTimeout(timer);
        try {
          this._acceptInfo(JSON.parse(String(event.data)));
        } catch (err) {
          socket.close();
          reject(err);
          return;
        }
        this._handshaken = true;
        this._setConnected(true);
        resolve();
      });

      socket.addEventListener("close", this._onClose);
    });
  }

  async send(cmd) {
    const token = this._token;
    if (!token) throw new Error("尚未取得会话令牌");
    if (this._socket?.readyState !== WebSocket.OPEN) throw new Error("尚未连接设备");
    this._socket.send(JSON.stringify({ ...cmd.toJson(), auth: token }));
  }

  async disconnect() {
    const socket = this._socket;
    this._socket = null;
    this._handshaken = false;
    if (socket) {
      socket.removeEventListener("close", this._onClose);
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    this._token = null;
    this._setConnected(false);
  }

  _onFrame(data) {
    try {
      this._emitUplink(JSON.parse(String(data)));
    } catch {
      // 解不出 JSON 的帧直接丢掉。
    }
  }

  _onClose = () => {
    this._socket = null;
    this._handshaken = false;
    this._token = null;
    this._setConnected(false);
  };
}
