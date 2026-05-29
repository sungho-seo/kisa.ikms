import tiktoken
import logging
import os
from datetime import datetime
import time
import json
import contextvars

import threading
import asyncio

# Global concurrency management for LLM
_global_llm_lock = threading.Lock()
_active_llm_calls = 0
_MAX_LLM_CALLS = 5

async def wait_for_llm_slot_async():
    global _active_llm_calls
    while True:
        with _global_llm_lock:
            if _active_llm_calls < _MAX_LLM_CALLS:
                _active_llm_calls += 1
                return
        await asyncio.sleep(0.5)

def wait_for_llm_slot_sync():
    global _active_llm_calls
    while True:
        with _global_llm_lock:
            if _active_llm_calls < _MAX_LLM_CALLS:
                _active_llm_calls += 1
                return
        time.sleep(0.5)

def release_llm_slot():
    global _active_llm_calls
    with _global_llm_lock:
        _active_llm_calls = max(0, _active_llm_calls - 1)

current_user_id = contextvars.ContextVar("current_user_id", default=None)
import PyPDF2
import copy
import asyncio
import random
import pymupdf
from io import BytesIO
import tempfile
import opendataloader_pdf

def extract_pdf_texts_opendataloader(file_path):
    page_texts = {}
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            opendataloader_pdf.convert(
                input_path=[file_path],
                output_dir=temp_dir,
                format="json",
                quiet=True
            )
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            json_file = os.path.join(temp_dir, f"{base_name}.json")
            if os.path.exists(json_file):
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                def extract_recursive(node):
                    if isinstance(node, dict):
                        page_num = node.get("page number")
                        content = node.get("content")
                        if page_num is not None and content:
                            idx = page_num - 1
                            if idx not in page_texts:
                                page_texts[idx] = []
                            page_texts[idx].append(content)
                        for key, value in node.items():
                            extract_recursive(value)
                    elif isinstance(node, list):
                        for item in node:
                            extract_recursive(item)
                            
                extract_recursive(data)
                
                for idx in page_texts:
                    page_texts[idx] = "\n".join(page_texts[idx])
        except Exception as e:
            print(f"[OpenDataLoader] Error extracting text: {e}")
    return page_texts

from dotenv import load_dotenv
load_dotenv()
import logging
import yaml
from pathlib import Path
from types import SimpleNamespace as config

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from google import genai
from google.genai import types

def get_gemini_client(api_key=None):
    # google.genai SDK http_options 'timeout' expects milliseconds! 
    # 120000.0 ms = 120.0 seconds. 
    # Previously 120.0 caused a 0.12s timeout which triggered rapid failures.
    http_options = {'timeout': 120000.0}
    if api_key:
        return genai.Client(api_key=api_key, http_options=http_options)
    if GEMINI_API_KEY:
        return genai.Client(api_key=GEMINI_API_KEY, http_options=http_options)
    return genai.Client(http_options=http_options)


CHATGPT_API_KEY = GEMINI_API_KEY


def count_tokens(text, model=None):
    if not text:
        return 0
    if isinstance(model, dict):
        model = model.get("model", "gpt-4o")
    try:
        enc = tiktoken.encoding_for_model(model)
    except KeyError:
        enc = tiktoken.get_encoding("cl100k_base")
    tokens = enc.encode(text)
    return len(tokens)

def map_history_to_gemini(chat_history):
    if not chat_history:
        return []
    mapped = []
    for msg in chat_history:
        role = "user" if msg["role"] == "user" else "model"
        mapped.append(types.Content(role=role, parts=[types.Part.from_text(text=msg["content"])]))
    return mapped

async def ChatGPT_API_with_finish_reason_async(model, prompt, api_key=CHATGPT_API_KEY, chat_history=None, response_mime_type=None):
    model_name_str = model
    if isinstance(model, dict):
        model_name_str = model.get("model", "gemini-flash-lite-latest")
        if model.get("is_custom"):
            res = await _openai_api_async(model_name_str, prompt, model.get("endpoint"), model.get("api_key"), response_mime_type)
            return res, "finished"
    model = model_name_str

    if "gemini" in model.lower():
        gemini_endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/"
        res = await _openai_api_async(model, prompt, gemini_endpoint, api_key, response_mime_type)
        # Note: _openai_api_async doesn't currently parse the finish reason explicitly, 
        # so we assume "finished" if it succeeds without exception. 
        # If max tokens were hit, we'd need to parse the raw openai response, but for now this bypass is critical to prevent timeouts.
        return res, "finished"

    max_retries = 10
    client = get_gemini_client(api_key)
    try:
        messages = map_history_to_gemini(chat_history)
        messages.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt)]))
        
        async def _make_call():
            for i in range(max_retries):
                try:
                    config_args = {"temperature": 0}
                    if response_mime_type:
                        config_args["response_mime_type"] = response_mime_type
                        
                    await wait_for_llm_slot_async()
                    try:
                        response = await client.aio.models.generate_content(
                            model=model,
                            contents=messages,
                            config=types.GenerateContentConfig(**config_args)
                        )
                    finally:
                        release_llm_slot()
                    
                    uid = current_user_id.get()
                    if uid and hasattr(response, 'usage_metadata') and response.usage_metadata:
                        pt = getattr(response.usage_metadata, 'prompt_token_count', 0)
                        ct = getattr(response.usage_metadata, 'candidates_token_count', 0)
                        if pt or ct:
                            asyncio.create_task(log_token_usage_async(uid, model, pt, ct))
                            
                    try:
                        if response.candidates and response.candidates[0].finish_reason:
                            reason = response.candidates[0].finish_reason
                            if reason.name == "MAX_TOKENS" or reason == types.FinishReason.MAX_TOKENS:
                                return response.text, "max_output_reached"
                    except Exception:
                        pass
                    return response.text, "finished"

                except Exception as e:
                    if i < max_retries - 1:
                        print(f"[LLM] Temporary API error: {e}. Retrying async ({i+1}/{max_retries})...")
                        sleep_time = (2 ** i) + random.uniform(0, 1)
                        await asyncio.sleep(min(sleep_time, 20))
                    else:
                        logging.error(f"Error: {e}")
                        logging.error('Max retries reached for prompt: ' + prompt[:50] + "...")
                        return "Error", "error"
        return await _make_call()
    finally:
        try:
            await client.aio.aclose()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass


def ChatGPT_API_with_finish_reason(model, prompt, api_key=CHATGPT_API_KEY, chat_history=None, response_mime_type=None):
    model_name_str = model
    if isinstance(model, dict):
        model_name_str = model.get("model", "gemini-flash-lite-latest")
        if model.get("is_custom"):
            res = _openai_api_sync(model_name_str, prompt, model.get("endpoint"), model.get("api_key"), response_mime_type)
            return res, "finished"
    model = model_name_str

    max_retries = 10
    client = get_gemini_client(api_key)
    for i in range(max_retries):
        try:
            messages = map_history_to_gemini(chat_history)
            messages.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt)]))
            
            config_args = {"temperature": 0}
            if response_mime_type:
                config_args["response_mime_type"] = response_mime_type
                
            wait_for_llm_slot_sync()
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=messages,
                    config=types.GenerateContentConfig(**config_args)
                )
            finally:
                release_llm_slot()
            
            uid = current_user_id.get()
            if uid and hasattr(response, 'usage_metadata') and response.usage_metadata:
                pt = getattr(response.usage_metadata, 'prompt_token_count', 0)
                ct = getattr(response.usage_metadata, 'candidates_token_count', 0)
                if pt or ct:
                    log_token_usage_sync(uid, model, pt, ct)
                    
            try:
                if response.candidates and response.candidates[0].finish_reason:
                    reason = response.candidates[0].finish_reason
                    if reason.name == "MAX_TOKENS" or reason == types.FinishReason.MAX_TOKENS:
                        return response.text, "max_output_reached"
            except Exception:
                pass
            return response.text, "finished"

        except Exception as e:
            if i < max_retries - 1:
                print(f"[LLM] Temporary API error: {e}. Retrying sync ({i+1}/{max_retries})...")
                sleep_time = (2 ** i) + random.uniform(0, 1)
                time.sleep(min(sleep_time, 20))  # Max sleep 20s
            else:
                logging.error(f"Error: {e}")
                logging.error('Max retries reached for prompt: ' + prompt[:50] + "...")
                return "Error", "error"



def _openai_api_sync(model_name, prompt, endpoint, api_key, response_mime_type=None, image_paths=None, image_bytes=None):
    try:
        from openai import OpenAI
        import httpx
        safe_api_key = api_key if isinstance(api_key, str) and api_key.strip() else "EMPTY"
        client = OpenAI(base_url=endpoint, api_key=safe_api_key, http_client=httpx.Client(timeout=120.0))
        try:
            response_format = {"type": "json_object"} if response_mime_type == "application/json" else None
            
            messages = []
            if image_paths or image_bytes:
                import base64
                from PIL import Image
                import io
                
                content_list = [{"type": "text", "text": prompt}]
                
                total_images = 0
                if image_paths:
                    for img_path in image_paths:
                        if total_images >= 2:
                            break
                        try:
                            img = Image.open(img_path)
                            img_byte_arr = io.BytesIO()
                            img_format = img.format if img.format else "PNG"
                            mime_type = f"image/{img_format.lower()}"
                            img.save(img_byte_arr, format=img_format)
                            b64_str = base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')
                            content_list.append({
                                "type": "image_url",
                                "image_url": {"url": f"data:{mime_type};base64,{b64_str}"}
                            })
                            total_images += 1
                        except Exception as e:
                            logging.error(f"Error loading image {img_path}: {e}")
                            
                if image_bytes:
                    for img_data in image_bytes:
                        if total_images >= 2:
                            break
                        try:
                            b64_str = base64.b64encode(img_data).decode('utf-8')
                            content_list.append({
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{b64_str}"}
                            })
                            total_images += 1
                        except Exception as e:
                            logging.error(f"Error parsing image bytes: {e}")
                            
                messages.append({"role": "user", "content": content_list})
            else:
                messages.append({"role": "user", "content": prompt})
                
            wait_for_llm_slot_sync()
            try:
                completion = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0,
                    response_format=response_format
                )
            finally:
                release_llm_slot()
            return completion.choices[0].message.content
        finally:
            client.close()
    except Exception as e:
        logging.error(f"[OpenAI Sync] API Error: {e}")
        return "Error"

async def _openai_api_async(model_name, prompt, endpoint, api_key, response_mime_type=None):
    try:
        from openai import AsyncOpenAI
        import httpx
        safe_api_key = api_key if isinstance(api_key, str) and api_key.strip() else "EMPTY"
        client = AsyncOpenAI(base_url=endpoint, api_key=safe_api_key, http_client=httpx.AsyncClient(timeout=120.0))
        response_format = {"type": "json_object"} if response_mime_type == "application/json" else None
        
        try:
            max_retries = 3
            for i in range(max_retries):
                try:
                    await wait_for_llm_slot_async()
                    try:
                        completion = await client.chat.completions.create(
                            model=model_name,
                            messages=[{"role": "user", "content": prompt}],
                            temperature=0,
                            response_format=response_format
                        )
                    finally:
                        release_llm_slot()
                    return completion.choices[0].message.content
                except Exception as inner_e:
                    if i < max_retries - 1:
                        print(f"[OpenAI Async] Temporary API error: {inner_e}. Retrying ({i+1}/{max_retries})...")
                        sleep_time = (2 ** i) + random.uniform(0, 1)
                        await asyncio.sleep(min(sleep_time, 20))
                    else:
                        raise inner_e
        finally:
            await client.close()
    except Exception as e:
        logging.error(f"[OpenAI Async] API Error: {e}")
        return "Error"

async def _openai_api_async_stream(model_name, prompt, endpoint, api_key, image_paths=None, user_id=None):
    try:
        from openai import AsyncOpenAI
        import httpx
        safe_api_key = api_key if isinstance(api_key, str) and api_key.strip() else "EMPTY"
        client = AsyncOpenAI(base_url=endpoint, api_key=safe_api_key, http_client=httpx.AsyncClient(timeout=120.0))
        
        try:
            messages = []
            if image_paths:
                import base64
                from PIL import Image
                import io
                
                content_list = [{"type": "text", "text": prompt}]
                
                total_images = 0
                for img_path in image_paths:
                    if total_images >= 2:
                        break
                    try:
                        img = Image.open(img_path)
                        img_byte_arr = io.BytesIO()
                        img_format = img.format if img.format else "PNG"
                        mime_type = f"image/{img_format.lower()}"
                        img.save(img_byte_arr, format=img_format)
                        b64_str = base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')
                        content_list.append({
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{b64_str}"}
                        })
                        total_images += 1
                    except Exception as e:
                        logging.error(f"Error loading image {img_path}: {e}")
                        
                messages.append({"role": "user", "content": content_list})
            else:
                messages.append({"role": "user", "content": prompt})
                
            await wait_for_llm_slot_async()
            try:
                response = await client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0,
                    stream=True
                )
                async for chunk in response:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
            finally:
                release_llm_slot()
        finally:
            await client.close()
    except Exception as e:
        logging.error(f"[OpenAI Async Stream] API Error: {e}")
        yield "Error: Could not generate streaming response."

def ChatGPT_API(model, prompt, api_key=CHATGPT_API_KEY, chat_history=None, response_mime_type=None):
    model_name_str = model
    if isinstance(model, dict):
        model_name_str = model.get("model", "gemini-flash-lite-latest")
        if model.get("is_custom"):
            return _openai_api_sync(model_name_str, prompt, model.get("endpoint"), model.get("api_key"), response_mime_type)
    model = model_name_str

    max_retries = 10
    client = get_gemini_client(api_key)
    for i in range(max_retries):
        try:
            messages = map_history_to_gemini(chat_history)
            messages.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt)]))
            
            config_args = {"temperature": 0}
            if response_mime_type:
                config_args["response_mime_type"] = response_mime_type
                
            wait_for_llm_slot_sync()
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=messages,
                    config=types.GenerateContentConfig(**config_args)
                )
            finally:
                release_llm_slot()
            
            uid = current_user_id.get()
            if uid and hasattr(response, 'usage_metadata') and response.usage_metadata:
                pt = getattr(response.usage_metadata, 'prompt_token_count', 0)
                ct = getattr(response.usage_metadata, 'candidates_token_count', 0)
                if pt or ct:
                    log_token_usage_sync(uid, model, pt, ct)
   
            return response.text
        except Exception as e:
            if i < max_retries - 1:
                print(f"[LLM] Temporary API error: {e}. Retrying sync ({i+1}/{max_retries})...")
                import time
                sleep_time = (2 ** i) + random.uniform(0, 1)
                time.sleep(min(sleep_time, 20))  # Max sleep 20s before retrying
            else:
                logging.error(f"Error: {e}")
                logging.error('Max retries reached for prompt: ' + prompt[:50] + '...')
                return "Error"
            

async def ChatGPT_API_async(model, prompt, api_key=CHATGPT_API_KEY, response_mime_type=None):
    model_name_str = model
    if isinstance(model, dict):
        model_name_str = model.get("model", "gemini-flash-lite-latest")
        if model.get("is_custom"):
            return await _openai_api_async(model_name_str, prompt, model.get("endpoint"), model.get("api_key"), response_mime_type)
    model = model_name_str

    if "gemini" in model.lower():
        # Bypass buggy google.genai aiohttp SDK on Windows by using the official OpenAI-compatible endpoint!
        gemini_endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/"
        return await _openai_api_async(model, prompt, gemini_endpoint, api_key, response_mime_type)

    max_retries = 3
    client = get_gemini_client(api_key)
    try:
        messages = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        
        async def _make_call():
            for i in range(max_retries):
                try:
                    config_args = {"temperature": 0}
                    if response_mime_type:
                        config_args["response_mime_type"] = response_mime_type
                        
                    await wait_for_llm_slot_async()
                    try:
                        response = await client.aio.models.generate_content(
                            model=model,
                            contents=messages,
                            config=types.GenerateContentConfig(**config_args)
                        )
                    finally:
                        release_llm_slot()
                    
                    uid = current_user_id.get()
                    if uid and hasattr(response, 'usage_metadata') and response.usage_metadata:
                        pt = getattr(response.usage_metadata, 'prompt_token_count', 0)
                        ct = getattr(response.usage_metadata, 'candidates_token_count', 0)
                        if pt or ct:
                            log_token_usage_sync(uid, model, pt, ct)
                            
                    return response.text
                except Exception as e:
                    if i < max_retries - 1:
                        print(f"[LLM] Temporary API error: {type(e).__name__}({e}). Retrying async ({i+1}/{max_retries})...")
                        import traceback
                        traceback.print_exc()
                        sleep_time = (2 ** i) + random.uniform(0, 1)  # Exponential backoff with jitter
                        await asyncio.sleep(min(sleep_time, 20))
                    else:
                        logging.error(f"Error: {type(e).__name__}({e})")
                        logging.error('Max retries reached for prompt: ' + prompt[:50] + '...')
                        return "Error"
                        
        return await _make_call()
    finally:
        try:
            await client.aio.aclose()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass
            
            
def log_token_usage_sync(user_id: int, model_name: str, prompt_tokens: int, completion_tokens: int):
    if not user_id or not model_name:
        return
    try:
        total_tokens = prompt_tokens + completion_tokens
        import sqlite3
        from app.rag_engine import DB_PATH
        conn = sqlite3.connect(str(DB_PATH), timeout=30)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO token_usage (user_id, model_name, prompt_tokens, completion_tokens, total_tokens)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, model_name, prompt_tokens, completion_tokens, total_tokens))
        conn.commit()
        conn.close()
    except Exception as e:
        logging.error(f"Failed to sync log token usage: {e}")

async def log_token_usage_async(user_id: int, model_name: str, prompt_tokens: int, completion_tokens: int):
    if not user_id or not model_name:
        return
    try:
        total_tokens = prompt_tokens + completion_tokens
        def _insert():
            import sqlite3
            from app.rag_engine import DB_PATH
            conn = sqlite3.connect(str(DB_PATH), timeout=30)
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO token_usage (user_id, model_name, prompt_tokens, completion_tokens, total_tokens)
                VALUES (?, ?, ?, ?, ?)
            ''', (user_id, model_name, prompt_tokens, completion_tokens, total_tokens))
            conn.commit()
            conn.close()
        
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _insert)
    except Exception as e:
        logging.error(f"Failed to log token usage: {e}")

async def ChatGPT_API_async_stream(model, prompt, api_key=CHATGPT_API_KEY, image_paths=None, user_id=None):
    model_name_str = model
    if isinstance(model, dict):
        model_name_str = model.get("model", "gemini-flash-lite-latest")
        if model.get("is_custom"):
            async for chunk in _openai_api_async_stream(model_name_str, prompt, model.get("endpoint"), model.get("api_key"), image_paths, user_id):
                yield chunk
            return
    model = model_name_str

    if "gemini" in model.lower():
        gemini_endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/"
        async for chunk in _openai_api_async_stream(model, prompt, gemini_endpoint, api_key, image_paths, user_id):
            yield chunk
        return

    max_retries = 10
    client = get_gemini_client(api_key)
    try:
        parts = [types.Part.from_text(text=prompt)]
        
        if image_paths:
            import io
            from PIL import Image
            for img_path in image_paths:
                try:
                    img = Image.open(img_path)
                    img_byte_arr = io.BytesIO()
                    # Determine format from file extension, default to PNG
                    img_format = img.format if img.format else "PNG"
                    img.save(img_byte_arr, format=img_format)
                    
                    mime_type = "image/png"
                    if img_format.lower() in ["jpg", "jpeg"]:
                        mime_type = "image/jpeg"
                        
                    parts.append(types.Part.from_bytes(data=img_byte_arr.getvalue(), mime_type=mime_type))
                except Exception as e:
                    logging.error(f"Error loading image {img_path}: {e}")
                    
        messages = [types.Content(role="user", parts=parts)]
        
        async def _make_call():
            for i in range(max_retries):
                try:
                    await wait_for_llm_slot_async()
                    try:
                        # Use Google GenAI Streaming API
                        # Note: We do not yield inside the retry loop directly on failure, we accumulate then retry
                        # However since we return the async generator, if it fails mid-stream, retrying is problematic
                        # Here we retry fetching the stream object itself.
                        response_stream = await client.aio.models.generate_content_stream(
                            model=model,
                            contents=messages,
                            config=types.GenerateContentConfig(temperature=0)
                        )
                        
                        max_pt = 0
                        max_ct = 0
                        async for chunk in response_stream:
                            if chunk.text:
                                yield chunk.text
                            if hasattr(chunk, 'usage_metadata') and chunk.usage_metadata and user_id:
                                pt = getattr(chunk.usage_metadata, 'prompt_token_count', 0)
                                ct = getattr(chunk.usage_metadata, 'candidates_token_count', 0)
                                if pt > max_pt: max_pt = pt
                                if ct > max_ct: max_ct = ct
                        
                        if user_id and (max_pt > 0 or max_ct > 0):
                            asyncio.create_task(log_token_usage_async(user_id, model, max_pt, max_ct))
                            
                        return # Exit successfully
                    finally:
                        release_llm_slot()
                        
                except Exception as e:
                    if i < max_retries - 1:
                        print(f"[LLM] Temporary Stream API error: {type(e).__name__}({e}). Retrying async stream ({i+1}/{max_retries})...")
                        import traceback
                        traceback.print_exc()
                        sleep_time = (2 ** i) + random.uniform(0, 1)
                        await asyncio.sleep(min(sleep_time, 20))
                    else:
                        logging.error(f"Stream Error: {e}")
                        logging.error('Max retries reached for stream prompt: ' + prompt[:50] + '...')
                        yield "Error: Could not generate streaming response."
                        
        async for text_chunk in _make_call():
            yield text_chunk
    finally:
        try:
            await client.aio.aclose()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass
            
            
def get_json_content(response):
    start_idx = response.find("```json")
    if start_idx != -1:
        start_idx += 7
        response = response[start_idx:]
        
    end_idx = response.rfind("```")
    if end_idx != -1:
        response = response[:end_idx]
    
    json_content = response.strip()
    return json_content
         

def extract_json(content):
    try:
        # First, try to extract JSON enclosed within ```json and ```
        start_idx = content.find("```json")
        if start_idx != -1:
            start_idx += 7  # Adjust index to start after the delimiter
            end_idx = content.rfind("```")
            json_content = content[start_idx:end_idx].strip()
        else:
            # If no delimiters, assume entire content could be JSON
            json_content = content.strip()

        # Clean up common issues that might cause parsing errors
        json_content = json_content.replace('None', 'null')  # Replace Python None with JSON null
        json_content = json_content.replace('\n', ' ').replace('\r', ' ')  # Remove newlines
        json_content = ' '.join(json_content.split())  # Normalize whitespace

        # Attempt to parse and return the JSON object
        return json.loads(json_content)
    except json.JSONDecodeError as e:
        logging.error(f"Failed to extract JSON: {e}")
        # Try to clean up the content further if initial parsing fails
        try:
            # Remove any trailing commas before closing brackets/braces
            json_content = json_content.replace(',]', ']').replace(',}', '}')
            return json.loads(json_content)
        except:
            logging.error("Failed to parse JSON even after cleanup")
            return {}
    except Exception as e:
        logging.error(f"Unexpected error while extracting JSON: {e}")
        return {}

def write_node_id(data, node_id=0):
    if isinstance(data, dict):
        data['node_id'] = str(node_id).zfill(4)
        node_id += 1
        for key in list(data.keys()):
            if 'nodes' in key:
                node_id = write_node_id(data[key], node_id)
    elif isinstance(data, list):
        for index in range(len(data)):
            node_id = write_node_id(data[index], node_id)
    return node_id

def get_nodes(structure):
    if isinstance(structure, dict):
        structure_node = copy.deepcopy(structure)
        structure_node.pop('nodes', None)
        nodes = [structure_node]
        for key in list(structure.keys()):
            if 'nodes' in key:
                nodes.extend(get_nodes(structure[key]))
        return nodes
    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(get_nodes(item))
        return nodes
    
def structure_to_list(structure):
    if isinstance(structure, dict):
        nodes = []
        nodes.append(structure)
        if 'nodes' in structure:
            nodes.extend(structure_to_list(structure['nodes']))
        return nodes
    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(structure_to_list(item))
        return nodes

    
def get_leaf_nodes(structure):
    if isinstance(structure, dict):
        if not structure['nodes']:
            structure_node = copy.deepcopy(structure)
            structure_node.pop('nodes', None)
            return [structure_node]
        else:
            leaf_nodes = []
            for key in list(structure.keys()):
                if 'nodes' in key:
                    leaf_nodes.extend(get_leaf_nodes(structure[key]))
            return leaf_nodes
    elif isinstance(structure, list):
        leaf_nodes = []
        for item in structure:
            leaf_nodes.extend(get_leaf_nodes(item))
        return leaf_nodes

def is_leaf_node(data, node_id):
    # Helper function to find the node by its node_id
    def find_node(data, node_id):
        if isinstance(data, dict):
            if data.get('node_id') == node_id:
                return data
            for key in data.keys():
                if 'nodes' in key:
                    result = find_node(data[key], node_id)
                    if result:
                        return result
        elif isinstance(data, list):
            for item in data:
                result = find_node(item, node_id)
                if result:
                    return result
        return None

    # Find the node with the given node_id
    node = find_node(data, node_id)

    # Check if the node is a leaf node
    if node and not node.get('nodes'):
        return True
    return False

def get_last_node(structure):
    return structure[-1]


def extract_text_from_pdf(pdf_path):
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    ###return text not list 
    text=""
    for page_num in range(len(pdf_reader.pages)):
        page = pdf_reader.pages[page_num]
        text+=page.extract_text()
    return text

def get_pdf_title(pdf_path):
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    meta = pdf_reader.metadata
    title = meta.title if meta and meta.title else 'Untitled'
    return title

def get_text_of_pages(pdf_path, start_page, end_page, tag=True):
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    text = ""
    for page_num in range(start_page-1, end_page):
        page = pdf_reader.pages[page_num]
        page_text = page.extract_text()
        if tag:
            text += f"<start_index_{page_num+1}>\n{page_text}\n<end_index_{page_num+1}>\n"
        else:
            text += page_text
    return text

def get_first_start_page_from_text(text):
    start_page = -1
    start_page_match = re.search(r'<start_index_(\d+)>', text)
    if start_page_match:
        start_page = int(start_page_match.group(1))
    return start_page

def get_last_start_page_from_text(text):
    start_page = -1
    # Find all matches of start_index tags
    start_page_matches = re.finditer(r'<start_index_(\d+)>', text)
    # Convert iterator to list and get the last match if any exist
    matches_list = list(start_page_matches)
    if matches_list:
        start_page = int(matches_list[-1].group(1))
    return start_page


def sanitize_filename(filename, replacement='-'):
    # In Linux, only '/' and '\0' (null) are invalid in filenames.
    # Null can't be represented in strings, so we only handle '/'.
    return filename.replace('/', replacement)

def get_pdf_name(pdf_path):
    # Extract PDF name
    if isinstance(pdf_path, str):
        pdf_name = os.path.basename(pdf_path)
    elif isinstance(pdf_path, BytesIO):
        pdf_reader = PyPDF2.PdfReader(pdf_path)
        meta = pdf_reader.metadata
        pdf_name = meta.title if meta and meta.title else 'Untitled'
        pdf_name = sanitize_filename(pdf_name)
    return pdf_name


class JsonLogger:
    def __init__(self, file_path):
        # Extract PDF name for logger name
        pdf_name = get_pdf_name(file_path)
            
        current_time = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.filename = f"{pdf_name}_{current_time}.json"
        os.makedirs("./logs", exist_ok=True)
        # Initialize empty list to store all messages
        self.log_data = []

    def log(self, level, message, **kwargs):
        if isinstance(message, dict):
            self.log_data.append(message)
        else:
            self.log_data.append({'message': message})
        # Add new message to the log data
        
        # Write entire log data to file
        with open(self._filepath(), "w") as f:
            json.dump(self.log_data, f, indent=2)

    def info(self, message, **kwargs):
        self.log("INFO", message, **kwargs)

    def error(self, message, **kwargs):
        self.log("ERROR", message, **kwargs)

    def debug(self, message, **kwargs):
        self.log("DEBUG", message, **kwargs)

    def exception(self, message, **kwargs):
        kwargs["exception"] = True
        self.log("ERROR", message, **kwargs)

    def _filepath(self):
        return os.path.join("logs", self.filename)
    



def list_to_tree(data):
    def get_parent_structure(structure):
        """Helper function to get the parent structure code"""
        if not structure:
            return None
        parts = str(structure).split('.')
        return '.'.join(parts[:-1]) if len(parts) > 1 else None
    
    # First pass: Create nodes and track parent-child relationships
    nodes = {}
    root_nodes = []
    
    for item in data:
        structure = item.get('structure')
        node = {
            'title': item.get('title'),
            'start_index': item.get('start_index'),
            'end_index': item.get('end_index'),
            'nodes': []
        }
        
        nodes[structure] = node
        
        # Find parent
        parent_structure = get_parent_structure(structure)
        
        if parent_structure:
            # Add as child to parent if parent exists
            if parent_structure in nodes:
                nodes[parent_structure]['nodes'].append(node)
            else:
                root_nodes.append(node)
        else:
            # No parent, this is a root node
            root_nodes.append(node)
    
    # Helper function to clean empty children arrays
    def clean_node(node):
        if not node['nodes']:
            del node['nodes']
        else:
            for child in node['nodes']:
                clean_node(child)
        return node
    
    # Clean and return the tree
    return [clean_node(node) for node in root_nodes]

def add_preface_if_needed(data):
    if not isinstance(data, list) or not data:
        return data

    if data[0]['physical_index'] is not None and data[0]['physical_index'] > 1:
        preface_node = {
            "structure": "0",
            "title": "Preface",
            "physical_index": 1,
        }
        data.insert(0, preface_node)
    return data


import re

def remove_footer_page_numbers(text):
    if not text:
        return text
    
    lines = text.split('\n')
    
    # We examine from bottom to top to find the first non-empty line
    last_non_empty_idx = -1
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip():
            last_non_empty_idx = i
            break
            
    if last_non_empty_idx >= 0:
        line = lines[last_non_empty_idx].strip()
        
        # Pattern 1: Explicit page number formats
        pattern1 = r'^(?:-?\s*(?:Page|page|페이지|p\.|P\.)?\s*\d+\s*(?:/|of)?\s*(?:\d+)?\s*-?)$'
        # Pattern 2: Only digits and non-word characters (symbols, brackets, etc.) with max 5 digits
        pattern2 = r'^[\W_]*\d+[\W_]*$'
        
        if re.match(pattern1, line) or (re.match(pattern2, line) and len(re.findall(r'\d', line)) <= 5):
            lines[last_non_empty_idx] = ''
            
            # Sometimes there's another stray number/symbol line right above it, let's optionally clear that too
            second_last_idx = -1
            for i in range(last_non_empty_idx - 1, -1, -1):
                if lines[i].strip():
                    second_last_idx = i
                    break
            if second_last_idx >= 0:
                line2 = lines[second_last_idx].strip()
                if re.match(pattern1, line2) or (re.match(pattern2, line2) and len(re.findall(r'\d', line2)) <= 5):
                    lines[second_last_idx] = ''
            
    return '\n'.join(lines)

def get_page_tokens(pdf_path, model="gpt-4o-2024-11-20", pdf_parser="PyMuPDF"):
    try:
        enc = tiktoken.encoding_for_model(model)
    except KeyError:
        enc = tiktoken.get_encoding("cl100k_base")
    if pdf_parser == "PyPDF2":
        pdf_reader = PyPDF2.PdfReader(pdf_path)
        page_list = []
        for page_num in range(len(pdf_reader.pages)):
            page = pdf_reader.pages[page_num]
            page_text = page.extract_text()
            page_text = remove_footer_page_numbers(page_text)
            token_length = len(enc.encode(page_text))
            page_list.append((page_text, token_length))
        return page_list
    elif pdf_parser == "PyMuPDF":
        if isinstance(pdf_path, BytesIO):
            pdf_stream = pdf_path
            doc = pymupdf.open(stream=pdf_stream, filetype="pdf")
            # Save stream to a temp file for opendataloader
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(pdf_stream.getvalue())
                od_path = tmp.name
        elif isinstance(pdf_path, str) and os.path.isfile(pdf_path) and pdf_path.lower().endswith(".pdf"):
            doc = pymupdf.open(pdf_path)
            od_path = pdf_path
            
        opendataloader_texts = extract_pdf_texts_opendataloader(od_path)
        
        if isinstance(pdf_path, BytesIO):
            try:
                os.remove(od_path)
            except Exception:
                pass
                
        page_list = []
        for index, page in enumerate(doc):
            response = None
            page_text = opendataloader_texts.get(index, "")
            page_text = remove_footer_page_numbers(page_text)
            
            # OCR Fallback if page is image-based (no readable text)
            if not page_text.strip():
                try:
                    pix = page.get_pixmap(dpi=150) # Moderate resolution for OCR
                    img_bytes = pix.tobytes("png")
                    prompt_text = "Please extract all the text from this document image accurately. Preserve the original language and formatting as much as possible. Do not include any explanations."
                    
                    from app.rag_engine import get_sys_setting
                    ocr_model_cfg = get_sys_setting("ocr_llm_model", "gemini-flash-lite-latest")
                    
                    uid = current_user_id.get()
                    
                    if isinstance(ocr_model_cfg, dict) and ocr_model_cfg.get("is_custom"):
                        result_text = _openai_api_sync(
                            model_name=ocr_model_cfg.get("model", "gpt-4o"), 
                            prompt=prompt_text, 
                            endpoint=ocr_model_cfg.get("endpoint"), 
                            api_key=ocr_model_cfg.get("api_key"),
                            image_bytes=[img_bytes]
                        )
                        class DummyResponse:
                            pass
                        response = DummyResponse()
                        response.text = result_text
                    else:
                        client = get_gemini_client()
                        message_parts = [
                            types.Part.from_text(text=prompt_text),
                            types.Part.from_bytes(data=img_bytes, mime_type="image/png")
                        ]
                        response = client.models.generate_content(
                            model=ocr_model_cfg if isinstance(ocr_model_cfg, str) else ocr_model_cfg.get("model", "gemini-flash-lite-latest"),
                            contents=message_parts
                        )
                        if uid and hasattr(response, 'usage_metadata') and response.usage_metadata:
                            pt = getattr(response.usage_metadata, 'prompt_token_count', 0)
                            ct = getattr(response.usage_metadata, 'candidates_token_count', 0)
                            if pt or ct:
                                log_token_usage_sync(uid, ocr_model_cfg if isinstance(ocr_model_cfg, str) else ocr_model_cfg.get("model", "gemini-flash-lite-latest"), pt, ct)
                            
                    if response and response.text:
                        page_text = response.text
                        print(f"OCR Fallback: Successfully extracted {len(page_text)} chars from page {index+1}")
                    else:
                        page_text = "\n[이미지 텍스트 인식 실패]\n"
                except Exception as e:
                    print(f"OCR Fallback Error on page {index+1}: {e}")
                    page_text = "\n[이미지 텍스트 인식 실패]\n"
                    
            if response and hasattr(response, 'text') and response.text: # OCR branch could have added footer back so we strip it again just in case, or rather just strip at the end
                page_text = remove_footer_page_numbers(page_text)

            token_length = len(enc.encode(page_text))
            page_list.append((page_text, token_length))
        return page_list
    else:
        raise ValueError(f"Unsupported PDF parser: {pdf_parser}")

        

def get_text_of_pdf_pages(pdf_pages, start_page, end_page):
    text = ""
    for page_num in range(start_page-1, end_page):
        # Inject explicit physical page marker to prevent LLM confusion
        text += f"\n[실제 문서 페이지: {page_num+1}]\n" + pdf_pages[page_num][0]
    return text

def get_text_of_pdf_pages_with_labels(pdf_pages, start_page, end_page):
    text = ""
    for page_num in range(start_page-1, end_page):
        text += f"<physical_index_{page_num+1}>\n{pdf_pages[page_num][0]}\n<physical_index_{page_num+1}>\n"
    return text

def get_number_of_pages(pdf_path):
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    num = len(pdf_reader.pages)
    return num



def post_processing(structure, end_physical_index):
    # First convert page_number to start_index in flat list
    for i, item in enumerate(structure):
        item['start_index'] = item.get('physical_index')
        if i < len(structure) - 1:
            if structure[i + 1].get('appear_start') == 'yes':
                item['end_index'] = structure[i + 1]['physical_index']-1
            else:
                item['end_index'] = structure[i + 1]['physical_index']
        else:
            item['end_index'] = end_physical_index
    tree = list_to_tree(structure)
    if len(tree)!=0:
        return tree
    else:
        ### remove appear_start 
        for node in structure:
            node.pop('appear_start', None)
            node.pop('physical_index', None)
        return structure

def clean_structure_post(data):
    if isinstance(data, dict):
        data.pop('page_number', None)
        data.pop('start_index', None)
        data.pop('end_index', None)
        if 'nodes' in data:
            clean_structure_post(data['nodes'])
    elif isinstance(data, list):
        for section in data:
            clean_structure_post(section)
    return data

def remove_fields(data, fields=['text']):
    if isinstance(data, dict):
        return {k: remove_fields(v, fields)
            for k, v in data.items() if k not in fields}
    elif isinstance(data, list):
        return [remove_fields(item, fields) for item in data]
    return data

def print_toc(tree, indent=0):
    for node in tree:
        print('  ' * indent + node['title'])
        if node.get('nodes'):
            print_toc(node['nodes'], indent + 1)

def print_json(data, max_len=40, indent=2):
    def simplify_data(obj):
        if isinstance(obj, dict):
            return {k: simplify_data(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [simplify_data(item) for item in obj]
        elif isinstance(obj, str) and len(obj) > max_len:
            return obj[:max_len] + '...'
        else:
            return obj
    
    simplified = simplify_data(data)
    print(json.dumps(simplified, indent=indent, ensure_ascii=False))


def remove_structure_text(data):
    if isinstance(data, dict):
        data.pop('text', None)
        if 'nodes' in data:
            remove_structure_text(data['nodes'])
    elif isinstance(data, list):
        for item in data:
            remove_structure_text(item)
    return data


def check_token_limit(structure, limit=110000):
    list = structure_to_list(structure)
    for node in list:
        num_tokens = count_tokens(node['text'], model='gpt-4o')
        if num_tokens > limit:
            print(f"Node ID: {node['node_id']} has {num_tokens} tokens")
            print("Start Index:", node['start_index'])
            print("End Index:", node['end_index'])
            print("Title:", node['title'])
            print("\n")


def convert_physical_index_to_int(data):
    if isinstance(data, list):
        for i in range(len(data)):
            # Check if item is a dictionary and has 'physical_index' key
            if isinstance(data[i], dict) and 'physical_index' in data[i]:
                if isinstance(data[i]['physical_index'], str):
                    if data[i]['physical_index'].startswith('<physical_index_'):
                        data[i]['physical_index'] = int(data[i]['physical_index'].split('_')[-1].rstrip('>').strip())
                    elif data[i]['physical_index'].startswith('physical_index_'):
                        data[i]['physical_index'] = int(data[i]['physical_index'].split('_')[-1].strip())
    elif isinstance(data, str):
        if data.startswith('<physical_index_'):
            data = int(data.split('_')[-1].rstrip('>').strip())
        elif data.startswith('physical_index_'):
            data = int(data.split('_')[-1].strip())
        # Check data is int
        if isinstance(data, int):
            return data
        else:
            return None
    return data


def convert_page_to_int(data):
    for item in data:
        if 'page' in item and isinstance(item['page'], str):
            try:
                item['page'] = int(item['page'])
            except ValueError:
                # Keep original value if conversion fails
                pass
    return data


def add_node_text(node, pdf_pages):
    if isinstance(node, dict):
        start_page = node.get('start_index')
        end_page = node.get('end_index')
        node['text'] = get_text_of_pdf_pages(pdf_pages, start_page, end_page)
        if 'nodes' in node:
            add_node_text(node['nodes'], pdf_pages)
    elif isinstance(node, list):
        for index in range(len(node)):
            add_node_text(node[index], pdf_pages)
    return


def add_node_text_with_labels(node, pdf_pages):
    if isinstance(node, dict):
        start_page = node.get('start_index')
        end_page = node.get('end_index')
        node['text'] = get_text_of_pdf_pages_with_labels(pdf_pages, start_page, end_page)
        if 'nodes' in node:
            add_node_text_with_labels(node['nodes'], pdf_pages)
    elif isinstance(node, list):
        for index in range(len(node)):
            add_node_text_with_labels(node[index], pdf_pages)
    return


async def generate_node_summary(node, model=None):
    text_to_summarize = node.get('text', '')
    
    # Truncate text to prevent LLM engine deadlocks (Waiting state) when node covers many pages
    # 50,000 chars is ~12,500 tokens. If larger, we take the beginning and the end.
    max_chars = 50000
    if len(text_to_summarize) > max_chars:
        text_to_summarize = text_to_summarize[:40000] + "\n\n...[중략: 텍스트 길이 초과로 생략됨]...\n\n" + text_to_summarize[-10000:]
        
    prompt = f"""You are given a part of a document, your task is to generate a description of the partial document about what are main points covered in the partial document.

    Partial Document Text: {text_to_summarize}
    
    Directly return the description, do not include any other text.
    """
    response = await ChatGPT_API_async(model, prompt)
    return response


async def generate_summaries_for_structure(structure, model=None, progress_callback=None):
    nodes = structure_to_list(structure)
    total_nodes = len(nodes)
    completed_nodes = 0

    sem = asyncio.Semaphore(5)

    async def generate_and_track(node):
        nonlocal completed_nodes
        async with sem:
            summary = await generate_node_summary(node, model=model)
        node['summary'] = summary
        
        completed_nodes += 1
        if progress_callback and total_nodes > 0:
            # Scale from 50% to 90% during summarization
            percent = 50 + int((completed_nodes / total_nodes) * 40)
            progress_callback(f"요약문 생성 중 ({completed_nodes}/{total_nodes})...", percent)
        return summary

    tasks = [generate_and_track(node) for node in nodes]
    await asyncio.gather(*tasks)
    
    return structure


def create_clean_structure_for_description(structure):
    """
    Create a clean structure for document description generation,
    excluding unnecessary fields like 'text'.
    """
    if isinstance(structure, dict):
        clean_node = {}
        # Only include essential fields for description
        for key in ['title', 'node_id', 'summary', 'prefix_summary']:
            if key in structure:
                clean_node[key] = structure[key]
        
        # Recursively process child nodes
        if 'nodes' in structure and structure['nodes']:
            clean_node['nodes'] = create_clean_structure_for_description(structure['nodes'])
        
        return clean_node
    elif isinstance(structure, list):
        return [create_clean_structure_for_description(item) for item in structure]
    else:
        return structure


async def generate_doc_description(structure, model=None):
    prompt = f"""Your are an expert in generating descriptions for a document.
    You are given a structure of a document. Your task is to generate a one-sentence description for the document, which makes it easy to distinguish the document from other documents.
        
    Document Structure: {structure}
    
    Directly return the description, do not include any other text.
    """
    response = await ChatGPT_API_async(model, prompt)
    return response


def reorder_dict(data, key_order):
    if not key_order:
        return data
    return {key: data[key] for key in key_order if key in data}


def format_structure(structure, order=None):
    if not order:
        return structure
    if isinstance(structure, dict):
        if 'nodes' in structure:
            structure['nodes'] = format_structure(structure['nodes'], order)
        if not structure.get('nodes'):
            structure.pop('nodes', None)
        structure = reorder_dict(structure, order)
    elif isinstance(structure, list):
        structure = [format_structure(item, order) for item in structure]
    return structure


class ConfigLoader:
    def __init__(self, default_path: str = None):
        if default_path is None:
            default_path = Path(__file__).parent / "config.yaml"
        self._default_dict = self._load_yaml(default_path)

    @staticmethod
    def _load_yaml(path):
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _validate_keys(self, user_dict):
        unknown_keys = set(user_dict) - set(self._default_dict)
        if unknown_keys:
            raise ValueError(f"Unknown config keys: {unknown_keys}")

    def load(self, user_opt=None) -> config:
        """
        Load the configuration, merging user options with default values.
        """
        if user_opt is None:
            user_dict = {}
        elif isinstance(user_opt, config):
            user_dict = vars(user_opt)
        elif isinstance(user_opt, dict):
            user_dict = user_opt
        else:
            raise TypeError("user_opt must be dict, config(SimpleNamespace) or None")

        self._validate_keys(user_dict)
        merged = {**self._default_dict, **user_dict}
        return config(**merged)