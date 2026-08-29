// 安全总督：玩具侧**唯一**有权决定实际输出档位的模块。
//
// 其它模块（传输层收到的指令、入体推断、链路状态、BOOT 键）只能向它提供输入，
// 谁都不能绕过它直接调 Ao3400::requestLevel。main.cpp 里只有一处出口。
//
// 优先级从高到低：
//   1. 闩锁停机（安全词 / 急停）—— 只能被 BOOT 键长按清除，断电也算
//   2. 链路丢失 —— 手机断连，立即归零
//   3. 失控模式超时 —— 超过 NL_WILD_TIMEOUT_MS 强制退回手动并归零
//   4. 静止暂停 —— 静止超过 NL_STILL_PAUSE_MS 归零，动起来自动恢复
//   5. unknown 入体状态 —— 禁止**自动**加档，手动不受限
//   6. 档位封顶 —— 协议 1..8，原板九档永不触碰第 9 档
//
// 关于第 6 条：NL_LEVEL_MAX = 8 而原板有 9 档，
// 「最高档不可达」就是 90% 封顶在 demo 硬件上的物理实现，不是巧合。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

class SafetyGovernor {
 public:
  void begin(uint32_t now_ms);

  // --- 输入 ---
  // onCommand **不实现 NL_CMD_RESUME**：解除闩锁不是一条可投递的指令。
  // 详见实现里的那段注释与 clearLatch 的说明。
  void onCommand(const nl_command_t &cmd, uint32_t now_ms);
  void onSensors(nl_insert_state_t insert, bool still, uint32_t still_ms);
  void onLink(bool up, uint32_t now_ms);
  void onEstop(uint32_t now_ms);

  // 联调 press_key：取出后由 main 去按 GPIO7。总督只决定「允不允许按」，
  // 不自己写引脚。闩锁期间指令进不来（DownlinkGate 已挡）。
  bool takeKeyPress(bool &hold);

  void tick(uint32_t now_ms);

  // --- 输出：这四个值是玩具侧的最终结论 ---
  uint8_t level() const { return effective_level_; }
  nl_mode_t mode() const { return mode_; }
  nl_led_state_t led() const;
  nl_alert_t alert() const { return alert_; }

  bool latched() const { return latched_; }

  // 闩锁停机后唯一的解除入口。
  //
  // **只允许 boot_key 的处理函数调用它。** 不要从传输层、不要从任何解析
  // downlink 的地方、更不要从 onCommand 里调。自动或远程恢复是绝对禁止的——
  // 用户喊停之后设备自己动起来是这个产品最坏的失败模式。
  // 这条约束靠"指令通道里不存在恢复路径"来保证，不靠各处自觉过滤。
  void clearLatch(uint32_t now_ms);

 private:
  void recompute(uint32_t now_ms);

  // 由模式推断这条指令是自动还是手动：
  // 手动模式的档位来自用户在 App 上的直接操作；
  // 情景与失控模式的档位来自剧本或云端，属于自动。
  // 协议帧里不带这个标志，是因为它可由模式唯一确定，多一个字段就多一个说谎的机会。
  bool isAutoPath() const { return mode_ != NL_MODE_FREE; }

  uint8_t requested_level_ = 0;
  uint8_t effective_level_ = 0;
  nl_mode_t mode_ = NL_MODE_FREE;
  nl_led_state_t requested_led_ = NL_LED_STATE_MODE_DEFAULT;
  nl_alert_t alert_ = NL_ALERT_NONE;

  bool latched_ = false;
  bool link_up_ = false;
  bool still_ = false;
  uint32_t still_ms_ = 0;
  nl_insert_state_t insert_ = NL_INSERT_STATE_UNKNOWN;

  uint32_t wild_since_ms_ = 0;

  bool pending_key_press_ = false;
  bool pending_key_hold_ = false;
};
