"""Check the job lifecycle in docs/spec.md: every status in the table appears in
the state diagram, is reachable from the start, and is either terminal or has a
way out. Run: python3 scripts/check_lifecycle.py"""
import re, sys, pathlib

spec = pathlib.Path(__file__).resolve().parents[1] / "docs" / "spec.md"
s = spec.read_text()

table = s[s.index("## 4. Job lifecycle"):s.index("```mermaid\nstateDiagram-v2")]
statuses = set()
for row in table.splitlines():
    cells = [c.strip() for c in row.split("|")]
    if len(cells) > 3 and "`" in cells[2]:
        statuses |= set(re.findall(r"`([a-z_]+)`", cells[2]))

diagram = re.search(r"```mermaid\nstateDiagram-v2\n(.*?)```", s, re.S).group(1)
edges = re.findall(r"^\s*(\[\*\]|[a-z_]+)\s*-->\s*(\[\*\]|[a-z_]+)", diagram, re.M)
in_diagram = {n for e in edges for n in e} - {"[*]"}

terminal_note = re.search(r"Terminal statuses: (.*?)\.", s)
terminal = set(re.findall(r"`([a-z_]+)`", terminal_note.group(1))) if terminal_note else set()

problems = []
for st in sorted(statuses - in_diagram):
    problems.append(f"in table but not in diagram: {st}")
for st in sorted(in_diagram - statuses):
    problems.append(f"in diagram but not in table: {st}")

reach, frontier = set(), ["[*]"]
while frontier:
    n = frontier.pop()
    for a, b in edges:
        if a == n and b not in reach:
            reach.add(b); frontier.append(b)
for st in sorted(statuses - reach):
    problems.append(f"unreachable: {st}")

has_exit = {a for a, b in edges}
for st in sorted(statuses):
    if st not in has_exit and st not in terminal:
        problems.append(f"dead end (no exit, not marked terminal): {st}")

print(f"{len(statuses)} statuses, {len(edges)} transitions")
print("\n".join(problems) if problems else "OK: no problems found")
sys.exit(1 if problems else 0)
