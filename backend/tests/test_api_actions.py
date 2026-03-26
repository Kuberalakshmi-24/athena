import importlib
import io
import os
import sys
import tempfile
import unittest
from dataclasses import dataclass


@dataclass
class MockDoc:
    page_content: str
    metadata: dict


class MockCollection:
    def count(self):
        return 42


class MockVectorDB:
    def __init__(self):
        self._collection = MockCollection()

    def similarity_search(self, query, k=3):
        return [
            MockDoc(
                page_content=f"Context for {query}",
                metadata={"source": "mock_source.txt", "subject": "Data Science"},
            )
            for _ in range(max(1, min(k, 3)))
        ]


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
        if "outside" in (query or "").lower():
            blocked = "it is out of the topic so i don't know"
            yield {"type": "chunk", "content": blocked}
            yield {"type": "done", "topic": current_topic or "General", "final_response": blocked}
            return
        text = f"Topic: {subject or 'General'} > Basics\nStreaming answer for: {query}"
        yield {"type": "chunk", "content": text[:20]}
        yield {"type": "chunk", "content": text[20:]}
        yield {"type": "done", "topic": current_topic or "General", "final_response": text}

    def update_learning_level(self, quiz_results, current_score=0.0):
        return "Intermediate", min(1.0, current_score + 0.25)

    def generate_learning_path(self, subject, level, weak_topics=None, progress_map=None):
        return {
            "subject": subject,
            "steps": [
                {"order": 1, "concept": "Data Cleaning", "status": "learning", "mastery_score": 0.4},
                {"order": 2, "concept": "Linear Regression", "status": "not_started", "mastery_score": 0.0},
            ],
            "graph": {"subject": subject, "nodes": ["Data Cleaning", "Linear Regression"], "edges": [["Data Cleaning", "Linear Regression"]]},
        }

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
                },
                {
                    "name": "Machine Learning Fundamentals",
                    "topics": [
                        {"name": "Linear Regression", "difficulty": "easy"},
                        {"name": "Model Evaluation", "difficulty": "medium"},
                    ],
                },
            ],
        }

    def teach_topic(self, topic_name, difficulty="medium", subject=None, context_text="", level="Beginner", simplify=False):
        return f"## {topic_name}\nLesson content for {topic_name}"

    def generate_topic_quiz(self, topic_name, difficulty="medium", subject=None, context_text="", level="Beginner", is_retry=False):
        return """---QUIZ---
Q1: What is Data Cleaning?
A) Storage
B) Cleaning process
C) Deployment
Answer1: B
---ENDQUIZ---"""

    def generate_module_quiz(self, module_name, topic_names, subject=None, context_text="", level="Beginner"):
        return """---QUIZ---
Q1: Module question?
A) A
B) B
C) C
Answer1: A
---ENDQUIZ---"""

    def generate_final_test(self, subject, module_names, level="Beginner", context_text=""):
        return """---QUIZ---
Q1: Final test question?
A) A
B) B
C) C
Answer1: A
---ENDQUIZ---"""


class ApiActionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp_dir = tempfile.mkdtemp(prefix="athena_tests_")
        cls.db_path = os.path.join(cls.tmp_dir, "test.db")

        os.environ["GROQ_API_KEY"] = "test-key"
        os.environ["DATABASE_URL"] = f"sqlite:///{cls.db_path}"
        os.environ["JWT_SECRET_KEY"] = "this-is-a-test-jwt-secret-key-1234567890"

        backend_src = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
        if backend_src not in sys.path:
            sys.path.insert(0, backend_src)

        cls.app_module = importlib.import_module("app")
        cls.routes_module = importlib.import_module("api.routes")
        cls.models = importlib.import_module("models")

        cls.routes_module.rag_service = MockRAGService()
        cls.app = cls.app_module.app
        cls.client = cls.app.test_client()

    def setUp(self):
        with self.app.app_context():
            self.models.db.drop_all()
            self.models.db.create_all()

    def _register_and_login(self, username="alice", email="alice@example.com", password="pass1234"):
        reg = self.client.post("/api/register", json={"username": username, "email": email, "password": password})
        self.assertEqual(reg.status_code, 201)

        login = self.client.post("/api/login", json={"username": username, "password": password})
        self.assertEqual(login.status_code, 200)
        token = login.get_json()["access_token"]
        return token

    def _auth_headers(self, token):
        return {"Authorization": f"Bearer {token}"}

    def test_auth_and_user_subject_flow(self):
        token = self._register_and_login()

        refresh = self.client.post("/api/refresh")
        self.assertEqual(refresh.status_code, 200)

        save_subj = self.client.put("/api/user/subject", headers=self._auth_headers(token), json={"subject": "Data Science"})
        self.assertEqual(save_subj.status_code, 200)
        self.assertEqual(save_subj.get_json()["selected_subject"], "Data Science")

        logout = self.client.post("/api/logout")
        self.assertEqual(logout.status_code, 200)

    def test_query_and_query_stream(self):
        token = self._register_and_login()

        q_ok = self.client.post(
            "/api/query",
            headers=self._auth_headers(token),
            json={"query": "Explain data cleaning", "subject": "Data Science", "current_topic": "Data Cleaning"},
        )
        self.assertEqual(q_ok.status_code, 200)
        self.assertIn("response", q_ok.get_json())

        q_out = self.client.post(
            "/api/query",
            headers=self._auth_headers(token),
            json={"query": "outside question about football", "subject": "Data Science", "current_topic": "Data Cleaning"},
        )
        self.assertEqual(q_out.status_code, 200)
        self.assertEqual(q_out.get_json()["response"], "it is out of the topic so i don't know")

        stream = self.client.post(
            "/api/query_stream",
            headers=self._auth_headers(token),
            json={"query": "Explain transformation", "subject": "Data Science", "current_topic": "Data Transformation"},
        )
        self.assertEqual(stream.status_code, 200)
        data = stream.get_data(as_text=True)
        self.assertIn('"type": "done"', data)

    def test_upload_subjects_and_load_subject(self):
        file_payload = {
            "file": (io.BytesIO(b"sample content"), "sample.txt")
        }
        upload = self.client.post(
            "/api/upload",
            data={"subject": "Data Science", **file_payload},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 200)

        subjects = self.client.get("/api/subjects")
        self.assertEqual(subjects.status_code, 200)
        self.assertIn("subjects", subjects.get_json())

        load = self.client.post("/api/load_subject", json={"subject": "Data Science"})
        self.assertEqual(load.status_code, 200)

    def test_level_dashboard_learning_and_history_actions(self):
        token = self._register_and_login()

        upd_level = self.client.post(
            "/api/update_level",
            headers=self._auth_headers(token),
            json={"quiz_results": {"correct": 1, "total": 1, "subject": "Data Science", "topic": "Data Cleaning"}},
        )
        self.assertEqual(upd_level.status_code, 200)
        self.assertIn("level", upd_level.get_json())

        upd_progress = self.client.post(
            "/api/learning_progress",
            headers=self._auth_headers(token),
            json={"subject": "Data Science", "concept": "Data Cleaning", "status": "learning", "mastery_score": 0.6},
        )
        self.assertEqual(upd_progress.status_code, 200)

        path = self.client.get("/api/learning_path?subject=Data%20Science", headers=self._auth_headers(token))
        self.assertEqual(path.status_code, 200)
        self.assertIn("steps", path.get_json())

        history = self.client.get("/api/chat_history", headers=self._auth_headers(token))
        self.assertEqual(history.status_code, 200)

        dashboard = self.client.get("/api/dashboard", headers=self._auth_headers(token))
        self.assertEqual(dashboard.status_code, 200)
        self.assertIn("quiz", dashboard.get_json())

        clear = self.client.delete("/api/clear_chat", headers=self._auth_headers(token))
        self.assertEqual(clear.status_code, 200)

    def test_curriculum_actions(self):
        token = self._register_and_login()

        gen = self.client.post(
            "/api/curriculum/generate",
            headers=self._auth_headers(token),
            json={"subject": "Data Science"},
        )
        self.assertEqual(gen.status_code, 200)
        curriculum = gen.get_json()["curriculum"]
        self.assertTrue(curriculum["modules"])

        cur = self.client.get("/api/curriculum/Data%20Science", headers=self._auth_headers(token))
        self.assertEqual(cur.status_code, 200)

        first_module = curriculum["modules"][0]
        first_topic = first_module["topics"][0]

        teach_stream = self.client.post(
            "/api/curriculum/teach_stream",
            headers=self._auth_headers(token),
            json={
                "topic_id": first_topic["id"],
                "topic_name": first_topic["name"],
                "difficulty": first_topic["difficulty"],
                "subject": "Data Science",
            },
        )
        self.assertEqual(teach_stream.status_code, 200)
        self.assertIn('"type": "done"', teach_stream.get_data(as_text=True))

        progress = self.client.post(
            "/api/curriculum/progress",
            headers=self._auth_headers(token),
            json={"topic_id": first_topic["id"], "status": "completed", "score": 1.0},
        )
        self.assertEqual(progress.status_code, 200)

        topic_quiz = self.client.post(
            "/api/curriculum/topic_quiz_stream",
            headers=self._auth_headers(token),
            json={
                "topic_id": first_topic["id"],
                "topic_name": first_topic["name"],
                "difficulty": first_topic["difficulty"],
                "subject": "Data Science",
            },
        )
        self.assertEqual(topic_quiz.status_code, 200)
        self.assertIn('"type": "done"', topic_quiz.get_data(as_text=True))

        module_quiz = self.client.post(
            "/api/curriculum/module_quiz_stream",
            headers=self._auth_headers(token),
            json={
                "module_id": first_module["id"],
                "module_name": first_module["name"],
                "subject": "Data Science",
            },
        )
        self.assertEqual(module_quiz.status_code, 200)
        self.assertIn('"type": "done"', module_quiz.get_data(as_text=True))

        final_test = self.client.post(
            "/api/curriculum/final_test_stream",
            headers=self._auth_headers(token),
            json={"subject": "Data Science", "curriculum_id": curriculum["id"]},
        )
        self.assertEqual(final_test.status_code, 200)
        self.assertIn('"type": "done"', final_test.get_data(as_text=True))

    def test_health_endpoint(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        payload = health.get_json()
        self.assertEqual(payload.get("status"), "healthy")


if __name__ == "__main__":
    unittest.main()
