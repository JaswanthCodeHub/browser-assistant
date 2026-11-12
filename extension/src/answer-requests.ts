// Retry answer generation only. Selection and submission are never retried here.
(function () {
    function failure(response) {
        const detail=response?.data?.detail;
        let message=typeof detail==='string' ? detail : detail?.message || response?.error || 'Answer service did not respond';
        if (Array.isArray(detail)) message=detail.map(item=>item.msg || String(item)).join('; ');
        if (Array.isArray(detail?.errors)) message+=`: ${detail.errors.join(' | ')}`;
        message=String(message).replace(/gsk_[\w]+|sk-[\w-]+/g,'[redacted]').slice(0,900);
        const error=new Error(`${response?.status ? `HTTP ${response.status}: ` : ''}${message}`) as Error & {
            status?: number;
            code?: string;
            retryAfterMs?: number;
        };
        error.status=response?.status;
        error.code=detail?.code;
        const seconds=detail?.retry_after_seconds;
        if (error.status===429 && Number.isFinite(seconds) && seconds>0) {
            error.retryAfterMs=seconds*1000;
        }
        return error;
    }
    function temporary(error) {
        // The backend already tried the available vision keys.
        if (error.code==='vision_rate_limited') return false;
        const text=error?.message || '';
        if (/access denied|forbidden|unauthorized|invalid.api.key|not configured|validation|not.support|model.*(?:not found|not exist)|illustration changed|question changed|context invalidated|extension was reloaded|no readable|unparseable/i.test(text)) return false;
        if (error.status) return [408,425,429,500,502,503,504].includes(error.status);
        return /network|fetch|offline|timed?\s*out|timeout|did not respond|connection|temporar|background script did not respond|message port closed|message channel closed/i.test(text);
    }
    async function run({request,active,current,ready,onRetry,sleep}) {
        const attempts=3;
        for (let attempt=1;attempt<=attempts;attempt++) {
            if (!active() || !(await ready()) || !active()) return null;
            if (!current()) throw new Error('Question changed while requesting an answer. No answer was selected.');
            try {
                const response=await request();
                if (!active() || !(await ready()) || !active()) return null;
                if (!current()) throw new Error('Question changed while requesting an answer. No answer was selected.');
                if (!response?.ok) throw failure(response);
                return response;
            } catch (error) {
                if (!active()) return null;
                if (attempt===attempts || !temporary(error) || error.retryAfterMs>60_000) throw error;
                onRetry({attempt:attempt+1,attempts,message:error.message});
                // Short waits keep Stop/Pause responsive. Revalidate before the
                // next request so an old answer cannot target a new question.
                const delay=error.retryAfterMs ?? (attempt===1 ? 1000 : 2500);
                for(let elapsed=0;elapsed<delay;elapsed+=100) {
                    if (!active()) return null;
                    await sleep(Math.min(100,delay-elapsed));
                }
            }
        }
    }
    window.BrowserAssistantAnswerRequests=Object.freeze({run,failure,temporary});
})();
