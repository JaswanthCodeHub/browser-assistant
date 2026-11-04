// Read complete question illustrations, including images outside the viewport.
// Never substitute a partial screenshot or a text-only guess for a failed read.
(function () {
    function nodes(question) {
        const found = new Set<Element>();
        for (const region of [question.visualRegion, ...question.options.map(option => option.node)]) {
            if (!region) continue;
            const candidates = region.matches('img,svg,canvas') ? [region] : region.querySelectorAll('img,svg,canvas');
            for (const node of candidates) {
                if (node.closest('#assistant-root,nav,aside,button') || !node.getClientRects().length) continue;
                if (node.parentElement?.closest('svg')) continue;
                const width = node.naturalWidth || node.width?.baseVal?.value || Number(node.getAttribute('width'));
                const height = node.naturalHeight || node.height?.baseVal?.value || Number(node.getAttribute('height'));
                if (width > 0 && height > 0 && width <= 32 && height <= 32) continue;
                found.add(node);
            }
        }
        return [...found];
    }
    function source(node) {
        if (node.tagName.toLowerCase() === 'canvas') return node.toDataURL('image/png');
        if (node.tagName.toLowerCase() === 'svg') return new XMLSerializer().serializeToString(node);
        return node.currentSrc || node.src || node.getAttribute('src') || '';
    }
    function fingerprint(question) { return JSON.stringify(nodes(question).map(source)); }
    async function capture(question, sendMessage) {
        const visuals = nodes(question);
        if (visuals.length > 5) throw new Error('Question has more than five illustrations; review them manually.');
        const before = fingerprint(question);
        const images = [];
        for (const node of visuals) {
            let data = source(node);
            if (!data) throw new Error('Question illustration has not loaded. No answer was selected.');
            if (node.tagName.toLowerCase() === 'svg') data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
            else if (!data.startsWith('data:')) {
                const response = await sendMessage({action:'questionImage',url:new URL(data,location.href).href});
                if (!response?.dataUrl) throw new Error(response?.error || 'Question illustration could not be read.');
                data = response.dataUrl;
            }
            const picture = await new Promise<HTMLImageElement>((resolve,reject) => {
                const img = new Image();
                const timer = window.setTimeout(()=>{img.src='';reject(new Error('Question illustration loading timed out.'));},10000);
                img.onload=()=>{window.clearTimeout(timer);resolve(img);};
                img.onerror=()=>{window.clearTimeout(timer);reject(new Error('Question illustration could not be decoded.'));};
                img.src=data;
            });
            const canvas = document.createElement('canvas');
            const scale = Math.min(1,2400/Math.max(picture.naturalWidth,picture.naturalHeight));
            canvas.width=Math.max(1,Math.round(picture.naturalWidth*scale));
            canvas.height=Math.max(1,Math.round(picture.naturalHeight*scale));
            const context=canvas.getContext('2d');
            context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
            context.drawImage(picture,0,0,canvas.width,canvas.height);
            // Keep chart labels and code crisp; the backend compresses once.
            images.push(canvas.toDataURL('image/png'));
        }
        if (before !== fingerprint(question)) throw new Error('Question illustration changed while loading. Please restart.');
        return {images,fingerprint:before};
    }
    async function requireBackend(apiRequest, imageCount = 1) {
        const health=await apiRequest('/health','GET');
        if (!health?.ok || health.data?.vision_question_context !== true) {
            throw new Error('Restart the Browser Assistant server to enable chart questions (build 2.6.50). No answer was selected.');
        }
        if (imageCount > 3 && health.data.vision_batching !== true) {
            throw new Error('Update and restart the Browser Assistant backend to enable all five images. No partial image request was sent.');
        }
    }
    window.BrowserAssistantQuestionVisuals=Object.freeze({nodes,fingerprint,capture,requireBackend});
})();
