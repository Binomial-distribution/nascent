#include "command_mailbox.h"

#include <Arduino.h>

namespace {
portMUX_TYPE g_mail_mux = portMUX_INITIALIZER_UNLOCKED;
}

void CommandMailbox::post(const nl_command_t &cmd) {
  portENTER_CRITICAL(&g_mail_mux);
  if (cmd.cmd == NL_CMD_STOP) {
    stop_pending_ = true;
    cmd_pending_ = false;
  } else if (!stop_pending_) {
    queued_ = cmd;
    cmd_pending_ = true;
  }
  portEXIT_CRITICAL(&g_mail_mux);
}

bool CommandMailbox::take(nl_command_t &out) {
  portENTER_CRITICAL(&g_mail_mux);
  const bool stop = stop_pending_;
  const bool had = cmd_pending_;
  const nl_command_t queued = queued_;
  stop_pending_ = false;
  cmd_pending_ = false;
  portEXIT_CRITICAL(&g_mail_mux);

  if (stop) {
    out = {};
    out.cmd = NL_CMD_STOP;
    return true;
  }
  if (had) {
    out = queued;
    return true;
  }
  return false;
}
