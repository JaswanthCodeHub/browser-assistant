const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.resolve(process.env.ASSISTANT_TEST_EXTENSION || path.join(root, 'extension'));

function fixtureServer() {
    return new Promise(resolve => {
        const server = createServer((request, response) => {
            response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
            response.end(`<!doctype html><meta charset="utf-8"><title>Tone fixture</title>
                <style>html,body{margin:0;background:#f7f8fa;color:#111}
                body{font:16px/1.6 system-ui;padding:24px}</style>
                <body><h1>Light page</h1><p>Content behind the panel.</p></body>`);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('panel ink follows the page behind it and answers stay green', {timeout: 120_000}, async () => {
    const server = await fixtureServer();
    const profile = await mkdtemp(path.join(tmpdir(), 'browser-assistant-tone-'));
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true,
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    try {
        context.setDefaultTimeout(15_000);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForSelector('#assistant-root');
        await page.keyboard.press('`');
        await page.waitForTimeout(400);

        const readTone = () => page.locator('#assistant-root').getAttribute('data-tone');
        const ink = () => page.locator('#assistant-root .assistant-title')
            .evaluate(element => getComputedStyle(element).color);

        assert.equal(await readTone(), 'light', 'a light page gets dark ink');
        assert.equal(await ink(), 'rgb(17, 19, 21)');

        // Dark page: repaint the document behind the panel, then re-sample.
        await page.evaluate(() => {
            document.documentElement.style.background = '#0b0f12';
            document.body.style.background = '#0b0f12';
            document.body.style.color = '#f4f6f8';
            window.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(400);
        assert.equal(await readTone(), 'dark', 'a dark page gets light ink');
        assert.equal(await ink(), 'rgb(244, 246, 248)');

        // Correct-answer colour in both tones.
        const answerColour = async () => {
            await page.evaluate(() => {
                if (document.getElementById('tone-answer-probe')) return;
                const probe = document.createElement('div');
                probe.id = 'tone-answer-probe';
                probe.className = 'assistant-answer-text';
                probe.textContent = 'B. Before dawn';
                document.getElementById('assistant-root').appendChild(probe);
            });
            return page.locator('#tone-answer-probe').evaluate(element => getComputedStyle(element).color);
        };
        const darkAnswer = await answerColour();
        assert.equal(darkAnswer, 'rgb(94, 224, 143)', 'the answer is green on dark pages');

        await page.evaluate(() => {
            document.documentElement.style.background = '#f7f8fa';
            document.body.style.background = '#f7f8fa';
            window.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(400);
        assert.equal(await readTone(), 'light');
        const lightAnswer = await answerColour();
        assert.equal(lightAnswer, 'rgb(21, 128, 61)', 'the answer is green on light pages');
    } finally {
        await context.close();
        await new Promise(resolve => server.close(resolve));
        await rm(profile, {recursive: true, force: true});
    }
});
