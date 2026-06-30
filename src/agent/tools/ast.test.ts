import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { parseAST, parseRegexFallback } from "./ast.js";

describe("AST Parser Tool", () => {
	const mockCtx = {
		cwd: process.cwd(),
		workingDir: process.cwd(),
		env: {},
		timeout: 30000,
	};

	function createLocalTempFile(postfix: string, content: string): string {
		const name = path.join(
			process.cwd(),
			`.tmp_test_${Math.random().toString(36).substring(2)}${postfix}`,
		);
		fs.writeFileSync(name, content, "utf8");
		return name;
	}

	it("should parse a simple JavaScript file with tree-sitter", async () => {
		const jsContent = `
			class Person {
				constructor(name) {
					this.name = name;
				}
				sayHello() {
					console.log("Hello");
				}
			}
			function add(a, b) {
				return a + b;
			}
			const subtract = (a, b) => a - b;
			let age = 30;
		`;

		const tempFilePath = createLocalTempFile(".js", jsContent);

		try {
			const res = await parseAST({ file_path: tempFilePath }, mockCtx);
			expect(res.success).toBe(true);

			const data = JSON.parse(res.output);
			expect(data).toHaveLength(4);

			// Person class
			const person = data.find((n: any) => n.name === "Person");
			expect(person).toBeDefined();
			expect(person.type).toBe("class");
			expect(person.children).toHaveLength(2); // constructor and sayHello

			const sayHello = person.children.find((c: any) => c.name === "sayHello");
			expect(sayHello).toBeDefined();
			expect(sayHello.type).toBe("method");

			// add function
			const addFunc = data.find((n: any) => n.name === "add");
			expect(addFunc).toBeDefined();
			expect(addFunc.type).toBe("function");
			expect(addFunc.parameters).toEqual(["a", "b"]);

			// subtract function (arrow function)
			const subFunc = data.find((n: any) => n.name === "subtract");
			expect(subFunc).toBeDefined();
			expect(subFunc.type).toBe("function");

			// age variable
			const ageVar = data.find((n: any) => n.name === "age");
			expect(ageVar).toBeDefined();
			expect(ageVar.type).toBe("variable");
		} finally {
			fs.unlinkSync(tempFilePath);
		}
	});

	it("should parse a TypeScript file with interfaces, modifiers, and return types", async () => {
		const tsContent = `
			export interface User {
				id: number;
				name: string;
			}
			export class UserService {
				private db: any;
				public async getUser(id: number): Promise<User> {
					return this.db.find(id);
				}
			}
		`;

		const tempFilePath = createLocalTempFile(".ts", tsContent);

		try {
			const res = await parseAST({ file_path: tempFilePath }, mockCtx);
			expect(res.success).toBe(true);

			const data = JSON.parse(res.output);
			expect(data).toHaveLength(2);

			// User interface
			const user = data.find((n: any) => n.name === "User");
			expect(user).toBeDefined();
			expect(user.type).toBe("interface");
			expect(user.modifiers).toContain("export");

			// UserService class
			const service = data.find((n: any) => n.name === "UserService");
			expect(service).toBeDefined();
			expect(service.type).toBe("class");
			expect(service.modifiers).toContain("export");
			expect(service.children).toHaveLength(2); // db property and getUser method

			const getUser = service.children.find((c: any) => c.name === "getUser");
			expect(getUser).toBeDefined();
			expect(getUser.type).toBe("method");
			expect(getUser.modifiers).toContain("public");
			expect(getUser.modifiers).toContain("async");
			expect(getUser.parameters).toEqual(["id: number"]);
			expect(getUser.returnType).toBe("Promise<User>");
		} finally {
			fs.unlinkSync(tempFilePath);
		}
	});

	it("should parse a TSX component with tree-sitter", async () => {
		const tsxContent = `
			import React from "react";
			export interface ButtonProps {
				label: string;
				onClick: () => void;
			}
			export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
				return <button onClick={onClick}>{label}</button>;
			};
		`;

		const tempFilePath = createLocalTempFile(".tsx", tsxContent);

		try {
			const res = await parseAST({ file_path: tempFilePath }, mockCtx);
			expect(res.success).toBe(true);

			const data = JSON.parse(res.output);
			expect(data).toBeDefined();

			const button = data.find((n: any) => n.name === "Button");
			expect(button).toBeDefined();
			expect(button.type).toBe("function");
			expect(button.modifiers).toContain("export");
		} finally {
			fs.unlinkSync(tempFilePath);
		}
	});

	describe("Regex Fallback Parser", () => {
		it("should parse a Python file using the regex fallback parser", () => {
			const pyContent = `
class MathUtils:
    def __init__(self, value: int):
        self.value = value

    async def calculate(self, x) -> float:
        return x * 2.0

def root_level_func(a, b):
    pass

config_val = 42
`;

			const data = parseRegexFallback(pyContent, "dummy.py");
			expect(data).toHaveLength(3); // MathUtils, root_level_func, config_val

			const mathUtils = data.find((n) => n.name === "MathUtils");
			expect(mathUtils).toBeDefined();
			expect(mathUtils?.type).toBe("class");
			expect(mathUtils?.children).toHaveLength(2); // __init__, calculate

			const calculate = mathUtils?.children?.find(
				(c) => c.name === "calculate",
			);
			expect(calculate).toBeDefined();
			expect(calculate?.type).toBe("method");
			expect(calculate?.modifiers).toContain("async");
			expect(calculate?.parameters).toEqual(["self", "x"]);
			expect(calculate?.returnType).toBe("float");

			const rootLevelFunc = data.find((n) => n.name === "root_level_func");
			expect(rootLevelFunc).toBeDefined();
			expect(rootLevelFunc?.type).toBe("function");
			expect(rootLevelFunc?.parameters).toEqual(["a", "b"]);

			const configVal = data.find((n) => n.name === "config_val");
			expect(configVal).toBeDefined();
			expect(configVal?.type).toBe("variable");
		});

		it("should parse a Rust file using curly brace regex fallback parser", () => {
			const rustContent = `
pub struct Point {
    x: i32,
    y: i32,
}

impl Point {
    pub fn new(x: i32, y: i32) -> Self {
        Point { x, y }
    }
}

fn add_points(p1: Point, p2: Point) -> Point {
    Point {
        x: p1.x + p2.x,
        y: p1.y + p2.y,
    }
}

pub mut default_origin = Point { x: 0, y: 0 };
`;

			const data = parseRegexFallback(rustContent, "dummy.rs");
			expect(data).toBeDefined();

			const pointStruct = data.find((n) => n.name === "Point");
			expect(pointStruct).toBeDefined();
			expect(pointStruct?.type).toBe("class"); // matches struct/impl/class as class type

			const pointImpl = data.find(
				(n) => n.name === "Point" && n.start.line > 5,
			);
			expect(pointImpl).toBeDefined();

			const addPoints = data.find((n) => n.name === "add_points");
			expect(addPoints).toBeDefined();
			expect(addPoints?.type).toBe("function");
			expect(addPoints?.returnType).toBe("Point");

			const defaultOrigin = data.find((n) => n.name === "default_origin");
			expect(defaultOrigin).toBeDefined();
			expect(defaultOrigin?.type).toBe("variable");
		});
	});
});
