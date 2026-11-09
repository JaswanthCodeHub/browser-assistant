const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { chromium } = require('playwright');

async function run() {
    const extension = resolve(process.argv[2] || join(__dirname, '..', 'extension'));
    const profile = await mkdtemp(join(tmpdir(), 'browser-assistant-test-'));
    const practice = 'http://127.0.0.1:8000/practice';
    const unrelated = 'https://fixture.invalid/';
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium', headless: true,
            args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
        });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const html = await readFile(join(__dirname, '..', 'server', 'practice_quiz.html'), 'utf8');
        await context.route(practice, route => route.fulfill({contentType: 'text/html', body: html}));
        await context.route(unrelated, route => route.fulfill({body: '<h1>Unrelated website</h1>', contentType: 'text/html'}));
        await context.addInitScript(() => {
            sessionStorage.setItem('browserAssistantResumeAuthorizedQa',
                JSON.stringify({stage:'solve', targetId:'local-practice'}));
            sessionStorage.setItem('browserAssistantCodingBatch', JSON.stringify({phase:'solve'}));
        });

        const page = await context.newPage();
        await page.goto(unrelated);
        assert.equal(await page.locator('#assistant-root').count(), 0);
        await page.goto(practice);
        await page.locator('#assistant-trigger').click();
        await page.getByRole('tab', {name:'QA Control', exact:true}).click();
        const state = page.locator('#assistant-automation-state');
        await page.locator('#assistant-automation-state[data-state="idle"]').waitFor();
        await page.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {key:'a', code:'KeyA', altKey:true, bubbles:true}));
            document.querySelector('#assistant-auto-start-btn').click();
        });
        assert.equal(await state.textContent(), 'IDLE');

        const popup = await context.newPage();
        await popup.goto(new URL('popup.html', worker.url()).href);
        assert.equal(await popup.locator('#pairing-token').getAttribute('type'), 'password');
        assert.equal(await popup.locator('#save-history').isChecked(), false);
        await popup.close();
        await page.bringToFront();
        await page.locator('#assistant-auto-start-btn').click();
        await page.waitForFunction(() => document.querySelector('#assistant-automation-status')
            ?.textContent.includes('Pair the local server in the Browser Assistant toolbar popup'));
        assert.equal(await page.locator('input[name="answer"]:checked').count(), 0);
        console.log('Chromium extension smoke passed.');
    } finally {
        try {
            await context?.close();
        } finally {
            await rm(profile, {recursive:true, force:true, maxRetries:4});
        }
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
