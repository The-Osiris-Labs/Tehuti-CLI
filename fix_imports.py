import os
import re

def replacer(match):
    prefix = match.group(1) # "import" or "import type"
    imports = match.group(2)
    path = match.group(3)
    
    # Check if OpenRouterClient is imported
    if 'OpenRouterClient' in imports:
        # We need to split the import
        other_imports = re.sub(r'OpenRouterClient,?\s*', '', imports).strip()
        # Clean trailing comma
        if other_imports.endswith(','): other_imports = other_imports[:-1]
        
        new_path = path.replace('openrouter', 'base-client')
        
        res = f'{prefix} {{ OpenRouterClient }} from "{path}";\n'
        if other_imports:
            res += f'{prefix} {{ {other_imports} }} from "{new_path}";'
        return res
    else:
        new_path = path.replace('openrouter', 'base-client')
        return match.group(0).replace(path, new_path)

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
        
    original = content
    
    content = re.sub(r'(import(?:\s+type)?)\s+\{([^}]+)\}\s+from\s+[\'"]((?:(?:\.\./)+|\./)(?:api/)?openrouter(?:\.js)?)[\'"]', replacer, content)

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, _, files in os.walk('./src'):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            process_file(os.path.join(root, file))

