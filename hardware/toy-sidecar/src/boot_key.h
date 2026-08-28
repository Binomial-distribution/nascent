// BOOT 键 —— 玩具侧唯一的本地物理入口。
//
// 去掉 K10 之后，板上再没有屏幕和摇杆，能就近按到的只剩开发板自带的 BOOT 键。
// 它承担两件事，而且只承担这两件：
//
//   短按（松手在 BOOT_STOP_MAX_MS 内）  → 本地急停，走 SafetyGovernor::onEstop
//   长按（按住到 BOOT_RESUME_HOLD_MS） → 解除停机闩锁
//
// **长按解闩锁是全系统唯一能让设备重新动起来的动作。**
// 它必须留在软件够不着的地方：App 和云端都发不出 resume，
// SafetyGovernor 里也没有 resume 分支，clearLatch() 只有这里的调用方会调。
// 这条路径以前在 K10 上（板载 A+B 双键），K10 删掉之后落到本板。
//
// 中间那段 600ms～2000ms 是刻意留空的死区：既不停机也不恢复。
// 不这样做的话，一次"想停机但手慢了"的按压会变成一次恢复。
//
// GPIO0 是 strapping 脚：上电时被按住会进下载模式，那种情况下这段代码不会跑。
// 但键卡在低电平（焊接短路、按键失效）仍然可能，所以 poll 要求**先观察到一次
// 松开状态**才开始接受按压——否则一块坏板上电就会自己解除闩锁。
#pragma once

#include <stdint.h>

class BootKey {
 public:
  enum class Event : uint8_t {
    kNone,
    kStop,    // 短按：本地急停
    kResume,  // 长按到阈值：解除闩锁
  };

  void begin(uint8_t pin);

  // 每轮主循环调用，不要降频：停机的响应时间是产品红线。
  Event poll(uint32_t now_ms);

 private:
  uint8_t pin_ = 0;

  // 未观察到松开之前不接受任何按压，防止卡键在上电瞬间伪造一次长按。
  bool armed_ = false;

  bool raw_ = false;         // 去抖后的稳定电平（true = 按下）
  bool pending_raw_ = false; // 正在计时确认的电平
  uint32_t edge_ms_ = 0;     // pending_raw_ 出现的时刻

  bool pressed_ = false;     // 当前是否处于一次有效按压中
  uint32_t press_ms_ = 0;    // 该次按压的起始时刻
  bool resume_fired_ = false; // 本次按压已经触发过长按，松手前不再触发
};
