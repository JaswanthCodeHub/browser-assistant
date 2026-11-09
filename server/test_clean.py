"""
ZERO-ERROR test suite — tests every edge case for main.py and cross-file checks.
"""
import sys, json, re
sys.path.insert(0, '.')
from main import clean_json, _extract_answer_from_text, build_system_prompt, build_vision_system_prompt, build_user_prompt, has_usable_results, normalize_vision_results

PASS = 0
FAIL = 0

def test(name, actual, expected_fn):
    global PASS, FAIL
    ok = expected_fn(actual)
    status = "PASS" if ok else "FAIL"
    if not ok:
        FAIL += 1
        print(f"  FAIL: {name}")
        print(f"    Got: {repr(actual[:120])}")
    else:
        PASS += 1

# === clean_json tests ===
print("=== clean_json ===")

# T1: Valid JSON passthrough
test("T1: valid JSON", clean_json('[{"type":"mcq","answer":"Option A: foo"}]'),
     lambda r: '"Option A: foo"' in r)

# T2: JSON inside <think> tags
test("T2: JSON after think", clean_json('<think>\nreasoning\n</think>\n[{"type":"mcq","answer":"Option B: bar"}]'),
     lambda r: '"Option B: bar"' in r)

# T3: ONLY <think> tags with answer inside
test("T3: answer in think", clean_json('<think>\nThe answer is Option C: np.std()\n</think>'),
     lambda r: 'Option C' in r and r != '[]')

# T4: Unclosed <think> with answer
test("T4: unclosed think", clean_json('<think>\nCorrect is Option D: 288\nmore reasoning'),
     lambda r: 'Option D' in r and r != '[]')

# T5: Empty input
test("T5: empty", clean_json(''), lambda r: r == '[]')

# T6: None input
test("T6: None", clean_json(None), lambda r: r == '[]')

# T7: Pure text, no answer
test("T7: no answer text", clean_json('I cannot determine anything'),
     lambda r: r != '[]')  # clean_json wraps any non-empty text as a fallback result

# T8: Markdown JSON
test("T8: markdown json", clean_json('```json\n[{"type":"mcq","answer":"Option A: test"}]\n```'),
     lambda r: '"Option A: test"' in r)

# T9: Single JSON object (not array)
test("T9: single object", clean_json('{"type":"mcq","answer":"Option B: xyz"}'),
     lambda r: '"Option B: xyz"' in r and r.startswith('['))

# T10: JSON with newlines in reasoning (needs escaping)
test("T10: newlines in json", clean_json('[{"type":"mcq","reasoning":"step1\\nstep2","answer":"Option A: x"}]'),
     lambda r: 'Option A' in r)

# T11: <think> with uppercase
test("T11: THINK uppercase", clean_json('<THINK>\nAnswer is Option A: foo\n</THINK>'),
     lambda r: 'Option A' in r and r != '[]')

# === _extract_answer_from_text tests ===
print("\n=== _extract_answer_from_text ===")

test("T12: answer is Option X", _extract_answer_from_text("The answer is Option C: np.std()"),
     lambda r: 'Option C' in r and 'np.std()' in r)

test("T13: correct is Option X", _extract_answer_from_text("The correct answer is Option B: 42"),
     lambda r: 'Option B' in r)

test("T14: bold option", _extract_answer_from_text("So **Option D: 288** is right"),
     lambda r: 'Option D' in r and '288' in r)

test("T15: no option at all", _extract_answer_from_text("I have no idea"),
     lambda r: r == '[]')

# === Prompt tests ===
print("\n=== Prompts ===")

sp = build_system_prompt("auto")
test("T16: system prompt not empty", sp, lambda r: len(r) > 50)
test("T17: system prompt has JSON format", sp, lambda r: 'JSON' in r)

vp = build_vision_system_prompt()
test("T18: vision prompt not empty", vp, lambda r: len(r) > 50)
test("T19: vision prompt requests JSON", vp, lambda r: 'JSON array' in r)
code_prompt = build_system_prompt("code", "python")
test("T19a: code mode requests Python", code_prompt,
     lambda r: '"language": "python"' in r and 'Generate the solution in Python only.' in r)
cpp_prompt = build_system_prompt("code", "cpp")
test("T19b: code mode requests C++", cpp_prompt,
     lambda r: '"language": "cpp"' in r and 'Generate the solution in C++ only.' in r)
test("T19c: vision code output requests configured language", build_vision_system_prompt("java"),
     lambda r: '"language": "java"' in r and 'Generate the solution in Java only' in r)

up = build_user_prompt("test text", "http://example.com")
test("T20: user prompt excludes the page URL", up, lambda r: 'http://example.com' not in r)
test("T21: user prompt has text", up, lambda r: 'test text' in r)
test("T21a: user prompt has content", up, lambda r: 'Analyze' in r and 'TEXT CONTENT' in r)

# === Result validation ===
print("\n=== Result validation ===")
test("T21b: accepts answer", has_usable_results('[{"type":"mcq","answer":"Option A: 42"}]'), lambda r: r is True)
test("T21c: rejects model retrieval refusal", has_usable_results('[{"type":"mcq","answer":"Unable to retrieve the skill check questions from the provided URL. Please provide text."}]'), lambda r: r is False)
test("T21d: rejects empty array", has_usable_results('[]'), lambda r: r is False)
test("T21e: unwraps JSON-mode vision result", normalize_vision_results('{"results":[{"type":"mcq","answer":"Option B: 42"}]}'), lambda r: has_usable_results(r))
test("T21f: rejects empty JSON-mode result", normalize_vision_results('{"results":[]}'), lambda r: r == '[]')
test("T21g: rejects incomplete MCQ", has_usable_results('[{"type":"mcq"}]'), lambda r: r is False)
test("T21h: rejects unknown result type", has_usable_results('[{"type":"other","answer":"Option A: 1"}]'), lambda r: r is False)
test("T21i: accepts usable code", has_usable_results('[{"type":"code","code":"print(42)"}]'), lambda r: r is True)

# === Edge cases ===
print("\n=== Edge Cases ===")

# T22: Very long text in clean_json
long_text = '<think>\n' + 'reasoning ' * 1000 + 'the answer is Option A: longval\n</think>'
test("T22: long think block", clean_json(long_text),
     lambda r: 'Option A' in r and r != '[]')

# T23: Multiple JSON objects
test("T23: multi-object", clean_json('[{"type":"mcq","answer":"Option A: x"},{"type":"mcq","answer":"Option B: y"}]'),
     lambda r: 'Option A' in r and 'Option B' in r)

# T24: Whitespace-only input
test("T24: whitespace", clean_json('   \n\t  '), lambda r: r == '[]')

# === Summary ===
print(f"\n{'='*40}")
print(f"PASSED: {PASS}")
print(f"FAILED: {FAIL}")
print(f"TOTAL:  {PASS + FAIL}")
if FAIL == 0:
    print("ALL TESTS PASSED!")
else:
    print(f"!!! {FAIL} TEST(S) FAILED !!!")

# Ensure this executable test script fails CI on any failed assertion.
if FAIL:
    sys.exit(1)
