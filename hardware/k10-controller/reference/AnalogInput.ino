/*!
 * @file  AnalogInput.ino
 * @brief Reads the analogue input from pin P0 and displays the analogue value on the screen.
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
    pinMode(P0, INPUT);
}
void loop() {
    k10.canvas->canvasText((String("Analogl IO P0 status: ") + String((analogRead(P0)))), 1, 0x0000FF);
    k10.canvas->updateCanvas();
}