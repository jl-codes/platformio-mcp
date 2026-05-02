import { macroTask } from "../hooks/useNotifyWatch";
import raf from "@rc-component/util/es/raf";
export default async function delayFrame() {
  return new Promise(resolve => {
    macroTask(() => {
      raf(() => {
        resolve();
      });
    });
  });
}