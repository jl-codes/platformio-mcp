---
name: house-style-documentation
description: Consistently and thoroughly document TypeScript/Node code following the project's "house style". Use this skill whenever documenting, refactoring, or creating new TypeScript modules to ensure they meet the specific JSDoc, method, and naming standards. Also use this skill whenever drafting or reviewing an implementation plan to ensure it adheres to the project structure.
triggers: implementation plan, drafting plan, documentation, refactoring, TypeScript modules, review-ip, ip-review
---

# House Style Documentation

Enforce a specific set of documentation and style standards for TypeScript files in this repository.

## High-Level Standards

1.  **Module Headers**: Every file must have a brief JSDoc header describing its purpose.
2.  **Function/Method Documentation**: All exported functions, methods, and classes must have JSDoc-style comments.
3.  **Variable/Constant Documentation**: Important configuration or global objects should be documented with JSDoc or clear block comments.
4.  **Error Handling**: Utilize Custom Error classes (e.g., `PlatformIOError`) extending from the base error structure, instead of throwing raw `Error` objects where appropriate.
5.  **Naming Conventions**: File names MUST strictly use `kebab-case`. Types, Interfaces, Classes, and Zod schemas MUST be `PascalCase`. Variables and functions MUST be `camelCase`.
6.  **Formatting/Linting**: The codebase utilizes ESLint, Prettier, and stricter TypeScript configurations (`strict: true`, `noUnusedLocals`, etc.). Ensure code is clean and handles types properly. Zod is used for parsing JSON data.
7.  **Implementation Plans**: All implementation plans must be reviewed for house style (Goal, Review Required, Proposed Changes, Verification).

---

## 1. Module Headers

Every TypeScript file MUST start with a brief JSDoc header describing the module's overall responsibility. Do not include large proprietary or C++ style copyright blocks, but DO include a one-line summary of the functions and constants that the module provides.

### Format:
```typescript
/**
 * [Brief descriptive title of the file/module]
 * [Optional detailed multi-line description of the module's responsibility]
 *
 * Provides:
 * - [FunctionName]: [One-line summary]
 * - [CONSTANT_NAME]: [One-line summary]
 */
```

> [!IMPORTANT]
> While TypeScript handles exports implicitly, providing this one-line summary list in the header allows developers to quickly see the services offered by the module without reading the whole file.

---

## 2. Function, Class, and Method Documentation

Use standard JSDoc comment blocks for all exported declarations, classes, schemas, and complex internal functions.

### Format:
```typescript
/**
 * Executes a specific task and validates output
 * @param config Configuration options for the task
 * @returns The validated resulting object
 */
export async function executeTask(config: TaskConfig): Promise<Result> {
  // ...
}
```

---

## 3. Scoped Variables and Constants

For important constants, types, schemas, or variables defined at the module scope, add a short JSDoc or inline comment.

### Example:
```typescript
// Default timeout for commands (5 minutes for builds)
const DEFAULT_TIMEOUT = 300000;

---

## 4. Type and Interface Properties

For properties within exported interfaces or type aliases, prefer using single-line trailing `//` comments instead of multiline JSDoc blocks. This keeps complex data shapes compact and easy to scan. The main interface or type declaration should still use a JSDoc block.

### Example:
```typescript
/**
 * Detailed specification parameters for a single PlatformIO development board.
 */
export interface BoardInfo {
  id: string; // Internal PlatformIO board identifier (e.g., 'esp32dev')
  name: string; // Human-readable name of the board
  platform: string; // Platform identifier (e.g., 'espressif32')
  mcu: string; // Microcontroller unit model
  frequency?: string; // Optional CPU frequency string with units
}
```

---

## 5. Error Handling Style

This library wraps operations that may fail (like CLI commands). Ensure errors are handled explicitly, and use the custom error hierarchy (e.g., `PlatformIOError`, `PlatformIONotInstalledError`) defined in `src/utils/errors.ts`.

### Example:
```typescript
if (!result.success) {
  throw new PlatformIOError(
    `Command failed: ${result.message}`,
    'COMMAND_FAILED',
    { detail: result }
  );
}
```

---

## 5. Naming Conventions

All file names and code symbols MUST follow standard TypeScript conventions.

### Requirements:
- **File Names**: Use strictly `kebab-case.ts` (e.g., `board-manager.ts`).
- **Types, Interfaces, Classes, Schemas**: Use `PascalCase` (e.g., `PlatformIOExecutor`, `BoardInfo`, `GetBoardInfoParamsSchema`).
- **Functions, Methods, Variables**: Use `camelCase` (e.g., `getBoardInfo`, `listBoards`).
- **Global / Module-Scoped Constants**: Use `UPPER_SNAKE_CASE` for immutable static data (e.g., `DEFAULT_TIMEOUT`, `LOG_DIR`).

---

## 6. Implementation Plans

Whenever an implementation plan is produced, it MUST be reviewed and updated to adhere to the project's house style.

### Structure:
- **Goal Description**: Clear, concise explanation of the objective.
- **User Review Required**: Highlight critical decisions or breaking changes using GitHub alerts.
- **Proposed Changes**: Grouped by component, using `[MODIFY]`, `[NEW]`, and `[DELETE]` tags with repository-relative file links (e.g., `[file.ts](src/tools/file.ts)`). Absolute paths to the project directory are FORBIDDEN.
- **Verification Plan**: Practical steps for automated and manual verification.

---

## Workflow

1.  Read the target file OR implementation plan.
2.  Identity missing or substandard documentation/content based on the rules above.
3.  Ensure the file name and module naming follow the TypeScript naming conventions.
4.  For implementation plans, ensure all standard sections are present and correctly formatted.
5.  Regenerate the content with the improved house style.
6.  Ensure existing logic or plan details are PRESERVED exactly; only formatting and clarity should change.
