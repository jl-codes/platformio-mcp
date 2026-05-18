import { getDashboardStatus } from "../api/server.js";

export type DashboardCoreInput = {
  open?: boolean;
  projectDir?: string;
};

export async function getDashboardStatusCore(input: DashboardCoreInput) {
  return getDashboardStatus(input.open, input.projectDir);
}
