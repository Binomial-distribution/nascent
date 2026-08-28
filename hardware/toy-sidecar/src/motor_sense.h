// 电机观测器：用 IMU 间接判断原产品此刻是不是在振动。
//
// 存在理由：原板不给任何电气反馈，固件对「它现在是开还是关」的记录是
// 开环的。开环记录有个已知漏洞——有人手按过实体键把玩具打开时，固件仍
// 记为关机，停机指令就会因为「记录为关机」而不发那次长按。振动是唯一
// 拿得到的旁证。
//
// 硬边界：**观测结果永不驱动按键**。它只用来修正开环记录和报警，
// 补救动作交给人。让一个会被人体动作干扰的信号去直接按电源键，
// 等于把「设备自己动起来」的权力交给噪声。
//
// 为什么不复用 InsertInference::accel_var()：那是 1s 窗口内加速度模长的
// 方差，人体动作和电机振动都会把它抬高，拿它当判据会把「用户拿起玩具」
// 判成「电机在转」。这里改用一阶差分能量——电机振动过了 DLPF 42Hz 仍有
// 高频残留，在 12Hz 采样下表现为相邻样本之间的无规则抖动，差分能量高；
// 人体动作是 1-3Hz 的平滑轨迹，方差可能很大但相邻样本差分很小。
#pragma once

#include <stdint.h>

#include "sensors/mpu6050.h"

class MotorSense {
 public:
  enum class State : uint8_t { kUnknown, kRunning, kIdle };

  // 12Hz 调用。imu_ok 为 false 时结论恒为 kUnknown——
  // 读不到 IMU 绝不能被当成「电机没在转」。
  void update(const ImuSample &imu, bool imu_ok, uint32_t dt_ms);

  // MOTOR_SENSE_ENABLED 为 0 时恒返回 kUnknown，观测器不影响任何逻辑。
  State state() const;

  // 标定期用：不受 MOTOR_SENSE_ENABLED 影响，反映阈值判定的原始结论。
  State raw_state() const { return state_; }
  uint32_t jerk_energy() const { return jerk_energy_; }
  uint32_t accel_var() const { return accel_var_; }

 private:
  static constexpr int kWindow = 12;  // 12Hz -> 1s

  uint16_t mag_hist_[kWindow] = {0};
  int hist_idx_ = 0;  // 下一个写入位置，也就是环形缓冲里最旧的那一格
  int hist_fill_ = 0;

  uint32_t jerk_energy_ = 0;
  uint32_t accel_var_ = 0;

  uint32_t running_ms_ = 0;
  uint32_t idle_ms_ = 0;

  State state_ = State::kUnknown;
};
