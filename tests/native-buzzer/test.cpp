#include "buzzer.h"
#include <thread>
#include <cstdio>
int main(){
 Buzzer b;b.init(1,false);
 std::thread producer([&]{for(int i=0;i<100000;i++){b.playCue(static_cast<BuzzerCue>(1+i%9));b.beep(i%500+1);}});
 std::thread consumer([&]{for(int i=0;i<500000;i++)b.handleBuzzer(millis());});
 std::thread volume([&]{for(int i=0;i<100000;i++)b.setVolume(i%101);});
 producer.join();consumer.join();volume.join();
 b.setVolume(100);b.playCue(BUZZER_CUE_LAP);b.handleBuzzer(millis()+1000);
 puts("PASS: concurrent cue replacement, completion and volume updates");
}
