import importlib
import os
import sys
import tempfile
import time
from statistics import mean


class MockCollection:
    def count(self):
        return 42


class MockDoc:
    def __init__(self, query):
        self.page_content = f"Context for {query}"
        self.metadata = {"source": "mock_source.txt", "subject": "Data Science"}


class MockVectorDB:
    def __init__(self):
        self._collection = MockCollection()

    def similarity_search(self, query, k=3):
        return [MockDoc(query) for _ in range(max(1, min(k, 3)))]


class MockRAGService:
    def __init__(self):
        self.learning_level = "Beginner"
        self.vector_db = MockVectorDB()
        self.data_dir = tempfile.mkdtemp(prefix="athena_mock_data_")

    def list_subjects(self):
        return ["Data Science", "Machine Learning"]

    def load_subject(self, subject_name):
        return f"Subject {subject_name} ready."

    def load_document(self, file_path, subject=None):
        return "Document indexed."

    def get_response(self, query, current_level="Beginner", user_id="global", subject=None, proficiency_score=0.0, weak_topics=None, current_topic=None):
        if "outside" in (query or "").lower():
            return "it is out of the topic so i don't know", current_topic or "General"
        return f"Topic: {subject or 'General'} > Basics\nAnswer for: {query}", current_topic or "General"

    def stream_response(self, query, current_level="Beginner", user_id="global", subject=None, proficiency_score=0.0, weak_topics=None, current_topic=None):
        text = f"Topic: {subject or 'General'} > Basics\nStreaming answer for: {query}"
        yield {"type": "chunk", "content": text[:20]}
        yield {"type": "chunk", "content": text[20:]}
        yield {"type": "done", "topic": current_topic or "General", "final_response": text}

    def update_learning_level(self, quiz_results, current_score=0.0):
        return "Intermediate", min(1.0, current_score + 0.25)

    def generate_learning_path(self, subject, level, weak_topics=None, progress_map=None):
        return {"subject": subject, "steps": [], "graph": {"subject": subject, "nodes": [], "edges": []}}

    def generate_curriculum(self, subject, context_text=""):
        return {
            "subject": subject,
            "modules": [
                {
                    "name": "Data Preprocessing",
                    "topics": [
                        {"name": "Data Cleaning", "difficulty": "easy"},
                        {"name": "Data Transformation", "difficulty": "medium"},
                    ],
                }
            ],
        }

    def teach_topic(self, topic_name, difficulty="medium", subject=None, context_text="", level="Beginner", simplify=False):
        return f"## {topic_name}\nLesson content for {topic_name}"

    def generate_topic_quiz(self, topic_name, difficulty="medium", subject=None, context_text="", level="Beginner", is_retry=False):
        return "---QUIZ---\nQ1: test\nA) A\nB) B\nC) C\nAnswer1: A\n---ENDQUIZ---"

    def generate_module_quiz(self, module_name, topic_names, subject=None, context_text="", level="Beginner"):
        return "---QUIZ---\nQ1: test\nA) A\nB) B\nC) C\nAnswer1: A\n---ENDQUIZ---"

    def generate_final_test(self, subject, module_names, level="Beginner", context_text=""):
        return "---QUIZ---\nQ1: test\nA) A\nB) B\nC) C\nAnswer1: A\n---ENDQUIZ---"


def setup_app():
    tmp_dir = tempfile.mkdtemp(prefix="athena_perf_")
    db_path = os.path.join(tmp_dir, "perf.db")

    os.environ["GROQ_API_KEY"] = "test-key"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["JWT_SECRET_KEY"] = "this-is-a-test-jwt-secret-key-1234567890"

    backend_src = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
    if backend_src not in sys.path:
        sys.path.insert(0, backend_src)

    app_module = importlib.import_module("app")
    routes_module = importlib.import_module("api.routes")
    models = importlib.import_module("models")

    routes_module.rag_service = MockRAGService()
    app = app_module.app

    with app.app_context():
        models.db.drop_all()
        models.db.create_all()

    return app


def register_and_login(client, username="perfuser", email="perf@example.com", password="pass1234"):
    client.post("/api/register", json={"username": username, "email": email, "password": password})
    login = client.post("/api/login", json={"username": username, "password": password})
    token = login.get_json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def bench_action(name, action, iterations=12):
    # warmup
    action()
    timings = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        action()
        t1 = time.perf_counter()
        timings.append((t1 - t0) * 1000.0)
    timings.sort()
    avg = mean(timings)
    p95 = timings[int(0.95 * (len(timings) - 1))]
    return {"name": name, "avg_ms": avg, "p95_ms": p95}


def render_ascii_chart(results):
    max_avg = max(r["avg_ms"] for r in results) if results else 1
    lines = ["Performance Chart (avg latency)", ""]
    for r in sorted(results, key=lambda x: x["avg_ms"], reverse=True):
        width = int((r["avg_ms"] / max_avg) * 40)
        bar = "#" * max(1, width)
        lines.append(f"{r['name'][:28]:28} | {bar:<40} {r['avg_ms']:.2f} ms")
    return "\n".join(lines)


def main():
    app = setup_app()
    client = app.test_client()
    headers = register_and_login(client)

    # Prepare curriculum once for curriculum-related actions.
    gen = client.post("/api/curriculum/generate", headers=headers, json={"subject": "Data Science"}).get_json()
    curriculum = gen.get("curriculum", {})
    modules = curriculum.get("modules", [])
    first_module = modules[0] if modules else {"id": 0, "name": "Module"}
    first_topic = first_module.get("topics", [{}])[0] if first_module else {"id": 0, "name": "Topic", "difficulty": "easy"}

    actions = [
        ("save_user_subject", lambda: client.put("/api/user/subject", headers=headers, json={"subject": "Data Science"})),
        ("query", lambda: client.post("/api/query", headers=headers, json={"query": "Explain data cleaning", "subject": "Data Science", "current_topic": "Data Cleaning"})),
        ("query_stream", lambda: client.post("/api/query_stream", headers=headers, json={"query": "Explain transformation", "subject": "Data Science", "current_topic": "Data Transformation"})),
        ("update_level", lambda: client.post("/api/update_level", headers=headers, json={"quiz_results": {"correct": 1, "total": 1, "subject": "Data Science", "topic": "Data Cleaning"}})),
        ("learning_path", lambda: client.get("/api/learning_path?subject=Data%20Science", headers=headers)),
        ("dashboard", lambda: client.get("/api/dashboard", headers=headers)),
        ("teach_topic_stream", lambda: client.post("/api/curriculum/teach_stream", headers=headers, json={"topic_id": first_topic.get("id"), "topic_name": first_topic.get("name", "Data Cleaning"), "difficulty": first_topic.get("difficulty", "easy"), "subject": "Data Science"})),
        ("topic_quiz_stream", lambda: client.post("/api/curriculum/topic_quiz_stream", headers=headers, json={"topic_id": first_topic.get("id"), "topic_name": first_topic.get("name", "Data Cleaning"), "difficulty": first_topic.get("difficulty", "easy"), "subject": "Data Science"})),
        ("module_quiz_stream", lambda: client.post("/api/curriculum/module_quiz_stream", headers=headers, json={"module_id": first_module.get("id"), "module_name": first_module.get("name", "Module"), "subject": "Data Science"})),
        ("final_test_stream", lambda: client.post("/api/curriculum/final_test_stream", headers=headers, json={"subject": "Data Science", "curriculum_id": curriculum.get("id")})),
        ("chat_history", lambda: client.get("/api/chat_history", headers=headers)),
        ("clear_chat", lambda: client.delete("/api/clear_chat", headers=headers)),
        ("health", lambda: client.get("/api/health")),
    ]

    results = [bench_action(name, fn, iterations=10) for name, fn in actions]

    table_lines = [
        "| Action | Avg (ms) | P95 (ms) |",
        "|---|---:|---:|",
    ]
    for r in sorted(results, key=lambda x: x["avg_ms"]):
        table_lines.append(f"| {r['name']} | {r['avg_ms']:.2f} | {r['p95_ms']:.2f} |")

    chart = render_ascii_chart(results)

    report = "\n".join([
        "# API Performance Analysis",
        "",
        "This report was generated using Flask test client benchmark runs (10 iterations per action).",
        "",
        "## Latency Table",
        "",
        *table_lines,
        "",
        "## Analysis Chart",
        "",
        "```text",
        chart,
        "```",
    ])

    out_path = os.path.join(os.path.dirname(__file__), "performance_report.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(report)
    print(f"\nSaved report to: {out_path}")


if __name__ == "__main__":
    main()
