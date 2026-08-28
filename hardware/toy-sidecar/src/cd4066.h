// CD4066 模拟开关：并联原产品的轻触按键。
//
// 边界必须记清楚：
//   - 它只"按按钮"，**不驱动电机**。电机始终由原产品控制板驱动。
//   - 连续电流上限约 10mA 级别，接电机会烧。
//   - 原实体按钮不拆，手按和软件按并存。
//
// 原板行为模型（2026-08-28 实物实测，不再是假设）：
//   - 长按约 1s = 电源**取反**。关机态长按 → 开机并停在第 1 档；
//     开机态长按 → 关机。它不是单向的"关机键"，这一点决定了整个状态机。
//   - 短按 = 档位循环，**仅开机态有效**；关机态短按原板毫无反应。
//   - 原板不回传任何状态，所以下面的 powered_ / step_ 都是开环假设。
//     唯一可信的已知点是"关机"：一次把它关掉的长按之后，记录才重新对齐。
#pragma once

#include <stdint.h>

class Cd4066 {
 public:
  void begin(uint8_t pin);

  // 每轮主循环调用，推进按键时序状态机。
  void tick(uint32_t now_ms);

  // 请求原板停在第 target 档（1..8，对应协议档位）。0 表示关机。
  // 内部自己算怎么按，调用方不需要关心原板当前在哪一档。
  void requestLevel(uint8_t target);

  // 立即关机。停机路径专用。
  //
  // 注意它在"记录为关机"时**什么都不按**：长按是电源取反，
  // 盲发一次会把用户没要求的输出打开，那是这个产品最坏的失败模式。
  void requestOffNow();

  bool busy() const { return goal_active_ || phase_ != Phase::kIdle; }
  uint8_t assumed_step() const { return step_; }
  bool powered() const { return powered_; }
  bool needs_resync() const { return needs_resync_; }

  // IMU 电机观测器修正开环记录的唯一入口。
  //
  // 它**只改记录，不入队任何按键**。观测不能变成动作：让一个会被
  // 人体动作干扰的信号去直接按电源键，等于把"设备自己动起来"的
  // 权力交给噪声。修正之后，是否真的去按仍由 stop / requestLevel 决定。
  void markObservedPowered(bool on);

  // 开环跟踪难免会跑偏。人工按了实体按钮之后调用这个重新对齐。
  void resync() { needs_resync_ = true; }

 private:
  enum class Phase : uint8_t { kIdle, kPressing, kGap };

  void startPress(bool long_press, uint32_t now_ms);
  void finishPress();

  uint8_t pin_ = 0;
  Phase phase_ = Phase::kIdle;
  uint32_t phase_until_ms_ = 0;
  bool pressing_long_ = false;  // 正在执行的这一下是长按吗，决定时长与效果

  // 目标式而不是队列式：不预先算"要按几下"，而是每按完一下都用最新的
  // 开环状态重新决策。这样新指令半路插进来也不会让次数失配。
  bool goal_active_ = false;
  uint8_t goal_step_ = 0;
  uint8_t press_budget_ = 0;  // 一个目标最多按这么多下，防止跑飞后无限按

  uint8_t step_ = 0;  // 开环假设的原板当前档位，0 = 关机
  bool powered_ = false;
  bool needs_resync_ = false;
};
