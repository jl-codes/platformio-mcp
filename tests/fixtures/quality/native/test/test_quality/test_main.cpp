// Repository-owned real PlatformIO report fixture; no hardware is accessed.
#include <unity.h>
void setUp() {}
void tearDown() {}
void expected_case() {
#ifdef FIXTURE_EXPECT_FAILURE
    TEST_ASSERT_EQUAL(1, 2);
#else
    TEST_ASSERT_EQUAL(2, 1 + 1);
#endif
}
int main() { UNITY_BEGIN(); RUN_TEST(expected_case); return UNITY_END(); }
