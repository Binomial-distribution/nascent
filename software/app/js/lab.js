/**
 * 硬件联调页。不是产品 UI。
 *
 * 发指令必须由调用方走 session.sendCommand / Governor。
 * 本模块只负责：传感器使用逻辑的展示、渲染、核对清单。
 *
 * 固件侧的融合规则见 hardware/toy-sidecar/src/sensors/sensor_logic.md。
 * 这里用同一套阈值做对照，方便没接上的器件一眼看出来。
 */

import { NlAlert, NlBle, NlConst, NlInsertState, NlLedState, NlMode } from "./protocol.js";
import { CHANNEL, CHANNEL_LABEL } from "./transport.js";

/** 与 firmware include/config.h FSR_CONTACT_ADC 对齐 */
export const FSR_CONTACT_ADC = 600;

const CHECK_KEY = "nascent.lab.checks";

export const CHECKLIST = [
  { id: "boot-short", text: "BOOT 短按（松手 ≤600ms）→ alert=estop，灯白，档位 0" },
  { id: "boot-deadzone", text: "按住约 1 秒再松 → 没有任何变化（死区）" },
  { id: "boot-long", text: "长按 2 秒 → 解除闩锁，且不回到停机前的档位" },
  { id: "resume-blocked", text: "点「试远程恢复」→ 总督拒绝，设备不动" },
  { id: "link-zero", text: "关电脑蓝牙 → 档位归零；重连后不会自动回到旧档" },
];

export function loadChecks() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHECK_KEY) || "{}");
    return Object.fromEntries(CHECKLIST.map((c) => [c.id, Boolean(raw[c.id])]));
  } catch {
    return Object.fromEntries(CHECKLIST.map((c) => [c.id, false]));
  }
}

export function saveCheck(id, on) {
  const next = { ...loadChecks(), [id]: Boolean(on) };
  localStorage.setItem(CHECK_KEY, JSON.stringify(next));
  return next;
}

export function uplinkStatCopy({ connected, uplink, stats } = {}) {
  const parsed = stats?.parsed ?? 0;
  const notifies = stats?.notifies ?? 0;
  const err = stats?.lastError || "";
  const bytes = stats?.lastBytes ?? 0;
  if (!connected) return "未连接";
  if (uplink && parsed > 0) {
    return `已解析 ${parsed} 帧${bytes ? ` · 最近 ${bytes} 字节` : ""}`;
  }
  if (notifies > 0 && parsed === 0) {
    return `收到 ${notifies} 次通知但解不出 JSON${err ? `：${err}` : ""}。多半是帧被截断（MTU 不够）。`;
  }
  return "0 帧。连接和令牌都好，但遥测没到。常见原因：固件把 MTU 上限钉在 185，一帧 JSON 约 210 字节发不出去。请断开后重连（需烧录已改 MTU 的固件）。";
}

export function connectionDiagnostic(state = {}) {
  const phase = state.phase || "idle";
  const message = state.message || "无附加信息";
  return `阶段 ${phase} · ${message}`;
}

export function insertCopy(state) {
  if (state === NlInsertState.INSERTED) return "在使用中";
  if (state === NlInsertState.NOT_INSERTED) return "未在使用";
  return "不确定";
}

export function accelMag(accel) {
  const a = accel || [0, 0, 0];
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

/**
 * IMU 健康：静置时应接近 1g。三轴都接近 0 说明 I2C 没读到（未接线或掉线）。
 */
export function imuHealth(accel) {
  const mag = accelMag(accel);
  if (mag < 0.15) {
    return { ok: false, label: "I2C 无响应", detail: "加速度接近 0。串口看 [imu] 扫描：双地址无 ACK 才是硬件/上拉问题" };
  }
  return { ok: true, label: "有读数", detail: `模长 ${mag.toFixed(2)} g（静置约 1.0）` };
}

export function dhtHealth(envTemp) {
  if (envTemp == null) {
    return { ok: false, label: "未就绪", detail: "无新鲜读数。DHT11 最快 1Hz，且不是安全熔断通道。" };
  }
  return { ok: true, label: "有读数", detail: "环境温湿度，禁止当接触温度用。" };
}

export function fsrContact(pressL, pressR) {
  const peak = Math.max(pressL || 0, pressR || 0);
  return peak >= FSR_CONTACT_ADC;
}

export function sensorLogicView(uplink) {
  if (!uplink) {
    return {
      contact: false,
      imu: { ok: false, label: "无上行", detail: "先连接玩具" },
      dht: { ok: false, label: "无上行", detail: "先连接玩具" },
      insert: "不确定",
      fusion: "等待遥测。融合规则：接触+体动才算在使用中；只有压或只有晃都是不确定。",
    };
  }
  const contact = fsrContact(uplink.pressL, uplink.pressR);
  const imu = imuHealth(uplink.accel);
  const dht = dhtHealth(uplink.envTemp);
  let fusion;
  if (!imu.ok) {
    fusion = "六轴未就绪：固件锁在「不确定」，不会把全零加速度当成放下。";
  } else if (contact && uplink.insertState === NlInsertState.INSERTED) {
    fusion = "接触压力 + 体动已持续确认 → 在使用中。不驱动诊断文案。";
  } else if (!contact && uplink.insertState === NlInsertState.NOT_INSERTED) {
    fusion = "无接触且静止 → 未在使用。静止满 30 秒会暂停输出，拿起恢复原档。";
  } else {
    fusion = "证据不足或互相矛盾（只压不晃 / 只晃不压）→ 不确定。此时禁止自动加档。";
  }
  return { contact, imu, dht, insert: insertCopy(uplink.insertState), fusion };
}

const LED_LABEL = {
  [NlLedState.MODE_DEFAULT]: "跟模式",
  [NlLedState.WARMING]: "过冷提示",
  [NlLedState.COMFORT_REACHED]: "舒适确认",
  [NlLedState.CLEANING]: "清洁",
  [NlLedState.LOW_BATTERY]: "低电（demo 无采样）",
  [NlLedState.SAFEWORD]: "安全词白灯",
};

const MODE_LABEL = {
  [NlMode.FREE]: "手动",
  [NlMode.SCENARIO]: "情景",
  [NlMode.WILD]: "失控",
};

const ALERT_LABEL = {
  [NlAlert.NONE]: "无",
  [NlAlert.OVER_TEMP]: "过温",
  [NlAlert.LOW_BATTERY]: "低电",
  [NlAlert.SAFEWORD]: "安全词停机",
  [NlAlert.ESTOP]: "急停",
  [NlAlert.BAD_CMD]: "非法指令",
  [NlAlert.LINK_LOST]: "链路丢失",
};

function fmt(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(digits);
}

function kv(label, value, extra = "") {
  return `<div class="lab-kv">
    <span>${label}</span>
    <strong data-lab="${extra}">${value}</strong>
  </div>`;
}

export function renderLab({
  connected,
  uplink,
  channel,
  token,
  connectionState,
  lastReject = "",
  uplinkStats = null,
} = {}) {
  const view = sensorLogicView(uplink);
  const checks = loadChecks();
  const mag = uplink ? accelMag(uplink.accel) : 0;
  const a = uplink?.accel || [0, 0, 0];
  const g = uplink?.gyro || [0, 0, 0];
  const mode = uplink?.mode ?? NlMode.FREE;
  const level = uplink?.level ?? 0;
  const alert = uplink?.alert ?? NlAlert.NONE;

  return `${topbarStub()}
  <main class="page lab-page">
    <p class="sub">验证期 bench。发指令仍过安全总督，停机不能远程解除。档位走 AO3400 模拟按键：GPIO7 没接到原板时页面会动、电机不会动。</p>
    <button class="stop" data-act="stop">${iconStop()} 停 止</button>

    <div class="group">连接与协议</div>
    <button class="list-row" data-act="connect">
      <strong data-lab="link">${connected ? "已连接 · 点击断开" : "未连接 · 点击连接 Nascent-Toy"}</strong>
      <small>${CHANNEL_LABEL[channel] || channel} · 广播名 ${NlBle.deviceName} · 协议 ${NlConst.protoVersion}</small>
    </button>
    <p class="lab-note" data-lab="connection-detail">${escapeLab(connectionDiagnostic(connectionState))}</p>
    ${kv("会话令牌", token ? "已签发" : "无")}
    ${kv("最近一帧 ts", uplink ? String(uplink.ts) : "—", "ts")}
    <p class="lab-note" data-lab="uplink-stat">${escapeLab(uplinkStatCopy({ connected, uplink, stats: uplinkStats }))}</p>
    ${kv("生效档位 / 模式 / 告警",
      `${level} · ${MODE_LABEL[mode] || mode} · ${ALERT_LABEL[alert] || alert}`,
      "state")}

    <div class="group">传感器使用逻辑</div>
    <p class="hint" style="text-align:left">DHT11 只报环境温湿度，不做熔断。FSR 管贴合与 1–2Hz 节律，不做高潮检测。MPU6050 管体动/静止；与压力一起才下「是否在使用中」。六轴没接到（加速度接近 0）时融合必须停在「不确定」，这不是故障。</p>
    <div class="lab-card">
      <h3>DHT11 · GPIO4</h3>
      ${kv("状态", `${view.dht.label}`, "dht-ok")}
      ${kv("环境温度 / 湿度", `${fmt(uplink?.envTemp)} °C · ${fmt(uplink?.envHumidity)} %`, "dht")}
      <p class="lab-note">${view.dht.detail}</p>
    </div>
    <div class="lab-card">
      <h3>FSR402 · GPIO1（右路 demo 未接）</h3>
      ${kv("原始 ADC 左 / 右", `${uplink?.pressL ?? "—"} / ${uplink?.pressR ?? "—"}`, "fsr")}
      ${kv("接触（阈值 " + FSR_CONTACT_ADC + "）", view.contact ? "有贴合" : "无贴合", "contact")}
      <p class="lab-note">节律在固件带通提取，不驱动档位。按压薄膜，接触应变「有贴合」。</p>
    </div>
    <div class="lab-card">
      <h3>MPU6050 · I2C GPIO8/9 @0x68</h3>
      ${kv("状态", view.imu.label, "imu-ok")}
      ${kv("加速度 g", `${fmt(a[0], 2)}, ${fmt(a[1], 2)}, ${fmt(a[2], 2)}  |g|=${fmt(mag, 2)}`, "accel")}
      ${kv("角速度 dps", `${fmt(g[0], 1)}, ${fmt(g[1], 1)}, ${fmt(g[2], 1)}`, "gyro")}
      <p class="lab-note">${view.imu.detail}</p>
      <p class="lab-note">接线：VCC→3V3，GND→GND，SDA→丝印 8，SCL→丝印 9。固件扫 0x68/0x69；GY-521 克隆片（WHO=0x70）也能用。串口出现「就绪」后这里应有约 1g。总线空再加 4.7k 到 3V3，不要接到 5V。</p>
    </div>
    <div class="lab-card">
      <h3>融合结论</h3>
      ${kv("是否在使用中", view.insert, "insert")}
      <p class="lab-note" data-lab="fusion">${view.fusion}</p>
    </div>

    <div class="group">原按键 / 电机</div>
    <div class="lab-card">
      <h3>直接模拟原开关</h3>
      <p class="lab-note">外部 3.3V 点 GPIO7 能动，说明管子是好的。下面两个动作直接短接 GPIO7，不走开环档位推算。</p>
      <p class="lab-note">长按是电源<strong>取反</strong>：关机时长按会开机，开机时长按会关机。开机、关机两个键发的是同一次长按，按实际状态选一个。</p>
      <div class="lab-leds" style="margin:12px 0">
        <button class="chip" data-act="lab-power-on">开机（长按 ~1.2s）</button>
        <button class="chip" data-act="lab-power-off">关机（长按 ~1.2s）</button>
        <button class="chip" data-act="lab-tap">调档（点按 ~120ms）</button>
      </div>
      <p class="lab-note">点按只在原机已经开机后才切档。先长按开机，等电机转起来，再点调档。</p>
      <p class="lab-note">按下去灯应再闪一下白光。串口出现 GPIO7 HIGH 才是固件在按。灯闪了电机不动：用表笔量 GPIO7，高电平应约 3.3V 维持 1.2 秒。</p>
    </div>

    <div class="group">档位与模式</div>
    <div class="level" data-level-label>档位 ${level} / ${NlConst.levelMax}</div>
    <input id="level-slider" type="range" min="0" max="${NlConst.levelMax}" step="1" value="${level}" />
    <div class="modes">
      ${[
        [NlMode.FREE, "手动"],
        [NlMode.SCENARIO, "情景"],
        [NlMode.WILD, "失控"],
      ].map(([value, label]) => `
        <button data-act="lab-mode" data-mode="${value}" class="${mode === value ? "active" : ""}">${label}</button>
      `).join("")}
    </div>
    <p class="hint">失控需再点一次确认。换模式才换灯色。</p>

    <div class="group">灯语覆盖</div>
    <p class="hint">上电后灯环应全白亮约 15 秒。DI→GPIO6，5V→开发板 5V，GND→GND，DO/D0 不接单片机。完全不亮：先确认共地；5V 灯珠吃 3.3V 数据有时不亮，可先把灯的 VCC 改接到 3V3 试亮。</p>
    <div class="lab-leds">
      ${NlLedState.values.filter((s) => s !== NlLedState.LOW_BATTERY).map((s) => `
        <button class="chip" data-act="lab-led" data-led="${s}">${LED_LABEL[s] || s}</button>
      `).join("")}
    </div>

    <div class="group">安全核对</div>
    <button class="ghost" data-act="lab-resume">试远程恢复（必须被拒绝）</button>
    ${lastReject ? `<p class="lab-reject">${escapeLab(lastReject)}</p>` : ""}
    ${CHECKLIST.map((c) => `
      <label class="lab-check">
        <input type="checkbox" data-act="lab-check" data-id="${c.id}" ${checks[c.id] ? "checked" : ""}>
        <span>${c.text}</span>
      </label>
    `).join("")}
  </main>`;
}

function topbarStub() {
  return `<header class="topbar">
    <button class="icon-btn" data-act="back" data-to="#/settings" aria-label="返回">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    </button>
    <h1>硬件联调</h1>
  </header>`;
}

function iconStop() {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>`;
}

function escapeLab(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 12Hz 热更新，避免整页重绘打断勾选。 */
export function patchLabDom(root, { connected, uplink, token, connectionState, uplinkStats = null }) {
  const view = sensorLogicView(uplink);
  const set = (name, text) => {
    const el = root.querySelector(`[data-lab="${name}"]`);
    if (el) el.textContent = text;
  };
  set("link", connected ? "已连接 · 点击断开" : "未连接 · 点击连接 Nascent-Toy");
  set("connection-detail", connectionDiagnostic(connectionState));
  set("ts", uplink ? String(uplink.ts) : "—");
  set("uplink-stat", uplinkStatCopy({ connected, uplink, stats: uplinkStats }));
  if (uplink) {
    const mode = MODE_LABEL[uplink.mode] || uplink.mode;
    const alert = ALERT_LABEL[uplink.alert] || uplink.alert;
    set("state", `${uplink.level} · ${mode} · ${alert}`);
    set("dht-ok", view.dht.label);
    set("dht", `${fmt(uplink.envTemp)} °C · ${fmt(uplink.envHumidity)} %`);
    set("fsr", `${uplink.pressL} / ${uplink.pressR}`);
    set("contact", view.contact ? "有贴合" : "无贴合");
    set("imu-ok", view.imu.label);
    const a = uplink.accel || [0, 0, 0];
    const g = uplink.gyro || [0, 0, 0];
    const mag = accelMag(a);
    set("accel", `${fmt(a[0], 2)}, ${fmt(a[1], 2)}, ${fmt(a[2], 2)}  |g|=${fmt(mag, 2)}`);
    set("gyro", `${fmt(g[0], 1)}, ${fmt(g[1], 1)}, ${fmt(g[2], 1)}`);
    set("insert", view.insert);
    set("fusion", view.fusion);
    const label = root.querySelector("[data-level-label]");
    const slider = root.querySelector("#level-slider");
    if (label && document.activeElement !== slider) {
      label.textContent = `档位 ${uplink.level} / ${NlConst.levelMax}`;
    }
    if (slider && document.activeElement !== slider) slider.value = String(uplink.level);
    root.querySelectorAll("[data-act=lab-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === uplink.mode);
    });
  }
  void token;
}
