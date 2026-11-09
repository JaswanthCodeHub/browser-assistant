FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HISTORY_DB_PATH=/data/scan_history.db

COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock.txt

COPY main.py code_contract.py local_security.py inference_jobs.py vision_images.py journal.py journal_prompt.md journal_syllabus.json practice_quiz.html ./

RUN mkdir -p /data && chown 10001:10001 /data
USER 10001:10001

EXPOSE 8000

CMD ["python", "main.py"]
