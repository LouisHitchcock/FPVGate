Run from the repository root with a C++17 compiler supporting threads:

    g++ -std=c++17 -pthread -I tests/native-buzzer -I lib/BUZZER lib/BUZZER/buzzer.cpp tests/native-buzzer/test.cpp -o buzzer-test
    ./buzzer-test

Exercises simultaneous cue replacement, playback completion and volume changes.
The LEDC stubs yield to expose concurrent access. The unprotected implementation
reproduced an access violation on the Windows bench; the serialized version passes.
This tests playback synchronization; actual PWM/audio requires device verification.
