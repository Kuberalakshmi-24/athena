import logging
import os
import re
import json
import hashlib
from pathlib import Path
from typing import List
from tqdm import tqdm
from langchain_groq import ChatGroq
from langchain_chroma import Chroma
try:
    from langchain_huggingface import HuggingFaceEmbeddings
except Exception:
    HuggingFaceEmbeddings = None
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import CrossEncoder

from langchain_classic.chains import ConversationalRetrievalChain
from langchain_classic.memory import ConversationBufferWindowMemory
from dotenv import load_dotenv


load_dotenv()

logging.getLogger("pypdf").setLevel(logging.ERROR)


class LocalHashEmbeddings:
    """Deterministic, offline-safe fallback embeddings.

    This keeps the backend bootable when Hugging Face cannot be reached.
    It is lower quality than transformer embeddings but API-compatible for Chroma.
    """

    def __init__(self, dim=384):
        self.dim = dim

    def _embed(self, text):
        vec = [0.0] * self.dim
        tokens = (text or "").lower().split()
        if not tokens:
            return vec

        for tok in tokens:
            digest = hashlib.sha256(tok.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "big") % self.dim
            sign = 1.0 if (digest[4] % 2 == 0) else -1.0
            vec[idx] += sign

        norm = sum(v * v for v in vec) ** 0.5
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    def embed_documents(self, texts):
        return [self._embed(t) for t in texts]

    def embed_query(self, text):
        return self._embed(text)

class RAGService:
    def __init__(self):
        """Initialize with minimal overhead. Heavy components load lazily."""
        self.api_key = os.getenv("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")

        self.base_dir = Path(__file__).resolve().parents[2]
        self.data_dir = self.base_dir / "data"
        self.chroma_dir = self.base_dir / "chroma_db"
        
        # Lazy-loaded components (initialized on first use)
        self.llm = None
        self.embeddings = None
        self.reranker = None
        self.vector_db = None
        
        # State
        self.conversation_chains = {}
        self.learning_level = "Beginner"
        self.score = 0
        self.total_quizzes = 0
        self.max_context_chars = 2200
        self._initialized = False

    def _ensure_initialized(self):
        """Lazy initialization of heavy components on first use."""
        if self._initialized:
            return
        
        self._initialized = True
        print("[INFO] Initializing RAGService heavy components...")
        
        # Initialize LLM
        try:
            self.llm = ChatGroq(
                groq_api_key=self.api_key,
                model_name="llama-3.1-8b-instant",
                temperature=0.2,
                max_tokens=700,
                streaming=True
            )
            print("[INFO] ChatGroq LLM initialized")
        except Exception as e:
            print(f"[ERROR] Failed to initialize ChatGroq: {e}")
            raise
        
        # Initialize embeddings
        try:
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            if HuggingFaceEmbeddings is None:
                raise ImportError("langchain_huggingface is not installed")
            self.embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
            print("[INFO] Loaded HuggingFace embeddings: BAAI/bge-small-en-v1.5")
        except Exception as e:
            print(f"[WARN] HuggingFace embeddings unavailable ({e}). Falling back to LocalHashEmbeddings.")
            self.embeddings = LocalHashEmbeddings(dim=384)
        
        # Initialize vector DB
        try:
            self.vector_db = self._load_or_create_vector_db()
            print("[INFO] Vector database initialized")
        except Exception as e:
            print(f"[ERROR] Failed to initialize vector DB: {e}")
            raise
        
        # Initialize reranker
        try:
            self.reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            print("[INFO] CrossEncoder reranker loaded")
        except Exception as e:
            self.reranker = None
            print(f"[WARN] Cross-encoder reranker unavailable: {e}")
        
        # Auto-ingest existing data if needed
        if self._vector_db_is_empty():
            print("[INFO] Vector store is empty, auto-ingesting subjects...")
            self.auto_ingest_all_subjects()
        else:
            print("[INFO] Vector store already populated. Skipping startup ingestion.")

    def _curriculum_graph_path(self, subject):
        safe_subject = (subject or "General").strip() or "General"
        subject_dir = self.data_dir / safe_subject
        subject_dir.mkdir(parents=True, exist_ok=True)
        return subject_dir / "curriculum_graph.json"

    def _load_curriculum_graph(self, subject):
        graph_path = self._curriculum_graph_path(subject)
        if graph_path.exists():
            try:
                with open(graph_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        data.setdefault("subject", subject)
                        data.setdefault("nodes", [])
                        data.setdefault("edges", [])
                        return data
            except Exception:
                pass
        return {"subject": subject, "nodes": [], "edges": []}

    def _save_curriculum_graph(self, subject, graph):
        graph_path = self._curriculum_graph_path(subject)
        with open(graph_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2)

    def extract_curriculum_concepts(self, text):
        prompt = f"""
        Extract core academic concepts and prerequisites from the text.

        Return STRICT JSON only:
        {{
          "concepts": [
            {{
              "name": "concept name",
              "prerequisite": "prerequisite concept or empty string"
            }}
          ]
        }}

        Text:
        {(text or '')[:1500]}
        """

        try:
            result = self.llm.invoke(prompt)
            raw = getattr(result, "content", str(result)).strip()
            parsed = json.loads(raw)
            concepts = parsed.get("concepts", []) if isinstance(parsed, dict) else []
            cleaned = []
            for c in concepts:
                if not isinstance(c, dict):
                    continue
                name = str(c.get("name", "")).strip()
                prereq = str(c.get("prerequisite", "")).strip()
                if name:
                    cleaned.append({"name": name, "prerequisite": prereq})
            return cleaned
        except Exception:
            return []

    def _update_curriculum_graph_from_documents(self, subject, documents):
        if not documents:
            return

        graph = self._load_curriculum_graph(subject)
        node_set = set(graph.get("nodes", []))
        edge_set = {tuple(e) for e in graph.get("edges", []) if isinstance(e, list) and len(e) == 2}

        # Limit extraction calls for cost/stability while still learning curriculum structure.
        sample_docs = documents[:6]
        for doc in sample_docs:
            concepts = self.extract_curriculum_concepts(doc.page_content or "")
            for item in concepts:
                name = item["name"]
                prereq = item.get("prerequisite", "")
                node_set.add(name)
                if prereq:
                    node_set.add(prereq)
                    edge_set.add((prereq, name))

        graph["subject"] = subject
        graph["nodes"] = sorted(node_set)
        graph["edges"] = [list(e) for e in sorted(edge_set)]
        self._save_curriculum_graph(subject, graph)

    def get_curriculum_graph(self, subject):
        return self._load_curriculum_graph(subject)

    def generate_learning_path(self, subject, level, weak_topics=None, progress_map=None):
        weak_topics = weak_topics or []
        progress_map = progress_map or {}
        graph = self._load_curriculum_graph(subject)

        if not graph.get("nodes"):
            return {"subject": subject, "steps": [], "graph": graph}

        prompt = f"""
        Create a personalized learning roadmap from this curriculum graph.

        Student Level: {level}
        Weak Topics: {', '.join(weak_topics) if weak_topics else 'None'}
        Existing Progress:
        {json.dumps(progress_map)[:1200]}

        Curriculum Graph JSON:
        {json.dumps(graph)[:2500]}

        Return STRICT JSON:
        {{
          "steps": ["Concept 1", "Concept 2", "Concept 3"]
        }}
        """

        steps = []
        try:
            result = self.llm.invoke(prompt)
            raw = getattr(result, "content", str(result)).strip()
            parsed = json.loads(raw)
            steps = parsed.get("steps", []) if isinstance(parsed, dict) else []
            steps = [s.strip() for s in steps if isinstance(s, str) and s.strip()]
        except Exception:
            # Deterministic fallback if model JSON fails.
            steps = graph.get("nodes", [])[:]

        # Keep only graph concepts and remove duplicates while preserving order.
        valid_nodes = set(graph.get("nodes", []))
        deduped = []
        seen = set()
        for step in steps:
            if step in valid_nodes and step not in seen:
                deduped.append(step)
                seen.add(step)
        for node in graph.get("nodes", []):
            if node not in seen:
                deduped.append(node)

        step_objects = []
        for idx, concept in enumerate(deduped, start=1):
            progress = progress_map.get(concept, {}) if isinstance(progress_map, dict) else {}
            step_objects.append({
                "order": idx,
                "concept": concept,
                "status": progress.get("status", "not_started"),
                "mastery_score": float(progress.get("mastery_score", 0.0) or 0.0)
            })

        return {
            "subject": subject,
            "steps": step_objects,
            "graph": graph,
        }


    def list_subjects(self):
        if not self.data_dir.exists():
            return []
        return [d.name for d in self.data_dir.iterdir() if d.is_dir()]

    def _load_or_create_vector_db(self):
        self.chroma_dir.mkdir(parents=True, exist_ok=True)
        return Chroma(
            persist_directory=str(self.chroma_dir),
            embedding_function=self.embeddings
        )

    def _persist_if_supported(self):
        if hasattr(self.vector_db, "persist"):
            self.vector_db.persist()

    def _vector_db_is_empty(self):
        try:
            return self.vector_db._collection.count() == 0
        except Exception:
            return True

    def _get_retriever(self):
        return self.vector_db.as_retriever(
            search_type="mmr",
            search_kwargs={"k": 3, "fetch_k": 10}
        )

    def _get_conversation_chain(self, user_id):
        if user_id not in self.conversation_chains:
            memory = ConversationBufferWindowMemory(
                k=3,
                memory_key="chat_history",
                return_messages=True,
                output_key="answer"
            )
            self.conversation_chains[user_id] = ConversationalRetrievalChain.from_llm(
                llm=self.llm,
                retriever=self._get_retriever(),
                memory=memory,
                return_source_documents=True,
                output_key="answer"
            )
        return self.conversation_chains[user_id]

    def _extract_topic(self, answer_text):
        topic = "General"
        cleaned = answer_text or ""
        if "Topic:" in cleaned:
            lines = cleaned.split('\n')
            for line in lines:
                if line.strip().startswith("Topic:"):
                    topic = line.replace("Topic:", "").strip()
                    cleaned = cleaned.replace(line, "").strip()
                    break
        return cleaned, topic

    def _is_off_topic(self, topic, answer_text):
        topic_norm = (topic or "").strip().lower().replace("_", " ")
        if topic_norm in {"off-topic", "off topic"}:
            return True
        text_norm = (answer_text or "").lower()
        return text_norm.startswith("topic: off-topic") or text_norm.startswith("topic: off topic")

    def _is_greeting_query(self, query):
        q = (query or "").strip().lower()
        if not q:
            return False
        exact = {
            "hi", "hii", "hiii", "hello", "hey", "hey there", "yo",
            "good morning", "good afternoon", "good evening"
        }
        if q in exact:
            return True
        return bool(re.fullmatch(r"(hi+|hello+|hey+)", q))

    def _is_goodbye_query(self, query):
        q = (query or "").strip().lower()
        if not q:
            return False
        exact = {
            "bye", "goodbye", "see you", "see ya", "take care", "thanks bye", "ok bye", "bye bye"
        }
        if q in exact:
            return True
        return bool(re.fullmatch(r"(bye+|good\s*bye+)", q))

    def _handle_small_talk(self, query, current_topic=None):
        if self._is_greeting_query(query):
            topic_label = (current_topic or "General").strip() or "General"
            return (
                f"Hello! We are currently learning {topic_label}. Ask me a question from this topic and I will help you.",
                topic_label,
            )
        if self._is_goodbye_query(query):
            topic_label = (current_topic or "General").strip() or "General"
            return (
                "Goodbye! Great work today. Come back anytime to continue learning.",
                topic_label,
            )
        return None

    def _is_query_relevant_to_topic(self, query, current_topic, subject=None):
        topic_norm = (current_topic or "").strip().lower()
        if not topic_norm or topic_norm in {"general", "none", "n/a"}:
            return True

        # Never block small-talk interactions.
        if self._is_greeting_query(query) or self._is_goodbye_query(query):
            return True

        # Strict deterministic gate: the query must share meaningful tokens with
        # the current topic. This guarantees out-of-topic questions are blocked.
        stop = {
            "what", "which", "when", "where", "why", "how", "can", "could",
            "would", "should", "tell", "about", "please", "explain", "define",
            "topic", "question", "help", "give", "show", "me", "is", "are",
            "the", "a", "an", "to", "for", "of", "in", "on", "and", "or"
        }
        # Use 2+ chars so acronym topics like AI/ML/CNN are handled correctly.
        query_terms = {t for t in re.findall(r"[a-z0-9]{2,}", (query or "").lower()) if t not in stop}
        topic_terms = {t for t in re.findall(r"[a-z0-9]{2,}", topic_norm) if t not in stop}

        if not topic_terms:
            # Fallback for unusual topic names: require phrase-level mention.
            topic_phrase = re.sub(r"[^a-z0-9]+", " ", topic_norm).strip()
            query_norm = re.sub(r"[^a-z0-9]+", " ", (query or "").lower()).strip()
            return bool(topic_phrase and topic_phrase in query_norm)

        return bool(query_terms.intersection(topic_terms))

    def _format_mermaid_diagram(self, answer_text):
        """Normalize malformed Mermaid output into one clean fenced code block."""
        if not answer_text:
            return answer_text

        text = answer_text.replace("\r\n", "\n")
        text = text.replace("→", "-->").replace("⇒", "-->").replace("->", "-->")
        text = text.replace("```mermaid\n```mermaid", "```mermaid")

        def is_diagram_line(line):
            s = (line or "").strip()
            if not s:
                return True
            if s in {"```", "mermaid"}:
                return True
            prefixes = (
                "graph ", "flowchart ", "subgraph ", "end", "style ", "class ", "classDef ", "linkStyle "
            )
            if s.startswith(prefixes):
                return True
            return "-->" in s or "-->|" in s or ("[" in s and "]" in s)

        def clean_diagram(diagram_text):
            raw_lines = (diagram_text or "").split("\n")
            cleaned = []
            for line in raw_lines:
                s = line.strip()
                if not s or s == "```" or s.lower() == "mermaid":
                    continue
                s = s.replace("→", "-->").replace("⇒", "-->").replace("->", "-->")
                cleaned.append(s)

            if not cleaned:
                return ""

            if not any(l.lower().startswith("graph ") or l.lower().startswith("flowchart ") for l in cleaned):
                cleaned.insert(0, "graph TD")

            return "\n".join(cleaned)

        if "```mermaid" in text:
            start = text.find("```mermaid")
            before = text[:start]
            rest = text[start + len("```mermaid"):]

            close = rest.find("```")
            if close == -1:
                block = rest
                after = ""
            else:
                block = rest[:close]
                after = rest[close + 3:]

            # Pull diagram continuation lines that accidentally leaked outside the fence.
            after_lines = after.split("\n")
            continuation = []
            remaining = []
            consuming = True
            saw_diagram = False
            for line in after_lines:
                if consuming and is_diagram_line(line):
                    continuation.append(line)
                    if line.strip():
                        saw_diagram = True
                    continue
                if consuming and not line.strip() and not saw_diagram:
                    continuation.append(line)
                    continue
                consuming = False
                remaining.append(line)

            merged = clean_diagram(block + "\n" + "\n".join(continuation))
            if not merged:
                return answer_text

            after_clean = "\n".join(remaining).lstrip("\n")
            rebuilt = f"{before}```mermaid\n{merged}\n```"
            if after_clean:
                rebuilt += f"\n{after_clean}"
            return rebuilt

        graph_match = re.search(r"\b(graph\s+(?:TD|LR|TB|BT|RL)|flowchart\s+\w+)\b", text, flags=re.IGNORECASE)
        if not graph_match and "-->" not in text:
            return answer_text

        if graph_match:
            start = graph_match.start()
            before = text[:start]
            tail = text[start:]
        else:
            before = ""
            tail = text

        end_markers = ["\n\n**", "\n---QUIZ", "\n\nSources:", "\n\nNote:", "\n\nQ1:"]
        end_idx = len(tail)
        for marker in end_markers:
            idx = tail.find(marker)
            if idx != -1 and idx < end_idx:
                end_idx = idx

        block = tail[:end_idx]
        after = tail[end_idx:]
        merged = clean_diagram(block)
        if not merged:
            return answer_text

        return f"{before}```mermaid\n{merged}\n```\n{after.lstrip()}".rstrip()
    def _has_visual(self, answer_text):
        text = answer_text or ""
        return "```mermaid" in text

    def _has_quiz(self, answer_text):
        text = answer_text or ""
        return "---QUIZ---" in text and "---ENDQUIZ---" in text

    def _rewrite_query(self, query):
        rewrite_prompt = f"""
        Rewrite the student's question into a clear academic retrieval query.
        Keep the exact intent and topic. Output only one rewritten query line.

        Student Question:
        {query}

        Improved Retrieval Query:
        """
        try:
            result = self.llm.invoke(rewrite_prompt)
            text = getattr(result, "content", str(result)).strip()
            return text if text else query
        except Exception:
            return query

    # Public wrapper for external readability and pipeline clarity.
    def rewrite_query(self, query):
        return self._rewrite_query(query)

    def compress_context(self, docs, query):
        """Summarize retrieved chunks so answer generation stays below token limits."""
        if not docs:
            return ""

        combined_text = "\n\n".join([(d.page_content or "")[:1200] for d in docs])
        prompt = f"""
        Summarize the following study material to answer the student question.
        Keep only relevant facts, definitions, steps, and key examples.
        Keep output concise and syllabus-grounded.

        Question:
        {query}

        Material:
        {combined_text}

        Concise relevant summary:
        """

        try:
            result = self.llm.invoke(prompt)
            return getattr(result, "content", str(result)).strip()
        except Exception:
            # Fallback if compression call fails
            return combined_text[:1800]

    def _hybrid_retrieve(self, original_query, rewritten_query):
        """Approximate hybrid retrieval by combining raw-query and rewritten-query results."""
        combined_docs = []
        seen = set()

        for q in [rewritten_query, original_query]:
            if not q:
                continue
            try:
                docs = self.vector_db.similarity_search(q, k=12)
            except Exception:
                docs = []

            for doc in docs:
                key = (doc.metadata.get("source", ""), hash(doc.page_content[:400]))
                if key in seen:
                    continue
                seen.add(key)
                combined_docs.append(doc)

        return combined_docs

    def _agent_reasoning(self, query, context):
        prompt = f"""
        You are Athena, an AI tutor reasoning about a student question.

        Question:
        {query}

        Current Context:
        {context}

        Decide:
        1. Do we have enough information to answer?
        2. If not, what should we search next?

        Respond in strict JSON:
        {{
            "decision": "answer" or "search",
            "next_query": "improved search query if needed"
        }}
        """

        try:
            result = self.llm.invoke(prompt)
            text = getattr(result, "content", str(result)).strip()
            parsed = json.loads(text)
            decision = str(parsed.get("decision", "answer")).lower().strip()
            if decision not in {"answer", "search"}:
                decision = "answer"
            next_query = str(parsed.get("next_query", "")).strip()
            return {"decision": decision, "next_query": next_query}
        except Exception:
            return {"decision": "answer", "next_query": ""}

    def _merge_unique_docs(self, docs):
        unique = []
        seen = set()
        for doc in docs:
            key = (doc.metadata.get("source", ""), hash((doc.page_content or "")[:400]))
            if key in seen:
                continue
            seen.add(key)
            unique.append(doc)
        return unique

    def _run_agentic_retrieval(self, query, rewritten_query):
        retrieved_docs = self.vector_db.similarity_search(rewritten_query, k=5)
        context_for_reasoning = "\n".join([(d.page_content or "")[:500] for d in retrieved_docs])

        reasoning = self._agent_reasoning(query, context_for_reasoning)
        if reasoning.get("decision") == "search":
            next_query = reasoning.get("next_query") or query
            try:
                extra_docs = self.vector_db.similarity_search(next_query, k=3)
                retrieved_docs.extend(extra_docs)
            except Exception:
                pass

        retrieved_docs = self._merge_unique_docs(retrieved_docs)
        reranked_docs = self._rerank_documents(query, retrieved_docs, top_k=4)
        selected_docs = self._compress_context(reranked_docs, max_chars=self.max_context_chars)
        compressed_context = self.compress_context(selected_docs, query)
        return selected_docs, compressed_context

    def _rerank_documents(self, query, docs, top_k=6):
        if not docs:
            return []
        if not self.reranker:
            return docs[:top_k]

        pairs = [(query, doc.page_content) for doc in docs]
        try:
            scores = self.reranker.predict(pairs)
            ranked = sorted(zip(scores, docs), key=lambda x: x[0], reverse=True)
            return [doc for _, doc in ranked[:top_k]]
        except Exception:
            return docs[:top_k]

    def _compress_context(self, docs, max_chars=None):
        limit = max_chars or self.max_context_chars
        selected: List = []
        current_len = 0

        for doc in docs:
            chunk = (doc.page_content or "").strip()
            if not chunk:
                continue
            if current_len + len(chunk) > limit:
                break
            selected.append(doc)
            current_len += len(chunk)

        return selected

    def _build_grounded_context(self, docs):
        parts = []
        for idx, doc in enumerate(docs, start=1):
            src = Path(doc.metadata.get("source", "unknown")).stem
            parts.append(f"[Doc {idx} | {src}]\n{doc.page_content.strip()}")
        return "\n\n".join(parts)

    def _validate_answer(self, query, answer, context):
        validation_prompt = f"""
        Determine if the answer is fully supported by the provided context.

        Question:
        {query}

        Context:
        {context}

        Answer:
        {answer}

        Respond with exactly one token:
        VALID or INVALID
        """

        try:
            result = self.llm.invoke(validation_prompt)
            text = getattr(result, "content", str(result)).strip().upper()
            first_token = text.split()[0] if text else "INVALID"
            return first_token == "VALID"
        except Exception:
            return False

    def _is_image_request(self, query):
        keywords = [
            "diagram",
            "picture",
            "image",
            "visual",
            "flowchart",
            "architecture",
            "graph",
            "draw",
            "show diagram",
            "show picture"
        ]
        query_lower = (query or "").lower()
        return any(word in query_lower for word in keywords)

    def _detect_visual_intent(self, query):
        q = (query or "").lower()
        only_markers = ["only", "just"]
        visual_markers = ["diagram", "picture", "image", "flowchart", "draw", "graph", "architecture"]
        explanation_markers = ["explain", "why", "how", "define", "what is", "with explanation"]
        visual_only_starts = ("show", "draw", "give", "provide", "create", "make")

        has_visual = any(m in q for m in visual_markers)
        has_only = any(m in q for m in only_markers)
        asks_explanation = any(m in q for m in explanation_markers)
        explicit_visual_only = has_visual and (has_only or q.startswith(visual_only_starts)) and not asks_explanation

        prompt = f"""
        Determine the user's intent category for the question below.

        Categories:
        VISUAL_ONLY: user explicitly asks for only a picture/diagram/flowchart with no explanation.
        MIXED: user asks for explanation plus a visual.
        NORMAL: regular question with no visual-only intent.

        Question:
        {query}

        Respond with exactly one token:
        VISUAL_ONLY / MIXED / NORMAL
        """
        try:
            result = self.llm.invoke(prompt)
            text = getattr(result, "content", str(result)).strip().upper()
            token = text.split()[0] if text else "NORMAL"
            token = token.replace(".", "").replace(",", "").replace(":", "")
            if token in {"VISUAL_ONLY", "MIXED", "NORMAL"}:
                # Heuristic override for explicit "give/show image" prompts.
                if explicit_visual_only:
                    return "VISUAL_ONLY"
                return token
        except Exception:
            pass

        # Fallback heuristic if classifier fails.
        if has_visual and (has_only or q.startswith(visual_only_starts)) and not asks_explanation:
            return "VISUAL_ONLY"
        if has_visual and asks_explanation:
            return "MIXED"
        return "NORMAL"

    def _detect_visual_concept(self, query):
        import re
        q = (query or "").lower()

        # NLP — check before neural_network to avoid "nlp neural" confusion
        if re.search(r"\bnlp\b|natural language processing|text classification|tokeniz|lemmatiz|named entity|pos tag", q):
            return "nlp"

        # Neural network / deep learning
        if re.search(r"neural network|neuron network|deep learning|multilayer perceptron|\bmlp\b|\bann\b|backprop|feedforward|fully.?connected|\bneuron\b|artificial neuron|perceptron", q):
            return "neural_network"

        # CNN
        if re.search(r"\bcnn\b|convolutional|conv net|convolution layer", q):
            return "cnn"

        # RNN / LSTM / GRU
        if re.search(r"\brnn\b|recurrent|\blstm\b|\bgru\b|sequence model|time series network", q):
            return "rnn"

        # Transformer / attention
        if re.search(r"transformer|self.?attention|multi.?head attention|\bbert\b|\bgpt\b|encoder.?decoder", q):
            return "transformer"

        # SVM
        if re.search(r"\bsvm\b|support vector|hyperplane|kernel trick", q):
            return "svm"

        # KNN
        if re.search(r"\bknn\b|k.nearest|nearest neighbor", q):
            return "knn"

        # Decision tree / random forest / gradient boosting
        if re.search(r"decision tree|random forest|gradient boost|\bxgboost\b|\bgbm\b", q):
            return "decision_tree"

        # Ensemble methods
        if re.search(r"\bensemble\b|bagging|boosting|stacking|voting classifier|blending", q):
            return "ensemble"

        # Clustering / K-means
        if re.search(r"k.?means|clustering|unsupervised cluster|centroid|dbscan|hierarchical cluster", q):
            return "clustering"

        # PCA / dimensionality reduction
        if re.search(r"\bpca\b|principal component|dimensionality reduction|svd decomposition|t.sne|\bumap\b", q):
            return "pca"

        # Logistic regression
        if re.search(r"logistic regression|sigmoid function|binary classif|log.?loss", q):
            return "logistic_regression"

        # Linear regression
        if re.search(r"linear regression|ordinary least squares|\bols\b|residual|regression line|cost function|gradient descent|\blasso\b|\bridge\b|regularization", q):
            return "linear_regression"

        # Naive Bayes
        if re.search(r"naive bayes|bayesian classif|bayes theorem|posterior probab", q):
            return "naive_bayes"

        # Data preprocessing / wrangling / cleaning
        if re.search(r"data wrangl|data clean|preprocess|missing value|null value|imputation|outlier|normali|standardi|data preparation|data transform", q):
            return "data_preprocessing"

        # Statistics / probability
        if re.search(r"\bstatistic|probability distribution|hypothesis test|p.?value|confidence interval|normal distribution|central limit|variance|standard deviation|correlation|covariance|t.test|chi.square|anova", q):
            return "statistics"

        # Data visualization
        if re.search(r"data visual|visuali|matplotlib|seaborn|\bplot\b|histogram|scatter|bar chart|heatmap|boxplot|pie chart|line chart|exploratory data", q):
            return "data_visualization"

        # Feature engineering / selection
        if re.search(r"feature engineer|feature select|feature extract|one.hot|label encod|ordinal encod|feature scal|feature importance|variable selection", q):
            return "feature_engineering"

        # Model evaluation / cross-validation / overfitting
        if re.search(r"model evaluat|cross.valid|train.test split|accuracy|precision|recall|f1.score|roc.auc|confusion matrix|overfitt|underfitt|bias.variance|learning curve|validation", q):
            return "model_evaluation"

        # ML / data science pipeline  
        if re.search(r"machine learning pipeline|ml pipeline|data science pipeline|data science process|crisp.?dm|data science workflow|end.to.end|model deployment|model productioni", q):
            return "ml_pipeline"

        # Pandas / NumPy / data manipulation
        if re.search(r"\bpandas\b|dataframe|numpy|\bnp\b|\bpd\b|groupby|merge|join|pivot|reshape|array operation", q):
            return "pandas_numpy"

        return "general"

    def _fallback_mermaid_for_concept(self, concept):
        fallbacks = {
            "neural_network": """```mermaid
graph TD
Input[Input Layer] --> H1[Hidden Neuron 1]
Input --> H2[Hidden Neuron 2]
Input --> H3[Hidden Neuron 3]
H1 --> Output[Output Layer]
H2 --> Output
H3 --> Output
```""",
            "nlp": """```mermaid
graph TD
Text[Raw Text] --> Preprocess[Preprocessing]
Preprocess --> Tokenize[Tokenization]
Tokenize --> Embed[Word Embeddings]
Embed --> Model[NLP Model]
Model --> Predict[Prediction]
```""",
            "transformer": """```mermaid
graph TD
Input[Input Tokens] --> Embed[Token Embeddings]
Embed --> Attention[Self-Attention]
Attention --> Norm[Layer Norm]
Norm --> FFN[Feed Forward]
FFN --> Output[Output Tokens]
```""",
            "logistic_regression": """```mermaid
graph TD
Data[Input Features] --> WeightedSum[Weighted Sum]
WeightedSum --> Sigmoid[Sigmoid Activation]
Sigmoid --> Probability[Class Probability]
Probability --> Loss[Binary Cross-Entropy]
Loss --> Update[Weight Update]
```""",
            "decision_tree": """```mermaid
graph TD
Root[Root Node] --> Q1{Feature Split}
Q1 -->|Yes| Branch1[Left Branch]
Q1 -->|No| Branch2[Right Branch]
Branch1 --> Leaf1[Class A]
Branch2 --> Leaf2[Class B]
```""",
            "cnn": """```mermaid
graph TD
Image[Input Image] --> Conv[Convolution Layer]
Conv --> Pool[Max Pooling]
Pool --> Conv2[Conv Layer 2]
Conv2 --> Flat[Flatten]
Flat --> Dense[Dense Layer]
Dense --> Output[Class Output]
```""",
            "rnn": """```mermaid
graph TD
Input[Input Sequence] --> Hidden[Hidden State]
Hidden -->|timestep| Hidden
Hidden --> Output[Output Sequence]
Output --> Loss[Loss Function]
```""",
            "svm": """```mermaid
graph TD
Data[Training Data] --> Kernel[Kernel Function]
Kernel --> HyperPlane[Optimal Hyperplane]
HyperPlane --> SV[Support Vectors]
SV --> Margin[Maximum Margin]
Margin --> Classify[Classification]
```""",
            "knn": """```mermaid
graph TD
Query[Query Point] --> Dist[Compute Distances]
Dist --> Sort[Sort Neighbors]
Sort --> K[Select K Nearest]
K --> Vote[Majority Vote]
Vote --> Class[Predicted Class]
```""",
            "clustering": """```mermaid
graph TD
Data[Input Data] --> Init[Initialize Centroids]
Init --> Assign[Assign to Clusters]
Assign --> Update[Update Centroids]
Update --> Check{Converged?}
Check -->|No| Assign
Check -->|Yes| Result[Final Clusters]
```""",
            "pca": """```mermaid
graph TD
Data[Input Data] --> Center[Center Data]
Center --> Cov[Covariance Matrix]
Cov --> Eigen[Eigen Decomposition]
Eigen --> Select[Select Top Components]
Select --> Project[Project Data]
```""",
            "naive_bayes": """```mermaid
graph TD
Input[Input Features] --> Prior[Prior Probability]
Input --> Likelihood[Likelihood P(X|Y)]
Prior --> Posterior[Posterior P(Y|X)]
Likelihood --> Posterior
Posterior --> Class[Predicted Class]
```""",
            "linear_regression": """```mermaid
graph TD
Data[Training Data] --> Features[Features X]
Data --> Target[Target Y]
Features --> Model[Linear Model]
Target --> Loss[Mean Squared Error]
Model --> Pred[Predictions]
Pred --> Loss
Loss --> Update[Update Weights]
Update --> Model
```""",
            "ensemble": """```mermaid
graph TD
Data[Training Data] --> M1[Model 1]
Data --> M2[Model 2]
Data --> M3[Model 3]
M1 --> Combine[Aggregation]
M2 --> Combine
M3 --> Combine
Combine --> Final[Final Prediction]
```""",
            "data_preprocessing": """```mermaid
graph TD
Raw[Raw Data] --> Missing[Handle Missing Values]
Missing --> Outliers[Remove Outliers]
Outliers --> Scale[Normalize / Standardize]
Scale --> Encode[Encode Categorical]
Encode --> Clean[Clean Dataset]
```""",
            "statistics": """```mermaid
graph TD
Data[Data Collection] --> Describe[Descriptive Stats]
Describe --> Mean[Mean / Median / Mode]
Describe --> Spread[Variance / Std Dev]
Data --> Infer[Inferential Stats]
Infer --> HTest[Hypothesis Testing]
HTest --> PValue[p-value Decision]
```""",
            "data_visualization": """```mermaid
graph TD
Data[Dataset] --> EDA[Exploratory Analysis]
EDA --> Dist[Distribution Plot]
EDA --> Corr[Correlation Heatmap]
EDA --> Trend[Trend Line Chart]
EDA --> Box[Box Plot]
Dist --> Insight[Insights]
Corr --> Insight
Trend --> Insight
Box --> Insight
```""",
            "feature_engineering": """```mermaid
graph TD
Raw[Raw Features] --> Select[Feature Selection]
Raw --> Create[Feature Creation]
Select --> Encode[Encoding]
Create --> Encode
Encode --> Scale[Feature Scaling]
Scale --> Model[Model Input]
```""",
            "model_evaluation": """```mermaid
graph TD
Data[Labeled Data] --> Split[Train/Test Split]
Split --> Train[Train Model]
Split --> Test[Test Set]
Train --> Predict[Predictions]
Test --> Predict
Predict --> Metrics[Accuracy / F1 / AUC]
Metrics --> CV[Cross-Validation]
CV --> Report[Final Evaluation]
```""",
            "ml_pipeline": """```mermaid
graph TD
Collect[Data Collection] --> Preprocess[Preprocessing]
Preprocess --> Features[Feature Engineering]
Features --> Train[Model Training]
Train --> Evaluate[Evaluation]
Evaluate --> Tune[Hyperparameter Tuning]
Tune --> Deploy[Deployment]
```""",
            "pandas_numpy": """```mermaid
graph TD
Load[Load Data] --> DF[DataFrame]
DF --> Select[Select Columns]
DF --> Filter[Filter Rows]
DF --> Group[GroupBy]
Select --> Transform[Transform]
Filter --> Transform
Group --> Agg[Aggregate]
Agg --> Result[Result]
Transform --> Result
```""",
        }
        if concept in fallbacks:
            return fallbacks[concept]
        return """```mermaid
graph TD
Problem[Problem Statement] --> Analysis[Data Analysis]
Analysis --> Model[Model Selection]
Model --> Train[Training]
Train --> Evaluate[Evaluation]
Evaluate --> Deploy[Deployment]
```"""

    def _get_graph_complexity(self, question_type, level):
        lvl = (level or "").strip().lower()
        qtype = (question_type or "").strip().lower()
        if qtype == "simple" or lvl == "beginner":
            return "small"
        if qtype == "definition":
            return "small"
        if qtype == "problem":
            return "medium"
        return "large"

    def _get_diagram_guidance(self, question_type, level):
        complexity = self._get_graph_complexity(question_type, level)
        if complexity == "small":
            return (
                "SMALL diagram:\n"
                "- Use graph TD only\n"
                "- Use 3-4 nodes only\n"
                "- Simple top-down flow or single-branch tree\n"
                "- Keep labels beginner-friendly (1-3 words)"
            )
        if complexity == "medium":
            return (
                "MEDIUM diagram:\n"
                "- Use graph TD (NEVER graph LR for a simple sequential list)\n"
                "- Use 4-6 nodes\n"
                "- Prefer branching or hierarchical structure over flat linear chains\n"
                "- Keep labels concise and domain-specific"
            )
        return (
            "LARGE diagram:\n"
            "- Use graph TD for all multi-level hierarchies and concept maps\n"
            "- Use graph LR ONLY if the concept is an explicit left-to-right data pipeline with at most 3 hops\n"
            "- Use 5-8 nodes with at least one branch or feedback edge\n"
            "- Keep labels domain-specific and precise"
        )

    def _generate_visual_only(self, query, subject=None, context_text="", question_type="complex", current_level="Beginner"):
        concept = self._detect_visual_concept(query)
        diagram_guidance = self._get_diagram_guidance(question_type, current_level)
        # When concept is unrecognised use the raw query as the topic label so the LLM
        # generates a diagram that's actually relevant to what was asked.
        concept_label = query.strip() if concept == "general" else concept.replace("_", " ")
        prompt = f"""
        You are generating a learning diagram for students.

        Topic concept: {concept_label}
        Subject context: {subject if subject else "General"}
        Student question: {query}

        Generate ONLY one Mermaid diagram that represents this concept.
        Do NOT include prose, headings, bullets, quiz, or extra text.
        The diagram MUST represent the concept mentioned in the question.
        Do not reuse diagrams from unrelated topics.

        STRICT MERMAID RULES:
        - Output must be ONLY one fenced Mermaid code block.
        - Use ONLY these arrow styles: --> and -->|label|.
        - DO NOT use: →, ⇒, ->, or mixed arrow styles.
        - ALWAYS use graph TD (top-down). ONLY use graph LR if there are 3 or fewer sequential nodes.
        - NEVER create a flat single-row chain of 4+ nodes — it renders unreadably small.
        - Add branches, splits, or two-column layouts when depicting 4+ sequential steps.
        - Keep it simple and fully connected.

        Diagram complexity rules:
        {diagram_guidance}

        General quality rules:
        - Keep node count between 4 and 7 for clarity.
        - Every node must have an explicit descriptive label (no single-letter unlabeled IDs).
        - Do not use emojis.
        - Add arrow labels only if they improve clarity.
        - Keep diagram readable for student level: {current_level}.
        - For neural networks: show multiple nodes per layer with fan-in/fan-out edges.

        Study context (use for terminology fidelity):
        {context_text[:1600] if context_text else "No additional context provided."}

        Return exactly in this format:
        ```mermaid
        graph TD
        A[Node] --> B[Node]
        ```
        """

        def invoke_diagram_generation(additional_hint=""):
            generation_prompt = prompt + (f"\n\nAdditional correction hint:\n{additional_hint}" if additional_hint else "")
            result = self.llm.invoke(generation_prompt)
            content = getattr(result, "content", str(result)).strip()
            return self._as_single_mermaid_block(content)

        content = invoke_diagram_generation()
        if self._validate_mermaid(content):
            return content

        # One strict retry if initial generation is malformed.
        content = invoke_diagram_generation(
            "Regenerate using strict Mermaid syntax. Use graph TD and only --> arrows. Output code block only."
        )
        if self._validate_mermaid(content):
            return content

        # Deterministic, concept-aware fallback to guarantee frontend rendering.
        return self._fallback_mermaid_for_concept(concept)

    def _extract_mermaid_blocks(self, text):
        if not text:
            return []
        return re.findall(r"```mermaid\s*(.*?)```", text, flags=re.IGNORECASE | re.DOTALL)

    def _normalize_mermaid_syntax(self, text):
        if not text:
            return text

        normalized = text.replace("\r\n", "\n")
        normalized = normalized.replace("→", "-->")
        normalized = normalized.replace("⇒", "-->")
        normalized = normalized.replace("->", "-->")

        # Ensure a valid mermaid fenced block wrapper.
        if "```mermaid" not in normalized:
            normalized = f"```mermaid\n{normalized.strip()}\n```"

        return normalized

    def _as_single_mermaid_block(self, text):
        normalized = self._format_mermaid_diagram(self._normalize_mermaid_syntax(text or ""))
        blocks = self._extract_mermaid_blocks(normalized)
        if not blocks:
            return ""

        code = blocks[0]
        lines = [ln.strip() for ln in code.split("\n")]
        cleaned = []
        has_graph_header = False

        for ln in lines:
            if not ln or ln.lower() == "mermaid" or ln == "```":
                continue
            if ln.lower().startswith("graph ") or ln.lower().startswith("flowchart "):
                has_graph_header = True
                cleaned.append(ln)
                continue
            if (
                "-->" in ln
                or "-->|" in ln
                or ln.startswith("style ")
                or ln.startswith("subgraph ")
                or ln == "end"
                or ("[" in ln and "]" in ln)
            ):
                cleaned.append(ln)

        if not cleaned:
            return ""
        if not has_graph_header:
            cleaned.insert(0, "graph TD")

        merged = "\n".join(cleaned)
        return f"```mermaid\n{merged}\n```"

    def _validate_mermaid(self, diagram_text):
        if not diagram_text:
            return False

        raw = diagram_text.lower()
        if "```mermaid" not in raw:
            return False

        blocks = self._extract_mermaid_blocks(diagram_text)
        if not blocks:
            return False

        code = blocks[0]
        lowered = code.lower()
        if "graph " not in lowered and "flowchart " not in lowered:
            return False

        if "→" in code or "⇒" in code or "->" in code:
            return False

        # Must contain at least one valid directed edge.
        if "-->" not in code:
            return False

        return True

    def _looks_generic_mermaid(self, mermaid_code, query):
        if not mermaid_code:
            return True

        labels = []
        labels.extend(re.findall(r"\[([^\]]+)\]", mermaid_code))
        labels.extend(re.findall(r"\(([^\)]+)\)", mermaid_code))
        labels.extend(re.findall(r'\"([^\"]+)\"', mermaid_code))
        labels = [l.strip().lower() for l in labels if l and l.strip()]

        # Catch placeholder IDs in edges (e.g., A --> B --> C) which appear as generic nodes in renderer.
        edge_ids = re.findall(r"\b([A-Za-z][A-Za-z0-9_-]*)\b\s*-->", mermaid_code)
        edge_ids += re.findall(r"-->\s*\|[^|]*\|\s*\b([A-Za-z][A-Za-z0-9_-]*)\b", mermaid_code)
        edge_ids += re.findall(r"-->\s*\b([A-Za-z][A-Za-z0-9_-]*)\b", mermaid_code)
        edge_ids = [i.strip().lower() for i in edge_ids if i and i.strip()]

        generic_tokens = {
            "a", "b", "c", "d", "e", "f", "g", "h",
            "i", "j", "k", "l", "m", "n",
            "node", "node1", "node2", "node3", "node4",
            "step1", "step2", "step3",
            "start", "end", "input", "output", "process"
        }

        # If many IDs are placeholders, treat as generic even when a couple of labels are present.
        placeholder_ids = [i for i in edge_ids if i in generic_tokens or re.fullmatch(r"[a-z]", i)]
        if edge_ids and (len(placeholder_ids) / max(1, len(edge_ids))) >= 0.4:
            return True

        non_generic = [lbl for lbl in labels if lbl not in generic_tokens and len(lbl) > 1]
        if len(non_generic) < 3:
            return True

        query_terms = set(re.findall(r"[a-zA-Z]{4,}", (query or "").lower()))
        if not query_terms:
            return False

        overlap = 0
        for lbl in non_generic:
            if any(term in lbl for term in query_terms):
                overlap += 1
        return overlap == 0

    def _ensure_query_relevant_graph(self, answer_text, query, subject=None, context_text="", question_type="complex", current_level="Beginner"):
        blocks = self._extract_mermaid_blocks(answer_text)
        if not blocks:
            return answer_text

        first_block = blocks[0]
        if not self._looks_generic_mermaid(first_block, query):
            return answer_text

        replacement = self._generate_visual_only(
            query,
            subject=subject,
            context_text=context_text,
            question_type=question_type,
            current_level=current_level,
        )
        return re.sub(
            r"```mermaid\s*.*?```",
            replacement,
            answer_text,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )

    def _detect_question_type(self, query):
        """Classify query complexity so answer length/style can adapt."""
        lowered = (query or "").lower()

        # Fast-path heuristic for procedural/problem-solving prompts.
        problem_keywords = [
            "solve", "calculate", "derive", "prove", "find", "step by step", "steps", "equation"
        ]
        if any(k in lowered for k in problem_keywords):
            return "problem"

        prompt = f"""
        Classify the student's question into ONE category:

        SIMPLE: short factual question
        DEFINITION: asks meaning/concept definition
        PROBLEM: needs procedural or step-by-step solving
        COMPLEX: needs deep reasoning/explanation

        Question:
        {query}

        Respond with only one word:
        SIMPLE / DEFINITION / PROBLEM / COMPLEX
        """

        try:
            result = self.llm.invoke(prompt)
            text = getattr(result, "content", str(result)).strip().upper()
        except Exception:
            return "complex"

        token = text.split()[0] if text else "COMPLEX"
        token = token.replace(".", "").replace(",", "").replace(":", "")

        if token == "SIMPLE":
            return "simple"
        if token == "DEFINITION":
            return "definition"
        if token == "PROBLEM":
            return "problem"
        return "complex"

    def _get_answer_style(self, question_type):
        if question_type == "simple":
            return """
            The question is simple.
            Answer in 1-2 sentences only.
            No quiz. No roadmap. No diagram.
            Keep it direct and clear.
            """
        if question_type == "definition":
            return """
            The student is asking for a definition.
            Provide:
            - A clean definition
            - One short explanation sentence
            - One small beginner-friendly Mermaid diagram
            No quiz. No roadmap.
            """
        if question_type == "problem":
            return """
            This is a problem-solving question.
            Provide:
            - Brief definition/context
            - Numbered step-by-step solution
            - One quick check/example
            Include diagram/quiz only if they materially help solve the problem.
            """
        return """
        The question is complex.
        Provide:
        - Clear definition
        - Step-by-step explanation
        - Example
        Use structured teaching format.
        """

    def _get_teaching_enhancements(self, question_type):
        qtype = (question_type or "").lower()
        allow_code = qtype in {"problem", "complex", "definition"}
        allow_chart = qtype in {"problem", "complex"}

        formula_rule = "- **FORMULAS**: Only show a formula if the student explicitly asks for one (uses 'formula', 'equation', or 'derive'). Never auto-include formulas."
        code_rule = (
            "- Include one short practical Python code block using ```python only when it improves understanding of an algorithm/programming concept."
            if allow_code else
            "- Do not include code snippets unless explicitly requested."
        )
        chart_rule = (
            "- **DATA CHARTS**: Emit a ```chart block for visualizations:\n"
            "  Scatter/regression: {\"type\":\"scatter\",\"title\":\"...\",\"xLabel\":\"...\",\"yLabel\":\"...\",\"regression\":true,\"data\":[{\"x\":number,\"y\":number}]}\n"
            "  Bar/line/pie: {\"type\":\"bar|line|pie\",\"title\":\"...\",\"xLabel\":\"...\",\"yLabel\":\"...\",\"data\":[{\"x\":\"Label\",\"y\":number}]}\n"
            "  Use scatter for regression/correlation data, line for trends over time, bar for comparisons, pie for proportions.\n"
            "  Only emit a chart when student asks for graph/visualization OR real numbers are in context. Max 8 data points."
            if allow_chart else
            "- Do not include chart blocks unless the student explicitly asks for a visualization."
        )

        return f"""
        Additional Teaching Enhancements:
        {formula_rule}
        {code_rule}
        {chart_rule}
        - Keep examples short, beginner-friendly, and directly tied to the question.
        """

    def _trim_answer_for_type(self, answer, question_type):
        """Hard cap verbosity in case the model ignores style instructions."""
        if not answer:
            return answer
        if question_type == "simple":
            sentences = [s.strip() for s in answer.replace("\n", " ").split(".") if s.strip()]
            if not sentences:
                return answer
            return ". ".join(sentences[:2]).strip() + "."
        if question_type == "definition":
            lines = [l.strip() for l in answer.split("\n") if l.strip()]
            return "\n".join(lines[:3])
        return answer

    def _enforce_on_topic_format(self, query, draft_answer, current_level, subject):
        repair_prompt = f"""
        You are formatting an ON-TOPIC tutoring response.
        Keep the explanation faithful to the draft answer and user query.
        Student level: {current_level}
        Subject: {subject if subject else "General"}

        REQUIRED OUTPUT FORMAT (CURRICULUM MODE):
        Topic: [Subject] > [Sub-topic]

        **The Big Picture:**
        [Contextual overview]

        **Step-by-Step Explanation:**
        - [Foundation]
        - [Application]
        - [Detail]

        **Formula / Key Equation** (ONLY if student explicitly asked for a formula — skip entirely if not asked):
        Present the formula in LaTeX block: $$ formula $$
        Then explain each symbol with one bullet per symbol.
        Show one worked numerical example.

        **Data Chart** (ONLY if real numeric data is present AND student requested a visualization):
        Scatter/regression: {{"type":"scatter","title":"...","xLabel":"...","yLabel":"...","regression":true,"data":[{{"x":number,"y":number}}]}}
        Bar/line/pie: {{"type":"bar|line|pie","title":"...","xLabel":"...","yLabel":"...","data":[{{"x":"Category","y":number}}]}}
        Use scatter for regression/distribution. Do NOT invent numbers. Max 8 data points.

        **Learning Roadmap:**
        1. [Previous]
        2. **[Current]** <-- You are here
        3. [Next]

        **Visual Concept Map:**
        Include exactly one mermaid diagram in a ```mermaid block.
        Diagram constraints:
        - 6-10 nodes, meaningful labels (2-4 words), optional emojis.
        - graph TD for concept hierarchies; graph LR for process pipelines.
        - Prefer hierarchical structure and include arrow labels where useful.
        - Use at least one subgraph when the topic has clear stages.
        - Add 2-3 style statements for important nodes.
        - Labels must be specific to the user query/context.
        - Never use placeholders such as A, B, C, Node1, Start, End.

        ---QUIZ---
        Q1: [Question — if topic has a formula, make this formula-based]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer1: [A, B, or C]

        Q2: [Question]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer2: [A, B, or C]

        Q3: [Question]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer3: [A, B, or C]
        ---ENDQUIZ---

        User Query: {query}
        Draft Answer:
        {draft_answer}
        """

        repaired = self.llm.invoke(repair_prompt)
        content = getattr(repaired, "content", None)
        return content if content else str(repaired)

    def auto_ingest_all_subjects(self):
        """Scans the data directory and indices all subjects on startup."""
        subjects = self.list_subjects()
        if not subjects:
            print("No subjects found in data/ for auto-ingestion.")
            return

        print(f"Starting auto-ingestion for subjects: {subjects}")
        all_documents = []
        from langchain_community.document_loaders import DirectoryLoader

        for subject in tqdm(subjects, desc="Subjects", unit="subject"):
            subject_path = os.path.join(os.getcwd(), 'data', subject)
            pdf_loader = DirectoryLoader(subject_path, glob="./*.pdf", loader_cls=PyPDFLoader)
            txt_loader = DirectoryLoader(subject_path, glob="./*.txt", loader_cls=TextLoader)
            
            try:
                subject_docs = []
                subject_docs.extend(pdf_loader.load())
                subject_docs.extend(txt_loader.load())
                for doc in subject_docs:
                    doc.metadata["subject"] = subject
                all_documents.extend(subject_docs)
                self._update_curriculum_graph_from_documents(subject, subject_docs)
            except Exception as e:
                print(f"Error loading {subject}: {e}")

        if all_documents:
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=80)
            chunks = text_splitter.split_documents(all_documents)

            for chunk in tqdm(chunks, desc="Indexing chunks", unit="chunk"):
                self.vector_db.add_documents([chunk])
            self._persist_if_supported()
            print("✅ All subjects ingested and indexed.")
        else:
            print("No documents found to index.")

    def get_response(self, query, current_level="Beginner", user_id="global", subject=None, proficiency_score=0.0, weak_topics=None, current_topic=None):
        small_talk = self._handle_small_talk(query, current_topic=current_topic)
        if small_talk:
            return small_talk

        if self._vector_db_is_empty():
            return "The knowledge base is empty. Please ensure data is loaded.", "N/A"

        if not self._is_query_relevant_to_topic(query, current_topic, subject=subject):
            topic_label = (current_topic or "General").strip() or "General"
            return "it is out of the topic so i don't know", topic_label

        # If user explicitly asks for a picture/diagram only, return only visual output.
        visual_intent = self._detect_visual_intent(query)
        graph_requested = self._is_image_request(query)
        if visual_intent == "VISUAL_ONLY" and graph_requested:
            rewritten_query = self.rewrite_query(query)
            selected_docs, compressed_context = self._run_agentic_retrieval(query, rewritten_query)
            return self._generate_visual_only(
                query,
                subject=subject,
                context_text=compressed_context,
                question_type="definition",
                current_level=current_level,
            ), "Visual"

        question_type = self._detect_question_type(query)
        answer_style = self._get_answer_style(question_type)
        diagram_guidance = self._get_diagram_guidance(question_type, current_level)
        teaching_enhancements = self._get_teaching_enhancements(question_type)

        rewritten_query = self.rewrite_query(query)
        selected_docs, compressed_context = self._run_agentic_retrieval(query, rewritten_query)

        compact_prompt = f"""
        You are ATHENA, an adaptive AI tutor.
        Student level: {current_level}
        Subject: {subject if subject else "General"}
        Question type: {question_type}

        Style instruction:
        {answer_style}

        Use ONLY the provided Study Context. If context is insufficient, say so briefly.
        Start response with: Topic: [Subject > Sub-topic]

        For simple questions:
        - no diagram and no quiz unless the student explicitly asks for a diagram/graph/image

        For definition questions:
        - include one beginner-friendly Mermaid diagram
        - no quiz
        - keep explanation concise

        For problem/complex questions:
        - include concise step-by-step explanation
        - include one Mermaid concept map
        - include a 3-question quiz block using EXACT format below

        ---QUIZ---
        Q1: [Question text]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer1: [A, B, or C]

        Q2: [Question text]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer2: [A, B, or C]

        Q3: [Question text]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer3: [A, B, or C]
        ---ENDQUIZ---

        Diagram complexity policy:
        {diagram_guidance}

        {teaching_enhancements}

        FORMULA RULES:
        - ONLY include a formula if the student explicitly asks for one (mentions 'formula', 'equation', 'derive').
        - When asked: present in LaTeX $$ ... $$, explain each symbol, show a worked example.
        - Never auto-include formulas.

        CHART RULES:
        - Scatter/regression: {{"type":"scatter","title":"...","xLabel":"...","yLabel":"...","regression":true,"data":[{{"x":number,"y":number}}]}}
        - Bar/line/pie: {{"type":"bar|line|pie","title":"...","xLabel":"...","yLabel":"...","data":[{{"x":"Category","y":number}}]}}
        - Use scatter for data distributions and regression lines, line for trends, bar for comparisons.
        - Only include a chart when student asks for graph/visualization or real numbers are in context.
        - Max 8 data points. Do NOT invent numbers.

        Additional instruction:
        - If the student asks for a graph/diagram/image, you MUST include one Mermaid diagram.
        - Any Mermaid diagram must use domain-specific labels from the question/context.
        - Never use placeholder nodes like A, B, C, Node1, Start, End.
        - Return ONLY ONE mermaid code block.
        - Do not write the word 'mermaid' outside a fenced code block.
        - Do not nest ``` blocks.
        - Keep all diagram lines inside the same mermaid block.

        Student Question:
        {query}

        Study Context:
        {compressed_context}
        """

        result = self.llm.invoke(compact_prompt)
        answer = getattr(result, "content", str(result))
        sources = selected_docs

        # Extract topic from model response
        answer, topic = self._extract_topic(answer)
        off_topic = self._is_off_topic(topic, answer)

        # Enforce rich curriculum format only for higher-complexity questions.
        requires_rich_format = question_type in {"complex", "problem"}
        if requires_rich_format and not off_topic and (not self._has_visual(answer) or not self._has_quiz(answer)):
            repaired_answer = self._enforce_on_topic_format(query, answer, current_level, subject)
            repaired_answer, repaired_topic = self._extract_topic(repaired_answer)
            answer = repaired_answer
            topic = repaired_topic or topic
            off_topic = self._is_off_topic(topic, answer)

        if not requires_rich_format:
            answer = self._trim_answer_for_type(answer, question_type)

        # Hallucination prevention gate for on-topic responses.
        if not off_topic and compressed_context:
            is_valid = self._validate_answer(query, answer, compressed_context)
            if not is_valid:
                answer = (
                    "I want to stay accurate to your syllabus material, but I cannot fully verify the previous draft "
                    "from the available context. Please upload/add more notes for this topic or ask a narrower question."
                )

        # Only add sources for on-topic responses
        if sources and not off_topic:
            source_paths = []
            for doc in sources:
                src = doc.metadata.get("source")
                if src:
                    source_paths.append(Path(src).stem)
            if source_paths:
                answer = f"{answer}\n\nSources:\n" + "\n".join(sorted(set(source_paths)))

        # Format mermaid diagram to ensure proper markdown code fence
        answer = self._format_mermaid_diagram(answer)
        answer = self._ensure_query_relevant_graph(
            answer,
            query,
            subject=subject,
            context_text=compressed_context,
            question_type=question_type,
            current_level=current_level,
        )

        # Definition questions should include a small tutor-friendly diagram.
        if question_type == "definition" and not graph_requested and not self._has_visual(answer):
            answer = (
                f"{answer}\n\n" + self._generate_visual_only(
                    query,
                    subject=subject,
                    context_text=compressed_context,
                    question_type=question_type,
                    current_level=current_level,
                )
            ).strip()

        if graph_requested and not self._has_visual(answer):
            answer = (
                f"{answer}\n\n" + self._generate_visual_only(
                    query,
                    subject=subject,
                    context_text=compressed_context,
                    question_type=question_type,
                    current_level=current_level,
                )
            ).strip()

        return answer, topic

    def stream_response(self, query, current_level="Beginner", user_id="global", subject=None, proficiency_score=0.0, weak_topics=None, current_topic=None):
        """Yield streamed answer chunks followed by a final metadata event."""
        small_talk = self._handle_small_talk(query, current_topic=current_topic)
        if small_talk:
            response_text, topic_label = small_talk
            yield {"type": "chunk", "content": response_text}
            yield {"type": "done", "topic": topic_label, "final_response": response_text}
            return

        if self._vector_db_is_empty():
            yield {"type": "error", "error": "The knowledge base is empty. Please ensure data is loaded."}
            return

        if not self._is_query_relevant_to_topic(query, current_topic, subject=subject):
            topic_label = (current_topic or "General").strip() or "General"
            blocked = "it is out of the topic so i don't know"
            yield {"type": "chunk", "content": blocked}
            yield {"type": "done", "topic": topic_label, "final_response": blocked}
            return

        visual_intent = self._detect_visual_intent(query)
        graph_requested = self._is_image_request(query)
        if visual_intent == "VISUAL_ONLY" and graph_requested:
            rewritten_query = self.rewrite_query(query)
            selected_docs, compressed_context = self._run_agentic_retrieval(query, rewritten_query)
            visual_answer = self._generate_visual_only(
                query,
                subject=subject,
                context_text=compressed_context,
                question_type="definition",
                current_level=current_level,
            )
            yield {"type": "chunk", "content": visual_answer}
            yield {"type": "done", "topic": "Visual", "final_response": visual_answer}
            return

        question_type = self._detect_question_type(query)
        answer_style = self._get_answer_style(question_type)
        diagram_guidance = self._get_diagram_guidance(question_type, current_level)
        teaching_enhancements = self._get_teaching_enhancements(question_type)
        rewritten_query = self.rewrite_query(query)
        selected_docs, compressed_context = self._run_agentic_retrieval(query, rewritten_query)

        compact_prompt = f"""
        You are ATHENA, an adaptive AI tutor.
        Student level: {current_level}
        Subject: {subject if subject else "General"}
        Question type: {question_type}

        Style instruction:
        {answer_style}

        Use ONLY the provided Study Context. If context is insufficient, say so briefly.
        Start response with: Topic: [Subject > Sub-topic]

        For simple questions:
        - no diagram and no quiz unless the student explicitly asks for a diagram/graph/image

        For definition questions:
        - include one beginner-friendly Mermaid diagram
        - no quiz
        - keep explanation concise

        For problem/complex questions:
        - include concise step-by-step explanation
        - include one Mermaid concept map
        - include a 3-question quiz block using EXACT format below

        ---QUIZ---
        Q1: [Question text]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer1: [A, B, or C]

        Q2: [Question text]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer2: [A, B, or C]

        Q3: [Question text]
        A) [Option]
        B) [Option]
        C) [Option]
        Answer3: [A, B, or C]
        ---ENDQUIZ---

        Diagram complexity policy:
        {diagram_guidance}

        {teaching_enhancements}

        FORMULA RULES:
        - ONLY include a formula if the student explicitly asks for one (mentions 'formula', 'equation', 'derive').
        - When asked: present in LaTeX $$ ... $$, explain each symbol, show a worked example.
        - Never auto-include formulas.

        CHART RULES:
        - Scatter/regression: {{"type":"scatter","title":"...","xLabel":"...","yLabel":"...","regression":true,"data":[{{"x":number,"y":number}}]}}
        - Bar/line/pie: {{"type":"bar|line|pie","title":"...","xLabel":"...","yLabel":"...","data":[{{"x":"Category","y":number}}]}}
        - Use scatter for data distributions and regression lines, line for trends, bar for comparisons.
        - Only include a chart when student asks for graph/visualization or real numbers are in context.
        - Max 8 data points. Do NOT invent numbers.

        Additional instruction:
        - If the student asks for a graph/diagram/image, you MUST include one Mermaid diagram.
        - Any Mermaid diagram must use domain-specific labels from the question/context.
        - Never use placeholder nodes like A, B, C, Node1, Start, End.
        - Return ONLY ONE mermaid code block.
        - Do not write the word 'mermaid' outside a fenced code block.
        - Do not nest ``` blocks.
        - Keep all diagram lines inside the same mermaid block.

        Student Question:
        {query}

        Study Context:
        {compressed_context}
        """

        full_answer = ""
        try:
            for chunk in self.llm.stream(compact_prompt):
                token = getattr(chunk, "content", "")
                if not token:
                    continue
                full_answer += token
                yield {"type": "chunk", "content": token}

            final_response, topic = self._extract_topic(full_answer)
            if question_type in {"simple", "definition"}:
                final_response = self._trim_answer_for_type(final_response, question_type)
            final_response = self._format_mermaid_diagram(final_response)
            final_response = self._ensure_query_relevant_graph(
                final_response,
                query,
                subject=subject,
                context_text=compressed_context,
                question_type=question_type,
                current_level=current_level,
            )

            if question_type == "definition" and not graph_requested and not self._has_visual(final_response):
                final_response = (
                    f"{final_response}\n\n" + self._generate_visual_only(
                        query,
                        subject=subject,
                        context_text=compressed_context,
                        question_type=question_type,
                        current_level=current_level,
                    )
                ).strip()

            if graph_requested and not self._has_visual(final_response):
                final_response = (
                    f"{final_response}\n\n" + self._generate_visual_only(
                        query,
                        subject=subject,
                        context_text=compressed_context,
                        question_type=question_type,
                        current_level=current_level,
                    )
                ).strip()

            yield {
                "type": "done",
                "topic": topic or "General",
                "final_response": final_response,
            }
        except Exception as e:
            yield {"type": "error", "error": str(e)}

    def load_subject(self, subject_name):
        # Index on demand if needed
        data_dir = self.data_dir / subject_name
        if not data_dir.exists():
            return f"Subject {subject_name} not found."

        if not self._vector_db_is_empty():
            return f"Subject {subject_name} ready. Using existing index."

        from langchain_community.document_loaders import DirectoryLoader
        pdf_loader = DirectoryLoader(str(data_dir), glob="./*.pdf", loader_cls=PyPDFLoader)
        txt_loader = DirectoryLoader(str(data_dir), glob="./*.txt", loader_cls=TextLoader)
        
        documents = []
        try:
            documents.extend(pdf_loader.load())
            documents.extend(txt_loader.load())
            for doc in documents:
                doc.metadata["subject"] = subject_name
        except Exception as e:
            print(f"Error loading {subject_name}: {e}")

        if not documents:
            return f"No documents found in {subject_name}."

        self._update_curriculum_graph_from_documents(subject_name, documents)

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=80)
        chunks = text_splitter.split_documents(documents)

        self.vector_db.add_documents(chunks)
        self._persist_if_supported()
        return f"Subject {subject_name} indexed."

    def load_document(self, file_path, subject=None):
        if file_path.endswith('.pdf'):
            loader = PyPDFLoader(file_path)
        else:
            loader = TextLoader(file_path)
            
        documents = loader.load()
        doc_subject = subject or "General"
        for doc in documents:
            doc.metadata["subject"] = doc_subject

        self._update_curriculum_graph_from_documents(doc_subject, documents)

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=80)
        chunks = text_splitter.split_documents(documents)

        for chunk in tqdm(chunks, desc="Indexing chunks", unit="chunk"):
            self.vector_db.add_documents([chunk])
        self._persist_if_supported()
        return "Document indexed."






    def update_learning_level(self, quiz_results, current_score=0.0):
        """
        Optimized Learning Rate: Adapts the level using a weighted rolling window.
        current_score: Previous proficiency EMA from database.
        """
        correct = quiz_results.get('correct', 0)
        total = quiz_results.get('total', 1)
        
        # Recent performance weight (Exponential Moving Average)
        current_perf = correct / total if total > 0 else 0
        
        # learning_rate determines how fast the system adapts (0.0 to 1.0)
        learning_rate = 0.4 
        
        # Update proficiency score using EMA
        new_score = (current_score * (1 - learning_rate)) + (current_perf * learning_rate)
        
        # Thresholds for level transitions
        if new_score >= 0.75:
            level = "Advanced"
        elif new_score >= 0.4:
            level = "Intermediate"
        else:
            level = "Beginner"
            
        return level, new_score
    # ── Tutor Engine ─────────────────────────────────────────────────────────

    def _get_teaching_style(self, difficulty):
        if difficulty == 'easy':
            return (
                "Use very simple language suitable for beginners.\n"
                "Explain in 3-5 sentences.\n"
                "Give one concrete real-world example."
            )
        if difficulty == 'medium':
            return (
                "Provide a clear explanation with context.\n"
                "Add one worked example.\n"
                "Include a Mermaid concept diagram if the topic is architectural or process-based."
            )
        return (
            "Provide a thorough technical explanation.\n"
            "Include a Python code example demonstrating the concept.\n"
            "Add a Mermaid architecture or flow diagram.\n"
            "Give one real-world application."
        )

    def generate_curriculum(self, subject, context_text=""):
        import json as _json
        import re as _re
        if not context_text:
            try:
                docs = self.vector_db.similarity_search(
                    f"{subject} overview curriculum topics", k=5
                )
                context_text = "\n".join(d.page_content[:300] for d in docs)
            except Exception:
                pass

        prompt = f"""You are an expert curriculum designer. Create a structured learning curriculum.

Subject: {subject}

Study material overview:
{context_text[:2000] if context_text else f"Use standard {subject} curriculum content."}

Return ONLY a valid JSON object (no markdown fences, no extra text):
{{
  "subject": "{subject}",
  "modules": [
    {{
      "name": "Module Name",
      "topics": [
        {{"name": "Topic Name", "difficulty": "easy"}},
        {{"name": "Topic Name", "difficulty": "medium"}}
      ]
    }}
  ]
}}

Rules:
- Create 3-5 modules with 3-5 topics each.
- Progress from easy to medium to hard within each module.
- Topics must be specific (e.g. "Linear Regression" not "ML algorithms").
- difficulty must be exactly one of: easy, medium, hard.
- Return ONLY valid JSON, nothing else."""

        result = self.llm.invoke(prompt)
        content = getattr(result, 'content', str(result)).strip()
        json_match = _re.search(r'\{.*\}', content, _re.DOTALL)
        if json_match:
            return _json.loads(json_match.group())
        return _json.loads(content)

    def teach_topic(self, topic_name, difficulty='medium', subject=None, context_text="", level="Beginner", simplify=False):
        if simplify:
            difficulty = 'easy'
        teaching_style = self._get_teaching_style(difficulty)
        code_hint = (
            "**Python Code Example** (only if directly illustrative of this concept)\n"
            "```python\n# Show the concept in code\n```\n\n"
        ) if difficulty == 'hard' else ''
        diagram_hint = (
            "**Concept Diagram**\n"
            "[Add a Mermaid diagram (graph TD) if this is a process, pipeline, or architecture topic]\n\n"
        ) if difficulty in ('medium', 'hard') else ''
        chart_hint = (
            "**Data Chart** (ONLY if real numerical data is present in context — never invent numbers)\n"
            "Scatter/regression: {\"type\":\"scatter\",\"title\":\"...\",\"xLabel\":\"...\",\"yLabel\":\"...\",\"regression\":true,\"data\":[{\"x\":number,\"y\":number}]}\n"
            "Bar/line/pie: {\"type\":\"bar|line|pie\",\"title\":\"...\",\"xLabel\":\"...\",\"yLabel\":\"...\",\"data\":[{\"x\":\"Label\",\"y\":number}]}\n\n"
        ) if difficulty in ('medium', 'hard') else ''
        simplify_note = "\n\u26a0\ufe0f SIMPLIFY MODE: Re-explain this topic more simply. Use analogies, fewer technical terms, very clear step-by-step breakdown." if simplify else ''
        num_practice = 2 if difficulty == 'easy' else 3
        extra_practice = "\n3. [Applied or analytical question]" if num_practice >= 3 else ''

        prompt = f"""You are ATHENA, an expert AI tutor. Teach the following topic clearly and in depth.

Topic: {topic_name}
Difficulty: {difficulty}
Student Level: {level}
Subject: {subject or 'General'}{simplify_note}

Teaching Instructions:
{teaching_style}

Structure your lesson with these Markdown sections:

## {topic_name}

**Concept Explanation**
[Clear, focused explanation here]

{code_hint}{diagram_hint}{chart_hint}**Real-World Example**
[One concrete, relatable application]

---PRACTICE---
1. [Conceptual question specific to this topic]
2. [Example-based question]{extra_practice}
---ENDPRACTICE---

Study material context (use for correct terminology and any real numbers):
{context_text[:1500] if context_text else f"Use your knowledge of {subject or topic_name}."}

Important rules:
- Stay strictly focused on "{topic_name}". Do not digress.
- Match explanation depth to a {level} student.
- FORMULAS: Only include if the topic inherently requires one (e.g. statistics/maths). Use LaTeX $$...$$ and explain every symbol.
- Code must be Python only.
- Diagrams must use valid Mermaid syntax: graph TD with --> arrows only.
- Chart JSON must use the exact schema above. Do NOT invent data — only use real numbers from context.
- IMPORTANT: Practice questions MUST be placed between ---PRACTICE--- and ---ENDPRACTICE--- markers."""

        result = self.llm.invoke(prompt)
        return getattr(result, 'content', str(result)).strip()

    def generate_topic_quiz(self, topic_name, difficulty='medium', subject=None, context_text="", level="Beginner", is_retry=False):
        """Generate a short 3-question multiple-choice quiz for a topic lesson."""
        num_q = 2 if difficulty == 'easy' else 3
        q3_block = ""
        if num_q >= 3:
            q3_block = """
Q3: [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
Answer3: [A, B, or C]"""
        context_str = context_text[:1000] if context_text else f"Use your knowledge of {subject or topic_name}."
        retry_note = "\nNote: This is a SECOND ATTEMPT quiz. Generate DIFFERENT questions from the first attempt, focusing on the most fundamental concepts. Keep difficulty accessible for a {level} student.".format(level=level) if is_retry else ''
        prompt = f"""You are ATHENA, an expert AI tutor. Generate a short quiz about the topic below.

Topic: {topic_name}
Difficulty: {difficulty}
Student Level: {level}
Subject: {subject or 'General'}{retry_note}

Generate exactly {num_q} multiple-choice questions to test understanding of this topic.

Use ONLY this exact format:

---QUIZ---
Q1: [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
Answer1: [A, B, or C]

Q2: [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
Answer2: [A, B, or C]{q3_block}
---ENDQUIZ---

Rules:
- Questions must directly test knowledge of "{topic_name}".
- Options must be plausible — not trivially obvious.
- Each question must have exactly one correct answer.
- Stay strictly within the quiz format — no extra text outside the block.

Study context:
{context_str}"""

        result = self.llm.invoke(prompt)
        return getattr(result, 'content', str(result)).strip()

    def generate_module_quiz(self, module_name, topic_names, subject=None, context_text="", level="Beginner"):
        """Generate a mixed quiz: 3 multiple-choice + 2 open-ended, covering all topics in the module."""
        topics_list = ", ".join(topic_names) if topic_names else module_name
        prompt = f"""You are ATHENA, an expert AI tutor. Generate a comprehensive module quiz.

Module: {module_name}
Topics covered: {topics_list}
Subject: {subject or 'General'}
Student Level: {level}

Generate a MIXED quiz with:
- 3 multiple-choice questions (testing factual/conceptual knowledge)
- 2 open-ended questions (requiring short written answers)

Use EXACTLY this format:

---QUIZ---
Q1: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer1: [A, B, or C]

Q2: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer2: [A, B, or C]

Q3: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer3: [A, B, or C]

Q4: [Open-ended question requiring a short written answer]
OPEN_ENDED4
SampleAnswer4: [A concise model answer in 1-3 sentences]

Q5: [Open-ended question requiring a short written answer]
OPEN_ENDED5
SampleAnswer5: [A concise model answer in 1-3 sentences]
---ENDQUIZ---

Rules:
- Each question must cover a DIFFERENT topic from the module.
- MC options must be plausible, not trivially obvious.
- Open-ended questions should require understanding, not mere recall.
- Do NOT add any text outside the ---QUIZ--- block.

Study context:
{context_text[:1500] if context_text else f"Use your knowledge of {subject or module_name}."}"""

        result = self.llm.invoke(prompt)
        return getattr(result, 'content', str(result)).strip()

    def generate_final_test(self, subject, module_names, level="Beginner", context_text=""):
        """Generate a final subject test: 5 MC + 3 open-ended covering all modules."""
        modules_list = ", ".join(module_names) if module_names else subject
        prompt = f"""You are ATHENA, an expert AI tutor. Generate a comprehensive final subject test.

Subject: {subject}
Modules covered: {modules_list}
Student Level: {level}

Generate a COMPREHENSIVE final test with:
- 5 multiple-choice questions (testing broad knowledge across modules)
- 3 open-ended questions (requiring detailed written answers)

Use EXACTLY this format:

---QUIZ---
Q1: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer1: [A, B, or C]

Q2: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer2: [A, B, or C]

Q3: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer3: [A, B, or C]

Q4: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer4: [A, B, or C]

Q5: [Multiple-choice question]
A) [Option]
B) [Option]
C) [Option]
Answer5: [A, B, or C]

Q6: [Open-ended question — conceptual]
OPEN_ENDED6
SampleAnswer6: [Model answer in 2-4 sentences]

Q7: [Open-ended question — applied]
OPEN_ENDED7
SampleAnswer7: [Model answer in 2-4 sentences]

Q8: [Open-ended question — analytical or comparative]
OPEN_ENDED8
SampleAnswer8: [Model answer in 2-4 sentences]
---ENDQUIZ---

Rules:
- Each question MUST reference a different module or concept.
- MC distractors must be plausible.
- Open-ended questions require synthesis across multiple topics.
- No text outside the ---QUIZ--- block.

Study context:
{context_text[:2000] if context_text else f"Use your knowledge of {subject}."}"""

        result = self.llm.invoke(prompt)
        return getattr(result, 'content', str(result)).strip()