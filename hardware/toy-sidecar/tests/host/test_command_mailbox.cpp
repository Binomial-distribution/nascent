// 宿主机行为检查：CommandMailbox 的 stop 优先与覆盖语义。
#include <cstdio>

#include "Arduino.h"
#include "command_mailbox.h"
#include "nascent_protocol.h"

namespace {

int g_failures = 0;

void check(bool ok, const char *what) {
  printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what);
  if (!ok) ++g_failures;
}

nl_command_t make_cmd(uint8_t cmd, uint8_t level = 0) {
  nl_command_t c = {};
  c.cmd = cmd;
  c.level = level;
  return c;
}

}  // namespace

int main() {
  printf("场景 1：空邮箱 take 失败\n");
  {
    CommandMailbox box;
    nl_command_t out = {};
    check(!box.take(out), "空邮箱返回 false");
  }

  printf("场景 2：一条 set_level 原样取出\n");
  {
    CommandMailbox box;
    box.post(make_cmd(NL_CMD_SET_LEVEL, 5));
    nl_command_t out = {};
    check(box.take(out), "有指令可取");
    check(out.cmd == NL_CMD_SET_LEVEL, "cmd 是 set_level");
    check(out.level == 5, "档位是 5");
    check(!box.take(out), "取走之后为空");
  }

  printf("场景 3：后到的 set_level 覆盖先到的\n");
  {
    CommandMailbox box;
    box.post(make_cmd(NL_CMD_SET_LEVEL, 2));
    box.post(make_cmd(NL_CMD_SET_LEVEL, 7));
    nl_command_t out = {};
    check(box.take(out) && out.level == 7, "只留下最新档位");
  }

  printf("场景 4：先 set_level 再 stop，只交出 stop\n");
  {
    CommandMailbox box;
    box.post(make_cmd(NL_CMD_SET_LEVEL, 8));
    box.post(make_cmd(NL_CMD_STOP));
    nl_command_t out = {};
    check(box.take(out) && out.cmd == NL_CMD_STOP, "stop 优先");
    check(!box.take(out), "set_level 被丢弃，不会在 stop 之后执行");
  }

  printf("场景 5：先 stop 再 set_level，set_level 进不了邮箱\n");
  {
    CommandMailbox box;
    box.post(make_cmd(NL_CMD_STOP));
    box.post(make_cmd(NL_CMD_SET_LEVEL, 4));
    nl_command_t out = {};
    check(box.take(out) && out.cmd == NL_CMD_STOP, "仍然是 stop");
    check(!box.take(out), "迟到的加档没有留下");
  }

  printf("场景 6：stop 之后再取一次，不会冒出旧档位\n");
  {
    CommandMailbox box;
    box.post(make_cmd(NL_CMD_SET_LEVEL, 3));
    box.post(make_cmd(NL_CMD_STOP));
    nl_command_t out = {};
    box.take(out);
    box.post(make_cmd(NL_CMD_SET_LEVEL, 6));
    check(box.take(out) && out.cmd == NL_CMD_SET_LEVEL && out.level == 6,
          "stop 被取走之后，新的 set_level 可以进入");
  }

  printf("\n%s（失败 %d 项）\n", g_failures ? "有失败" : "全部通过", g_failures);
  return g_failures ? 1 : 0;
}
