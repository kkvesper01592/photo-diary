@echo off
chcp 65001 >nul
title 写真日記 (PC だけで使う・この画面を閉じるとアプリも止まります)
cd /d "%~dp0"
echo 写真日記 を PC だけで使えるように準備しています...
echo (公開版と同じ形に組み立てます。初回や更新の後は少し時間がかかります)
echo.
if not exist node_modules (
  echo 必要な部品を入れています...
  call npm install
)
call npm run build
if errorlevel 1 (
  echo.
  echo 組み立てに失敗しました。上のメッセージを確認してください。
  pause
  exit /b 1
)
echo.
echo ブラウザで http://localhost:5175/photo-diary/ が開きます。使い終わったら、この黒い画面を閉じてください。
echo.
call npx vite preview --port 5175 --strictPort --open /photo-diary/
echo.
echo 起動できませんでした。すでに別の画面で起動している場合(起動.bat を含む)は、そちらを閉じてからもう一度お試しください。
pause
