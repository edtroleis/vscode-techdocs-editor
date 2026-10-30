"""API de tarefas: um exemplo pequeno de serviço em FastAPI."""
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

app = FastAPI(title="Tarefas API", version="1.0.0")


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    done: bool = False


class Task(TaskIn):
    id: int
    created_at: datetime


_tasks: dict[int, Task] = {}
_next_id = 1


@app.get("/health")
def health() -> dict[str, str]:
    """Usado pelo balanceador e pelo Kubernetes para saber se a API está de pé."""
    return {"status": "ok"}


@app.get("/tasks")
def list_tasks(done: bool | None = None) -> list[Task]:
    """Todas as tarefas; `?done=true` ou `?done=false` filtra pelo estado."""
    tasks = list(_tasks.values())
    return [t for t in tasks if done is None or t.done == done]


@app.post("/tasks", status_code=status.HTTP_201_CREATED)
def create_task(body: TaskIn) -> Task:
    global _next_id
    task = Task(id=_next_id, created_at=datetime.now(timezone.utc), **body.model_dump())
    _tasks[task.id] = task
    _next_id += 1
    return task


@app.get("/tasks/{task_id}")
def get_task(task_id: int) -> Task:
    if task_id not in _tasks:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    return _tasks[task_id]


@app.patch("/tasks/{task_id}")
def update_task(task_id: int, body: TaskIn) -> Task:
    task = get_task(task_id)
    updated = task.model_copy(update=body.model_dump())
    _tasks[task_id] = updated
    return updated


@app.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int) -> None:
    get_task(task_id)
    del _tasks[task_id]
