/*!
 * @file  AccelerateBall.ino
 * @brief The screen displays a small ball, 
 * which is made to move in the corresponding direction according to the tilted condition of the k10.
 * @copyright   Copyright (c) 2021 DFRobot Co.Ltd (http://www.dfrobot.com)
 * @license     The MIT License (MIT)
 * @author      
 * @version     V1.0
 * @date        2024-12-30
 * @url         
 */
#include "unihiker_k10.h"

volatile float accx, accy, move_x, move_y;

UNIHIKER_K10 k10;
uint8_t      screen_dir=2;

void setup() {
    k10.begin();
    k10.initScreen(screen_dir);
    k10.creatCanvas();
    k10.setScreenBackground(0xFFFFFF);
}
void loop() {
    accx = (k10.getAccelerometerX());
    accy = (k10.getAccelerometerY());
    move_x = (120 + (accx / 3));
    move_y = (120 + (accy / 3));
    k10.canvas->canvasCircle(move_x, move_y, 8, 0x00FF00, 0x00FF00, true);
    k10.canvas->updateCanvas();
    k10.canvas->canvasCircle(move_x, move_y, 9, 0xFFFFFF, 0xFFFFFF, true);
}