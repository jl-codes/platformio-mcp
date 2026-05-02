"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = delayFrame;
var _useNotifyWatch = require("../hooks/useNotifyWatch");
var _raf = _interopRequireDefault(require("@rc-component/util/lib/raf"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
async function delayFrame() {
  return new Promise(resolve => {
    (0, _useNotifyWatch.macroTask)(() => {
      (0, _raf.default)(() => {
        resolve();
      });
    });
  });
}