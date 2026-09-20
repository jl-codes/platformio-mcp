/** Project-init compatibility must obtain both permissions before filesystem initialization. */
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), init: vi.fn() }));
vi.mock("../src/core/action-dispatcher.js", () => ({
  dispatchAuthorizedAction: mocks.dispatch,
}));
vi.mock("../src/tools/projects.js", () => ({ initProject: mocks.init }));
import { executeInitCompatibility } from "../src/adapters/init-compat.js";
it("does not initialize when configuration disclosure is denied", async () => {
  mocks.dispatch.mockRejectedValueOnce(new Error("read denied"));
  await expect(
    executeInitCompatibility(
      { project_dir: "new-project", board: "esp32dev" },
      {},
      {},
    ),
  ).rejects.toThrow("read denied");
  expect(mocks.init).not.toHaveBeenCalled();
});
it("binds ordered options to initialization authorization before execution", async () => {
  mocks.dispatch.mockImplementation(
    async (action, _args, _context, callback) => {
      if (action === "get_project_config") return callback();
      throw new Error("init denied");
    },
  );
  const options = ["build_flags=-DFIRST", "build_flags=-DSECOND"];
  await expect(
    executeInitCompatibility(
      {
        project_dir: "new-project",
        board: "esp32dev",
        project_options: options,
        approval_id: "init",
      },
      {},
      {},
    ),
  ).rejects.toThrow("init denied");
  expect(mocks.dispatch.mock.calls.at(-1)?.[1]).toMatchObject({
    projectOptions: options,
    approvalId: "init",
  });
  expect(mocks.init).not.toHaveBeenCalled();
});
