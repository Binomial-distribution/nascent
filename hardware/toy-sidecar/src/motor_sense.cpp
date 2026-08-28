#include "motor_sense.h"

#include <math.h>

#include "config.h"

void MotorSense::update(const ImuSample &imu, bool imu_ok, uint32_t dt_ms) {
  if (!imu_ok) {
    // 读不到 IMU 就是"不知道"，不是"没在转"。把结论退回 kUnknown 并清空
    // 证据，避免 IMU 掉线前的最后一个结论被一直沿用下去。
    state_ = State::kUnknown;
    hist_fill_ = 0;
    running_ms_ = 0;
    idle_ms_ = 0;
    jerk_energy_ = 0;
    accel_var_ = 0;
    return;
  }

  const int32_t ax = imu.accel_mg[0], ay = imu.accel_mg[1], az = imu.accel_mg[2];
  const uint32_t mag_sq = static_cast<uint32_t>(ax * ax + ay * ay + az * az);
  const uint16_t mag = static_cast<uint16_t>(sqrtf(static_cast<float>(mag_sq)));

  mag_hist_[hist_idx_] = mag;
  hist_idx_ = (hist_idx_ + 1) % kWindow;
  if (hist_fill_ < kWindow) ++hist_fill_;

  // 窗口没填满前不下任何结论。
  if (hist_fill_ < kWindow) {
    state_ = State::kUnknown;
    return;
  }

  // hist_idx_ 现在指向最旧的一格，从它开始按时间顺序走一遍。
  uint32_t sum = 0;
  uint32_t jerk_acc = 0;
  uint16_t prev = 0;
  for (int i = 0; i < kWindow; ++i) {
    const uint16_t v = mag_hist_[(hist_idx_ + i) % kWindow];
    sum += v;
    if (i > 0) {
      const int32_t d = static_cast<int32_t>(v) - static_cast<int32_t>(prev);
      jerk_acc += static_cast<uint32_t>(d * d);
    }
    prev = v;
  }
  jerk_energy_ = jerk_acc / (kWindow - 1);

  const uint32_t mean = sum / kWindow;
  uint32_t var_acc = 0;
  for (int i = 0; i < kWindow; ++i) {
    const int32_t d = static_cast<int32_t>(mag_hist_[i]) - static_cast<int32_t>(mean);
    var_acc += static_cast<uint32_t>(d * d);
  }
  accel_var_ = var_acc / kWindow;

  // 滞回：两个阈值之间的灰区谁也不累积，保持上一个结论，
  // 免得判定在边界上来回翻。
  if (jerk_energy_ >= MOTOR_JERK_ON_MG2) {
    running_ms_ += dt_ms;
    idle_ms_ = 0;
  } else if (jerk_energy_ <= MOTOR_JERK_OFF_MG2) {
    idle_ms_ += dt_ms;
    running_ms_ = 0;
  }

  if (running_ms_ >= MOTOR_CONFIRM_MS) {
    state_ = State::kRunning;
  } else if (idle_ms_ >= MOTOR_CONFIRM_MS) {
    state_ = State::kIdle;
  }
}

MotorSense::State MotorSense::state() const {
#if MOTOR_SENSE_ENABLED
  return state_;
#else
  // 阈值还没在实物上标定，观测器只能当串口打印器用。
  // 恒定 kUnknown 保证它一行逻辑都影响不到。标定完把宏置 1。
  return State::kUnknown;
#endif
}
