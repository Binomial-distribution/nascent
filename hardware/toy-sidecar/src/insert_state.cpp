#include "insert_state.h"

#include <Arduino.h>
#include <math.h>

#include "config.h"

void InsertInference::update(const ImuSample &imu, bool contact, uint32_t dt_ms, bool imu_ok) {
  if (!imu_ok) {
    // 没有六轴就没有体动证据。全零加速度看起来像「完全静止」，
    // 会把未接线的板子误判成 not_inserted，并触发 30s 静止暂停。
    still_ = false;
    still_ms_ = 0;
    inserted_evidence_ms_ = 0;
    released_evidence_ms_ = 0;
    hist_fill_ = 0;
    hist_idx_ = 0;
    accel_var_ = 0;
    state_ = NL_INSERT_STATE_UNKNOWN;
    return;
  }

  // 用加速度模长而不是单轴：玩具在使用中朝向不固定，单轴阈值没有意义。
  int32_t ax = imu.accel_mg[0], ay = imu.accel_mg[1], az = imu.accel_mg[2];
  uint32_t mag_sq = static_cast<uint32_t>(ax * ax + ay * ay + az * az);
  uint16_t mag = static_cast<uint16_t>(sqrtf(static_cast<float>(mag_sq)));

  mag_hist_[hist_idx_] = mag;
  hist_idx_ = (hist_idx_ + 1) % kWindow;
  if (hist_fill_ < kWindow) ++hist_fill_;

  // 1s 窗口内的方差。窗口没填满前不下任何结论。
  if (hist_fill_ < kWindow) {
    state_ = NL_INSERT_STATE_UNKNOWN;
    return;
  }

  uint32_t sum = 0;
  for (int i = 0; i < kWindow; ++i) sum += mag_hist_[i];
  uint32_t mean = sum / kWindow;

  uint32_t var_acc = 0;
  for (int i = 0; i < kWindow; ++i) {
    int32_t d = static_cast<int32_t>(mag_hist_[i]) - static_cast<int32_t>(mean);
    var_acc += static_cast<uint32_t>(d * d);
  }
  accel_var_ = var_acc / kWindow;

  // ---- 静止 ----
  bool now_still = accel_var_ < IMU_STILL_VAR_MG2 && !contact;
  if (now_still) {
    still_ms_ += dt_ms;
  } else {
    still_ms_ = 0;
  }
  still_ = now_still;

  // ---- 三态推断 ----
  //
  // 判据组合，全部要求「持续一段时间」才生效，避免单帧抖动翻转结论：
  //   inserted     : 有接触压力 + 存在明显体动
  //   not_inserted : 无接触压力 + 静止
  //   其余         : unknown
  //
  // 只有压力没有体动（例如放在包里被压着）不算 inserted；
  // 只有体动没有压力（例如手里挥动）也不算。这两种正是最容易误判的场景。
  bool motion = accel_var_ >= IMU_MOTION_VAR_MG2;

  if (contact && motion) {
    inserted_evidence_ms_ += dt_ms;
    released_evidence_ms_ = 0;
  } else if (!contact && now_still) {
    released_evidence_ms_ += dt_ms;
    inserted_evidence_ms_ = 0;
  } else {
    // 证据互相矛盾：两边都衰减，让状态自然回落到 unknown。
    if (inserted_evidence_ms_ > dt_ms) inserted_evidence_ms_ -= dt_ms; else inserted_evidence_ms_ = 0;
    if (released_evidence_ms_ > dt_ms) released_evidence_ms_ -= dt_ms; else released_evidence_ms_ = 0;
  }

  if (inserted_evidence_ms_ >= INSERT_CONFIRM_MS) {
    state_ = NL_INSERT_STATE_INSERTED;
  } else if (released_evidence_ms_ >= INSERT_RELEASE_MS) {
    state_ = NL_INSERT_STATE_NOT_INSERTED;
  } else if (inserted_evidence_ms_ == 0 && released_evidence_ms_ == 0) {
    state_ = NL_INSERT_STATE_UNKNOWN;
  }
  // 证据正在累积但还不够时保持上一个结论，避免状态在边界上抖动。
}
