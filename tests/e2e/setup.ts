import { setupSSEInterceptor, teardownSSEInterceptor } from "../mocks/sse-interceptor.js";
import { beforeAll, afterAll } from "vitest";

beforeAll(() => {
  setupSSEInterceptor();
});

afterAll(() => {
  teardownSSEInterceptor();
});
