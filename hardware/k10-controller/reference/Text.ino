/*!
 * @file  Text.ino
 * @brief Display temperature and humidity data as text on the screen.
 * @copyright   Copyright (c) 2021 DFRobot Co.Ltd (http://www.dfrobot.com)
 * @license     The MIT License (MIT)
 * @author      
 * @version     V1.0
 * @date        2024-12-30
 * @url         
 */
#include "unihiker_k10.h"

UNIHIKER_K10 k10;
uint8_t      screen_dir=2;


void setup() {
    k10.begin();
    k10.initScreen(screen_dir);
    k10.creatCanvas();
    k10.canvas->canvasText("UNIHIKER K10", 1, 0x0000FF);
    k10.canvas->canvasText("UNIHIKER K10 has on board temp/humi sensor, Acceleration sensor and microphone", 0, 70, 0xFF0000, k10.canvas->eCNAndENFont16, 25, true);
    k10.canvas->canvasText("UNIHIKER K10 has on board temp/humi sensor, Acceleration sensor and microphone", 0, 120, 0x0000FF, k10.canvas->eCNAndENFont24, 10, true);
    k10.canvas->updateCanvas();
    delay(3000);
    k10.canvas->canvasClear(1);
    k10.canvas->updateCanvas();
}
void loop() {

}