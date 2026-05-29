import asyncio
from typing import List, Dict, Set
from urllib.parse import urlparse, urljoin
import os
import re
import json
import requests
from bs4 import BeautifulSoup
from typing import Optional

class ComprehensiveLinkExtractor:
    """
    웹 페이지에서 발견 가능한 모든 링크를 추출하는 완전한 구현체
    """
    def __init__(self, base_url: str, html: str):
        self.base_url = base_url
        self.html = html
        self.soup = BeautifulSoup(html, "lxml")
        self.found_links: Set[str] = set()

        # base 태그가 있으면 base_url override
        base_tag = self.soup.find("base", href=True)
        if base_tag:
            self.base_url = urljoin(base_url, base_tag["href"])

    def extract_standard_tags(self):
        """a, area, link, form, button 등 표준 href/src/action 속성"""
        tag_attr_map = {
            "a":          ["href"],
            "area":       ["href"],
            "link":       ["href"],
            "form":       ["action"],
            "button":     ["formaction"],
            "input":      ["formaction", "src"],
            "blockquote": ["cite"],
            "q":          ["cite"],
            "ins":        ["cite"],
            "del":        ["cite"],
            "object":     ["data"],
            "embed":      ["src"],
            "iframe":     ["src"],
            "frame":      ["src"],
            "audio":      ["src"],
            "video":      ["src", "poster"],
            "source":     ["src", "srcset"],
            "track":      ["src"],
            "script":     ["src"],
            "img":        ["src", "srcset", "longdesc"],
        }
        for tag, attrs in tag_attr_map.items():
            for el in self.soup.find_all(tag):
                for attr in attrs:
                    val = el.get(attr, "")
                    if attr == "srcset":
                        for part in val.split(","):
                            if part.strip():
                                url = part.strip().split()[0]
                                self._add(url)
                    else:
                        self._add(val)

    def extract_meta_tags(self):
        """og:url, og:image, canonical, alternate, sitemap 등"""
        meta_properties = {
            "og:url", "og:image", "og:image:secure_url",
            "og:audio", "og:video", "twitter:url",
            "twitter:image", "twitter:image:src",
        }
        meta_names = {
            "thumbnail", "msapplication-TileImage",
        }

        for meta in self.soup.find_all("meta"):
            prop = meta.get("property", "") or meta.get("name", "")
            content = meta.get("content", "")
            if prop in meta_properties or prop in meta_names:
                self._add(content)

        link_rels = {
            "canonical", "alternate", "next", "prev",
            "preload", "prefetch", "prerender",
            "sitemap", "shortlink", "amphtml",
            "me", "author", "publisher",
        }
        for el in self.soup.find_all("link", rel=True):
            rels = el.get("rel", [])
            if isinstance(rels, str):
                rels = [rels]
            if set(rels) & link_rels:
                self._add(el.get("href", ""))

    def extract_css_urls(self):
        """style 태그 / inline style 속성 내 url(...) 추출"""
        css_url_re = re.compile(r'url\(["\']?(https?://[^"\')\s]+)["\']?\)', re.I)

        for style_tag in self.soup.find_all("style"):
            for m in css_url_re.finditer(style_tag.string or ""):
                self._add(m.group(1))

        for el in self.soup.find_all(style=True):
            for m in css_url_re.finditer(el["style"]):
                self._add(m.group(1))

    def extract_from_javascript(self):
        """script 태그 / 이벤트 핸들러 / data 속성에서 URL 패턴 및 SPA 라우터 경로 추출"""
        js_sources = []
        for el in self.soup.find_all("script"):
            js_sources.append(el.string or "")
        event_attrs = [
            "onclick", "onsubmit", "onchange", "onmousedown",
            "onmouseup", "ontouchend", "onfocus",
        ]
        for attr in event_attrs:
            for el in self.soup.find_all(attrs={attr: True}):
                js_sources.append(el[attr])

        combined = "\n".join(js_sources)

        abs_url_re = re.compile(r'["\`\'](https?://[A-Za-z0-9\-._~:/?#\[\]@!$&\'()*+,;=%]+)["\`\']')
        for m in abs_url_re.finditer(combined):
            self._add(m.group(1))

        path_re = re.compile(
            r'(?:path|route|to|href|url|redirect|navigate|push(?:State)?|replace(?:State)?)'
            r'\s*[=:(,]\s*["\`\'](/[A-Za-z0-9\-._~/?#\[\]@!$&\'()*+,;=%]*)["\`\']',
            re.I
        )
        for m in path_re.finditer(combined):
            self._add(m.group(1))

        location_re = re.compile(r'location(?:\.href)?\s*=\s*["\`\']([^"\'`\s]+)["\`\']')
        for m in location_re.finditer(combined):
            self._add(m.group(1))

        fetch_re = re.compile(r'(?:fetch|axios\.(?:get|post|put|delete|patch)|open)\s*\(\s*["\`\']([^"\'`\s]+)["\`\']')
        for m in fetch_re.finditer(combined):
            self._add(m.group(1))

    def extract_data_attributes(self):
        data_attr_keywords = [
            "href", "url", "src", "link", "action",
            "target", "goto", "path", "route", "endpoint",
        ]
        pattern = re.compile(r"https?://[^\s'\"<>]+|/[a-zA-Z0-9\-._~/?#@!$&'()*+,;=%]+")

        for el in self.soup.find_all(True):
            for attr, val in el.attrs.items():
                if not isinstance(val, str):
                    continue
                attr_lower = attr.lower()
                if attr_lower.startswith("data-") and any(k in attr_lower for k in data_attr_keywords):
                    for m in pattern.finditer(val):
                        self._add(m.group(0))

    def extract_json_ld(self):
        url_keys = {
            "@id", "url", "sameAs", "image", "contentUrl",
            "thumbnailUrl", "embedUrl", "mainEntityOfPage",
            "discussionUrl", "acquireLicensePage",
        }

        def walk(obj):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k in url_keys and isinstance(v, str):
                        self._add(v)
                    else:
                        walk(v)
            elif isinstance(obj, list):
                for item in obj:
                    walk(item)

        for el in self.soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(el.string or "")
                walk(data)
            except (json.JSONDecodeError, TypeError):
                pass

    def extract_plain_text_urls(self):
        abs_url_re = re.compile(r'https?://[A-Za-z0-9\-._~:/?#\[\]@!$&\'()*+,;=%-]+')
        for text in self.soup.find_all(string=True):
            for m in abs_url_re.finditer(str(text)):
                self._add(m.group(0))

        from bs4 import Comment
        for comment in self.soup.find_all(string=lambda t: isinstance(t, Comment)):
            for m in abs_url_re.finditer(str(comment)):
                self._add(m.group(0))

    def extract_pagination(self):
        for el in self.soup.find_all("a", rel=True):
            if "next" in el.get("rel", []) or "prev" in el.get("rel", []):
                self._add(el.get("href", ""))

        pagination_classes = re.compile(r"pag(e|ination|er)|next|prev|older|newer", re.I)
        for el in self.soup.find_all(["a", "button", "li"], class_=pagination_classes):
            href = el.get("href") or el.get("data-href") or ""
            self._add(href)

    def _add(self, raw: str):
        url = self._normalize(raw)
        if url:
            self.found_links.add(url)

    def _normalize(self, raw: str) -> Optional[str]:
        if not raw or not raw.strip():
            return None

        raw = raw.strip().rstrip("/.,;\"'`)")

        ignore_schemes = (
            "javascript:", "mailto:", "tel:", "data:",
            "blob:", "void", "#",
        )
        if any(raw.lower().startswith(s) for s in ignore_schemes):
            return None

        # Filter out unwanted media, scripts, and data files based on extension
        ignore_exts = (
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
            ".mp4", ".mp3", ".wav", ".avi", ".mov", ".webm",
            ".js", ".jsx", ".ts", ".tsx",
            ".json", ".css", ".woff", ".woff2", ".ttf", ".eot"
        )
        parsed_path = urlparse(raw.lower()).path
        if any(parsed_path.endswith(ext) for ext in ignore_exts):
            return None

        if raw.startswith("http://") or raw.startswith("https://"):
            parsed = urlparse(raw)
            return parsed.geturl()

        if raw.startswith("/") or raw.startswith("./") or raw.startswith("../"):
            return urljoin(self.base_url, raw)

        if raw.startswith("//"):
            scheme = urlparse(self.base_url).scheme
            return f"{scheme}:{raw}"

        if " " not in raw and "\n" not in raw:
            resolved = urljoin(self.base_url, raw)
            if resolved.startswith("http"):
                return resolved

        return None

    def extract_all(self) -> Set[str]:
        self.extract_standard_tags()
        self.extract_meta_tags()
        self.extract_css_urls()
        self.extract_from_javascript()
        self.extract_data_attributes()
        self.extract_json_ld()
        self.extract_plain_text_urls()
        self.extract_pagination()
        return self.found_links

try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    pass

FILE_EXT_RE = re.compile(
    r'\.(pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip|alz|egg|7z|csv|txt)(\?[^"\']*)?$',
    re.IGNORECASE,
)
DOWNLOAD_DO_RE = re.compile(
    r'(Download\.do|fileDown(load)?\.do|BoardFileDown|AttachDown|atchFileDown)',
    re.IGNORECASE,
)

def _guess_filename(url: str, link_text: str) -> str:
    import urllib.parse
    path = urllib.parse.urlparse(url).path
    name = os.path.basename(urllib.parse.unquote(path))
    if name and '.' in name and len(name) < 200:
        return name
    if link_text:
        clean = re.sub(r'[\\/*?:"<>|\n\r\t]', '_', link_text.strip())
        if re.search(r'\.\w{2,5}$', clean):
            return clean[:150]
        if clean:
            return clean[:80]
    return 'attachment'
    pass

async def extract_text_from_page(page) -> str:
    """Extract clean visible text from the page."""
    try:
        script = """
        () => {
            const clone = document.body.cloneNode(true);
            const removeTags = ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'iframe'];
            removeTags.forEach(tag => {
                const els = clone.querySelectorAll(tag);
                els.forEach(e => e.remove());
            });
            return clone.innerText || clone.textContent;
        }
        """
        text = await page.evaluate(script)
        return text.strip() if text else ""
    except Exception as e:
        print(f"Error extracting text: {e}")
        return ""

def _clean_spa_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.fragment.startswith('/') or parsed.fragment.startswith('!'):
        return url
    return url.split('#')[0]

async def crawl_spa(base_url: str, max_depth: int = 1, max_pages: int = 50, doc_id: str = None, login_id: str = None, login_pw: str = None, search_keyword: str = None, crawl_type: str = "spa", strategy: str = "bfs", restrict_path: bool = False, use_ai_extraction: bool = False, ai_extraction_prompt: str = None, existing_cache: dict = None) -> List[Dict[str, str]]:
    """
    Crawls an SPA starting from base_url, finding same-origin links and extracting text.
    Automates simple Login and Search operations if requested.
    Returns a list of dictionaries with 'url', 'title', 'content'.
    """
    results: List[Dict[str, str]] = []
    visited: Set[str] = set()
    queued: Set[str] = {base_url}
    
    from collections import deque
    from abc import ABC, abstractmethod

    class Frontier(ABC):
        @abstractmethod
        def push(self, item: tuple): pass
        @abstractmethod
        def pop(self) -> tuple: pass
        @abstractmethod
        def __len__(self) -> int: pass

    class BFSFrontier(Frontier):
        def __init__(self): self.queue = deque()
        def push(self, item): self.queue.append(item)
        def pop(self): return self.queue.popleft()
        def __len__(self): return len(self.queue)

    class DFSFrontier(Frontier):
        def __init__(self): self.stack = []
        def push(self, item): self.stack.append(item)
        def pop(self): return self.stack.pop()
        def __len__(self): return len(self.stack)

    if strategy == "dfs":
        frontier = DFSFrontier()
    else:
        frontier = BFSFrontier()
        
    frontier.push((base_url, 0, None))
    discovered_attachments: Dict[str, dict] = {} # base_name -> dict
    
    parsed_base = urlparse(base_url)
    base_domain = parsed_base.netloc
    if base_domain.startswith('www.'):
        base_domain = base_domain[4:]

    # [NEW LOGIC] Path Restriction
    base_restriction_path = "/"
    if restrict_path:
        base_restriction_path = parsed_base.path
        if not base_restriction_path:
            base_restriction_path = "/"
        else:
            last_segment = base_restriction_path.split("/")[-1]
            if "." in last_segment:
                base_restriction_path = os.path.dirname(base_restriction_path).replace("\\", "/")
            if not base_restriction_path.endswith("/"):
                base_restriction_path += "/"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080}
        )
        page = await context.new_page()

        # [NEW LOGIC] Base URL Login and Search Automation
        try:
            print(f"[{doc_id}] initial navigation to {base_url}")
            await page.goto(base_url, wait_until="networkidle", timeout=30000)
            
            # 1. Automated Login
            if login_id and login_pw:
                print(f"[{doc_id}] attempting login heuristics")
                try:
                    await page.fill('input[type="text"]:not([readonly]), input[type="email"], input[name*="id"], input[name*="uid"]', login_id, timeout=3000)
                    await page.fill('input[type="password"], input[name*="pw"], input[name*="pass"]', login_pw, timeout=3000)
                    await page.click('button[type="submit"], input[type="submit"], form button, .btn-login, [class*="login"], [id*="login"]', timeout=3000)
                    await page.wait_for_load_state("networkidle", timeout=10000)
                    print(f"[{doc_id}] login attempt completed")
                except Exception as e:
                    print(f"[{doc_id}] login heuristics failed/skipped: {e}")

            # 2. Automated Search
            if search_keyword:
                print(f"[{doc_id}] attempting search heuristics with keyword: {search_keyword}")
                try:
                    await page.fill('input[type="search"], input[name="q"], input[placeholder*="검색"], input[placeholder*="search"], input[id*="search"]', search_keyword, timeout=3000)
                    await page.keyboard.press('Enter')
                    await page.wait_for_load_state("networkidle", timeout=10000)
                    # Update base URL so crawler focuses on search results instead of root
                    if strategy == "dfs":
                        frontier = DFSFrontier()
                    else:
                        frontier = BFSFrontier()
                    frontier.push((_clean_spa_url(page.url), 0))
                    queued = {_clean_spa_url(page.url)}
                    print(f"[{doc_id}] search attempt completed, new nav URL: {page.url}")
                except Exception as e:
                    print(f"[{doc_id}] search heuristics failed/skipped: {e}")
        except Exception as e:
            print(f"[{doc_id}] failed initial navigation setup: {e}")

        # DB Setup for inline attachment uploads
        owner_username = 'admin'
        category = 'General'
        visibility = 'organization'
        upload_url = f"http://127.0.0.1:8000/api/external/upload"
        api_key = os.environ.get('M2M_UPLOAD_API_KEY', 'aimm-server-api-key')
        save_dir = os.path.join(os.path.dirname(__file__), "..", "temp_downloads")
        os.makedirs(save_dir, exist_ok=True)
        if doc_id:
            try:
                from app.rag_engine import document_status
                if doc_id in document_status:
                    doc_info = document_status[doc_id]
                    category = doc_info.get('category', 'General')
                    visibility = doc_info.get('visibility', 'organization')
                    owner_id = doc_info.get('owner_id')
                    import sqlite3
                    try:
                        from app.main import DB_PATH
                    except ImportError:
                        DB_PATH = "database.db"
                    conn = sqlite3.connect(str(DB_PATH), timeout=30)
                    cursor = conn.cursor()
                    cursor.execute("SELECT username FROM users WHERE id=?", (owner_id,))
                    row = cursor.fetchone()
                    if row: owner_username = row[0]
                    conn.close()
            except Exception:
                pass

        if existing_cache is None:
            existing_cache = {}
        
        while len(frontier) > 0 and len(visited) < max_pages * 5 and len(results) < max_pages:
            popped = frontier.pop()
            if len(popped) == 2:
                current_url, current_depth = popped
                parent_url = None
            else:
                current_url, current_depth, parent_url = popped
                
            clean_url = _clean_spa_url(current_url)
            if clean_url in visited:
                continue
            
            visited.add(clean_url)
            print(f"Crawling: {clean_url} (Depth: {current_depth}/{max_depth}, Visited: {len(visited)}/{max_pages*5}, Added: {len(results)}/{max_pages})")

            if doc_id:
                try:
                    from app.rag_engine import cancelled_jobs
                    if doc_id in cancelled_jobs:
                        print(f"[{doc_id}] Crawling cancelled via cancelled_jobs.")
                        break
                except ImportError:
                    pass
            
            clicked = False
            
            if clean_url.startswith('javascript:') and parent_url:
                try:
                    if _clean_spa_url(page.url) != _clean_spa_url(parent_url):
                        print(f"[Parent Restore] Restoring parent page for JS execution: {parent_url}")
                        await page.goto(parent_url, wait_until="networkidle", timeout=30000)
                except Exception as e:
                    print(f"Failed to restore parent: {e}")

            # Click-driven SPA navigation: if we are not on the very first page visit
            if len(visited) > 1 and clean_url != base_url and crawl_type == "spa":
                try:
                    handle = await page.evaluate_handle('''url => {
                        const aTags = Array.from(document.querySelectorAll('a'));
                        return aTags.find(a => {
                            if (a.getAttribute('href') === url || a.href === url) return true;
                            if (url.startsWith('javascript:')) {
                                let oc = a.getAttribute('onclick');
                                if (oc) {
                                    let cleanUrl = url.replace(/^javascript:/, '').replace(/\s+/g, '').replace(/['"]/g, '');
                                    let cleanOc = oc.replace(/\s+/g, '').replace(/['"]/g, '');
                                    if (cleanOc === cleanUrl || cleanOc.includes(cleanUrl) || cleanUrl.includes(cleanOc)) return true;
                                }
                            }
                            return false;
                        });
                    }''', clean_url)
                    
                    # check if the returned handle is an actual valid Element
                    is_element = await page.evaluate('e => e instanceof HTMLElement', handle)
                    if is_element:
                        print(f"[Click Mode] Clicking internal SPA link to navigate to: {clean_url}")
                        
                        # Use Javascript click to bypass interception/overlays
                        await handle.evaluate('e => e.click()')
                        clicked = True
                        
                        # Wait for the network or DOM to stabilize after click
                        await page.wait_for_timeout(2000)
                        try:
                            await page.wait_for_load_state("networkidle", timeout=10000)
                        except PlaywrightTimeoutError:
                            pass
                        except Exception:
                            pass
                            
                    await handle.dispose()
                except Exception as e:
                    print(f"[Click Mode] Error clicking {clean_url}, falling back to goto... ({e})")

            # Fallback to page.goto if click navigation didn't happen
            if not clicked:
                print(f"[Goto Mode] Full navigating to: {clean_url}")
                try:
                    await page.goto(clean_url, wait_until="networkidle", timeout=30000)
                except PlaywrightTimeoutError:
                    print(f"Timeout waiting for networkidle on {clean_url}. Proceeding with current DOM.")
                except Exception as e:
                    print(f"Failed to crawl {clean_url}: {e}")
                    continue

            await page.wait_for_timeout(1500)

            title = await page.title()
            content = await extract_text_from_page(page)

            # --- [NEW] Inline Attachment Downloading ---
            try:
                links = await page.evaluate("""() =>
                    Array.from(document.querySelectorAll('a[href]')).map(a => ({
                        href : a.href,
                        text : (a.innerText || a.getAttribute('title') || '').trim(),
                    }))
                """)
                for lnk in links:
                    href = lnk['href'].strip()
                    text = lnk['text']
                    if not href or href.startswith('javascript:'):
                        continue
                        
                    if DOWNLOAD_DO_RE.search(href) or FILE_EXT_RE.search(href):
                        # Construct absolute URL
                        absolute_url = urljoin(clean_url, href)
                        filename = _guess_filename(absolute_url, text)
                        
                        base_name = os.path.splitext(filename)[0]
                        ext = os.path.splitext(filename)[1].lower()
                        
                        # Priority: pdf=1, hwp/hwpx=2, others=3
                        priority = 3
                        if ext == '.pdf': priority = 1
                        elif ext in ['.hwp', '.hwpx']: priority = 2
                        
                        if base_name not in discovered_attachments or priority < discovered_attachments[base_name]['priority']:
                            discovered_attachments[base_name] = {
                                'url': absolute_url,
                                'filename': filename,
                                'ext': ext,
                                'priority': priority
                            }
                            
                            # Inline Download Execution
                            print(f"[{doc_id}] Inline downloading attachment: {filename} ({absolute_url})")
                            
                            new_page = None
                            try:
                                # Safe isolated download via secondary context page
                                new_page = await context.new_page()
                                async with new_page.expect_download(timeout=30000) as download_info:
                                    try:
                                        await new_page.goto(absolute_url, timeout=30000)
                                    except Exception:
                                        pass
                                download = await download_info.value
                                local_path = os.path.join(save_dir, download.suggested_filename or filename)
                                await download.save_as(local_path)
                                await new_page.close()
                                new_page = None
            
                                final_filename = download.suggested_filename or filename
                                
                                # Upload inline
                                with open(local_path, 'rb') as f:
                                    resp = await asyncio.to_thread(
                                        requests.post,
                                        upload_url,
                                        headers={'x-api-key': api_key},
                                        files={'file': (final_filename, f)},
                                        data={'category': category, 'visibility': visibility, 'owner_username': owner_username},
                                        timeout=120
                                    )
                                    print(f"[{doc_id}] Uploaded inline attachment {final_filename}: {resp.status_code} {resp.text[:100]}")
            
                                if os.path.exists(local_path):
                                    os.remove(local_path)
                            except Exception as e:
                                print(f"[{doc_id}] Failed to inline download/upload attachment {filename}: {e}")
                                if new_page:
                                    try: await new_page.close()
                                    except Exception: pass
            except Exception as e:
                print(f"Error extracting attachments inline on {clean_url}: {e}")

            if content and len(content) > 50:
                import hashlib
                content_hash = hashlib.md5(content.encode('utf-8', errors='ignore')).hexdigest()
                
                if existing_cache.get(clean_url) == content_hash:
                    print(f"[{doc_id}] Skipping unchanged cached page: {clean_url}")
                else:
                    results.append({
                        "url": clean_url,
                        "title": title,
                        "content": content
                    })
                    
                    # --- [NEW] Live Log Streaming ---
                    if doc_id:
                        try:
                            from app.rag_engine import document_status
                            from datetime import datetime
                            if doc_id in document_status:
                                if "live_logs" not in document_status[doc_id]:
                                    document_status[doc_id]["live_logs"] = []
                                document_status[doc_id]["live_logs"].append({
                                    "url": clean_url,
                                    "title": title,
                                    "length": len(content),
                                    "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                })
                        except Exception:
                            pass

            if current_depth < max_depth:
                try:
                    # Menu Expander: Force hover/click on common dropdown toggles to reveal hidden lazy-loaded links
                    if crawl_type == "spa":
                        try:
                            await page.evaluate('''() => {
                                // 1. Broad hover sweep
                                document.querySelectorAll('nav, header, [class*="menu"], [class*="nav"], [class*="drop"]').forEach(el => {
                                    try {
                                        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                                        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                                    } catch(e) {}
                                });
                                
                                // 2. Aggressive click sweep (safely avoid real links)
                                document.querySelectorAll('button, [class*="toggle"], [class*="menu"], [class*="drop"], [aria-haspopup="true"], header div, nav div').forEach(el => {
                                    try {
                                        if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#') return;
                                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                    } catch(e) {}
                                });
                            }''')
                            await page.wait_for_timeout(1000) # Wait for DOM rendering/animations
                        except Exception as e:
                            print(f"Menu expansion failed on {clean_url}: {e}")

                    html_content = await page.content()
                    extractor = ComprehensiveLinkExtractor(str(clean_url), html_content)
                    extracted_links = extractor.extract_all()
                    
                    if use_ai_extraction and ai_extraction_prompt:
                        try:
                            soup = BeautifulSoup(html_content, "lxml")
                            candidate_pairs = []
                            seen_urls = set()
                            
                            for a_tag in soup.find_all("a"):
                                raw_href = a_tag.get("href", "").strip()
                                onclick_val = a_tag.get("onclick", "").strip()
                                text = a_tag.get_text(separator=" ", strip=True)
                                if not text:
                                    img = a_tag.find("img", alt=True)
                                    if img: text = img.get('alt', '').strip()
                                    
                                if not text: continue
                                
                                if not raw_href or raw_href.startswith(('javascript:', 'mailto:', 'tel:', '#')):
                                    if onclick_val:
                                        raw_href = f"javascript:{onclick_val}"
                                    elif raw_href.startswith('javascript:'):
                                        pass
                                    else:
                                        continue
                                        
                                abs_url = urljoin(str(clean_url), raw_href)
                                parsed_url = urlparse(abs_url)
                                target_domain = parsed_url.netloc
                                if target_domain.startswith('www.'):
                                    target_domain = target_domain[4:]
                                    
                                if parsed_url.scheme in ('http', 'https', 'javascript'):
                                    if parsed_url.scheme in ('http', 'https'):
                                        if not use_ai_extraction and target_domain != base_domain:
                                            continue
                                        if restrict_path and not parsed_url.path.startswith(base_restriction_path):
                                            continue
                                        
                                    c_url = abs_url if parsed_url.scheme == 'javascript' else _clean_spa_url(abs_url)
                                    if c_url not in seen_urls and c_url not in visited and c_url not in queued:
                                        seen_urls.add(c_url)
                                        candidate_pairs.append({"url": c_url, "text": text[:150]})
                            
                            limit_c = candidate_pairs[:200] # Limit to 200 links to save token bounds
                            context_payload = json.dumps(limit_c, ensure_ascii=False, indent=2)
                            print(f"[{doc_id}] ======= AI Link Extraction Payload =======\n{context_payload}\n==============================================")
                            
                            scripts = soup.find_all("script")
                            script_snippets = []
                            for s in scripts:
                                if s.string and ("function" in s.string or "location" in s.string) and len(s.string) < 5000:
                                    script_snippets.append(s.string.strip())
                            script_context = "\n".join(script_snippets)[:15000]

                            prompt = (
                                f"You are an intelligent web crawler assistant. Extract links matching the following criteria: {ai_extraction_prompt}\n\n"
                                f"Here is the list of extracted candidate links from the page with their description texts:\n{context_payload}\n\n"
                                f"If any candidate 'url' uses javascript (e.g. `javascript:fn(...)`), try your best to translate it into its actual destination HTTP URL "
                                f"using the page's script context provided below. If you can deduce the target HTTP path (e.g. `/ex/bbs/View.do?...`), return that translated URL as the 'url' instead.\n"
                                f"--- Page Script Context for Deduction ---\n{script_context}\n---------------------------------------\n\n"
                                f"Return EXACTLY a valid JSON array of objects, each containing 'url' and 'category'. "
                                f"The 'url' must be the translated HTTP URL if possible, otherwise keep the original format. "
                                f"The 'category' should be a short classification or reasoning for why this link matches the criteria. "
                                f"Example: [{{\"url\": \"https://example.com/item1\", \"category\": \"Notice\"}}]. "
                                f"Only return the JSON array format. Do not add any conversational text."
                            )
                            
                            
                            from pageindex.utils import ChatGPT_API_async
                            from app.rag_engine import get_sys_setting
                            print(f"[{doc_id}] Requesting AI Semantic Link Extraction...")
                            crawl_model_cfg = get_sys_setting("crawl_llm_model", "gemini-flash-lite-latest")
                            ai_response = await ChatGPT_API_async(model=crawl_model_cfg, prompt=prompt)
                            
                            selected_items = []
                            try:
                                json_match = re.search(r'\[\s*\{.*?\}\s*\]', ai_response, re.DOTALL)
                                if json_match:
                                    selected_items = json.loads(json_match.group(0))
                                else:
                                    clean_res = ai_response.strip()
                                    if clean_res.startswith('```'):
                                        clean_res = re.sub(r'^```[a-z]*\s*', '', clean_res)
                                        clean_res = re.sub(r'\s*```$', '', clean_res)
                                    selected_items = json.loads(clean_res.strip())
                            except Exception as e:
                                print(f"[{doc_id}] JSON Parse Error: {e}")
                            
                            if isinstance(selected_items, list) and len(selected_items) > 0:
                                filtered_links = set()
                                for item in selected_items:
                                    if isinstance(item, dict) and "url" in item:
                                        raw_url = item["url"]
                                        ctg = item.get("category", "Unknown")
                                    elif isinstance(item, str):
                                        raw_url = item
                                        ctg = "Unknown"
                                    else:
                                        continue
                                        
                                    absolute_url = urljoin(str(clean_url), raw_url)
                                    parsed_url = urlparse(absolute_url)
                                    target_domain = parsed_url.netloc
                                    if target_domain.startswith('www.'):
                                        target_domain = target_domain[4:]
                                    if parsed_url.scheme in ('http', 'https', 'javascript'):
                                        if parsed_url.scheme in ('http', 'https'):
                                            if not use_ai_extraction and target_domain != base_domain:
                                                continue
                                            
                                        c_url = absolute_url if parsed_url.scheme == 'javascript' else _clean_spa_url(absolute_url)
                                        # Deduplication logic: prevents revisiting same url
                                        if c_url not in visited and c_url not in queued:
                                            filtered_links.add(c_url)
                                            print(f"[{doc_id}] AI Selection -> {c_url} (Category: {ctg})")
                                
                                extracted_links = list(filtered_links)
                                print(f"[{doc_id}] AI Extracted semantic links: {len(extracted_links)} found.")
                            else:
                                print(f"[{doc_id}] AI Response was empty or invalid format.")
                                extracted_links = []
                        except Exception as e:
                            print(f"[{doc_id}] AI Link Extraction Error: {e}")
                            extracted_links = []
                    
                    for absolute_url in extracted_links:
                        parsed_url = urlparse(absolute_url)
                        
                        target_domain = parsed_url.netloc
                        if target_domain.startswith('www.'):
                            target_domain = target_domain[4:]
                            
                        if parsed_url.scheme in ('http', 'https', 'javascript'):
                            if parsed_url.scheme in ('http', 'https'):
                                if not use_ai_extraction:
                                    if target_domain != base_domain:
                                        continue
                                    if restrict_path and not parsed_url.path.startswith(base_restriction_path):
                                        continue
                                        
                            link_clean_url = absolute_url if parsed_url.scheme == 'javascript' else _clean_spa_url(absolute_url)
                            if link_clean_url not in visited and link_clean_url not in queued:
                                frontier.push((link_clean_url, current_depth + 1, clean_url))
                                queued.add(link_clean_url)
                except Exception as e:
                    print(f"Error finding links on {clean_url}: {e}")



        await browser.close()
        
    return results

def crawl_spa_sync_wrapper(base_url: str, max_depth: int = 1, max_pages: int = 50, doc_id: str = None, login_id: str = None, login_pw: str = None, search_keyword: str = None, crawl_type: str = "spa", strategy: str = "bfs", restrict_path: bool = False, use_ai_extraction: bool = False, ai_extraction_prompt: str = None, existing_cache: dict = None) -> List[Dict[str, str]]:
    """
    Synchronous wrapper to safely run Playwright inside a dedicated ProactorEventLoop
    on Windows, bypassing the NotImplementedError caused by Uvicorn's SelectorEventLoop.
    """
    import sys
    import asyncio
    
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        
    return asyncio.run(crawl_spa(base_url, max_depth, max_pages, doc_id, login_id, login_pw, search_keyword, crawl_type, strategy, restrict_path, use_ai_extraction, ai_extraction_prompt, existing_cache))
