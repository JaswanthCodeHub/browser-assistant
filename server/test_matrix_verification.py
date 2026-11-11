import json
import unittest
from unittest.mock import AsyncMock, patch

import main
from vision_images import cross_check_text_answers, cross_check_visual_answers, solve_matrix_choice, VisionUnconfirmedError


INVERSE = r'For $A=\begin{bmatrix}2&1\\5&3\end{bmatrix}$, what is $A^{-1}$ computed using the adjugate method?'
INVERSE_ANSWER = r'$\begin{bmatrix}3&-1\\-5&2\end{bmatrix}$'
PRODUCT = 'For matrices $A$ with shape $(m, n)$ and $B$ with shape $(p, q)$, which condition must hold for the product $AB$ to be defined?'
PRODUCT_OPTIONS = '\nA. $m = q$\nB. $n = q$\nC. $m = p$\nD. $n = p$'
PIVOTS = 'How many pivots does the following RREF matrix have? '
PIVOT_OPTIONS = '\nA. 1\nB. 2\nC. 3\nD. 0'


class MatrixChoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_row_parallel_question_uses_inner_dimension_without_a_model(self):
        question = ('In Row Parallelism, why must the input also be split, not just the weights?\n'
                    'Question format: select one answer.\n'
                    'A. So that each GPU receives a smaller batch share.\n'
                    'B. So that the input shape matches the weight rows.\n'
                    'C. So that the output no longer needs combining.\n'
                    'D. So that each GPU can use a different optimizer.')
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            result = await main.solve_questions(main.PageContent(
                text=question, url='https://example.test', practice_type='mcq', verify_answer=True))
            self.assertTrue(result['answer_verified'])
            self.assertEqual(json.loads(result['results'])[0]['answer'], 'Option B: So that the input shape matches the weight rows.')
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    async def test_automation_calculates_both_questions_without_a_provider(self):
        inverse_options = '\n'.join((
            '', f'A. {INVERSE_ANSWER}', r'B. $\begin{bmatrix}3&1\\5&2\end{bmatrix}$',
            r'C. $\begin{bmatrix}-3&1\\5&-2\end{bmatrix}$', r'D. $\begin{bmatrix}2&-1\\-5&3\end{bmatrix}$',
        ))
        cases = (
            ('16of 20 questions1 Mark' + INVERSE, inverse_options, f'Option A: {INVERSE_ANSWER}'),
            ('9of 20 questions1 Mark' + PRODUCT, PRODUCT_OPTIONS, 'Option D: $n = p$'),
            (PIVOTS + '[[1,0,2],[0,1,-1],[0,0,0]]', PIVOT_OPTIONS, 'Option B: 2'),
        )
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for question, options, expected in cases:
                result = await main.solve_questions(main.PageContent(
                    text=question + '\nQuestion format: select one answer.' + options,
                    url='https://example.test', practice_type='mcq', verify_answer=True,
                ))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(json.loads(result['results'])[0]['answer'], expected)
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    async def test_vision_uses_complete_dom_math_without_a_vision_provider(self):
        with patch.object(main, '_groq_clients', []), patch.object(main, 'compress_image_base64', return_value='chart'):
            cases = (
                (PRODUCT, PRODUCT_OPTIONS, 'Option D: $n = p$'),
                (PIVOTS + r'$\begin{bmatrix}1&0&2\\0&1&−1\\0&0&0\end{bmatrix}$', PIVOT_OPTIONS, 'Option B: 2'),
            )
            for question, options, expected in cases:
                result = await main.solve_vision(main.VisionContent(
                    image='chart', text=question + '\nSelect one answer.' + options,
                    url='https://example.test', practice_type='mcq', verify_answer=True,
                ))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(json.loads(result['results'])[0]['answer'], expected)

    def test_rref_pivot_count_for_rectangular_and_zero_matrices(self):
        self.assertEqual(solve_matrix_choice(PIVOTS + '[[0,1,3,0],[0,0,0,1]]' + PIVOT_OPTIONS)['answer'], 'Option B: 2')
        self.assertEqual(solve_matrix_choice(PIVOTS + '[[0,0],[0,0]]' + PIVOT_OPTIONS)['answer'], 'Option D: 0')

    def test_fractional_inverse_and_reversed_product(self):
        inverse = INVERSE.replace(r'2&1\\5&3', r'2&0\\0&4')
        answer = r'$\begin{bmatrix}\frac{1}{2}&0\\0&0.25\end{bmatrix}$'
        options = '\nA. [[2,0],[0,4]]\nB. ' + answer
        self.assertEqual(solve_matrix_choice(inverse + options)['answer'], f'Option B: {answer}')
        reversed_product = PRODUCT.replace('$AB$', '$BA$')
        self.assertEqual(solve_matrix_choice(reversed_product + PRODUCT_OPTIONS)['answer'], 'Option A: $m = q$')

    def test_incomplete_ambiguous_or_unsupported_questions_fall_back(self):
        cases = (
            PRODUCT + PRODUCT_OPTIONS.replace('$m = p$', '$p = n$'),
            PRODUCT + PRODUCT_OPTIONS.replace('C. ', 'E. '),
            PRODUCT + PRODUCT_OPTIONS.replace('$n = p$', '$n = n$'),
            PRODUCT + '\nSelect ALL correct options.' + PRODUCT_OPTIONS,
            PRODUCT + '\nComplete code snippets:\nnot part of the question' + PRODUCT_OPTIONS,
            INVERSE.replace(r'2&1\\5&3', r'2&1\\4&2') + '\nA. ' + INVERSE_ANSWER + '\nB. [[2,0],[0,4]]',
            PIVOTS + '[[1,1],[0,1]]' + PIVOT_OPTIONS,
            PIVOTS + '[[0,0],[0,1]]' + PIVOT_OPTIONS,
            PIVOTS + '[[1,0],[0,1]]' + PIVOT_OPTIONS.replace('C. 3', 'C. 2'),
        )
        for text in cases:
            with self.subTest(text=text):
                self.assertIsNone(solve_matrix_choice(text))


class MatrixVerificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.messages = [
            {'role': 'system', 'content': 'Solve.'},
            {'role': 'user', 'content': r'Find the inverse of $\begin{bmatrix}2&1\\5&3\end{bmatrix}$.'},
        ]
        self.results = json.dumps([{
            'type': 'mcq', 'answer': r'Option B: $\begin{bmatrix}3&-1\\-5&2\end{bmatrix}$',
        }])

    def response(self, answer):
        return json.dumps({'readable': True, 'answers': [{'id': 1, 'answer': answer}]})

    async def test_text_retries_incomplete_check_and_accepts_equivalent_matrix(self):
        complete = AsyncMock(side_effect=['{}', self.response('B. [[3, −1], [-5, 2]]')])
        await cross_check_text_answers(self.messages, self.results, complete)
        self.assertEqual(complete.await_count, 2)
        self.assertNotIn('Option B:', complete.await_args.args[0][-1]['content'])

    async def test_vision_accepts_equivalent_matrix_but_rejects_different_order(self):
        complete = AsyncMock(return_value=self.response('B. [[3,-1],[-5,2]]'))
        self.assertEqual(await cross_check_visual_answers(
            self.messages, self.results, 'test', complete, require_agreement=True), self.results)
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_visual_answers(
                self.messages, self.results, 'test',
                AsyncMock(return_value=self.response('B. [[3,-5],[-1,2]]')), require_agreement=True)

    async def test_text_falls_back_when_both_checks_are_incomplete(self):
        complete = AsyncMock(return_value='{}')
        # When both independent verifications return unparseable JSON, the
        # primary answer is delivered instead of blocking with a 422 error.
        result = await cross_check_text_answers(self.messages, self.results, complete)
        self.assertEqual(result, self.results)
        self.assertEqual(complete.await_count, 2)

    async def test_linked_blank_requires_agreement_on_one_displayed_choice(self):
        text = ('The phone began to (1) ____.\n\nWhich word best fits blank (1)?\n'
                'Question format: select one answer.\nA. ring\nB. red\nC. chair')
        results = json.dumps([{'type': 'mcq', 'answer': 'Option A: ring'}])
        agree = AsyncMock(return_value=self.response('ring'))
        checked = await cross_check_text_answers([], results, agree, question_text=text, require_agreement=True)
        self.assertEqual(json.loads(checked)[0]['answer'], 'Option A: ring')

        for checks in [['{}', '{}'], [self.response('Option B: red'), self.response('Option C: chair')]]:
            with self.subTest(checks=checks), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], results, AsyncMock(side_effect=checks),
                                               question_text=text, require_agreement=True)

    async def test_displayed_choice_agreement_uses_original_option_text(self):
        text = ('Which condition identifies a full traversal of a circular linked list?\n'
                'Question format: select one answer.\nA. current == head after the first visit\n'
                'B. current->next == nullptr\nC. current->next == head immediately\nD. current == nullptr')
        initial = {'type': 'mcq', 'answer': 'Option A', 'reasoning': 'Same node reached again.'}
        complete = AsyncMock(return_value=self.response('current == head after the first visit'))
        result = await cross_check_text_answers([], json.dumps([initial]), complete, question_text=text)
        self.assertEqual(json.loads(result)[0]['answer'], 'Option A: current == head after the first visit')
        complete.assert_awaited_once()

        initial.update(answer='Option C: current->next == head immediately')
        complete = AsyncMock(side_effect=[self.response('Option A'), self.response('A. current == head after the first visit')])
        result = await cross_check_text_answers([], json.dumps([initial]), complete, question_text=text)
        self.assertEqual(json.loads(result), [{'type': 'mcq', 'answer': 'Option A: current == head after the first visit'}])
        self.assertEqual(complete.await_count, 2)

        complete = AsyncMock(side_effect=[self.response('Option A'), self.response('Option B: current == head after the first visit')])
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_text_answers([], json.dumps([initial]), complete, question_text=text)

    async def test_solve_route_requires_agreement_for_one_word_blanks(self):
        question = 'Leo comes (1) ____ Canada.\n\nWhich word best fits blank (1)?\nQuestion format: one word.'
        request = main.PageContent(text=question, url='https://example.test', practice_type='mcq', require_answer_agreement=True)
        primary = json.dumps([{'type': 'mcq', 'question': 'Which word best fits blank (1)?', 'answer': 'from'}])
        with patch.object(main, 'try_groq', AsyncMock(side_effect=[primary, self.response('From')])) as groq, \
             patch.object(main, '_groq_disabled_until', 0):
            result = await main.solve_questions(request)
            self.assertTrue(result['answer_agreement'])
            self.assertEqual(json.loads(result['results'])[0]['answer'], 'from')
            self.assertIn('exactly one word', groq.await_args_list[0].args[0][0]['content'])

        for check in [self.response('away from'), self.response('in'), '{}']:
            with self.subTest(check=check), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], primary, AsyncMock(side_effect=[check, '{}']),
                                               question_text=question, require_agreement=True)
