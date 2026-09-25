/** Required native serial payload shared by plugin and npm package validators. */
export const SERIAL_RUNTIME_FILES = Object.freeze([
  "native/serialport.cjs",
  "native/dependencies.json",
  "native/licenses/serialport/LICENSE",
  "native/licenses/@serialport--bindings-cpp/LICENSE",
  "prebuilds/win32-x64/@serialport+bindings-cpp.node",
  "prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node",
  "prebuilds/linux-x64/@serialport+bindings-cpp.glibc.node",
  "prebuilds/linux-arm64/@serialport+bindings-cpp.armv8.glibc.node",
]);
