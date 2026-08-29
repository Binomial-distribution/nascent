/** 演示站 nlove 与通讯后端 loveapi 分域名时，把 /v1 指到 API 源。本机相对路径不变。 */

export const LOVEAPI_ORIGIN = "https://loveapi.divesee.com";
export const NLOVE_HOST = "nlove.divesee.com";

export function apiOrigin(locationLike) {
  const loc = locationLike || (typeof location !== "undefined" ? location : null);
  const host = String(loc?.hostname || "").toLowerCase();
  if (host === NLOVE_HOST) return LOVEAPI_ORIGIN;
  return "";
}

export function apiUrl(path, locationLike) {
  const raw = String(path || "");
  const origin = apiOrigin(locationLike);
  return origin ? `${origin}${raw}` : raw;
}

export function apiFetch(path, options, fetchImpl = fetch, locationLike) {
  return fetchImpl(apiUrl(path, locationLike), options);
}
