#include <iostream>
#include <thread>
#include <chrono>

int main() {
    std::cout << "[SYSTEM] Native rig starting up..." << std::endl;
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    std::cout << "[SYSTEM] Initializing subsystems..." << std::endl;
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    std::cout << "[SYSTEM] Boot complete. Entering heartbeat loop." << std::endl;

    int tick = 0;
    while (true) {
        std::cout << "[HEARTBEAT] Tick: " << tick++ << " - Native rig executing!" << std::endl;
        std::this_thread::sleep_for(std::chrono::seconds(3));
    }
    return 0;
}
