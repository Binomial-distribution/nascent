import { NlAlert, NlCmd, NlConst, NlInsertState, NlMode } from "./protocol.js";

/**
 * 浏览器侧安全总督。
 *
 * 它不是最终裁决者——玩具侧固件才是。这一层存在的意义是让非法意图
 * 在发出去之前就被挡住，以及在界面上给出理由，而不是让用户对着一个
 * 没反应的按钮猜发生了什么。
 *
 * 三条不可协商的规则：
 *   1. stop 永远可发，不看任何前置条件。
 *   2. 链路不可信（断连 / 遥测过期 / alert 为 link_lost）时，只放 stop。
 *   3. 使用状态为 unknown 时禁止自动加档；手动操作不受限制。
 */
export class Governor {
  constructor() {
    this._lastUplink = null;
    this._alert = NlAlert.NONE;
    this._insert = NlInsertState.UNKNOWN;
    this._stopped = false;
    this._wildSince = null;
  }

  ingest(u) {
    this._lastUplink = Date.now();
    this._alert = u.alert;
    this._insert = u.insertState;
    this._stopped = u.alert === NlAlert.SAFEWORD || u.alert === NlAlert.ESTOP;

    if (u.mode === NlMode.WILD) {
      this._wildSince ??= Date.now();
    } else {
      this._wildSince = null;
    }
  }

  /**
   * 上行断流即视为不可控。这里用的是与固件相同的 LINK_TIMEOUT_MS，
   * 两端对「多久算断」的判断必须一致。
   */
  get linkHealthy() {
    const t = this._lastUplink;
    if (t == null) return false;
    if (Date.now() - t > NlConst.linkTimeoutMs) return false;
    return this._alert !== NlAlert.LINK_LOST;
  }

  get stopped() {
    return this._stopped;
  }

  get insertState() {
    return this._insert;
  }

  get wildElapsed() {
    return this._wildSince == null ? null : Date.now() - this._wildSince;
  }

  /** 返回 null 表示放行，否则是拒绝理由（直接给用户看）。 */
  reject(cmd, { automatic = false } = {}) {
    if (cmd.cmd === NlCmd.STOP) return null;

    if (cmd.cmd === NlCmd.RESUME) {
      return "恢复只能在设备上完成：同时长按 K10 的 A、B 两键两秒。";
    }

    if (this._stopped) {
      return "已停止。需要在设备上按键确认后才能继续。";
    }

    if (!this.linkHealthy) {
      return "与设备的连接不可用，此时只能发送停止。";
    }

    if (cmd.cmd === NlCmd.SET_LEVEL) {
      const lv = cmd.level;
      if (lv == null || lv < NlConst.levelMin || lv > NlConst.levelMax) {
        return "档位超出范围。";
      }
      if (automatic && this._insert === NlInsertState.UNKNOWN) {
        return "当前无法确认使用状态，已暂停自动调节。";
      }
    }

    return null;
  }
}
