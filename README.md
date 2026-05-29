# Inferential RAG App with Tree Index (추론형 RAG 애플리케이션)

이 프로젝트는 다양한 포맷의 문서(PDF, DOCX, HWP, PPTX)와 웹페이지 데이터를 수집하고, 인공지능 기반 트리 구조 색인(Tree Index)을 생성하여 고성능 추론 답변을 제공하는 RAG 솔루션입니다.

---

## 🔐 로컬 테스트 계정 정보

웹 로그인 페이지 진입 시 사용하는 테스트/관리자 계정 정보입니다.

* **아이디 (Username)**: `admin`
* **비밀번호 (Password)**: `dpdldkdl!1` (한글 자판 기준 `에이아이!1`)

---

## 🚀 개발 환경 구축 (WSL Ubuntu 기준)

프로젝트 루트 디렉토리에 포함된 [setup_wsl.sh](setup_wsl.sh) 자동 설치 스크립트를 사용하여 간편하게 환경을 세팅할 수 있습니다.

### 1. 환경 자동 세팅
터미널에서 아래 명령어를 차례로 입력합니다:
```bash
# 1) 스크립트 실행 (Java JRE, Python 3.12, 시스템 라이브러리 자동 설치)
chmod +x setup_wsl.sh
./setup_wsl.sh
```

### 2. 환경 변수 설정
설치가 완료되면, 루트 디렉토리에 `.env` 파일을 생성하고 API 키를 설정합니다. ([.env.template](.env.template) 파일 참고)
```ini
OPENAI_API_KEY=your_openai_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
SECRET_KEY=your_jwt_secret_key_here
```

### 3. 서버 실행
가상환경이 활성화된 상태에서 앱 서버를 가동합니다:
```bash
# 가상환경 활성화
source venv/bin/activate

# FastAPI 서버 시작
./start.sh
```

---

## 🛠️ 주요 기술 스택
* **Backend**: FastAPI, Python 3.12, Uvicorn, SQLite3 (FTS)
* **AI & LLM**: Google GenAI (Gemini), OpenAI API, Tiktoken
* **Crawling & Scraping**: Playwright
* **Document Parsers**: PyMuPDF (fitz), python-docx, python-pptx, pyhwp (Java JRE 종속)
