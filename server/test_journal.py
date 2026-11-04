import asyncio
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import journal as journal_module
from fastapi import FastAPI, HTTPException
from journal import SYLLABUS, SECTIONS, MASTER_PROMPT, JournalRequest, register_journal, subject_key, validate_sections


def sample(n=80):
    return {k: ' '.join(['word'] * n) for k in SECTIONS}


class JournalTests(unittest.TestCase):
    def test_syllabus_and_mapping(self):
        self.assertEqual(subject_key('Computer organization and Architecture (CS203)'), 'coa')
        self.assertEqual(subject_key('Advanced Data Structures'), 'ads')
        self.assertEqual(subject_key('Fundamentals of Artificial Intelligence (Year 2 Term 1)'), 'ai')
        self.assertEqual(subject_key('Fundamentals of AI'), 'ai')
        self.assertEqual(subject_key('Fundamentals of Artificial Intelligence ( AI201 )'), 'ai')
        self.assertEqual(subject_key('AI201'), 'ai')
        with self.assertRaises(HTTPException):
            subject_key('Advanced Data Structures (AI201)')
        for subject in SYLLABUS.values():
            self.assertEqual(set(subject['modules']), {str(n) for n in range(1, 11)})
            self.assertTrue(all(len(v) > 50 for v in subject['modules'].values()))
        with self.assertRaises(HTTPException):
            subject_key('Unknown subject')
        with self.assertRaises(HTTPException):
            subject_key('Fundamentals of Aircraft Design')

    def test_ai_journal_uses_the_uploaded_module_including_its_lab(self):
        calls=[]
        async def cloud(messages,**kwargs):
            calls.append(json.loads(messages[1]['content']))
            return json.dumps(sample())
        async def local(*args,**kwargs):
            raise AssertionError('Fallback not needed')
        app=FastAPI()
        register_journal(app,cloud,local)
        endpoint=next(route.endpoint for route in app.routes if route.path=='/journal')
        response=asyncio.run(endpoint(JournalRequest(subject='Fundamentals of Artificial Intelligence',number=8)))
        self.assertEqual(response['module'],8)
        self.assertIn('Uncertainty in AI',calls[0]['module_syllabus'])
        self.assertIn('Bayesian Networks',calls[0]['module_syllabus'])
        self.assertIn('Clinical Decision Support Agent',calls[0]['module_syllabus'])
        self.assertEqual(len(calls[0]['complete_syllabus']),10)
        self.assertNotIn('State Space Planning',calls[0]['module_syllabus'])

    def test_syllabus_and_alias_updates_are_loaded_without_restarting_the_registered_app(self):
        calls=[]
        async def cloud(messages,**kwargs):
            calls.append(json.loads(messages[1]['content']))
            return json.dumps(sample())
        async def local(*args,**kwargs):
            raise AssertionError('Fallback not needed')
        app=FastAPI()
        register_journal(app,cloud,local)
        endpoint=next(route.endpoint for route in app.routes if route.path=='/journal')
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'syllabus.json'
            catalog={'ai':json.loads(json.dumps(SYLLABUS['ai']))}
            catalog['ai']['modules']['1']='Initial AI module topics.'
            path.write_text(json.dumps(catalog),encoding='utf-8')
            with patch.object(journal_module,'SYLLABUS_PATH',path):
                asyncio.run(endpoint(JournalRequest(subject='AI201',number=1)))
                catalog['ai']['modules']['1']='Updated AI module topics read from disk.'
                catalog['ai']['codes'].append('FAI201')
                path.write_text(json.dumps(catalog),encoding='utf-8')
                asyncio.run(endpoint(JournalRequest(subject='FAI201',number=1)))
        self.assertEqual(calls[0]['module_syllabus'],'Initial AI module topics.')
        self.assertEqual(calls[1]['module_syllabus'],'Updated AI module topics read from disk.')

    def test_unreadable_syllabus_stops_before_ai_generation(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(journal_module,'SYLLABUS_PATH',Path(folder)/'missing.json'):
            with self.assertRaises(HTTPException) as error:
                subject_key('AI201')
        self.assertEqual(error.exception.status_code,503)

    def test_boundaries(self):
        self.assertEqual(validate_sections(sample())[1], 400)
        for size in (70, 75, 79, 81):
            with self.assertRaises(ValueError):
                validate_sections(sample(size))
        unbalanced=sample()
        unbalanced['experience']=' '.join(['word'] * 79)
        unbalanced['conclusion']=' '.join(['word'] * 81)
        with self.assertRaises(ValueError):
            validate_sections(unbalanced)

    def test_generation_retries_and_uses_requested_module(self):
        calls = []
        async def cloud(messages, **kwargs):
            self.assertTrue(messages[0]['content'].startswith(MASTER_PROMPT))
            self.assertNotIn('aim for 375',messages[0]['content'])
            calls.append(json.loads(messages[1]['content']))
            return json.dumps(sample(20 if len(calls) == 1 else 80))
        async def local(*args, **kwargs):
            raise AssertionError('Fallback not needed')
        app = FastAPI()
        register_journal(app, cloud, local)
        endpoint = next(r.endpoint for r in app.routes if r.path == '/journal')
        response = asyncio.run(endpoint(JournalRequest(subject='Advanced Data Structures', number=2)))
        self.assertEqual(response['word_count'],400)
        self.assertEqual(set(response['section_word_counts'].values()),{80})
        self.assertEqual(len(calls),2)
        self.assertIn('Linked List Basics',calls[0]['module_syllabus'])
        self.assertNotIn('Kadane',calls[0]['module_syllabus'])
        self.assertEqual(len(calls[0]['complete_syllabus']),10)


if __name__ == '__main__':
    unittest.main()
