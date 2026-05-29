
class CrawlRequest(BaseModel):
    url: str
    site_name: str
    folder_id: Optional[int] = None
    max_depth: Optional[int] = 1
    max_pages: Optional[int] = 10

@app.post("/api/documents/crawl")
async def api_crawl_website(req: CrawlRequest, current_user: dict = fastapi.Depends(get_current_user)):
    from app.crawler import crawl_spa
    import uuid
    from app.rag_engine import rag_engine, DB_PATH
    import sqlite3
    
    try:
        results = await crawl_spa(req.url, req.max_depth, req.max_pages)
        if not results:
            return JSONResponse(status_code=400, content={"error": "크롤링 결과 페이지를 찾을 수 없거나 텍스트를 추출하지 못했습니다."})
        
        doc_id = str(uuid.uuid4())[:12]
        final_name = f"[WEBSITE] {req.site_name}"
        owner_id = current_user["id"]
        
        conn = sqlite3.connect(str(DB_PATH), timeout=30)
        cursor = conn.cursor()
        
        if req.folder_id:
            cursor.execute("SELECT owner_id, is_public FROM folders WHERE id = ?", (req.folder_id,))
            row = cursor.fetchone()
            if row:
                if row[1] == 1 and current_user.get("role") == "admin":
                    owner_id = "admin"
                else:
                    owner_id = row[0]

        cursor.execute('''INSERT INTO documents 
            (id, name, filename, file_path, folder_id, content_type, size_bytes, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (doc_id, final_name, f"{req.site_name}.url", req.url, req.folder_id, 'application/json', len(str(results)), owner_id)
        )
        
        chunk_count = 0
        for page in results:
            chunks = rag_engine._chunk_text(page["content"], chunk_size=rag_engine.chunk_size, chunk_overlap=rag_engine.chunk_overlap)
            for chunk in chunks:
                node_id = str(uuid.uuid4())
                cursor.execute('''INSERT INTO docs_fts (doc_id, node_id, title, text_content, page_num)
                    VALUES (?, ?, ?, ?, ?)''',
                    (doc_id, node_id, page['title'] or req.site_name, chunk, page['url'])
                )
                chunk_count += 1
        
        conn.commit()
        conn.close()
        
        try:
            rag_engine._load_global_metadata()
        except:
            pass
            
        return {"success": True, "doc_id": doc_id, "pages_crawled": len(results), "chunks_indexed": chunk_count}
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"크롤링 중 오류: {str(e)}"})

