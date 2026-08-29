#include "wifi_creds.h"

#include <Preferences.h>
#include <string.h>

#if __has_include("local_config.h")
#include "local_config.h"
#endif

#ifndef NL_WIFI_SSID
#define NL_WIFI_SSID ""
#endif
#ifndef NL_WIFI_PASSWORD
#define NL_WIFI_PASSWORD ""
#endif

namespace {

constexpr size_t kSsidMax = 32;
constexpr size_t kPskMax = 63;
const char *kNs = "nlwifi";
uint32_t g_generation = 0;

bool copyBounded(const char *src, char *dst, size_t cap, size_t max_len) {
  if (!dst || cap == 0) return false;
  dst[0] = '\0';
  if (!src) return true;
  size_t n = strlen(src);
  if (n > max_len || n + 1 > cap) return false;
  memcpy(dst, src, n + 1);
  return true;
}

}  // namespace

bool wifi_creds_save(const char *ssid, const char *psk) {
  if (!ssid || ssid[0] == '\0' || strlen(ssid) > kSsidMax) return false;
  if (psk && strlen(psk) > kPskMax) return false;
  if (psk && psk[0] != '\0' && strlen(psk) < 8) return false;

  Preferences prefs;
  if (!prefs.begin(kNs, false)) return false;
  const bool ok = prefs.putString("ssid", ssid) > 0;
  prefs.putString("psk", psk ? psk : "");
  prefs.end();
  if (ok) ++g_generation;
  return ok;
}

uint32_t wifi_creds_generation() { return g_generation; }

bool wifi_creds_load(char *ssid, size_t ssid_cap, char *psk, size_t psk_cap) {
  Preferences prefs;
  if (prefs.begin(kNs, true)) {
    String stored = prefs.getString("ssid", "");
    String secret = prefs.getString("psk", "");
    prefs.end();
    if (stored.length() > 0) {
      if (!copyBounded(stored.c_str(), ssid, ssid_cap, kSsidMax)) return false;
      if (psk && psk_cap) {
        if (!copyBounded(secret.c_str(), psk, psk_cap, kPskMax)) return false;
      }
      return true;
    }
  }
  if (!copyBounded(NL_WIFI_SSID, ssid, ssid_cap, kSsidMax)) return false;
  if (psk && psk_cap) {
    if (!copyBounded(NL_WIFI_PASSWORD, psk, psk_cap, kPskMax)) return false;
  }
  return ssid && ssid[0] != '\0';
}

bool wifi_creds_configured() {
  char ssid[kSsidMax + 1];
  return wifi_creds_load(ssid, sizeof(ssid), nullptr, 0) && ssid[0] != '\0';
}
