FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock.txt

COPY main.py code_contract.py local_security.py vision_images.py journal.py journal_prompt.md journal_syllabus.json practice_quiz.html ./

EXPOSE 8000

CMD ["python", "main.py"]
