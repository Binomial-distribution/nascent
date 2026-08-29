import { BleDownlink, NlCmd, NlConst } from "./protocol.js";
import { getConnected, getUplink, sendCommand, subscribe } from "./session.js";

/**
 * 「连接我的 AI」插件的本机状态。
 *
 * 调档仍然只走 sendCommand()。这一层只负责邀请、心跳和把建议交给总督。
 */

export const STORAGE_KEY = "nascent.ai-plugin.invite";
export const POLL_MS = 2000;

/** 与后端 MCP 工具名对齐。测试用这份清单证明没有 resume。 */
export const PLUGIN_TOOL_NAMES = Object.freeze([
  "how_is_it_going",
  "ease_up",
  "a_bit_stronger",
  "please_stop",
]);

const listeners = new Set();
let pollTimer = null;
let applying = false;

export function loadInvite() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw?.id || !raw?.secret) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveInvite(invite) {
  if (!invite) {
    localStorage.removeItem(STORAGE_KEY);
    notify();
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(invite));
  notify();
}

export function canOpenPlugin(connected) {
  return !!connected;
}

export function pluginSummary({ connected, invite } = {}) {
  const on = connected ?? getConnected();
  const inv = invite === undefined ? loadInvite() : invite;
  if (!on && !inv) return "先连接设备，才能把调节交给你的 AI。";
  if (!inv) return "打开后，你常用的 AI 就可以根据你的感觉来调节。";
  if (inv.ai_connected) return "你的 AI 正在陪你调节";
  return "邀请有效 · 把邀请贴进你的 AI";
}

export function subscribePlugin(fn) {
  listeners.add(fn);
  fn(loadInvite());
  return () => listeners.delete(fn);
}

function notify() {
  const inv = loadInvite();
  for (const fn of listeners) fn(inv);
}

function headers(invite) {
  return {
    "Content-Type": "application/json",
    "X-Nascent-Invite": invite.secret,
  };
}

export async function createInvite() {
  const res = await fetch("/v1/plugin/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adult_confirmed: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || "打不开插件。");
  saveInvite(body);
  return body;
}

export async function refreshInvite() {
  const invite = loadInvite();
  if (!invite) return null;
  const res = await fetch(`/v1/plugin/invite/${encodeURIComponent(invite.id)}`, {
    headers: headers(invite),
  });
  if (res.status === 401) {
    saveInvite(null);
    return null;
  }
  if (!res.ok) return invite;
  const body = await res.json();
  const next = { ...invite, ...body, secret: invite.secret, invite_text: invite.invite_text, mcp_json: invite.mcp_json };
  const changed = invite.ai_connected !== next.ai_connected || invite.status !== next.status;
  if (changed) saveInvite(next);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function revokeInvite() {
  const invite = loadInvite();
  if (!invite) return;
  try {
    await fetch(`/v1/plugin/invite/${encodeURIComponent(invite.id)}`, {
      method: "DELETE",
      headers: headers(invite),
    });
  } catch {
    // 收不回云端时，本机仍先关掉，避免用户以为还开着。
  }
  saveInvite(null);
}

/**
 * 把工具变成建议。越界返回 null（丢弃，不钳位）。
 * snapshot.level 缺省时无法算档，也返回 null。
 */
export function mapToolCall(name, snapshot = {}) {
  if (name === "please_stop") {
    return { cmd: "stop", level: null, automatic: false };
  }
  if (name === "ease_up" || name === "a_bit_stronger") {
    const current = snapshot.level;
    if (current == null || Number.isNaN(Number(current))) return null;
    const delta = name === "ease_up" ? -1 : 1;
    const level = Number(current) + delta;
    if (level < NlConst.levelMin || level > NlConst.levelMax) return null;
    return { cmd: "set_level", level, automatic: true };
  }
  return null;
}

/** 云端给的档必须是当前档 ±1，过期心跳不能一次跳多档。 */
export function shouldApplyLevel(suggested, current) {
  if (suggested == null || current == null) return false;
  const level = Number(suggested);
  const now = Number(current);
  if (Number.isNaN(level) || Number.isNaN(now)) return false;
  if (level < NlConst.levelMin || level > NlConst.levelMax) return false;
  return Math.abs(level - now) === 1;
}

export async function applySuggestion(suggestion, snapshot = getUplink() || {}) {
  if (!suggestion) return "没有建议。";
  if (suggestion.cmd === "stop") {
    return sendCommand(new BleDownlink({ cmd: NlCmd.STOP, auth: "" }));
  }
  if (suggestion.cmd === "set_level") {
    if (!shouldApplyLevel(suggestion.level, snapshot.level)) {
      return "这个建议已经过时，设备没有改。";
    }
    // 不信任队列里的 automatic 字段：插件调档永远按自动走总督。
    return sendCommand(
      new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: Number(suggestion.level), auth: "" }),
      { automatic: true },
    );
  }
  return "未知建议，已忽略。";
}

async function heartbeatAndApply() {
  const invite = loadInvite();
  if (!invite || applying) return;
  applying = true;
  const uplink = getUplink();
  const connected = getConnected();
  try {
    await fetch(`/v1/plugin/heartbeat?invite_id=${encodeURIComponent(invite.id)}`, {
      method: "PUT",
      headers: headers(invite),
      body: JSON.stringify({
        connected,
        level: uplink?.level ?? null,
        insert_state: uplink?.insertState ?? "unknown",
        alert: uplink?.alert ?? "none",
      }),
    });
    await refreshInvite();
    const pendingRes = await fetch(`/v1/plugin/pending?invite_id=${encodeURIComponent(invite.id)}`, {
      headers: headers(invite),
    });
    if (!pendingRes.ok) return;
    const { suggestion } = await pendingRes.json();
    if (!suggestion) return;
    const reason = await applySuggestion(suggestion);
    await fetch(`/v1/plugin/result?invite_id=${encodeURIComponent(invite.id)}`, {
      method: "POST",
      headers: headers(invite),
      body: JSON.stringify({
        id: suggestion.id,
        ok: reason == null,
        reason: reason || "",
      }),
    });
  } catch {
    // 后端不可达时插件页仍可用，只是 AI 暂时调不了。
  } finally {
    applying = false;
  }
}

export function startBridge() {
  if (pollTimer) return;
  let lastConnected = getConnected();
  subscribe(({ connected }) => {
    if (connected !== lastConnected) {
      lastConnected = connected;
      heartbeatAndApply();
    }
  });
  pollTimer = setInterval(heartbeatAndApply, POLL_MS);
  heartbeatAndApply();
}
