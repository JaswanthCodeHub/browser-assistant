import json
import unittest
from unittest.mock import AsyncMock, patch
import main
from code_contract import validate_starter_interface, normalize_starter_code

STARTER = 'class solution { public: int minimumBalls(vector<int>& counts) { } };'
CORRECT = 'class solution { public: int minimumBalls(vector<int>& counts) { return counts.size(); } };'


def result(code, language='cpp'):
    return json.dumps([{'type':'code','language':language,'code':code,'approach':'Count entries.',
                        'time_complexity':'O(n)','space_complexity':'O(1)'}])


class InterfaceTests(unittest.TestCase):
    def test_cpp_parameter_names_are_not_part_of_the_callable_signature(self):
        starter = 'class solution { public: int countSubarrays(vector<int>& arr, int k) {} };'
        code = 'class solution { public: int countSubarrays(vector<int>& nums, int target) { return nums.size() + target; } };'
        validate_starter_interface(code, starter, 'cpp')
        # Validation must leave the body and its parameter references unchanged.
        checked = main.validate_code_results(result(code), 'cpp', require_code=True, starter_code=starter)
        self.assertEqual(json.loads(checked)[0]['code'], code)
        for invalid in [code.replace('int countSubarrays', 'long long countSubarrays'),
                        code.replace('vector<int>&', 'vector<int>'),
                        code.replace('vector<int>&', 'const vector<int>&'),
                        code.replace('int target', 'long long target'),
                        code.replace('public:', 'private:'),
                        code.replace('countSubarrays', 'countSubArrays')]:
            with self.subTest(code=invalid), self.assertRaisesRegex(ValueError, 'Generated interfaces:'):
                validate_starter_interface(invalid, starter, 'cpp')

    def test_cpp_declarator_names_are_ignored_but_nested_types_and_qualifiers_remain_checked(self):
        starter = 'struct solution { int f(int values[3], void (*callback)(int item)) const {} };'
        code = 'struct solution { int f(int /* values */ nums[3], void (*fn)(int value)) const { return 0; } };'
        validate_starter_interface(code, starter, 'cpp')
        for invalid in [code.replace('[3]', '[4]'), code.replace('(int value)', '(double value)'),
                        code.replace(' const {', ' {')]:
            with self.subTest(code=invalid), self.assertRaises(ValueError):
                validate_starter_interface(invalid, starter, 'cpp')
        validate_starter_interface('int f(int, const int*) { return 0; }',
                                   'int f(int n, const int* values) {}', 'cpp')
        validate_starter_interface('int f(int renamed = 3) { return renamed; }',
                                   'int f(int original = 3) {}', 'cpp')
        with self.assertRaises(ValueError):
            validate_starter_interface('int f(int renamed = 4) { return renamed; }',
                                       'int f(int original = 3) {}', 'cpp')

    def test_json_parser_preserves_nested_cpp_source_and_literal_think_tags(self):
        code='class solution { public: int f() { if (true) { return 1; } return 0; } };\nconst char* tag="<think>literal data</think>";'
        item=json.loads(result(code))[0]
        for payload in [json.dumps(item),'```json\n'+json.dumps(item)+'\n```']:
            self.assertEqual(json.loads(main.clean_json(payload))[0]['code'],code)
        mcq={'type':'mcq','answer':'Option A: 13'}
        self.assertEqual(json.loads(main.clean_json(json.dumps({'results':[mcq]}))),[mcq])

    def test_extra_cpp_main_is_removed_only_after_the_required_interface_is_verified(self):
        driver='\nint main() { solution s; vector<int> a{1,2}; return s.minimumBalls(a); }'
        self.assertEqual(normalize_starter_code(CORRECT+driver,STARTER,'cpp'),CORRECT)
        with self.assertRaisesRegex(ValueError,'class name changed'):
            normalize_starter_code(CORRECT.replace('solution','Solution')+driver,STARTER,'cpp')

    def test_full_program_main_and_main_mentions_inside_literals_are_preserved(self):
        program='int main() { return 0; }'
        self.assertEqual(normalize_starter_code(program,'int main() {}','cpp'),program)
        for source in [CORRECT+'\n// int main() {}',CORRECT+'\nconst char* note = "int main() {}";']:
            self.assertEqual(normalize_starter_code(source,STARTER,'cpp'),source)
        self.assertEqual(normalize_starter_code(program,'','cpp'),program)

    def test_ambiguous_multiple_drivers_are_not_silently_removed(self):
        program=CORRECT+'\nint main() {return 0;}\nint main(int n) {return n;}'
        self.assertEqual(normalize_starter_code(program,STARTER,'cpp'),program)
        with self.assertRaisesRegex(ValueError,'do not add main'):
            main.validate_code_results(result(program),'cpp',require_code=True,starter_code=STARTER)

    def test_explicit_code_envelopes_are_normalized_without_accepting_review_verdicts(self):
        code_item=json.loads(result(CORRECT))[0]
        code_item.pop('type')
        for wrapper in [code_item,[code_item],{'results':[code_item]}]:
            validated=main.validate_code_results(json.dumps(wrapper),'cpp',require_code=True,starter_code=STARTER)
            self.assertEqual(json.loads(validated)[0]['type'],'code')
        for wrapper in [{'verdict':'pass','code':CORRECT}, {'type':'mcq','answer':'Option A: 1'}]:
            with self.assertRaisesRegex(ValueError,'did not contain a code solution'):
                main.validate_code_results(json.dumps(wrapper),'cpp',require_code=True,starter_code=STARTER)

    def test_cpp_class_case_signature_reference_access_and_main_are_checked(self):
        validate_starter_interface(CORRECT, STARTER, 'cpp')
        for invalid in (CORRECT.replace('solution', 'Solution'),
                        CORRECT.replace('minimumBalls', 'solve'),
                        CORRECT.replace('vector<int>&', 'vector<int>'),
                        CORRECT.replace('int minimumBalls', 'long long minimumBalls'),
                        CORRECT.replace('public:', 'private:'),
                        CORRECT + '\nint main() { return 0; }'):
            with self.subTest(code=invalid), self.assertRaises(ValueError):
                validate_starter_interface(invalid, STARTER, 'cpp')

    def test_main_is_preserved_when_the_portal_supplies_a_complete_program(self):
        validate_starter_interface('int main() { return 0; }', 'int main() { }', 'cpp')

    def test_other_portal_languages_preserve_named_entry_points(self):
        cases = [('python','def solve(n):\n    pass','def solve(n):\n    return n'),
                 ('javascript','function main(n) {}','function main(n) {console.log(n);}'),
                 ('java','class Solution { public int solve(int n) {return 0;} }',
                  'class Solution { public int solve(int n) {return n;} }')]
        for language, starter, correct in cases:
            with self.subTest(language=language):
                validate_starter_interface(correct, starter, language)
                with self.assertRaises(ValueError):
                    validate_starter_interface(correct.replace('solve','different').replace('main','different'), starter, language)


class PreSubmitQualityTests(unittest.IsolatedAsyncioTestCase):
    async def test_equivalent_count_subarrays_signature_goes_to_review_without_regeneration(self):
        starter = 'class solution { public: int countSubarrays(vector<int>& arr, int k) {} };'
        code = 'class solution { public: int countSubarrays(vector<int>& nums, int target) { int answer = 0; for (int i = 0; i < nums.size(); ++i) { int sum = 0; for (int j = i; j < nums.size(); ++j) { sum += nums[j]; if (sum == target) ++answer; } } return answer; } };'
        generator = AsyncMock(return_value=result(code))
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[]}')
        checked = await main.generate_validated_result(generator, [], 'cpp', require_code=True,
                                                       reviewer=reviewer, starter_code=starter)
        self.assertEqual(json.loads(checked)[0]['code'], code)
        self.assertEqual(generator.await_count, 1)
        self.assertEqual(reviewer.await_count, 1)

    async def test_real_signature_mismatch_retry_includes_original_starter_and_both_interfaces(self):
        wrong = CORRECT.replace('int minimumBalls', 'long long minimumBalls')
        generator = AsyncMock(side_effect=[result(wrong), result(CORRECT)])
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[]}')
        checked = await main.generate_validated_result(generator, [], 'cpp', require_code=True,
                                                       reviewer=reviewer, starter_code=STARTER)
        self.assertEqual(json.loads(checked)[0]['code'], CORRECT)
        correction = generator.await_args.args[0][-1]['content']
        self.assertIn(STARTER, correction)
        self.assertIn('intminimumBalls(vector<int>&)', correction)
        self.assertIn('longlongminimumBalls(vector<int>&)', correction)
        self.assertIn('do not change an int return type to long long', correction)
        self.assertEqual(reviewer.await_count, 1)

    async def test_added_main_and_missing_type_are_fixed_before_review_without_another_generation(self):
        item=json.loads(result(CORRECT+'\nint main() { return 0; }'))[0]
        item.pop('type')
        generator=AsyncMock(return_value=json.dumps(item))
        reviewer=AsyncMock(return_value='{"verdict":"pass","issues":[]}')
        checked=await main.generate_validated_result(generator, [], 'cpp',require_code=True,
                                                     reviewer=reviewer,starter_code=STARTER)
        self.assertEqual(json.loads(checked)[0]['code'],CORRECT)
        self.assertEqual(generator.await_count,1)
        self.assertNotIn('int main()',reviewer.await_args.args[0][1]['content'])

    async def test_wrong_class_is_regenerated_before_a_result_can_reach_the_portal(self):
        generator = AsyncMock(side_effect=[result(CORRECT.replace('solution','Solution')),result(CORRECT)])
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[]}')
        validated = await main.generate_validated_result(generator, [], 'cpp', require_code=True,
                                                         reviewer=reviewer, starter_code=STARTER)
        self.assertIn('class solution',json.loads(validated)[0]['code'])
        self.assertEqual(generator.await_count,2)
        self.assertIn('class name changed',generator.await_args.args[0][-1]['content'])
        self.assertEqual(reviewer.await_count,1)

    async def test_every_difficulty_gets_review_even_when_fast_mode_is_enabled(self):
        for difficulty in ['Easy','Medium','Hard']:
            generator=AsyncMock(return_value=result(CORRECT))
            reviewer=AsyncMock(return_value='{"verdict":"pass","issues":[]}')
            with self.subTest(difficulty=difficulty), patch.object(main,'FAST_CODE_MODE',True), \
                 patch.object(main,'try_groq',generator), patch.object(main,'try_independent_code_review',reviewer):
                response=await main.solve_questions(main.PageContent(text=f'{difficulty}: implement minimumBalls.',
                    url='https://learning.ccbp.in/question/example',practice_type='code',language='cpp',
                    review_before_submit=True,starter_code=STARTER))
            self.assertTrue(response['code_reviewed'])
            self.assertEqual(reviewer.await_count,1)
            self.assertIn(STARTER,str(generator.await_args.args[0]))

    async def test_logic_is_corrected_and_reviewed_again_before_returning_first_submission(self):
        wrong='def factorial(n):\n    return n'
        correct='def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)'
        generator=AsyncMock(side_effect=[result(wrong,'python'),result(correct,'python')])
        reviewer=AsyncMock(side_effect=['{"verdict":"fail","issues":["factorial(3) must be 6, not 3"]}',
                                        '{"verdict":"pass","issues":[]}'])
        checked=await main.generate_validated_result(generator, [], 'python', require_code=True,
                    reviewer=reviewer,starter_code='def factorial(n):\n    pass')
        self.assertIn('factorial(n - 1)',json.loads(checked)[0]['code'])
        self.assertEqual(reviewer.await_count,2)
        self.assertNotIn('complete executable solution',generator.await_args.args[0][-1]['content'])

    async def test_reviewed_auto_coding_keeps_tail_samples_and_repairs_mismatch(self):
        text = ('Write a Python program to print the value on two indented lines.\n'
                + 'Details about formatting.\n' * 500
                + 'Constraints\nThe value can be zero.\nSample Input 1\n3\nSample Output 1\n  3\n3  3\n'
                  'Explanation\nSpaces are significant.\nSample Input 2\n0\nSample Output 2\n  0\n0  0')
        wrong = 'n = input()\nprint(n)'
        correct = 'n = input()\nprint("  " + n)\nprint(n + "  " + n)'
        generator = AsyncMock(side_effect=[result(wrong, 'python'), result(correct, 'python')])
        def verdict(outputs):
            return json.dumps({'verdict': 'pass', 'issues': [], 'sample_outputs': [
                {'id': index, 'output': output} for index, output in enumerate(outputs, 1)
            ]})
        reviewer = AsyncMock(side_effect=[verdict(['3', '0']), verdict(['  3\n3  3\n', '  0\n0  0\n'])])
        with patch.object(main, 'try_groq', generator), patch.object(main, 'try_independent_code_review', reviewer):
            solved = await main.solve_questions(main.PageContent(
                text=text, url='https://example.test', practice_type='auto', review_before_submit=True))
        self.assertTrue(solved['code_reviewed'])
        self.assertEqual(json.loads(solved['results'])[0]['code'], correct)
        self.assertIn('The value can be zero.', generator.await_args_list[0].args[0][1]['content'])
        self.assertIn('Sample 2', generator.await_args_list[1].args[0][-1]['content'])
        self.assertIn('"id": 2, "input": "0"', reviewer.await_args.args[0][1]['content'])

    async def test_pass_without_all_sample_outputs_cannot_verify_code(self):
        reviewer = AsyncMock(return_value='{"verdict":"pass","issues":[]}')
        with self.assertRaisesRegex(ValueError, 'every supplied sample'):
            await main.review_and_correct_code(AsyncMock(), [], result('print(3)', 'python'), 'python',
                                               reviewer=reviewer, samples=[('3', '3')])

    async def test_local_fallback_cannot_bypass_the_requested_review(self):
        reviewer=AsyncMock(return_value='{"verdict":"pass","issues":[]}')
        with patch.object(main,'try_groq',AsyncMock(side_effect=RuntimeError('unavailable'))), \
             patch.object(main,'try_ollama',AsyncMock(return_value=result(CORRECT))), \
             patch.object(main,'try_independent_code_review',reviewer):
            response=await main.solve_questions(main.PageContent(text='Implement minimumBalls.',
                url='https://example.test',practice_type='code',language='cpp',
                review_before_submit=True,starter_code=STARTER))
        self.assertTrue(response['code_reviewed'])
        self.assertEqual(reviewer.await_count,1)

    async def test_a_review_pass_cannot_override_a_changed_interface_during_repair(self):
        generator=AsyncMock(side_effect=[result(CORRECT),result(CORRECT.replace('solution','Solution')),
                                        result(CORRECT.replace('solution','Solution'))])
        reviewer=AsyncMock(side_effect=['{"verdict":"fail","issues":["Fix algorithm"]}',
                                       '{"verdict":"pass","issues":[]}'])
        with self.assertRaisesRegex(ValueError,'class name changed'):
            await main.generate_validated_result(generator, [], 'cpp', require_code=True,
                                                 reviewer=reviewer, starter_code=STARTER)

    async def test_pattern_spacing_gets_two_corrections_and_exact_sample_contract(self):
        expected = '*\n* *\n*   *\n* * * *'
        wrong = 'print("*")'
        correct = ('n = int(input())\nfor row in range(1, n + 1):\n'
                   '    if row == 1:\n        print("*")\n'
                   '    elif row == n:\n        print(" ".join(["*"] * n))\n'
                   '    else:\n        print("*" + " " * (2 * row - 3) + "*")')
        generator = AsyncMock(side_effect=[result(wrong, 'python'), result(wrong, 'python'), result(correct, 'python')])
        def review(output):
            return json.dumps({'verdict': 'pass', 'issues': [], 'sample_outputs': [{'id': 1, 'output': output}]})
        reviewer = AsyncMock(side_effect=[review('*'), review('*\n* *\n* *\n* * * *'), review(expected + '\n')])
        checked = await main.generate_validated_result(generator, [], 'python', require_code=True,
                                                       reviewer=reviewer, samples=[('4', expected)])
        self.assertEqual(json.loads(checked)[0]['code'], correct)
        self.assertEqual(reviewer.await_count, 3)
        repair = generator.await_args_list[2].args[0][-1]['content']
        self.assertIn('line widths (spaces count)', repair)
        self.assertIn('"text": "*   *", "width": 5', repair)
        self.assertIn('"type": "code"', repair)

    async def test_correction_verdict_is_regenerated_as_code_before_independent_review(self):
        generator = AsyncMock(side_effect=[result('print(0)', 'python'),
            '{"verdict":"pass","issues":[]}', result('print(4)', 'python')])
        reviewer = AsyncMock(side_effect=['{"verdict":"fail","issues":["Expected 4, not 0"]}',
                                         '{"verdict":"pass","issues":[]}'])
        checked = await main.generate_validated_result(generator, [], 'python', require_code=True, reviewer=reviewer)
        self.assertEqual(json.loads(checked)[0]['code'], 'print(4)')
        self.assertEqual(generator.await_count, 3)
        self.assertEqual(reviewer.await_count, 2)
        self.assertIn('Do not return MCQ answers or a review verdict', generator.await_args.args[0][-1]['content'])

    async def test_unverified_code_is_not_reported_as_an_api_key_failure(self):
        generator = AsyncMock(return_value=result('print(0)', 'python'))
        reviewer = AsyncMock(return_value='{"verdict":"fail","issues":["Incorrect sample output"]}')
        with patch.object(main, 'TEXT_MODELS', ['primary']), patch.object(main, 'try_groq', generator), \
             patch.object(main, 'try_independent_code_review', reviewer), \
             patch.object(main, 'try_ollama', AsyncMock(side_effect=RuntimeError('not running'))):
            with self.assertRaises(main.HTTPException) as error:
                await main.solve_questions(main.PageContent(text='Write a Python program to print 4.',
                    url='https://example.test', practice_type='code', language='python', review_before_submit=True))
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(error.exception.detail['code'], 'code_review_unconfirmed')
        self.assertIn('two corrections', error.exception.detail['message'])
        self.assertEqual(reviewer.await_count, 3)
