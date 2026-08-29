#include "imu_mpu6050.h"

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
  // ESP32 内部上拉大约 45kΩ。杜邦线 + 400kHz 时沿太慢，ACK 经常丢。
  // 先开内部上拉、降到 100kHz；仍无设备再让人加 4.7k 外置上拉。
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  Wire.begin(sda, scl, 100000);

  Serial.printf("[imu] I2C SDA=GPIO%u SCL=GPIO%u 100kHz（内部上拉已开）\n", sda, scl);

  uint8_t found = 0;
  const uint8_t candidates[] = {addr, static_cast<uint8_t>(addr == 0x68 ? 0x69 : 0x68)};
  for (uint8_t a : candidates) {
    Wire.beginTransmission(a);
    const uint8_t err = Wire.endTransmission();
    Serial.printf("[imu]   地址 0x%02X %s\n", a, err == 0 ? "有 ACK" : "无应答");
    if (err == 0 && found == 0) found = a;
  }

  if (found == 0) {
    Serial.println("[imu] 总线上没有 MPU6050。程序脚位/地址没写错；下一步查 VCC=3.3V、共地、SDA=8、SCL=9。");
    Serial.println("[imu] 内部上拉已启用仍无 ACK 时，SDA、SCL 各加 4.7k 到 3V3（不要接到 5V）。");
    ok_ = false;
    return false;
  }

  if (found != addr) {
    Serial.printf("[imu] AD0 当前对应 0x%02X（接高是 0x69），已改跟这个地址说话\n", found);
  }

  Wire.beginTransmission(found);
  Wire.write(0x75);  // WHO_AM_I
  if (Wire.endTransmission(false) != 0 ||
      Wire.requestFrom(static_cast<int>(found), 1) != 1) {
    Serial.println("[imu] 读 WHO_AM_I 失败");
    ok_ = false;
    return false;
  }
  const uint8_t who = Wire.read();
  Serial.printf("[imu] WHO_AM_I=0x%02X（0x68=MPU6050，0x70=MPU6500 克隆，都按六轴用）\n", who);
  if (who == 0x00 || who == 0xFF) {
    Serial.println("[imu] WHO_AM_I 无效，不是能用的惯性芯片");
    ok_ = false;
    return false;
  }

  g_mpu = MPU6050(found, &Wire);
  g_mpu.initialize();
  // 不要用库的 testConnection()：它只认 MPU6050 的 6bit ID 0x34，
  // 市面 GY-521 大量是 MPU6500（WHO=0x70），I2C 明明通也会被判失败。

  // 量程取最灵敏档：入体推断关心的是 1g 附近的姿态与体动，
  // 不是冲击，量程开大只会白白损失分辨率。
  g_mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  g_mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);

  // DLPF 44Hz：压得掉振动电机的高频噪声，又保留判定体动所需的 1–3Hz 成分。
  g_mpu.setDLPFMode(MPU6050_DLPF_BW_42);
  // 内部 1kHz / (1+9) = 100Hz，远高于我们 12Hz 的读取率，读到的永远是新样本。
  g_mpu.setRate(9);

  Serial.printf("[imu] 六轴 @0x%02X WHO=0x%02X 就绪\n", found, who);
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
