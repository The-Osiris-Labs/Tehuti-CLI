import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { parseAST } from "./ast.js";

describe("AST Parser Tool Robustness and Stress Tests", () => {
	const mockCtx = {
		cwd: process.cwd(),
		workingDir: process.cwd(),
		env: {},
		timeout: 30000,
	};

	function createLocalTempFile(postfix: string, content: string): string {
		const name = path.join(
			process.cwd(),
			`.tmp_stress_${Math.random().toString(36).substring(2)}${postfix}`,
		);
		fs.writeFileSync(name, content, "utf8");
		return name;
	}

	it("should parse an empty file or whitespace-only file successfully without crashing", async () => {
		const emptyFile = createLocalTempFile(".js", "");
		const spaceFile = createLocalTempFile(".ts", "   \n\t  \n   ");

		try {
			const resEmpty = await parseAST({ file_path: emptyFile }, mockCtx);
			expect(resEmpty.success).toBe(true);
			const emptyData = JSON.parse(resEmpty.output);
			expect(emptyData).toEqual([]);

			const resSpace = await parseAST({ file_path: spaceFile }, mockCtx);
			expect(resSpace.success).toBe(true);
			const spaceData = JSON.parse(resSpace.output);
			expect(spaceData).toEqual([]);
		} finally {
			fs.unlinkSync(emptyFile);
			fs.unlinkSync(spaceFile);
		}
	});

	it("should parse a file consisting only of comments successfully", async () => {
		const commentFile = createLocalTempFile(
			".js",
			`
			// This is a single line comment
			/*
				This is a multi-line comment
				with braces { } and function keywords
				function test() {}
			*/
		`,
		);

		try {
			const res = await parseAST({ file_path: commentFile }, mockCtx);
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);
			expect(data).toEqual([]);
		} finally {
			fs.unlinkSync(commentFile);
		}
	});

	it("should handle extremely malformed/broken syntax in JS/TS files", async () => {
		const brokenJs = createLocalTempFile(
			".js",
			`
			class A {
				method1(a, {
					// Missing matching parameter brace, body, etc.
			
			function unresolved( {
		`,
		);

		try {
			const res = await parseAST({ file_path: brokenJs }, mockCtx);
			// Even with broken syntax, tree-sitter or regex fallback should survive and not throw/crash
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);
			expect(Array.isArray(data)).toBe(true);
		} finally {
			fs.unlinkSync(brokenJs);
		}
	});

	it("should handle deeply nested functions/scopes (150 levels deep)", async () => {
		let content = "";
		let suffix = "";
		for (let i = 0; i < 150; i++) {
			content += `function level_${i}() {\n`;
			suffix += `}\n`;
		}
		content += `const leaf = 42;\n${suffix}`;

		const nestedFile = createLocalTempFile(".js", content);

		try {
			const res = await parseAST({ file_path: nestedFile }, mockCtx);
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBeGreaterThan(0);
		} finally {
			fs.unlinkSync(nestedFile);
		}
	});

	it("should handle a massive file (2MB JS file) with thousands of declarations", async () => {
		let content = "";
		for (let i = 0; i < 5000; i++) {
			content += `class Service${i} {\n  constructor() {}\n  async call${i}(arg) {\n    return arg;\n  }\n}\n`;
			content += `function helper${i}() { return ${i}; }\n`;
		}

		const largeFile = createLocalTempFile(".js", content);

		try {
			const start = Date.now();
			const res = await parseAST({ file_path: largeFile }, mockCtx);
			const duration = Date.now() - start;
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);
			expect(data.length).toBeGreaterThan(5000);
			console.log(`Parsed 2MB file (10000+ definitions) in ${duration}ms`);
		} finally {
			fs.unlinkSync(largeFile);
		}
	});

	it("should handle files with extremely long lines", async () => {
		const longLine = "a".repeat(100000);
		const content = `// ${longLine}\nfunction test() {\n  const x = "${longLine}";\n}`;
		const longLineFile = createLocalTempFile(".js", content);

		try {
			const res = await parseAST({ file_path: longLineFile }, mockCtx);
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);
			const testFunc = data.find((n: any) => n.name === "test");
			expect(testFunc).toBeDefined();
		} finally {
			fs.unlinkSync(longLineFile);
		}
	});

	it("should handle binary files gracefully without crashing or hanging", async () => {
		const buf = Buffer.alloc(500000);
		for (let i = 0; i < buf.length; i++) {
			buf[i] = Math.floor(Math.random() * 256);
		}

		const binFile = createLocalTempFile(".bin", buf.toString("utf8"));
		const jsBinFile = createLocalTempFile(".js", buf.toString("utf8"));

		try {
			const resBin = await parseAST({ file_path: binFile }, mockCtx);
			expect(resBin.success).toBe(true);
			const dataBin = JSON.parse(resBin.output);
			expect(Array.isArray(dataBin)).toBe(true);

			const resJsBin = await parseAST({ file_path: jsBinFile }, mockCtx);
			expect(resJsBin.success).toBe(true);
			const dataJsBin = JSON.parse(resJsBin.output);
			expect(Array.isArray(dataJsBin)).toBe(true);
		} finally {
			fs.unlinkSync(binFile);
			fs.unlinkSync(jsBinFile);
		}
	});

	it("should handle curly braces and keywords in comments and string literals without false-positive AST nesting", async () => {
		const content = `
			// This comment has a { curly brace and a function keyword inside it
			/*
				class NestedCommentClass {
					method() {}
				}
			*/
			const val = "class InsideString { method() {} }";
			function realFunction() {
				const x = "{";
				const y = "}";
			}
		`;

		const tempFile = createLocalTempFile(".js", content);

		try {
			const res = await parseAST({ file_path: tempFile }, mockCtx);
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);

			const nestedCommentClass = data.find(
				(n: any) => n.name === "NestedCommentClass",
			);
			expect(nestedCommentClass).toBeUndefined();

			const insideString = data.find((n: any) => n.name === "InsideString");
			expect(insideString).toBeUndefined();

			const realFunc = data.find((n: any) => n.name === "realFunction");
			expect(realFunc).toBeDefined();
		} finally {
			fs.unlinkSync(tempFile);
		}
	});

	it("should parse python files using regex fallback with nested/indented classes and functions", async () => {
		const pyContent = `
class RootClass:
    def method_one(self):
        # Mismatched indentation and comments
        pass

    class InnerClass:
        def inner_method(self):
            pass

def root_func():
    pass
`;
		const tempFile = createLocalTempFile(".py", pyContent);

		try {
			const res = await parseAST({ file_path: tempFile }, mockCtx);
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);
			expect(data).toHaveLength(2); // RootClass and root_func

			const rootClass = data.find((n: any) => n.name === "RootClass");
			expect(rootClass).toBeDefined();
			expect(rootClass.children).toHaveLength(2); // method_one and InnerClass

			const innerClass = rootClass.children.find(
				(c: any) => c.name === "InnerClass",
			);
			expect(innerClass).toBeDefined();
			expect(innerClass.children).toHaveLength(1); // inner_method
		} finally {
			fs.unlinkSync(tempFile);
		}
	});

	it("should parse rust files using brace regex fallback with complex structures and comments", async () => {
		const rustContent = `
			/// Complex comment with struct Point { x: i32 }
			pub struct Point {
				x: i32,
				y: i32,
			}

			impl Point {
				// Comment with fn inside
				pub fn get_x(&self) -> i32 {
					self.x
				}
			}
		`;

		const tempFile = createLocalTempFile(".rs", rustContent);

		try {
			const res = await parseAST({ file_path: tempFile }, mockCtx);
			expect(res.success).toBe(true);
			const data = JSON.parse(res.output);

			const pointStruct = data.find(
				(n: any) => n.name === "Point" && n.type === "class",
			);
			expect(pointStruct).toBeDefined();

			const pointImpl = data.find(
				(n: any) => n.name === "Point" && n.start.line > 5,
			);
			expect(pointImpl).toBeDefined();
			expect(pointImpl.children).toHaveLength(1);
			expect(pointImpl.children[0].name).toBe("get_x");
		} finally {
			fs.unlinkSync(tempFile);
		}
	});
});
