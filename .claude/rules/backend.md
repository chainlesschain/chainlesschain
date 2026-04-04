---
paths:
  - "backend/**"
---

# Backend Development Rules

## Java Backend (project-service)

```bash
cd backend/project-service
mvn clean compile && mvn spring-boot:run
mvn test
```

- Spring Boot 3.1.11 + Java 17 + PostgreSQL + Redis + MyBatis Plus 3.5.9
- Use jakarta imports (not javax)

## Python AI Service

```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
pytest
```

- FastAPI + Ollama + Qdrant + 14+ cloud LLM providers
- Ensure `httpx<0.26.0`

## Docker Services

```bash
docker-compose up -d       # Start all services
docker-compose down        # Stop services
docker-compose logs -f     # View logs
docker exec chainlesschain-ollama ollama pull qwen2:7b  # Pull LLM model
```

## Port Assignments

| Service         | Port  |
|-----------------|-------|
| Vite Dev        | 5173  |
| Signaling       | 9001  |
| Ollama          | 11434 |
| Qdrant          | 6333  |
| PostgreSQL      | 5432  |
| Redis           | 6379  |
| Project Service | 9090  |
| AI Service      | 8001  |
| WebSocket       | 18800 |
| Web Panel       | 18810 |
| Orchestrator WH | 18820 |
