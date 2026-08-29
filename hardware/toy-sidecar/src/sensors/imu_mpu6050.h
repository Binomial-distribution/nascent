// MPU6050 六轴：electroniccats/MPU6050（I2Cdevlib 血统）的薄封装。
// 文件不叫 mpu6050.h：Windows 大小写不敏感，会挡住 #include <MPU6050.h>。
//
// 封装只做单位换算：库给的是原始 LSB，协议要的是 mg 与 dps x10。
// 量程与 DLPF 的选择理由写在 .cpp 里。
#pragma once

#include <stdint.h>

struct ImuSample {
  int16_t accel_mg[3];      // 毫 g
  int16_t gyro_dps_x10[3];  // 度/秒 x10
};

class Mpu6050 {
 public:
  // addr: AD0 接地为 0x68，接高为 0x69
  bool begin(uint8_t sda, uint8_t scl, uint8_t addr = 0x68);

  bool read(ImuSample &out);
  bool ok() const { return ok_; }

 private:
  bool ok_ = false;
};
