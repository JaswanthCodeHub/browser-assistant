"""Short polling requests for bounded, cancellable local inference."""
import asyncio
import json
import time
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError


class JobRequest(BaseModel):
    id: UUID
    route: str
    body: dict


def register_inference_jobs(app, handlers, sanitize):
    jobs = {}

    def expire_result(job_id, job):
        if jobs.get(job_id) is job:
            del jobs[job_id]

    def retain_result(job_id, job):
        if not job.get('expiry_scheduled'):
            job['expires'] = time.monotonic() + 120
            job['expiry_scheduled'] = True
            asyncio.get_running_loop().call_later(120, expire_result, job_id, job)

    def prune():
        now = time.monotonic()
        for job_id, job in list(jobs.items()):
            if job['expires'] <= now:
                job['task'].cancel()
                del jobs[job_id]

    async def execute(job_id, job, handler, body):
        try:
            async with asyncio.timeout(300):
                data = await handler(body)
            if isinstance(data.get('results'), str):
                data = {**data, 'items':json.loads(data['results']), 'schema_version':2}
            job.update(state='finished', status=200, data=data)
        except HTTPException as exc:
            job.update(state='finished', status=exc.status_code, data={'detail':sanitize(exc.detail)})
        except TimeoutError:
            job.update(state='finished', status=504, data={'detail':'The inference deadline expired.'})
        except asyncio.CancelledError:
            job.update(state='finished', status=409, data={'detail':'Inference cancelled.'})
            raise
        except Exception:
            job.update(state='finished', status=500, data={'detail':'Inference could not be completed.'})
        finally:
            retain_result(job_id, job)

    @app.post('/jobs', status_code=202)
    async def start_job(request: JobRequest):
        prune()
        if request.id in jobs:
            return {'id':str(request.id)}
        if request.route not in handlers:
            raise HTTPException(422,'Unsupported inference route.')
        if len(jobs) >= 16 or sum(job['state'] == 'running' for job in jobs.values()) >= 2:
            raise HTTPException(429,detail={'message':'Inference is busy. Try again shortly.', 'retry_after_seconds':5})
        model, handler = handlers[request.route]
        try:
            body = model.model_validate(request.body)
        except ValidationError as error:
            raise HTTPException(422,detail=error.errors(include_input=False,include_context=False)) from error
        job = {'state':'running','expires':time.monotonic()+330}
        jobs[request.id] = job
        job['task'] = asyncio.create_task(execute(request.id, job, handler, body))
        return {'id':str(request.id)}

    @app.get('/jobs/{job_id}')
    async def get_job(job_id: UUID):
        prune()
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404,'Inference job expired. Start a new scan.')
        return {key:job[key] for key in ('state','status','data') if key in job}

    @app.delete('/jobs/{job_id}')
    async def cancel_job(job_id: UUID):
        job = jobs.get(job_id)
        if job and job['state'] == 'running':
            job.update(state='finished', status=409, data={'detail':'Inference cancelled.'})
            retain_result(job_id, job)
            job['task'].cancel()
        return {'ok':True}
