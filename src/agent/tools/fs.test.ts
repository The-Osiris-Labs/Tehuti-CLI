import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fsTools, markFileAsRead } from "./fs.js";
import type { ToolContext } from "./registry.js";

describe("File System Tools", () => {
	let tempDir: string;
	let ctx: ToolContext;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tehuti-fs-test-"));
		ctx = {
			cwd: tempDir,
			env: {},
			sessionId: "test-session",
			model: "test-model",
			config: {} as any,
		};
	});

	afterEach(async () => {
		await fs.remove(tempDir);
	});

	describe("read tool", () => {
		const readTool = fsTools.find((t) => t.name === "read");

		it("should read a simple file", async () => {
			const filePath = path.join(tempDir, "test.txt");
			await fs.writeFile(filePath, "Hello, World!\nLine 2\nLine 3");

			const result = await readTool?.execute({ file_path: filePath }, ctx);

			expect(result.success).toBe(true);
			expect(result.output).toContain("1: Hello, World!");
			expect(result.output).toContain("2: Line 2");
			expect(result.output).toContain("3: Line 3");
		});

		it("should read file with offset", async () => {
			const filePath = path.join(tempDir, "test.txt");
			await fs.writeFile(filePath, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

			const result = await readTool?.execute(
				{ file_path: filePath, offset: 3 },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("3: Line 3");
			expect(result.output).not.toContain("1: Line 1");
		});

		it("should read file with limit", async () => {
			const filePath = path.join(tempDir, "test.txt");
			await fs.writeFile(filePath, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

			const result = await readTool?.execute(
				{ file_path: filePath, limit: 2 },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(result.output).toContain("1: Line 1");
			expect(result.output).toContain("2: Line 2");
			expect(result.output).not.toContain("3: Line 3");
		});

		it("should reject path traversal attempts", async () => {
			const maliciousPath = path.join(
				tempDir,
				"..",
				"..",
				"..",
				"etc",
				"passwd",
			);
			const result = await readTool?.execute({ file_path: maliciousPath }, ctx);

			expect(result.success).toBe(false);
		});

		it("should reject sensitive files", async () => {
			const envFile = path.join(tempDir, ".env");
			await fs.writeFile(envFile, "SECRET=abc123");

			const result = await readTool?.execute({ file_path: envFile }, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("sensitive");
		});

		it("should reject symlinks", async () => {
			const targetFile = path.join(tempDir, "target.txt");
			const linkFile = path.join(tempDir, "link.txt");
			await fs.writeFile(targetFile, "target content");
			await fs.symlink(targetFile, linkFile);

			const result = await readTool?.execute({ file_path: linkFile }, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("symlink");
		});

		it("should handle non-existent files", async () => {
			const result = await readTool?.execute(
				{ file_path: path.join(tempDir, "nonexistent.txt") },
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Failed to read file");
		});

		it("should handle directories", async () => {
			const dirPath = path.join(tempDir, "subdir");
			await fs.ensureDir(dirPath);

			const result = await readTool?.execute({ file_path: dirPath }, ctx);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a file");
		});
	});

	describe("write tool", () => {
		const writeTool = fsTools.find((t) => t.name === "write");

		it("should write a new file", async () => {
			const filePath = path.join(tempDir, "new.txt");
			const content = "Hello, World!";

			const result = await writeTool?.execute(
				{ file_path: filePath, content },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.readFile(filePath, "utf-8")).toBe(content);
		});

		it("should require reading before overwriting", async () => {
			const filePath = path.join(tempDir, "existing.txt");
			await fs.writeFile(filePath, "existing content");

			const result = await writeTool?.execute(
				{ file_path: filePath, content: "new content" },
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Read tool");
		});

		it("should allow writing after reading", async () => {
			const filePath = path.join(tempDir, "existing.txt");
			await fs.writeFile(filePath, "existing content");
			markFileAsRead(filePath);

			const result = await writeTool?.execute(
				{ file_path: filePath, content: "new content" },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.readFile(filePath, "utf-8")).toBe("new content");
		});

		it("should create parent directories", async () => {
			const filePath = path.join(tempDir, "subdir", "deep", "file.txt");

			const result = await writeTool?.execute(
				{ file_path: filePath, content: "test" },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.pathExists(filePath)).toBe(true);
		});

		it("should reject path traversal", async () => {
			const maliciousPath = path.join(
				tempDir,
				"..",
				"..",
				"..",
				"tmp",
				"malicious.txt",
			);

			const result = await writeTool?.execute(
				{ file_path: maliciousPath, content: "test" },
				ctx,
			);

			expect(result.success).toBe(false);
		});
	});

	describe("edit tool", () => {
		const editTool = fsTools.find((t) => t.name === "edit");

		it("should edit file with exact match", async () => {
			const filePath = path.join(tempDir, "edit.txt");
			await fs.writeFile(filePath, "Hello World");
			markFileAsRead(filePath);

			const result = await editTool?.execute(
				{
					file_path: filePath,
					old_string: "World",
					new_string: "Tehuti",
				},
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.readFile(filePath, "utf-8")).toBe("Hello Tehuti");
		});

		it("should require reading before editing", async () => {
			const filePath = path.join(tempDir, "edit.txt");
			await fs.writeFile(filePath, "Hello World");

			const result = await editTool?.execute(
				{
					file_path: filePath,
					old_string: "World",
					new_string: "Tehuti",
				},
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Read tool");
		});

		it("should fail if old string not found", async () => {
			const filePath = path.join(tempDir, "edit.txt");
			await fs.writeFile(filePath, "Hello World");
			markFileAsRead(filePath);

			const result = await editTool?.execute(
				{
					file_path: filePath,
					old_string: "NotFound",
					new_string: "Tehuti",
				},
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});

		it("should fail on multiple matches without replace_all", async () => {
			const filePath = path.join(tempDir, "edit.txt");
			await fs.writeFile(filePath, "foo bar foo");
			markFileAsRead(filePath);

			const result = await editTool?.execute(
				{
					file_path: filePath,
					old_string: "foo",
					new_string: "baz",
				},
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("occurrences");
		});

		it("should replace all with replace_all flag", async () => {
			const filePath = path.join(tempDir, "edit.txt");
			await fs.writeFile(filePath, "foo bar foo baz foo");
			markFileAsRead(filePath);

			const result = await editTool?.execute(
				{
					file_path: filePath,
					old_string: "foo",
					new_string: "qux",
					replace_all: true,
				},
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.readFile(filePath, "utf-8")).toBe("qux bar qux baz qux");
		});

		it("should reject path traversal", async () => {
			const maliciousPath = path.join(
				tempDir,
				"..",
				"..",
				"..",
				"etc",
				"hosts",
			);

			const result = await editTool?.execute(
				{
					file_path: maliciousPath,
					old_string: "old",
					new_string: "new",
				},
				ctx,
			);

			expect(result.success).toBe(false);
		});
	});

	describe("list_dir tool", () => {
		const listDirTool = fsTools.find((t) => t.name === "list_dir");

		it("should list directory contents", async () => {
			await fs.writeFile(path.join(tempDir, "file1.txt"), "");
			await fs.writeFile(path.join(tempDir, "file2.txt"), "");
			await fs.ensureDir(path.join(tempDir, "subdir"));

			const result = await listDirTool?.execute({ dir_path: tempDir }, ctx);

			expect(result.success).toBe(true);
			expect(result.output).toContain("file1.txt");
			expect(result.output).toContain("file2.txt");
			expect(result.output).toContain("subdir/");
		});

		it("should handle empty directory", async () => {
			const result = await listDirTool?.execute({ dir_path: tempDir }, ctx);

			expect(result.success).toBe(true);
			expect(result.output).toContain("empty");
		});

		it("should fail on non-existent directory", async () => {
			const result = await listDirTool?.execute(
				{ dir_path: path.join(tempDir, "nonexistent") },
				ctx,
			);

			expect(result.success).toBe(false);
		});
	});

	describe("create_dir tool", () => {
		const createDirTool = fsTools.find((t) => t.name === "create_dir");

		it("should create directory", async () => {
			const dirPath = path.join(tempDir, "newdir");

			const result = await createDirTool?.execute({ dir_path: dirPath }, ctx);

			expect(result.success).toBe(true);
			expect(await fs.pathExists(dirPath)).toBe(true);
		});

		it("should create nested directories with recursive", async () => {
			const dirPath = path.join(tempDir, "a", "b", "c");

			const result = await createDirTool?.execute(
				{ dir_path: dirPath, recursive: true },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.pathExists(dirPath)).toBe(true);
		});
	});

	describe("delete_file tool", () => {
		const deleteFileTool = fsTools.find((t) => t.name === "delete_file");

		it("should delete file", async () => {
			const filePath = path.join(tempDir, "todelete.txt");
			await fs.writeFile(filePath, "content");

			const result = await deleteFileTool?.execute(
				{ file_path: filePath },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.pathExists(filePath)).toBe(false);
		});

		it("should fail on non-existent file", async () => {
			const result = await deleteFileTool?.execute(
				{ file_path: path.join(tempDir, "nonexistent.txt") },
				ctx,
			);

			expect(result.success).toBe(false);
		});
	});

	describe("copy tool", () => {
		const copyTool = fsTools.find((t) => t.name === "copy");

		it("should copy file", async () => {
			const source = path.join(tempDir, "source.txt");
			const dest = path.join(tempDir, "dest.txt");
			await fs.writeFile(source, "content");

			const result = await copyTool?.execute(
				{ source, destination: dest },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.readFile(dest, "utf-8")).toBe("content");
		});
	});

	describe("move tool", () => {
		const moveTool = fsTools.find((t) => t.name === "move");

		it("should move file", async () => {
			const source = path.join(tempDir, "source.txt");
			const dest = path.join(tempDir, "dest.txt");
			await fs.writeFile(source, "content");

			const result = await moveTool?.execute(
				{ source, destination: dest },
				ctx,
			);

			expect(result.success).toBe(true);
			expect(await fs.pathExists(source)).toBe(false);
			expect(await fs.readFile(dest, "utf-8")).toBe("content");
		});
	});
});
