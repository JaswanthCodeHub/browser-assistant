import base64
from io import BytesIO
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import main
from PIL import Image


def code_response(language, code):
    return json.dumps([{
        "type": "code",
        "title": "Solution",
        "language": language,
        "approach": "Apply the required algorithm to the input.",
        "time_complexity": "O(n)",
        "space_complexity": "O(n)",
        "code": code,
    }])


class LanguageDetectionTests(unittest.TestCase):
    def test_explicit_language_requests(self):
        cases = {
            "Write a Python program to reverse a string.": "python",
            "Solve this problem in Python.": "python",
            "Write a C++ program to reverse a string.": "cpp",
            "Solve this problem using Java.": "java",
            "Write JavaScript code to fetch an API.": "javascript",
            "Give me the solution in C.": "c",
            "Write a C# program to read input.": "csharp",
            "Write Go code to parse a file.": "go",
            "Solve this using Rust.": "rust",
            "Write Kotlin code to sort a list.": "kotlin",
            "Give me a PHP solution.": "php",
            "Write an SQL query to count rows.": "sql",
            "Convert the provided C++ code to Python.": "python",
            "The input contains C++ code; write the solution in Python.": "python",
            "Convert the Python version to C++.": "cpp",
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                self.assertEqual(main.detect_requested_language(question), expected)
                prompt = main.build_system_prompt("code", expected)
                self.assertIn(f'language": "{expected}"', prompt)
                self.assertIn(f"Generate the solution in {main.LANGUAGE_NAMES[expected]} only.", prompt)

    def test_language_aliases_and_default(self):
        self.assertEqual(main.normalize_language("C++"), "cpp")
        self.assertEqual(main.normalize_language("C#"), "csharp")
        self.assertEqual(main.resolve_language("No language is requested"), main.CODE_DEFAULT_LANGUAGE)
        with self.assertRaises(ValueError):
            main.resolve_language("Question", "brainfuck")

    def test_code_prompt_preserves_platform_interface_and_required_libraries(self):
        prompt = main.build_system_prompt("code", "python")
        for requirement in (
            "function-only, class/method, complete program, or SQL query",
            "Preserve every provided class, function, method name, signature, parameter order/name/type, return type",
            "only when the problem/platform expects a complete program",
            "Use explicitly required libraries, APIs, or frameworks",
            "language version, runtime/environment, judge/platform",
            "parameter order/name/type, return type",
            "overflow, division-by-zero, recursion depth, termination",
            "Never claim a test was executed unless it actually was",
            '"approach"',
            '"time_complexity"',
            '"space_complexity"',
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, prompt)

    def test_vision_and_review_prompts_include_runtime_platform_audits(self):
        vision_prompt = main.build_vision_system_prompt("java")
        review_prompt = main.build_code_review_prompt("[]", "java")
        for prompt in (vision_prompt, review_prompt):
            with self.subTest(prompt=prompt[:40]):
                self.assertIn("language version", prompt)
                self.assertIn("platform", prompt)
                self.assertIn("parameter", prompt)
                self.assertIn("overflow", prompt)
                self.assertIn("edge cases", prompt)
        self.assertIn("Do not claim runtime/sample execution unless actually performed", review_prompt)

    def test_retry_prompt_keeps_language_and_platform_interface(self):
        retry_prompt = main.build_retry_prompt(
            "class Solution:\n    def run(self, nums): pass",
            "previous candidate",
            "python",
        )
        self.assertIn("locked to Python", retry_prompt)
        self.assertIn("class Solution", retry_prompt)
        self.assertIn("same format as before", retry_prompt.lower())

    def test_language_mismatch_detection_and_python_syntax(self):
        self.assertEqual(
            main.code_language_mismatch("#include <bits/stdc++.h>\nint main() {}", "python"),
            "cpp",
        )
        self.assertEqual(main.code_language_mismatch("print('hello')", "python"), None)
        with self.assertRaisesRegex(ValueError, "syntax error"):
            main.validate_code_results(code_response("python", "def broken("), "python", require_code=True)

    def test_syntax_validation_for_all_supported_languages(self):
        samples = {
            "python": "def reverse_text(value):\n    return value[::-1]",
            "cpp": '#include <iostream>\nint main() { std::cout << "ok"; return 0; }',
            "java": 'class Main { public static void main(String[] args) { System.out.println("ok"); } }',
            "javascript": 'async function fetchApi(url) { return await fetch(url); }',
            "c": '#include <stdio.h>\nint main(void) { printf("ok"); return 0; }',
            "csharp": 'using System;\nclass Program { static void Main() { Console.WriteLine("ok"); } }',
            "go": 'package main\nimport "fmt"\nfunc main() { fmt.Println("ok") }',
            "rust": 'fn main() { println!("ok"); }',
            "kotlin": 'fun main() { println("ok") }',
            "php": '<?php\necho "ok";',
            "sql": 'SELECT COUNT(*) FROM users;',
        }
        for language, code in samples.items():
            with self.subTest(language=language):
                validated = main.validate_code_results(
                    code_response(language, code),
                    language,
                    require_code=True,
                )
                self.assertEqual(json.loads(validated)[0]["language"], language)

    def test_syntax_errors_are_rejected_for_all_supported_languages(self):
        malformed = {
            "python": "def broken(",
            "cpp": "int main( {",
            "java": "class Main {",
            "javascript": "function broken( {",
            "c": "int main( {",
            "csharp": "class Program {",
            "go": "func main( {",
            "rust": "fn main( {",
            "kotlin": "fun main( {",
            "php": "<?php function broken( {",
            "sql": "SELECT * FROM ;",
        }
        for language, code in malformed.items():
            with self.subTest(language=language):
                with self.assertRaisesRegex(ValueError, "syntax error"):
                    main.validate_code_syntax(code, language)


class ProviderPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_fast_code_scan_detects_python_and_retries_wrong_cpp_without_extra_review(self):
        wrong_language = code_response("cpp", "#include <iostream>\nint main() { return 0; }")
        correct_language = code_response("python", "def reverse_text(value):\n    return value[::-1]")
        groq = AsyncMock(side_effect=[wrong_language, correct_language])
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[],"corrected_code":""}')

        with patch.object(main, "try_groq", groq), patch.object(
            main, "try_independent_code_review", reviewer
        ):
            response = await main.solve_questions(main.PageContent(
                text="Write a Python program to reverse a string.",
                url="https://example.test",
                practice_type="auto",
            ))

        result = json.loads(response["results"])[0]
        self.assertEqual(response["language"], "python")
        self.assertEqual(result["language"], "python")
        self.assertTrue(result["code"].startswith("def "))
        self.assertEqual(groq.await_count, 2)
        self.assertEqual(reviewer.await_count, 0)
        for call in groq.await_args_list:
            prompt_messages = call.args[0]
            self.assertIn("Generate the solution in Python only.", prompt_messages[0]["content"])

    async def test_ollama_fallback_uses_compact_code_request_and_keeps_language(self):
        python_solution = code_response("python", "def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)")
        groq = AsyncMock(side_effect=RuntimeError("primary unavailable"))
        ollama = AsyncMock(return_value=python_solution)
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[],"corrected_code":""}')

        with patch.object(main, "try_groq", groq), patch.object(
            main, "try_ollama", ollama
        ), patch.object(main, "try_independent_code_review", reviewer):
            response = await main.solve_questions(main.PageContent(
                text="Solve this problem using Python.",
                url="https://example.test",
                practice_type="code",
            ))

        self.assertEqual(response["provider"], f"ollama ({main.OLLAMA_MODEL})")
        self.assertEqual(response["language"], "python")
        fallback_messages = ollama.await_args.args[0]
        self.assertIn("Write one complete Python solution", fallback_messages[0]["content"])
        self.assertEqual(json.loads(response["results"])[0]["language"], "python")
        # The local fallback already applies syntax/language/completeness
        # checks. A second full review can overflow the local model context.
        self.assertEqual(reviewer.await_count, 0)

    async def test_judge_feedback_repair_uses_focused_prompt_without_extra_review_in_fast_code_mode(self):
        solution = code_response("python", "def sort_values(values):\n    return sorted(values, reverse=True)")
        groq = AsyncMock(return_value=solution)
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[],"corrected_code":""}')
        with patch.object(main, "try_groq", groq), patch.object(
            main, "try_independent_code_review", reviewer
        ):
            response = await main.solve_questions(main.PageContent(
                text="Sort these values. Previous submission failed. Expected Output: 7 5 3 1.",
                url="https://example.test",
                practice_type="code",
                language="python",
                repair_attempt=1,
            ))
        self.assertEqual(json.loads(response["results"])[0]["type"], "code")
        self.assertEqual(reviewer.await_count, 0)
        self.assertIn("REPAIR MODE", groq.await_args.args[0][0]["content"])

    def test_compact_ollama_code_prompt_has_required_schema(self):
        messages = main.build_ollama_code_messages(
            "Write a Python function called add_numbers.",
            "https://example.test/question",
            "python",
        )
        self.assertEqual(len(messages), 2)
        self.assertIn('"type":"code"', messages[0]["content"])
        self.assertIn('"language":"python"', messages[0]["content"])
        self.assertIn("add_numbers", messages[1]["content"])

    async def test_vision_reads_language_then_regenerates_mismatch(self):
        captured_messages = []
        model_responses = iter([
            '{"text":"Solve this problem in Python."}',
            code_response("cpp", "#include <iostream>\nint main() { return 0; }"),
            code_response("python", "print('vision result')"),
        ])

        def create_completion(**kwargs):
            captured_messages.append(kwargs["messages"])
            message = SimpleNamespace(content=next(model_responses))
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

        fake_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=create_completion)
            )
        )
        image_buffer = BytesIO()
        Image.new("RGB", (1, 1), color="black").save(image_buffer, format="PNG")
        image_data = base64.b64encode(image_buffer.getvalue()).decode("ascii")
        with patch.object(main, "get_groq_client", return_value=fake_client), patch.object(
            main, "_groq_clients", [fake_client]
        ), patch.object(
            main,
            "try_independent_code_review",
            AsyncMock(return_value='{"verdict":"pass","issues":[],"corrected_code":""}'),
        ) as reviewer:
            response = await main.solve_vision(main.VisionContent(
                image=f"data:image/png;base64,{image_data}",
                url="https://example.test",
                practice_type="code",
            ))

        self.assertEqual(response["language"], "python")
        self.assertEqual(json.loads(response["results"])[0]["language"], "python")
        self.assertEqual(len(captured_messages), 3)
        self.assertIn("Generate the solution in Python only.", captured_messages[1][0]["content"])
        self.assertIn("Generate the solution in Python only.", captured_messages[2][0]["content"])
        self.assertIn("Solve this problem in Python", reviewer.await_args.args[0][1]["content"])

    async def test_independent_review_corrects_logic_before_returning(self):
        original = code_response("python", "def factorial(n):\n    return n")
        corrected = code_response(
            "python",
            "def factorial(n):\n    result = 1\n    for value in range(2, n + 1):\n        result *= value\n    return result",
        )
        generator = AsyncMock(side_effect=[original, corrected])
        reviewer = AsyncMock(side_effect=[
            '{"verdict":"fail","issues":["The function returns n and does not compute factorial."],"corrected_code":""}',
            '{"verdict":"pass","issues":[],"corrected_code":""}',
        ])
        messages = [
            {"role": "system", "content": main.build_system_prompt("code", "python")},
            {"role": "user", "content": "Write a Python function to calculate factorial."},
        ]

        results = await main.generate_validated_result(
            generator,
            messages,
            "python",
            require_code=True,
            reviewer=reviewer,
        )
        code = json.loads(results)[0]["code"]
        self.assertIn("result *= value", code)
        self.assertEqual(generator.await_count, 2)
        self.assertEqual(reviewer.await_count, 2)

    async def test_code_is_withheld_when_review_still_fails(self):
        wrong_code = code_response("python", "def factorial(n):\n    return n")
        generator = AsyncMock(return_value=wrong_code)
        reviewer = AsyncMock(side_effect=[
            '{"verdict":"fail","issues":["Does not compute factorial."],"corrected_code":""}',
            '{"verdict":"fail","issues":["Still incorrect."],"corrected_code":""}',
        ])
        messages = [
            {"role": "system", "content": main.build_system_prompt("code", "python")},
            {"role": "user", "content": "Write a Python function to calculate factorial."},
        ]

        with self.assertRaisesRegex(ValueError, "still failed independent review"):
            await main.generate_validated_result(
                generator,
                messages,
                "python",
                require_code=True,
                reviewer=reviewer,
            )


if __name__ == "__main__":
    unittest.main()
