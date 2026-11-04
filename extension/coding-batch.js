// Problem-list navigation is deliberately separate from solving/editor access.
(function () {
    const visible = node => node.getClientRects().length && !node.closest('#assistant-root');
    const text = node => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    const statusPattern = /^(not attempted|in progress|solved)$/i;
    function courseFilterStep(doc) {
        const courses = /^(programming foundations|data structures\s*(?:&|and)\s*algorithms|build your own static website|build your own responsive website|modern responsive web design|build your own dynamic web application)$/i;
        const choices = [];
        for (const input of doc.querySelectorAll('input[type="checkbox"],[role="checkbox"]')) {
            const label = input.labels?.[0] || (input.id ? [...doc.querySelectorAll('label')].find(node => node.htmlFor === input.id) : null)
                || input.closest('label') || input.parentElement;
            if (!label || !visible(label) || !courses.test(text(label)))
                continue;
            choices.push({ input, name: text(label), selected: Boolean(input.checked || input.getAttribute('aria-checked') === 'true') });
        }
        const excluded = choices.filter(item => /^data structures/i.test(item.name));
        const included = choices.filter(item => !/^data structures/i.test(item.name));
        if (excluded.length !== 1 || !included.length)
            return { error: 'Course filters were not identified. Open the Course filters to exclude Data Structures & Algorithms.' };
        // Enable the other courses first: some portals interpret zero selected
        // filters as "all courses", which would temporarily include DSA.
        const change = included.find(item => !item.selected) || excluded.find(item => item.selected);
        if (change?.input.disabled || change?.input.getAttribute('aria-disabled') === 'true')
            return { error: 'Course filter is disabled.' };
        return change ? { control: change.input } : { ready: true };
    }
    function rows(doc) {
        const statuses = [...doc.querySelectorAll('span,div,td,p')].filter(node => visible(node)
            && statusPattern.test(text(node)) && ![...node.children].some(child => statusPattern.test(text(child))));
        const found = [];
        for (const status of statuses) {
            if (!/^(not attempted|in progress)$/i.test(text(status)))
                continue;
            for (let row = status.parentElement; row && row !== doc.body; row = row.parentElement) {
                if (row.querySelector('input[type="checkbox"],[role="checkbox"]'))
                    break;
                if (statuses.filter(item => row.contains(item)).length !== 1)
                    break;
                const copy = row.cloneNode(true);
                // CCBP displays '-' when difficulty is unavailable. It is
                // metadata, not part of the title (Parsing Datetime-).
                for (const item of copy.querySelectorAll('[data-testid="question-difficulty"]'))
                    item.remove();
                for (const icon of copy.querySelectorAll('svg,img,[aria-hidden="true"]'))
                    icon.remove();
                for (const item of [...copy.querySelectorAll('*')].reverse()) {
                    if (/^(not attempted|in progress|easy|medium|hard|→|›|»|open|view)$/i.test(text(item)))
                        item.remove();
                }
                const portalTitle = row.matches('[data-testid="question-list-question"]')
                    ? row.querySelector('span[title]')?.getAttribute('title') : null;
                const title = portalTitle?.trim() || text(copy);
                const actions = [...row.querySelectorAll('a[href],button,[role="button"]')].filter(visible);
                if (title && (actions.length || row.querySelector('svg') || row.matches('[role="row"],tr'))) {
                    const action = actions.length === 1 ? actions[0] : row;
                    const link = row.querySelector('a[href*="/question/"]');
                    found.push({ title, action, href: link?.getAttribute('href') || null });
                    break;
                }
            }
        }
        return found;
    }
    function matchesQuestion(question, batch, href) {
        if (!question || question.type !== 'code')
            return false;
        if (batch.questionUrl) {
            const expected = new URL(batch.questionUrl, batch.listUrl);
            const current = new URL(href);
            if (expected.origin !== current.origin || expected.pathname !== current.pathname)
                return false;
        }
        const normalize = value => (value || '').normalize('NFKC').toLowerCase()
            .replace(/(?:\s|\u00a0)*(?:easy|medium|hard|not attempted|in progress|solved)\s*$/i, '')
            .replace(/[\s\u200b-\u200d\ufeff]+/g, '').replace(/[–—−]/g, '-');
        const expectedTitle = normalize(batch.title);
        if (!expectedTitle)
            return true;
        return question.title ? normalize(question.title) === expectedTitle : normalize(question.text).includes(expectedTitle);
    }
    function nextPage(doc) {
        const range = pageRange(doc);
        if (range && range.end >= range.total)
            return null;
        const buttons = [...doc.querySelectorAll('button,a,[role="button"]')].filter(node => visible(node)
            && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
        const named = buttons.filter(node => /^(next|next page)$/i.test(node.getAttribute('aria-label') || text(node)));
        if (named.length === 1)
            return named[0];
        const current = doc.querySelector('[aria-current="page"],[data-active-page="true"]');
        if (current && /^\d+$/.test(text(current))) {
            const next = buttons.filter(node => text(node) === String(Number(text(current)) + 1));
            if (next.length === 1)
                return next[0];
        }
        if (range && range.end < range.total) {
            const number = Math.floor((range.start - 1) / (range.end - range.start + 1)) + 2;
            const next = buttons.filter(node => text(node) === String(number));
            if (next.length === 1)
                return next[0];
            // React pagers may use plain div/li/span controls with delegated
            // click handlers. Restrict fallback clicks to a numeric pager group.
            const leaves = [...doc.querySelectorAll('div,span,li,a,button')].filter(node => visible(node)
                && !node.children.length && /^\d+$/.test(text(node)));
            const targets = leaves.filter(node => text(node) === String(number)).filter(node => {
                for (let scope = node.parentElement; scope && scope !== doc.body; scope = scope.parentElement) {
                    if (scope.querySelector('input,textarea,.ace_editor,.monaco-editor,#assistant-root'))
                        break;
                    const numbers = leaves.filter(item => scope.contains(item)).map(text);
                    if (numbers.includes(String(number - 1)) && new Set(numbers).size >= 2) {
                        // A pager contains numbers, ellipses and arrows, not question prose.
                        return !/[a-z]/i.test(text(scope).replace(/next|previous|page/ig, ''));
                    }
                }
                return false;
            }).filter(node => !node.closest('[aria-disabled="true"],[disabled],.disabled'));
            if (targets.length === 1)
                return targets[0];
        }
        return null;
    }
    function getBackControl(doc, listUrl) {
        const enabled = node => visible(node) && !node.closest('[disabled],[aria-disabled="true"]');
        const links = [...doc.querySelectorAll('a[href]')].filter(enabled).filter(node => {
            try {
                const url = new URL(node.getAttribute('href'), listUrl);
                return url.origin === new URL(listUrl).origin && url.pathname === new URL(listUrl).pathname;
            }
            catch {
                return false;
            }
        });
        if (links.length === 1)
            return links[0];
        const headings = [...doc.querySelectorAll('h1,h2,h3,span,div,p')].filter(node => visible(node)
            && /^question bank$/i.test(text(node)) && ![...node.children].some(child => /^question bank$/i.test(text(child))));
        for (const heading of headings) {
            let scope = heading.parentElement;
            for (let depth = 0; scope && scope !== doc.body && depth < 3; depth++, scope = scope.parentElement) {
                if (scope.querySelector('.ace_editor,.monaco-editor,#assistant-root'))
                    break;
                const buttons = [...scope.querySelectorAll('button,[role="button"],a')].filter(enabled);
                const back = buttons.filter(node => /^(back|go back|back to question bank|question bank|←)$/i.test(node.getAttribute('aria-label') || node.getAttribute('title') || text(node)));
                if (back.length === 1)
                    return back[0];
                if (buttons.length === 1 && buttons[0].querySelector('svg'))
                    return buttons[0];
                // Some portal headers attach the click handler to an SVG wrapper.
                const icons = [...scope.querySelectorAll('svg')].filter(enabled);
                if (icons.length === 1 && /^question bank$/i.test(text(scope)))
                    return icons[0].closest('button,a,div,span');
            }
        }
        return null;
    }
    function getSaveBeforeLeaving(doc) {
        const choices = new Set();
        for (const prompt of doc.querySelectorAll('p,span,div,h2,h3')) {
            if (!visible(prompt) || !/^do you want to save code before leaving\?$/i.test(text(prompt)))
                continue;
            for (let scope = prompt.parentElement; scope && scope !== doc.body; scope = scope.parentElement) {
                if (scope.querySelector('#assistant-root,.ace_editor,.monaco-editor'))
                    break;
                const buttons = [...scope.querySelectorAll('button,[role="button"]')].filter(node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
                const yes = buttons.filter(node => /^yes$/i.test(text(node)));
                if (yes.length === 1 && buttons.some(node => /^no$/i.test(text(node)))) {
                    choices.add(yes[0]);
                    break;
                }
            }
        }
        return choices.size === 1 ? [...choices][0] : null;
    }
    function pageRange(doc) {
        const match = text(doc.body).match(/\b([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)\b/i);
        if (!match)
            return null;
        const [start, end, total] = match.slice(1).map(value => Number(value.replace(/,/g, '')));
        return { start, end, total };
    }
    function pageKey(doc) {
        const copy = doc.body.cloneNode(true);
        copy.querySelector('#assistant-root')?.remove();
        return text(copy);
    }
    window.BrowserAssistantCodingBatch = { rows, nextPage, pageKey, pageRange, getBackControl, getSaveBeforeLeaving, matchesQuestion, courseFilterStep };
})();
