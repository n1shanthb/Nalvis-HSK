#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
import re
import sys
violations = []
for path in [*Path('contracts/src').rglob('*.sol'), *Path('contracts/script').rglob('*.sol')]:
    source = re.sub(r'/\*.*?\*/|//[^\n]*', '', path.read_text(), flags=re.S)
    if re.search(r'\btx\s*\.\s*origin\b', source):
        violations.append(f'{path}: tx.origin forbidden')
    # Scan balanced approve arguments, including multiline and abi.encodeCall forms.
    for match in re.finditer(r'\bapprove\s*[,\(]', source):
        start = source.find('(', match.start())
        depth = 0
        for end in range(start, len(source)):
            if source[end] == '(':
                depth += 1
            elif source[end] == ')':
                depth -= 1
                if depth == 0:
                    break
        if re.search(r'type\s*\(\s*uint256\s*\)\s*\.\s*max', source[start:end+1]):
            violations.append(f'{path}: unlimited approval forbidden')
if violations:
    print('\n'.join(violations), file=sys.stderr)
    sys.exit(1)
print('Contract rules pass: no tx.origin or approve(type(uint256).max).')
PY
