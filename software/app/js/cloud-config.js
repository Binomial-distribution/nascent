/** 验证期云端接口。密钥和本机口令只留本机，不进数据导出。 */

import { apiUrl } from "./api.js";

export const CLOUD_STORE_KEY = "nascent.cloud.config";
export const RUNTIME_TOKEN_STORE_KEY = "nascent.cloud.runtime-token";
export const RUNTIME_TOKEN_HEADER = "X-Nascent-Runtime-Token";
export const DEFAULT_LLM_BASE_URL = "https://api.siliconflow.cn/v1";
export const DEFAULT_LLM_MODEL = "Qwen/Qwen3.5-9B";

export function emptyCloudConfig() {
  return {
    llmBaseUrl: DEFAULT_LLM_BASE_URL,
    llmApiKey: "",
    llmModel: DEFAULT_LLM_MODEL,
    minimaxApiKey: "",
  };
}

function storageOf(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadCloudConfig(storage) {
  const store = storageOf(storage);
  const fallback = emptyCloudConfig();
  if (!store) return fallback;
  try {
    const raw = JSON.parse(store.getItem(CLOUD_STORE_KEY) || "{}");
    return {
      llmBaseUrl: String(raw.llmBaseUrl || fallback.llmBaseUrl).trim() || fallback.llmBaseUrl,
      llmApiKey: String(raw.llmApiKey || ""),
      llmModel: String(raw.llmModel || fallback.llmModel).trim() || fallback.llmModel,
      minimaxApiKey: String(raw.minimaxApiKey || ""),
    };
  } catch {
    return fallback;
  }
}

export function saveCloudConfig(cfg, storage) {
  const store = storageOf(storage);
  const next = {
    ...emptyCloudConfig(),
    ...cfg,
    llmBaseUrl: normalizeLlmBaseUrl(cfg?.llmBaseUrl || ""),
  };
  delete next.runtimeToken;
  if (!store) return next;
  try {
    store.setItem(CLOUD_STORE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

export function clearCloudConfig(storage) {
  const store = storageOf(storage);
  try {
    store?.removeItem(CLOUD_STORE_KEY);
  } catch {
    /* ignore */
  }
  return emptyCloudConfig();
}

export function loadRuntimeToken(storage) {
  const store = storageOf(storage);
  if (!store) return "";
  try {
    return String(store.getItem(RUNTIME_TOKEN_STORE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function saveRuntimeToken(token, storage) {
  const store = storageOf(storage);
  const next = String(token || "").trim();
  if (!store) return next;
  try {
    if (next) store.setItem(RUNTIME_TOKEN_STORE_KEY, next);
    else store.removeItem(RUNTIME_TOKEN_STORE_KEY);
  } catch {
    /* ignore */
  }
  return next;
}

export function runtimeAuthHeaders(storage) {
  const headers = { "content-type": "application/json" };
  const token = loadRuntimeToken(storage);
  if (token) headers[RUNTIME_TOKEN_HEADER] = token;
  return headers;
}

export function normalizeLlmBaseUrl(url) {
  const raw = String(url || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const host = raw.replace(/^https?:\/\//, "").split("/")[0];
  if (["cloud.siliconflow.cn", "siliconflow.cn", "www.siliconflow.cn"].includes(host)) {
    return DEFAULT_LLM_BASE_URL;
  }
  if (raw === "https://api.siliconflow.cn") return DEFAULT_LLM_BASE_URL;
  return raw;
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

export function hasConnectionShell(globalObj = globalThis) {
  return typeof globalObj?.NascentShell?.openConnectionSettings === "function";
}

export function cloudSummary(cfg, remote) {
  if (remote?.llm_configured) {
    return remote.minimax_configured || remote.tts_configured
      ? "对话已接通"
      : "对话已接通 · 语音未配";
  }
  if (cfg?.llmApiKey) return "已填写本机密钥，待保存";
  if (remote?.llm_api_key_set) return "后端已配置";
  return "未填写";
}

export function toRuntimePayload(cfg, { includeSecrets = true } = {}) {
  const payload = {
    llm_base_url: normalizeLlmBaseUrl(cfg.llmBaseUrl || DEFAULT_LLM_BASE_URL),
    llm_model: String(cfg.llmModel || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL,
  };
  if (includeSecrets) {
    if (cfg.llmApiKey) payload.llm_api_key = cfg.llmApiKey;
    if (cfg.minimaxApiKey) payload.minimax_api_key = cfg.minimaxApiKey;
  }
  return payload;
}

export async function fetchCloudStatus(fetchImpl = fetch) {
  const response = await fetchImpl(apiUrl("/v1/runtime-config"));
  if (!response.ok) return null;
  return response.json();
}

export async function syncCloudConfig(fetchImpl = fetch, storage) {
  const cfg = loadCloudConfig(storage);
  if (cfg.llmApiKey || cfg.minimaxApiKey) {
    const response = await fetchImpl(apiUrl("/v1/runtime-config"), {
      method: "POST",
      headers: runtimeAuthHeaders(storage),
      body: JSON.stringify(toRuntimePayload(cfg)),
    });
    if (response.ok) return response.json();
  }
  try {
    return await fetchCloudStatus(fetchImpl);
  } catch {
    return null;
  }
}
