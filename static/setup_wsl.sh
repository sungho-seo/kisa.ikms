#!/bin/bash
set -e

echo "============================================="
echo " WSL Ubuntu RAG 개발 환경 자동 설정 시작"
echo "============================================="

echo "---------------------------------------------"
echo " 1. APT 시스템 패키지 업데이트 및 설치..."
echo "---------------------------------------------"
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip \
                    build-essential libxml2-dev libxslt1-dev zlib1g-dev \
                    libffi-dev libssl-dev sqlite3 libsqlite3-dev nodejs npm

echo "---------------------------------------------"
echo " 2. Python 가상환경(venv) 구축 및 의존성 패키지 설치..."
echo "---------------------------------------------"
if [ -d "venv" ]; then
    echo "[안내] 기존 venv 디렉토리가 발견되었습니다. 백업 후 새로 만듭니다."
    mv venv venv_backup_$(date +%Y%m%d_%H%M%S)
fi

python3.11 -m venv venv
source venv/bin/activate

echo "[안내] pip 업그레이드 중..."
pip install --upgrade pip

echo "[안내] Python 라이브러리 패키지 설치 중..."
pip install fastapi uvicorn pydantic python-dotenv PyYAML sse-starlette \
            pymupdf PyPDF2 python-docx python-pptx pyhwp tiktoken xlsxwriter \
            google-genai openai mcp opendataloader-pdf playwright

echo "---------------------------------------------"
echo " 3. Playwright 브라우저 및 OS 레벨 의존성 설치..."
echo "---------------------------------------------"
playwright install chromium
sudo playwright install-deps chromium

echo "============================================="
echo " WSL Ubuntu 환경 설정 완료!"
echo "============================================="
echo "서버를 실행하려면 아래 명령어를 입력하세요:"
echo "source venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8008"
echo "============================================="
