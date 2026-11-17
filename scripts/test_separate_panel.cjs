const assert = require('node:assert/strict');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.resolve(process.env.ASSISTANT_TEST_EXTENSION || path.join(root, 'extension'));
const practice = 'http://127.0.0.1:8000/practice';
const secondUrl = 'http://127.0.0.1:8000/panel-test';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(check, label) {
    for (let attempt = 0; attempt < 80; attempt++) {
        if (await check()) return;
        await sleep(125);
    }
    assert.fail(label);
}

async function insideViewport(page) {
    const panel = page.locator('#assistant-panel');
    await panel.waitFor();
    await eventually(() => panel.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    }), 'The full floating panel should fit inside the viewport');
}

test('floating and separate panels in Chromium', {timeout: 120_000}, async t => {
    const profile = await mkdtemp(path.join(tmpdir(), 'browser-assistant-panel-'));
    const launchOptions = {
        channel: 'chromium',
        headless: true,
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    };
    let context = await chromium.launchPersistentContext(profile, launchOptions).catch(async error => {
        await rm(profile, {recursive: true, force: true});
        throw error;
    });
    try {
        context.setDefaultTimeout(10_000);
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const base = worker.url().replace(/\/[^/]+$/, '');
        await worker.evaluate(() => {
            globalThis.testRequests = [];
            const fetchReal = globalThis.fetch;
            globalThis.fetch = async (input, init) => {
                const url = new URL(typeof input === 'string' ? input : input.url || input.href);
                if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '8000') {
                    return fetchReal(input, init);
                }
                const body = init?.body ? JSON.parse(init.body) : {};
                testRequests.push({path: url.pathname, url: body.url, image: body.image?.slice(0, 32)});
                if (url.pathname === '/health') return Response.json({status: 'ok'});
                if (url.pathname === '/history') return Response.json([]);
                if (url.pathname === '/extension-release') return Response.json({version: '2.9.1'});
                return Response.json({
                    answer_verified: true,
                    provider: 'local test',
                    results: JSON.stringify([{type: 'mcq', question: 'What is 6 + 7?', answer: 'Option C: 13'}]),
                });
            };
        });
        await context.route(practice, route => route.fulfill({
            path: path.join(root, 'server', 'practice_quiz.html'),
            contentType: 'text/html',
        }));
        await context.route(secondUrl, route => route.fulfill({contentType: 'text/html', body:
            '<!doctype html><title>Second test tab</title><main>Panel test fixture</main>',
        }));
        const source = context.pages()[0] || await context.newPage();
        await source.goto(practice);
        let popup = await context.newPage();
        await popup.goto(base + '/popup.html');
        const openFromToolbar = id => popup.evaluate(targetTabId =>
            chrome.runtime.sendMessage({action: 'panel:open', targetTabId}), id);
        const windows = () => worker.evaluate(() => chrome.windows.getAll({windowTypes: ['popup']}));
        let detached;

        await t.test('drags, expands, collapses and clamps the panel after resize', async () => {
            await source.bringToFront();
            await source.setViewportSize({width: 900, height: 650});
            const badge = source.locator('#assistant-trigger');
            await badge.waitFor();
            const original = await badge.boundingBox();
            await source.mouse.move(original.x + 12, original.y + 12);
            await source.mouse.down();
            await source.mouse.move(899, 649, {steps: 12});
            await source.mouse.up();
            assert.equal(await badge.count(), 1);
            const moved = await badge.boundingBox();
            assert.ok(moved.x > original.x || moved.y > original.y + 100);
            await source.keyboard.press('Backquote');
            await insideViewport(source);
            await source.keyboard.press('BracketRight');
            await source.locator('#assistant-root').waitFor({state: 'hidden'});
            await source.keyboard.press('Backquote');
            await insideViewport(source);
            await source.setViewportSize({width: 320, height: 370});
            await insideViewport(source);
            await source.reload();
            await badge.click();
            await insideViewport(source);
        });

        await t.test('opens one window and scans the original tab by text and vision', async () => {
            await source.bringToFront();
            await worker.evaluate(() => chrome.storage.local.set({
                assistantJournalTimer: {deadline: Date.now() + 600_000, path: '/modules/reflective-journal/test'},
            }));
            await source.locator('#assistant-journal-countdown-badge').waitFor();
            const created = context.waitForEvent('page');
            await popup.evaluate(() => document.getElementById('open-separate-panel').click());
            detached = await created;
            await detached.waitForURL(base + '/detached-panel.html');
            await detached.locator('#assistant-scan-btn').waitFor();
            await source.locator('#assistant-root.assistant-detached').waitFor({state: 'attached'});
            assert.equal(await source.locator('#assistant-root').isVisible(), false);
            assert.equal(await source.locator('#assistant-root').count(), 1);
            assert.equal(await source.locator('#assistant-journal-countdown-badge').isVisible(), false);
            await detached.locator('#detached-countdown').waitFor();
            assert.equal((await windows()).length, 1);
            const panelWindow = (await windows())[0];
            const resized = await worker.evaluate(id => chrome.windows.update(id, {width: 340, height: 500}), panelWindow.id);
            assert.ok(resized.width < panelWindow.width);

            await detached.locator('#mode-auto').focus();
            await detached.keyboard.press('ArrowRight');
            await eventually(() => detached.locator('#mode-mcq').getAttribute('aria-selected').then(value => value === 'true'),
                'MCQ selection should be forwarded to the original tab');
            await detached.locator('#assistant-scan-btn').click();
            await detached.locator('#assistant-root').getByText(/Option C/).waitFor();
            await detached.keyboard.press('BracketLeft');
            await detached.locator('#assistant-root').waitFor({state: 'hidden'});
            await detached.keyboard.press('Backquote');
            await detached.locator('#assistant-root').waitFor();
            await detached.keyboard.press('Backslash');
            await eventually(async () => (await worker.evaluate(() => globalThis.testRequests)).some(request =>
                request.path === '/solve-vision' && request.url === practice && request.image?.startsWith('data:image/png;')),
            'Vision should send a real Chrome screenshot from the bound tab');
            const requests = await worker.evaluate(() => globalThis.testRequests);
            assert.ok(requests.some(request => request.path === '/solve' && request.url === practice));
        });

        await t.test('pins the original tab, rebinds, survives reload and restores floating mode', async () => {
            assert.ok(detached);
            popup = await context.newPage();
            await popup.goto(base + '/popup.html');
            const second = await context.newPage();
            await second.goto(secondUrl);
            await second.bringToFront();
            const secondId = await worker.evaluate(async url => (await chrome.tabs.query({url}))[0].id, secondUrl);
            const status = detached.locator('#detached-status');
            await eventually(() => status.textContent().then(label => label.includes('Practice Quiz') &&
                label.includes('Select this tab')), 'The popup should stay pinned when another tab becomes active');
            await detached.keyboard.press('Backslash');
            await detached.locator('#assistant-root').getByText(/requesting tab is no longer active/).waitFor();
            assert.deepEqual(await openFromToolbar(secondId), {ok: true});
            await eventually(() => status.textContent().then(label => label === 'Second test tab'),
                'The existing window should rebind to the newly selected tab');
            assert.equal((await windows()).length, 1);
            await source.locator('#assistant-root').waitFor();
            await source.locator('#assistant-journal-countdown-badge').waitFor();
            await second.reload();
            await second.locator('#assistant-root.assistant-detached').waitFor({state: 'attached'});
            await detached.locator('#assistant-scan-btn').waitFor();
            const modeBeforeShortcut = await detached.locator('#mode-qa').getAttribute('aria-selected');
            await detached.keyboard.press('Alt+a');
            await sleep(250);
            assert.equal(await detached.locator('#mode-qa').getAttribute('aria-selected'), modeBeforeShortcut,
                'Alt+A must run directly without changing the panel tab or opening its controls');
            await detached.close();
            await second.locator('#assistant-root').waitFor();
            await popup.reload();
            await eventually(() => popup.locator('#open-separate-panel').textContent().then(label => label.includes('Resume')),
                'The toolbar should remember separate-window mode');

            await second.bringToFront();
            const reopened = context.waitForEvent('page');
            assert.deepEqual(await openFromToolbar(secondId), {ok: true});
            detached = await reopened;
            const closed = detached.waitForEvent('close');
            await detached.locator('#detached-return').click();
            await closed;
            await second.locator('#assistant-root').waitFor();
            assert.equal((await windows()).length, 0);
            const {assistantPanelMode} = await worker.evaluate(() => chrome.storage.local.get('assistantPanelMode'));
            assert.equal(assistantPanelMode, 'floating');
            await second.bringToFront();
            const openedBeforeRestart = context.waitForEvent('page');
            assert.deepEqual(await openFromToolbar(secondId), {ok: true});
            const reopenedPanel = await openedBeforeRestart;
            await reopenedPanel.locator('#assistant-root').waitFor();
        });

        await t.test('remembers the separate mode after Chromium restarts', async () => {
            await context.close();
            context = await chromium.launchPersistentContext(profile, launchOptions);
            const toolbar = await context.newPage();
            await toolbar.goto(base + '/popup.html');
            await eventually(() => toolbar.locator('#open-separate-panel').textContent().then(label => label.includes('Resume')),
                'The toolbar should offer to resume the chosen mode after restart');
        });
    } finally {
        await context.close();
        await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 150});
    }
});
