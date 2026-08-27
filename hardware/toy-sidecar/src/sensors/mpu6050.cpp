#include "mpu6050.h"

#include <Arduino.h>
#include <MPU6050.h>
#include <Wire.h>

namespace {

MPU6050 g_mpu;

// ±2g -> 16384 LSB/g；±250dps -> 131 LSB/(度/秒)
constexpr float kAccelLsbPerG = 16384.0f;
constexpr float kGyroLsbPerDps = 131.0f;

}  // namespace

bool Mpu6050::begin(uint8_t sda, uint8_t scl, uint8_t addr) {
  // I2Cdev 直接用全局 Wire，所以引脚必须在 initialize() 之前设好。
  Wire.begin(sda, scl, 400000);

  g_mpu = MPU6050(addr);
  g_mpu.initialize();
  if (!g_mpu.testConnection()) {
    log_e("MPU6050 @0x%02X 无响应，检查 SDA/SCL 与 AD0", addr);
    ok_ = false;
    return false;
  }

  // 量程取最灵敏档：入体推断关心的是 1g 附近的姿态与体动，
  // 不是冲击，量程开大只会白白损失分辨率。
  g_mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  g_mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);

  // DLPF 44Hz：压得掉振动电机的高频噪声，又保留判定体动所需的 1-3Hz 成分。
  g_mpu.setDLPFMode(MPU6050_DLPF_BW_42);
  // 内部 1kHz / (1+9) = 100Hz，远高于我们 12Hz 的读取率，读到的永远是新样本。
  g_mpu.setRate(9);

  ok_ = true;
  return true;
}

bool Mpu6050::read(ImuSample &out) {
  if (!ok_) return false;

  int16_t ax, ay, az, gx, gy, gz;
  g_mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  const int16_t raw_a[3] = {ax, ay, az};
  const int16_t raw_g[3] = {gx, gy, gz};
  for (int i = 0; i < 3; ++i) {
    out.accel_mg[i] = static_cast<int16_t>(raw_a[i] / kAccelLsbPerG * 1000.0f);
    out.gyro_dps_x10[i] = static_cast<int16_t>(raw_g[i] / kGyroLsbPerDps * 10.0f);
  }

  // 芯片有温度寄存器，但那是结温，与人体或接触面温度无关。
  // 拿它当体温是典型误用，这里不读也不上报。
  return true;
}
