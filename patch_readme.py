import re

with open("README.md", "r") as f:
    content = f.read()

# 1. Fix the intro
target1 = "Unlike heavy desktop apps or bloated web wrappers, Tehuti runs directly in your terminal,"
replacement1 = "It runs natively in your terminal,"
content = content.replace(target1, replacement1)

# 2. Fix the networking bullet
target2 = "- **Blazing Fast Networking:** No sluggish SDKs here. Tehuti uses a hand-rolled `fetch` + Server-Sent Events (SSE) implementation with `undici` connection pooling. It’s raw, direct HTTP communication for zero-latency streaming."
replacement2 = "- **Blazing Fast Networking:** Tehuti uses a highly optimized `fetch` + Server-Sent Events (SSE) implementation with `undici` connection pooling. It establishes raw, direct HTTP communication for zero-latency streaming."
content = content.replace(target2, replacement2)

# 3. Remove the entire AI Agent section and its intro
target3 = r"## 🤖 For AI Agents Reading This Repository[\s\S]*?---\n"
content = re.sub(target3, "", content)

with open("README.md", "w") as f:
    f.write(content)

