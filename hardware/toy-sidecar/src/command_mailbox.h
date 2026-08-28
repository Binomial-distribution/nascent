// 传输层与主循环之间的指令信箱。
//
// BLE 的 GATT 写回调跑在 Bluedroid 任务里（另一个核）。在那里直接调
// applyStopNow / SafetyGovernor::onCommand / Ao3400::requestLevel，会和
// loop() 里的 requestLevel 交叉：关机长按进行到一半，主循环又按目标档位
// 把 goal_active_ 打开，停机就被加档顶掉。
//
// 回调只允许 post()。take() 只在主循环调用。stop 优先：邮箱里同时有
// stop 和别的指令时，take 只交出 stop，其余丢弃。
#pragma once

#include "nascent_protocol.h"

class CommandMailbox {
 public:
  void post(const nl_command_t &cmd);
  bool take(nl_command_t &out);

 private:
  bool stop_pending_ = false;
  bool cmd_pending_ = false;
  nl_command_t queued_{};
};
