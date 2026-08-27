// CD4066 模拟开关：并联原产品的轻触按键。
//
// 边界必须记清楚：
//   - 它只"按按钮"，**不驱动电机**。电机始终由原产品控制板驱动。
//   - 连续电流上限约 10mA 级别，接电机会烧。
//   - 原实体按钮不拆，手按和软件按并存。
//
// 原板行为模型（需在实物上确认）：短按在九档间循环，长按关机，
// 关机态下短按开机并停在第 1 档。
#pragma once

#include <stdint.h>

class Cd4066 {
 public:
  void begin(uint8_t pin);

  // 每轮主循环调用，推进按键时序状态机。
  void tick(uint32_t now_ms);

  // 请求原板停在第 target 档（1..8，对应协议档位）。0 表示关机。
  // 内部自己算要按几下，调用方不需要关心原板当前在哪一档。
  void requestLevel(uint8_t target);

  // 立即关机：清空待发队列，直接排一次长按。停机路径专用。
  void requestOffNow();

  bool busy() const { return pending_ > 0 || phase_ != Phase::kIdle; }
  uint8_t assumed_step() const { return step_; }
  bool powered() const { return powered_; }

  // 开环跟踪难免会跑偏。人工按了实体按钮之后调用这个重新对齐。
  void resync() { needs_resync_ = true; }

 private:
  enum class Phase : uint8_t { kIdle, kPressing, kGap };

  void enqueueShort(uint8_t count);
  void enqueueLong();

  uint8_t pin_ = 0;
  Phase phase_ = Phase::kIdle;
  uint32_t phase_until_ms_ = 0;

  uint8_t pending_ = 0;        // 还要按几下短按
  bool pending_long_ = false;  // 队首是否是一次长按
  uint8_t target_step_ = 0;    // 本次序列结束后应到达的档位

  uint8_t step_ = 0;           // 开环假设的原板当前档位，0 = 关机
  bool powered_ = false;
  bool needs_resync_ = false;
};
