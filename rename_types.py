import os
import re

replacements = {
    'OpenRouterMessage': 'StandardMessage',
    'OpenRouterToolCall': 'StandardToolCall',
    'OpenRouterTool': 'StandardTool',
    'OpenRouterStreamChunk': 'StandardStreamChunk',
    'OpenRouterResponse': 'StandardResponse'
}

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
        
    original = content
    
    # 1. Rename types
    for old, new in replacements.items():
        content = content.replace(old, new)
        
    # 2. Fix imports from ../api/openrouter
    # We want to change imports of Standard* from openrouter to base-client
    # Let's find imports like: import { StandardMessage, OpenRouterClient } from "../api/openrouter.js"
    # It's easier to just do it via regex substitution
    
    def replacer(match):
        imports = match.group(1)
        path = match.group(2)
        
        has_client = 'OpenRouterClient' in imports
        
        if has_client:
            other_imports = re.sub(r'OpenRouterClient,?\s*', '', imports).strip()
            new_path = path.replace('openrouter', 'base-client')
            
            res = f'import {{ OpenRouterClient }} from "{path}";\n'
            if other_imports:
                # Remove trailing comma if any
                if other_imports.endswith(','): other_imports = other_imports[:-1]
                res += f'import {{ {other_imports} }} from "{new_path}";'
            return res
        else:
            new_path = path.replace('openrouter', 'base-client')
            return match.group(0).replace(path, new_path)

    content = re.sub(r'import\s+\{([^}]+)\}\s+from\s+[\'"](.*api/openrouter.*)[\'"]', replacer, content)
    content = re.sub(r'import\s+\{([^}]+)\}\s+from\s+[\'"](\./openrouter.*)[\'"]', replacer, content)

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, _, files in os.walk('./src'):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            process_file(os.path.join(root, file))

