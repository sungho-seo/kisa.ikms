"""
DB 및 문서 초기화 스크립트 (reset_db.py)
- docs_fts 테이블의 모든 문서 색인 삭제
- status.json 초기화
- docs/ 폴더의 파일 삭제
- trees/ 폴더의 JSON 파일 삭제
- (선택) chat_history 테이블 초기화

실행 전 서버를 반드시 종료하세요!
실행 방법: python reset_db.py
"""
import sqlite3
import json
import os
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent
DB_PATH = PROJECT_ROOT / "search_index.db"
STATUS_FILE = PROJECT_ROOT / "status.json"
DOCS_DIR = PROJECT_ROOT / "docs"
TREES_DIR = PROJECT_ROOT / "trees"

def reset():
    print("=" * 50)
    print("문서 DB 초기화를 시작합니다.")
    print("=" * 50)

    # 1. SQLite docs_fts 테이블 초기화
    if DB_PATH.exists():
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        cursor.execute("DELETE FROM docs_fts")
        fts_deleted = cursor.rowcount
        print(f"[완료] docs_fts 테이블 초기화 ({fts_deleted}개 레코드 삭제)")

        # chat_history 초기화 (선택)
        cursor.execute("DELETE FROM chat_history")
        ch_deleted = cursor.rowcount
        print(f"[완료] chat_history 테이블 초기화 ({ch_deleted}개 레코드 삭제)")

        conn.commit()
        conn.close()
    else:
        print("[건너뜀] search_index.db 파일이 없습니다.")

    # 2. status.json 초기화
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump({}, f)
    print(f"[완료] status.json 초기화 완료")

    # 3. docs/ 폴더 내 PDF 삭제
    pdf_count = 0
    if DOCS_DIR.exists():
        for f in DOCS_DIR.iterdir():
            if f.is_file() and f.suffix.lower() == ".pdf":
                f.unlink()
                pdf_count += 1
    print(f"[완료] docs/ 폴더 파일 {pdf_count}개 삭제")

    # 4. trees/ 폴더 내 JSON 삭제
    json_count = 0
    if TREES_DIR.exists():
        for f in TREES_DIR.iterdir():
            if f.is_file() and f.suffix.lower() == ".json":
                f.unlink()
                json_count += 1
    print(f"[완료] trees/ 폴더 JSON 파일 {json_count}개 삭제")

    print("=" * 50)
    print("초기화 완료! 서버를 다시 시작하세요.")
    print("=" * 50)

if __name__ == "__main__":
    confirm = input("정말로 모든 문서를 초기화하시겠습니까? (yes 입력 시 진행): ")
    if confirm.strip().lower() == "yes":
        reset()
    else:
        print("취소되었습니다.")
