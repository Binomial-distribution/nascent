// 入体状态推断。
//
// 输出 inserted / not_inserted / unknown 三态。这是**使用状态推断**，
// 不是医疗检测，对外文案一律用「是否在使用中」。
//
// 两条铁律：
//   1. 拿不准就给 unknown，绝不猜 inserted。
//   2. unknown 状态下不允许自动开档（判定在 safety 层，这里只负责给结论）。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"
#include "sensors/mpu6050.h"

class InsertInference {
 public:
  // 12Hz 调用。contact 来自 FSR402。
  void update(const ImuSample &imu, bool contact, uint32_t dt_ms);

  nl_insert_state_t state() const { return state_; }

  // 静止判定：用于「放下 30s 自动暂停、拿起唤醒」。
  bool still() const { return still_; }
  uint32_t still_ms() const { return still_ms_; }

  uint32_t accel_var() const { return accel_var_; }

 private:
  static constexpr int kWindow = 12;  // 12Hz -> 1s

  uint16_t mag_hist_[kWindow] = {0};
  int hist_idx_ = 0;
  int hist_fill_ = 0;

  uint32_t accel_var_ = 0;
  bool still_ = false;
  uint32_t still_ms_ = 0;

  uint32_t inserted_evidence_ms_ = 0;
  uint32_t released_evidence_ms_ = 0;

  nl_insert_state_t state_ = NL_INSERT_STATE_UNKNOWN;
};
