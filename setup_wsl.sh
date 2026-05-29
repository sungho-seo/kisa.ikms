#!/bin/bash
set -e

echo "============================================="
echo " WSL Ubuntu RAG 개발 환경 자동 설정 시작"
echo "============================================="

echo "---------------------------------------------"
echo " 1. APT 시스템 패키지 업데이트 및 설치..."
echo "---------------------------------------------"
sudo apt update
sudo apt install -y python3 python3-venv python3-dev \
                    build-essential libxml2-dev libxslt1-dev zlib1g-dev \
                    libffi-dev libssl-dev sqlite3 libsqlite3-dev nodejs npm \
                    openjdk-17-jre


echo "---------------------------------------------"
echo " 2. Python 가상환경(venv) 생성 및 활성화..."
echo "---------------------------------------------"
if [ -d "venv" ]; then
    echo "[안내] 기존 venv 디렉토리를 발견했습니다. 백업 후 재생성합니다."
    mv venv venv_backup_$(date +%Y%m%d_%H%M%S)
fi

python3 -m venv venv

source venv/bin/activate

echo "[안내] pip 업그레이드 중..."
./venv/bin/pip install --upgrade pip

echo "[안내] Python 라이브러리 패키지 설치 중..."
if [ -f "requirements.txt" ]; then
    ./venv/bin/pip install -r requirements.txt
else
    echo "[오류] requirements.txt 파일을 찾을 수 없습니다!"
    exit 1
fi

echo "---------------------------------------------"
echo " 3. Playwright 브라우저 및 OS 레벨 의존성 설치..."
echo "---------------------------------------------"
./venv/bin/playwright install chromium
sudo ./venv/bin/playwright install-deps chromium


echo "============================================="
echo " WSL Ubuntu 환경 설정 완료!"
echo "============================================="
echo "서버를 실행하려면 아래 명령어를 입력하세요:"
echo "source venv/bin/activate"
echo "./start.sh"
echo "============================================="
