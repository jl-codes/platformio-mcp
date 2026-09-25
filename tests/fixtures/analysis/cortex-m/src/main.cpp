// Repository-owned build-only Cortex-M symbolization fixture.
volatile unsigned int fixture_counter = 0;

__attribute__((always_inline)) inline unsigned int fixture_inline(unsigned int value) {
    return value + 7;
}
__attribute__((noinline)) unsigned int fixture_add(unsigned int value) {
    return fixture_inline(value);
}
int main() {
    fixture_counter = fixture_add(35);
    while (true) {}
}
