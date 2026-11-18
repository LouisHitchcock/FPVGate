#pragma once
#include <cstdint>
#include <atomic>
#include <thread>
#include <cassert>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define ESP_ARDUINO_VERSION_MAJOR 2
inline uint32_t millis(){static std::atomic<uint32_t> now{0};return ++now;}
inline void pinMode(int,int){}
inline void digitalWrite(int,int){}
inline void ledcSetup(int,int,int){std::this_thread::yield();}
inline void ledcAttachPin(int,int){}
inline void ledcWrite(int,int){std::this_thread::yield();}
