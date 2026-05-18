import { initProject } from "../tools/projects.js";
import type { ProjectInitResult } from "../types.js";

export type InitProjectCoreInput = {
  board: string;
  framework?: string;
  projectDir: string;
  platformOptions?: Record<string, string>;
};

export async function initProjectCore(
  input: InitProjectCoreInput,
): Promise<ProjectInitResult> {
  return initProject(input);
}
