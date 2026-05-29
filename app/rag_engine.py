import os

import sys

import json

import asyncio

import traceback

import sqlite3

# --- SQLite Performance Monkey Patch ---
_original_connect = sqlite3.connect

def _patched_connect(*args, **kwargs):
    conn = _original_connect(*args, **kwargs)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode;")
        row = cursor.fetchone()
        if row and row[0].lower() != 'wal':
            cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA cache_size=-64000;")
        cursor.execute("PRAGMA temp_store=MEMORY;")
        cursor.execute("PRAGMA mmap_size=2147483648;")
        cursor.close()
        conn.commit()
    except Exception as e:
        print(f"Warning: Failed to set SQLite PRAGMAs: {e}")
    return conn

sqlite3.connect = _patched_connect
# ---------------------------------------

from pathlib import Path

from dotenv import load_dotenv



# Load environment variables

load_dotenv()



# Set up paths

PROJECT_ROOT = Path(__file__).parent.parent

DOCS_DIR = PROJECT_ROOT / "docs"

TREES_DIR = PROJECT_ROOT / "trees"

DB_PATH = PROJECT_ROOT / "search_index.db"



# Patch for Windows asyncio ProactorEventLoop RuntimeError during cleanup

if sys.platform == 'win32':

    from functools import wraps

    from asyncio.proactor_events import _ProactorBasePipeTransport

    

    def silence_event_loop_closed(func):

        @wraps(func)

        def wrapper(self, *args, **kwargs):

            try:

                return func(self, *args, **kwargs)

            except RuntimeError as e:

                if str(e) != 'Event loop is closed':

                    raise

        return wrapper

        

    _ProactorBasePipeTransport.__del__ = silence_event_loop_closed(_ProactorBasePipeTransport.__del__)



DOCS_DIR.mkdir(exist_ok=True)

TREES_DIR.mkdir(exist_ok=True)



# Initialize SQLite FTS5 Database and User/Auth Tables

def init_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    cursor = conn.cursor()
    
    # Enable Write-Ahead Logging (WAL) for highly concurrent read/write access
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    
    # Advanced Performance Tuning
    cursor.execute("PRAGMA cache_size=-64000;") # 64MB RAM Cache (Default is usually just 2MB)
    cursor.execute("PRAGMA temp_store=MEMORY;") # Store temporary indices/tables in RAM, saving disk I/O
    cursor.execute("PRAGMA mmap_size=2147483648;") # 2GB Memory-Mapped I/O for extremely fast reads

    cursor.execute("""

        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(

            doc_id, 

            node_id, 

            title, 

            text_content,

            page_num UNINDEXED,

            tokenize='trigram'

        )

    """)

    

    # Organization Table

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS organizations (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT UNIQUE NOT NULL,

            parent_id INTEGER DEFAULT NULL REFERENCES organizations(id)

        )

    """)

    

    # User Table

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS users (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            username TEXT UNIQUE NOT NULL,

            full_name TEXT,

            password_hash TEXT NOT NULL,

            role TEXT NOT NULL DEFAULT 'user',

            organization_id INTEGER,

            is_active BOOLEAN DEFAULT 1,

            FOREIGN KEY(organization_id) REFERENCES organizations(id)

        )

    """)

    

    # Chat History Table

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS chat_history (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            session_id TEXT NOT NULL,

            user_id INTEGER NOT NULL,

            role TEXT NOT NULL,

            content TEXT NOT NULL,

            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(user_id) REFERENCES users(id)

        )

    """)



    # Chat Sessions Table (session metadata)

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS chat_sessions (

            id TEXT PRIMARY KEY,

            user_id INTEGER NOT NULL,
            title TEXT DEFAULT '새 대화',

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            is_pinned BOOLEAN DEFAULT FALSE,

            FOREIGN KEY(user_id) REFERENCES users(id)

        )

    """)

    try:
        cursor.execute("ALTER TABLE chat_sessions ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE")
    except sqlite3.OperationalError:
        pass # Column already exists





    # Categories (Folders) Table - hierarchical folder structure

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS categories (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            parent_id INTEGER DEFAULT NULL REFERENCES categories(id),

            owner_id INTEGER DEFAULT NULL REFERENCES users(id),

            visibility TEXT DEFAULT 'private',

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP

        )

    """)

    try:

        cursor.execute("ALTER TABLE categories ADD COLUMN visibility TEXT DEFAULT 'private'")

    except sqlite3.OperationalError:

        pass # Column already exists



    try:

        cursor.execute("ALTER TABLE users ADD COLUMN profile_image TEXT DEFAULT NULL")

    except sqlite3.OperationalError:

        pass # Column already exists

    # Ensure 'General' root category exists

    cursor.execute("INSERT OR IGNORE INTO categories (id, name, parent_id, visibility) VALUES (1, 'General', NULL, 'private')")



    # Chat Agents Table

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS chat_agents (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            description TEXT,

            system_prompt TEXT NOT NULL,

            python_code TEXT,

            requires_file_upload BOOLEAN DEFAULT 0,

            agent_type TEXT DEFAULT 'RAG',

            config TEXT,

            is_active BOOLEAN DEFAULT 0,

            user_id INTEGER NOT NULL,

            organization_id INTEGER,

            share_scope TEXT DEFAULT 'PRIVATE',

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(user_id) REFERENCES users(id),

            FOREIGN KEY(organization_id) REFERENCES organizations(id)

        )

    """)



    # Token Usage Table

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS token_usage (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            model_name TEXT NOT NULL,

            prompt_tokens INTEGER DEFAULT 0,

            completion_tokens INTEGER DEFAULT 0,

            total_tokens INTEGER DEFAULT 0,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(user_id) REFERENCES users(id)

        )

    """)

    # System Settings Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL
        )
    """)

    # Web Crawling Cache Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS web_crawl_cache (
            doc_id TEXT NOT NULL,
            url TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (doc_id, url)
        )
    """)

    

    # Model Pricing Configuration Table

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS model_pricing (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            model_name TEXT UNIQUE NOT NULL,

            cost_per_1m_prompt REAL DEFAULT 0.0,

            cost_per_1m_completion REAL DEFAULT 0.0

        )

    """)

    

    cursor.execute("INSERT OR IGNORE INTO model_pricing (model_name, cost_per_1m_prompt, cost_per_1m_completion) VALUES ('gemini-flash-lite-latest', 0.075, 0.3)")
    cursor.execute("INSERT OR IGNORE INTO model_pricing (model_name, cost_per_1m_prompt, cost_per_1m_completion) VALUES ('gemini-2.5-pro', 1.25, 5.0)")

    

    conn.commit()

    conn.close()



def seed_admin_user():

    from passlib.context import CryptContext

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    conn = sqlite3.connect(str(DB_PATH), timeout=30)

    cursor = conn.cursor()

    

    cursor.execute("SELECT id FROM organizations WHERE name = ?", ("Default Org",))

    org = cursor.fetchone()

    if not org:

        cursor.execute("INSERT INTO organizations (name) VALUES (?)", ("Default Org",))

        org_id = cursor.lastrowid

    else:

        org_id = org[0]

        

    cursor.execute("SELECT id FROM users WHERE username = ?", ("admin",))

    user = cursor.fetchone()

    if not user:

        hashed_pw = pwd_context.hash("xptmxm!8")

        cursor.execute("INSERT INTO users (username, password_hash, role, organization_id, is_active) VALUES (?, ?, ?, ?, ?)",

                       ("admin", hashed_pw, "admin", org_id, True))

    conn.commit()

    conn.close()



init_db()

seed_admin_user()



import sys
import json

def get_sys_setting(key: str, default=None):
    import time
    for attempt in range(5):
        try:
            conn = sqlite3.connect(str(DB_PATH), timeout=30)
            cursor = conn.cursor()
            cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = ?", (key,))
            row = cursor.fetchone()
            conn.close()
            if row:
                try:
                    return json.loads(row[0])
                except json.JSONDecodeError:
                    return row[0] # Return raw string if it's not JSON
            break
        except Exception as e:
            if attempt < 4:
                time.sleep(0.5)
            else:
                print(f"[DB Error] get_sys_setting failed for key '{key}': {e}", flush=True)
    return default

def set_sys_setting(key: str, value):
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=30)
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False



sys.path.append(str(PROJECT_ROOT))


from pageindex.utils import count_tokens, ChatGPT_API, ChatGPT_API_async, config, ChatGPT_API_async_stream



# Dictionary to hold the indexing status of documents

STATUS_FILE = PROJECT_ROOT / "status.json"



def load_status():

    if STATUS_FILE.exists():

        try:

            with open(STATUS_FILE, "r", encoding="utf-8") as f:

                return json.load(f)

        except Exception:

            pass

    return {}



import threading
_status_lock = threading.Lock()

def save_status():
    try:
        with _status_lock:
            with open(STATUS_FILE, "w", encoding="utf-8") as f:
                json.dump(document_status, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save status.json: {e}")

document_status = load_status()

# Zombie Process Cleanup: If server restarted while jobs were running,
# they will be stuck in a processing state forever. We must clear them.
_zombie_fixed = False
for doc_id, doc_info in document_status.items():
    if doc_info.get("status") in ["processing", "crawling", "pending"]:
        doc_info["status"] = "failed"
        doc_info["progress"] = "서버 재시작으로 인해 강제 종료됨 (중단)"
        _zombie_fixed = True
        
if _zombie_fixed:
    save_status()



cancelled_jobs = set()



class IndexingCancelledException(Exception):

    pass



async def _do_index_async(file_path: str, opt: dict, progress_callback=None):
    from pageindex.page_index import page_index_main_async
    return await page_index_main_async(file_path, opt, progress_callback=progress_callback)



async def index_pdf_async(file_path: str, doc_id: str):

    """

    Asynchronous function to process PDF using pageindex.

    Runs the heavy blocking page_index_main in a separate thread so the RAG chat remains responsive.

    """

    try:
        from pageindex.utils import current_user_id
        if doc_id in document_status and "owner_id" in document_status[doc_id]:
            current_user_id.set(document_status[doc_id]["owner_id"])

        if doc_id not in document_status:

            document_status[doc_id] = {}

        document_status[doc_id]["status"] = "indexing"

        document_status[doc_id]["progress"] = "시작 중..."

        

        # Configure opt (use standard model, page checks)

        # Configure opt (use standard model, page checks)
        index_model_cfg = get_sys_setting("index_llm_model", "gemini-flash-lite-latest")
        opt = config(
            model=index_model_cfg,
            toc_check_page_num=20,
            max_page_num_each_node=10,
            max_token_num_each_node=20000,
            if_add_node_id='yes',
            if_add_node_summary='yes',
            if_add_doc_description='no',
            if_add_node_text='yes' # Vital for RAG! We need the text extracted in the tree.
        )

        opt.is_cancelled = lambda: doc_id in cancelled_jobs

        

        # Define progress callback

        def progress_tracker(msg: str, percent: int):

            if doc_id in cancelled_jobs:

                raise IndexingCancelledException(f"Indexing job for {doc_id} was cancelled.")

            if doc_id in document_status:

                document_status[doc_id]["progress"] = msg

                document_status[doc_id]["progress_percent"] = percent

                # Note: We purposely do NOT call save_status() here 

                # to prevent disk I/O thrashing since this fires rapidly.



        document_status[doc_id]["progress"] = "문서 구조 파악 중..."

        document_status[doc_id]["progress_percent"] = 10

        # Process document completely asynchronously without exhausting the threadpool
        uid = document_status[doc_id].get("owner_id")
        from pageindex.utils import current_user_id
        if uid: current_user_id.set(uid)
        
        toc_with_content = await _do_index_async(file_path, opt, progress_tracker)

        

        # Save results

        output_file = TREES_DIR / f"{doc_id}_structure.json"

        with open(output_file, 'w', encoding='utf-8') as f:

            json.dump(toc_with_content, f, indent=2)

            

        # --- SQLite FTS5 Indexing ---

        document_status[doc_id]["progress"] = "문서 키워드 인덱스 생성 중..."

        

        async def _index_fts_async():
            import sqlite3
            import fitz
            from pageindex.utils import get_gemini_client, wait_for_llm_slot_async, release_llm_slot
            from google.genai import types

            def _db_init_and_insert_nodes():
                conn = sqlite3.connect(str(DB_PATH), timeout=30)
                cursor = conn.cursor()
                cursor.execute("DELETE FROM docs_fts WHERE doc_id = ?", (doc_id,))
                conn.commit()

                node_map = create_node_mapping_with_text(toc_with_content)
                for nid, node_data in node_map.items():
                    if doc_id in cancelled_jobs:
                        conn.close()
                        raise IndexingCancelledException(f"Indexing job for {doc_id} was cancelled.")
                    title = node_data.get("title", "")
                    text_content = ""
                    if "text" in node_data:
                        if isinstance(node_data["text"], list):
                            text_content = "\n".join(node_data["text"])
                        else:
                            text_content = str(node_data["text"])
                    if text_content.strip():
                        page_num = str(node_data.get('start_index', 'Unknown'))
                        cursor.execute(
                            "INSERT INTO docs_fts (doc_id, node_id, title, text_content, page_num) VALUES (?, ?, ?, ?, ?)",
                            (doc_id, nid, title, text_content, page_num)
                        )
                conn.commit()
                conn.close()

            await asyncio.to_thread(_db_init_and_insert_nodes)

            try:
                pdf_doc = await asyncio.to_thread(fitz.open, file_path)
                ocr_client = None
                
                # Use opendataloader for text extraction
                from pageindex.utils import extract_pdf_texts_opendataloader
                opendataloader_texts = await asyncio.to_thread(extract_pdf_texts_opendataloader, file_path)
                
                for page_num_idx in range(len(pdf_doc)):
                    if doc_id in cancelled_jobs:
                        pdf_doc.close()
                        raise IndexingCancelledException(f"Indexing job for {doc_id} was cancelled.")

                    page_text = opendataloader_texts.get(page_num_idx, "")
                    page_text = page_text.strip()

                    # OCR Fallback for scanned/image PDFs
                    if not page_text:
                        try:
                            pix = await asyncio.to_thread(pdf_doc[page_num_idx].get_pixmap, dpi=150)
                            img_bytes = pix.tobytes("png")
                            if ocr_client is None:
                                ocr_client = get_gemini_client()
                            prompt_text = "Please extract all the text from this document image accurately. Preserve the original language and formatting as much as possible. Do not include any explanations. If there is no text, return empty."
                            message_parts = [
                                types.Part.from_text(text=prompt_text),
                                types.Part.from_bytes(data=img_bytes, mime_type="image/png")
                            ]

                            max_retries = 3
                            for attempt in range(max_retries):
                                try:
                                    await wait_for_llm_slot_async()
                                    try:
                                        response = await ocr_client.aio.models.generate_content(
                                            model='gemini-flash-lite-latest',
                                            contents=message_parts
                                        )
                                        page_text = response.text.strip()
                                        break
                                    finally:
                                        release_llm_slot()
                                except Exception as inner_e:
                                    if attempt < max_retries - 1:
                                        print(f"[FTS Indexing OCR Fallback] Retry {attempt+1}/{max_retries} due to {inner_e}")
                                        import random
                                        await asyncio.sleep(min((2 ** attempt) + random.uniform(0, 1), 20))
                                    else:
                                        raise inner_e

                        except Exception as e:
                            print(f"[FTS Indexing OCR Fallback] Failed text extraction on page {page_num_idx + 1}: {e}")

                    if page_text:
                        def _db_insert_raw():
                            conn = sqlite3.connect(str(DB_PATH), timeout=30)
                            cursor = conn.cursor()
                            raw_nid = f"raw_page_{page_num_idx + 1}"
                            raw_title = f"본문 참조 페이지 {page_num_idx + 1}"
                            page_text_with_tag = f"\n[실제 문서 페이지: {page_num_idx + 1}]\n" + page_text
                            cursor.execute(
                                "INSERT INTO docs_fts (doc_id, node_id, title, text_content, page_num) VALUES (?, ?, ?, ?, ?)",
                                (doc_id, raw_nid, raw_title, page_text_with_tag, str(page_num_idx + 1))
                            )
                            conn.commit()
                            conn.close()
                        await asyncio.to_thread(_db_insert_raw)

                pdf_doc.close()
            except Exception as e:
                print(f"[FTS Indexing] Failed to extract raw text: {e}")
            finally:
                if 'ocr_client' in locals() and ocr_client:
                    try:
                        await ocr_client.aio.aclose()
                    except Exception:
                        pass
                    try:
                        ocr_client.close()
                    except Exception:
                        pass

        await _index_fts_async()

            

        document_status[doc_id]["progress"] = "문서 메타데이터 분석 중..."

        

        # Generate 1-sentence description for the entire document for pre-filtering

        tree_summary_for_desc = remove_fields(toc_with_content.copy(), fields=['text'])

        desc_prompt = f"""

        You are given a table of contents structure of a document. 

        Your task is to generate a single-sentence description for the document that makes it easy to distinguish from other documents. 

        Document tree structure: 

        {json.dumps(tree_summary_for_desc)}

        

        Directly return the single sentence description, do not include any other text.

        """

        if doc_id in cancelled_jobs: raise IndexingCancelledException("Cancelled")
        try:

            doc_desc = await asyncio.to_thread(ChatGPT_API, model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=desc_prompt)

            document_status[doc_id]["doc_description"] = doc_desc.strip()

        except Exception as e:

            print(f"Error generating description for {doc_id}: {str(e)}")

            document_status[doc_id]["doc_description"] = "No description available."

        

        document_status[doc_id]["status"] = "ready"

        document_status[doc_id]["progress"] = "완료"

        document_status[doc_id]["progress_percent"] = 100

        save_status()

        

    except IndexingCancelledException as e:

        print(f"Indexing cancelled for {doc_id}.")

        if doc_id in document_status:
            document_status[doc_id]["status"] = "failed"
            document_status[doc_id]["error"] = "사용자에 의해 인덱싱이 중단되었습니다."
            save_status()

    except Exception as e:

        if str(e) == "Indexing cancelled by user":

            print(f"Indexing cancelled for {doc_id}.")

            if doc_id in document_status:
                document_status[doc_id]["status"] = "failed"
                document_status[doc_id]["error"] = "사용자에 의해 인덱싱이 중단되었습니다."
                save_status()

        else:

            error_details = f"{str(e)}\n{traceback.format_exc()}"

            print(f"Error indexing PDF {doc_id}: {error_details}")

            if doc_id not in document_status:

                document_status[doc_id] = {}

            document_status[doc_id]["status"] = "failed"

            document_status[doc_id]["error"] = error_details

            save_status()



async def chat_inferential(query: str, active_docs: list[str]):

    """

    Orchestrates the vectorless reasoning RAG across multiple document trees.

    """

    relevant_context = []

    # 0. INTENT ROUTING PHASE
    intent_prompt = f"""
    Analyze the following user question and classify it into exactly ONE of these three categories:
    1. "GREETING": Simple greetings, casual chit-chat, expressing gratitude, asking about the AI's identity or condition. (e.g. "안녕", "고마워", "넌 누구니?")
    2. "ASK_DOCUMENTS": Asking to list, show, check, or summarize WHAT documents or files are currently uploaded/available in the system. (e.g. "업로드된 문서 뭐 있어?", "문서 목록 보여줘", "어떤 파일들이 있니?")
    3. "RAG_SEARCH": Any regular question that requires looking up information, analyzing data, or answering based on document content.

    Return ONLY the category name. Do not explain.
    
    User Question: {query}
    """
    
    chat_model_cfg = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")
    try:
        intent_result = await ChatGPT_API_async(model=chat_model_cfg, prompt=intent_prompt)
        intent = intent_result.strip().upper()
        
        if "ASK_DOCUMENTS" in intent:
            return "보안상의 이유로 현재 업로드된 전체 문서 목록이나 파일 정보는 제공할 수 없습니다. 특정 주제나 내용에 대해 질문해 주시면 관련된 문서를 검색하여 답변해 드리겠습니다."
            
        elif "GREETING" in intent:
            casual_prompt = f"""
            You are a helpful and polite AI assistant. The user just said something casual or a greeting.
            Respond to them naturally and kindly in Korean (한국어).
            Keep it relatively short.
            
            User: {query}
            """
            casual_response = await ChatGPT_API_async(model=chat_model_cfg, prompt=casual_prompt)
            return casual_response
            
    except Exception as e:
        print(f"[Intent Router] Error: {e}")

    
    # 1. PRE-FILTERING PHASE

    if not active_docs:

        return "No documents available to search."

        

    # Optimization: Skip pre-filtering if only 1 document is selected.

    if len(active_docs) == 1:

        print("[Pre-Filter] Only 1 document active, skipping pre-filter LLM call.", flush=True)

        final_active_docs = active_docs

    else:

        doc_catalog = []

        for doc_id in active_docs:

            desc = document_status.get(doc_id, {}).get("doc_description", "No description available.")

            name = document_status.get(doc_id, {}).get("name", "Unknown Document")

            doc_catalog.append({"doc_id": doc_id, "doc_name": name, "doc_description": desc})

            

        prefilter_prompt = f"""

        You are given a list of documents with their IDs, file names, and descriptions. 

        Your task is to select documents that may contain information relevant to answering the user query. 

        

        Query: {query} 

        

        Documents: 

        {json.dumps(doc_catalog, indent=2)}

        

        Response Format: 

        {{ 

            "thinking": "<Your reasoning for document selection>", 

            "answer": ["doc_id1", "doc_id2"] 

        }} 

        

        Return [] for "answer" if no documents are relevant.

        Return only the JSON structure, with no additional output.

        """

        

        filtered_doc_ids = active_docs # fallback

        try:
            chat_model_cfg = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")
            prefilter_result_str = await ChatGPT_API_async(model=chat_model_cfg, prompt=prefilter_prompt)
            prefilter_result_str = prefilter_result_str.strip()

            if prefilter_result_str.startswith("```json"):

                prefilter_result_str = prefilter_result_str[7:-3]

            elif prefilter_result_str.startswith("```"):

                prefilter_result_str = prefilter_result_str[3:-3]

                

            prefilter_result = json.loads(prefilter_result_str)

            filtered_doc_ids = prefilter_result.get("answer", [])

            print(f"[Pre-Filter] Thinking: {prefilter_result.get('thinking')}", flush=True)

            print(f"[Pre-Filter] Selected Docs: {filtered_doc_ids}", flush=True)

            

        except Exception as e:

            print(f"Error during document pre-filtering: {str(e)}", flush=True)

            # Fallback to searching all active_docs if pre-filter fails

            filtered_doc_ids = active_docs



        if not isinstance(filtered_doc_ids, list):

            filtered_doc_ids = active_docs



        # Filter `active_docs` specifically to what the LLM chose
        final_active_docs = [doc for doc in active_docs if doc in filtered_doc_ids]
        
        if len(final_active_docs) > 20:
            print(f"[Pre-Filter] Too many docs ({len(final_active_docs)}). Truncating semantic search to 20 docs to prevent overload.")
            final_active_docs = final_active_docs[:20]

        # If the LLM determined NO documents are relevant based on descriptions, we still want to try FTS5 fallback.
        if not final_active_docs:
            print("[Pre-Filter] LLM found no relevant documents. Will rely entirely on FTS5 fallback.", flush=True)



    # Process each filtered document concurrently

    async def process_document_search(doc_id):

        tree_path = TREES_DIR / f"{doc_id}_structure.json"

        if not tree_path.exists():

            return []

            

        with open(tree_path, 'r', encoding='utf-8') as f:

            tree = json.load(f)

            

        # Remove 'text' for search to fit context limit

        tree_summary = remove_fields(tree.copy(), fields=['text'])

        

        search_prompt = f"""

        You are given a question and a hierarchical tree structure of a document.

        Each node contains a node id, node title, and a corresponding summary.

        Your task is to find all nodes that are likely to contain the answer to the question.

        CRITICAL: Please prioritize highly specific LEAF nodes over general root nodes to ensure accurate page number citations.



        Question: {query}

        Document ID: {doc_id}



        Document tree structure:

        {json.dumps(tree_summary, indent=2)}



        Please reply in the following JSON format:

        {{

            "thinking": "<Your thinking process on which nodes are relevant to the question>",

            "node_list": ["node_id_1", "node_id_2", ..., "node_id_n"]

        }}

        Directly return the final JSON structure. Do not output anything else.

        """

        

        try:

            tree_search_result_str = await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=search_prompt)

            # Remove markdown JSON wrapper if present

            tree_search_result_str = tree_search_result_str.strip()

            if tree_search_result_str.startswith("```json"):

                tree_search_result_str = tree_search_result_str[7:-3]

            elif tree_search_result_str.startswith("```"):

                tree_search_result_str = tree_search_result_str[3:-3]

                

            search_result = json.loads(tree_search_result_str)

            node_ids = search_result.get("node_list", [])

            print(f"[Search Engine] Doc: {doc_id} Thinking: {search_result.get('thinking')}")

            

            # Map back to full tree to get texts

            doc_context = []

            node_map = create_node_mapping_with_text(tree)

            for nid in node_ids:

                if nid in node_map and "text" in node_map[nid]:

                    text_content = ""

                    if isinstance(node_map[nid]["text"], list):

                        text_content = "\\n\\n".join(node_map[nid]["text"])

                    else:

                        text_content = str(node_map[nid]["text"])

                    page_num = node_map[nid].get('start_index', 'Unknown')

                    doc_context.append(f"--- Document: {doc_id}, Section Start Page: {page_num} ---\\n{text_content}")

            return doc_context

                    

        except Exception as e:

            print(f"Error searching tree for {doc_id}: {str(e)}", flush=True)

            return []

            

    # Execute document searches concurrently with a semaphore to prevent network errors
    sem = asyncio.Semaphore(10)
    
    async def bounded_search(doc):
        async with sem:
            return await process_document_search(doc)

    search_tasks = [bounded_search(doc_id) for doc_id in final_active_docs]
    search_results = await asyncio.gather(*search_tasks)

    

    # Flatten the results

    for result in search_results:

        relevant_context.extend(result)

            

    # If no context found, Fallback to Keyword Search

    if not relevant_context:

        print("[LLM Routing Failed] Fallback to FTS5 Keyword Search...")

        try:

            # Extract keywords via LLM

            keyword_prompt = f"""

            Extract 3 to 8 core keywords from the user's question to be used in a full-text search engine.

            Return an exhaustive list of important nouns, proper nouns, unique identifiers, and domain-specific terms.

            Break down compound words into smaller core words if necessary.

            Return ONLY the keywords separated by spaces. Do not return grammatical words, punctuation, or explanations.

            

            User Question: {query}

            """

            llm_keywords_str = await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=keyword_prompt)

            llm_keywords = llm_keywords_str.strip()

            

            raw_tokens = " ".join([w for w in query.split() if len(w) > 1])

            keywords = f"{raw_tokens} {llm_keywords}".strip()

            print(f"[FTS5 Fallback] Extracted keywords: {keywords}", flush=True)

            

            if keywords:

                # Always search all initially active docs via FTS to catch exact keyword matches missed by LLM pre-filter

                docs_to_search = active_docs

                

                def _search_fts():
                    conn = sqlite3.connect(str(DB_PATH), timeout=30)
                    cursor = conn.cursor()
                    
                    placeholders = ','.join('?' * len(docs_to_search))
                    
                    keyword_list = keywords.split()
                    long_kws = list(set([kw for kw in keyword_list if len(kw) >= 3]))
                    short_kws = list(set([kw for kw in keyword_list if len(kw) < 3]))
                    
                    all_results = []
                    seen_nodes = set()
                    
                    if long_kws:
                        sql_query = f"""
                            SELECT doc_id, node_id, title, text_content, page_num, rank 
                            FROM docs_fts 
                            WHERE doc_id IN ({placeholders}) 
                            AND docs_fts MATCH ? 
                            ORDER BY rank 
                            LIMIT 10
                        """
                        match_query = " OR ".join([f'"{kw}"*' for kw in long_kws])
                        params = tuple(docs_to_search) + (match_query,)
                        cursor.execute(sql_query, params)
                        for r in cursor.fetchall():
                            if r[1] not in seen_nodes:
                                seen_nodes.add(r[1])
                                all_results.append(r)
                                
                    if short_kws:
                        instr_cond = " OR ".join([f"INSTR(LOWER(text_content), LOWER(?)) > 0" for _ in short_kws])
                        rank_exprs = []
                        for kw in short_kws:
                            freq = f"((LENGTH(LOWER(text_content)) - LENGTH(REPLACE(LOWER(text_content), LOWER(?), ''))) / {len(kw)})"
                            score = f"((INSTR(LOWER(text_content), LOWER(?)) > 0) * 100.0 + {freq})"
                            rank_exprs.append(score)
                        score_expr = " + ".join(rank_exprs)
                        
                        sql_query2 = f"""
                            SELECT doc_id, node_id, title, text_content, page_num, -({score_expr}) as rank 
                            FROM docs_fts 
                            WHERE doc_id IN ({placeholders}) 
                            AND ({instr_cond})
                            ORDER BY rank
                            LIMIT 10
                        """
                        params2 = list(docs_to_search) + list(short_kws)
                        for kw in short_kws:
                            params2.extend([kw, kw])
                        cursor.execute(sql_query2, tuple(params2))
                        for r in cursor.fetchall():
                            if r[1] not in seen_nodes:
                                seen_nodes.add(r[1])
                                all_results.append(r)
                                
                    all_results.sort(key=lambda x: x[5])
                    final_results = [r[:5] for r in all_results[:5]]
                    
                    conn.close()
                    return final_results



                fts_results = await asyncio.to_thread(_search_fts)

                

                if fts_results:

                    for doc_id, node_id, title, text_content, page_num in fts_results:

                        relevant_context.append(f"--- Document: {doc_id}, Section Start Page: {page_num} ---\n[실제 문서 페이지: {page_num}]\n{text_content}")

                    print(f"[FTS5 Fallback] Found {len(fts_results)} relevant chunks.", flush=True)

                else:

                    print("[FTS5 Fallback] No results found via keyword search.", flush=True)

                    

        except Exception as e:

            print(f"[FTS5 Fallback] Error during FTS fallback: {str(e)}", flush=True)

            

    if not relevant_context:

        print("[LLM Answer Generation] No context found. Falling back to LLM general knowledge.", flush=True)

        # Final Answer Generation without Context

        answer_prompt = f"""

        Answer the following question based on your general knowledge because no relevant information was found in the provided documents.

        

        CRITICAL INSTRUCTIONS:

        1. You MUST answer the user in Korean (한국어).

        2. You MUST format your entire response using rich Markdown. Use headings, bullet points, numbered lists, and bold text.

        3. Since you are answering from general knowledge and NOT from the user's documents, you MUST start your response with the following exact warning message in a markdown blockquote:

        > 💡 **안내:** 검색된 문서 내에서 질문에 대한 답변을 찾지 못하여 AI의 일반 지식을 기반으로 작성된 답변입니다. 참고용으로만 활용하세요.

        

        Question: {query}

        """

    else:

        combined_context = "\\n\\n".join(relevant_context)

        

        # Final Answer Generation with Context

        answer_prompt = f"""

        Answer the question based ONLY on the provided context retrieved from documents.

        If the provided context DOES NOT contain any relevant, related, or even partial information that could arguably answer the user's question, you MUST output exactly and ONLY the phrase "제공된 문서에서 매칭되는 정보를 찾지 못했습니다." with no additional text, apologies, or generic advice.
        However, if the context contains ANY information tangentially related to the topic or keywords, you MUST answer based on that information. Do NOT reject the query if partial or implicit answers exist.

        

        CRITICAL INSTRUCTIONS:

        1. You MUST answer the user in Korean (한국어).

        2. You MUST format your entire response using rich Markdown. Use headings (###), bullet points (-), numbered lists (1.), and bold text (**bold**) to make the answer highly readable, structured, and visually appealing. Do not just output a single block of plain text.

        3. You MUST cite your sources in the text using the exact format `[DocID#Page]` at the end of sentences that use that information. 

           CRITICAL FOR PAGE NUMBERS: To find the correct page number, refer to the `[실제 문서 페이지: X]` tag located immediately before the text you are using. Use this number X as the Page in your citation [DocID#Page].

           DO NOT use any printed page numbers written at the bottom of the page text (like '- 1 -' or 'Page 2').

           For example, if the information comes from Document 7292f966, and is found under the `[실제 문서 페이지: 5]` tag, write "... [7292f966#5]." Do NOT use any other citation format.

        

        Question: {query}

        

        Context:

        {combined_context}

        

        Provide a clear, cohesive, and comprehensive answer directly in KOREAN, beautifully structured with Markdown, and filled with inline [DocID#Page] citations.

        """

    

    # Call LLM for final generation asynchronously
    chat_model_cfg = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")
    final_answer = await ChatGPT_API_async(model=chat_model_cfg, prompt=answer_prompt)
    return final_answer



async def chat_inferential_stream(query: str, active_docs: list[str], history: list[dict] = None, user_id: int = None, session_id: str = None, save_history: bool = True, agent_id: int = None, file_paths: list[str] = None, run_sandbox: bool = True):

    """

    Orchestrates the vectorless reasoning RAG across multiple document trees.

    Yields chunks of the final output stream back to the UI.

    """

    if history is None:

        history = []

    

    # Format history for LLM prompt

    history_text = "이전 대화 내역이 없습니다."

    if history:

        history_lines = []

        for msg in history:
            role = "사용자" if msg.get("role") == "user" else "AI 어시스턴트"
            content = msg.get("content", "")
            # Truncate very long previous responses to save context window
            if role == "AI 어시스턴트" and len(content) > 1500:
                content = content[:1500] + "...(중략)..."
            history_lines.append(f"[{role}]: {content}")

        history_text = "\n\n".join(history_lines)



    original_history_text = history_text

    search_query = query

    # Default to no history unless short_memory is actively allowed by agent

    history_text = "이전 대화 내역이 없습니다." 

    

    print(f"[Query] Standalone Search (Multi-turn Disabled): {query}", flush=True)



    relevant_context = []

    

    sandbox_output_text = ""

    output_files = []

    agent_name, system_prompt, req_file, python_code, template_filename = (None,)*5

    agent_type = None

    agent_config_dict = {}



    if agent_id:

        try:

            conn = sqlite3.connect(str(DB_PATH), timeout=30)

            cursor = conn.cursor()

            cursor.execute("SELECT name, description, system_prompt, python_code, requires_file_upload, template_filename, agent_type, config FROM chat_agents WHERE id = ?", (agent_id,))

            row = cursor.fetchone()

            conn.close()

            

            if not row:

                yield json.dumps({"type": "chunk", "data": "해당 에이전트 객체를 조회할 수 없습니다."}) + "\n"

                return

                

            agent_name, _, system_prompt, python_code, req_file, template_filename, agent_type, config_json = row

            if config_json:

                try:

                    agent_config_dict = json.loads(config_json)

                except: pass

                

            # Handle both unified 'long_memory' toggle or legacy 'rag_active'

            is_rag_enabled = agent_config_dict.get('long_memory', agent_config_dict.get('rag_active', True))

            if not is_rag_enabled:

                active_docs = []

                

            if agent_config_dict.get('short_memory', False):

                history_text = original_history_text

                

        except Exception as e:

            yield json.dumps({"type": "chunk", "data": f"에이전트 로딩 오류: {str(e)}"}) + "\n"

            return

            

    # 0. INTENT ROUTING PHASE
    yield json.dumps({"type": "status", "data": "사용자 질문 의도 분석 중..."}) + "\n"
    intent_prompt = f"""
    Analyze the following user question and classify it into exactly ONE of these three categories:
    1. "GREETING": Simple greetings, casual chit-chat, expressing gratitude, asking about the AI's identity or condition. (e.g. "안녕", "고마워", "넌 누구니?", "오늘 날씨 어때")
    2. "ASK_DOCUMENTS": Asking to list, show, check, or summarize WHAT documents or files are currently uploaded/available in the system. (e.g. "업로드된 문서 뭐 있어?", "문서 목록 보여줘", "어떤 파일들이 있니?")
    3. "RAG_SEARCH": Any regular question that requires looking up information, analyzing data, or answering based on document content.

    Return ONLY the category name. Do not explain.
    
    User Question: {search_query}
    """
    
    chat_model_cfg = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")
    try:
        intent_result = await ChatGPT_API_async(model=chat_model_cfg, prompt=intent_prompt)
        intent = intent_result.strip().upper()
        
        if "ASK_DOCUMENTS" in intent:
            yield json.dumps({"type": "chunk", "data": "보안상의 이유로 현재 업로드된 전체 문서 목록이나 파일 정보는 제공할 수 없습니다. 특정 주제나 내용에 대해 질문해 주시면 관련된 문서를 검색하여 답변해 드리겠습니다."}) + "\n"
            return
            
        elif "GREETING" in intent:
            casual_prompt = f"""
            You are a helpful and polite AI assistant. The user just said something casual or a greeting.
            Respond to them naturally and kindly in Korean (한국어).
            Keep it relatively short.
            
            User: {search_query}
            """
            casual_response = await ChatGPT_API_async(model=chat_model_cfg, prompt=casual_prompt)
            yield json.dumps({"type": "chunk", "data": casual_response}) + "\n"
            return
            
    except Exception as e:
        print(f"[Intent Router] Error: {e}")


    # 1. PRE-FILTERING PHASE

    if not active_docs and not agent_id:

        yield json.dumps({"type": "chunk", "data": "No documents available to search."}) + "\n"

        return

        

    final_active_docs = []

    if active_docs:

        # Optimization: Skip pre-filtering if only 1 document is selected.

        if len(active_docs) == 1:
            print("[Pre-Filter] Only 1 document active, skipping pre-filter LLM call.")
            filtered_doc_ids = active_docs
        else:
            yield json.dumps({"type": "status", "data": "사용자 질문 분석 및 관련 문서 조회 중..."}) + "\n"

            doc_catalog = []
            for doc_id in active_docs:

                desc = document_status.get(doc_id, {}).get("doc_description", "No description available.")

                name = document_status.get(doc_id, {}).get("name", "Unknown Document")

                doc_catalog.append({"doc_id": doc_id, "doc_name": name, "doc_description": desc})

                

            prefilter_prompt = f"""

            You are given a list of documents with their IDs, file names, and descriptions. 

            Your task is to select documents that may contain information relevant to answering the user query. 

            

            Previous Conversation Context:

            {history_text}

            

            Current User Query: {search_query} 

            

            Documents: 

            {json.dumps(doc_catalog, indent=2)}

            

            Response Format: 

            {{ 

                "thinking": "<Your reasoning for document selection>", 

                "answer": ["doc_id1", "doc_id2"] 

            }} 

            

            Return [] for "answer" if no documents are relevant.

            Return only the JSON structure, with no additional output.

            """

            
            try:
                chat_model_cfg = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")
                prefilter_result_str = await ChatGPT_API_async(model=chat_model_cfg, prompt=prefilter_prompt)
                prefilter_result_str = prefilter_result_str.strip()

                if prefilter_result_str.startswith("```json"):
                    prefilter_result_str = prefilter_result_str[7:-3]
                elif prefilter_result_str.startswith("```"):
                    prefilter_result_str = prefilter_result_str[3:-3]
                    
                prefilter_result = json.loads(prefilter_result_str)

                filtered_doc_ids = prefilter_result.get("answer", [])

                print(f"[Pre-Filter] Thinking: {prefilter_result.get('thinking')}")

                print(f"[Pre-Filter] Selected Docs: {filtered_doc_ids}")

                

            except Exception as e:
                print(f"Error during document pre-filtering: {str(e)}")
                filtered_doc_ids = active_docs[:3]

            if not isinstance(filtered_doc_ids, list):
                filtered_doc_ids = active_docs[:3]

            final_active_docs = [doc for doc in active_docs if doc in filtered_doc_ids]
            
            if len(final_active_docs) > 20:
                yield json.dumps({"type": "status", "data": f"관련 문서가 너무 많습니다 ({len(final_active_docs)}개). 시스템 부하 방지를 위해 핵심 20개 문서만 심층 분석하고, 나머지는 키워드 검색으로 진행합니다."}) + "\n"
                final_active_docs = final_active_docs[:20]

    

    # === HYBRID SEARCH PHASE 0: FILENAME EXACT/PARTIAL MATCHES ===

    for doc_id in final_active_docs:

        name = document_status.get(doc_id, {}).get("name", "")

        # If any significant query word is in the name

        if any(kw.lower() in name.lower() for kw in search_query.split() if len(kw) > 1):

            desc = document_status.get(doc_id, {}).get("doc_description", "")

            chunk_str = f"--- Document: {doc_id}, Page: 1 ---\n[실제 문서 페이지: 1]\n이 문서의 제목에 검색어가 포함된 주요 문서입니다. [파일명: {name}]\n요약: {desc}"

            if chunk_str not in relevant_context:

                relevant_context.append(chunk_str)



    # === HYBRID SEARCH PHASE 1: FTS5 Strict Full-Text Keyword Search ===

    if active_docs:

        yield json.dumps({"type": "status", "data": "질문 내 핵심 단어를 도출하여 하이브리드 인덱스 검색 중..."}) + "\n"

    

    fts_extracted_nodes = set()

    try:

        if active_docs:
            keyword_prompt = f"""

            Extract 1 to 2 absolute core keywords (nouns only) from the user's question for a strict full-text search.

            Identify the most unique subject matter, proper noun, or identifier.

            CRITICAL: Completely EXCLUDE common business verbs, actions, or question words.

            Return ONLY the extracted core nouns separated by spaces. No punctuation or explanations.

            

            User Question: {search_query}

            """

            llm_keywords_str = await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=keyword_prompt)

            llm_keywords = (llm_keywords_str or "").strip()

            

            raw_tokens = " ".join([w for w in search_query.split() if len(w) > 1])

            keywords = f"{raw_tokens} {llm_keywords}".strip()

            print(f"[Hybrid FTS5] Extracted strict keywords: {keywords}", flush=True)

            

            if keywords:

                def _search_fts():
                    import sqlite3
                    conn = sqlite3.connect(str(DB_PATH), timeout=30)
                    cursor = conn.cursor()
                    
                    placeholders = ','.join('?' * len(active_docs))
                    
                    keyword_list = keywords.split()
                    long_kws = list(set([kw for kw in keyword_list if len(kw) >= 3]))
                    short_kws = list(set([kw for kw in keyword_list if len(kw) < 3]))
                    
                    all_results = []
                    seen_nodes = set()
                    
                    if long_kws:
                        query = f"""
                            SELECT doc_id, node_id, title, text_content, page_num, rank 
                            FROM docs_fts 
                            WHERE doc_id IN ({placeholders}) 
                            AND docs_fts MATCH ? 
                            ORDER BY rank 
                            LIMIT 10
                        """
                        match_query = " OR ".join([f'"{kw}"*' for kw in long_kws])
                        params = tuple(active_docs) + (match_query,)
                        cursor.execute(query, params)
                        for r in cursor.fetchall():
                            if r[1] not in seen_nodes:
                                seen_nodes.add(r[1])
                                all_results.append(r)
                                
                    if short_kws:
                        instr_cond = " OR ".join([f"INSTR(LOWER(text_content), LOWER(?)) > 0" for _ in short_kws])
                        rank_exprs = []
                        for kw in short_kws:
                            freq = f"((LENGTH(LOWER(text_content)) - LENGTH(REPLACE(LOWER(text_content), LOWER(?), ''))) / {len(kw)})"
                            score = f"((INSTR(LOWER(text_content), LOWER(?)) > 0) * 100.0 + {freq})"
                            rank_exprs.append(score)
                        score_expr = " + ".join(rank_exprs)
                        
                        query2 = f"""
                            SELECT doc_id, node_id, title, text_content, page_num, -({score_expr}) as rank 
                            FROM docs_fts 
                            WHERE doc_id IN ({placeholders}) 
                            AND ({instr_cond})
                            ORDER BY rank
                            LIMIT 10
                        """
                        params2 = list(active_docs) + list(short_kws)
                        for kw in short_kws:
                            params2.extend([kw, kw])
                        cursor.execute(query2, tuple(params2))
                        for r in cursor.fetchall():
                            if r[1] not in seen_nodes:
                                seen_nodes.add(r[1])
                                all_results.append(r)
                                
                    all_results.sort(key=lambda x: x[5])
                    final_results = [r[:5] for r in all_results[:5]]
                    
                    conn.close()
                    return final_results



                fts_results = await asyncio.to_thread(_search_fts)

                if fts_results:

                    for doc_id, node_id, title, text_content, page_num in fts_results:

                        fts_extracted_nodes.add(node_id)

                        if doc_id not in final_active_docs:

                            final_active_docs.append(doc_id)

                        chunk_str = f"--- Document: {doc_id}, Section Start Page: {page_num} ---\n[실제 문서 페이지: {page_num}]\n{text_content}"

                        if chunk_str not in relevant_context:

                            relevant_context.append(chunk_str)

                    print(f"[Hybrid FTS5] Found {len(fts_results)} exact keyword chunks.", flush=True)

                else:

                    print("[Hybrid FTS5] No results found.", flush=True)

    except Exception as e:

        import traceback

        print(f"[Hybrid FTS5] Error during FTS hybrid pass:\n{traceback.format_exc()}", flush=True)



    # === HYBRID SEARCH PHASE 2: LLM Semantic Tree Search ===

    if active_docs:

        yield json.dumps({"type": "status", "data": "선택된 문서들을 대상으로 병렬 내부 정보 검색을 시도 중..."}) + "\n"

    async def process_document_search(doc_id):

        tree_path = TREES_DIR / f"{doc_id}_structure.json"

        if not tree_path.exists():

            return []

            

        with open(tree_path, 'r', encoding='utf-8') as f:

            tree = json.load(f)

            

        tree_summary = remove_fields(tree.copy(), fields=['text'])

        

        search_prompt = f"""

        You are given a question and a hierarchical tree structure of a document.

        Each node contains a node id, node title, and a corresponding summary.

        Your task is to find all nodes that are likely to contain the answer to the question, considering the prior conversation context.

        CRITICAL: Please prioritize highly specific LEAF nodes over general root nodes to ensure accurate page number citations.



        Previous Conversation Context:

        {history_text}



        Current User Question: {search_query}

        Document ID: {doc_id}



        Document tree structure:

        {json.dumps(tree_summary, indent=2)}



        Please reply in the following JSON format:

        {{

            "thinking": "<Your thinking process on which nodes are relevant to the question>",

            "node_list": ["node_id_1", "node_id_2"]

        }}

        Directly return the final JSON structure. Do not output anything else.

        """

        

        try:

            tree_search_result_str = await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=search_prompt)

            tree_search_result_str = tree_search_result_str.strip()

            if tree_search_result_str.startswith("```json"):

                tree_search_result_str = tree_search_result_str[7:-3]

            elif tree_search_result_str.startswith("```"):

                tree_search_result_str = tree_search_result_str[3:-3]

                

            search_result = json.loads(tree_search_result_str)

            node_ids = search_result.get("node_list", [])

            print(f"[Semantic Tree] Doc: {doc_id} Thinking: {search_result.get('thinking')}")

            

            doc_context = []

            node_map = create_node_mapping_with_text(tree)

            for nid in node_ids:

                if nid in fts_extracted_nodes:

                    continue # Skip duplicates already grabbed by Phase 1 FTS5

                if nid in node_map and "text" in node_map[nid]:

                    text_content = ""

                    if isinstance(node_map[nid]["text"], list):

                        text_content = "\n\n".join(node_map[nid]["text"])

                    else:

                        text_content = str(node_map[nid]["text"])

                    page_num = node_map[nid].get('start_index', 'Unknown')

                    doc_context.append(f"--- Document: {doc_id}, Section Start Page: {page_num} ---\n[실제 문서 페이지: {page_num}]\n{text_content}")

            return doc_context

                    

        except Exception as e:

            print(f"Error searching tree for {doc_id}: {str(e)}")

            return []

            

    search_tasks = [process_document_search(doc_id) for doc_id in final_active_docs]

    search_results = await asyncio.gather(*search_tasks)

    

    for result in search_results:

        for chunk in result:

            if chunk not in relevant_context:

                relevant_context.append(chunk)



    if agent_id:

        try:

            code_enabled_in_agent = agent_config_dict.get("code_enabled", True)

            

            if python_code and python_code.strip() and run_sandbox and code_enabled_in_agent:

                yield json.dumps({"type": "status", "data": f"[{agent_name}] 에이전트 분석 및 파이썬 환경 실행 중..."}) + "\n"

                from app.sandbox import execute_agent_code, TEMPLATES_DIR

                import os

                try:

                    all_file_paths = list(file_paths or [])

                    if template_filename:

                        full_template_path = os.path.join(TEMPLATES_DIR, template_filename)

                        if os.path.exists(full_template_path):

                            all_file_paths.insert(0, full_template_path)

                            

                    # Inject selected RAG documents so python sandbox can process them ONLY if no explicit files were uploaded in this turn

                    if not file_paths:

                        for d_id in (final_active_docs if final_active_docs else active_docs):

                            if d_id in document_status and "safe_filename" in document_status[d_id]:

                                d_path = str(DOCS_DIR / document_status[d_id]["safe_filename"])

                                if os.path.exists(d_path) and d_path not in all_file_paths:

                                    all_file_paths.append(d_path)

                            

                    agent_user_prompt = f"Previous Conversation:\n{history_text}\n\nUser Question:\n{search_query}"

                            

                    sandbox_result = await asyncio.to_thread(execute_agent_code, python_code, all_file_paths, agent_user_prompt, agent_id)

                    sandbox_output_text = f"[Python Execution Results]\nSuccess: {sandbox_result['success']}\nStdout:\n{sandbox_result['stdout']}\nStderr:\n{sandbox_result['stderr']}\n"

                    output_files = sandbox_result['output_files']

                except Exception as e:

                    sandbox_output_text = f"Python Execution Exception: {str(e)}"

                    

        except Exception as e:

            yield json.dumps({"type": "chunk", "data": f"에이전트 로딩 오류: {str(e)}"}) + "\n"

            return

            

    # --- NEW LOGIC FOR TABLE IMAGE GENERATION ---

    import re

    import os

    import fitz

    image_paths_for_llm = []

    has_table = False

    processed_pages = set()

    

    for ctx in relevant_context:

        m = re.search(r"--- Document: ([a-zA-Z0-9_]+)", ctx)

        if m:

            found_doc_id = m.group(1)

            # Find all actual physical pages present in this chunk
            pages = re.findall(r"\[실제 문서 페이지:\s*(\d+)\]", ctx)
            if not pages:
                # Fallback to the header page if the tags are missing
                m_page = re.search(r"Section Start Page:\s*([0-9]+)", ctx)
                if m_page:
                    pages = [m_page.group(1)]

            safe_filename = document_status.get(found_doc_id, {}).get("safe_filename")
            doc = None
            if safe_filename:
                pdf_path = DOCS_DIR / safe_filename
                if pdf_path.exists() and pdf_path.suffix.lower() == '.pdf':
                    try:
                        doc = fitz.open(pdf_path)
                    except Exception as e:
                        print(f"Error opening PDF for {found_doc_id}: {e}")

            for found_page in set(pages):
                page_key = f"{found_doc_id}_{found_page}"
                if page_key in processed_pages:
                    continue
                processed_pages.add(page_key)
            
                if doc:
                    try:
                        page_idx = int(found_page) - 1
                        if 0 <= page_idx < len(doc):
                            page = doc.load_page(page_idx)
                            tables_found = page.find_tables()
                            if tables_found and len(tables_found.tables) > 0:
                                has_table = True
                                img_out = TREES_DIR / f"{found_doc_id}_page_{found_page}.png"
                                
                                if not img_out.exists():
                                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                                    pix.save(str(img_out))
                                    
                                if img_out.exists() and str(img_out) not in image_paths_for_llm:
                                    image_paths_for_llm.append(str(img_out))
                    except Exception as e:
                        print(f"Error checking/extracting table image for {page_key}: {e}")

            if doc:
                try:
                    doc.close()
                except:
                    pass



    if has_table and image_paths_for_llm:

        yield json.dumps({"type": "status", "data": "비정형 데이터 감지: 구조 분석을 위해 원본 페이지를 이미지로 변환해 분석 중..."}) + "\n"

    elif relevant_context and not agent_id:

        yield json.dumps({"type": "status", "data": "최종 문서 기반 답변 작성 중..."}) + "\n"



    combined_context = "\n\n".join(relevant_context) if relevant_context else "조회된 검색 정보가 없습니다."



    if not relevant_context and not agent_id:

        yield json.dumps({"type": "status", "data": "관련된 문서를 찾지 못해 AI가 일반 지식으로 답변을 구성 중..."}) + "\n"

        answer_prompt = f"""

        Answer the following question based on your general knowledge because no relevant information was found in the provided documents.

        Also take into account the conversation history to maintain context.

        

        CRITICAL INSTRUCTIONS:

        1. You MUST answer the user in Korean (한국어).

        2. You MUST format your entire response using rich Markdown. Use headings, bullet points, numbered lists, and bold text.

        3. Since you are answering from general knowledge and NOT from the user's documents, you MUST start your response with the following exact warning message in a markdown blockquote:

        > 💡 **안내:** 검색된 문서 내에서 질문에 대한 답변을 찾지 못하여 AI의 일반 지식을 기반으로 작성된 답변입니다. 참고용으로만 활용하세요.

        

        Previous Conversation Context:

        {history_text}

        

        Current User Question: {search_query}

        """

    elif agent_id:

        yield json.dumps({"type": "status", "data": f"[{agent_name}] 검색된 정보 및 파이썬 샌드박스 결과물 취합 및 정리 중..."}) + "\n"

        

        citation_instruction = ""

        if relevant_context:

            citation_instruction = "3. You MUST cite your sources in the text using the exact format `[DocID#Page]` at the end of sentences that use that information. CRITICAL FOR PAGE NUMBERS: To find the correct page number, refer to the `[실제 문서 페이지: X]` tag located immediately before the text you are using. Use this number X as the Page in your citation [DocID#Page]. DO NOT use any printed page numbers written at the bottom of the page text (like '- 1 -' or 'Page 2')."

            

        answer_prompt = f"""

        당신은 사내 지식 기반 사용자 맞춤형 특수 에이전트 '{agent_name}'입니다.

        

        [Agent System Prompt]

        {system_prompt}

        

        [Python Sandbox Execution Output] (If applicable)

        {sandbox_output_text}

        

        [RAG Document Context] (Use this heavily to answer the user's question accurately)

        {combined_context}

        

        [Previous Conversation Context]

        {history_text}

        

        [User Question]

        {search_query}

        

        CRITICAL INSTRUCTIONS:

        1. Base your answer strictly on the facts found in the [RAG Document Context] and the [Python Sandbox Execution Output].

        2. Format using Markdown in Korean (한국어). Do NOT output internal reasoning blocks like <think>.

        {citation_instruction}

        """

    else:

        answer_prompt = f"""

        Answer the current question based ONLY on the provided context retrieved from documents, but also take into account the conversation history to maintain context.

        If the provided context DOES NOT contain any relevant, related, or even partial information that could arguably answer the user's question, you MUST output exactly and ONLY the phrase "제공된 문서에서 매칭되는 정보를 찾지 못했습니다." with no additional text, apologies, or generic advice.
        However, if the context contains ANY information tangentially related to the topic or keywords, you MUST answer based on that information. Do NOT reject the query if partial or implicit answers exist.

        CRITICAL INSTRUCTIONS:

        1. You MUST answer the user in Korean (한국어).

        2. You MUST format your entire response using rich Markdown. Use headings (###), bullet points (-), numbered lists (1.), and bold text (**bold**) to make the answer highly readable, structured, and visually appealing. Do not just output a single block of plain text.

        3. You MUST cite your sources in the text using the exact format `[DocID#Page]` at the end of sentences that use that information. 

           CRITICAL FOR PAGE NUMBERS: To find the correct page number, refer to the `[실제 문서 페이지: X]` tag located immediately before the text you are using. Use this number X as the Page in your citation [DocID#Page].

           DO NOT use any printed page numbers written at the bottom of the page text (like '- 1 -' or 'Page 2').

           For example, if the information comes from Document 7292f966, and is found under the `[실제 문서 페이지: 5]` tag, write "... [7292f966#5]." Do NOT use any other citation format.

        

        Previous Conversation Context:

        {history_text}

        

        Current User Question: {search_query}

        

        Context from Documents:

        {combined_context}

        

        Provide a clear, cohesive, and comprehensive answer directly in KOREAN, beautifully structured with Markdown, and filled with inline [DocID#Page] citations.

        """

    

    try:
        full_assistant_reply = ""
        if has_table:
            chosen_model = get_sys_setting("chat_vision_llm_model", "gemini-flash-latest")
        else:
            chosen_model = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")

        

        # All agents now use the Unified Autonomous Engine

        is_autonomous = bool(agent_id)

        

        if is_autonomous:

            from app.mcp_engine import Autonomous_Agent_async_stream, mcp_manager

            yield json.dumps({"type": "status", "data": f"[{agent_name}] 제공 가능한 다중 MCP 도구 탐색 및 내부 자율 추론 시작..."}) + "\n"

            

            stream_gen = Autonomous_Agent_async_stream(

                agent_name=agent_name,

                prompt_text=search_query,

                system_prompt=system_prompt,

                history_text=history_text,

                combined_context=combined_context,

                mcp_manager=mcp_manager,

                hitl_enabled=agent_config_dict.get('hitl', False),

                session_id=session_id,

                user_id=user_id

            )

        else:

            stream_gen = ChatGPT_API_async_stream(model=chosen_model, prompt=answer_prompt, image_paths=image_paths_for_llm if has_table else None, user_id=user_id)

        timeout_triggered = False

        

        try:

            first_chunk = await asyncio.wait_for(anext(stream_gen), timeout=25.0)

            if is_autonomous:

                try:

                    parsed = json.loads(first_chunk.strip())

                    if parsed.get("type") == "chunk":

                        full_assistant_reply += parsed.get("data", "")

                except: pass

                yield first_chunk

            else:

                full_assistant_reply += first_chunk

                yield json.dumps({"type": "chunk", "data": first_chunk}) + "\n"

            

            async for chunk in stream_gen:

                if is_autonomous:

                    try:

                        parsed = json.loads(chunk.strip())

                        if parsed.get("type") == "chunk":

                            full_assistant_reply += parsed.get("data", "")

                    except: pass

                    yield chunk

                else:

                    full_assistant_reply += chunk

                    yield json.dumps({"type": "chunk", "data": chunk}) + "\n"

        except asyncio.TimeoutError:

            timeout_triggered = True

            print("[RAG Engine] Generating final answer timed out on first chunk (25s).", flush=True)

        except StopAsyncIteration:

            pass



        if not is_autonomous and (timeout_triggered or not full_assistant_reply.strip() or ("제공된 문서에서 답변을 찾을 수 없습니다" in full_assistant_reply)):
            import time

            spinner_id_1 = f"fb-spin1-{int(time.time()*100)}"

            spinner_id_2 = f"fb-spin2-{int(time.time()*100)}"

            spinner_html = f'<div id="{spinner_id_1}" class="typing-indicator" style="margin: 10px 0;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>'

            

            status_msg = f"\n\n> 🚨 **분석 지연 감지:** 문서 맥락에 부합하도록 질문의 의도를 확장하여 재심층 분석을 시도합니다...\n\n{spinner_html}\n\n"

            yield json.dumps({"type": "chunk", "data": status_msg}) + "\n"

            

            expansion_prompt = f"""사용자가 다음 기본 질문에 대한 답변을 찾지 못했습니다. 제공된 검색 결과[검색된 문서 내용]의 문맥과 용어를 참고하여, 본래 질문을 '보다 구체적이고 확장된 분석 질문'으로 재작성해주세요. 해당 문서에서 찾을 수 있는 특정 명사, 핵심 키워드를 반드시 질문에 포함시켜 사용자가 정확한 단서를 얻게 지시하세요 (표에서 'V' 체크가 있는 열 조회 등).

[검색된 문서 내용]
{combined_context}

[사용자 원본 질문]
{query}"""
            simplified_query_str = await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=expansion_prompt)

            simplified_query = simplified_query_str.strip()

            

            hide_spinner_1 = f'<style>#{spinner_id_1} {{ display: none !important; }}</style>'

            spinner_html_2 = f'<div id="{spinner_id_2}" class="typing-indicator" style="margin: 10px 0;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>'

            yield json.dumps({"type": "chunk", "data": f"{hide_spinner_1}\n\n> 💡 **세분화 질문:** {simplified_query}\n\n---\n\n{spinner_html_2}"}) + "\n"

            

            second_answer_prompt = answer_prompt.replace(f"Current User Question: {search_query}", f"Current User Question: {simplified_query}")

            

            full_assistant_reply = ""

            fallback_stream = ChatGPT_API_async_stream(model=chosen_model, prompt=second_answer_prompt, image_paths=image_paths_for_llm if has_table else None, user_id=user_id)

            

            hide_spinner_2 = f'<style>#{spinner_id_2} {{ display: none !important; }}</style>\n\n'

            first_fb_chunk = True

            

            async for chunk in fallback_stream:

                if first_fb_chunk:

                    chunk = hide_spinner_2 + chunk

                    first_fb_chunk = False

                full_assistant_reply += chunk

                yield json.dumps({"type": "chunk", "data": chunk}) + "\n"

            

        # Append output files

        if output_files:

            file_links = "\n\n<div style='margin-top: 15px; padding: 10px; background-color: var(--surface-bg); border-radius: 8px; border: 1px solid var(--border-color);'>\n"

            file_links += "<strong>?“� ?�ì�´?„íŠ¸ ?�ì„± ?Œì�¼:</strong><br/>\n<ul style='margin-top: 8px; margin-bottom: 0;'>\n"

            for f in output_files:

                file_links += f"<li><a href='{f['url']}' download='{f['name']}' style='color: var(--primary); text-decoration: underline;'>{f['name']} ?¤ìš´ë¡œë“œ</a></li>\n"

            file_links += "</ul>\n</div>\n"

            

            full_assistant_reply += file_links

            yield json.dumps({"type": "chunk", "data": file_links}) + "\n"

            

        # Save assistant's answer to history    

        if user_id and session_id and save_history:

            try:

                conn = sqlite3.connect(str(DB_PATH), timeout=30)

                cursor = conn.cursor()

                initial_content = json.dumps([{"query": None, "text": full_assistant_reply}], ensure_ascii=False)

                cursor.execute("INSERT INTO chat_history (session_id, user_id, role, content) VALUES (?, ?, ?, ?)",

                               (session_id, user_id, "assistant", initial_content))

                msg_id = cursor.lastrowid

                conn.commit()

                conn.close()

                yield json.dumps({"type": "message_id", "data": msg_id}) + "\n"

            except Exception as dbe:

                print(f"Error saving assistant reply to history: {str(dbe)}")

                

    except Exception as e:

        import traceback

        error_details = traceback.format_exc()

        print(f"Error during final answer stream generation:\n{error_details}")



        error_msg = f"\n\n**응답 생성 중 오류가 발생했습니다:** {str(e)}\n\n"
        yield json.dumps({"type": "chunk", "data": error_msg}) + "\n"



def remove_fields(data: dict | list, fields: list[str] = ['text'], max_summary_len: int = 100):

    if isinstance(data, dict):

        new_dict = {}

        for k, v in data.items():

            if k in fields:

                continue

            if k == 'summary' and isinstance(v, str) and len(v) > max_summary_len:

                new_dict[k] = v[:max_summary_len] + "..."

            else:

                new_dict[k] = remove_fields(v, fields, max_summary_len)

        return new_dict

    elif isinstance(data, list):

        return [remove_fields(item, fields, max_summary_len) for item in data]

    else:

        return data



def create_node_mapping_with_text(tree) -> dict:

    mapping = {}

    if isinstance(tree, list):

        for item in tree:

            mapping.update(create_node_mapping_with_text(item))

    elif isinstance(tree, dict):

        if 'node_id' in tree:

            mapping[tree['node_id']] = tree

        if 'nodes' in tree:

            mapping.update(create_node_mapping_with_text(tree['nodes']))

        if 'structure' in tree and isinstance(tree['structure'], list):

            mapping.update(create_node_mapping_with_text(tree['structure']))

    return mapping



async def search_documents_semantic(query: str, active_docs: list[str]):

    """

    RAG Semantic Retrieval for Document Search UI.

    Uses Pre-filtering, Hybrid FTS5, and LLM Tree Search to return precise document chunks.

    """

    import json

    import sqlite3

    import traceback

    import asyncio

    

    docs_out = []

    seen_chunks = set() # To prevent duplicates (doc_id + page)

    

    if not active_docs:

        return docs_out



    # 1. PRE-FILTERING PHASE

    filtered_doc_ids = active_docs

    if len(active_docs) > 1:

        doc_catalog = []

        for doc_id in active_docs:

            desc = document_status.get(doc_id, {}).get("doc_description", "No description available.")

            name = document_status.get(doc_id, {}).get("name", "Unknown Document")

            doc_catalog.append({"doc_id": doc_id, "doc_name": name, "doc_description": desc})

            

        prefilter_prompt = f"""

        You are given a list of documents with their IDs, file names, and descriptions. 

        Your task is to select documents that may contain information relevant to answering the user query.

        

        Current User Query: {query} 

        

        Documents: 

        {json.dumps(doc_catalog, indent=2)}

        

        Response Format: 

        {{ 

            "thinking": "<Your reasoning>", 

            "answer": ["doc_id1", "doc_id2"] 

        }} 

        Return [] for "answer" if no documents are relevant.

        Return only the JSON structure.

        """

        try:

            res_str = await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=prefilter_prompt)

            res_str = res_str.strip()

            if res_str.startswith("```json"): res_str = res_str[7:-3]

            elif res_str.startswith("```"): res_str = res_str[3:-3]

            

            res_json = json.loads(res_str)

            filtered_doc_ids = res_json.get("answer", [])

            print(f"[SemanticSearch] Pre-Filter Selected Docs: {filtered_doc_ids}", flush=True)

        except Exception as e:
            print(f"[SemanticSearch] Pre-Filter Error: {e}")
            filtered_doc_ids = active_docs[:3]
            
        if not isinstance(filtered_doc_ids, list):
            filtered_doc_ids = active_docs[:3]



        final_active_docs = [doc for doc in active_docs if doc in filtered_doc_ids]

    else:

        final_active_docs = active_docs



    # === HYBRID SEARCH PHASE 0: FILENAME EXACT/PARTIAL MATCHES ===

    for doc_id in final_active_docs:

        name = document_status.get(doc_id, {}).get("name", "")

        if any(kw.lower() in name.lower() for kw in query.split() if len(kw) > 1):

            chunk_key = f"{doc_id}_1_title_match"

            if chunk_key not in seen_chunks:

                seen_chunks.add(chunk_key)

                docs_out.append({

                    "id": doc_id,

                    "title": name,

                    "snippet": f"<b>파일명 매칭:</b> {name}",

                    "page": 1

                })



    # === HYBRID SEARCH PHASE 1: FTS5 Strict Full-Text Keyword Search ===

    fts_extracted_nodes = set()

    try:
        if final_active_docs:
            keyword_prompt = f"""

            Extract 1 to 2 absolute core keywords (nouns only) from the user's question for a strict full-text search.

            Exclude common verbs and questions. Return ONLY the extracted core nouns separated by spaces.

            

            User Question: {query}

            """

            llm_keywords = (await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=keyword_prompt)).strip()

            

            raw_tokens = " ".join([w for w in query.split() if len(w) > 1])

            keywords = f"{raw_tokens} {llm_keywords}".strip()

            print(f"[SemanticSearch] Extracted strict keywords: {keywords}", flush=True)

            

            if keywords:
                conn = sqlite3.connect(str(DB_PATH), timeout=30)
                cursor = conn.cursor()
                placeholders = ','.join('?' * len(final_active_docs))
                sql_q = f"""

                    SELECT doc_id, node_id, title, page_num, snippet(docs_fts, 3, '<b>', '</b>', '...', 64) as snip

                    FROM docs_fts 

                    WHERE doc_id IN ({placeholders}) AND docs_fts MATCH ? 

                    ORDER BY rank LIMIT 15

                """

                match_q = " OR ".join([f'"{kw}"*' for kw in keywords.split()])
                cursor.execute(sql_q, tuple(final_active_docs) + (match_q,))
                fts_results = cursor.fetchall()

                conn.close()

                

                for r in fts_results:

                    doc_id, node_id, title, page_num, snip = r

                    fts_extracted_nodes.add(node_id)

                    if doc_id not in final_active_docs:

                        final_active_docs.append(doc_id)

                    chunk_key = f"{doc_id}_{page_num}_{node_id}"

                    if chunk_key not in seen_chunks:

                        seen_chunks.add(chunk_key)

                        doc_name = document_status.get(doc_id, {}).get("name", title)

                        docs_out.append({"id": doc_id, "title": doc_name, "snippet": snip, "page": page_num})

    except Exception as e:

        print(f"[SemanticSearch] FTS5 Hybrid Error: {e}")



    # === HYBRID SEARCH PHASE 2: LLM Semantic Tree Search ===

    async def process_document_search(doc_id):

        tree_path = TREES_DIR / f"{doc_id}_structure.json"

        if not tree_path.exists(): return []

        with open(tree_path, 'r', encoding='utf-8') as f: tree = json.load(f)

        tree_summary = remove_fields(tree.copy(), fields=['text'])

        

        search_prompt = f"""

        You are given a question and a hierarchical tree structure of a document.

        Your task is to find all nodes that are likely to contain the answer to the question.

        CRITICAL: Prioritize highly specific LEAF nodes.

        Question: {query}

        Document tree structure: {json.dumps(tree_summary, indent=2)}

        Response Format: {{"node_list": ["node_id_1"]}}

        """

        try:
            chat_model_cfg = get_sys_setting("chat_llm_model", "gemini-flash-lite-latest")
            res_str = await ChatGPT_API_async(model=chat_model_cfg, prompt=search_prompt)
            res_str = res_str.strip()

            if res_str.startswith("```json"): res_str = res_str[7:-3]

            elif res_str.startswith("```"): res_str = res_str[3:-3]

            

            node_ids = json.loads(res_str).get("node_list", [])

            doc_context = []

            node_map = create_node_mapping_with_text(tree)

            doc_name = document_status.get(doc_id, {}).get("name", "Document")

            

            for nid in node_ids:

                if nid in fts_extracted_nodes: continue

                if nid in node_map and "text" in node_map[nid]:

                    text_content = "\n\n".join(node_map[nid]["text"]) if isinstance(node_map[nid]["text"], list) else str(node_map[nid]["text"])

                    page_num = node_map[nid].get('start_index', 'Unknown')

                    snip = text_content.replace("\n", " ")

                    snip = snip[:200] + "..." if len(snip) > 200 else snip

                    doc_context.append({"id": doc_id, "title": doc_name, "snippet": snip, "page": page_num, "nid": nid})

            return doc_context

        except Exception as e:

            return []

            

    search_tasks = [process_document_search(doc_id) for doc_id in final_active_docs]

    search_results = await asyncio.gather(*search_tasks)

    

    for result in search_results:

        for item in result:

            chunk_key = f"{item['id']}_{item['page']}_{item['nid']}"

            if chunk_key not in seen_chunks:

                seen_chunks.add(chunk_key)

                docs_out.append({"id": item['id'], "title": item['title'], "snippet": item['snippet'], "page": item['page']})

    if not docs_out and active_docs:
        print("[SemanticSearch] No results found. Running fallback search on all active_docs...", flush=True)
        # Fallback Phase 0: Filename Match
        for doc_id in active_docs:
            name = document_status.get(doc_id, {}).get("name", "")
            if any(kw.lower() in name.lower() for kw in query.split() if len(kw) > 1):
                chunk_key = f"{doc_id}_1_fallback_title"
                if chunk_key not in seen_chunks:
                    seen_chunks.add(chunk_key)
                    docs_out.append({"id": doc_id, "title": name, "snippet": f"<b>파일명 매칭:</b> {name}", "page": 1})
        
        # Fallback Phase 1: FTS5 Keyword Search
        try:
            keyword_prompt = f"""
            Extract 1 to 2 absolute core keywords (nouns only) from the user's question for a strict full-text search.
            Exclude common verbs and questions. Return ONLY the extracted core nouns separated by spaces.
            
            User Question: {query}
            """
            llm_keywords = (await ChatGPT_API_async(model=get_sys_setting("chat_llm_model", "gemini-flash-lite-latest"), prompt=keyword_prompt)).strip()
            raw_tokens = " ".join([w for w in query.split() if len(w) > 1])
            keywords = f"{raw_tokens} {llm_keywords}".strip()
            
            if keywords:
                conn = sqlite3.connect(str(DB_PATH), timeout=30)
                cursor = conn.cursor()
                placeholders = ','.join('?' * len(active_docs))
                sql_q = f"""
                    SELECT doc_id, node_id, title, page_num, snippet(docs_fts, 3, '<b>', '</b>', '...', 64) as snip
                    FROM docs_fts 
                    WHERE doc_id IN ({placeholders}) AND docs_fts MATCH ? 
                    ORDER BY rank LIMIT 15
                """
                match_q = " OR ".join([f'"{kw}"*' for kw in keywords.split()])
                cursor.execute(sql_q, tuple(active_docs) + (match_q,))
                fts_results = cursor.fetchall()
                conn.close()
                
                for r in fts_results:
                    doc_id, node_id, title, page_num, snip = r
                    chunk_key = f"{doc_id}_{page_num}_{node_id}_fallback"
                    if chunk_key not in seen_chunks:
                        seen_chunks.add(chunk_key)
                        doc_name = document_status.get(doc_id, {}).get("name", title)
                        docs_out.append({"id": doc_id, "title": doc_name, "snippet": snip, "page": page_num})
        except Exception as e:
            print(f"[SemanticSearch] Fallback FTS5 Error: {e}")

    return docs_out

