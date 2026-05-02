import { AsyncLocalStorage } from "node:async_hooks";

export const mcpContext = new AsyncLocalStorage<{ activityId: string, targetProjectDir?: string }>();
