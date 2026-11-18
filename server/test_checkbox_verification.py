import json
from itertools import permutations
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import main
from vision_images import multiple_choice_question, solve_linked_stack_choices


CHECKBOX_FORMAT = 'Question format: select all that apply; return every correct option as "Option A: ...; Option B: ...".'
POP = 'Which of the following are true about the pop() operation in a stack implemented using a linked list?'
PUSH = 'Which statements are true regarding the push() operation?'
POP_OPTIONS = (
    'It removes the top element from the stack',
    'Check if the stack is empty',
    'It returns the top element without removing it',
    'It adds an element to the top of the stack',
)
PUSH_OPTIONS = (
    'It creates a new node with \x60temp\x60 pointing to it',
    'It updates the \x60top\x60 pointer to the new node',
    'It checks if the stack is full before pushing',
    'It deletes the previous top node',
)
FRUITS = ('Apple', 'Carrot', 'Orange', 'Potato')


def checkbox_request(prompt, options, marker=CHECKBOX_FORMAT):
    return '\n'.join((prompt, marker, *(f'{chr(65 + index)}. {option}' for index, option in enumerate(options))))


def complete_verdict(correct):
    return json.dumps({'readable': True, 'options': [
        {'letter': letter, 'correct': letter in correct} for letter in 'ABCD'
    ]})


class CheckboxVerificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_stack_checkbox_questions_select_both_correct_options_in_every_order(self):
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
                patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for prompt, original in ((POP, POP_OPTIONS), (PUSH, PUSH_OPTIONS)):
                for displayed in permutations(original):
                    with self.subTest(prompt=prompt, displayed=displayed):
                        text = checkbox_request(prompt, displayed)
                        response = await self.solve(text)
                        expected = '; '.join(
                            f'Option {chr(65 + index)}: {option}' for index, option in enumerate(displayed)
                            if option in original[:2]
                        )
                        self.assertEqual(json.loads(response['results'])[0]['answer'], expected)
                        self.assertTrue(response['answer_verified'])
                        self.assertTrue(response['selection_set_verified'])
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    def test_local_stack_check_does_not_infer_altered_or_context_dependent_answers(self):
        for prompt, options in (
            (PUSH.replace('operation?', 'operation in a size-limited stack?'), PUSH_OPTIONS),
            (POP + '\nComplete code snippets:\npop() { return top; }', POP_OPTIONS),
            (POP, (*POP_OPTIONS[:3], 'It updates the top pointer')),
            (POP, (POP_OPTIONS[0],) * 4),
        ):
            with self.subTest(prompt=prompt, options=options):
                parsed = multiple_choice_question(checkbox_request(prompt, options, 'Select ALL correct options.'))
                self.assertIsNone(solve_linked_stack_choices(parsed))

    async def test_complete_verdicts_can_correct_a_primary_answer_that_omits_a_checkbox(self):
        primary = json.dumps([{'type': 'mcq', 'answer': 'Option A: Apple', 'reasoning': 'PRIMARY_ONLY'}])
        provider = AsyncMock(side_effect=[primary, complete_verdict('AC'), complete_verdict('AC')])
        text = checkbox_request('Which foods are fruits in common culinary usage?', FRUITS)
        with patch.object(main, 'try_groq', provider), patch.object(main, 'TEXT_MODELS', ['primary', 'checker']), \
                patch.object(main, '_groq_disabled_until', 0):
            response = await self.solve(text)
        self.assertEqual(json.loads(response['results']), [
            {'type': 'mcq', 'answer': 'Option A: Apple; Option C: Orange'},
        ])
        self.assertTrue(response['answer_agreement'])
        self.assertTrue(response['selection_set_verified'])
        self.assertEqual(provider.await_count, 3)
        self.assertIn(text, provider.await_args_list[1].args[0][1]['content'])
        self.assertNotIn('PRIMARY_ONLY', str(provider.await_args_list[1].args[0]))

    async def test_genuinely_single_correct_checkbox_can_be_verified(self):
        primary = json.dumps([{'type': 'mcq', 'answer': 'A. Apple'}])
        text = checkbox_request('Which displayed item is an apple?', FRUITS)
        provider = AsyncMock(side_effect=[primary, complete_verdict('A')])
        with patch.object(main, 'try_ollama', provider), patch.object(main, 'TEXT_MODELS', []):
            result = await self.solve(text)
        self.assertEqual(json.loads(result['results'])[0]['answer'], 'Option A: Apple')
        self.assertTrue(result['selection_set_verified'])
        self.assertEqual(provider.await_count, 2)

    async def test_incomplete_and_disagreeing_verdicts_do_not_verify_partial_primary(self):
        primary = json.dumps([{'type': 'mcq', 'answer': 'Option A: Apple'}])
        incomplete = json.dumps({'readable': True, 'options': [{'letter': 'A', 'correct': True}]})
        wrong_type = complete_verdict('A').replace('true', '"true"', 2)
        text = checkbox_request('Which displayed items are fruits?', FRUITS)
        for verdicts in ((incomplete, incomplete), (wrong_type, '{}'),
                         (complete_verdict('AC'), complete_verdict('BC'))):
            with self.subTest(verdicts=verdicts):
                provider = AsyncMock(side_effect=[primary, *verdicts])
                with patch.object(main, 'try_ollama', provider), patch.object(main, 'TEXT_MODELS', []), \
                        self.assertRaises(HTTPException) as error:
                    await self.solve(text)
                self.assertEqual(error.exception.status_code, 422)
                self.assertEqual(error.exception.detail['code'], 'answer_unconfirmed')
                self.assertEqual(provider.await_count, 3)

    async def test_malformed_checkbox_options_do_not_use_generic_fallback(self):
        cases = (checkbox_request(POP, POP_OPTIONS).replace('\nB.', '\nC.'), checkbox_request('', POP_OPTIONS))
        for text in cases:
            with self.subTest(text=text), patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
                    self.assertRaises(HTTPException) as error:
                await self.solve(text)
            self.assertEqual(error.exception.detail['code'], 'answer_unconfirmed')
            groq.assert_not_awaited()

    @staticmethod
    async def solve(text):
        request = main.PageContent(text=text, url='https://example.test', practice_type='mcq',
                                   verify_answer=True, require_answer_agreement=True)
        return await main.solve_questions(request)
